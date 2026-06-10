#!/usr/bin/env node

/**
 * Sonic AI V3 — Bootstrap Script
 * 
 * One-command setup that validates environment and initializes the monorepo.
 * 
 * Usage:
 *   node scripts/bootstrap.mjs
 *   npm run bootstrap     (if added to package.json)
 *   pnpm bootstrap       (if added to package.json)
 */

import { execSync } from 'child_process';
import { existsSync, copyFileSync } from 'fs';
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
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
};

const log = {
  header: (msg) => console.log(`\n${colors.bold}${colors.cyan}▶ ${msg}${colors.reset}`),
  success: (msg) => console.log(`${colors.green}✓ ${msg}${colors.reset}`),
  warn: (msg) => console.log(`${colors.yellow}⚠ ${msg}${colors.reset}`),
  error: (msg) => console.log(`${colors.red}✗ ${msg}${colors.reset}`),
  info: (msg) => console.log(`${colors.blue}ℹ ${msg}${colors.reset}`),
};

// ============================================================================
// Utility: Execute shell commands with error handling
// ============================================================================

function exec(command, description) {
  try {
    log.info(description || command);
    execSync(command, { stdio: 'inherit', cwd: rootDir });
    return true;
  } catch (error) {
    log.error(`Failed: ${description || command}`);
    return false;
  }
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
// Version Checks
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

function checkVersion(name, command, requiredMajor, requiredMinor = 0) {
  const versionOutput = execSilent(command);
  if (!versionOutput) {
    log.error(`${name} not found. Please install ${name}.`);
    return false;
  }

  const version = parseVersion(versionOutput);
  const required = { major: requiredMajor, minor: requiredMinor, patch: 0 };

  if (!compareVersions(version, required)) {
    log.error(`${name} v${versionOutput} found, but v${requiredMajor}.${requiredMinor}+ required.`);
    return false;
  }

  log.success(`${name} v${versionOutput} ✓`);
  return true;
}

// ============================================================================
// Main Bootstrap Flow
// ============================================================================

async function bootstrap() {
  log.header('Sonic AI V3 Bootstrap');
  console.log(`Root directory: ${rootDir}\n`);

  let allChecks = true;

  // --- Step 1: Version Checks ---
  log.header('Step 1: Validating environment');

  if (!checkVersion('Node.js', 'node --version', 20)) allChecks = false;
  if (!checkVersion('pnpm', 'pnpm --version', 10)) allChecks = false;

  // Python 3.12+ is optional for initial setup (backend comes later)
  const pythonCheck = checkVersion('Python', 'python3 --version', 3, 12);
  if (!pythonCheck) {
    log.warn('Python 3.12+ not found. Backend will require it later.');
  }

  // --- Step 2: Enable Corepack ---
  log.header('Step 2: Enabling corepack');
  if (!exec('corepack enable', 'Setting up corepack for pnpm management')) {
    allChecks = false;
  }

  // --- Step 3: Install Dependencies ---
  log.header('Step 3: Installing workspace dependencies');
  if (!exec('pnpm install', 'Installing all monorepo packages')) {
    allChecks = false;
  }

  // --- Step 4: Environment File ---
  log.header('Step 4: Setting up environment');
  const envExamplePath = resolve(rootDir, '.env.example');
  const envPath = resolve(rootDir, '.env');

  if (existsSync(envExamplePath)) {
    if (existsSync(envPath)) {
      log.warn('.env already exists, skipping copy from .env.example');
    } else {
      try {
        copyFileSync(envExamplePath, envPath);
        log.success('.env file created from .env.example');
        log.info('Please update .env with your Supabase, Redis, and database credentials.');
      } catch (error) {
        log.error(`Failed to copy .env.example: ${error.message}`);
        allChecks = false;
      }
    }
  } else {
    log.warn('.env.example not found, skipping .env setup');
  }

  // --- Step 5: Validate V3 Foundation ---
  log.header('Step 5: Validating V3 foundation');
  if (!exec('pnpm audit:v3', 'Running V3 foundation audit')) {
    log.warn('V3 foundation audit failed. Check configuration.');
  }

  // --- Final Status ---
  console.log();
  if (allChecks) {
    log.success('Bootstrap complete! ✓\n');
    console.log(`${colors.bold}Next steps:${colors.reset}`);
    console.log('  1. Update .env with your Supabase and database credentials');
    console.log('  2. Run: pnpm dev         (start all dev servers)');
    console.log('  3. Run: pnpm build       (build all packages)');
    console.log('  4. Run: pnpm test        (run test suite)\n');
    process.exit(0);
  } else {
    log.error('Bootstrap encountered issues. Please fix errors above.\n');
    process.exit(1);
  }
}

// ============================================================================
// Execute
// ============================================================================

bootstrap().catch((error) => {
  log.error(`Unexpected error: ${error.message}`);
  process.exit(1);
});
