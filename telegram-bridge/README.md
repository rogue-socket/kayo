# Telegram Bridge

This folder now contains three local services:

- A localhost gateway that routes prompts to the installed `copilot` CLI in this repo.
- A Telegram ingress that forwards messages to that gateway and returns the reply.
- A local scheduler that runs persisted workflows on cron-like schedules.

Internal helper modules live under `lib/` so the top level stays focused on the runnable entrypoints.

Architecture:

```text
Telegram -> bridge.js -> localhost gateway.js -> copilot -p
Scheduler -> workflow-runner.js -> localhost gateway.js -> copilot -p
```

## What it does

- Runs on the host machine 24/7.
- Restricts access to specific Telegram chat IDs.
- Routes all prompts through one local gateway backed by `copilot -p`.
- Executes `copilot` inside this repo, so repo instructions and skills apply on every request.
- Supports two context modes: bridge-managed history or native Copilot session resume.
- Persists the Telegram update offset so restarts do not replay old messages.
- Persists scheduled jobs under `runtime/jobs.json`.
- Serializes prompt execution through one gateway queue so concurrent repo edits do not fight each other.
- Streams replies into a single Telegram message via incremental edits, so long answers are visible as they generate instead of after a full buffered round-trip.

## Prerequisites

- Node.js 18 or newer.
- npm.
- A Telegram bot token from BotFather.
- Your Telegram numeric chat ID.
- The `copilot` CLI installed on this machine and already authenticated.

Important: this does not talk to the live VS Code chat session. It talks to the installed CLI by running `copilot -p` from this repo.

## Setup

The canonical setup entrypoint is:

```bash
node telegram-bridge/setup.js
```

Convenience wrappers are available from the repo root:

```powershell
./setup.ps1
```

```bash
./setup.sh
```

The setup flow will:

1. Verify Node.js.
2. Ask for Telegram secrets and allowed chat IDs.
3. Ask for file roots and default timezone.
4. Write `telegram-bridge/.env`.
5. Initialize `runtime/jobs.json`.
6. Run a Copilot smoke test.
7. Install dependencies.
8. Start the gateway, Telegram bridge, and scheduler.

Use `--setup-only` if you want it to stop after writing config and installing dependencies.

## Running

From `telegram-bridge/`:

```powershell
npm start
```

This starts:

- `gateway.js`
- `bridge.js`
- `scheduler.js`
- `health-probe.js`

If you want to run them separately:

```powershell
npm run start:gateway
npm run start:telegram
npm run start:scheduler
```

## Streaming replies

Live Telegram traffic uses incremental message edits instead of a buffered round-trip:

1. `bridge.js` sends a placeholder message (`⌛`) and opens an SSE stream against `POST /v1/prompt` with `{ "stream": true }`.
2. `gateway.js` invokes copilot with stdout streaming enabled and emits SSE events as chunks arrive: `event: chunk` for each stdout chunk, `event: done` with the final cleaned reply, `event: error` on failure.
3. The bridge accumulates chunks into a buffer and edits the placeholder. Edits are debounced to ~700ms and the active message rolls over to a new continuation message once it crosses 4000 characters.
4. If no chunk arrives for 20 seconds (e.g. copilot is running tools), a heartbeat footer (`_…still working (Ns)_`) is appended via edit so the message never looks frozen.
5. Telegram 429 responses are honored via `retry_after`. "Message is not modified" errors are swallowed.

The buffered (`stream: false`, the default) branch of `POST /v1/prompt` is unchanged and still returns `{ ok, sessionId, reply, elapsedMs }`. The scheduler uses this branch so scheduled deliveries arrive as a single `sendMessage` call, not a chain of edits.

Session persistence is identical for both paths — `runtime/sessions/<sessionId>.json` is written once at the end with the full final reply.

Relevant modules:

- `lib/copilot-cli.js` — `streamCopilot()` async iterator.
- `gateway.js` — SSE branch on `POST /v1/prompt`.
- `lib/transport/gateway-client.js` — `streamGateway()` SSE consumer.
- `lib/transport/telegram-api.js` — `sendMessage`, `editMessageText`, error metadata (`statusCode`, `retryAfter`).
- `lib/streaming-reply.js` — placeholder + debounced edit loop + heartbeat + 4000-char split + 429 backoff.

## Telegram commands

- `/start`
- `/help`
- `/status`
- `/reset`
- `/session new`
- `/session list`
- `/sessions`
- `/session current`
- `/session use <session-id|default>`
- `/files roots`
- `/files ls <alias:/path>`
- `/file send <alias:/path>`

Any other text message is forwarded as a prompt.

### Session behavior

- Each chat keeps an active session ID for prompt routing.
- By default, the active session starts as the chat ID itself.
- Use `/session new` to create and switch to a fresh session.
- Use `/session list` to see known sessions for the current chat.
- Use `/session use <session-id|default>` to switch back and forth.
- `/reset` clears context for the active session.

### Context modes

- `COPILOT_CONTEXT_MODE=bridge-history`:
	- Gateway stores short transcript files in `runtime/sessions/`.
	- Gateway prepends recent conversation to each `copilot -p` call.
	- `COPILOT_HISTORY_TURNS` and `COPILOT_HISTORY_CHARS` apply.
