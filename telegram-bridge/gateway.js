const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');

const { loadConfig } = require('./lib/env');
const { resolveCommand, runCopilot } = require('./lib/copilot-cli');

const config = loadConfig();
const resolvedCopilotBin = resolveCommand(config.copilotBin);

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

function enqueuePrompt(sessionId, prompt, requestContext) {
  queuedJobs += 1;

  const run = async () => {
    queuedJobs -= 1;
    activeJob = {
      sessionId,
      startedAt: new Date().toISOString()
    };

    try {
      const nativeSessionMode = config.copilotContextMode === 'native-session';
      const session = nativeSessionMode ? { sessionId: String(sessionId), messages: [] } : loadSession(sessionId);
      const envelopedPrompt = buildPromptEnvelope(
        sessionId,
        session.messages || [],
        prompt,
        requestContext,
        !nativeSessionMode
      );
      const reply = await runCopilot(envelopedPrompt, {
        copilotBin: resolvedCopilotBin,
        timeoutMs: config.copilotTimeoutMs,
        permissionMode: config.copilotPermissionMode,
        model: config.copilotModel,
        resumeSessionId: nativeSessionMode ? String(sessionId) : ''
      });

      if (!nativeSessionMode) {
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
        permissionMode: config.copilotPermissionMode
      });
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

      const startedAt = Date.now();
      const reply = await enqueuePrompt(sessionId, prompt, requestContext);
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
