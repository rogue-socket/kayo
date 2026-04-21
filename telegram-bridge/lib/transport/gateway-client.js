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

function resetGatewaySession(config, sessionId) {
  return gatewayRequest(config, 'POST', '/v1/reset', { sessionId });
}

function getGatewayStatus(config) {
  return gatewayRequest(config, 'GET', '/v1/status');
}

module.exports = {
  gatewayRequest,
  getGatewayStatus,
  promptGateway,
  resetGatewaySession
};