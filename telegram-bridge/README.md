# Telegram Bridge

This folder now contains two local services:

- A localhost gateway that routes prompts to the installed `copilot` CLI in this repo.
- A Telegram ingress that forwards messages to that gateway and returns the reply.

Architecture:

```text
Telegram -> bridge.js -> localhost gateway.js -> copilot -p -> Telegram
```

This keeps the ingress layer separate from the execution backend, so new channels can plug into the same local agent later.

## What it does

- Runs on your laptop 24/7.
- Restricts access to specific Telegram chat IDs.
- Routes all prompts through one laptop-local gateway backed by `copilot -p`.
- Executes `copilot` inside this repo, so repo instructions and skills apply on every request.
- Persists a short per-chat conversation history for continuity.
- Persists the Telegram update offset so restarts do not replay old messages.
- Serializes prompt execution through one gateway queue so concurrent repo edits do not fight each other.

## Prerequisites

- Node.js 18 or newer.
- A Telegram bot token from BotFather.
- Your Telegram numeric chat ID.
- The `copilot` CLI installed on this laptop and already authenticated.

Important: this still does not talk to the live VS Code chat session. It talks to the installed CLI by running `copilot -p` from this repo.

## Setup

1. Copy `.env.example` to `.env`.
2. Edit `.env` with your bot token, allowed chat IDs, and a random gateway token.
3. Leave `COPILOT_BIN=copilot` unless your command name is different.
4. Keep `COPILOT_PERMISSION_MODE=tools` for a tighter setup, or switch to `yolo` if you want fully unblocked autonomous runs.

The gateway uses this command shape internally:

```powershell
copilot -p "<prompt>" -s --output-format text --stream off
```

With permission flags added from `.env`:

- `tools`: `--allow-all-tools --allow-all-paths --no-ask-user`
- `yolo`: `--yolo`

## Running

From `telegram-bridge/`:

```powershell
npm start
```

This starts both the local gateway and the Telegram bridge.

If you want to run them separately:

```powershell
npm run start:gateway
npm run start:telegram
```

For a Windows machine you leave on all day, the usual next step is to run it under Task Scheduler, NSSM, or another service wrapper after you confirm the command config works.

## Telegram commands

- `/start`
- `/help`
- `/status`
- `/reset`

Any other text message is forwarded as a prompt.

## Files ignored from git

- `.env`
- `runtime/state.json`

Session history is also stored under `runtime/sessions/`.

## Notes

- Telegram messages are returned as plain text.
- Long responses are split into multiple Telegram messages.
- Only text messages are processed.
- The gateway only listens on `127.0.0.1` by default.
- If prompts that need network access get blocked, change `COPILOT_PERMISSION_MODE` to `yolo`.