const fs = require('node:fs');
const path = require('node:path');

const TELEGRAM_MESSAGE_LIMIT = 4000;

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

const { createLogger } = require('../logger');
const log = createLogger('telegram-api');

async function telegramRequest(token, method, payload, options = {}) {
  const requestOptions = {
    method: 'POST',
    headers: options.headers || {},
    body: payload
  };
  const url = `https://api.telegram.org/bot${token}/${method}`;
  // FormData bodies (sendDocument) can't be safely replayed across a retry, so
  // only retry when payload is a JSON string. One retry with 200ms backoff is
  // enough to absorb the transient fetch-failed blips we observed from scheduler.
  const canRetry = typeof payload === 'string';

  let response;
  let lastNetworkError = null;
  const maxAttempts = canRetry ? 2 : 1;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      response = await fetch(url, requestOptions);
      lastNetworkError = null;
      break;
    } catch (err) {
      lastNetworkError = err;
      if (attempt < maxAttempts) {
        log.warn('telegram_fetch_retry', { method, attempt, error: err.message });
        await new Promise((r) => setTimeout(r, 200));
      }
    }
  }
  if (lastNetworkError) {
    log.error('telegram_fetch_failed', { method, attempts: maxAttempts, error: lastNetworkError.message });
    throw lastNetworkError;
  }

  if (!response.ok) {
    const body = await response.text();
    const error = new Error(`Telegram API ${method} failed with ${response.status}: ${body}`);
    error.statusCode = response.status;
    try {
      const parsed = JSON.parse(body);
      if (parsed && parsed.parameters && typeof parsed.parameters.retry_after === 'number') {
        error.retryAfter = parsed.parameters.retry_after;
      }
    } catch {}
    throw error;
  }

  const json = await response.json();
  if (!json.ok) {
    throw new Error(`Telegram API ${method} error: ${JSON.stringify(json)}`);
  }

  return json.result;
}

function telegramJsonRequest(token, method, payload) {
  return telegramRequest(token, method, JSON.stringify(payload), {
    headers: {
      'content-type': 'application/json'
    }
  });
}

async function sendText(token, chatId, text) {
  const content = text || 'No output.';
  const results = [];

  for (const chunk of splitMessage(content)) {
    const result = await telegramJsonRequest(token, 'sendMessage', {
      chat_id: chatId,
      text: chunk
    });
    results.push(result);
  }

  return results;
}

function sendMessage(token, chatId, text) {
  return telegramJsonRequest(token, 'sendMessage', {
    chat_id: chatId,
    text
  });
}

function editMessageText(token, chatId, messageId, text) {
  return telegramJsonRequest(token, 'editMessageText', {
    chat_id: chatId,
    message_id: messageId,
    text
  });
}

function sendTyping(token, chatId) {
  return telegramJsonRequest(token, 'sendChatAction', {
    chat_id: chatId,
    action: 'typing'
  });
}

function getUpdates(token, payload) {
  return telegramJsonRequest(token, 'getUpdates', payload);
}

function getFile(token, fileId) {
  return telegramJsonRequest(token, 'getFile', { file_id: fileId });
}

function getMe(token) {
  return telegramJsonRequest(token, 'getMe', {});
}

async function downloadFileToPath(token, telegramFilePath, destPath) {
  const url = `https://api.telegram.org/file/bot${token}/${telegramFilePath}`;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Telegram file download failed with status ${response.status}`);
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  fs.mkdirSync(path.dirname(destPath), { recursive: true });
  fs.writeFileSync(destPath, buffer);
  return destPath;
}

async function sendDocument(token, chatId, filePath, options = {}) {
  const form = new FormData();
  form.append('chat_id', String(chatId));

  if (options.caption) {
    form.append('caption', options.caption);
  }

  const filename = options.filename || path.basename(filePath);
  const fileBuffer = fs.readFileSync(filePath);
  form.append('document', new Blob([fileBuffer]), filename);

  return telegramRequest(token, 'sendDocument', form);
}

module.exports = {
  downloadFileToPath,
  editMessageText,
  getFile,
  getMe,
  getUpdates,
  sendDocument,
  sendMessage,
  sendText,
  sendTyping,
  splitMessage,
  telegramJsonRequest,
  telegramRequest
};