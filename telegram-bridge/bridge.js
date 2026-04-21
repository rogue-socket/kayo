const fs = require('node:fs');

const { loadConfig } = require('./lib/env');
const { getFileForSend, listDirectory, listRoots } = require('./lib/file-access');
const { getGatewayStatus, promptGateway, resetGatewaySession } = require('./lib/transport/gateway-client');
const { getUpdates, sendDocument, sendText, sendTyping } = require('./lib/transport/telegram-api');

const config = loadConfig();

function loadState() {
  if (!fs.existsSync(config.statePath)) {
    return { offset: 0 };
  }

  try {
    return JSON.parse(fs.readFileSync(config.statePath, 'utf8'));
  } catch {
    return { offset: 0 };
  }
}

function saveState(state) {
  fs.mkdirSync(config.stateDir, { recursive: true });
  fs.writeFileSync(config.statePath, JSON.stringify(state, null, 2));
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

function formatHelpText() {
  return [
    'Send any text message and it will be routed through the local Copilot gateway in this repo.',
    '',
    'Built-in commands:',
    '/status',
    '/reset',
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

async function handleDirectCommand(text, chatId) {
  if (text === '/start' || text === '/help') {
    await sendText(config.telegramToken, chatId, formatHelpText());
    return true;
  }

  if (text === '/status') {
    const status = await getGatewayStatus(config);
    const activeLine = status.active
      ? `Active session: ${status.active.sessionId} since ${status.active.startedAt}`
      : 'Active session: none';
    await sendText(config.telegramToken, chatId, `Gateway is online. Queued jobs: ${status.queuedJobs}. ${activeLine}`);
    return true;
  }

  if (text === '/reset') {
    await resetGatewaySession(config, String(chatId));
    await sendText(config.telegramToken, chatId, 'Cleared the saved conversation history for this chat.');
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

          if (await handleDirectCommand(text, chatId)) {
            continue;
          }

          await sendTyping(config.telegramToken, chatId);
          const typingInterval = setInterval(() => {
            sendTyping(config.telegramToken, chatId).catch(() => {});
          }, 4000);

          try {
            const result = await promptGateway(config, {
              sessionId: String(chatId),
              prompt: text,
              context: {
                channel: 'telegram',
                telegram_chat_id: String(chatId)
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