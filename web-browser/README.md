# web-browser

Long-lived Playwright daemon for Kayo. Exposes a small HTTP API on `127.0.0.1:8788` for search, navigation, and content extraction. Designed to be driven by the `research` skill via copilot.

## Why this exists

`web-fetcher/` does one-shot URL → content extraction (Chromium cold-launch per call). It's right for the knowledge-ingestion pipeline (one URL at a time) but wrong for research (multi-step browsing). This daemon keeps Chromium warm, manages browser contexts as sessions, and serves a tool-like HTTP surface.

## Setup

```bash
cd web-browser
npm install
```

`postinstall` runs `playwright install chromium`. The Chromium binary is shared across Playwright installations via `~/.cache/ms-playwright/` so this is fast if `web-fetcher` has already installed it.

## Running

```bash
node web-browser/server.js
```

In production, registered in `.github/registry.json` as a service and spawned by `telegram-bridge/start-all.js`.

## HTTP API

All endpoints accept and return JSON. Bind is `127.0.0.1` only — no auth, localhost trust.

| Method | Path | Body | Response |
|---|---|---|---|
| `GET` | `/v1/status` | — | `{ok, sessions[], uptimeSeconds}` |
| `POST` | `/v1/session` | `{hosts?: ["x.com"]}` | `{sessionId}` |
| `GET` | `/v1/sessions` | — | `{sessions[]}` |
| `POST` | `/v1/search` | `{q, limit?}` | `{query, results: [{title, url, snippet}]}` |
| `POST` | `/v1/open` | `{url, sessionId?}` | `{sessionId, status, url, title, text, fullTextChars, links[]}` |
| `POST` | `/v1/read` | `{sessionId, selector?}` | `{sessionId, selector, text}` |
| `POST` | `/v1/click` | `{sessionId, text?, selector?, confirm?}` | `{sessionId, status, url, title, text, links, clicked}` |
| `POST` | `/v1/scroll` | `{sessionId, direction?, amount?}` | `{sessionId, status, scrollY, scrollHeight, bottomReached}` |
| `POST` | `/v1/find` | `{sessionId, pattern}` | `{sessionId, status, pattern, matches[]}` |
| `DELETE` | `/v1/session/:id` | — | `{ok}` |

`status` field on `/v1/open`:
- `ok` — content extracted successfully
- `nav_error` — navigation failed (timeout, bad URL, DNS)
- `login_wall` — final URL looks like a login page
- `rate_limited` — upstream returned 429 or 403

## Sessions

A session is a Playwright `BrowserContext` — its own cookies, history, tabs. Sessions auto-evict after 30 min idle. If you pass `hosts` when creating a session, the daemon loads any matching `storageState` from `web-fetcher/runtime/state-<host>.json` so logged-in cookies (X, etc.) come along.

If you call `/v1/open` without a `sessionId`, the daemon creates one for you based on the URL's host.

## Text truncation

`/v1/open` returns text truncated to ~6000 chars (80% head + 20% tail). Full character count is reported as `fullTextChars`. To drill in, call `/v1/read` with a CSS selector.

## Examples

```bash
# Search
curl -s -X POST http://127.0.0.1:8788/v1/search \
  -H 'content-type: application/json' \
  -d '{"q":"ripgrep 15 release notes","limit":5}'

# Open a page (no prior session)
curl -s -X POST http://127.0.0.1:8788/v1/open \
  -H 'content-type: application/json' \
  -d '{"url":"https://github.com/BurntSushi/ripgrep"}'

# Reuse a session for multi-step browsing
SID=$(curl -s -X POST http://127.0.0.1:8788/v1/session \
  -H 'content-type: application/json' -d '{}' | jq -r .sessionId)

curl -s -X POST http://127.0.0.1:8788/v1/open \
  -H 'content-type: application/json' \
  -d "{\"sessionId\":\"$SID\",\"url\":\"https://x.com/some/status\"}"

# Status
curl -s http://127.0.0.1:8788/v1/status | jq
```

## Write-action safety gate

`/v1/click` runs every target through a classifier before clicking. An element is treated as transactional when:

- It's a `<button type="submit">` or `<input type="submit">`, OR
- Its visible text or `aria-label` matches the transactional regex (buy / pay / purchase / checkout / delete / sign up / subscribe / publish / send / reply / like / retweet / follow / etc.)

Transactional clicks are blocked unless the request includes `"confirm": true`. The blocked response includes the element info and the reason, so the caller (the `research` skill) can ask Yash for explicit confirmation before retrying.

Plain `<a>` links and non-transactional buttons (e.g. "Next page", "Show more", "Expand") click freely.

## Action chain example

```bash
# 1. open a search-results page
SID=$(curl -sS -X POST http://127.0.0.1:8788/v1/open \
  -H 'content-type: application/json' \
  -d '{"url":"https://github.com/BurntSushi/ripgrep"}' | jq -r .sessionId)

# 2. click the "Releases" link
curl -sS -X POST http://127.0.0.1:8788/v1/click \
  -H 'content-type: application/json' \
  -d "{\"sessionId\":\"$SID\",\"text\":\"Releases\"}" | jq '{title, status}'

# 3. find changelog mentions on the new page
curl -sS -X POST http://127.0.0.1:8788/v1/find \
  -H 'content-type: application/json' \
  -d "{\"sessionId\":\"$SID\",\"pattern\":\"ripgrep 15\"}" | jq '.matches[0]'

# 4. scroll for lazy-loaded entries
curl -sS -X POST http://127.0.0.1:8788/v1/scroll \
  -H 'content-type: application/json' \
  -d "{\"sessionId\":\"$SID\",\"direction\":\"down\",\"amount\":3}" | jq '{scrollY, bottomReached}'
```

## Limitations / future work

- No multi-tab / cross-context yet. Each session has one tab.
- The safety regex is heuristic. It will over-block (e.g. a "Send" button on a form to send feedback to a vendor) and under-block (creative button copy). Tune by editing `lib/actions.js`.
- No request auth — localhost-bound only. Add a shared token if this ever needs to listen on a non-loopback interface.
- One Chromium process. If it crashes, all sessions die. Auto-relaunch on disconnect is wired but in-flight requests fail.
