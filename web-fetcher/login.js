#!/usr/bin/env node
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const { storageStatePath, RUNTIME_DIR } = require('./lib/browser');

const HOST_URLS = {
  'x.com': 'https://x.com/login',
  'twitter.com': 'https://x.com/login',
  'youtube.com': 'https://accounts.google.com/',
  'github.com': 'https://github.com/login'
};

async function main() {
  const host = (process.argv[2] || '').replace(/^www\./, '').toLowerCase();
  if (!host) {
    console.error('Usage: node login.js <host>');
    console.error('Examples: node login.js x.com');
    console.error('          node login.js youtube.com');
    process.exit(1);
  }

  const startUrl = HOST_URLS[host] || `https://${host}`;
  if (!fs.existsSync(RUNTIME_DIR)) fs.mkdirSync(RUNTIME_DIR, { recursive: true });

  const statePath = storageStatePath(host);
  console.log(`Opening ${startUrl} — log in normally, then CLOSE the browser window. State will be saved automatically.`);

  // Use a persistent context with the real installed Chrome so Twitter/X
  // doesn't detect Playwright's default Chromium as automation. Cookies and
  // local storage land directly under runtime/profile-<host>/ which is reused
  // across runs; storageState is also exported to runtime/state-<host>.json.
  const profileDir = path.join(RUNTIME_DIR, `profile-${host.replace(/[^a-z0-9.-]/gi, '_')}`);
  fs.mkdirSync(profileDir, { recursive: true });

  const context = await chromium.launchPersistentContext(profileDir, {
    headless: false,
    channel: 'chrome',
    viewport: null,
    args: [
      '--disable-blink-features=AutomationControlled',
      '--no-default-browser-check',
      '--no-first-run'
    ],
    ignoreDefaultArgs: ['--enable-automation']
  });

  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
  });

  const page = context.pages()[0] || (await context.newPage());
  const browser = context.browser();
  await page.goto(startUrl);

  await new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      resolve();
    };
    if (browser) browser.on('disconnected', finish);
    context.on('close', finish);
  });

  try {
    await context.storageState({ path: statePath });
    console.log(`Saved storage state to ${path.relative(process.cwd(), statePath)}`);
    console.log(`(Persistent profile also retained at ${path.relative(process.cwd(), profileDir)})`);
  } catch (err) {
    console.error(`Failed to save state: ${err.message}`);
    process.exitCode = 1;
  }

  await context.close().catch(() => {});
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
