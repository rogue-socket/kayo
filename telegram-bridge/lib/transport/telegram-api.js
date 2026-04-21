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

async function telegramRequest(token, method, payload, options = {}) {
  const requestOptions = {
    method: 'POST',
    headers: options.headers || {},
    body: payload
  };

  const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, requestOptions);

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

function telegramJsonRequest(token, method, payload) {
  return telegramRequest(token, method, JSON.stringify(payload), {
    headers: {
      'content-type': 'application/json'
    }
  });
}

async function sendText(token, chatId, text) {
  const content = text || 'No output.';

  for (const chunk of splitMessage(content)) {
    await telegramJsonRequest(token, 'sendMessage', {
      chat_id: chatId,
      text: chunk
    });
  }
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
  getUpdates,
  sendDocument,
  sendText,
  sendTyping,
  splitMessage,
  telegramJsonRequest,
  telegramRequest
};