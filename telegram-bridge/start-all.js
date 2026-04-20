const path = require('node:path');
const { spawn } = require('node:child_process');

const children = [];
let shuttingDown = false;

function startProcess(label, scriptName) {
  const child = spawn(process.execPath, [path.join(__dirname, scriptName)], {
    cwd: __dirname,
    stdio: 'inherit',
    shell: false
  });

  children.push(child);

  child.on('exit', (code, signal) => {
    if (shuttingDown) {
      return;
    }

    shuttingDown = true;
    for (const otherChild of children) {
      if (otherChild !== child && !otherChild.killed) {
        otherChild.kill();
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

startProcess('gateway', 'gateway.js');
startProcess('telegram bridge', 'bridge.js');

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    if (shuttingDown) {
      return;
    }

    shuttingDown = true;
    for (const child of children) {
      if (!child.killed) {
        child.kill(signal);
      }
    }
  });
}