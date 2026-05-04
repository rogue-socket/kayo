const fs = require('node:fs');

const { loadConfig } = require('./lib/env');
const { getGatewayStatus, promptGateway, resetGatewaySession } = require('./lib/transport/gateway-client');
const { sendText } = require('./lib/transport/telegram-api');

const config = loadConfig();
const probeConfig = config.healthProbe;

const ALERT_CLASSES = [
  'auth',
  'rate-limit',
  'model',
  'network',
  'bridge-stalled',
  'gateway-down',
  'scheduler-error',
  'unknown'
];

const TIER2_PROMPT = 'Reply with the single word: ok';
const TIER2_REPLY_RE = /^[●\s]*ok[\s.!]*$/i;
const BOOT_TIER1_DELAY_MS = 10_000;
const BOOT_TIER2_DELAY_MS = 30_000;

function nowIso() {
  return new Date().toISOString();
}

function emptyAlerts() {
  const alerts = {};
  for (const cls of ALERT_CLASSES) {
    alerts[cls] = { lastSentAt: null, count: 0 };
  }
  return alerts;
}

function loadState() {
  if (!fs.existsSync(probeConfig.statePath)) {
    return {
      lastTier1At: null,
      lastTier2At: null,
      lastResult: null,
      lastError: null,
      lastErrorClass: null,
      lastSeenSchedulerErrorAt: null,
      alerts: emptyAlerts()
    };
  }

  try {
    const parsed = JSON.parse(fs.readFileSync(probeConfig.statePath, 'utf8'));
    const alerts = parsed.alerts && typeof parsed.alerts === 'object' ? parsed.alerts : {};
    for (const cls of ALERT_CLASSES) {
      if (!alerts[cls]) alerts[cls] = { lastSentAt: null, count: 0 };
    }
    return {
      lastTier1At: parsed.lastTier1At || null,
      lastTier2At: parsed.lastTier2At || null,
      lastResult: parsed.lastResult || null,
      lastError: parsed.lastError || null,
      lastErrorClass: parsed.lastErrorClass || null,
      lastSeenSchedulerErrorAt: parsed.lastSeenSchedulerErrorAt || null,
      alerts
    };
  } catch {
    return loadState.default || {
      lastTier1At: null,
      lastTier2At: null,
      lastResult: null,
      lastError: null,
      lastErrorClass: null,
      lastSeenSchedulerErrorAt: null,
      alerts: emptyAlerts()
    };
  }
}

function saveState(state) {
  fs.mkdirSync(config.stateDir, { recursive: true });
  fs.writeFileSync(probeConfig.statePath, JSON.stringify(state, null, 2));
}

function summarizeError(message) {
  const text = String(message || 'unknown');
  const firstLine = text.split('\n').map((l) => l.trim()).find((l) => l.length > 0) || 'unknown';
  return firstLine.length > 160 ? `${firstLine.slice(0, 157)}...` : firstLine;
}

function classifyError(message) {
  const text = String(message || '').toLowerCase();
  if (/no authentication information|unauthorized|\b401\b/.test(text)) return 'auth';
  if (/rate limit|quota|\b429\b|too many requests/.test(text)) return 'rate-limit';
  if (/model not found|unknown model|invalid model/.test(text)) return 'model';
  if (/timed out|etimedout|econnrefused|network|fetch failed/.test(text)) return 'network';
  return 'unknown';
}

function pickAlertChatId() {
  if (probeConfig.alertChatId) return probeConfig.alertChatId;
  const first = config.allowedChatIds.values().next().value;
  return first || '';
}

function formatRelative(iso) {
  if (!iso) return 'never';
  const ms = Date.now() - new Date(iso).getTime();
  if (Number.isNaN(ms) || ms < 0) return iso;
  const minutes = Math.round(ms / 60000);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return `${days}d ago`;
}

