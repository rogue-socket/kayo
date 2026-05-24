const fs = require('node:fs');
const crypto = require('node:crypto');
const path = require('node:path');

const { loadConfig } = require('./lib/env');
const { getFileForSend, listDirectory, listRoots } = require('./lib/file-access');
const {
  cancelGateway,
  getGatewayModel,
  getGatewayStatus,
  resetGatewaySession,
  setGatewayModel
} = require('./lib/transport/gateway-client');
const { downloadFileToPath, getFile, getMe, getUpdates, sendDocument, sendText, sendTyping } = require('./lib/transport/telegram-api');
const { streamReplyToTelegram } = require('./lib/streaming-reply');
const { createLogger, EVENTS_PATH } = require('./lib/logger');

const config = loadConfig();
const log = createLogger('bridge');

const ATTACHMENTS_DIR = path.join(config.stateDir, 'attachments');
const DEFAULT_IMAGE_PROMPT =
  "I sent an image with no caption. Look at it, tell me what's in it, and decide what to do — capture to vault, log as expense, or just describe.";
const ATTACHABLE_MIME_PREFIXES = ['image/'];
const ATTACHABLE_MIME_EXACT = new Set(['application/pdf']);

function isAttachableMime(mime) {
  if (!mime || typeof mime !== 'string') return false;
  if (ATTACHABLE_MIME_EXACT.has(mime)) return true;
  return ATTACHABLE_MIME_PREFIXES.some((prefix) => mime.startsWith(prefix));
}

function pickLargestPhoto(photoArray) {
  if (!Array.isArray(photoArray) || photoArray.length === 0) return null;
  return photoArray.reduce((largest, candidate) => {
    if (!candidate || typeof candidate.file_id !== 'string') return largest;
    if (!largest) return candidate;
    return (candidate.width || 0) > (largest.width || 0) ? candidate : largest;
  }, null);
}

async function downloadTelegramAttachment(token, fileId, hintExt) {
  const fileMeta = await getFile(token, fileId);
  if (!fileMeta || typeof fileMeta.file_path !== 'string') {
    throw new Error('Telegram getFile returned no file_path');
  }
  const ext = path.extname(fileMeta.file_path) || hintExt || '';
  const localName = `${Date.now()}-${crypto.randomBytes(6).toString('hex')}${ext}`;
  const localPath = path.join(ATTACHMENTS_DIR, localName);
  await downloadFileToPath(token, fileMeta.file_path, localPath);
  return localPath;
}

async function extractMessageInput(message) {
  const token = config.telegramToken;

  if (typeof message.text === 'string') {
    return { text: message.text.trim(), attachments: [] };
  }

  if (Array.isArray(message.photo) && message.photo.length > 0) {
    const largest = pickLargestPhoto(message.photo);
    if (!largest) return null;
    const localPath = await downloadTelegramAttachment(token, largest.file_id, '.jpg');
    const caption = (message.caption || '').trim();
    return {
      text: caption || DEFAULT_IMAGE_PROMPT,
      attachments: [localPath]
    };
  }

  if (message.document && typeof message.document.file_id === 'string') {
    if (!isAttachableMime(message.document.mime_type)) return null;
    const hintExt = message.document.file_name ? path.extname(message.document.file_name) : '';
    const localPath = await downloadTelegramAttachment(token, message.document.file_id, hintExt);
    const caption = (message.caption || '').trim();
    return {
      text: caption || `I sent a ${message.document.mime_type || 'document'}. Take a look and tell me what to do with it.`,
      attachments: [localPath]
    };
  }

  return null;
}

function sanitizeSessionToken(value) {
  return String(value).replace(/[^a-zA-Z0-9_-]/g, '_');
}

function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || '').trim());
}

function createCopilotSessionId() {
  return crypto.randomUUID();
}

function normalizeState(rawState) {
  const state = rawState && typeof rawState === 'object' ? rawState : {};
  const offset = Number.isFinite(Number(state.offset)) ? Number(state.offset) : 0;
  const activeSessionByChat = state.activeSessionByChat && typeof state.activeSessionByChat === 'object'
    ? { ...state.activeSessionByChat }
    : {};
  const knownSessionsByChat = state.knownSessionsByChat && typeof state.knownSessionsByChat === 'object'
    ? { ...state.knownSessionsByChat }
    : {};
  const nextSessionSeqByChat = state.nextSessionSeqByChat && typeof state.nextSessionSeqByChat === 'object'
    ? { ...state.nextSessionSeqByChat }
    : {};
  const copilotSessionByLogicalSession = state.copilotSessionByLogicalSession && typeof state.copilotSessionByLogicalSession === 'object'
    ? { ...state.copilotSessionByLogicalSession }
    : {};

  for (const [chatId, sessions] of Object.entries(knownSessionsByChat)) {
    if (!Array.isArray(sessions)) {
      knownSessionsByChat[chatId] = [];
      continue;
    }

    knownSessionsByChat[chatId] = sessions
      .map((value) => String(value || '').trim())
      .filter(Boolean);
  }

  for (const [chatId, value] of Object.entries(nextSessionSeqByChat)) {
    const parsed = Number(value);
    nextSessionSeqByChat[chatId] = Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 1;
  }

  for (const [logicalSessionId, copilotSessionId] of Object.entries(copilotSessionByLogicalSession)) {
    if (!logicalSessionId || !isUuid(copilotSessionId)) {
      delete copilotSessionByLogicalSession[logicalSessionId];
    }
  }

  return {
    offset,
    activeSessionByChat,
    knownSessionsByChat,
    nextSessionSeqByChat,
    copilotSessionByLogicalSession
  };
}

