# Web Fetcher

A local headless-browser content extractor for Kayo. Replaces the metadata-only path used during knowledge ingestion with full content (tweet bodies, YouTube transcripts, clean article text).

## Why this exists

A plain HTTP fetch of a tweet, a YouTube watch page, or many modern articles returns server-rendered HTML or OG metadata only. The actual words live in JS-rendered DOM, login-gated content, or separate transcript endpoints. This fetcher loads each URL in a real Chromium, runs the right extractor for the URL kind, and returns clean text.

## Setup

```bash
cd web-fetcher
npm install
```

`npm install` runs `playwright install chromium` automatically (~150 MB download once).

## Usage

```bash
node web-fetcher/fetch.js "<url>"           # JSON to stdout
node web-fetcher/fetch.js --pretty "<url>"  # indented JSON
```

Errors go to stderr as `{"error": "...", "url": "..."}` with exit code `2`.

## URL routing

| URL host                         | Extractor    | Notes                                                                 |
| -------------------------------- | ------------ | --------------------------------------------------------------------- |
| `x.com`, `twitter.com`           | twitter      | Uses logged-in storageState; walks the visible thread                 |
| `youtube.com`, `youtu.be`        | youtube      | `youtube-transcript` package for captions; Playwright for metadata    |
| anything else                    | article      | Playwright + Mozilla Readability over the rendered DOM                |

## Login flow (gated sources)

Public Twitter/X reads are increasingly blocked without a logged-in session. To save a session:

```bash
node web-fetcher/login.js x.com
```

A non-headless Chromium opens. Log in by hand. Press Enter in the terminal. State is written to `web-fetcher/runtime/state-x.com.json` (gitignored). The fetcher reuses it automatically.

The same flow works for `youtube.com`, `github.com`, or any host. Unknown hosts default to `https://<host>`.

If a tweet fetch starts returning "No tweet articles found on page" the session has expired — re-run `login.js x.com`.

## Output shape

See `.github/skills/web-fetcher/SKILL.md` for full per-type schemas. Every result has `type`, `url`, `title`, `content`, `fetchedAt` at minimum. `content` is the field downstream skills should summarize over.

## Files

- `fetch.js` — CLI entrypoint
- `login.js` — interactive session-saver
- `lib/router.js` — URL → extractor classification
- `lib/browser.js` — shared Chromium + per-host storageState reuse
- `lib/extractors/twitter.js` — tweet/thread bodies
- `lib/extractors/youtube.js` — transcript via `youtube-transcript`, metadata via Playwright
- `lib/extractors/article.js` — Readability over rendered DOM, with cookie-banner dismissal

## Limitations / future work

- One Chromium per CLI process. Repeated calls in a loop will pay launch cost each time. If batching becomes common, wrap this as an HTTP service (mirroring the telegram-bridge gateway pattern).
- Twitter extractor reads only what's visible in the initial article DOM — very long threads may need an explicit scroll loop.
- Rate-limited or hard-blocked hosts surface as errors; no retry.
- No PDF support yet (PDFs are still handled by the existing knowledge-ingestion path).
