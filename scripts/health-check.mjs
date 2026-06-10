#!/usr/bin/env node

/**
 * Sonic AI V3 — Health Check Script
 * 
 * Validates the environment and workspace integrity before development.
 * 
 * Checks:
 * - Required runtime versions (Node, pnpm, Python, PostgreSQL, Redis)
 * - Workspace structure and package.json integrity
 * - Critical .env variables
 * - Service connectivity (optional)
 * 
 * Usage:
 *   node scripts/health-check.mjs
 *   pnpm health-check    (if added to package.json)
 */

import { execSync, spawnSync } from 'child_process';
import { existsSync, readFileSync } from 'fs';
import { resolve } from 'path';
import { fileURLToPath } from 'url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const rootDir = resolve(__dirname, '..');

// ============================================================================
// ANSI Colors for terminal output
// ============================================================================

const colors = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
};

const log = {
  header: (msg) => console.log(`\n${colors.bold}${colors.cyan}▶ ${msg}${colors.reset}`),
  pass: (msg) => console.log(`${colors.green}✓ ${msg}${colors.reset}`),
  warn: (msg) => console.log(`${colors.yellow}⚠ ${msg}${colors.reset}`),
  fail: (msg) => console.log(`${colors.red}✗ ${msg}${colors.reset}`),
  info: (msg) => console.log(`${colors.blue}ℹ ${msg}${colors.reset}`),
};

// ============================================================================
// Utilities
// ============================================================================

function parseVersion(versionStr) {
  const match = versionStr.match(/(\d+)\.(\d+)\.(\d+)/);
  return match ? { major: parseInt(match[1]), minor: parseInt(match[2]), patch: parseInt(match[3]) } : null;
}

function compareVersions(actual, required) {
  if (!actual || !required) return false;
  if (actual.major > required.major) return true;
  if (actual.major < required.major) return false;
  if (actual.minor > required.minor) return true;
  if (actual.minor < required.minor) return false;
  return actual.patch >= required.patch;
}

function execSilent(command) {
  try {
    const output = execSync(command, { encoding: 'utf-8', stdio: 'pipe', cwd: rootDir });
    return output.trim();
  } catch (error) {
    return null;
  }
}

// ============================================================================
// Checks
// ============================================================================

class HealthCheck {
  constructor() {
    this.passed = 0;
    this.warned = 0;
    this.failed = 0;
  }

  // Check runtime versions
  checkVersion(name, command, requiredMajor, requiredMinor = 0, isCritical = true) {
    const versionOutput = execSilent(command);
    
    if (!versionOutput) {
      if (isCritical) {
        log.fail(`${name} not found`);
        this.failed++;
      } else {
        log.warn(`${name} not found (optional)`);
        this.warned++;
      }
      return false;
    }

    const version = parseVersion(versionOutput);
    const required = { major: requiredMajor, minor: requiredMinor, patch: 0 };

    if (!compareVersions(version, required)) {
      if (isCritical) {
        log.fail(`${name} ${versionOutput} found, but ${requiredMajor}.${requiredMinor}+ required`);
        this.failed++;
      } else {
        log.warn(`${name} ${versionOutput} found, but ${requiredMajor}.${requiredMinor}+ recommended`);
        this.warned++;
      }
      return false;
    }

    log.pass(`${name} ${versionOutput}`);
    this.passed++;
    return true;
  }

  // Check file/directory existence
  checkPath(description, path, isCritical = true) {
    if (existsSync(path)) {
      log.pass(description);
      this.passed++;
      return true;
    } else {
      if (isCritical) {
        log.fail(`${description} not found at ${path}`);
        this.failed++;
      } else {
        log.warn(`${description} not found at ${path}`);
        this.warned++;
      }
      return false;
    }
  }

  // Check for required packages in workspace
  checkPackages() {
    const rootPackageJson = resolve(rootDir, 'package.json');
    
    if (!existsSync(rootPackageJson)) {
      log.fail('Root package.json not found');
      this.failed++;
      return false;
    }

    try {
      const pkg = JSON.parse(readFileSync(rootPackageJson, 'utf-8'));
      const requiredWorkspaces = ['apps/*', 'packages/*'];
      
      if (!pkg.workspaces) {
        log.fail('No workspaces defined in root package.json');
        this.failed++;
        return false;
      }

      const hasRequiredWorkspaces = requiredWorkspaces.every(ws => pkg.workspaces.includes(ws));
      
      if (!hasRequiredWorkspaces) {
        log.warn('Some expected workspaces not defined');
        this.warned++;
        return false;
      }

      log.pass(`Monorepo workspaces configured (${pkg.workspaces.length} defined)`);
      this.passed++;
      return true;
    } catch (error) {
      log.fail(`Failed to parse package.json: ${error.message}`);
      this.failed++;
      return false;
    }
  }

