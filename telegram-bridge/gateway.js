const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');

const BRIDGE_DIR = __dirname;
const REPO_ROOT = path.resolve(BRIDGE_DIR, '..');
const ENV_PATH = path.join(BRIDGE_DIR, '.env');
const STATE_DIR = path.join(BRIDGE_DIR, 'runtime');
const SESSIONS_DIR = path.join(STATE_DIR, 'sessions');

function readEnvFile(filePath) {
  if (!fs.existsSync(filePath)) {
    return;
  }

  const content = fs.readFileSync(filePath, 'utf8');
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) {
      continue;
    }

    const equalsIndex = line.indexOf('=');
    if (equalsIndex === -1) {
      continue;
    }

    const key = line.slice(0, equalsIndex).trim();
    let value = line.slice(equalsIndex + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }

    if (!(key in process.env)) {
      process.env[key] = value;
    }
  }
}

function ensureStateDirs() {
  fs.mkdirSync(SESSIONS_DIR, { recursive: true });
}

function sanitizeSessionId(value) {
  return String(value).replace(/[^a-zA-Z0-9_-]/g, '_');
}

function sessionFilePath(sessionId) {
  return path.join(SESSIONS_DIR, `${sanitizeSessionId(sessionId)}.json`);
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

function saveSession(session, maxTurns) {
  ensureStateDirs();
  const trimmedMessages = session.messages.slice(-(maxTurns * 2));
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

function trimHistory(messages, maxTurns, maxChars) {
  const recent = messages.slice(-(maxTurns * 2));
  const kept = [];
  let usedChars = 0;

  for (let index = recent.length - 1; index >= 0; index -= 1) {
    const entry = recent[index];
    const serialized = `${entry.role}: ${entry.content}`;
    if (kept.length > 0 && usedChars + serialized.length > maxChars) {
      break;
    }
    kept.unshift(entry);
    usedChars += serialized.length;
  }

  return kept;
}

function buildPromptEnvelope(sessionMessages, prompt, maxTurns, maxChars) {
  const cleanedPrompt = prompt.replace(/\r\n/g, '\n').trim();
  const history = trimHistory(sessionMessages, maxTurns, maxChars);

  if (history.length === 0) {
    return cleanedPrompt;
  }

  const transcript = history
    .map((entry) => `${entry.role === 'assistant' ? 'Assistant' : 'User'}: ${entry.content}`)
    .join('\n\n');

  return [
    'Continue this conversation using the repository instructions, skills, and tools available in the current workspace.',
    'Use the prior exchange only as context. Answer the current user message directly.',
    'Recent conversation:',
    transcript,
    'Current user message:',
    cleanedPrompt
  ].join('\n\n');
}

function buildPermissionArgs(mode) {
  if (mode === 'yolo') {
    return ['--yolo'];
  }

  return ['--allow-all-tools', '--allow-all-paths', '--no-ask-user'];
}

function resolveCommand(command) {
  if (path.isAbsolute(command) || command.includes(path.sep)) {
    return command;
  }

  if (process.platform !== 'win32') {
    return command;
  }

  try {
    const result = spawnSync('where.exe', [command], {
      encoding: 'utf8',
      shell: false
    });

    if (result.status !== 0 || !result.stdout) {
      return command;
    }

    const candidates = result.stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);

    return candidates.find((line) => line.toLowerCase().endsWith('.cmd')) || candidates[0] || command;
  } catch {
    return command;
  }
}

function resolveLaunch(command) {
  if (process.platform === 'win32' && /copilot\.cmd$/i.test(command)) {
    const loaderPath = path.join(path.dirname(command), 'node_modules', '@github', 'copilot', 'npm-loader.js');
    if (fs.existsSync(loaderPath)) {
      return {
        command: process.execPath,
        prefixArgs: [loaderPath],
        shell: false
      };
    }
  }

  return {
    command,
    prefixArgs: [],
    shell: process.platform === 'win32' && /\.(cmd|bat)$/i.test(command)
  };
}

function runCopilot(prompt, options) {
  const launch = resolveLaunch(options.copilotBin);
  const args = [...launch.prefixArgs, '-p', prompt, '-s', '--output-format', 'text', '--stream', 'off'];

  if (options.model) {
    args.push('--model', options.model);
  }

  args.push(...buildPermissionArgs(options.permissionMode));

  return new Promise((resolve, reject) => {
    const child = spawn(launch.command, args, {
      cwd: REPO_ROOT,
      env: process.env,
      shell: launch.shell,
      stdio: ['ignore', 'pipe', 'pipe']
    });

    let stdout = '';
    let stderr = '';
    let settled = false;

    const finish = (callback, value) => {
      if (settled) {
        return;
      }
      settled = true;
      callback(value);
    };

    const timeoutHandle = setTimeout(() => {
      child.kill();
      finish(reject, new Error(`Copilot timed out after ${options.timeoutMs}ms.`));
    }, options.timeoutMs);

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    child.on('error', (error) => {
      clearTimeout(timeoutHandle);
      finish(reject, new Error(`Failed to start Copilot: ${error.message}`));
    });

    child.on('close', (code, signal) => {
      clearTimeout(timeoutHandle);
      const cleanedStdout = stdout.trim();
      const cleanedStderr = stderr.trim();

      if (code === 0) {
        finish(resolve, cleanedStdout || cleanedStderr || 'No output.');
        return;
      }

      const parts = ['Copilot command failed.'];
      if (code !== null) {
        parts.push(`Exit code: ${code}`);
      }
      if (signal) {
        parts.push(`Signal: ${signal}`);
      }
      if (cleanedStdout) {
        parts.push('', 'stdout:', cleanedStdout);
      }
      if (cleanedStderr) {
        parts.push('', 'stderr:', cleanedStderr);
      }
      finish(reject, new Error(parts.join('\n')));
    });
  });
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

readEnvFile(ENV_PATH);
ensureStateDirs();

const gatewayHost = process.env.GATEWAY_HOST || '127.0.0.1';
const gatewayPort = Number(process.env.GATEWAY_PORT || 8787);
const gatewaySharedToken = process.env.GATEWAY_SHARED_TOKEN || '';
const copilotBin = process.env.COPILOT_BIN || 'copilot';
const resolvedCopilotBin = resolveCommand(copilotBin);
const copilotTimeoutMs = Number(process.env.COPILOT_TIMEOUT_MS || 600000);
const copilotHistoryTurns = Number(process.env.COPILOT_HISTORY_TURNS || 6);
const copilotHistoryChars = Number(process.env.COPILOT_HISTORY_CHARS || 6000);
const copilotPermissionMode = process.env.COPILOT_PERMISSION_MODE || 'tools';
const copilotModel = (process.env.COPILOT_MODEL || '').trim();

let activeJob = null;
let queuedJobs = 0;
let queueTail = Promise.resolve();

function assertAuthorized(req) {
  if (!gatewaySharedToken) {
    return;
  }

  if (req.headers['x-gateway-token'] !== gatewaySharedToken) {
    const error = new Error('Unauthorized gateway request.');
    error.statusCode = 401;
    throw error;
  }
}

function enqueuePrompt(sessionId, prompt) {
  queuedJobs += 1;

  const run = async () => {
    queuedJobs -= 1;
    activeJob = {
      sessionId,
      startedAt: new Date().toISOString()
    };

    try {
      const session = loadSession(sessionId);
      const envelopedPrompt = buildPromptEnvelope(
        session.messages || [],
        prompt,
        copilotHistoryTurns,
        copilotHistoryChars
      );
      const reply = await runCopilot(envelopedPrompt, {
        copilotBin: resolvedCopilotBin,
        timeoutMs: copilotTimeoutMs,
        permissionMode: copilotPermissionMode,
        model: copilotModel
      });

      session.messages = [
        ...(session.messages || []),
        { role: 'user', content: prompt.trim(), createdAt: new Date().toISOString() },
        { role: 'assistant', content: reply, createdAt: new Date().toISOString() }
      ];
      saveSession(session, copilotHistoryTurns);

      return reply;
    } finally {
      activeJob = null;
    }
  };

  const resultPromise = queueTail.then(run, run);
  queueTail = resultPromise.catch(() => {});
  return resultPromise;
}

const server = http.createServer(async (req, res) => {
  try {
    assertAuthorized(req);

    if (req.method === 'GET' && req.url === '/v1/status') {
      writeJson(res, 200, {
        ok: true,
        queuedJobs,
        active: activeJob,
        repoRoot: REPO_ROOT,
        copilotBin: resolvedCopilotBin,
        permissionMode: copilotPermissionMode
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

      if (!sessionId) {
        writeJson(res, 400, { error: 'sessionId is required.' });
        return;
      }

      if (!prompt) {
        writeJson(res, 400, { error: 'prompt is required.' });
        return;
      }

      const startedAt = Date.now();
      const reply = await enqueuePrompt(sessionId, prompt);
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

server.listen(gatewayPort, gatewayHost, () => {
  console.log(`Copilot gateway listening on http://${gatewayHost}:${gatewayPort}`);
  console.log(`Repo root: ${REPO_ROOT}`);
  console.log(`Copilot binary: ${resolvedCopilotBin}`);
  console.log(`Permission mode: ${copilotPermissionMode}`);
});
