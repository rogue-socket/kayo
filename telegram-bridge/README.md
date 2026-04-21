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

If you want to run them separately:

```powershell
npm run start:gateway
npm run start:telegram
npm run start:scheduler
```

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