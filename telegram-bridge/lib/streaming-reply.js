const { editMessageText, sendMessage, sendTyping } = require('./transport/telegram-api');
const { streamGateway } = require('./transport/gateway-client');

const MAX_MESSAGE_CHARS = 4000;
const EDIT_DEBOUNCE_MS = 700;
const HEARTBEAT_CHECK_MS = 5000;
const HEARTBEAT_STALL_MS = 20000;
const TYPING_REFRESH_MS = 4500;
const PLACEHOLDER_INITIAL = '⌛';
const PLACEHOLDER_CONTINUATION = '…';

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function formatToolEvent(rawData) {
  let parsed = rawData;
  if (typeof rawData === 'string') {
    try { parsed = JSON.parse(rawData); } catch { return `_…working_`; }
  }
  if (!parsed || typeof parsed !== 'object') return `_…working_`;

  const rawName = String(parsed.name || 'tool');
  const description = (parsed.description || '').toString().trim();

  // Special: report_intent is the model planning, not a real tool call.
  if (rawName === 'report_intent') {
    const intent = description || 'thinking';
    return `_🤔 ${truncate(intent, 80)}_`;
  }

  // Strip mcp__server__ prefix if present so footer reads cleanly.
  const name = rawName.replace(/^mcp__/, '').replace(/^mcp\./, '');

  if (description) {
    return `_🔧 ${name}: ${truncate(description, 80)}_`;
  }
  return `_🔧 ${name}_`;
}

function truncate(text, max) {
  if (!text) return '';
  if (text.length <= max) return text;
  return text.slice(0, max - 1) + '…';
}

async function streamReplyToTelegram(config, chatId, sessionId, prompt, context, options = {}) {
  const token = config.telegramToken;

  // Native typing indicator — fire-and-forget, refresh every 4.5s.
  sendTyping(token, chatId).catch(() => {});
  const typingInterval = setInterval(() => {
    sendTyping(token, chatId).catch(() => {});
  }, TYPING_REFRESH_MS);

  const initial = await sendMessage(token, chatId, PLACEHOLDER_INITIAL);
  let activeMessage = { id: initial.message_id, text: PLACEHOLDER_INITIAL };
  const completedMessages = [];
  let completedText = '';

  let buffer = '';
  let footer = '';
  let lastChunkAt = Date.now();
  let lastEditAt = 0;
  let pendingFlush = null;
  let flushChain = Promise.resolve();
  let errorMessage = null;
  let finalReply = '';
  let cancelled = false;

  function totalText() {
    return buffer + (footer ? `\n\n${footer}` : '');
  }

  async function safeEdit(messageId, text) {
    let attempt = 0;
    while (true) {
      try {
        await editMessageText(token, chatId, messageId, text);
        return;
      } catch (error) {
        if (error.statusCode === 429 && attempt < 2) {
          attempt += 1;
          const wait = Math.max(1, error.retryAfter || 1) * 1000 + 200;
          await delay(wait);
          continue;
        }
        if (error.statusCode === 400 && /message is not modified/i.test(error.message)) {
          return;
        }
        console.error(`Telegram editMessageText failed: ${error.message}`);
        return;
      }
    }
  }

  async function performFlush() {
    const fullText = totalText();
    let activeText = fullText.slice(completedText.length);

    while (activeText.length > MAX_MESSAGE_CHARS) {
      let splitAt = activeText.lastIndexOf('\n', MAX_MESSAGE_CHARS);
      if (splitAt < MAX_MESSAGE_CHARS / 2) splitAt = MAX_MESSAGE_CHARS;
      const finalPart = activeText.slice(0, splitAt).trimEnd();

      if (activeMessage.text !== finalPart && finalPart.length > 0) {
        await safeEdit(activeMessage.id, finalPart);
        activeMessage.text = finalPart;
      }

      completedMessages.push(activeMessage);
      completedText += finalPart;

      const continuation = await sendMessage(token, chatId, PLACEHOLDER_CONTINUATION);
      activeMessage = { id: continuation.message_id, text: PLACEHOLDER_CONTINUATION };
      activeText = activeText.slice(splitAt).replace(/^\n+/, '');
    }

    const display = activeText || PLACEHOLDER_INITIAL;
    if (activeMessage.text !== display) {
      await safeEdit(activeMessage.id, display);
      activeMessage.text = display;
    }
    lastEditAt = Date.now();
  }

  function scheduleFlush() {
    if (pendingFlush) return;
    const wait = Math.max(0, EDIT_DEBOUNCE_MS - (Date.now() - lastEditAt));
    pendingFlush = setTimeout(() => {
      pendingFlush = null;
      flushChain = flushChain
        .then(performFlush)
        .catch((error) => {
          console.error(`Streaming flush error: ${error.message}`);
        });
    }, wait);
  }

  const heartbeat = setInterval(() => {
    const stallMs = Date.now() - lastChunkAt;
    if (stallMs > HEARTBEAT_STALL_MS && !errorMessage && !footer) {
      const seconds = Math.floor(stallMs / 1000);
      const next = `_…still working (${seconds}s)_`;
      footer = next;
      scheduleFlush();
    }
  }, HEARTBEAT_CHECK_MS);

  try {
    for await (const event of streamGateway(config, {
      sessionId,
      prompt,
      attachments: Array.isArray(options.attachments) ? options.attachments : undefined,
      context: context || {
        channel: 'telegram',
        telegram_chat_id: String(chatId)
      }
    })) {
      if (event.type === 'chunk') {
        buffer += event.data;
        footer = '';
        lastChunkAt = Date.now();
        scheduleFlush();
      } else if (event.type === 'tool') {
        const formatted = formatToolEvent(event.data);
        if (formatted && formatted !== footer) {
          footer = formatted;
          lastChunkAt = Date.now();
          scheduleFlush();
        }
      } else if (event.type === 'tool_done') {
        // Keep the footer until next tool or chunk arrives.
        // Reset the stall timer so heartbeat doesn't fire while tools are pumping.
        lastChunkAt = Date.now();
      } else if (event.type === 'done') {
        finalReply = event.data || buffer;
        buffer = finalReply;
        footer = '';
      } else if (event.type === 'error') {
        if (event.data === 'cancelled') {
          cancelled = true;
        } else {
          errorMessage = event.data || 'Unknown gateway error.';
        }
      }
    }
  } finally {
    clearInterval(heartbeat);
    clearInterval(typingInterval);
    if (pendingFlush) {
      clearTimeout(pendingFlush);
      pendingFlush = null;
    }
    await flushChain.catch(() => {});
  }

  if (cancelled) {
    buffer = buffer.trim()
      ? `${buffer.trim()}\n\n_⏹ Cancelled._`
      : '⏹ Cancelled.';
    footer = '';
  } else if (errorMessage) {
    buffer = `Error: ${errorMessage}`;
    footer = '';
  }

  await performFlush();
}

module.exports = {
  streamReplyToTelegram
};
