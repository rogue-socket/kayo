const http = require('node:http');
const url = require('node:url');

const { createSession, getSession, closeSession, listSessions, shutdown } = require('./lib/browser');
const { searchDuckDuckGo } = require('./lib/search');
const { openUrl, readSelector } = require('./lib/extract');
const { clickElement, scrollPage, findInPage } = require('./lib/actions');

const HOST = process.env.WEB_BROWSER_HOST || '127.0.0.1';
const PORT = Number(process.env.WEB_BROWSER_PORT) || 8788;
const MAX_BODY_BYTES = 64 * 1024;

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body)
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    req.on('data', (chunk) => {
      total += chunk.length;
      if (total > MAX_BODY_BYTES) {
        reject(new Error(`Request body exceeded ${MAX_BODY_BYTES} bytes`));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch (err) {
        reject(new Error(`Invalid JSON body: ${err.message}`));
      }
    });
    req.on('error', reject);
  });
}

const routes = {
  'GET /v1/status': async () => ({
    ok: true,
    sessions: listSessions(),
    uptimeSeconds: Math.floor(process.uptime())
  }),

  'POST /v1/session': async (body) => {
    const id = await createSession({ hosts: Array.isArray(body.hosts) ? body.hosts : [] });
    return { sessionId: id };
  },

  'GET /v1/sessions': async () => ({ sessions: listSessions() }),

  'POST /v1/search': async (body) => {
    if (!body.q || typeof body.q !== 'string') {
      throw httpError(400, 'q (string) is required');
    }
    const limit = Math.min(Math.max(Number(body.limit) || 8, 1), 20);
    const results = await searchDuckDuckGo(body.q, limit);
    return { query: body.q, results };
  },

  'POST /v1/open': async (body) => {
    if (!body.url || typeof body.url !== 'string') {
      throw httpError(400, 'url (string) is required');
    }
    let sessionId = body.sessionId;
    let session;
    if (sessionId) {
      session = getSession(sessionId);
    } else {
      sessionId = await createSession({ hosts: inferHostsFromUrl(body.url) });
      session = getSession(sessionId);
    }
    const result = await openUrl(session, body.url);
    return { sessionId, ...result };
  },

  'POST /v1/read': async (body) => {
    if (!body.sessionId) throw httpError(400, 'sessionId is required');
    const session = getSession(body.sessionId);
    const result = await readSelector(session, body.selector);
    return { sessionId: body.sessionId, ...result };
  },

  'POST /v1/click': async (body) => {
    if (!body.sessionId) throw httpError(400, 'sessionId is required');
    if (!body.text && !body.selector) throw httpError(400, 'either text or selector is required');
    const session = getSession(body.sessionId);
    const result = await clickElement(session, {
      text: body.text,
      selector: body.selector,
      confirm: body.confirm === true
    });
    return { sessionId: body.sessionId, ...result };
  },

  'POST /v1/scroll': async (body) => {
    if (!body.sessionId) throw httpError(400, 'sessionId is required');
    const session = getSession(body.sessionId);
    const result = await scrollPage(session, {
      direction: body.direction,
      amount: body.amount
    });
    return { sessionId: body.sessionId, ...result };
  },

  'POST /v1/find': async (body) => {
    if (!body.sessionId) throw httpError(400, 'sessionId is required');
    if (!body.pattern) throw httpError(400, 'pattern is required');
    const session = getSession(body.sessionId);
    const result = await findInPage(session, { pattern: body.pattern });
    return { sessionId: body.sessionId, ...result };
  }
};

function inferHostsFromUrl(rawUrl) {
  try {
    const u = new URL(rawUrl);
    const host = u.hostname.replace(/^www\./, '').toLowerCase();
    if (host === 'twitter.com' || host === 'x.com' || host === 'mobile.twitter.com') return ['x.com'];
    return [];
  } catch {
    return [];
  }
}

