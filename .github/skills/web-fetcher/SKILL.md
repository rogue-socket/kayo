---
name: web-fetcher
description: Fetch full content (not just metadata) from any web URL — tweets, threads, YouTube transcripts, and articles — via a local Playwright-backed CLI
---

When you need the actual content behind a URL — the words of a tweet, the transcript of a YouTube video, the body of an article — use this skill. The bare HTTP fetch you would otherwise do returns only metadata for JS-rendered or gated sites. This skill calls a local headless-browser fetcher that returns clean, full content.

## When to invoke

- Any time a URL appears in a knowledge-ingestion request (tweet, thread, article, video, blog, GitHub repo, product page).
- Any time the user asks Kayo to "read", "summarize", "what does this say", or "save" something at a URL.
- Any time you would otherwise quote the OG description and call it a summary — stop and call the fetcher first.

Do NOT use for:
- URLs the user asked you not to open.
- URLs that are clearly internal IPs or localhost.
- Pure file paths or non-HTTP schemes.

## How to call it

The fetcher is a Node CLI in `web-fetcher/`. Run from the repo root:

```bash
node web-fetcher/fetch.js "<url>"
```

Output is a single JSON object on stdout. Errors go to stderr as `{"error": "...", "url": "..."}` with exit code 2.

For a one-time legibility pass during debugging, add `--pretty`:

```bash
node web-fetcher/fetch.js --pretty "<url>"
```

## Returned shape

All results include `type`, `url`, `title`, `content`, `fetchedAt`. `content` is the field to summarize over.

**Tweet / thread** (`type: "tweet" | "thread"`):
```json
{
  "type": "thread",
  "url": "...",
  "title": "<first ~120 chars of root tweet>",
  "author": "Display Name",
  "handle": "@handle",
  "datetime": "ISO timestamp",
  "content": "<all tweet bodies joined by \\n\\n---\\n\\n>",
  "tweets": [{ "text": "...", "author": "...", "handle": "...", "datetime": "...", "permalink": "..." }],
  "fetchedAt": "ISO"
}
```

**YouTube** (`type: "video"`):
```json
{
  "type": "video",
  "url": "...",
  "videoId": "...",
  "title": "...",
  "author": "<channel>",
  "description": "...",
  "transcript": [{ "offset": 0, "duration": 3.2, "text": "..." }],
  "transcriptAvailable": true,
  "content": "<transcript text joined, or description if no transcript>",
  "fetchedAt": "ISO"
}
```

**Article / generic** (`type: "article"`):
```json
{
  "type": "article",
  "url": "<final URL after redirects>",
  "title": "...",
  "author": "<byline if any>",
  "siteName": "...",
  "excerpt": "...",
  "content": "<clean main-body text via Mozilla Readability>",
  "length": 12345,
  "fetchedAt": "ISO"
}
```

When `readabilityFailed` is `true`, fall back to using `content` as raw `body.innerText` — it is noisier but usable.

## Login flow for gated sources

Twitter/X is the main case: public tweets are increasingly gated. Yash has authorized storing a logged-in session.

To (re)create the session:

```bash
node web-fetcher/login.js x.com
```

A non-headless Chromium opens; Yash logs in by hand; press Enter; state is saved to `web-fetcher/runtime/state-x.com.json` (gitignored). The fetcher reuses it automatically.

Same flow works for any host (`youtube.com`, `github.com`, etc.) — host names are looked up in `login.js` and otherwise default to `https://<host>`.

If a tweet fetch fails with "No tweet articles found on page (login may have expired ...)", run the login command again.

## Failure handling

- If the CLI exits non-zero, surface the error to the user briefly and ask if they want to retry, skip, or fall back to metadata-only ingestion.
- If `transcriptAvailable: false` for a YouTube video, tell Yash there's no transcript and proceed with description-only.
- If the URL is rate-limited or blocked, do not retry in a loop — report it and move on.

## Notes

- The fetcher launches a single shared Chromium per process, so calling `fetch.js` repeatedly from one shell is not as cheap as keeping a persistent service. For now, one URL per CLI call is fine; if Yash starts batching ingestion, we should add an HTTP wrapper.
- Permission mode is `yolo`-aligned: the fetcher will load any URL passed to it. Do not pass user-controlled raw input without sanity checks (no `file://`, no internal hosts).
