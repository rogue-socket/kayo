const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');

const { ENV_PATH, loadConfig } = require('./lib/env');
const { resolveCommand, runCopilot, streamCopilot } = require('./lib/copilot-cli');

const config = loadConfig();
const resolvedCopilotBin = resolveCommand(config.copilotBin);
let currentModel = config.copilotModel || '';

function persistModelToEnv(model) {
  const value = (model || '').trim();
  let content = '';
  if (fs.existsSync(ENV_PATH)) {
    content = fs.readFileSync(ENV_PATH, 'utf8');
  }

  const lines = content.split(/\r?\n/);
  let found = false;
  const updated = lines.map((line) => {
    if (/^\s*COPILOT_MODEL\s*=/.test(line)) {
      found = true;
      return `COPILOT_MODEL=${value}`;
    }
    return line;
  });

  if (!found) {
    if (updated.length > 0 && updated[updated.length - 1] === '') {
      updated.splice(updated.length - 1, 0, `COPILOT_MODEL=${value}`);
    } else {
      updated.push(`COPILOT_MODEL=${value}`);
    }
  }

  fs.writeFileSync(ENV_PATH, updated.join('\n'));
}

function ensureStateDirs() {
  fs.mkdirSync(config.sessionsDir, { recursive: true });
}

function sanitizeSessionId(value) {
  return String(value).replace(/[^a-zA-Z0-9_-]/g, '_');
}

function sessionFilePath(sessionId) {
  return path.join(config.sessionsDir, `${sanitizeSessionId(sessionId)}.json`);
}

function loadSession(sessionId) {
  const filePath = sessionFilePath(sessionId);
  if (!fs.existsSync(filePath)) {
    return { sessionId: String(sessionId), messages: [] };
  }

  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return { sessionId: String(sessionId), messages: [] };
  }
}

function saveSession(session) {
  ensureStateDirs();
  const trimmedMessages = session.messages.slice(-(config.copilotHistoryTurns * 2));
  fs.writeFileSync(
    sessionFilePath(session.sessionId),
    JSON.stringify(
      {
        sessionId: session.sessionId,
        updatedAt: new Date().toISOString(),
        messages: trimmedMessages
      },
      null,
      2
    )
  );
}

function resetSession(sessionId) {
  const filePath = sessionFilePath(sessionId);
  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
  }
}

function trimHistory(messages) {
  const recent = messages.slice(-(config.copilotHistoryTurns * 2));
  const kept = [];
  let usedChars = 0;

  for (let index = recent.length - 1; index >= 0; index -= 1) {
    const entry = recent[index];
    const serialized = `${entry.role}: ${entry.content}`;
    if (kept.length > 0 && usedChars + serialized.length > config.copilotHistoryChars) {
      break;
    }

    kept.unshift(entry);
    usedChars += serialized.length;
  }

  return kept;
}

function formatRequestContext(sessionId, requestContext) {
  const lines = [`session_id: ${sessionId}`];
  if (!requestContext || typeof requestContext !== 'object') {
    return lines.join('\n');
  }

  for (const [key, value] of Object.entries(requestContext)) {
    if (value === undefined || value === null || value === '') {
      continue;
    }

    lines.push(`${key}: ${typeof value === 'string' ? value : JSON.stringify(value)}`);
  }

  return lines.join('\n');
}

function readHealthProbeSummary() {
  const probePath = config.healthProbe && config.healthProbe.statePath;
  if (!probePath || !fs.existsSync(probePath)) {
    return null;
  }

  try {
    const raw = JSON.parse(fs.readFileSync(probePath, 'utf8'));
    return {
      lastTier1At: raw.lastTier1At || null,
      lastTier2At: raw.lastTier2At || null,
      lastResult: raw.lastResult || null,
      lastError: raw.lastError || null,
      lastErrorClass: raw.lastErrorClass || null
    };
  } catch {
    return null;
  }
}

