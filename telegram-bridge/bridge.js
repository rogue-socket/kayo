const fs = require('node:fs');
const path = require('node:path');

const BRIDGE_DIR = __dirname;
const ENV_PATH = path.join(BRIDGE_DIR, '.env');
const STATE_DIR = path.join(BRIDGE_DIR, 'runtime');
const STATE_PATH = path.join(STATE_DIR, 'state.json');
const TELEGRAM_MESSAGE_LIMIT = 4000;

function readEnvFile(filePath) {
  if (!fs.existsSync(filePath)) {
    return;
  }

  const content = fs.readFileSync(filePath, 'utf8');
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

    if (!(key in process.env)) {
      process.env[key] = value;
    }
  }
}

function parseAllowedChatIds(value) {
  return new Set(
    (value || '')
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean)
  );
}

function loadState() {
  if (!fs.existsSync(STATE_PATH)) {
    return { offset: 0 };
  }

  try {
    return JSON.parse(fs.readFileSync(STATE_PATH, 'utf8'));
  } catch {
    return { offset: 0 };
  }
}

function saveState(state) {
  fs.mkdirSync(STATE_DIR, { recursive: true });
  fs.writeFileSync(STATE_PATH, JSON.stringify(state, null, 2));
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function splitMessage(text) {
  if (text.length <= TELEGRAM_MESSAGE_LIMIT) {
    return [text];
  }

  const chunks = [];
  let remaining = text;
  while (remaining.length > TELEGRAM_MESSAGE_LIMIT) {
    let splitIndex = remaining.lastIndexOf('\n', TELEGRAM_MESSAGE_LIMIT);
    if (splitIndex < TELEGRAM_MESSAGE_LIMIT / 2) {
      splitIndex = TELEGRAM_MESSAGE_LIMIT;
    }
    chunks.push(remaining.slice(0, splitIndex));
    remaining = remaining.slice(splitIndex).trimStart();
  }
  if (remaining) {
    chunks.push(remaining);
  }
  return chunks;
}

async function telegramRequest(token, method, payload) {
  const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json'
    },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Telegram API ${method} failed with ${response.status}: ${body}`);
  }

  const json = await response.json();
  if (!json.ok) {
    throw new Error(`Telegram API ${method} error: ${JSON.stringify(json)}`);
  }

  return json.result;
}

async function sendText(token, chatId, text) {
  const content = text || 'No output.';
  for (const chunk of splitMessage(content)) {
    await telegramRequest(token, 'sendMessage', {
      chat_id: chatId,
      text: chunk
    });
  }
}

async function sendTyping(token, chatId) {
  await telegramRequest(token, 'sendChatAction', {
    chat_id: chatId,
    action: 'typing'
  });
}

function isAuthorized(chatId, allowedChatIds) {
  if (allowedChatIds.size === 0) {
    return false;
  }

  return allowedChatIds.has(String(chatId));
}

async function gatewayRequest(baseUrl, sharedToken, method, endpoint, payload) {
  const headers = {};
  if (payload !== undefined) {
    headers['content-type'] = 'application/json';
  }
  if (sharedToken) {
    headers['x-gateway-token'] = sharedToken;
  }

  const response = await fetch(`${baseUrl}${endpoint}`, {
    method,
    headers,
    body: payload === undefined ? undefined : JSON.stringify(payload)
  });

  const text = await response.text();
  let json;
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(`Gateway returned invalid JSON with status ${response.status}.`);
  }

  if (!response.ok) {
    throw new Error(json.error || `Gateway request failed with status ${response.status}.`);
  }

  return json;
}

async function main() {
  readEnvFile(ENV_PATH);

  const token = process.env.TELEGRAM_BOT_TOKEN;
  const allowedChatIds = parseAllowedChatIds(process.env.TELEGRAM_ALLOWED_CHAT_IDS);
  const pollTimeoutSeconds = Number(process.env.TELEGRAM_POLL_TIMEOUT_SECONDS || 30);
  const gatewayHost = process.env.GATEWAY_HOST || '127.0.0.1';
  const gatewayPort = Number(process.env.GATEWAY_PORT || 8787);
  const gatewaySharedToken = process.env.GATEWAY_SHARED_TOKEN || '';
  const gatewayBaseUrl = `http://${gatewayHost}:${gatewayPort}`;

  if (!token) {
    throw new Error('Missing TELEGRAM_BOT_TOKEN in telegram-bridge/.env');
  }

  if (allowedChatIds.size === 0) {
    throw new Error('Missing TELEGRAM_ALLOWED_CHAT_IDS in telegram-bridge/.env');
  }

  const state = loadState();

  console.log('Telegram bridge started.');
  console.log(`Allowed chats: ${Array.from(allowedChatIds).join(', ')}`);
  console.log(`Gateway: ${gatewayBaseUrl}`);

  while (true) {
    try {
      const updates = await telegramRequest(token, 'getUpdates', {
        offset: state.offset,
        timeout: pollTimeoutSeconds,
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

          if (!isAuthorized(chatId, allowedChatIds)) {
            continue;
          }

          if (!text) {
            await sendText(token, chatId, 'Send a text message and I will forward it to the local Copilot gateway.');
            continue;
          }

          if (text === '/start' || text === '/help') {
            await sendText(token, chatId, 'Send any text message and it will be routed through the local Copilot gateway in this repo. Use /status to inspect the queue and /reset to clear this chat history.');
            continue;
          }

          if (text === '/status') {
            const status = await gatewayRequest(gatewayBaseUrl, gatewaySharedToken, 'GET', '/v1/status');
            const activeLine = status.active
              ? `Active session: ${status.active.sessionId} since ${status.active.startedAt}`
              : 'Active session: none';
            await sendText(token, chatId, `Gateway is online. Queued jobs: ${status.queuedJobs}. ${activeLine}`);
            continue;
          }

          if (text === '/reset') {
            await gatewayRequest(gatewayBaseUrl, gatewaySharedToken, 'POST', '/v1/reset', {
              sessionId: String(chatId)
            });
            await sendText(token, chatId, 'Cleared the saved conversation history for this chat.');
            continue;
          }

          await sendTyping(token, chatId);
          const typingInterval = setInterval(() => {
            sendTyping(token, chatId).catch(() => {});
          }, 4000);

          try {
            const result = await gatewayRequest(gatewayBaseUrl, gatewaySharedToken, 'POST', '/v1/prompt', {
              sessionId: String(chatId),
              prompt: text
            });
            await sendText(token, chatId, result.reply);
          } finally {
            clearInterval(typingInterval);
          }
        } catch (error) {
          const chatId = update.message && update.message.chat ? update.message.chat.id : undefined;
          if (chatId !== undefined && isAuthorized(chatId, allowedChatIds)) {
            await sendText(token, chatId, `Bridge error: ${error.message}`);
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