function suggestionFor(cls) {
  switch (cls) {
    case 'auth': return 'Re-run /login on the npm copilot CLI in telegram-bridge/.';
    case 'rate-limit': return 'Wait for the upstream quota window to reset.';
    case 'model': return 'Check COPILOT_MODEL in telegram-bridge/.env.';
    case 'network': return 'Check connectivity / gateway process.';
    case 'bridge-stalled': return 'Restart kayo-bot.service (bridge has stopped polling Telegram).';
    case 'gateway-down': return 'Check gateway.js logs via journalctl --user -u kayo-bot.';
    case 'scheduler-error': return 'Inspect runtime/jobs.json lastError; investigate failing job.';
    default: return 'Inspect journalctl --user -u kayo-bot for stack traces.';
  }
}

async function maybeAlert(state, cls, errorMessage, lastOkAt) {
  const alertSlot = state.alerts[cls] || { lastSentAt: null, count: 0 };
  const cooldownMs = probeConfig.alertCooldownMs;
  const sinceLast = alertSlot.lastSentAt ? Date.now() - new Date(alertSlot.lastSentAt).getTime() : Infinity;

  if (sinceLast < cooldownMs) {
    console.log(`[health-probe] suppressed alert (class=${cls}, sinceLast=${Math.round(sinceLast / 60000)}m < cooldown)`);
    return;
  }

  const chatId = pickAlertChatId();
  if (!chatId || !config.telegramToken) {
    console.error(`[health-probe] cannot send alert: no chat id or telegram token configured`);
    return;
  }

  const lines = [
    `🚨 kayo health probe: ${cls}`,
    `Error: ${summarizeError(errorMessage)}`,
    `Suggested: ${suggestionFor(cls)}`,
    `Last successful probe: ${lastOkAt ? `${lastOkAt} (${formatRelative(lastOkAt)})` : 'never'}.`
  ];

  try {
    await sendText(config.telegramToken, chatId, lines.join('\n'));
    alertSlot.lastSentAt = nowIso();
    alertSlot.count = (alertSlot.count || 0) + 1;
    state.alerts[cls] = alertSlot;
    console.log(`[health-probe] alert sent (class=${cls})`);
  } catch (error) {
    console.error(`[health-probe] failed to send alert: ${error.message}`);
  }
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function checkGateway(state) {
  try {
    await getGatewayStatus(config);
    return null;
  } catch (error) {
    return { class: 'gateway-down', message: error.message };
  }
}

function checkBridge() {
  try {
    if (!fs.existsSync(config.statePath)) {
      return { class: 'bridge-stalled', message: 'runtime/state.json missing' };
    }
    const raw = JSON.parse(fs.readFileSync(config.statePath, 'utf8'));
    const lastPollAt = raw.lastPollAt ? new Date(raw.lastPollAt).getTime() : 0;
    const ageMs = Date.now() - lastPollAt;
    if (!lastPollAt) {
      return null;
    }
    if (ageMs > probeConfig.bridgeStaleMs) {
      return { class: 'bridge-stalled', message: `bridge has not polled for ${Math.round(ageMs / 60000)}m` };
    }
    return null;
  } catch (error) {
    return { class: 'bridge-stalled', message: `state.json unreadable: ${error.message}` };
  }
}

function checkScheduler(state) {
  if (!fs.existsSync(config.jobsPath)) return null;

  let document;
  try {
    document = JSON.parse(fs.readFileSync(config.jobsPath, 'utf8'));
  } catch {
    return null;
  }

  const jobs = Array.isArray(document.jobs) ? document.jobs : [];
  let freshest = null;
  let freshestJob = null;
  for (const job of jobs) {
    if (job && job.lastStatus === 'error' && job.lastRunAt) {
      if (!freshest || new Date(job.lastRunAt).getTime() > new Date(freshest).getTime()) {
        freshest = job.lastRunAt;
        freshestJob = job;
      }
    }
  }

  if (!freshest) return null;

  const lastSeen = state.lastSeenSchedulerErrorAt ? new Date(state.lastSeenSchedulerErrorAt).getTime() : 0;
  if (new Date(freshest).getTime() <= lastSeen) {
    return null;
  }

  state.lastSeenSchedulerErrorAt = freshest;
  return {
    class: 'scheduler-error',
    message: `Job ${freshestJob.id} failed at ${freshest}: ${(freshestJob.lastError || '').toString().slice(0, 160)}`
  };
}

async function runTier1(state) {
  state.lastTier1At = nowIso();
  const failures = [];

  const gatewayResult = await checkGateway(state);
  if (gatewayResult) failures.push(gatewayResult);

  const bridgeResult = checkBridge();
  if (bridgeResult) failures.push(bridgeResult);

  const schedulerResult = checkScheduler(state);
  if (schedulerResult) failures.push(schedulerResult);

  if (failures.length === 0) {
    console.log('[health-probe] tier-1 ok');
    return;
  }

  for (const failure of failures) {
    console.error(`[health-probe] tier-1 failure: ${failure.class} — ${failure.message}`);
    await maybeAlert(state, failure.class, failure.message, state.lastTier2At);
  }
}

async function runTier2(state) {
  state.lastTier2At = nowIso();

  try {
    await resetGatewaySession(config, probeConfig.sessionId);
  } catch (error) {
    const cls = classifyError(error.message);
    state.lastResult = 'error';
    state.lastError = error.message;
    state.lastErrorClass = cls;
    console.error(`[health-probe] tier-2 reset failed: ${error.message}`);
    await maybeAlert(state, cls, error.message, null);
    return;
  }

  let result;
  try {
    result = await promptGateway(config, {
      sessionId: probeConfig.sessionId,
      prompt: TIER2_PROMPT,
      context: { channel: 'health-probe' },
      bare: true
    });
  } catch (error) {
    const cls = classifyError(error.message);
    state.lastResult = 'error';
    state.lastError = error.message;
    state.lastErrorClass = cls;
    console.error(`[health-probe] tier-2 prompt failed: ${error.message}`);
    await maybeAlert(state, cls, error.message, state.lastResult === 'ok' ? state.lastTier2At : null);
    return;
  }

  const stripped = String(result.reply || '').trim();
  if (TIER2_REPLY_RE.test(stripped)) {
    state.lastResult = 'ok';
    state.lastError = null;
    state.lastErrorClass = null;
    console.log(`[health-probe] tier-2 ok (elapsedMs=${result.elapsedMs})`);
    return;
  }

  const cls = 'unknown';
  const errorMessage = `Unexpected probe reply: ${stripped.slice(0, 200)}`;
  state.lastResult = 'error';
  state.lastError = errorMessage;
  state.lastErrorClass = cls;
  console.error(`[health-probe] tier-2 unexpected reply: ${stripped.slice(0, 200)}`);
  await maybeAlert(state, cls, errorMessage, null);
}

async function withState(fn) {
  const state = loadState();
  try {
    await fn(state);
  } finally {
    try {
      saveState(state);
    } catch (error) {
      console.error(`[health-probe] failed to persist state: ${error.message}`);
    }
  }
}

async function main() {
  if (!probeConfig.enabled) {
    console.log('[health-probe] disabled via HEALTH_PROBE_ENABLED=false');
    return;
  }

  const chatId = pickAlertChatId();
  console.log(`[health-probe] started (tier1=${probeConfig.tier1IntervalMs}ms tier2=${probeConfig.tier2IntervalMs}ms alertChat=${chatId || '(none)'})`);

  setTimeout(() => { withState(runTier1).catch((err) => console.error(err)); }, BOOT_TIER1_DELAY_MS);
  if (probeConfig.tier2IntervalMs > 0) {
    setTimeout(() => { withState(runTier2).catch((err) => console.error(err)); }, BOOT_TIER2_DELAY_MS);
  }

  setInterval(() => { withState(runTier1).catch((err) => console.error(err)); }, probeConfig.tier1IntervalMs);
  if (probeConfig.tier2IntervalMs > 0) {
    setInterval(() => { withState(runTier2).catch((err) => console.error(err)); }, probeConfig.tier2IntervalMs);
  }
}

main().catch((error) => {
  console.error(`[health-probe] fatal: ${error.message}`);
  process.exitCode = 1;
});
