#!/usr/bin/env node

/**
 * Sonic AI V3 — Development Orchestration Script
 * 
 * Smart dev server orchestration that:
 * - Starts all services in dependency order
 * - Watches for workspace changes
 * - Provides unified logs with service tagging
 * - Handles graceful shutdown
 * 
 * Usage:
 *   node scripts/dev.mjs
 *   pnpm dev:orchestrated    (if added to package.json)
 * 
 * Configuration:
 *   - Edit SERVICE_CONFIG below to customize service startup order and ports
 *   - Services marked with 'critical: true' will halt on failure
 */

import { execSync, spawn } from 'child_process';
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
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
};

// Map of service names to ANSI colors for tagged output
const serviceColors = {
  'web': colors.cyan,
  'api': colors.blue,
  'worker': colors.magenta,
  'default': colors.yellow,
};

// ============================================================================
// Service Configuration
// ============================================================================

const SERVICE_CONFIG = [
  {
    name: 'web',
    cwd: 'apps/web',
    command: 'pnpm dev',
    port: 3000,
    readyPattern: 'ready - started server on',
    critical: false,
  },
  {
    name: 'api',
    cwd: 'apps/api',
    command: 'pnpm dev',
    port: 8000,
    readyPattern: 'Uvicorn running on',
    critical: true,
  },
  {
    name: 'worker',
    cwd: 'apps/worker',
    command: 'pnpm dev',
    port: null,
    readyPattern: 'Worker ready',
    critical: false,
  },
];

// ============================================================================
// Logging Utilities
// ============================================================================

const log = {
  header: (msg) => {
    console.log(`\n${colors.bold}${colors.cyan}▶ ${msg}${colors.reset}`);
  },
  success: (msg) => console.log(`${colors.green}✓ ${msg}${colors.reset}`),
  warn: (msg) => console.log(`${colors.yellow}⚠ ${msg}${colors.reset}`),
  error: (msg) => console.log(`${colors.red}✗ ${msg}${colors.reset}`),
  info: (msg) => console.log(`${colors.blue}ℹ ${msg}${colors.reset}`),
  service: (serviceName, message) => {
    const color = serviceColors[serviceName] || serviceColors.default;
    console.log(`${color}[${serviceName}]${colors.reset} ${message}`);
  },
};

// ============================================================================
// Service Management
// ============================================================================

class ServiceManager {
  constructor() {
    this.processes = new Map();
    this.ready = new Map();
    this.failed = new Map();
  }

  start(service) {
    return new Promise((resolve) => {
      const serviceDir = resolve(rootDir, service.cwd);
      log.info(`Starting ${service.name} from ${serviceDir}...`);

      const proc = spawn('sh', ['-c', service.command], {
        cwd: serviceDir,
        stdio: 'pipe',
        shell: '/bin/sh',
      });

      this.processes.set(service.name, proc);

      let isReady = false;

      // Handle stdout
      if (proc.stdout) {
        proc.stdout.on('data', (data) => {
          const message = data.toString().trim();
          if (message) {
            log.service(service.name, message);
          }

          // Check if service is ready
          if (!isReady && service.readyPattern && message.includes(service.readyPattern)) {
            isReady = true;
            this.ready.set(service.name, true);
            log.success(`${service.name} ready${service.port ? ` (http://localhost:${service.port})` : ''}`);
            resolve(true);
          }
        });
      }

      // Handle stderr
      if (proc.stderr) {
        proc.stderr.on('data', (data) => {
          const message = data.toString().trim();
          if (message) {
            log.service(service.name, `${colors.red}${message}${colors.reset}`);
          }
        });
      }

      // Handle process exit
      proc.on('exit', (code) => {
        if (code !== 0) {
          this.failed.set(service.name, true);
          log.error(`${service.name} exited with code ${code}`);
          if (service.critical) {
            log.error(`Critical service ${service.name} failed. Shutting down.`);
            this.shutdown();
          }
        }
      });

      // Timeout: if service doesn't report ready after 30s, assume it's started
      setTimeout(() => {
        if (!isReady) {
          this.ready.set(service.name, true);
          log.warn(`${service.name} startup timeout (assumed ready)`);
          resolve(true);
        }
      }, 30000);
    });
  }

  shutdown() {
    log.header('Shutting down services');
    for (const [serviceName, proc] of this.processes) {
      try {
        log.info(`Stopping ${serviceName}...`);
        proc.kill('SIGTERM');
      } catch (error) {
        log.warn(`Error stopping ${serviceName}: ${error.message}`);
      }
    }
    process.exit(0);
  }
}

// ============================================================================
// Main Orchestration
// ============================================================================

async function orchestrate() {
  log.header('Sonic AI V3 — Development Server Orchestration');
  console.log(`Root directory: ${rootDir}\n`);

  const manager = new ServiceManager();

  // Handle graceful shutdown
  process.on('SIGINT', () => {
    console.log(); // newline after ^C
    manager.shutdown();
  });

  process.on('SIGTERM', () => {
    manager.shutdown();
  });

  // Start services sequentially
  for (const service of SERVICE_CONFIG) {
    try {
      await manager.start(service);
    } catch (error) {
      log.error(`Failed to start ${service.name}: ${error.message}`);
      if (service.critical) {
        manager.shutdown();
      }
    }
  }

  // Print final summary
  console.log();
  log.header('Development Environment Ready');
  console.log();
  for (const service of SERVICE_CONFIG) {
    const status = manager.failed.has(service.name) ? `${colors.red}failed${colors.reset}` : `${colors.green}running${colors.reset}`;
    const port = service.port ? ` (${service.port})` : '';
    console.log(`  ${service.name}${port}: ${status}`);
  }
  console.log();
  log.info('Press Ctrl+C to stop all services');
  console.log();
}

// ============================================================================
// Execute
// ============================================================================

orchestrate().catch((error) => {
  log.error(`Unexpected error: ${error.message}`);
  process.exit(1);
});
