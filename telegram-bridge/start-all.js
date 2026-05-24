const path = require('node:path');
const fs = require('node:fs');
const { spawn } = require('node:child_process');

const { REPO_ROOT, loadServiceRegistry } = require('./lib/env');

const FALLBACK_SERVICES = [
  { name: 'gateway', entrypoint: 'telegram-bridge/gateway.js', autostart: true },
  { name: 'telegram-bridge', entrypoint: 'telegram-bridge/bridge.js', autostart: true },
  { name: 'scheduler', entrypoint: 'telegram-bridge/scheduler.js', autostart: true },
  { name: 'health-probe', entrypoint: 'telegram-bridge/health-probe.js', autostart: true }
];

function resolveServiceList() {
  const { services } = loadServiceRegistry();
  const active = services.filter((entry) => entry && entry.autostart && entry.entrypoint);

  if (active.length === 0) {
    console.warn('Registry has no autostart services — falling back to built-in service list.');
    return FALLBACK_SERVICES;
  }

  return active;
}

const children = [];
let shuttingDown = false;

function startProcess(label, entrypointRelative) {
  const entrypoint = path.resolve(REPO_ROOT, entrypointRelative);

  if (!fs.existsSync(entrypoint)) {
    console.error(`Skipping "${label}": entrypoint not found at ${entrypoint}`);
    return null;
  }

  const child = spawn(process.execPath, [entrypoint], {
    cwd: __dirname,
    stdio: 'inherit',
    shell: false
  });

  children.push({ label, child });

  child.on('exit', (code, signal) => {
    if (shuttingDown) {
      return;
    }

    shuttingDown = true;
    for (const other of children) {
      if (other.child !== child && !other.child.killed) {
        other.child.kill();
      }
    }

    if (signal) {
      console.error(`${label} exited with signal ${signal}`);
      process.exitCode = 1;
      return;
    }

    process.exitCode = code || 0;
  });

  return child;
}

for (const service of resolveServiceList()) {
  startProcess(service.name, service.entrypoint);
}

if (children.length === 0) {
  console.error('No services started. Aborting.');
  process.exit(1);
}

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    if (shuttingDown) {
      return;
    }

    shuttingDown = true;
    for (const { child } of children) {
      if (!child.killed) {
        child.kill(signal);
      }
    }
  });
}
