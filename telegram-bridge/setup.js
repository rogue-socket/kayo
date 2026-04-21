const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const readline = require('node:readline/promises');
const { spawn } = require('node:child_process');

const { BRIDGE_DIR, ENV_PATH, JOBS_PATH, STATE_DIR, loadEnvValues } = require('./lib/env');
const { commandExists, resolveCommand, runCopilot } = require('./lib/copilot-cli');
const { ensureJobsFile } = require('./lib/scheduler/job-store');

function parseArgs(argv) {
  return {
    setupOnly: argv.includes('--setup-only') || argv.includes('--no-start')
  };
}

function assertNodeVersion() {
  const [majorVersion] = process.versions.node.split('.').map(Number);
  if (majorVersion < 18) {
    throw new Error(`Node.js 18 or newer is required. Current version: ${process.versions.node}`);
  }
}

function defaultTimezone() {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
}

function buildEnvContent(values) {
  const lines = [
    `TELEGRAM_BOT_TOKEN=${values.telegramBotToken}`,
    `TELEGRAM_ALLOWED_CHAT_IDS=${values.telegramAllowedChatIds}`,
    `TELEGRAM_POLL_TIMEOUT_SECONDS=${values.telegramPollTimeoutSeconds}`,
    `GATEWAY_HOST=${values.gatewayHost}`,
    `GATEWAY_PORT=${values.gatewayPort}`,
    `GATEWAY_SHARED_TOKEN=${values.gatewaySharedToken}`,
    `COPILOT_BIN=${values.copilotBin}`,
    `COPILOT_TIMEOUT_MS=${values.copilotTimeoutMs}`,
    `COPILOT_HISTORY_TURNS=${values.copilotHistoryTurns}`,
    `COPILOT_HISTORY_CHARS=${values.copilotHistoryChars}`,
    `COPILOT_CONTEXT_MODE=${values.copilotContextMode}`,
    'COPILOT_PERMISSION_MODE=yolo',
    `COPILOT_MODEL=${values.copilotModel}`,
    `FILE_ACCESS_ROOTS=${values.fileAccessRoots}`,
    `FILE_ACCESS_MAX_BYTES=${values.fileAccessMaxBytes}`,
    `DEFAULT_TIMEZONE=${values.defaultTimezone}`,
    `SCHEDULER_POLL_INTERVAL_MS=${values.schedulerPollIntervalMs}`
  ];

  return `${lines.join('\n')}\n`;
}

async function promptValue(rl, label, options = {}) {
  const suffix = options.defaultValue ? ` [${options.defaultValue}]` : '';

  while (true) {
    const answer = (await rl.question(`${label}${suffix}: `)).trim();
    const value = answer || options.defaultValue || '';
    if (!value && options.required) {
      console.log('This value is required.');
      continue;
    }

    return options.normalize ? options.normalize(value) : value;
  }
}

async function ensureCopilotBin(rl, existingValue) {
  let candidate = existingValue || 'copilot';

  while (true) {
    if (commandExists(candidate) || fs.existsSync(candidate)) {
      return candidate;
    }

    candidate = await promptValue(rl, 'Copilot CLI path', {
      required: true,
      defaultValue: candidate
    });
  }
}

async function runCommand(command, args, cwd) {
  await new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      stdio: 'inherit',
      shell: false,
      env: process.env
    });

    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(`${command} ${args.join(' ')} failed with exit code ${code}.`));
    });
  });
}

async function verifyCopilot(copilotBin) {
  console.log('Running Copilot smoke test...');
  await runCopilot('Reply with OK only.', {
    copilotBin: resolveCommand(copilotBin),
    timeoutMs: 30000,
    permissionMode: 'yolo',
    model: ''
  });
}

async function main() {
  assertNodeVersion();

  const args = parseArgs(process.argv.slice(2));
  const existingEnv = loadEnvValues(ENV_PATH);
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  try {
    console.log('Kayo setup');
    console.log(`Repo: ${path.resolve(BRIDGE_DIR, '..')}`);
    console.log('This will install bridge dependencies, write telegram-bridge/.env, initialize the scheduler store, and start the local services.');
    console.log('');

    const copilotBin = await ensureCopilotBin(rl, existingEnv.COPILOT_BIN || 'copilot');
    const telegramBotToken = await promptValue(rl, 'Telegram bot token', {
      required: true,
      defaultValue: existingEnv.TELEGRAM_BOT_TOKEN || ''
    });
    const telegramAllowedChatIds = await promptValue(rl, 'Allowed Telegram chat IDs (comma/space/newline-separated)', {
      required: true,
      defaultValue: existingEnv.TELEGRAM_ALLOWED_CHAT_IDS || ''
    });
    const gatewaySharedToken = await promptValue(rl, 'Gateway shared token', {
      required: true,
      defaultValue: existingEnv.GATEWAY_SHARED_TOKEN || crypto.randomBytes(24).toString('hex')
    });
    const fileAccessRoots = await promptValue(rl, 'File roots (comma-separated alias=path entries)', {
      required: true,
      defaultValue: existingEnv.FILE_ACCESS_ROOTS || 'repo=.'
    });
    const timezone = await promptValue(rl, 'Default timezone', {
      required: true,
      defaultValue: existingEnv.DEFAULT_TIMEZONE || defaultTimezone()
    });

    const envValues = {
      telegramBotToken,
      telegramAllowedChatIds,
      telegramPollTimeoutSeconds: existingEnv.TELEGRAM_POLL_TIMEOUT_SECONDS || '30',
      gatewayHost: existingEnv.GATEWAY_HOST || '127.0.0.1',
      gatewayPort: existingEnv.GATEWAY_PORT || '8787',
      gatewaySharedToken,
      copilotBin,
      copilotTimeoutMs: existingEnv.COPILOT_TIMEOUT_MS || '600000',
      copilotHistoryTurns: existingEnv.COPILOT_HISTORY_TURNS || '6',
      copilotHistoryChars: existingEnv.COPILOT_HISTORY_CHARS || '6000',
      copilotContextMode: existingEnv.COPILOT_CONTEXT_MODE || 'native-session',
      copilotModel: existingEnv.COPILOT_MODEL || '',
      fileAccessRoots,
      fileAccessMaxBytes: existingEnv.FILE_ACCESS_MAX_BYTES || '20971520',
      defaultTimezone: timezone,
      schedulerPollIntervalMs: existingEnv.SCHEDULER_POLL_INTERVAL_MS || '15000'
    };

    fs.mkdirSync(STATE_DIR, { recursive: true });
    fs.writeFileSync(ENV_PATH, buildEnvContent(envValues));
    ensureJobsFile(JOBS_PATH);

    console.log(`Wrote ${ENV_PATH}`);
    await verifyCopilot(copilotBin);

    const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
    if (!commandExists('npm')) {
      throw new Error('npm was not found on PATH. Install Node.js with npm and rerun setup.');
    }

    console.log('Installing telegram bridge dependencies...');
    await runCommand(npmCommand, ['install'], BRIDGE_DIR);

    if (args.setupOnly) {
      console.log('Setup complete. Start the services with:');
      console.log('npm start');
      return;
    }

    console.log('Starting gateway, Telegram bridge, and scheduler...');
    await runCommand(npmCommand, ['start'], BRIDGE_DIR);
  } finally {
    rl.close();
  }
}

main().catch((error) => {
  console.error(error.message || error);
  process.exitCode = 1;
});
