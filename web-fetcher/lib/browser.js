const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright');

const RUNTIME_DIR = path.join(__dirname, '..', 'runtime');

let sharedBrowser = null;

async function getBrowser() {
  if (sharedBrowser && sharedBrowser.isConnected()) {
    return sharedBrowser;
  }
  sharedBrowser = await chromium.launch({ headless: true });
  return sharedBrowser;
}

function storageStatePath(host) {
  const safe = host.replace(/[^a-z0-9.-]/gi, '_');
  return path.join(RUNTIME_DIR, `state-${safe}.json`);
}

async function newContext({ host, userAgent } = {}) {
  const browser = await getBrowser();
  const opts = {
    userAgent: userAgent || 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
    viewport: { width: 1280, height: 900 }
  };

  if (host) {
    const statePath = storageStatePath(host);
    if (fs.existsSync(statePath)) {
      opts.storageState = statePath;
    }
  }

  return browser.newContext(opts);
}

async function closeBrowser() {
  if (sharedBrowser) {
    await sharedBrowser.close().catch(() => {});
    sharedBrowser = null;
  }
}

module.exports = { getBrowser, newContext, closeBrowser, storageStatePath, RUNTIME_DIR };
