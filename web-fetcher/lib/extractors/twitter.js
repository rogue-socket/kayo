const fs = require('fs');
const { newContext, storageStatePath } = require('../browser');

const TWEET_SELECTOR = 'article[data-testid="tweet"]';
const TEXT_SELECTORS = [
  'div[data-testid="tweetText"]',
  'div[data-testid="longformRichTextComponent"]'
];
const LOGIN_HINT = 'No tweet content visible — likely not logged in. Run `node web-fetcher/login.js x.com` and log in once.';

async function extractTwitter(url, opts = {}) {
  const depth = opts.depth || 0;
  const hasState = fs.existsSync(storageStatePath('x.com'));
  const context = opts.context || await newContext({ host: 'x.com' });
  const ownContext = !opts.context;
  const page = await context.newPage();

  try {
    await page.goto(url.href, { waitUntil: 'domcontentloaded', timeout: 30000 });

    try {
      await page.waitForSelector(TWEET_SELECTOR, { timeout: 20000 });
    } catch (err) {
      const debugDir = require('path').join(__dirname, '..', '..', 'runtime');
      try {
        await page.screenshot({ path: require('path').join(debugDir, 'tweet-fetch-failure.png'), fullPage: true });
        require('fs').writeFileSync(require('path').join(debugDir, 'tweet-fetch-failure.html'), await page.content());
      } catch (_) {}
      if (!hasState) throw new Error(LOGIN_HINT);
      throw err;
    }

    const tweets = await page.$$(TWEET_SELECTOR);
    if (!tweets.length) {
      throw new Error('No tweet articles found on page (login may have expired — run `node web-fetcher/login.js x.com`).');
    }

    if (process.env.WEB_FETCHER_DEBUG) {
      const debugDir = require('path').join(__dirname, '..', '..', 'runtime');
      try {
        await page.screenshot({ path: require('path').join(debugDir, 'tweet-debug.png'), fullPage: true });
        require('fs').writeFileSync(require('path').join(debugDir, 'tweet-debug.html'), await page.content());
      } catch (_) {}
    }

    const items = [];
    for (const article of tweets) {
      let text = '';
      for (const sel of TEXT_SELECTORS) {
        const found = await article.$eval(sel, (el) => el.innerText).catch(() => '');
        if (found && found.trim()) {
          text = found;
          break;
        }
      }
      const userName = await article.$eval('div[data-testid="User-Name"]', (el) => el.innerText).catch(() => '');
      const permalink = await article.$eval('a[href*="/status/"] time', (el) => el.parentElement.getAttribute('href')).catch(() => '');
      const time = await article.$eval('a[href*="/status/"] time', (el) => el.getAttribute('datetime')).catch(() => '');

      // User-Name innerText is usually "Display Name\n@handle\n·\n2h" or similar
      const userLines = userName.split('\n').map((s) => s.trim()).filter(Boolean);
      const handleLine = userLines.find((l) => l.startsWith('@')) || '';
      const displayName = userLines.find((l) => !l.startsWith('@') && l !== '·' && !/^\d+[smhd]$/.test(l)) || '';

      // Extract outbound links: t.co hrefs inside tweet body and the link card
      const tcoLinks = await article.$$eval(
        'a[href*="t.co/"], a[data-testid="card.wrapper"]',
        (els) => Array.from(new Set(els.map((a) => a.getAttribute('href')).filter(Boolean)))
      ).catch(() => []);

      // Visible expanded URL from a link card, if present
      const cardDomain = await article.$eval('div[data-testid="card.layoutLarge.detail"] span, div[data-testid="card.layoutSmall.detail"] span', (el) => el.innerText).catch(() => '');

      // Quote tweet: rendered as a nested div[role="link"][tabindex] containing
      // a User-Name. Its body may be a tweetText OR an embedded Article card,
      // both of which surface in innerText.
      const quoted = await article.$$eval(
        'div[role="link"][tabindex]',
        (els) => {
          for (const el of els) {
            if (!el.querySelector('div[data-testid="User-Name"]')) continue;
            const userText = el.querySelector('div[data-testid="User-Name"]').innerText || '';
            const userLines = userText.split('\n').map((s) => s.trim()).filter(Boolean);
            const handle = userLines.find((l) => l.startsWith('@')) || '';
            const display = userLines.find((l) => !l.startsWith('@') && l !== '·' && !/^\d+[smhd]$/.test(l) && !/^[A-Z][a-z]+ \d+$/.test(l)) || '';
            const timeEl = el.querySelector('time');
            const datetime = timeEl ? timeEl.getAttribute('datetime') : '';
            const tweetTextEl = el.querySelector('div[data-testid="tweetText"]');
            const tweetText = tweetTextEl ? tweetTextEl.innerText : '';
            // Strip the User-Name block from the full innerText to isolate the body
            const full = el.innerText || '';
            let body = full;
            if (userText && body.startsWith(userText)) body = body.slice(userText.length);
            body = body.replace(/^\s+/, '');
            return { handle, author: display || handle, datetime, text: tweetText.trim(), body: body.trim() };
          }
          return null;
        }
      ).catch(() => null);

      if (text.trim()) {
        items.push({
          text: text.trim(),
          author: displayName || handleLine,
          handle: handleLine,
          datetime: time || '',
          permalink: permalink ? `https://x.com${permalink}` : '',
          tcoLinks,
          cardDomain,
          quoted
        });
      }
    }

    const primary = items[0] || {};

    // Keep only the focal tweet plus contiguous same-author continuations
    // immediately following it. Anything authored by someone else is a reply
    // and must not be folded into the focal tweet's content.
    const ownItems = [primary];
    for (let i = 1; i < items.length; i++) {
      if (items[i].handle && items[i].handle === primary.handle) {
        ownItems.push(items[i]);
      } else {
        break;
      }
    }

    const isThread = ownItems.length > 1;

    // Resolve t.co links to their final URLs (skip self-references) and
    // optionally follow them to fetch the linked article body.
    const allTcoLinks = Array.from(new Set(ownItems.flatMap((t) => t.tcoLinks || [])));
    const resolved = [];
    for (const tco of allTcoLinks) {
      try {
        const resp = await context.request.head(tco, { maxRedirects: 5, timeout: 10000 }).catch(() => null);
        const finalUrl = resp ? resp.url() : tco;
        if (!finalUrl) continue;
        const u = new URL(finalUrl);
        if (/(^|\.)x\.com$|(^|\.)twitter\.com$/.test(u.hostname)) continue;
        resolved.push(finalUrl);
      } catch (_) {}
    }

    const followLinks = process.env.WEB_FETCHER_FOLLOW_LINKS !== 'false';
    const linkedContent = [];
    if (followLinks && resolved.length) {
      const { extractArticle } = require('./article');
      for (const link of resolved.slice(0, 3)) {
        try {
          const linkUrl = new URL(link);
          const result = await extractArticle(linkUrl);
          linkedContent.push({
            url: link,
            title: result.title || '',
            content: result.content || '',
            length: (result.content || '').length,
            source: result.source || 'readability',
            excerpt: result.excerpt || ''
          });
        } catch (err) {
          linkedContent.push({ url: link, error: err.message });
        }
      }
    }

    let quotedTweet = ownItems.find((t) => t.quoted)?.quoted || null;

    // Resolve the quote tweet's permalink by clicking the quote wrapper on a
    // throwaway page (the URL isn't reliably present in the rendered HTML —
    // the wrapper is a JS-handled clickable div with no anchor).
    let quotedUrl = null;
    if (quotedTweet && depth < 1) {
      const probe = await context.newPage();
      try {
        await probe.goto(url.href, { waitUntil: 'domcontentloaded', timeout: 30000 });
        await probe.waitForSelector(TWEET_SELECTOR, { timeout: 20000 });
        const handle = await probe.$$eval(
          'article[data-testid="tweet"] div[role="link"][tabindex]',
          (els) => {
            for (const el of els) {
              if (el.querySelector('div[data-testid="User-Name"]')) {
                el.scrollIntoView();
                return true;
              }
            }
            return false;
          }
        );
        if (handle) {
          await probe.click('article[data-testid="tweet"] div[role="link"][tabindex]:has(div[data-testid="User-Name"])', { timeout: 5000 });
          await probe.waitForURL(/\/status\/\d+/, { timeout: 10000 }).catch(() => {});
          if (probe.url() !== url.href) quotedUrl = probe.url();
        }
      } catch (_) {} finally {
        await probe.close().catch(() => {});
      }

      if (quotedUrl) {
        try {
          const full = await extractTwitter(new URL(quotedUrl), { depth: depth + 1, context });
          quotedTweet = { ...quotedTweet, permalink: quotedUrl, full };
        } catch (err) {
          quotedTweet = { ...quotedTweet, permalink: quotedUrl, fetchError: err.message };
        }
      }
    }

    return {
      type: isThread ? 'thread' : 'tweet',
      url: url.href,
      title: primary.text ? primary.text.slice(0, 120) : '',
      author: primary.author,
      handle: primary.handle,
      datetime: primary.datetime,
      content: ownItems.map((t) => t.text).join('\n\n---\n\n'),
      tweets: ownItems,
      quotedTweet,
      replyCount: items.length - ownItems.length,
      links: resolved,
      linkedContent,
      fetchedAt: new Date().toISOString()
    };
  } finally {
    await page.close().catch(() => {});
    if (ownContext) await context.close().catch(() => {});
  }
}

module.exports = { extractTwitter };
