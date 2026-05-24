const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');

const { ENV_PATH, loadConfig } = require('./lib/env');
const { resolveCommand, runCopilot, streamCopilot } = require('./lib/copilot-cli');
const { createLogger } = require('./lib/logger');

const config = loadConfig();
const resolvedCopilotBin = resolveCommand(config.copilotBin);
let currentModel = config.copilotModel || '';
const log = createLogger('gateway');

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

function computeTotalChars(messages) {
  let total = 0;
  for (const m of messages || []) {
    if (m && typeof m.content === 'string') total += m.content.length;
  }
  return total;
}

function normalizeSession(raw, sessionId) {
  const base = raw && typeof raw === 'object' ? raw : {};
  const messages = Array.isArray(base.messages) ? base.messages : [];
  const nowIso = new Date().toISOString();
  return {
    sessionId: String(base.sessionId || sessionId),
    label: typeof base.label === 'string' ? base.label : '',
    createdAt: base.createdAt || base.updatedAt || nowIso,
    updatedAt: base.updatedAt || nowIso,
    lastActiveAt: base.lastActiveAt || base.updatedAt || nowIso,
    turnCount: Number.isFinite(base.turnCount) ? base.turnCount : messages.length,
    totalChars: Number.isFinite(base.totalChars) ? base.totalChars : computeTotalChars(messages),
    messages
  };
}

function loadSession(sessionId) {
  const filePath = sessionFilePath(sessionId);
  if (!fs.existsSync(filePath)) {
    return normalizeSession(null, sessionId);
  }

  try {
    return normalizeSession(JSON.parse(fs.readFileSync(filePath, 'utf8')), sessionId);
  } catch {
    return normalizeSession(null, sessionId);
  }
}

