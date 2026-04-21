const fs = require('node:fs');
const crypto = require('node:crypto');

const { loadConfig } = require('./lib/env');
const { getFileForSend, listDirectory, listRoots } = require('./lib/file-access');
const { getGatewayStatus, promptGateway, resetGatewaySession } = require('./lib/transport/gateway-client');
const { getUpdates, sendDocument, sendText, sendTyping } = require('./lib/transport/telegram-api');

const config = loadConfig();

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

function formatSessionList(state, chatId) {
  const { activeSessionId, knownSessions } = ensureChatSessionState(state, chatId);
  const lines = [`Sessions for chat ${chatId}:`, ''];

  for (const sessionId of knownSessions) {
    const marker = sessionId === activeSessionId ? '*' : '-';
    const label = sessionId === String(chatId) ? `${sessionId} (default)` : sessionId;
    if (config.copilotContextMode === 'native-session') {
      const copilotSessionId = ensureCopilotSessionMapping(state, sessionId);
      lines.push(`${marker} ${label} -> ${copilotSessionId}`);
    } else {
      lines.push(`${marker} ${label}`);
    }
  }

  lines.push('');
  lines.push('Commands:');
  lines.push('/session new');
  lines.push('/session list');
  lines.push('/session current');
  lines.push('/session use <session-id|default>');
  return lines.join('\n');
}

function formatHelpText() {
  return [
    'Send any text message and it will be routed through the local Copilot gateway in this repo.',
    '',
    'Built-in commands:',
    '/start',
    '/help',
    '/status',
    '/reset',
    '/session new',
    '/session list',
    '/sessions',
    '/session current',
    '/session use <session-id|default>',
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
    await sendText(
      config.telegramToken,
      chatId,
      `Gateway is online. Queued jobs: ${status.queuedJobs}. ${activeLine}\nContext mode: ${config.copilotContextMode}\n${sessionLine}`
    );
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

async function main() {
  if (!config.telegramToken) {
    throw new Error('Missing TELEGRAM_BOT_TOKEN in telegram-bridge/.env');
  }

  if (config.allowedChatIds.size === 0) {
    throw new Error('Missing TELEGRAM_ALLOWED_CHAT_IDS in telegram-bridge/.env');
  }

  const state = loadState();

  console.log('Telegram bridge started.');
  console.log(`Allowed chats: ${Array.from(config.allowedChatIds).join(', ')}`);
  console.log(`Gateway: ${config.gatewayBaseUrl}`);

  while (true) {
    try {
      const updates = await getUpdates(config.telegramToken, {
        offset: state.offset,
        timeout: config.pollTimeoutSeconds,
        allowed_updates: ['message']
      });

      for (const update of updates) {
        try {
          const message = update.message;
          if (!message || typeof message.text !== 'string') {
            continue;
          }

          const chatId = message.chat.id;
          const text = message.text.trim();

          if (!isAuthorized(chatId)) {
            continue;
          }

          if (!text) {
            await sendText(config.telegramToken, chatId, 'Send a text message and I will forward it to the local Copilot gateway.');
            continue;
          }

          if (await handleDirectCommand(text, chatId, state)) {
            continue;
          }

          const logicalSessionId = getActiveSessionId(state, chatId);
          const gatewaySessionId = config.copilotContextMode === 'native-session'
            ? getActiveCopilotSessionId(state, chatId)
            : logicalSessionId;

          await sendTyping(config.telegramToken, chatId);
          const typingInterval = setInterval(() => {
            sendTyping(config.telegramToken, chatId).catch(() => {});
          }, 4000);

          try {
            const result = await promptGateway(config, {
              sessionId: gatewaySessionId,
              prompt: text,
              context: {
                channel: 'telegram',
                telegram_chat_id: String(chatId),
                telegram_logical_session_id: logicalSessionId,
                copilot_context_mode: config.copilotContextMode
              }
            });

            await sendText(config.telegramToken, chatId, result.reply);
          } finally {
            clearInterval(typingInterval);
          }
        } catch (error) {
          const chatId = update.message && update.message.chat ? update.message.chat.id : undefined;
          if (chatId !== undefined && isAuthorized(chatId)) {
            await sendText(config.telegramToken, chatId, `Bridge error: ${error.message}`);
          }
        } finally {
          state.offset = update.update_id + 1;
          saveState(state);
        }
      }
    } catch (error) {
      console.error(error);
      await delay(5000);
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
