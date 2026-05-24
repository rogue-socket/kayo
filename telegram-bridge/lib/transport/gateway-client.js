async function gatewayRequest(config, method, endpoint, payload) {
  const headers = {};

  if (payload !== undefined) {
    headers['content-type'] = 'application/json';
  }

  if (config.gatewaySharedToken) {
    headers['x-gateway-token'] = config.gatewaySharedToken;
  }

  const response = await fetch(`${config.gatewayBaseUrl}${endpoint}`, {
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

function promptGateway(config, payload) {
  return gatewayRequest(config, 'POST', '/v1/prompt', payload);
}

function parseSseBlock(block) {
  let type = 'message';
  const dataLines = [];
  for (const line of block.split('\n')) {
    if (line.startsWith('event:')) {
      type = line.slice(6).trim();
    } else if (line.startsWith('data:')) {
      let value = line.slice(5);
      if (value.startsWith(' ')) value = value.slice(1);
      dataLines.push(value);
    }
  }
  if (dataLines.length === 0 && type === 'message') return null;
  return { type, data: dataLines.join('\n') };
}

async function* streamGateway(config, payload) {
  const headers = {
    'content-type': 'application/json',
    accept: 'text/event-stream'
  };

  if (config.gatewaySharedToken) {
    headers['x-gateway-token'] = config.gatewaySharedToken;
  }

  const response = await fetch(`${config.gatewayBaseUrl}/v1/prompt`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ ...payload, stream: true })
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Gateway stream request failed with status ${response.status}: ${text}`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      let separator;
      while ((separator = buffer.indexOf('\n\n')) !== -1) {
        const block = buffer.slice(0, separator);
        buffer = buffer.slice(separator + 2);
        const event = parseSseBlock(block);
        if (event) yield event;
      }
    }

    if (buffer.trim()) {
      const event = parseSseBlock(buffer);
      if (event) yield event;
    }
  } finally {
    try { reader.releaseLock(); } catch {}
  }
}

function resetGatewaySession(config, sessionId) {
  return gatewayRequest(config, 'POST', '/v1/reset', { sessionId });
}

function cancelGateway(config, payload = {}) {
  return gatewayRequest(config, 'POST', '/v1/cancel', payload);
}

function getGatewayStatus(config) {
  return gatewayRequest(config, 'GET', '/v1/status');
}

function getGatewayModel(config) {
  return gatewayRequest(config, 'GET', '/v1/model');
}

function setGatewayModel(config, model) {
  return gatewayRequest(config, 'POST', '/v1/model', { model });
}

module.exports = {
  cancelGateway,
  gatewayRequest,
  getGatewayModel,
  getGatewayStatus,
  promptGateway,
  resetGatewaySession,
  setGatewayModel,
  streamGateway
};