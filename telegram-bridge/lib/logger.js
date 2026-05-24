const fs = require('node:fs');
const path = require('node:path');
const { STATE_DIR } = require('./env');

const LOGS_DIR = path.join(STATE_DIR, 'logs');
const EVENTS_PATH = path.join(LOGS_DIR, 'events.jsonl');

let seq = 0;
let dirEnsured = false;

function ensureDir() {
  if (dirEnsured) return;
  fs.mkdirSync(LOGS_DIR, { recursive: true });
  dirEnsured = true;
}

function formatValue(value) {
  if (value === null || value === undefined) return '-';
  if (typeof value === 'string') {
    const truncated = value.length > 80 ? value.slice(0, 77) + '...' : value;
    if (truncated.includes(' ') || truncated.includes('=')) return JSON.stringify(truncated);
    return truncated;
  }
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

function pretty(event) {
  const { ts: _t, level, component, type, seq: _s, pid: _p, ...rest } = event;
  const fields = Object.entries(rest)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => `${k}=${formatValue(v)}`)
    .join(' ');
  const lvl = level === 'info' ? '' : ` [${level}]`;
  return `[${component}]${lvl} ${type}${fields ? ' ' + fields : ''}`;
}

function logEvent(component, type, fields = {}, level = 'info') {
  ensureDir();
  seq += 1;
  const event = {
    ts: new Date().toISOString(),
    seq,
    pid: process.pid,
    level,
    component,
    type,
    ...fields
  };
  try {
    fs.appendFileSync(EVENTS_PATH, JSON.stringify(event) + '\n');
  } catch (err) {
    process.stderr.write(`[logger] write failed: ${err.message}\n`);
  }
  const line = pretty(event);
  if (level === 'error') {
    process.stderr.write(line + '\n');
  } else {
    process.stdout.write(line + '\n');
  }
}

function createLogger(component) {
  return {
    info: (type, fields) => logEvent(component, type, fields, 'info'),
    warn: (type, fields) => logEvent(component, type, fields, 'warn'),
    error: (type, fields) => logEvent(component, type, fields, 'error')
  };
}

module.exports = { logEvent, createLogger, LOGS_DIR, EVENTS_PATH };