  // Check environment variables
  checkEnv() {
    const envPath = resolve(rootDir, '.env');
    
    if (!existsSync(envPath)) {
      log.warn('.env file not found (create with: cp .env.example .env)');
      this.warned++;
      return false;
    }

    try {
      const envContent = readFileSync(envPath, 'utf-8');
      const requiredKeys = [
        'SUPABASE_URL',
        'SUPABASE_ANON_KEY',
        'SUPABASE_SERVICE_ROLE_KEY',
        'DATABASE_URL',
        'JWT_SECRET',
      ];

      const missing = [];
      const unset = [];

      for (const key of requiredKeys) {
        const regex = new RegExp(`^${key}=(.*)$`, 'm');
        const match = envContent.match(regex);
        
        if (!match) {
          missing.push(key);
        } else if (!match[1] || match[1].startsWith('replace-me') || match[1] === 'http://localhost:9000') {
          unset.push(key);
        }
      }

      if (missing.length > 0) {
        log.fail(`Missing .env keys: ${missing.join(', ')}`);
        this.failed++;
        return false;
      }

      if (unset.length > 0) {
        log.warn(`Unset .env values: ${unset.join(', ')} (update required for production)`);
        this.warned++;
        return false;
      }

      log.pass('Critical .env variables are set');
      this.passed++;
      return true;
    } catch (error) {
      log.fail(`Failed to check .env: ${error.message}`);
      this.failed++;
      return false;
    }
  }

  // Check node_modules exists
  checkNodeModules() {
    const nmPath = resolve(rootDir, 'node_modules');
    
    if (existsSync(nmPath)) {
      log.pass('node_modules installed');
      this.passed++;
      return true;
    } else {
      log.warn('node_modules not found (run: pnpm install)');
      this.warned++;
      return false;
    }
  }

  // Check service connectivity (optional, doesn't fail)
  checkServices() {
    log.info('Checking service ports...');

    const services = [
      { name: 'PostgreSQL', port: 5432 },
      { name: 'Redis', port: 6379 },
      { name: 'MinIO', port: 9000 },
    ];

    let servicesUp = 0;

    for (const service of services) {
      const cmd = `curl -s http://localhost:${service.port} > /dev/null 2>&1 || nc -z localhost ${service.port}`;
      const isUp = spawnSync('bash', ['-c', cmd], { stdio: 'pipe', cwd: rootDir }).status === 0;
      
      if (isUp) {
        log.pass(`${service.name} (${service.port}) is up`);
        servicesUp++;
      } else {
        log.warn(`${service.name} (${service.port}) is not responding`);
      }
    }

    if (servicesUp === 0) {
      log.info('No services detected. Start them with: docker-compose up -d');
    }
  }

  // Print summary
  summary() {
    console.log();
    log.header('Health Check Summary');
    console.log(`  ${colors.green}Passed${colors.reset}: ${this.passed}`);
    if (this.warned > 0) console.log(`  ${colors.yellow}Warned${colors.reset}: ${this.warned}`);
    if (this.failed > 0) console.log(`  ${colors.red}Failed${colors.reset}: ${this.failed}`);
    console.log();

    if (this.failed > 0) {
      log.fail('Health check failed. Fix the above issues and try again.\n');
      return false;
    }

    if (this.warned > 0) {
      log.warn('Health check passed with warnings. Review optional items above.\n');
      return true;
    }

    log.pass('Health check passed! Ready for development.\n');
    return true;
  }
}

// ============================================================================
// Main Execution
// ============================================================================

async function runHealthCheck() {
  log.header('Sonic AI V3 — Health Check');
  console.log(`Root directory: ${rootDir}\n`);

  const check = new HealthCheck();

  // --- Runtime Versions ---
  log.header('Step 1: Runtime versions');
  check.checkVersion('Node.js', 'node --version', 20, 0, true);
  check.checkVersion('pnpm', 'pnpm --version', 10, 0, true);
  check.checkVersion('Python', 'python3 --version', 3, 12, false);

  // --- Workspace Structure ---
  log.header('Step 2: Workspace structure');
  check.checkPath('Root package.json', resolve(rootDir, 'package.json'), true);
  check.checkPath('.env.example', resolve(rootDir, '.env.example'), true);
  check.checkPackages();
  check.checkNodeModules();

  // --- Environment ---
  log.header('Step 3: Environment configuration');
  check.checkEnv();

  // --- Services (optional) ---
  log.header('Step 4: Optional services');
  check.checkServices();

  // --- Summary ---
  const isHealthy = check.summary();
  process.exit(isHealthy ? 0 : 1);
}

runHealthCheck().catch((error) => {
  log.fail(`Unexpected error: ${error.message}`);
  process.exit(1);
});
