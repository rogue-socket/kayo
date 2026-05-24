const fs = require('node:fs');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');

const { REPO_ROOT } = require('./env');

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

function commandExists(command) {
  if (!command) {
    return false;
  }

  if (path.isAbsolute(command) || command.includes(path.sep)) {
    return fs.existsSync(command);
  }

  const probeCommand = process.platform === 'win32' ? 'where.exe' : 'which';
  const probeResult = spawnSync(probeCommand, [command], {
    encoding: 'utf8',
    shell: false
  });

  return probeResult.status === 0;
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

function appendAttachmentArgs(args, attachments) {
  if (!Array.isArray(attachments)) return;
  for (const attachment of attachments) {
    if (attachment && typeof attachment === 'string') {
      args.push('--attachment', attachment);
    }
  }
}

// Parse copilot's `--output-format json` JSONL stream.
// Returns events suitable for downstream consumers:
//   { type: 'chunk', data: '<delta text>' }   — final-answer text deltas
//   { type: 'tool',  data: { name, args, description } } — tool starts
//   { type: 'tool_done', data: { toolCallId, success } } — tool completes
// Filters ephemeral session.* events and intermediate (non-final) deltas.
function createJsonStreamParser() {
  let lineBuffer = '';
  let answerText = '';
  const capturedFromDeltas = new Set();

  function parseLines(text) {
    const events = [];
    lineBuffer += text;
    const lines = lineBuffer.split('\n');
    lineBuffer = lines.pop() || '';

    for (const raw of lines) {
      const line = raw.trim();
      if (!line) continue;
      let evt;
      try {
        evt = JSON.parse(line);
      } catch {
        continue;
      }
      if (!evt || typeof evt.type !== 'string') continue;

      const d = evt.data || {};

      // Streaming mode (--stream on) emits assistant.message_delta events
      // with deltaContent. Collect all of them; tool-call-only messages
      // don't emit deltas, so this naturally captures only response text.
      if (evt.type === 'assistant.message_delta' && typeof d.deltaContent === 'string') {
        answerText += d.deltaContent;
        events.push({ type: 'chunk', data: d.deltaContent });
        if (d.messageId) capturedFromDeltas.add(d.messageId);
        continue;
      }

      // Non-streaming mode (--stream off) skips deltas and only emits a final
      // assistant.message with the full content. Also handles the streaming
      // case's terminating assistant.message — we skip it if we already
      // accumulated the same messageId via deltas, to avoid double-counting.
      if (evt.type === 'assistant.message' && typeof d.content === 'string' && d.content) {
        if (!d.messageId || !capturedFromDeltas.has(d.messageId)) {
          answerText += d.content;
          events.push({ type: 'chunk', data: d.content });
        }
        continue;
      }

      if (evt.type === 'tool.execution_start') {
        const name = d.toolName || 'tool';
        const argDescription =
          (d.arguments && typeof d.arguments.description === 'string' && d.arguments.description) ||
          (d.arguments && typeof d.arguments.command === 'string' && d.arguments.command) ||
          (d.arguments && typeof d.arguments.intent === 'string' && d.arguments.intent) ||
          '';
        events.push({
          type: 'tool',
          data: { name, toolCallId: d.toolCallId, description: argDescription }
        });
        continue;
      }

      if (evt.type === 'tool.execution_complete') {
        events.push({
          type: 'tool_done',
          data: { toolCallId: d.toolCallId, success: d.success === true }
        });
        continue;
      }
    }

    return events;
  }

  return {
    feed: parseLines,
    finalize() {
      return answerText;
    }
  };
}

function runCopilot(prompt, options) {
  const launch = resolveLaunch(options.copilotBin);
  const args = [...launch.prefixArgs, '-p', prompt, '-s', '--output-format', 'json', '--stream', 'off'];

  if (options.resumeSessionId) {
    args.push(`--resume=${options.resumeSessionId}`);
  }

  if (options.model) {
    args.push('--model', options.model);
  }

  appendAttachmentArgs(args, options.attachments);
  args.push(...buildPermissionArgs(options.permissionMode));

  return new Promise((resolve, reject) => {
    const child = spawn(launch.command, args, {
      cwd: REPO_ROOT,
      env: process.env,
      shell: launch.shell,
      stdio: ['ignore', 'pipe', 'pipe']
    });

    if (typeof options.onChild === 'function') {
      try { options.onChild(child); } catch {}
    }

    const parser = createJsonStreamParser();
    let stderr = '';
    let settled = false;

    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      callback(value);
    };

    const timeoutHandle = setTimeout(() => {
      child.kill();
      finish(reject, new Error(`Copilot timed out after ${options.timeoutMs}ms.`));
    }, options.timeoutMs);

    child.stdout.on('data', (chunk) => {
      parser.feed(chunk.toString());
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
      const finalText = parser.finalize().trim();
      const cleanedStderr = stderr.trim();

      if (code === 0) {
        finish(resolve, finalText || cleanedStderr || 'No output.');
        return;
      }

      const parts = ['Copilot command failed.'];
      if (code !== null) parts.push(`Exit code: ${code}`);
      if (signal) parts.push(`Signal: ${signal}`);
      if (finalText) parts.push('', 'partial reply:', finalText);
      if (cleanedStderr) parts.push('', 'stderr:', cleanedStderr);
      finish(reject, new Error(parts.join('\n')));
    });
  });
}

