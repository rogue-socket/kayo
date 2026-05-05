const { Readability } = require('@mozilla/readability');
const { JSDOM } = require('jsdom');
const { newContext } = require('../browser');

const COOKIE_BUTTON_TEXTS = [
  'Accept all',
  'Accept All',
  'I agree',
  'Agree',
  'Got it',
  'OK',
  'Allow all'
];

async function dismissCookieBanners(page) {
  for (const text of COOKIE_BUTTON_TEXTS) {
    const button = page.getByRole('button', { name: text });
    try {
      if (await button.first().isVisible({ timeout: 500 })) {
        await button.first().click({ timeout: 1500 });
        return;
      }
    } catch (_) {
      // ignore
    }
  }
}

async function extractArticle(url) {
  const context = await newContext({ host: url.hostname.replace(/^www\./, '') });
  const page = await context.newPage();

  try {
    await page.goto(url.href, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {});
    await dismissCookieBanners(page);

    const html = await page.content();
    const finalUrl = page.url();
    const pageTitle = await page.title();

    const dom = new JSDOM(html, { url: finalUrl });
    const reader = new Readability(dom.window.document);
    const parsed = reader.parse();

    if (!parsed) {
      const fallbackText = (await page.evaluate(() => document.body ? document.body.innerText : '')).trim();

      // For canvas-rendered SPAs (Flutter, some React apps without SSR) the body
      // is essentially empty. Pull from meta/og/twitter tags + <noscript> blocks.
      if (fallbackText.length < 200) {
        const probe = await page.evaluate(() => {
          const tags = {};
          document.querySelectorAll('meta').forEach((el) => {
            const k = el.getAttribute('name') || el.getAttribute('property');
            const v = el.getAttribute('content');
            if (k && v) tags[k.toLowerCase()] = v;
          });
          const noscript = Array.from(document.querySelectorAll('noscript'))
            .map((n) => {
              const tmp = document.createElement('div');
              tmp.innerHTML = n.textContent || '';
              return (tmp.innerText || tmp.textContent || '').trim();
            })
            .filter(Boolean);
          return { tags, noscript };
        });

        const pick = (...keys) => keys.map((k) => probe.tags[k]).find(Boolean) || '';
        const metaTitle = pick('og:title', 'twitter:title') || pageTitle;
        const metaDesc = pick('og:description', 'twitter:description', 'description');
        const metaSite = pick('og:site_name', 'application-name');
        const keywords = pick('keywords');
        const noscriptText = probe.noscript.join('\n\n');

        const parts = [metaDesc, noscriptText].filter(Boolean);
        const content = parts.join('\n\n').trim();

        return {
          type: 'article',
          url: finalUrl,
          title: metaTitle,
          author: '',
          siteName: metaSite,
          excerpt: metaDesc,
          keywords,
          content,
          length: content.length,
          source: 'meta',
          readabilityFailed: true,
          fetchedAt: new Date().toISOString()
        };
      }

      return {
        type: 'article',
        url: finalUrl,
        title: pageTitle,
        author: '',
        excerpt: '',
        content: fallbackText,
        readabilityFailed: true,
        fetchedAt: new Date().toISOString()
      };
    }

    return {
      type: 'article',
      url: finalUrl,
      title: parsed.title || pageTitle,
      author: parsed.byline || '',
      siteName: parsed.siteName || '',
      excerpt: parsed.excerpt || '',
      lang: parsed.lang || '',
      content: parsed.textContent ? parsed.textContent.trim() : '',
      length: parsed.length || 0,
      fetchedAt: new Date().toISOString()
    };
  } finally {
    await context.close();
  }
}

module.exports = { extractArticle };
