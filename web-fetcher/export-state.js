#!/usr/bin/env node
// Open the persistent Chrome profile for a host, navigate to a page that
// exposes its cookies, then export storageState. Used to regenerate
// runtime/state-<host>.json after login.js has saved a profile dir.

const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const { storageStatePath, RUNTIME_DIR } = require('./lib/browser');

const HOST_PROBE = {
  'x.com': 'https://x.com/home',
  'twitter.com': 'https://x.com/home',
  'youtube.com': 'https://www.youtube.com/',
  'github.com': 'https://github.com/'
};

async function main() {
  const host = (process.argv[2] || '').replace(/^www\./, '').toLowerCase();
  if (!host) {
    console.error('Usage: node export-state.js <host>');
    process.exit(1);
  }

  const profileDir = path.join(RUNTIME_DIR, `profile-${host.replace(/[^a-z0-9.-]/gi, '_')}`);
  if (!fs.existsSync(profileDir)) {
    console.error(`No persistent profile at ${profileDir}. Run login.js ${host} first.`);
    process.exit(1);
  }

  const probeUrl = HOST_PROBE[host] || `https://${host}/`;
  const statePath = storageStatePath(host);

  const context = await chromium.launchPersistentContext(profileDir, {
    headless: true,
    channel: 'chrome',
    args: ['--disable-blink-features=AutomationControlled'],
    ignoreDefaultArgs: ['--enable-automation']
  });

  try {
    const page = context.pages()[0] || (await context.newPage());
    await page.goto(probeUrl, { waitUntil: 'domcontentloaded', timeout: 20000 });
    await page.waitForTimeout(1500);
    await context.storageState({ path: statePath });
    console.log(`Saved storage state to ${path.relative(process.cwd(), statePath)}`);
  } finally {
    await context.close().catch(() => {});
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