function buildPromptEnvelope(sessionId, sessionMessages, prompt, requestContext, includeHistory) {
  const cleanedPrompt = prompt.replace(/\r\n/g, '\n').trim();
  const history = includeHistory ? trimHistory(sessionMessages) : [];
  const sections = [
    'Continue this conversation using the repository instructions, skills, and tools available in the current workspace.',
    'Treat the request context block as authoritative metadata from the caller.',
    'Use the prior exchange only as context. Answer the current user message directly.',
    'Request context:',
    formatRequestContext(sessionId, requestContext)
  ];

  if (requestContext && requestContext.channel === 'telegram' && requestContext.telegram_chat_id) {
    sections.push('If the user asks to create a scheduled workflow and does not specify a delivery target, default Telegram delivery to telegram_chat_id from the request context.');
  }

  if (history.length > 0) {
    const transcript = history
      .map((entry) => `${entry.role === 'assistant' ? 'Assistant' : 'User'}: ${entry.content}`)
      .join('\n\n');

    sections.push('Recent conversation:', transcript);
  }

  sections.push('Current user message:', cleanedPrompt);
  return sections.join('\n\n');
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';

    req.on('data', (chunk) => {
      body += chunk.toString();
      if (body.length > 1024 * 1024) {
        reject(new Error('Request body too large.'));
        req.destroy();
      }
    });

    req.on('end', () => {
      if (!body) {
        resolve({});
        return;
      }

      try {
        resolve(JSON.parse(body));
      } catch {
        reject(new Error('Invalid JSON body.'));
      }
    });

    req.on('error', reject);
  });
}

function writeJson(res, statusCode, payload) {
  res.writeHead(statusCode, {
    'content-type': 'application/json; charset=utf-8'
  });
  res.end(JSON.stringify(payload));
}

let activeJob = null;
let queuedJobs = 0;
let queueTail = Promise.resolve();

function assertAuthorized(req) {
  if (!config.gatewaySharedToken) {
    return;
  }

  if (req.headers['x-gateway-token'] !== config.gatewaySharedToken) {
    const error = new Error('Unauthorized gateway request.');
    error.statusCode = 401;
    throw error;
  }
}

function enqueuePrompt(sessionId, prompt, requestContext, options = {}) {
  queuedJobs += 1;
  const onEvent = typeof options.onEvent === 'function' ? options.onEvent : null;
  const bare = options.bare === true;

  const run = async () => {
    queuedJobs -= 1;
    activeJob = {
      sessionId,
      startedAt: new Date().toISOString()
    };

    try {
      const nativeSessionMode = !bare && config.copilotContextMode === 'native-session';
      const session = (bare || nativeSessionMode)
        ? { sessionId: String(sessionId), messages: [] }
        : loadSession(sessionId);
      const envelopedPrompt = bare
        ? prompt.replace(/\r\n/g, '\n').trim()
        : buildPromptEnvelope(sessionId, session.messages || [], prompt, requestContext, !nativeSessionMode);
      const copilotOptions = {
        copilotBin: resolvedCopilotBin,
        timeoutMs: config.copilotTimeoutMs,
        permissionMode: config.copilotPermissionMode,
        model: currentModel,
        resumeSessionId: nativeSessionMode ? String(sessionId) : ''
      };

      let reply;
      if (onEvent) {
        let streamErr = null;
        for await (const event of streamCopilot(envelopedPrompt, copilotOptions)) {
          onEvent(event);
          if (event.type === 'done') reply = event.data;
          if (event.type === 'error') streamErr = new Error(event.data);
        }
        if (streamErr) {
          streamErr.alreadyReported = true;
          throw streamErr;
        }
        if (reply === undefined) reply = '';
      } else {
        reply = await runCopilot(envelopedPrompt, copilotOptions);
      }

      if (!bare && !nativeSessionMode) {
        session.messages = [
          ...(session.messages || []),
          { role: 'user', content: prompt.trim(), createdAt: new Date().toISOString() },
          { role: 'assistant', content: reply, createdAt: new Date().toISOString() }
        ];
        saveSession(session);
      }

      return reply;
    } finally {
      activeJob = null;
    }
  };

  const resultPromise = queueTail.then(run, run);
  queueTail = resultPromise.catch(() => {});
  return resultPromise;
}