function streamCopilot(prompt, options) {
  const launch = resolveLaunch(options.copilotBin);
  const args = [...launch.prefixArgs, '-p', prompt, '-s', '--output-format', 'json', '--stream', 'on'];

  if (options.resumeSessionId) {
    args.push(`--resume=${options.resumeSessionId}`);
  }

  if (options.model) {
    args.push('--model', options.model);
  }

  appendAttachmentArgs(args, options.attachments);
  args.push(...buildPermissionArgs(options.permissionMode));

  const child = spawn(launch.command, args, {
    cwd: REPO_ROOT,
    env: process.env,
    shell: launch.shell,
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: process.platform !== 'win32'
  });

  if (typeof options.onChild === 'function') {
    try { options.onChild(child); } catch {}
  }

  const parser = createJsonStreamParser();
  const queue = [];
  let pending = null;
  let ended = false;
  let endError = null;
  let stderrAccum = '';

  function pushEvent(event) {
    if (pending) {
      const resolve = pending.resolve;
      pending = null;
      resolve({ value: event, done: false });
    } else {
      queue.push(event);
    }
  }

  function endStream(error) {
    if (ended) return;
    ended = true;
    endError = error || null;
    if (pending) {
      const { resolve, reject } = pending;
      pending = null;
      if (error) reject(error);
      else resolve({ value: undefined, done: true });
    }
  }

  const timeoutHandle = setTimeout(() => {
    try { child.kill(); } catch {}
    pushEvent({ type: 'error', data: `Copilot timed out after ${options.timeoutMs}ms.` });
    endStream();
  }, options.timeoutMs);

  child.stdout.on('data', (chunk) => {
    const events = parser.feed(chunk.toString());
    for (const evt of events) pushEvent(evt);
  });

  child.stderr.on('data', (chunk) => {
    stderrAccum += chunk.toString();
  });

  child.on('error', (error) => {
    clearTimeout(timeoutHandle);
    pushEvent({ type: 'error', data: `Failed to start Copilot: ${error.message}` });
    endStream();
  });

  child.on('close', (code, signal) => {
    clearTimeout(timeoutHandle);
    const finalText = parser.finalize().trim();
    const cleanedStderr = stderrAccum.trim();

    if (code === 0) {
      pushEvent({ type: 'done', data: finalText || cleanedStderr || 'No output.' });
    } else if (signal === 'SIGTERM' || signal === 'SIGKILL') {
      pushEvent({ type: 'error', data: 'cancelled' });
    } else {
      const parts = ['Copilot command failed.'];
      if (code !== null) parts.push(`Exit code: ${code}`);
      if (signal) parts.push(`Signal: ${signal}`);
      if (finalText) parts.push('', 'partial reply:', finalText);
      if (cleanedStderr) parts.push('', 'stderr:', cleanedStderr);
      pushEvent({ type: 'error', data: parts.join('\n') });
    }
    endStream();
  });

  return {
    [Symbol.asyncIterator]() {
      return {
        next() {
          if (queue.length > 0) {
            return Promise.resolve({ value: queue.shift(), done: false });
          }
          if (ended) {
            if (endError) return Promise.reject(endError);
            return Promise.resolve({ value: undefined, done: true });
          }
          return new Promise((resolve, reject) => {
            pending = { resolve, reject };
          });
        },
        return() {
          try { child.kill(); } catch {}
          endStream();
          return Promise.resolve({ value: undefined, done: true });
        }
      };
    }
  };
}

module.exports = {
  createJsonStreamParser,
  buildPermissionArgs,
  commandExists,
  resolveCommand,
  resolveLaunch,
  runCopilot,
  streamCopilot
};