- `COPILOT_CONTEXT_MODE=native-session`:
	- Each logical Telegram session maps to a real Copilot UUID session.
	- Gateway calls `copilot -p --resume=<uuid>` for continuity.
	- Bridge transcript injection is disabled to avoid duplicate context.
	- `/session list` shows logical session IDs and mapped Copilot UUIDs.
	- `/reset` rotates the mapped Copilot UUID for a fresh context.

## File access

File access is controlled by `FILE_ACCESS_ROOTS` in `.env`.

Example:

```text
FILE_ACCESS_ROOTS=repo=.,vault=./vault
```

Paths outside configured roots are blocked. The bridge also blocks common sensitive paths by default, including:

- `.git/`
- `.env`
- `telegram-bridge/.env`
- `telegram-bridge/runtime/`

## Scheduled jobs

Scheduled jobs live in `telegram-bridge/runtime/jobs.json` and are executed by `scheduler.js`.

The intended authoring path is natural language through Copilot, backed by the scheduler skill. Example requests:

- `every day at 8am send me my finance summary`
- `list my scheduled jobs`
- `pause the daily summary`

The scheduler currently supports workflows of kind `copilot-prompt` and Telegram delivery as the first delivery channel.

## Health probe

A separate `health-probe.js` process watches for failure modes that leave the bot superficially up but functionally dead (copilot lost auth, model unavailable, rate-limited, bridge stuck, scheduler erroring, gateway crashed without restart).

Two tiers:

- **Tier 1 — every 30 min, zero token cost.** Hits `GET /v1/status`, checks that `runtime/state.json` was updated within the last hour (proves the bridge is polling Telegram), and looks for fresh `lastStatus: error` entries in `runtime/jobs.json` (scheduler errors).
- **Tier 2 — every 6 h, low token cost.** Resets the `health-probe` session, then sends `POST /v1/prompt` with `{ "prompt": "Reply with the single word: ok", "bare": true }`. The `bare: true` flag skips the workspace envelope so the prompt is just the literal user message. Reply is matched against `/^[●\s]*ok[\s.!]*$/i`.

On failure, the probe sends one Telegram DM to the admin chat and persists per-class state in `runtime/health-probe.json`. Repeated failures of the same class within 12 h are silenced (logged only). Recovery is silent — no "all good" pings.

Failure classes: `auth`, `rate-limit`, `model`, `network`, `bridge-stalled`, `gateway-down`, `scheduler-error`, `unknown`.

The `/status` Telegram command surfaces the latest probe times and last error.

### Environment knobs

| Variable | Default | Purpose |
|---|---|---|
| `HEALTH_PROBE_ENABLED` | `true` | Set to `false` to skip starting the probe. |
| `HEALTH_PROBE_TIER1_INTERVAL_MS` | `1800000` (30 min) | Tier-1 cadence. Min 60s. |
| `HEALTH_PROBE_TIER2_INTERVAL_MS` | `21600000` (6 h) | Tier-2 cadence. Set to `0` to disable tier-2. |
| `HEALTH_PROBE_BRIDGE_STALE_MS` | `3600000` (1 h) | How old `state.json.lastPollAt` must be to count as bridge-stalled. |
| `HEALTH_PROBE_ALERT_COOLDOWN_MS` | `43200000` (12 h) | Per-class minimum between alerts. |
| `HEALTH_PROBE_ALERT_CHAT_ID` | first id in `TELEGRAM_ALLOWED_CHAT_IDS` | Where probe alerts are delivered. |

### Manually testing failure detection

```bash
# Simulate auth failure
mv ~/.copilot ~/.copilot.bak
systemctl --user restart kayo-bot.service
# wait for next tier-2 (or restart triggers a boot probe within ~30s)
# expect: one Telegram DM "🚨 kayo health probe: auth"

# Restore
mv ~/.copilot.bak ~/.copilot
systemctl --user restart kayo-bot.service
```

The probe writes to `runtime/health-probe.json` only — it never persists to a real user's session.

## Logs

When running under the `kayo-bot.service` systemd user unit, all stdout/stderr from the gateway, bridge, and scheduler goes to journald. There is no longer a `runtime/kayo.log` file — journald handles rotation, compression, and retention.

Common queries:

```bash
# Live tail
journalctl --user -u kayo-bot -f

# Last hour
journalctl --user -u kayo-bot --since '1 hour ago'

# Errors only
journalctl --user -u kayo-bot -p err

# Match text
journalctl --user -u kayo-bot | grep 'authentication'

# Since last restart
journalctl --user -u kayo-bot --since "$(systemctl --user show kayo-bot -p ActiveEnterTimestamp --value)"

# Current journal disk usage
journalctl --user --disk-usage
```

If you run the services manually (`npm start`, etc.) outside systemd, output goes to your shell as usual.

## Environment notes

- `COPILOT_PERMISSION_MODE` is fixed to `yolo`.
- `COPILOT_CONTEXT_MODE` controls context source: `bridge-history` or `native-session`.
- `TELEGRAM_ALLOWED_CHAT_IDS` supports comma, space, semicolon, or newline-separated chat IDs.
- `DEFAULT_TIMEZONE` controls the fallback timezone for scheduled jobs.
- `FILE_ACCESS_MAX_BYTES` controls the largest file the bridge will send over Telegram.
- `SCHEDULER_POLL_INTERVAL_MS` controls how often the scheduler checks due jobs.

## Files ignored from git

- `.env`
- `runtime/`

That covers:

- Telegram update state
- session history
- scheduled jobs
- any other runtime artifacts