function writeSseEvent(res, type, data) {
  res.write(`event: ${type}\n`);
  const text = data === undefined || data === null ? '' : String(data);
  for (const line of text.split('\n')) {
    res.write(`data: ${line}\n`);
  }
  res.write('\n');
}

ensureStateDirs();

const server = http.createServer(async (req, res) => {
  try {
    assertAuthorized(req);

    if (req.method === 'GET' && req.url === '/v1/status') {
      writeJson(res, 200, {
        ok: true,
        queuedJobs,
        active: activeJob,
        repoRoot: config.repoRoot,
        copilotBin: resolvedCopilotBin,
        permissionMode: config.copilotPermissionMode,
        model: currentModel,
        healthProbe: readHealthProbeSummary()
      });
      return;
    }

    if (req.method === 'GET' && req.url === '/v1/model') {
      writeJson(res, 200, { ok: true, model: currentModel });
      return;
    }

    if (req.method === 'POST' && req.url === '/v1/model') {
      const body = await readJsonBody(req);
      const model = typeof body.model === 'string' ? body.model.trim() : '';
      currentModel = model;
      try {
        persistModelToEnv(model);
      } catch (error) {
        writeJson(res, 500, { error: `Failed to persist model: ${error.message}` });
        return;
      }
      writeJson(res, 200, { ok: true, model: currentModel });
      return;
    }

    if (req.method === 'POST' && req.url === '/v1/reset') {
      const body = await readJsonBody(req);
      if (!body.sessionId) {
        writeJson(res, 400, { error: 'sessionId is required.' });
        return;
      }

      resetSession(String(body.sessionId));
      writeJson(res, 200, { ok: true, sessionId: String(body.sessionId) });
      return;
    }

    if (req.method === 'POST' && req.url === '/v1/prompt') {
      const body = await readJsonBody(req);
      const sessionId = body.sessionId ? String(body.sessionId) : '';
      const prompt = typeof body.prompt === 'string' ? body.prompt.trim() : '';
      const requestContext = body.context && typeof body.context === 'object' ? body.context : {};

      if (!sessionId) {
        writeJson(res, 400, { error: 'sessionId is required.' });
        return;
      }

      if (!prompt) {
        writeJson(res, 400, { error: 'prompt is required.' });
        return;
      }

      const bare = body.bare === true;

      if (body.stream === true) {
        res.writeHead(200, {
          'content-type': 'text/event-stream; charset=utf-8',
          'cache-control': 'no-cache',
          connection: 'keep-alive'
        });
        if (typeof res.flushHeaders === 'function') {
          res.flushHeaders();
        }

        let errorEmitted = false;
        const onEvent = (event) => {
          if (event.type === 'error') errorEmitted = true;
          writeSseEvent(res, event.type, event.data);
        };

        try {
          await enqueuePrompt(sessionId, prompt, requestContext, { onEvent, bare });
        } catch (error) {
          if (!error.alreadyReported && !errorEmitted) {
            writeSseEvent(res, 'error', error.message || 'Unknown gateway error.');
          }
        }
        res.end();
        return;
      }

      const startedAt = Date.now();
      const reply = await enqueuePrompt(sessionId, prompt, requestContext, { bare });
      writeJson(res, 200, {
        ok: true,
        sessionId,
        reply,
        elapsedMs: Date.now() - startedAt
      });
      return;
    }

    writeJson(res, 404, { error: 'Not found.' });
  } catch (error) {
    writeJson(res, error.statusCode || 500, {
      error: error.message || 'Unknown gateway error.'
    });
  }
});

server.listen(config.gatewayPort, config.gatewayHost, () => {
  console.log(`Copilot gateway listening on http://${config.gatewayHost}:${config.gatewayPort}`);
  console.log(`Repo root: ${config.repoRoot}`);
  console.log(`Copilot binary: ${resolvedCopilotBin}`);
  console.log(`Permission mode: ${config.copilotPermissionMode}`);
});
