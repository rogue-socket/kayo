const { getOrCreatePage } = require('./browser');
const { capturePageState } = require('./extract');

const CLICK_TIMEOUT_MS = 5000;
const NAV_AFTER_CLICK_MS = 8000;

const TRANSACTIONAL_TEXT_REGEX =
  /\b(buy now|buy|pay(?!pal)|purchase|order now|checkout|complete order|place order|delete account|delete( forever)?|destroy|wipe|remove account|sign up|register|create account|subscribe|unsubscribe|cancel subscription|publish|post( tweet)?|tweet|send( message)?|reply|like|retweet|repost|follow|charge me|confirm purchase)\b/i;

function classifyElement(info) {
  if (!info) return { transactional: false, reason: null };
  if (info.insideForm && (info.type || '').toLowerCase() === 'submit') {
    return { transactional: true, reason: 'form-submit' };
  }
  const haystack = `${info.text || ''} ${info.ariaLabel || ''}`.trim();
  const match = haystack.match(TRANSACTIONAL_TEXT_REGEX);
  if (match) {
    return { transactional: true, reason: `text-matches:${match[0].toLowerCase()}` };
  }
  return { transactional: false, reason: null };
}

async function locateElement(page, { text, selector }) {
  if (selector) {
    const loc = page.locator(selector).first();
    const count = await loc.count();
    if (!count) throw new Error(`No element matches selector ${JSON.stringify(selector)}`);
    return loc;
  }
  if (text) {
    const interactive = page
      .locator('a, button, [role="link"], [role="button"], summary')
      .filter({ hasText: text })
      .first();
    if (await interactive.count()) return interactive;
    const fallback = page.getByText(text, { exact: false }).first();
    if (await fallback.count()) return fallback;
    throw new Error(`No element found containing text ${JSON.stringify(text)}`);
  }
  throw new Error('Either `text` or `selector` is required');
}

async function clickElement(session, { text, selector, confirm }) {
  const page = await getOrCreatePage(session);
  const locator = await locateElement(page, { text, selector });

  const info = await locator.evaluate((el) => ({
    tagName: el.tagName.toLowerCase(),
    type: el.type || null,
    text: (el.innerText || el.textContent || '').trim().slice(0, 200),
    ariaLabel: el.getAttribute('aria-label') || '',
    insideForm: !!el.closest('form'),
    href: el.tagName === 'A' ? el.href : null
  }));

  const safety = classifyElement(info);
  if (safety.transactional && !confirm) {
    return {
      status: 'blocked',
      reason: safety.reason,
      element: info,
      hint:
        'Element looks transactional (form submission or write action). Ask Yash to confirm, then retry with {"confirm": true}.'
    };
  }

  const urlBefore = page.url();
  await locator.click({ timeout: CLICK_TIMEOUT_MS });
  try { await page.waitForLoadState('domcontentloaded', { timeout: NAV_AFTER_CLICK_MS }); } catch {}
  try {
    await page.waitForFunction((before) => window.location.href !== before, urlBefore, { timeout: 4000 });
  } catch {}
  try { await page.waitForLoadState('networkidle', { timeout: NAV_AFTER_CLICK_MS }); } catch {}

  const state = await capturePageState(session);
  state.clicked = info;
  return state;
}

async function scrollPage(session, { direction = 'down', amount = 1 }) {
  const page = await getOrCreatePage(session);
  if (page.isClosed()) throw new Error('No active page in session — call open first.');
  const n = Math.max(1, Math.min(10, Number(amount) || 1));

  if (direction === 'top') {
    await page.evaluate(() => window.scrollTo(0, 0));
  } else if (direction === 'bottom') {
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  } else if (direction === 'up') {
    await page.evaluate((mult) => window.scrollBy(0, -window.innerHeight * mult), n);
  } else {
    await page.evaluate((mult) => window.scrollBy(0, window.innerHeight * mult), n);
  }

  try { await page.waitForLoadState('networkidle', { timeout: 2500 }); } catch {}

  const pos = await page.evaluate(() => ({
    y: Math.round(window.scrollY),
    height: document.body.scrollHeight,
    viewport: window.innerHeight,
    bottomReached: window.innerHeight + window.scrollY >= document.body.scrollHeight - 10
  }));

  return {
    status: 'ok',
    direction,
    amount: n,
    scrollY: pos.y,
    scrollHeight: pos.height,
    viewportHeight: pos.viewport,
    bottomReached: pos.bottomReached
  };
}

async function findInPage(session, { pattern }) {
  const page = session.page;
  if (!page || page.isClosed()) throw new Error('No active page in session — call open first.');
  if (!pattern || typeof pattern !== 'string') {
    throw new Error('pattern (string) is required');
  }

  const matches = await page.evaluate((pat) => {
    let regex;
    try { regex = new RegExp(pat, 'i'); } catch { return []; }
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    const out = [];
    let node;
    while ((node = walker.nextNode())) {
      const text = (node.textContent || '').trim();
      if (!text || text.length < 2 || !regex.test(text)) continue;
      const el = node.parentElement;
      if (!el) continue;
      let sel = el.tagName.toLowerCase();
      if (el.id) {
        sel = `#${el.id}`;
      } else if (typeof el.className === 'string' && el.className.trim()) {
        const cls = el.className.trim().split(/\s+/).filter(Boolean).slice(0, 2).join('.');
        if (cls) sel = `${sel}.${cls}`;
      }
      out.push({
        text: text.slice(0, 200),
        selector: sel,
        tagName: el.tagName.toLowerCase(),
        href: el.tagName === 'A' ? el.href : null
      });
      if (out.length >= 20) break;
    }
    return out;
  }, pattern);

  return { status: 'ok', pattern, matches };
}

module.exports = { clickElement, scrollPage, findInPage, classifyElement };