function saveSession(session) {
  ensureStateDirs();
  const trimmedMessages = session.messages.slice(-(config.copilotHistoryTurns * 2));
  const now = new Date().toISOString();
  const payload = {
    sessionId: session.sessionId,
    label: typeof session.label === 'string' ? session.label : '',
    createdAt: session.createdAt || now,
    updatedAt: now,
    lastActiveAt: now,
    turnCount: trimmedMessages.length,
    totalChars: computeTotalChars(trimmedMessages),
    messages: trimmedMessages
  };
  fs.writeFileSync(sessionFilePath(session.sessionId), JSON.stringify(payload, null, 2));
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
  const attachments = Array.isArray(options.attachments)
    ? options.attachments.filter((p) => typeof p === 'string' && p)
    : [];

  const run = async () => {
    queuedJobs -= 1;
    activeJob = {
      sessionId,
      startedAt: new Date().toISOString(),
      child: null,
      cancelled: false
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
        resumeSessionId: nativeSessionMode ? String(sessionId) : '',
        attachments,
        onChild: (child) => { if (activeJob) activeJob.child = child; }
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
  let text;
  if (data === undefined || data === null) {
    text = '';
  } else if (typeof data === 'string') {
    text = data;
  } else {
    text = JSON.stringify(data);
  }
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
      const previousModel = currentModel;
      currentModel = model;
      try {
        persistModelToEnv(model);
      } catch (error) {
        log.error('model_change_failed', { from: previousModel, to: model, error: error.message });
        writeJson(res, 500, { error: `Failed to persist model: ${error.message}` });
        return;
      }
      log.info('model_changed', { from: previousModel || '(default)', to: currentModel || '(default)' });
      writeJson(res, 200, { ok: true, model: currentModel });
      return;
    }

    if (req.method === 'POST' && req.url === '/v1/cancel') {
      const cancelBody = await readJsonBody(req);
      const requestedSessionId = cancelBody.sessionId ? String(cancelBody.sessionId) : null;

      if (!activeJob || !activeJob.child) {
        writeJson(res, 200, { ok: false, message: 'No active job to cancel.' });
        return;
      }
      if (requestedSessionId && activeJob.sessionId !== requestedSessionId) {
        writeJson(res, 200, {
          ok: false,
          message: `Active job is on session "${activeJob.sessionId}", not "${requestedSessionId}".`
        });
        return;
      }
      activeJob.cancelled = true;
      const childAtCancel = activeJob.child;
      const sessionAtCancel = activeJob.sessionId;
      function killTree(signal) {
        try {
          // Negative pid kills the whole process group (works when child was
          // spawned with detached:true). Falls back to direct signal if not.
          if (childAtCancel.pid) {
            try { process.kill(-childAtCancel.pid, signal); return; } catch {}
          }
          childAtCancel.kill(signal);
        } catch {}
      }
      try { killTree('SIGTERM'); } catch (err) {
        log.error('cancel_signal_failed', { session_id: sessionAtCancel, error: err.message });
        writeJson(res, 500, { error: `Failed to signal copilot: ${err.message}` });
        return;
      }
      // Escalate to SIGKILL if copilot doesn't exit promptly. `child.killed`
      // is set as soon as a signal is *sent*, not when the process dies — so
      // we check exitCode/signalCode to detect actual termination.
      setTimeout(() => {
        if (childAtCancel.exitCode === null && childAtCancel.signalCode === null) {
          log.warn('cancel_escalated_sigkill', { session_id: sessionAtCancel });
          killTree('SIGKILL');
        }
      }, 1500);
      log.info('cancel_signalled', { session_id: sessionAtCancel, signal: 'SIGTERM' });
      writeJson(res, 200, { ok: true, cancelled: true, sessionId: sessionAtCancel });
      return;
    }

    if (req.method === 'POST' && req.url === '/v1/reset') {
      const body = await readJsonBody(req);
      if (!body.sessionId) {
        writeJson(res, 400, { error: 'sessionId is required.' });
        return;
      }

      resetSession(String(body.sessionId));
      log.info('session_reset', { session_id: String(body.sessionId) });
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
      const attachments = Array.isArray(body.attachments)
        ? body.attachments.filter((p) => typeof p === 'string' && p)
        : [];

      log.info('prompt_received', {
        session_id: sessionId,
        chars: prompt.length,
        attachments: attachments.length,
        stream: body.stream === true,
        bare,
        channel: requestContext && requestContext.channel
      });
      const promptStartedAt = Date.now();

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
        let replyChars = 0;
        const onEvent = (event) => {
          if (event.type === 'error') errorEmitted = true;
          if (event.type === 'done' && typeof event.data === 'string') replyChars = event.data.length;
          writeSseEvent(res, event.type, event.data);
        };

        try {
          await enqueuePrompt(sessionId, prompt, requestContext, { onEvent, bare, attachments });
          log.info('prompt_completed', {
            session_id: sessionId,
            latency_ms: Date.now() - promptStartedAt,
            reply_chars: replyChars,
            stream: true
          });
        } catch (error) {
          log.error('prompt_failed', {
            session_id: sessionId,
            latency_ms: Date.now() - promptStartedAt,
            error: error.message,
            stream: true
          });
          if (!error.alreadyReported && !errorEmitted) {
            writeSseEvent(res, 'error', error.message || 'Unknown gateway error.');
          }
        }
        res.end();
        return;
      }

      try {
        const reply = await enqueuePrompt(sessionId, prompt, requestContext, { bare, attachments });
        log.info('prompt_completed', {
          session_id: sessionId,
          latency_ms: Date.now() - promptStartedAt,
          reply_chars: typeof reply === 'string' ? reply.length : 0,
          stream: false
        });
        writeJson(res, 200, {
          ok: true,
          sessionId,
          reply,
          elapsedMs: Date.now() - promptStartedAt
        });
      } catch (error) {
        log.error('prompt_failed', {
          session_id: sessionId,
          latency_ms: Date.now() - promptStartedAt,
          error: error.message,
          stream: false
        });
        throw error;
      }
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
  log.info('gateway_started', {
    url: `http://${config.gatewayHost}:${config.gatewayPort}`,
    repo_root: config.repoRoot,
    copilot_bin: resolvedCopilotBin,
    permission_mode: config.copilotPermissionMode,
    context_mode: config.copilotContextMode,
    model: currentModel || '(default)'
  });
});