function loadState() {
  if (!fs.existsSync(config.statePath)) {
    return normalizeState({ offset: 0 });
  }

  try {
    return normalizeState(JSON.parse(fs.readFileSync(config.statePath, 'utf8')));
  } catch {
    return normalizeState({ offset: 0 });
  }
}

function saveState(state) {
  fs.mkdirSync(config.stateDir, { recursive: true });
  fs.writeFileSync(config.statePath, JSON.stringify(normalizeState(state), null, 2));
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isAuthorized(chatId) {
  if (config.allowedChatIds.size === 0) {
    return false;
  }

  return config.allowedChatIds.has(String(chatId));
}

function ensureChatSessionState(state, chatId) {
  const chatKey = String(chatId);
  const defaultSessionId = chatKey;
  const sessionPrefix = `chat_${sanitizeSessionToken(chatKey)}_s`;

  if (!Array.isArray(state.knownSessionsByChat[chatKey])) {
    state.knownSessionsByChat[chatKey] = [];
  }

  const knownSessions = state.knownSessionsByChat[chatKey];
  if (fs.existsSync(config.sessionsDir)) {
    for (const fileName of fs.readdirSync(config.sessionsDir)) {
      if (!fileName.endsWith('.json')) {
        continue;
      }

      const sessionId = fileName.slice(0, -5);
      if ((sessionId === defaultSessionId || sessionId.startsWith(sessionPrefix)) && !knownSessions.includes(sessionId)) {
        knownSessions.push(sessionId);
      }
    }
  }

  if (!knownSessions.includes(defaultSessionId)) {
    knownSessions.unshift(defaultSessionId);
  }

  const activeSessionId = String(state.activeSessionByChat[chatKey] || defaultSessionId);
  if (!knownSessions.includes(activeSessionId)) {
    knownSessions.push(activeSessionId);
  }
  state.activeSessionByChat[chatKey] = activeSessionId;

  const existingSeq = Number(state.nextSessionSeqByChat[chatKey]);
  if (!Number.isFinite(existingSeq) || existingSeq < 1) {
    let maxSeq = 0;
    for (const sessionId of knownSessions) {
      if (!sessionId.startsWith(sessionPrefix)) {
        continue;
      }

      const suffix = sessionId.slice(sessionPrefix.length);
      const parsed = Number(suffix);
      if (Number.isFinite(parsed) && parsed > maxSeq) {
        maxSeq = parsed;
      }
    }

    state.nextSessionSeqByChat[chatKey] = maxSeq + 1;
  }

  return {
    chatKey,
    defaultSessionId,
    activeSessionId: state.activeSessionByChat[chatKey],
    knownSessions: state.knownSessionsByChat[chatKey]
  };
}

function ensureCopilotSessionMapping(state, logicalSessionId) {
  const key = String(logicalSessionId || '').trim();
  if (!key) {
    throw new Error('Logical session id is required.');
  }

  const existing = state.copilotSessionByLogicalSession[key];
  if (isUuid(existing)) {
    return existing;
  }

  const next = createCopilotSessionId();
  state.copilotSessionByLogicalSession[key] = next;
  return next;
}

function rotateCopilotSessionMapping(state, logicalSessionId) {
  const key = String(logicalSessionId || '').trim();
  if (!key) {
    throw new Error('Logical session id is required.');
  }

  const next = createCopilotSessionId();
  state.copilotSessionByLogicalSession[key] = next;
  return next;
}

function getActiveSessionId(state, chatId) {
  const activeSessionId = ensureChatSessionState(state, chatId).activeSessionId;
  ensureCopilotSessionMapping(state, activeSessionId);
  return activeSessionId;
}

function getActiveCopilotSessionId(state, chatId) {
  const logicalSessionId = getActiveSessionId(state, chatId);
  return ensureCopilotSessionMapping(state, logicalSessionId);
}

function createSession(state, chatId) {
  const { chatKey, knownSessions } = ensureChatSessionState(state, chatId);
  const sequence = Number(state.nextSessionSeqByChat[chatKey]) || 1;
  const sessionId = `chat_${sanitizeSessionToken(chatKey)}_s${String(sequence).padStart(3, '0')}`;

  state.nextSessionSeqByChat[chatKey] = sequence + 1;
  if (!knownSessions.includes(sessionId)) {
    knownSessions.push(sessionId);
  }

  state.activeSessionByChat[chatKey] = sessionId;
  ensureCopilotSessionMapping(state, sessionId);
  return sessionId;
}

function switchSession(state, chatId, requestedSessionId) {
  const { chatKey, defaultSessionId, knownSessions } = ensureChatSessionState(state, chatId);
  const target = requestedSessionId === 'default' ? defaultSessionId : requestedSessionId;

  if (!knownSessions.includes(target)) {
    return null;
  }

  state.activeSessionByChat[chatKey] = target;
  ensureCopilotSessionMapping(state, target);
  return target;
}

function sessionFilePath(sessionId) {
  return path.join(config.sessionsDir, `${sanitizeSessionToken(sessionId)}.json`);
}

function readSessionMeta(sessionId) {
  const p = sessionFilePath(sessionId);
  if (!fs.existsSync(p)) return null;
  try {
    const raw = JSON.parse(fs.readFileSync(p, 'utf8'));
    const messages = Array.isArray(raw.messages) ? raw.messages : [];
    return {
      sessionId: String(raw.sessionId || sessionId),
      label: typeof raw.label === 'string' ? raw.label : '',
      createdAt: raw.createdAt || raw.updatedAt || null,
      updatedAt: raw.updatedAt || null,
      lastActiveAt: raw.lastActiveAt || raw.updatedAt || null,
      turnCount: Number.isFinite(raw.turnCount) ? raw.turnCount : messages.length,
      totalChars: Number.isFinite(raw.totalChars) ? raw.totalChars : messages.reduce((n, m) => n + (m && typeof m.content === 'string' ? m.content.length : 0), 0)
    };
  } catch {
    return null;
  }
}

function writeSessionLabel(sessionId, label) {
  const p = sessionFilePath(sessionId);
  if (!fs.existsSync(p)) {
    fs.mkdirSync(config.sessionsDir, { recursive: true });
    fs.writeFileSync(p, JSON.stringify({
      sessionId: String(sessionId),
      label,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      lastActiveAt: new Date().toISOString(),
      turnCount: 0,
      totalChars: 0,
      messages: []
    }, null, 2));
    return;
  }
  const raw = JSON.parse(fs.readFileSync(p, 'utf8'));
  raw.label = label;
  fs.writeFileSync(p, JSON.stringify(raw, null, 2));
}

function deleteSessionFile(sessionId) {
  const p = sessionFilePath(sessionId);
  if (fs.existsSync(p)) fs.unlinkSync(p);
}

function removeKnownSession(state, chatId, sessionId) {
  const { chatKey, knownSessions } = ensureChatSessionState(state, chatId);
  state.knownSessionsByChat[chatKey] = knownSessions.filter((id) => id !== sessionId);
  if (state.copilotSessionByLogicalSession && state.copilotSessionByLogicalSession[sessionId]) {
    delete state.copilotSessionByLogicalSession[sessionId];
  }
}

function formatRelativeTime(iso) {
  if (!iso) return 'never';
  const then = Date.parse(iso);
  if (!Number.isFinite(then)) return iso;
  const diffMs = Date.now() - then;
  const s = Math.max(0, Math.round(diffMs / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h}h ago`;
  const d = Math.round(h / 24);
  return `${d}d ago`;
}

function formatSessionList(state, chatId) {
  const { activeSessionId, knownSessions } = ensureChatSessionState(state, chatId);
  const lines = [`Sessions for chat ${chatId}:`, ''];

  for (const sessionId of knownSessions) {
    const marker = sessionId === activeSessionId ? '*' : '-';
    const isDefault = sessionId === String(chatId);
    const meta = readSessionMeta(sessionId);
    const labelPart = meta && meta.label ? ` "${meta.label}"` : '';
    const defaultPart = isDefault ? ' (default)' : '';
    const turnsPart = meta ? `  ${meta.turnCount} turns` : '  fresh';
    const lastPart = meta ? `  last ${formatRelativeTime(meta.lastActiveAt)}` : '';
    lines.push(`${marker} ${sessionId}${defaultPart}${labelPart}${turnsPart}${lastPart}`);
  }

  lines.push('');
  lines.push('Commands:');
  lines.push('/session new');
  lines.push('/session list');
  lines.push('/session current');
  lines.push('/session use <id|default>');
  lines.push('/session rename <id> <label>');
  lines.push('/session delete <id>');
  lines.push('/session prune');
  return lines.join('\n');
}

function formatContext(state, chatId) {
  const logicalSessionId = getActiveSessionId(state, chatId);
  const copilotSessionId = config.copilotContextMode === 'native-session'
    ? getActiveCopilotSessionId(state, chatId)
    : null;
  const meta = readSessionMeta(logicalSessionId);
  const charsCap = config.copilotHistoryChars;
  const turnsCap = config.copilotHistoryTurns * 2;

  const lines = [`Context for chat ${chatId}:`, ''];
  lines.push(`Session:     ${logicalSessionId}${meta && meta.label ? ` "${meta.label}"` : ''}`);
  if (copilotSessionId) lines.push(`Copilot UUID: ${copilotSessionId}`);
  lines.push(`Mode:        ${config.copilotContextMode}`);
  if (!meta) {
    lines.push('');
    lines.push('No turns yet — this session is fresh.');
    return lines.join('\n');
  }
  const charsPct = charsCap > 0 ? Math.round((meta.totalChars / charsCap) * 100) : 0;
  const turnsPct = turnsCap > 0 ? Math.round((meta.turnCount / turnsCap) * 100) : 0;
  lines.push(`Turns:       ${meta.turnCount} / ${turnsCap} kept (${turnsPct}%)`);
  lines.push(`Chars:       ${meta.totalChars} / ${charsCap} budget (${charsPct}%)`);
  lines.push(`Created:     ${meta.createdAt || '?'}`);
  lines.push(`Last active: ${formatRelativeTime(meta.lastActiveAt)} (${meta.lastActiveAt || '?'})`);
  if (config.copilotContextMode === 'native-session') {
    lines.push('');
    lines.push('Note: in native-session mode copilot maintains its own context window');
    lines.push('beyond the bridge\'s envelope cap shown above.');
  }
  return lines.join('\n');
}

function formatHelpText() {
  return [
    'Send any text message and it will be routed through the local Copilot gateway in this repo.',
    '',
    'Built-in commands:',
    '/start, /help',
    '/status                       gateway + health probe summary',
    '/context                      current session usage (turns, chars vs cap)',
    '/cancel, /stop                cancel the in-flight copilot job for this chat',
    '/reset                        clear conversation history for active session',
    '/session new                  start and switch to a fresh session',
    '/session list, /sessions      list this chat\'s sessions with turn counts',
    '/session current              show active session id',
    '/session use <id|default>     switch active session',
    '/session rename <id> <label>  attach a human label to a session',
    '/session delete <id>          delete a session (not the active one)',
    '/session prune                drop empty inactive sessions for this chat',
    '/model                        show current model',
    '/model <name>                 switch model (use "default" or "-" to clear)',
    '/cron                         list scheduled jobs',
    '/vault [N]                    list vault entries (default 20)',
    '/files roots',
    '/files ls <alias:/path>',
    '/file send <alias:/path>',
    '',
    'Use /files roots to inspect configured aliases before browsing or sending files.'
  ].join('\n');
}

function formatRootsMessage() {
  const roots = listRoots(config);
  const lines = ['Configured file roots:'];

  for (const root of roots) {
    lines.push(`- ${root.id} -> ${root.path}`);
  }

  lines.push('');
  lines.push('Example usage: /files ls repo:/finance');
  return lines.join('\n');
}

function formatCronMessage() {
  if (!fs.existsSync(config.jobsPath)) {
    return 'No scheduled jobs file yet.';
  }

  let document;
  try {
    document = JSON.parse(fs.readFileSync(config.jobsPath, 'utf8'));
  } catch (error) {
    return `Failed to read jobs.json: ${error.message}`;
  }

  const jobs = Array.isArray(document.jobs) ? document.jobs : [];
  if (jobs.length === 0) {
    return 'No scheduled jobs.';
  }

  const lines = [`Scheduled jobs (${jobs.length}):`, ''];
  for (const job of jobs) {
    const flag = job.enabled === false ? '[off]' : '[on]';
    const tz = job.timezone ? ` (${job.timezone})` : '';
    lines.push(`${flag} ${job.id}  ${job.name || ''}`.trimEnd());
    lines.push(`   schedule: ${job.schedule || '(none)'}${tz}`);
    if (job.nextRunAt) {
      lines.push(`   next run: ${job.nextRunAt}`);
    }
    if (job.lastStatus) {
      lines.push(`   last:     ${job.lastStatus}${job.lastRunAt ? ` @ ${job.lastRunAt}` : ''}`);
    }
    const delivery = job.workflow && job.workflow.delivery;
    if (delivery && delivery.channel) {
      const target = delivery.target ? ` -> ${delivery.target}` : '';
      lines.push(`   deliver:  ${delivery.channel}${target}`);
    }
    lines.push('');
  }

  return lines.join('\n').trimEnd();
}

function formatVaultMessage(limit) {
  const indexPath = path.join(config.repoRoot, 'vault', 'knowledge-base.json');
  if (!fs.existsSync(indexPath)) {
    return 'Vault index not found at vault/knowledge-base.json.';
  }

  let document;
  try {
    document = JSON.parse(fs.readFileSync(indexPath, 'utf8'));
  } catch (error) {
    return `Failed to read knowledge-base.json: ${error.message}`;
  }

  const entries = Array.isArray(document.entries) ? document.entries : [];
  if (entries.length === 0) {
    return 'Vault is empty.';
  }

  const sorted = entries.slice().sort((a, b) => {
    const left = String(b.captured_at || '');
    const right = String(a.captured_at || '');
    return left.localeCompare(right);
  });

  const cap = Math.min(Math.max(1, limit || 20), 50);
  const visible = sorted.slice(0, cap);

  const lines = [`Vault entries (showing ${visible.length} of ${entries.length}):`, ''];
  visible.forEach((entry, index) => {
    const title = entry.title || entry.filename || entry.id || '(untitled)';
    const tags = Array.isArray(entry.tags) ? entry.tags.slice(0, 3).join(', ') : '';
    const meta = [entry.captured_at, tags].filter(Boolean).join(' | ');
    lines.push(`${index + 1}. ${title}`);
    if (meta) {
      lines.push(`   ${meta}`);
    }
    if (entry.filename) {
      lines.push(`   vault/${entry.filename}`);
    }
  });

  return lines.join('\n');
}

function formatModelLabel(model) {
  return model && model.trim() ? model.trim() : '(default)';
}

async function handleModelCommand(text, chatId) {
  const rest = text.slice('/model'.length).trim();

  if (!rest) {
    const info = await getGatewayModel(config);
    await sendText(config.telegramToken, chatId, `Current model: ${formatModelLabel(info.model)}`);
    return;
  }

  const next = rest === 'default' || rest === '-' || rest === 'reset' ? '' : rest;
  const result = await setGatewayModel(config, next);
  const label = formatModelLabel(result.model);
  await sendText(config.telegramToken, chatId, `Model set to: ${label}`);
}

function formatDirectoryListing(result) {
  const maxEntries = 60;
  const visibleEntries = result.entries.slice(0, maxEntries);
  const lines = [`Listing ${result.displayPath}`];

  if (visibleEntries.length === 0) {
    lines.push('(empty)');
  } else {
    for (const entry of visibleEntries) {
      const suffix = entry.type === 'dir' ? '/' : '';
      lines.push(`${entry.type === 'dir' ? '[dir]' : '[file]'} ${entry.name}${suffix}`);
    }
  }

  if (result.entries.length > visibleEntries.length) {
    lines.push(`... ${result.entries.length - visibleEntries.length} more entries omitted`);
  }

  return lines.join('\n');
}

async function handleDirectCommand(text, chatId, state) {
  if (text === '/start' || text === '/help') {
    await sendText(config.telegramToken, chatId, formatHelpText());
    return true;
  }

  if (text === '/cancel' || text === '/stop') {
    // Clear any pending batched messages for this chat first.
    const pending = pendingBatchByChat.get(chatId);
    if (pending) {
      if (pending.timer) clearTimeout(pending.timer);
      if (pending.typingTimer) clearInterval(pending.typingTimer);
      pendingBatchByChat.delete(chatId);
    }
    const logicalSessionId = getActiveSessionId(state, chatId);
    const gatewaySessionId = config.copilotContextMode === 'native-session'
      ? getActiveCopilotSessionId(state, chatId)
      : logicalSessionId;
    let result;
    try {
      result = await cancelGateway(config, { sessionId: gatewaySessionId });
    } catch (error) {
      await sendText(config.telegramToken, chatId, `Cancel failed: ${error.message}`);
      return true;
    }
    const note = pending ? ` (and dropped ${pending.items.length} queued message${pending.items.length === 1 ? '' : 's'})` : '';
    log.info('cancel_requested', {
      chat_id: chatId,
      session_id: logicalSessionId,
      cancelled: !!(result && result.cancelled),
      dropped_pending: pending ? pending.items.length : 0
    });
    if (result && result.cancelled) {
      await sendText(config.telegramToken, chatId, `⏹ Cancelled${note}.`);
    } else {
      await sendText(config.telegramToken, chatId, pending ? `⏹ Dropped${note}.` : 'Nothing to cancel.');
    }
    return true;
  }

  if (text === '/status') {
    const status = await getGatewayStatus(config);
    const logicalSessionId = getActiveSessionId(state, chatId);
    const copilotSessionId = getActiveCopilotSessionId(state, chatId);
    const activeLine = status.active
      ? `Active session: ${status.active.sessionId} since ${status.active.startedAt}`
      : 'Active session: none';
    const sessionLine = config.copilotContextMode === 'native-session'
      ? `Current logical session: ${logicalSessionId}. Copilot session: ${copilotSessionId}.`
      : `Current session: ${logicalSessionId}.`;
    const lines = [
      `Gateway is online. Queued jobs: ${status.queuedJobs}. ${activeLine}`,
      `Context mode: ${config.copilotContextMode}`,
      sessionLine
    ];
    if (status.healthProbe) {
      const probe = status.healthProbe;
      const tier2 = probe.lastTier2At
        ? `tier-2 ${probe.lastResult || 'unknown'} @ ${probe.lastTier2At}`
        : 'tier-2 not yet run';
      const tier1 = probe.lastTier1At ? `tier-1 @ ${probe.lastTier1At}` : 'tier-1 not yet run';
      lines.push(`Health probe: ${tier1}; ${tier2}.`);
      if (probe.lastError) {
        lines.push(`Last error (${probe.lastErrorClass || 'unknown'}): ${probe.lastError.slice(0, 200)}`);
      }
    }
    await sendText(config.telegramToken, chatId, lines.join('\n'));
    return true;
  }

  if (text === '/reset') {
    const logicalSessionId = getActiveSessionId(state, chatId);

    if (config.copilotContextMode === 'native-session') {
      const copilotSessionId = rotateCopilotSessionMapping(state, logicalSessionId);
      await sendText(
        config.telegramToken,
        chatId,
        `Reset active session context by rotating Copilot session.\nLogical session: ${logicalSessionId}\nNew Copilot session: ${copilotSessionId}`
      );
      return true;
    }

    await resetGatewaySession(config, logicalSessionId);
    await sendText(config.telegramToken, chatId, `Cleared saved conversation history for active session: ${logicalSessionId}`);
    return true;
  }

  if (text === '/session new') {
    const sessionId = createSession(state, chatId);
    await sendText(config.telegramToken, chatId, `Started and switched to new session: ${sessionId}`);
    return true;
  }

  if (text === '/session list' || text === '/sessions') {
    await sendText(config.telegramToken, chatId, formatSessionList(state, chatId));
    return true;
  }

  if (text === '/session current') {
    const logicalSessionId = getActiveSessionId(state, chatId);
    if (config.copilotContextMode === 'native-session') {
      const copilotSessionId = getActiveCopilotSessionId(state, chatId);
      await sendText(config.telegramToken, chatId, `Active logical session: ${logicalSessionId}\nCopilot session: ${copilotSessionId}`);
    } else {
      await sendText(config.telegramToken, chatId, `Active session: ${logicalSessionId}`);
    }
    return true;
  }

  if (text.startsWith('/session use ')) {
    const requestedSessionId = text.slice('/session use '.length).trim();
    if (!requestedSessionId) {
      await sendText(config.telegramToken, chatId, 'Usage: /session use <session-id|default>');
      return true;
    }

    const switchedSessionId = switchSession(state, chatId, requestedSessionId);
    if (!switchedSessionId) {
      await sendText(config.telegramToken, chatId, 'Unknown session id for this chat. Use /session list first.');
      return true;
    }

    await sendText(config.telegramToken, chatId, `Switched to session: ${switchedSessionId}`);
    return true;
  }

  if (text.startsWith('/session rename ')) {
    const rest = text.slice('/session rename '.length).trim();
    const spaceIdx = rest.indexOf(' ');
    if (spaceIdx === -1) {
      await sendText(config.telegramToken, chatId, 'Usage: /session rename <session-id> <label>');
      return true;
    }
    const targetId = rest.slice(0, spaceIdx).trim();
    const label = rest.slice(spaceIdx + 1).trim().slice(0, 80);
    const { knownSessions } = ensureChatSessionState(state, chatId);
    if (!knownSessions.includes(targetId)) {
      await sendText(config.telegramToken, chatId, `Unknown session "${targetId}" for this chat. Try /session list.`);
      return true;
    }
    writeSessionLabel(targetId, label);
    log.info('session_renamed', { chat_id: chatId, session_id: targetId, label });
    await sendText(config.telegramToken, chatId, `Renamed ${targetId} -> "${label}"`);
    return true;
  }

  if (text.startsWith('/session delete ')) {
    const targetId = text.slice('/session delete '.length).trim();
    if (!targetId) {
      await sendText(config.telegramToken, chatId, 'Usage: /session delete <session-id>');
      return true;
    }
    const { activeSessionId, knownSessions, defaultSessionId } = ensureChatSessionState(state, chatId);
    if (!knownSessions.includes(targetId)) {
      await sendText(config.telegramToken, chatId, `Unknown session "${targetId}" for this chat.`);
      return true;
    }
    if (targetId === activeSessionId) {
      await sendText(config.telegramToken, chatId, `Refusing to delete the active session. Switch first: /session use default`);
      return true;
    }
    if (targetId === defaultSessionId) {
      await sendText(config.telegramToken, chatId, `Refusing to delete the default session for this chat.`);
      return true;
    }
    deleteSessionFile(targetId);
    removeKnownSession(state, chatId, targetId);
    log.info('session_deleted', { chat_id: chatId, session_id: targetId });
    await sendText(config.telegramToken, chatId, `Deleted session: ${targetId}`);
    return true;
  }

  if (text === '/session prune') {
    const { activeSessionId, knownSessions, defaultSessionId } = ensureChatSessionState(state, chatId);
    const dropped = [];
    for (const sid of [...knownSessions]) {
      if (sid === activeSessionId || sid === defaultSessionId) continue;
      const meta = readSessionMeta(sid);
      if (!meta || meta.turnCount === 0) {
        deleteSessionFile(sid);
        removeKnownSession(state, chatId, sid);
        dropped.push(sid);
      }
    }
    log.info('sessions_pruned', { chat_id: chatId, dropped: dropped.length });
    if (dropped.length === 0) {
      await sendText(config.telegramToken, chatId, 'Nothing to prune.');
    } else {
      await sendText(config.telegramToken, chatId, `Pruned ${dropped.length} empty session${dropped.length === 1 ? '' : 's'}:\n${dropped.join('\n')}`);
    }
    return true;
  }

  if (text === '/context') {
    await sendText(config.telegramToken, chatId, formatContext(state, chatId));
    return true;
  }

  if (text === '/model' || text.startsWith('/model ')) {
    await handleModelCommand(text, chatId);
    return true;
  }

  if (text === '/cron') {
    await sendText(config.telegramToken, chatId, formatCronMessage());
    return true;
  }

  if (text === '/vault' || text.startsWith('/vault ')) {
    const arg = text.slice('/vault'.length).trim();
    const limit = arg ? Number.parseInt(arg, 10) : 20;
    await sendText(config.telegramToken, chatId, formatVaultMessage(Number.isFinite(limit) ? limit : 20));
    return true;
  }

  if (text === '/files roots') {
    await sendText(config.telegramToken, chatId, formatRootsMessage());
    return true;
  }

  if (text.startsWith('/files ls ')) {
    const input = text.slice('/files ls '.length).trim();
    const result = listDirectory(config, input);
    await sendText(config.telegramToken, chatId, formatDirectoryListing(result));
    return true;
  }

  if (text.startsWith('/file send ')) {
    const input = text.slice('/file send '.length).trim();
    const file = getFileForSend(config, input);
    await sendDocument(config.telegramToken, chatId, file.fullPath, {
      caption: `${file.displayPath} (${file.size} bytes)`
    });
    return true;
  }

  return false;
}

const BATCH_WINDOW_MS = Math.max(100, Number(process.env.BRIDGE_BATCH_WINDOW_MS) || 2500);
const pendingBatchByChat = new Map();

function flushBatch(chatId) {
  const entry = pendingBatchByChat.get(chatId);
  if (!entry) return;
  if (entry.timer) {
    clearTimeout(entry.timer);
    entry.timer = null;
  }
  if (entry.typingTimer) {
    clearInterval(entry.typingTimer);
    entry.typingTimer = null;
  }
  if (entry.items.length === 0) {
    pendingBatchByChat.delete(chatId);
    return;
  }
  const items = entry.items;
  const state = entry.state;
  pendingBatchByChat.delete(chatId);

  processBatch(chatId, items, state).catch((error) => {
    console.error(`Batch error for chat ${chatId}: ${error.stack || error.message}`);
    if (config.telegramToken && isAuthorized(chatId)) {
      sendText(config.telegramToken, chatId, `Bridge error: ${error.message}`).catch(() => {});
    }
  });
}

function enqueueToBatch(chatId, input, state) {
  let entry = pendingBatchByChat.get(chatId);
  const isFirst = !entry;
  if (!entry) {
    entry = { items: [], timer: null, typingTimer: null, state };
    pendingBatchByChat.set(chatId, entry);
  } else {
    entry.state = state;
  }
  entry.items.push(input);
  if (entry.timer) clearTimeout(entry.timer);
  entry.timer = setTimeout(() => flushBatch(chatId), BATCH_WINDOW_MS);

  if (isFirst && config.telegramToken) {
    sendTyping(config.telegramToken, chatId).catch(() => {});
    entry.typingTimer = setInterval(() => {
      sendTyping(config.telegramToken, chatId).catch(() => {});
    }, 4500);
  }
}

async function processBatch(chatId, items, state) {
  const combinedText = items
    .map((it) => (it.text || '').trim())
    .filter(Boolean)
    .join('\n\n');
  const combinedAttachments = items.flatMap((it) => Array.isArray(it.attachments) ? it.attachments : []);

  if (!combinedText && combinedAttachments.length === 0) return;

  const logicalSessionId = getActiveSessionId(state, chatId);
  const gatewaySessionId = config.copilotContextMode === 'native-session'
    ? getActiveCopilotSessionId(state, chatId)
    : logicalSessionId;

  log.info('batch_flushed', {
    chat_id: chatId,
    session_id: logicalSessionId,
    messages: items.length,
    chars: combinedText.length,
    attachments: combinedAttachments.length
  });

  const startedAt = Date.now();
  try {
    await streamReplyToTelegram(
      config,
      chatId,
      gatewaySessionId,
      combinedText,
      {
        channel: 'telegram',
        telegram_chat_id: String(chatId),
        telegram_logical_session_id: logicalSessionId,
        copilot_context_mode: config.copilotContextMode,
        attachment_count: combinedAttachments.length,
        message_batch_size: items.length
      },
      { attachments: combinedAttachments }
    );
    log.info('reply_completed', {
      chat_id: chatId,
      session_id: logicalSessionId,
      latency_ms: Date.now() - startedAt
    });
  } catch (error) {
    log.error('reply_failed', {
      chat_id: chatId,
      session_id: logicalSessionId,
      latency_ms: Date.now() - startedAt,
      error: error.message
    });
    throw error;
  }
}

function pruneOldAttachments(maxAgeMs) {
  if (!fs.existsSync(ATTACHMENTS_DIR)) return { removed: 0, bytes: 0 };
  const cutoff = Date.now() - maxAgeMs;
  let removed = 0;
  let bytes = 0;
  for (const name of fs.readdirSync(ATTACHMENTS_DIR)) {
    const full = path.join(ATTACHMENTS_DIR, name);
    try {
      const st = fs.statSync(full);
      if (st.isFile() && st.mtimeMs < cutoff) {
        bytes += st.size;
        fs.unlinkSync(full);
        removed += 1;
      }
    } catch {}
  }
  return { removed, bytes };
}

async function main() {
  if (!config.telegramToken) {
    throw new Error('Missing TELEGRAM_BOT_TOKEN in telegram-bridge/.env');
  }

  if (config.allowedChatIds.size === 0) {
    throw new Error('Missing TELEGRAM_ALLOWED_CHAT_IDS in telegram-bridge/.env');
  }

  const state = loadState();

  let botIdentity = { username: null, first_name: null, id: null };
  try {
    const me = await getMe(config.telegramToken);
    botIdentity = { username: me.username || null, first_name: me.first_name || null, id: me.id || null };
  } catch (error) {
    log.warn('getme_failed', { error: error.message });
  }

  const attachmentGc = pruneOldAttachments(7 * 24 * 60 * 60 * 1000);

  log.info('bot_started', {
    bot_username: botIdentity.username,
    bot_id: botIdentity.id,
    allowed_chats: Array.from(config.allowedChatIds).join(','),
    allowed_chat_count: config.allowedChatIds.size,
    gateway: config.gatewayBaseUrl,
    context_mode: config.copilotContextMode,
    log_file: EVENTS_PATH,
    attachments_purged: attachmentGc.removed,
    attachments_purged_bytes: attachmentGc.bytes
  });

  while (true) {
    try {
      const updates = await getUpdates(config.telegramToken, {
        offset: state.offset,
        timeout: config.pollTimeoutSeconds,
        allowed_updates: ['message']
      });

      state.lastPollAt = new Date().toISOString();
      saveState(state);

      for (const update of updates) {
        try {
          const message = update.message;
          if (!message || !message.chat) {
            continue;
          }

          const chatId = message.chat.id;
          if (!isAuthorized(chatId)) {
            log.warn('message_dropped_unauthorized', {
              chat_id: chatId,
              chat_type: message.chat.type || '?',
              chat_title: message.chat.title || message.chat.username || ''
            });
            continue;
          }

          const messageInput = await extractMessageInput(message);
          if (!messageInput) {
            log.warn('message_unsupported_type', { chat_id: chatId });
            await sendText(
              config.telegramToken,
              chatId,
              'Send text, a photo, or an image/PDF document. Voice notes and other types are not handled yet.'
            );
            continue;
          }

          const { text, attachments } = messageInput;

          if (!text && attachments.length === 0) {
            continue;
          }

          const activeSessionId = getActiveSessionId(state, chatId);

          log.info('message_received', {
            chat_id: chatId,
            session_id: activeSessionId,
            chars: text.length,
            attachments: attachments.length
          });

          // Commands run immediately and bypass batching.
          if (attachments.length === 0 && text.startsWith('/')) {
            if (await handleDirectCommand(text, chatId, state)) {
              log.info('command_executed', {
                chat_id: chatId,
                session_id: activeSessionId,
                command: text.split(/\s+/)[0]
              });
              continue;
            }
          }

          // Otherwise accumulate into the per-chat batch; debounce timer fires
          // after BATCH_WINDOW_MS and sends everything as one combined prompt.
          enqueueToBatch(chatId, messageInput, state);
        } catch (error) {
          const chatId = update.message && update.message.chat ? update.message.chat.id : undefined;
          log.error('bridge_error', {
            chat_id: chatId,
            error: error.message,
            stack: error.stack ? error.stack.split('\n')[1] : undefined
          });
          if (chatId !== undefined && isAuthorized(chatId)) {
            await sendText(config.telegramToken, chatId, `Bridge error: ${error.message}`);
          }
        } finally {
          state.offset = update.update_id + 1;
          saveState(state);
        }
      }
    } catch (error) {
      log.error('poll_loop_error', { error: error.message });
      await delay(5000);
    }
  }
}

main().catch((error) => {
  log.error('bot_fatal', { error: error.message, stack: error.stack });
  process.exitCode = 1;
});
