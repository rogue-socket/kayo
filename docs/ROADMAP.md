# Roadmap — Future Steps for Kayo

This document captures larger improvements to the kayo bot that haven't been
filed as actionable issues yet. Each entry has:

- **Hook** — one-line elevator pitch.
- **Why** — the user-facing problem this solves.
- **Current state** — what exists today, with file/line references where useful.
- **Design** — concrete shape of the implementation (schemas, endpoints,
  pseudocode where it helps).
- **Acceptance** — how we know it's done.
- **Risks / non-goals** — explicit boundaries to keep scope honest.
- **Effort** — rough sizing.
- **Dependencies** — items that should land first.

Filed-issue companions (do these first; this doc assumes they're done):

- [#1 — Stream copilot replies via Telegram message-edits](https://github.com/rogue-socket/kayo/issues/1) — **shipped.** See `telegram-bridge/README.md` § "Streaming replies".
- [#2 — Stop kayo.log growing unbounded (switch to journald)](https://github.com/rogue-socket/kayo/issues/2) — **shipped.** See `telegram-bridge/README.md` § "Logs".
- [#3 — Self-healing health probe (every 6h, token-cheap)](https://github.com/rogue-socket/kayo/issues/3) — **shipped.** See `telegram-bridge/README.md` § "Health probe".

The seven roadmap items below are intentionally ordered by recommended
execution sequence (see "Suggested execution order" at the bottom for the
full sequencing including the filed issues).

---

## 1. Voice notes and image input from Telegram

**Hook:** Capture from the phone the way you'd capture in a notebook.

### Why

The bridge currently only handles `message.text` — see `bridge.js:159`:

```js
if (!message || typeof message.text !== 'string') {
  continue;
}
```

That single guard drops everything else: voice notes, photos, documents,
videos, stickers, location pins. On a phone, voice and photos are the natural
input modes — voice for "log this thought" while walking, photos for
receipts, screenshots, whiteboards, screenshots of articles. Today none of
these reach kayo.

### Current state

- `lib/transport/telegram-api.js` already wraps `getUpdates`, `sendDocument`,
  `sendText`, `sendTyping`. No `getFile` or media-download helper exists.
- Telegram's `getFile` API returns a `file_path` you can fetch from
  `https://api.telegram.org/file/bot<token>/<file_path>` — straightforward.
- `message.voice` is OGG/Opus; `message.photo` is an array of resized variants
  (use the largest); `message.document` covers everything else.

### Design

**Voice path:**

1. Bridge detects `message.voice`, calls `getFile` → downloads OGG to
   `runtime/inbox/voice-<msg_id>.ogg`.
2. Transcription via local Whisper. Two practical options:
   - **`whisper.cpp`** binary — single static binary, ~150MB model, no Python.
     Wrap with `spawn` from `lib/transport/whisper.js`.
   - **`faster-whisper` Python worker** — start a small FastAPI/uvicorn
     process behind `localhost:5005/transcribe`. Higher quality, more deps.

   Pick whichever boots faster on the laptop hardware. Probably whisper.cpp.
3. Forward the transcript through the existing prompt path with
   `context: { source: 'voice', original_duration_s: <n> }` so copilot knows
   it's transcribed (and can be lenient about typos).
4. Optional: also reply with the transcript in italics so the user can
   verify it heard correctly (`_"…transcript…"_` followed by the response).

**Photo / image path:**

1. Bridge detects `message.photo`, picks the largest variant, downloads to
   `runtime/inbox/photo-<msg_id>.jpg`.
2. The npm copilot CLI accepts images via... actually unclear from
   `--help` whether it has a `--image` flag in this version — verify before
   building. If it does: pass through. If it doesn't: this item is blocked
   on roadmap item 7 (Claude API migration), or we fall back to running OCR
   locally and sending the extracted text.
3. Caption (if present) becomes the prompt; absent caption falls back to
   `"Describe what's in this image and what action you'd take."`.

**Storage:**

- `runtime/inbox/` is ephemeral — clear files older than 24h via a daily
  cleanup pass in the scheduler or a dedicated `inbox-cleaner.js`.
- Don't persist media into vault automatically; that's roadmap item 2's job.

### Acceptance

- [ ] Sending a voice note via Telegram results in copilot receiving the
      transcript and replying.
- [ ] Sending a photo with a caption ("expense", "what is this?", etc.)
      results in copilot processing the image + caption.
- [ ] Sending a photo without a caption results in copilot describing it.
- [ ] Failed transcription (silence, corrupted audio) sends a polite error
      DM, doesn't crash the bridge.
- [ ] Files in `runtime/inbox/` don't persist beyond 24h.
- [ ] Telegram authorization rules (`isAuthorized(chatId)` in `bridge.js:31`)
      apply identically to media messages.

### Risks / non-goals

- **Risk:** Whisper model is heavy — 150MB to 1.5GB on disk depending on
  size. Start with the small/base model; upgrade if quality is poor.
- **Non-goal:** Real-time voice — recording → transcription happens after
  the message lands, not as the user speaks.
- **Non-goal:** Multi-language. Default to English; user can override
  later.

### Effort

~2–4 days. Voice is the easier half. Photo path may be blocked on copilot
CLI feature support.

### Dependencies

- Strongly benefits from issue #1 (streaming) so the
  transcription-then-response feels fast.
- Photo path may need roadmap item 7 (drop CLI cold-start / migrate to API)
  if the CLI doesn't accept images directly.

---

## 2. Receipt → finance-guy pipeline

**Hook:** Snap a bill, kayo logs the expense to Port Louis. Magical.

### Why

This is the killer-app for combining vision input with the finance-guy
backend. The user already takes photos of receipts; today they end up as dead
pixels in the camera roll. Manual entry through the Port Louis UI works but
requires sitting at a laptop. A photo → Telegram → confirm-and-log loop
collapses that to <30 seconds, on the phone, while still standing at the
till.

### Current state

- finance-guy runs at `http://127.0.0.1:3001` with `GET /api/state` and
  `PUT /api/state` (whole-state replace).
- State shape includes `expenses[]` keyed by `accountId`, with fields
  `{ id, accountId, amount, currency, originalAmount, label, category, notes, date }`.
- Hard-coded `USD_TO_INR = 95`; all stored amounts are INR with
  `originalAmount` preserving the user-entered value.
- The kayo finance-manager skill is **stale** — it still references
  `finance/finance-data.json` (a tiny scratch file). That skill needs the
  rewrite already discussed (separate work) before this pipeline is built.

### Design

**Trigger:**

- Photo with caption containing one of: `expense`, `bill`, `receipt`, `paid`,
  a currency symbol (`₹`, `$`), or just a number ("520 lunch").
- OR auto-detection: copilot is asked "is this a receipt?" first; if yes,
  proceed. Costlier in tokens but zero-friction.

Pick caption-trigger first; auto-detect later if it feels too clunky.

**Extraction:**

Prompt copilot (or the chosen vision model) for structured JSON:

```json
{
  "amount": 520,
  "currency": "INR",
  "merchant": "Starbucks Indiranagar",
  "date": "2026-05-04",
  "category": "Food",
  "paymentMethod": "UPI",
  "confidence": 0.86,
  "notes": "Large latte"
}
```

Categories should match the categories already present in `state.expenses[]`
(read state first, list distinct categories, pass them as the allowed set).

**Confirmation:**

Reply with the extracted data and an inline keyboard (Telegram supports
`reply_markup` with `inline_keyboard` of buttons). Buttons:

- `✓ Log it` — proceed to PUT.
- `✏ Edit` — bot asks "what's wrong?" in chat, user types correction (e.g.
  "category Transport"), bot re-confirms.
- `✗ Cancel` — discard.

The bridge needs to handle `callback_query` updates — it currently only
listens for `message`. Update `bridge.js:153`:

```js
allowed_updates: ['message', 'callback_query']
```

**Logging:**

1. `GET http://127.0.0.1:3001/api/state` → mutable copy.
2. Append to `expenses[]`:
   ```js
   {
     id: `id-${base36(Date.now())}-${rand6()}`,
     accountId: state.activeAccountId,  // unless overridden in confirm step
     amount: convertToInr(extracted),
     currency: extracted.currency,
     originalAmount: extracted.amount,
     label: extracted.merchant,
     category: extracted.category,
     notes: extracted.notes,
     date: extracted.date
   }
   ```
3. Append to `activityLog[]`:
   ```js
   {
     id: `id-${base36(Date.now())}-${rand6()}`,
     action: 'add-expense',
     detail: `${extracted.amount} ${extracted.currency} @ ${extracted.merchant}`,
     timestamp: new Date().toISOString()
   }
   ```
   Cap at 500 entries (drop oldest) — same convention as the app.
4. `PUT /api/state` with the full mutated body.
5. Reply: "Logged ₹520 at Starbucks (Food). Today's spend: ₹X."

**Error handling:**

- finance-guy returns 4xx → DM the error, don't retry.
- finance-guy unreachable → save the extracted draft to
  `runtime/inbox/pending-expenses.json` and DM "Couldn't reach finance-guy.
  Saved as draft, will retry."
- Background retry loop processes the drafts.

### Acceptance

- [ ] Photo of a receipt with caption "expense" produces an extracted
      summary + inline confirm keyboard within 10s (longer if vision is slow).
- [ ] Tapping `✓ Log it` PUTs to finance-guy and replies with confirmation
      including the day's running total.
- [ ] Tapping `✏ Edit` enters a free-form correction loop.
- [ ] The new expense appears in the Port Louis UI on next refresh.
- [ ] `activityLog[]` shows the new entry.
- [ ] USD receipts are stored with `originalAmount` in USD, `amount` in
      INR at 95.
- [ ] finance-guy down → graceful draft + retry.

### Risks / non-goals

- **Risk:** vision misreads numbers. Mitigation: never auto-log without
  confirmation; show the source photo back in the confirmation message
  (Telegram supports including the original photo in the reply).
- **Risk:** users tap `✓` reflexively. Mitigation: confidence < 0.6
  defaults to `✏ Edit` rather than `✓ Log it` (highlight the edit button).
- **Non-goal:** training a custom model. Off-the-shelf vision is fine.
- **Non-goal:** multi-receipt single-photo (split bills). v2.

### Effort

~3–5 days, assuming the finance-manager skill rewrite is already done.

### Dependencies

- **Hard:** finance-manager skill rewrite to point at finance-guy's API
  (separate, not-yet-issue work).
- **Hard:** roadmap item 1 (image input).
- **Soft:** roadmap item 3 (inline keyboards) — the confirmation step is the
  first real use of inline keyboards in this codebase.

---

## 3. Inline keyboards on `/cron` and `/vault`

**Hook:** Tap a job to pause it, tap a vault entry to fetch the note.

### Why

`/cron` and `/vault` (added today) are read-only walls of text. Telegram
supports inline keyboards natively — much better UX on mobile, and unlocks
operations that currently require natural-language prompts to copilot
(meaning a slow round-trip and risk of misinterpretation).

### Current state

- `bridge.js:formatCronMessage` produces a static block per job.
- `bridge.js:formatVaultMessage` produces a numbered list of titles with
  paths.
- No `callback_query` handling exists in `bridge.js`.

### Design

**`/cron` enhancements:**

Each job gets a row of buttons:

```
[on] job-001  Daily vault reading article
   schedule: 0 17 * * *  (Asia/Kolkata)
   next run: 2026-05-05T11:30:00Z
   [⏸ Pause]  [▶ Run now]  [✏ Edit]  [🗑 Delete]
```

- `⏸ Pause / ▶ Resume` — toggles `enabled` in `runtime/jobs.json` via
  `updateJobRuntime` (already exists in `lib/scheduler/job-store.js:85`).
- `▶ Run now` — calls `runJob(job)` immediately (refactor scheduler to
  expose a programmatic trigger; today it's only via cron tick).
- `✏ Edit` — DMs an explanation: "Reply with `set schedule <expr>` or
  `set prompt <text>` etc." and enters an editing mode keyed by chat-id.
- `🗑 Delete` — second-tap confirmation pattern: first tap shows
  `[Confirm delete] [Cancel]`, second confirms.

**`/vault` enhancements:**

Each entry gets:

```
1. Building Agents That Reach Production Systems with MCP
   2026-04-23 | ai-agents, mcp
   vault/2026-04-23-building-agents-production-systems-mcp.md
   [Open] [Summarise] [Source]
```

- `Open` — `sendDocument` the markdown file directly.
- `Summarise` — forwards a "summarise this note in 3 bullets" prompt to
  copilot, replies with the summary.
- `Source` — opens the URL from `entry.source` in the user's browser
  (Telegram will preview it).

**Implementation notes:**

- Each button needs a `callback_data` ≤ 64 bytes. Use a compact encoding:
  `c:p:job-001` for "cron pause job-001", `v:s:kb-20260423-001` for "vault
  summarise <id>". Keep a dispatch table in `bridge.js`.
- Bridge change: `allowed_updates: ['message', 'callback_query']` and a new
  `handleCallbackQuery(query)` handler.
- Always `answerCallbackQuery` first (Telegram requires it; otherwise the
  loading spinner stays on the button).

### Acceptance

- [ ] `/cron` renders with 4 buttons per job; tapping `⏸` toggles `enabled`
      and the message updates in place.
- [ ] `▶ Run now` triggers a job out-of-cron and updates `lastRunAt`.
- [ ] `🗑 Delete` requires two taps.
- [ ] `/vault` renders with 3 buttons per entry; `Open` sends the markdown
      as a document; `Summarise` returns a 3-bullet summary.
- [ ] All `callback_query` updates are acknowledged within 1s (no perpetual
      spinner).
- [ ] Authorization (`isAuthorized`) enforced on `callback_query` too.

### Risks / non-goals

- **Risk:** scheduler refactor for `runJob(job)` could regress cron
  scheduling. Mitigation: small refactor, keep the cron loop unchanged,
  just expose the existing internal `runJob` that the loop already calls.
- **Non-goal:** rich job creation UI (e.g. visual cron builder). Job
  creation stays in natural language via the scheduler-manager skill.

### Effort

~2 days.

### Dependencies

- None hard. Independent of #1, #2, item 4.

---

## 4. Per-chat configuration

**Hook:** A guest chat that can read but not write the vault, with a cheaper
model — without affecting your own chat.

### Why

Today, `model`, `permissionMode`, and `fileAccessRoots` are global to the
process — see `loadConfig()` in `lib/env.js:132-164`. There's no way to:

- Have a "main chat" running Sonnet 4.5 with full write permission AND a
  "guest chat" running Haiku in read-only mode.
- Let a friend DM kayo for vault search without giving them ability to
  trigger expensive prompts or modify state.
- Try a new model in one chat without affecting scheduled job behavior.

This is the foundational work for any future multi-user / shared scenario.

### Current state

- `model` is mutable globally via the new `/v1/model` endpoint
  (`gateway.js`, after the recent changes).
- `permissionMode` is hard-coded to `'yolo'` in `loadConfig()` — there's no
  way to override per-call.
- `fileAccessRoots` is read once from `.env` at startup
  (`parseFileRootEntries`).

### Design

**New file:** `telegram-bridge/runtime/chat-config.json`

```json
{
  "version": 1,
  "defaults": {
    "model": "",
    "permissionMode": "yolo",
    "fileAccessRoots": ["repo", "vault"],
    "vaultReadOnly": false,
    "promptBudgetTokens": null
  },
  "chats": {
    "6687286978": {
      "label": "main",
      "model": "claude-sonnet-4.5"
    },
    "1234567890": {
      "label": "guest",
      "model": "claude-haiku-4.5",
      "permissionMode": "default",
      "fileAccessRoots": ["vault"],
      "vaultReadOnly": true,
      "promptBudgetTokens": 50000
    }
  }
}
```

`defaults` is the fallback when a chat-id isn't listed. The shape of the
inner object matches the current `loadConfig()` output for those four keys.

**Bridge changes:**

- New `lib/chat-config.js` module: `getChatConfig(chatId)` returns the
  resolved (defaults + override) config.
- `bridge.js` request flow:
  1. Resolve chat config.
  2. Pass `chatConfig` in the gateway request `context`.
  3. Built-in commands (`/model`, `/files roots`, etc.) operate on the
     per-chat record via `setChatConfig(chatId, patch)`.

**Gateway changes:**

- `/v1/prompt` honors `request.context.chatConfig.{model,permissionMode}`
  for that single prompt — overriding the global current values for the
  duration of the call.
- File-access enforcement (`lib/file-access.js`) honors the per-call
  `fileAccessRoots` whitelist.
- `vaultReadOnly` rejects writes inside the vault root.
- `promptBudgetTokens` (if set) is enforced loosely — refuse new prompts
  for that chat in the current calendar month if usage exceeded. Requires
  rough token accounting (estimate from char count or use copilot's reported
  usage if available).

**Migration:**

- On first boot post-upgrade, generate `chat-config.json` from `.env`
  defaults so existing behavior is preserved.
- `.env` becomes the *defaults* source only; per-chat is the override.

### Acceptance

- [ ] `chat-config.json` exists; `defaults` block matches `.env`.
- [ ] `/model claude-haiku-4.5` from chat A doesn't change chat B's model.
- [ ] A guest chat with `vaultReadOnly: true` can read vault files but a
      copilot prompt that tries to write to vault is refused with a clear
      error.
- [ ] `promptBudgetTokens` enforcement works (approximate is fine).
- [ ] `/status` shows the resolved per-chat config.

### Risks / non-goals

- **Risk:** state file race conditions if multiple commands hit it
  simultaneously. Mitigation: single async writer pattern (queue writes,
  same as `gateway.js:queueTail`).
- **Non-goal:** per-chat *user* identity (Telegram chat ≠ user). v2.

### Effort

~3 days.

### Dependencies

- None hard. Pairs naturally with item 5 (multi-user ACL becomes meaningful
  once per-chat config exists).

---

## 5. Skills as MCP tools, not markdown prompts

**Hook:** Make deterministic skills *real code*, not "instructions copilot
has to remember to follow".

### Why

The current skill model — markdown files in `.github/skills/` that copilot
matches against the user's intent via prose in `.github/copilot-instructions.md`
— has three failure modes:

1. **Drift.** Copilot will sometimes skip the skill, sometimes mis-apply it,
   sometimes hallucinate fields the skill never specified.
2. **Cost.** Every prompt loads the routing block in
   `copilot-instructions.md`, plus copilot has to read the skill file
   itself when it triggers — pure prompt overhead.
3. **No type safety.** A skill saying "append to `expenses[]` with these
   fields" relies on copilot to remember exactly what fields. With MCP
   tools, the schema is enforced by JSON Schema validation before the call
   ever runs.

The deterministic skills (`finance-manager`, `scheduler-manager`,
`knowledge-ingestion`) belong as MCP tool calls. The soft skills (tone, vault
awareness, capture rules) stay as prompts because they're judgment-laden,
not procedural.

### Current state

- Four skill markdown files under `.github/skills/`.
- `copilot-instructions.md` routes via prose: "Use [skill X] when Yash
  mentions Y."
- Copilot CLI supports MCP via `--additional-mcp-config <json>` and a
  persistent config at `~/.copilot/mcp-config.json`.

### Design

**Stand up a small MCP server** at `mcp/index.js` (new top-level dir) using
the official `@modelcontextprotocol/sdk` Node package. Tools to expose:

- `finance.getState()` → returns full Port Louis state
- `finance.addExpense({ accountId?, amount, currency, label, category, notes?, date? })`
- `finance.addPendingExpense({ ... })`
- `finance.summarisePeriod({ period: 'day'|'week'|'month'|'year', date? })`
- `finance.listAccounts()`
- `scheduler.listJobs()`
- `scheduler.upsertJob({ id?, name, schedule, timezone?, workflow, enabled? })`
- `scheduler.toggleJob({ id, enabled })`
- `scheduler.deleteJob({ id })`
- `vault.search({ query?, topic?, tag?, limit? })` — uses
  `knowledge-base.json` exclusively, no grep.
- `vault.read({ filename })`
- `vault.list({ limit? })`

Each tool gets a strict JSON Schema. Server reads/writes the same files the
current skills do (no database).

**Wire it in** via `~/.copilot/mcp-config.json`:

```json
{
  "servers": {
    "kayo-tools": {
      "command": "node",
      "args": ["/home/yash-agrawal/Documents/kayo/mcp/index.js"],
      "env": {}
    }
  }
}
```

**Migrate skills incrementally:**

1. **finance-manager first** (because of roadmap item 2 wanting it).
   Replace the SKILL.md content with: "Use the `finance.*` tools when Yash
   mentions money. The tools handle ID generation, INR conversion,
   activityLog, and PUT to finance-guy."
2. **scheduler-manager** next.
3. **knowledge-ingestion** last (most complex skill, hardest to translate
   to function calls; some parts may stay as prompt).

### Acceptance

- [ ] `mcp/index.js` exposes the tools above with valid schemas.
- [ ] `node mcp/index.js` runs cleanly under MCP's stdio transport.
- [ ] Telegram prompt "I spent ₹500 on lunch" results in copilot calling
      `finance.addExpense({ amount: 500, currency: "INR", label: "lunch",
      category: "Food" })` (verifiable via MCP server logs).
- [ ] Telegram prompt "schedule a daily reminder at 9am" results in
      copilot calling `scheduler.upsertJob({...})`.
- [ ] Telegram prompt "what did I save about MCP?" results in copilot
      calling `vault.search({ query: "MCP" })`.
- [ ] All three of `finance-manager`, `scheduler-manager`,
      `knowledge-ingestion` SKILL.md files are <30 lines each
      (down from 60+ today).

### Risks / non-goals

- **Risk:** MCP tool calls add round-trip latency (copilot ↔ MCP server).
  Should be sub-100ms for local stdio. Verify before declaring done.
- **Risk:** copilot's MCP support quality. Test early.
- **Non-goal:** rewriting the soft skills (vault-awareness rule, tone,
  capture signals) as tools — they stay as prompts.
- **Non-goal:** building this as a generic MCP server for others to use.
  It's kayo-internal.

### Effort

~5–8 days. The infrastructure (MCP server scaffold) is fast; the per-skill
migrations are where the time goes.

### Dependencies

- None hard. Becomes a soft prereq for roadmap item 7 path B (Claude API
  migration), since MCP gives us a ready-made tool layer that doesn't
  depend on the copilot CLI.

---

## 6. Backup the second brain

**Hook:** One SSD failure currently nukes everything kayo knows.

### Why

Three irreplaceable bodies of state live on the laptop, none backed up:

| Path | What it is | Replaceable? |
|------|-----------|--------------|
| `~/Documents/kayo/vault/` | Months of curated knowledge notes + index | No. Hand-curated. |
| `~/Documents/tools/finance-guy/data/state.json` | Real financial history, account balances | No. |
| `~/Documents/kayo/telegram-bridge/runtime/` | Scheduled jobs, session histories, telegram offset | Mostly yes (would lose schedule history) but the `jobs.json` definitions are user-authored. |

A drive failure, a botched `rm`, an `apt upgrade` gone wrong, a stolen
laptop — any of these wipes everything. The vault alone represents weeks of
deliberate capture work.

### Current state

- No backups anywhere.
- `git push` covers the kayo *code* but is gitignored for `vault/runtime/`
  and finance-guy lives in a different repo.

### Design

**A. Snapshot script** at `tools/backup.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail
TS=$(date -u +%Y%m%dT%H%M%SZ)
WORK=$(mktemp -d)
trap "rm -rf $WORK" EXIT

tar -C "$HOME/Documents" -czf "$WORK/kayo-vault-$TS.tar.gz" kayo/vault
tar -C "$HOME/Documents" -czf "$WORK/kayo-runtime-$TS.tar.gz" kayo/telegram-bridge/runtime
tar -C "$HOME/Documents" -czf "$WORK/finance-guy-$TS.tar.gz" tools/finance-guy/data

# Encrypt with age (single recipient = your own age public key)
for f in "$WORK"/*.tar.gz; do
  age -r "$AGE_RECIPIENT" -o "$f.age" "$f"
  rm "$f"
done

# Upload
rclone copy "$WORK" "$RCLONE_REMOTE:kayo-backups/" --progress
```

**B. Systemd user timer** at `~/.config/systemd/user/kayo-backup.timer`:

```ini
[Unit]
Description=Daily kayo backup

[Timer]
OnCalendar=daily
Persistent=true

[Install]
WantedBy=timers.target
```

Plus the corresponding `kayo-backup.service` invoking `tools/backup.sh`.

**C. Retention policy** (separate cleanup script run weekly):

- Keep daily backups for 30 days.
- Keep monthly (1st of month) backups for 12 months.
- Keep yearly backups indefinitely.
- Implementable as a small `prune.sh` listing remote files, parsing dates,
  deleting per the policy.

**D. Restore script** at `tools/restore.sh`:

- Lists available backups.
- Downloads + decrypts the chosen one.
- `tar -xz` to a staging directory.
- Manual diff/copy step (don't auto-overwrite — too dangerous).

**E. Health probe integration:**

- Issue #3's tier-1 probe checks `last successful backup ≤ 36h`. If older,
  alert. Closes the loop on "backups silently broken".

**Storage choice:**

- Backblaze B2 is the cheapest (≈$6/TB/year). Few MB/day → costs
  effectively nothing.
- Wasabi, S3 also fine. Use rclone so the backend is swappable.
- Encrypted with age — even if the bucket leaks, contents are unreadable
  without the recipient key.

### Acceptance

- [ ] `tools/backup.sh` runs cleanly, produces three encrypted tarballs.
- [ ] Daily timer fires; check via `systemctl --user list-timers`.
- [ ] After 1 week, B2 has 7 backup sets.
- [ ] Restore drill: pick a random recent backup, decrypt, verify
      `vault/knowledge-base.json` content matches current.
- [ ] Retention policy runs weekly, removes backups > 30d that aren't
      monthly/yearly snapshots.
- [ ] Health probe (issue #3) flags missed backups within 36h.

### Risks / non-goals

- **Risk:** age key loss = backups unreadable. Mitigation: store the age
  key in a password manager + a printed paper copy in a safe place.
- **Risk:** B2/S3 credentials leak. Mitigation: use a write-only API key
  with no delete permissions (so an attacker can't wipe backups).
- **Non-goal:** real-time replication. Daily is enough for this data.
- **Non-goal:** backing up the kayo source — already in git.

### Effort

~1 day for the basic flow; another ~half day for retention + health
integration.

### Dependencies

- None. This could ship today.

---

## 7. Drop the copilot CLI cold-start

**Hook:** The biggest perf and reliability lever in the whole stack.

### Why

Every prompt currently does this dance:

1. `gateway.js` calls `runCopilot(...)` (`lib/copilot-cli.js:82`).
2. `runCopilot` spawns a fresh Node process: `/usr/bin/node
   .../@github/copilot/...` — full V8 init, requires the copilot binary,
   re-discovers the model client.
3. Copilot loads `.github/copilot-instructions.md` from disk, parses skills,
   reauthenticates the model session.
4. Only then does the model produce its first token.

Empirically: ~5–12s overhead **per prompt** before any model latency. That's
the floor on every single user-visible response. It's also a lot of
independently-failing pieces (the recent auth outage was exactly one of
them).

Two paths forward, with very different scope.

### Path A: Long-lived copilot daemon

Use copilot's existing **Agent Client Protocol** (`--acp` flag — visible in
`copilot --help` from the recent investigation) to keep one copilot process
alive in-gateway and pipe prompts to it via its socket.

**Pros:**
- Smaller migration. Most of the gateway/bridge stays the same.
- Keeps copilot's tool ecosystem (built-in MCP, GitHub tools, file editing,
  etc.) for free.
- Probably 5–10× latency improvement (no node cold start, no model client
  re-init).

**Cons:**
- ACP is newer surface area; expect rough edges.
- Daemon crashes need supervision (systemd inside systemd).
- Sessions need careful isolation to not bleed history across users
  (more relevant once item 4 lands).

**Effort:** ~3–5 days.

### Path B: Migrate the gateway to call the Claude API directly

Replace `runCopilot` entirely. Gateway becomes a Claude client with our own
tool-use loop (which is much easier if roadmap item 5 is done — the MCP
tools are reusable).

**Pros:**
- Native streaming (issue #1 becomes free).
- Native vision input (item 1, 2 become free).
- No more "copilot lost auth" outages — we own the auth.
- Per-message token accounting (item 4's `promptBudgetTokens`).
- Lower latency (no CLI cold start, no copilot wrapper).
- Much smaller dependency surface (`@anthropic-ai/sdk` instead of
  `@github/copilot` + everything copilot pulls in).
- Cleaner upgrade path to new Claude features (caching, batching, code
  execution, etc.).

**Cons:**
- Significant rewrite. We give up everything copilot does for free:
  built-in tools, GitHub MCP, the `init`/`autopilot` flows.
- Need to reimplement permission gating (currently `--yolo` does this).
- Need to handle our own retry / rate limit logic.
- Becomes our problem if a tool is buggy.

**Effort:** ~2–4 weeks for a real production-quality migration.

### Recommendation

- **Tactical (do soon):** Path A. Big win, modest effort, keeps the
  copilot ecosystem.
- **Strategic (think about 6+ months out):** Path B, **after** roadmap item
  5 (MCP) is in place. Don't start B without MCP; you'll just rebuild MCP
  badly while migrating.

### Acceptance (Path A)

- [ ] Gateway boots with one persistent copilot ACP process.
- [ ] `pgrep -af copilot` shows one process, not one-per-prompt.
- [ ] First prompt after boot < 3s end-to-end (down from 12s).
- [ ] Subsequent prompts < 2s overhead before the first token.
- [ ] Daemon crash → gateway restarts it within 10s; queued prompts retry.
- [ ] Session isolation: prompt to chat A's session doesn't see chat B's
      history (manual test by sending different prompts in two chats).

### Risks / non-goals

- **Risk (Path A):** copilot ACP behavior under sustained load is unknown.
  Mitigation: load test with 100 sequential prompts before committing.
- **Risk (Path B):** scope explosion. Mitigation: don't start Path B until
  MCP migration (item 5) is done and we have ≥3 months of usage data
  showing what we actually rely on.
- **Non-goal:** running both paths in parallel. Pick one.

### Dependencies

- Path A: none hard.
- Path B: roadmap item 5 (strong soft-prereq).

---

## Suggested execution order

This sequencing balances **risk reduction first**, then **user-visible
quality**, then **architectural foundation**.

1. **Issue #2** (log rotation / journald). 30 min. Blocks nothing else,
   removes a quiet failure mode.
2. **Issue #3** (health probe). Half a day. Makes everything else safer to
   iterate on — silent failures get noticed.
3. **Roadmap item 6** (backups). Half a day. Removes the worst tail-risk
   in the system.
4. **Issue #1** (streaming replies). 1–2 days. Biggest perceived-quality
   jump.
5. **finance-manager skill rewrite** (separate, tracked elsewhere). Half
   a day. Prereq for items 1+2 below.
6. **Roadmap item 1** (voice + image input). 2–4 days.
7. **Roadmap item 2** (receipt → finance-guy). 3–5 days. Magic moment.
8. **Roadmap item 3** (inline keyboards). 2 days. Polish.
9. **Roadmap item 5** (skills as MCP). 5–8 days. Refactor under the hood
   once we know what skills we actually use.
10. **Roadmap item 4** (per-chat config). 3 days. Foundation for sharing.
11. **Roadmap item 7 Path A** (copilot daemon). 3–5 days. Biggest latency
    win short of a full rewrite.
12. **Roadmap item 7 Path B** (Claude API migration). 2–4 weeks. Only
    after we have ≥3 months on the previous setup.

Total runway: roughly 6–8 weeks of focused work to get through #1–10, then
item 11 sometime after.
