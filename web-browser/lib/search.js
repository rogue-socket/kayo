const { JSDOM } = require('jsdom');

const DEFAULT_LIMIT = 8;
const USER_AGENT =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

function unwrapDuckDuckGoHref(rawHref) {
  if (!rawHref) return '';
  try {
    const candidate = rawHref.startsWith('//') ? `https:${rawHref}` : rawHref;
    const u = new URL(candidate, 'https://duckduckgo.com');
    const uddg = u.searchParams.get('uddg');
    if (uddg) return decodeURIComponent(uddg);
    return u.toString();
  } catch {
    return rawHref;
  }
}

async function searchDuckDuckGo(query, limit = DEFAULT_LIMIT) {
  const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'User-Agent': USER_AGENT,
      'Accept': 'text/html,application/xhtml+xml',
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: `q=${encodeURIComponent(query)}`
  });

  if (!res.ok) {
    throw new Error(`DuckDuckGo HTML search returned HTTP ${res.status}`);
  }

  const html = await res.text();
  const dom = new JSDOM(html);
  const doc = dom.window.document;

  const results = [];
  for (const el of doc.querySelectorAll('.result')) {
    if (el.classList.contains('result--ad') || el.classList.contains('result--no-result')) continue;
    const a = el.querySelector('.result__a');
    const snippet = el.querySelector('.result__snippet');
    if (!a) continue;

    const title = a.textContent.trim();
    const href = unwrapDuckDuckGoHref(a.getAttribute('href'));
    if (!title || !href) continue;

    results.push({
      title,
      url: href,
      snippet: snippet ? snippet.textContent.trim() : ''
    });

    if (results.length >= limit) break;
  }

  return results;
}

module.exports = { searchDuckDuckGo };
