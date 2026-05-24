const { Readability } = require('@mozilla/readability');
const { JSDOM } = require('jsdom');

const NAV_TIMEOUT_MS = 30_000;
const READY_TIMEOUT_MS = 20_000;
const MAX_LINKS = 30;
const MAX_TEXT_CHARS = 6000;

function detectStatus(page, finalUrl) {
  const lowerUrl = (finalUrl || '').toLowerCase();
  if (lowerUrl.includes('/login') || lowerUrl.includes('/signin') || lowerUrl.includes('/sign-in')) {
    return 'login_wall';
  }
  return 'ok';
}

function truncateText(text, max = MAX_TEXT_CHARS) {
  if (!text) return '';
  if (text.length <= max) return text.trim();
  const head = text.slice(0, Math.floor(max * 0.8));
  const tail = text.slice(-Math.floor(max * 0.2));
  return `${head.trim()}\n\n…(elided ${text.length - max} chars; call read({selector}) for more)\n\n${tail.trim()}`;
}

async function extractWithReadability(page) {
  const html = await page.content();
  const dom = new JSDOM(html, { url: page.url() });
  try {
    const reader = new Readability(dom.window.document);
    const article = reader.parse();
    if (article && article.textContent) {
      return {
        title: article.title || (await page.title().catch(() => '')) || '',
        text: article.textContent.trim(),
        byline: article.byline || null,
        siteName: article.siteName || null
      };
    }
  } catch {}

  const title = (await page.title().catch(() => '')) || '';
  const text = await page.evaluate(() => document.body ? document.body.innerText : '');
  return { title, text: (text || '').trim(), byline: null, siteName: null };
}

async function collectLinks(page) {
  return page.$$eval(
    'a[href]',
    (els, max) => {
      const seen = new Set();
      const out = [];
      for (const el of els) {
        const text = (el.textContent || '').trim();
        const href = el.href;
        if (!text || !href || href.startsWith('javascript:')) continue;
        if (seen.has(href)) continue;
        seen.add(href);
        out.push({ text: text.length > 80 ? text.slice(0, 80) + '…' : text, url: href });
        if (out.length >= max) break;
      }
      return out;
    },
    MAX_LINKS
  );
}

async function dismissCookieBanners(page) {
  const candidates = [
    'button:has-text("Accept all")',
    'button:has-text("Accept All")',
    'button:has-text("I agree")',
    'button:has-text("Got it")',
    '[aria-label="Consent" i] button'
  ];
  for (const sel of candidates) {
    const btn = await page.$(sel).catch(() => null);
    if (btn) {
      try { await btn.click({ timeout: 1500 }); break; } catch {}
    }
  }
}

async function capturePageState(session) {
  const page = session.page;
  if (!page || page.isClosed()) {
    throw new Error('No active page in session — call open first.');
  }
  await dismissCookieBanners(page);
  const { title, text, byline, siteName } = await extractWithReadability(page);
  const links = await collectLinks(page);
  const finalUrl = page.url();
  session.lastUrl = finalUrl;
  return {
    status: detectStatus(page, finalUrl),
    url: finalUrl,
    title,
    text: truncateText(text),
    fullTextChars: text ? text.length : 0,
    byline,
    siteName,
    links
  };
}

async function openUrl(session, url) {
  const page = await require('./browser').getOrCreatePage(session);
  let response = null;

  try {
    response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT_MS });
  } catch (err) {
    return {
      status: 'nav_error',
      url,
      error: err.message
    };
  }

  try {
    await page.waitForLoadState('networkidle', { timeout: READY_TIMEOUT_MS });
  } catch {}

  const state = await capturePageState(session);
  state.httpStatus = response ? response.status() : null;
  if (state.httpStatus === 429 || state.httpStatus === 403) state.status = 'rate_limited';
  return state;
}

async function readSelector(session, selector) {
  const page = session.page;
  if (!page || page.isClosed()) {
    throw new Error('No active page in session — call open first.');
  }
  if (!selector) {
    const text = await page.evaluate(() => document.body ? document.body.innerText : '');
    return { selector: 'body', text: (text || '').trim() };
  }
  const text = await page.$eval(selector, (el) => el.innerText).catch((err) => {
    throw new Error(`Selector "${selector}" not found: ${err.message}`);
  });
  return { selector, text: (text || '').trim() };
}

module.exports = { openUrl, readSelector, capturePageState };
