const fs = require('node:fs');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');

const { REPO_ROOT } = require('./env');

function buildPermissionArgs(mode) {
  if (mode === 'yolo') {
    return ['--yolo'];
  }

  return ['--allow-all-tools', '--allow-all-paths', '--no-ask-user'];
}

function resolveCommand(command) {
  if (path.isAbsolute(command) || command.includes(path.sep)) {
    return command;
  }

  if (process.platform !== 'win32') {
    return command;
  }

  try {
    const result = spawnSync('where.exe', [command], {
      encoding: 'utf8',
      shell: false
    });

    if (result.status !== 0 || !result.stdout) {
      return command;
    }

    const candidates = result.stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);

    return candidates.find((line) => line.toLowerCase().endsWith('.cmd')) || candidates[0] || command;
  } catch {
    return command;
  }
}

function commandExists(command) {
  if (!command) {
    return false;
  }

  if (path.isAbsolute(command) || command.includes(path.sep)) {
    return fs.existsSync(command);
  }

  const probeCommand = process.platform === 'win32' ? 'where.exe' : 'which';
  const probeResult = spawnSync(probeCommand, [command], {
    encoding: 'utf8',
    shell: false
  });

  return probeResult.status === 0;
}

function resolveLaunch(command) {
  if (process.platform === 'win32' && /copilot\.cmd$/i.test(command)) {
    const loaderPath = path.join(path.dirname(command), 'node_modules', '@github', 'copilot', 'npm-loader.js');
    if (fs.existsSync(loaderPath)) {
      return {
        command: process.execPath,
        prefixArgs: [loaderPath],
        shell: false
      };
    }
  }

  return {
    command,
    prefixArgs: [],
    shell: process.platform === 'win32' && /\.(cmd|bat)$/i.test(command)
  };
}

function runCopilot(prompt, options) {
  const launch = resolveLaunch(options.copilotBin);
  const args = [...launch.prefixArgs, '-p', prompt, '-s', '--output-format', 'text', '--stream', 'off'];

  if (options.model) {
    args.push('--model', options.model);
  }

  args.push(...buildPermissionArgs(options.permissionMode));

  return new Promise((resolve, reject) => {
    const child = spawn(launch.command, args, {
      cwd: REPO_ROOT,
      env: process.env,
      shell: launch.shell,
      stdio: ['ignore', 'pipe', 'pipe']
    });

    let stdout = '';
    let stderr = '';
    let settled = false;

    const finish = (callback, value) => {
      if (settled) {
        return;
      }

      settled = true;
      callback(value);
    };

    const timeoutHandle = setTimeout(() => {
      child.kill();
      finish(reject, new Error(`Copilot timed out after ${options.timeoutMs}ms.`));
    }, options.timeoutMs);

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    child.on('error', (error) => {
      clearTimeout(timeoutHandle);
      finish(reject, new Error(`Failed to start Copilot: ${error.message}`));
    });

    child.on('close', (code, signal) => {
      clearTimeout(timeoutHandle);
      const cleanedStdout = stdout.trim();
      const cleanedStderr = stderr.trim();

      if (code === 0) {
        finish(resolve, cleanedStdout || cleanedStderr || 'No output.');
        return;
      }

      const parts = ['Copilot command failed.'];
      if (code !== null) {
        parts.push(`Exit code: ${code}`);
      }
      if (signal) {
        parts.push(`Signal: ${signal}`);
      }
      if (cleanedStdout) {
        parts.push('', 'stdout:', cleanedStdout);
      }
      if (cleanedStderr) {
        parts.push('', 'stderr:', cleanedStderr);
      }

      finish(reject, new Error(parts.join('\n')));
    });
  });
}

module.exports = {
  buildPermissionArgs,
  commandExists,
  resolveCommand,
  resolveLaunch,
  runCopilot
};