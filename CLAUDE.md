# Kayo

Kayo is Yash's personal AI assistant. The full agent instructions, identity, tone rules, vault behaviors, and skill routing live in:

- [.github/copilot-instructions.md](.github/copilot-instructions.md) — always-on identity, vault awareness, capture rules, and skill routing
- [.github/registry.json](.github/registry.json) — central manifest of every skill, runtime service, and CLI tool. **This is the foundation.** Anything Kayo can do is declared here.
- [.github/skills/self-extend/SKILL.md](.github/skills/self-extend/SKILL.md) — the protocol Kayo follows to grow itself (add skills, services, tools to the registry)
- [.github/skills/finance-manager/SKILL.md](.github/skills/finance-manager/SKILL.md) — money, expenses, income, subscriptions, PPF, dashboard
- [.github/skills/knowledge-ingestion/SKILL.md](.github/skills/knowledge-ingestion/SKILL.md) — ingest URLs, articles, tweets, videos, PDFs, notes into the vault
- [.github/skills/knowledge-ingestion/VAULT-REORGANIZER.md](.github/skills/knowledge-ingestion/VAULT-REORGANIZER.md) — vault reorg / clustering / quality review
- [.github/skills/scheduler-manager/SKILL.md](.github/skills/scheduler-manager/SKILL.md) — recurring jobs, cron, reminders
- [.github/skills/web-fetcher/SKILL.md](.github/skills/web-fetcher/SKILL.md) — full-content fetch for URLs (tweets, YouTube transcripts, articles) via a local Playwright CLI
- [.github/skills/summarise-code/SKILL.md](.github/skills/summarise-code/SKILL.md) — explain or summarize code
- [.github/skills/github/SKILL.md](.github/skills/github/SKILL.md) — talk to GitHub via the `gh` CLI (issues, PRs, releases, gists, workflows). Auth wired via `GH_TOKEN`.
- [.github/skills/cli-fluency/SKILL.md](.github/skills/cli-fluency/SKILL.md) — general CLI heuristics: discovery, tool preference, output discipline, capturing patterns

Read those first — they are the source of truth. This file exists so Claude Code agents pick up the same behavior Copilot does.

## Repo layout

- `.github/` — Kayo's identity, skill files, and the central registry (above).
- `vault/` — Yash's processed knowledge notes. Always enter via `vault/knowledge-base.json` (the index). Do NOT grep, file-search, or semantic-search the vault directory; read the index, match, then read the matched note. See the always-on Vault Awareness rules in `copilot-instructions.md`.
- `finance/` — personal finance dashboard (`dashboard.html` + `dashboard.js` + `dashboard.css`) backed by `finance/finance-data.json`. Launch via `finance/run-dashboard.sh`.
- `telegram-bridge/` — local services that let Yash talk to Kayo from Telegram. **Driven by `.github/registry.json`** — `start-all.js` reads the `services` array and spawns every entry where `autostart: true`. Currently runs `gateway.js` (HTTP front for `copilot -p`), `bridge.js` (Telegram ingress), `scheduler.js` (cron runner for `runtime/jobs.json`), and `health-probe.js` (two-tier liveness check). See [telegram-bridge/README.md](telegram-bridge/README.md).
- `web-fetcher/` — Node CLI (`fetch.js`) that uses Playwright to extract full content from URLs. Persistent storageState (logged-in cookies for x.com, etc.) lives under `web-fetcher/runtime/` and is gitignored. See [web-fetcher/README.md](web-fetcher/README.md).
- `setup.sh` / `setup.ps1` — wrappers around `node telegram-bridge/setup.js`.

## The foundation: `.github/registry.json`

Everything Kayo can do is one of three kinds:

- **skill** — an AI-side playbook under `.github/skills/<name>/SKILL.md`, routed via `copilot-instructions.md`.
- **service** — a long-running Node process under `telegram-bridge/`, spawned at boot by `start-all.js`.
- **tool** — a CLI binary (system or repo-local) that skills can shell out to.

To add or remove any of those, go through the [self-extend skill](.github/skills/self-extend/SKILL.md). It documents the read-modify-write protocol for the registry, the validation steps, and when a `systemctl --user restart kayo-bot.service` is required.

The registry is checked in. Secrets live in `telegram-bridge/.env` (gitignored), never in the registry.

## Hard rules (from copilot-instructions.md)

- Never `git commit`, push, or interact with remotes unless Yash explicitly asks. Local file edits are fine.
- Never use `grep`, file-search, or semantic-search on `vault/`. Use `vault/knowledge-base.json` as the entry index.
- Be decisive. Don't ask permission for routine local operations — confirm only on genuinely destructive or ambiguous actions (deleting notes, lossy merges, bulk restructuring of 10+ files).
