const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { chromium } = require('playwright');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const WEB_FETCHER_RUNTIME = path.join(REPO_ROOT, 'web-fetcher', 'runtime');

const IDLE_TIMEOUT_MS = 30 * 60 * 1000;
const SWEEP_INTERVAL_MS = 60 * 1000;

let browserSingleton = null;
let launchPromise = null;
const sessions = new Map();

async function getBrowser() {
  if (browserSingleton) return browserSingleton;
  if (launchPromise) return launchPromise;

  launchPromise = chromium.launch({ headless: true, args: ['--no-sandbox'] }).then((b) => {
    browserSingleton = b;
    launchPromise = null;
    b.on('disconnected', () => {
      browserSingleton = null;
      for (const id of [...sessions.keys()]) sessions.delete(id);
    });
    return b;
  });

  return launchPromise;
}

function storageStateForHosts(hosts) {
  const merged = { cookies: [], origins: [] };
  let found = false;

  for (const host of hosts || []) {
    const filePath = path.join(WEB_FETCHER_RUNTIME, `state-${host}.json`);
    if (!fs.existsSync(filePath)) continue;
    try {
      const state = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      if (Array.isArray(state.cookies)) merged.cookies.push(...state.cookies);
      if (Array.isArray(state.origins)) merged.origins.push(...state.origins);
      found = true;
    } catch (err) {
      console.error(`Failed to read storageState for ${host}: ${err.message}`);
    }
  }

  return found ? merged : null;
}

async function createSession({ hosts } = {}) {
  const browser = await getBrowser();
  const id = crypto.randomUUID();
  const storageState = storageStateForHosts(hosts);
  const context = await browser.newContext({
    storageState: storageState || undefined,
    userAgent:
      'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    viewport: { width: 1280, height: 800 }
  });

  const now = Date.now();
  sessions.set(id, {
    id,
    context,
    page: null,
    createdAt: now,
    lastUsedAt: now,
    hosts: hosts || [],
    lastUrl: null
  });

  return id;
}

function touchSession(id) {
  const entry = sessions.get(id);
  if (entry) entry.lastUsedAt = Date.now();
  return entry;
}

function getSession(id) {
  const entry = sessions.get(id);
  if (!entry) throw new Error(`Unknown sessionId: ${id}`);
  entry.lastUsedAt = Date.now();
  return entry;
}

async function getOrCreatePage(entry) {
  if (entry.page && !entry.page.isClosed()) return entry.page;
  entry.page = await entry.context.newPage();
  return entry.page;
}

async function closeSession(id) {
  const entry = sessions.get(id);
  if (!entry) return false;
  sessions.delete(id);
  try { await entry.context.close(); } catch {}
  return true;
}

function listSessions() {
  const now = Date.now();
  return [...sessions.values()].map((s) => ({
    id: s.id,
    createdAt: new Date(s.createdAt).toISOString(),
    lastUsedAt: new Date(s.lastUsedAt).toISOString(),
    idleMs: now - s.lastUsedAt,
    hosts: s.hosts,
    lastUrl: s.lastUrl
  }));
}

async function evictIdle() {
  const cutoff = Date.now() - IDLE_TIMEOUT_MS;
  for (const [id, entry] of sessions.entries()) {
    if (entry.lastUsedAt < cutoff) {
      sessions.delete(id);
      try { await entry.context.close(); } catch {}
    }
  }
}

setInterval(() => {
  evictIdle().catch((err) => console.error('evictIdle failed:', err.message));
}, SWEEP_INTERVAL_MS).unref();

async function shutdown() {
  for (const [id] of sessions) await closeSession(id);
  if (browserSingleton) {
    try { await browserSingleton.close(); } catch {}
    browserSingleton = null;
  }
}

module.exports = {
  getBrowser,
  createSession,
  getSession,
  touchSession,
  getOrCreatePage,
  closeSession,
  listSessions,
  evictIdle,
  shutdown,
  REPO_ROOT,
  WEB_FETCHER_RUNTIME
};
