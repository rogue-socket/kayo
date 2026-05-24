---
name: research
description: Search and browse the web on Yash's behalf to answer a question or gather sources. Drives a multi-step loop against the local web-browser daemon.
---

Use this skill when Yash asks you to find, look up, search for, research, or browse the web for something. Triggers: "find me", "look up", "research", "search the web for", "browse for", "what do people say about", "are there any articles on".

## How it works

A long-lived Playwright daemon runs at `http://127.0.0.1:8788`. You drive it by shelling out to `curl`. Stay inside this skill for the full research task — do not chain to `knowledge-ingestion` or `web-fetcher` between steps. Queue any captures for the end.

## The action grammar

Each step you take is one HTTP call. Before each call, output a one-line thought (≤20 words) and the call you're about to make. After the call, read the JSON result and decide the next action. Do not narrate between calls — the trace is auditable in journald already.

Format per step:
```
thought: <≤20 words>
action: <search|open|read|done>
```

Then run the curl.

## The seven actions

### 1. search
```bash
curl -s -X POST http://127.0.0.1:8788/v1/search \
  -H 'content-type: application/json' \
  -d '{"q":"<query>","limit":5}'
```
Returns `{query, results: [{title, url, snippet}]}`. Use to find candidate URLs.

### 2. open
```bash
curl -s -X POST http://127.0.0.1:8788/v1/open \
  -H 'content-type: application/json' \
  -d '{"url":"<url>","sessionId":"<optional>"}'
```
Returns `{sessionId, status, url, title, text, fullTextChars, links[]}`. The first `open` call without a `sessionId` creates one — **save it and reuse for subsequent opens in the same task** so cookies and warm tabs persist.

`status` values:
- `ok` — text extracted, proceed
- `login_wall` — page requires login; tell Yash to run `node web-fetcher/login.js <host>` and stop
- `nav_error` — navigation failed; try another URL
- `rate_limited` — back off, suggest a different source

### 3. read
```bash
curl -s -X POST http://127.0.0.1:8788/v1/read \
  -H 'content-type: application/json' \
  -d '{"sessionId":"<id>","selector":"<css>"}'
```
Use only if `open` truncated the page (text ended with `…(elided N chars)`) AND the missing content matters. Skip otherwise.

### 4. click
```bash
curl -s -X POST http://127.0.0.1:8788/v1/click \
  -H 'content-type: application/json' \
  -d '{"sessionId":"<id>","text":"<visible text>"}'
# OR
  -d '{"sessionId":"<id>","selector":"<css>"}'
```
Click a link or button. Returns the same shape as `open` (the new page's title/text/links). Prefer `text` (matches visible label) unless ambiguous.

**Safety gate:** the daemon blocks any click on a `<button>` whose text or aria-label looks transactional (buy, pay, delete, send, post, subscribe, etc.) or on `<input type="submit">`. Blocked response:
```json
{ "status": "blocked", "reason": "text-matches:buy now", "element": {...}, "hint": "..." }
```
On `status=blocked`: stop the loop, tell Yash what the element does, ask if he wants to proceed. Only retry with `"confirm": true` after he explicitly approves. Never auto-confirm.

### 5. scroll
```bash
curl -s -X POST http://127.0.0.1:8788/v1/scroll \
  -H 'content-type: application/json' \
  -d '{"sessionId":"<id>","direction":"down","amount":2}'
```
`direction`: `down|up|top|bottom` (default `down`). `amount`: viewport-heights to scroll (default 1, max 10). Use when a page has lazy-loaded content or you saw `…(elided)` and the rest might be below the fold. Returns `{scrollY, scrollHeight, bottomReached}`. If `bottomReached: true`, stop scrolling.

### 6. find
```bash
curl -s -X POST http://127.0.0.1:8788/v1/find \
  -H 'content-type: application/json' \
  -d '{"sessionId":"<id>","pattern":"changelog|release notes"}'
```
Regex (case-insensitive) over the rendered DOM text. Returns up to 20 `{text, selector, tagName, href}` matches. Use to locate a link or section by what it says — then `click` or `read` it. Faster than scrolling-and-eyeballing.

### 7. done
Write the final answer and stop calling tools. This is the only correct way to end the loop.

## Loop budget

**Maximum 8 actions per task** (search/open/read/click/scroll/find each count as one). If you reach 6 actions without enough material, summarize what you have and stop with `done` rather than burning the budget on speculative clicks.

For multi-hop tasks (open → click → scroll → read), plan the route before you start so you don't waste actions discovering it.

Each turn, mentally track: `steps_used / 8`. When you cross 5, you must be in synthesis mode, not exploration mode.

## Stop conditions

Stop and output `done` when:
- You have enough material to answer Yash's question concretely (with sources).
- You've used 8 actions.
- A `login_wall` or `rate_limited` status blocks the path and there's no obvious alternative source.

## What the final answer looks like

Two short paragraphs, then sources:

```
<direct answer to the question, in plain prose>

<one paragraph of nuance, caveats, or counter-evidence if any>

Sources:
- <title> — <url>
- <title> — <url>
```

Never paste page bodies into the final answer. Quote at most one sentence per source.

## Safety

- **The daemon's safety gate is the first line, not the only line.** Even when the gate allows a click (e.g. a "Next" pagination button), you are still responsible for not clicking anything that looks like it changes state on Yash's behalf without his explicit ask.
- **On `status=blocked`** from a click, never retry with `"confirm": true` without an explicit Yash approval in the current conversation. Surface the element info to him and wait.
- **Never call `/v1/search` with personally-identifying queries about Yash** unless he explicitly asked you to.
- **Never persist research transcripts to the vault automatically.** If a source is worth saving, mention it at the end of your answer — Yash decides whether to ingest.

## Reporting back

When you stream the final answer to Telegram, lead with the answer, not the process. Yash can see steps in journald if he cares. Keep total output under ~600 words; if the topic genuinely needs more, ask whether to expand.

## Cross-references

- [[web-fetcher]] — the one-shot URL extractor used by knowledge-ingestion (different code path; do not mix mid-task).
- [[knowledge-ingestion]] — call **after** finishing a research task, only if Yash explicitly asks to save one of the sources.
- [[cli-fluency]] — general curl/jq patterns.