function httpError(status, message) {
  const err = new Error(message);
  err.statusCode = status;
  return err;
}

function shortId(id) {
  return id ? String(id).slice(0, 8) : '';
}

function summarizeRequest(body, result) {
  const parts = [];
  if (body && body.q) parts.push(`q=${JSON.stringify(String(body.q).slice(0, 60))}`);
  if (body && body.url) parts.push(`url=${String(body.url).slice(0, 80)}`);
  if (body && body.selector) parts.push(`selector=${JSON.stringify(String(body.selector).slice(0, 40))}`);
  if (body && body.text && !body.q) parts.push(`text=${JSON.stringify(String(body.text).slice(0, 40))}`);
  if (body && body.pattern) parts.push(`pattern=${JSON.stringify(String(body.pattern).slice(0, 40))}`);
  if (body && body.direction) parts.push(`dir=${body.direction}`);
  if (body && body.confirm) parts.push('confirm=true');
  const sid = (body && body.sessionId) || (result && result.sessionId);
  if (sid) parts.push(`session=${shortId(sid)}`);
  if (result && result.status) parts.push(`status=${result.status}`);
  if (result && result.reason) parts.push(`reason=${result.reason}`);
  if (result && typeof result.httpStatus === 'number') parts.push(`http=${result.httpStatus}`);
  if (result && typeof result.fullTextChars === 'number') parts.push(`chars=${result.fullTextChars}`);
  if (result && Array.isArray(result.results)) parts.push(`results=${result.results.length}`);
  if (result && Array.isArray(result.links)) parts.push(`links=${result.links.length}`);
  if (result && Array.isArray(result.matches)) parts.push(`matches=${result.matches.length}`);
  if (result && typeof result.scrollY === 'number') parts.push(`y=${result.scrollY}`);
  if (result && result.bottomReached === true) parts.push('bottom=true');
  return parts.join(' ');
}

function logAccess({ method, pathname, status, ms, body, result, errorMsg }) {
  const prefix = `[web-browser] ${method} ${pathname} ${status} ${ms}ms`;
  if (errorMsg) {
    console.log(`${prefix} error=${JSON.stringify(errorMsg.slice(0, 160))}`);
    return;
  }
  const summary = summarizeRequest(body, result);
  console.log(summary ? `${prefix} ${summary}` : prefix);
}

const server = http.createServer(async (req, res) => {
  const start = Date.now();
  const parsedUrl = url.parse(req.url || '/', true);
  const pathname = parsedUrl.pathname || '/';
  const method = req.method || 'GET';
  let body = {};
  let result = null;
  let status = 200;
  let errorMsg = null;

  try {
    if (method === 'DELETE' && pathname.startsWith('/v1/session/')) {
      const id = decodeURIComponent(pathname.slice('/v1/session/'.length));
      const ok = await closeSession(id);
      status = ok ? 200 : 404;
      body = { sessionId: id };
      result = { ok };
      sendJson(res, status, result);
    } else {
      const key = `${method} ${pathname}`;
      const handler = routes[key];
      if (!handler) {
        status = 404;
        errorMsg = `Unknown route: ${key}`;
        sendJson(res, status, { error: errorMsg });
      } else {
        body = method === 'GET' || method === 'DELETE' ? {} : await readBody(req);
        result = await handler(body, parsedUrl.query || {});
        sendJson(res, 200, result);
      }
    }
  } catch (err) {
    status = err.statusCode || 500;
    errorMsg = err.message;
    sendJson(res, status, { error: errorMsg });
    if (status >= 500) console.error(`[${method} ${pathname}] ${err.stack || err.message}`);
  } finally {
    logAccess({ method, pathname, status, ms: Date.now() - start, body, result, errorMsg });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`web-browser listening on http://${HOST}:${PORT}`);
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, async () => {
    console.log(`web-browser received ${signal}, shutting down`);
    try { await shutdown(); } catch {}
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(1), 5000).unref();
  });
}
