const fs = require('node:fs');
const path = require('node:path');

const BRIDGE_DIR = path.resolve(__dirname, '..');
const REPO_ROOT = path.resolve(BRIDGE_DIR, '..');
const ENV_PATH = path.join(BRIDGE_DIR, '.env');
const STATE_DIR = path.join(BRIDGE_DIR, 'runtime');
const STATE_PATH = path.join(STATE_DIR, 'state.json');
const SESSIONS_DIR = path.join(STATE_DIR, 'sessions');
const JOBS_PATH = path.join(STATE_DIR, 'jobs.json');

function parseEnvContent(content) {
  const values = {};

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) {
      continue;
    }

    const equalsIndex = line.indexOf('=');
    if (equalsIndex === -1) {
      continue;
    }

    const key = line.slice(0, equalsIndex).trim();
    let value = line.slice(equalsIndex + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }

    values[key] = value;
  }

  return values;
}

function loadEnvValues(filePath = ENV_PATH) {
  if (!fs.existsSync(filePath)) {
    return {};
  }

  return parseEnvContent(fs.readFileSync(filePath, 'utf8'));
}

function applyEnvValues(values) {
  for (const [key, value] of Object.entries(values)) {
    if (!(key in process.env)) {
      process.env[key] = value;
    }
  }
}

function readEnvFile(filePath = ENV_PATH) {
  const values = loadEnvValues(filePath);
  applyEnvValues(values);
  return values;
}

function splitList(value) {
  return (value || '')
    .split(/\r?\n|,/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseAllowedChatIds(value) {
  return new Set(splitList(value));
}

function coerceNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function resolveConfiguredPath(rawPath) {
  const candidate = rawPath && path.isAbsolute(rawPath)
    ? rawPath
    : path.resolve(REPO_ROOT, rawPath || '.');

  try {
    return fs.realpathSync(candidate);
  } catch {
    return path.resolve(candidate);
  }
}

function makeUniqueRootId(baseId, usedIds) {
  let counter = 1;
  let candidate = baseId;

  while (usedIds.has(candidate)) {
    counter += 1;
    candidate = `${baseId}${counter}`;
  }

  usedIds.add(candidate);
  return candidate;
}

function sanitizeRootId(rawValue, fallback) {
  const candidate = (rawValue || fallback)
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, '-')
    .replace(/^-+|-+$/g, '');

  return candidate || fallback;
}

function parseFileRootEntries(value) {
  const entries = splitList(value);
  const configuredEntries = entries.length > 0 ? entries : ['repo=.'];
  const usedIds = new Set();

  return configuredEntries.map((entry, index) => {
    const equalsIndex = entry.indexOf('=');
    const hasExplicitId = equalsIndex > 0;
    const rawId = hasExplicitId ? entry.slice(0, equalsIndex).trim() : '';
    const rawPath = hasExplicitId ? entry.slice(equalsIndex + 1).trim() : entry.trim();
    const baseId = sanitizeRootId(rawId, index === 0 ? 'repo' : `root${index + 1}`);
    const id = makeUniqueRootId(baseId, usedIds);

    return {
      id,
      rawPath: rawPath || '.',
      path: resolveConfiguredPath(rawPath || '.'),
      displayPath: rawPath || '.'
    };
  });
}

function loadConfig() {
  readEnvFile(ENV_PATH);

  const gatewayHost = process.env.GATEWAY_HOST || '127.0.0.1';
  const gatewayPort = coerceNumber(process.env.GATEWAY_PORT, 8787);

  return {
    bridgeDir: BRIDGE_DIR,
    repoRoot: REPO_ROOT,
    envPath: ENV_PATH,
    stateDir: STATE_DIR,
    statePath: STATE_PATH,
    sessionsDir: SESSIONS_DIR,
    jobsPath: JOBS_PATH,
    telegramToken: process.env.TELEGRAM_BOT_TOKEN || '',
    allowedChatIds: parseAllowedChatIds(process.env.TELEGRAM_ALLOWED_CHAT_IDS),
    pollTimeoutSeconds: coerceNumber(process.env.TELEGRAM_POLL_TIMEOUT_SECONDS, 30),
    gatewayHost,
    gatewayPort,
    gatewayBaseUrl: `http://${gatewayHost}:${gatewayPort}`,
    gatewaySharedToken: process.env.GATEWAY_SHARED_TOKEN || '',
    copilotBin: process.env.COPILOT_BIN || 'copilot',
    copilotTimeoutMs: coerceNumber(process.env.COPILOT_TIMEOUT_MS, 600000),
    copilotHistoryTurns: coerceNumber(process.env.COPILOT_HISTORY_TURNS, 6),
    copilotHistoryChars: coerceNumber(process.env.COPILOT_HISTORY_CHARS, 6000),
    copilotPermissionMode: 'yolo',
    copilotModel: (process.env.COPILOT_MODEL || '').trim(),
    fileRoots: parseFileRootEntries(process.env.FILE_ACCESS_ROOTS),
    fileAccessMaxBytes: coerceNumber(process.env.FILE_ACCESS_MAX_BYTES, 20 * 1024 * 1024),
    defaultTimezone: (process.env.DEFAULT_TIMEZONE || Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC').trim(),
    schedulerPollIntervalMs: Math.max(1000, coerceNumber(process.env.SCHEDULER_POLL_INTERVAL_MS, 15000))
  };
}

module.exports = {
  BRIDGE_DIR,
  REPO_ROOT,
  ENV_PATH,
  STATE_DIR,
  STATE_PATH,
  SESSIONS_DIR,
  JOBS_PATH,
  applyEnvValues,
  loadConfig,
  loadEnvValues,
  parseAllowedChatIds,
  parseEnvContent,
  parseFileRootEntries,
  readEnvFile,
  resolveConfiguredPath,
  splitList
};