---
name: self-extend
description: The protocol Kayo follows to add a new skill, runtime service, or tool to itself — central registry, validation, and restart rules
---

Use this skill when Yash asks for a new capability that doesn't fit an existing one. Examples:
- "teach yourself how to talk to my Notion" → register a new skill + tool.
- "spin up a service that pings my home assistant every 5 minutes" → register a new runtime service.
- "remember `gh-dash` is for browsing PRs visually" → register a new tool.

The point of this skill is that Kayo grows itself. Every new capability flows through the same registry and the same validation steps, so the foundation stays coherent.

## The registry

Single source of truth: **`.github/registry.json`**

```jsonc
{
  "$schema": "kayo-registry/v1",
  "version": 1,
  "updatedAt": "<ISO-8601>",
  "skills":   [ /* SkillEntry[]   */ ],
  "services": [ /* ServiceEntry[] */ ],
  "tools":    [ /* ToolEntry[]    */ ]
}
```

### Entry shapes

**SkillEntry** — AI-side playbooks loaded by copilot when a topic matches.
```jsonc
{
  "name": "kebab-case-name",            // matches the folder under .github/skills/
  "path": ".github/skills/<name>/SKILL.md",
  "summary": "one sentence",
  "triggers": ["keyword", "phrase"],    // human-readable, used in routing
  "addedAt": "2026-05-24"
}
```

**ServiceEntry** — long-lived background process started by `telegram-bridge/start-all.js`.
```jsonc
{
  "name": "kebab-case-name",
  "entrypoint": "telegram-bridge/<file>.js", // path relative to repo root
  "autostart": true,                          // false = registered but disabled
  "summary": "one sentence",
  "addedAt": "2026-05-24"
}
```

**ToolEntry** — a CLI or script Kayo can invoke. Includes system binaries Yash relies on (`gh`, `jq`, `rg`) and repo-local tools (`web-fetcher/fetch.js`).
```jsonc
{
  "name": "kebab-case-name",
  "binPath": "/abs/path or repo-relative path",
  "summary": "one sentence",
  "installCmd": "how to (re)install — apt, npm, tarball URL, etc.",
  "addedAt": "2026-05-24"
}
```

## The protocol

When adding a new extension, follow these steps in order. Do not skip steps even if they feel obvious.

### 1. Decide the type

If the new capability is:
- **A new behavior, topic, or playbook for the AI** → it's a **skill**.
- **A long-running process** → it's a **service**.
- **A CLI you'll invoke ad-hoc** → it's a **tool**.

A capability can be more than one (e.g. "Notion integration" might be a skill + a tool). Add all relevant entries.

### 2. Validate the name

- Kebab-case, lowercase, no spaces.
- Must not collide with an existing entry of the same type. Read `registry.json` first.
- Skills: must match the directory under `.github/skills/`.

### 3. Write the file(s)

**Skill**: `mkdir -p .github/skills/<name>` and write `SKILL.md` with YAML frontmatter (`name`, `description`) and the body. Mirror the shape of an existing skill — look at `.github/skills/cli-fluency/SKILL.md` for the format. Link related skills with `[[other-skill-name]]`.

**Service**: write the entrypoint under `telegram-bridge/`. Use `loadConfig()` from `lib/env.js` so it picks up `.env`. Use `console.log`/`console.error` — output goes to journald via `kayo-bot.service`.

**Tool**: if it needs install steps (clone, npm install, tarball download), do them now. Record the install command in `installCmd` so future-you can reproduce it.

### 4. Update the registry

Read-modify-write `.github/registry.json` with this discipline:

1. Read the current file.
2. Validate the JSON parses.
3. Backup to `.github/registry.json.bak` (overwrite — single backup is enough).
4. Append the new entry to the correct array.
5. Bump `updatedAt` to now.
6. Write atomically (write to `.tmp`, then `mv`).
7. **Run the validator: `node scripts/validate-registry.js`.** Only proceed if it exits 0.
8. If the validator fails, restore from `.bak` and report the error to Yash. Do not leave the foundation in a broken state.

### 5. Wire the routing (skills only)

A skill entry in `registry.json` does not auto-route. Update `.github/copilot-instructions.md`:
- Under "When to Use Which File", add a line: `Use [.github/skills/<name>/SKILL.md](.github/skills/<name>/SKILL.md) when ...`
- Keep the trigger phrasing tight (one sentence).

### 6. Apply changes

| Type | What to do |
|---|---|
| Skill | Nothing — copilot picks it up on the next invocation. |
| Service | Tell Yash: `systemctl --user restart kayo-bot.service`. **Don't restart yourself** — restarting kills the very process you're running in. |
| Tool | If the tool needs env vars, add them to `.env` and surface in `lib/env.js`. Then for services that need the var, ask Yash to restart. |

### 7. Report

Summarize for Yash: what got added, where, and any manual action needed (restart, PAT, etc.).

## Removing or disabling

To temporarily disable a service: set `autostart: false` in its registry entry, then ask Yash to restart the bridge. The entry stays for documentation; the process doesn't spawn.

To remove an extension entirely: delete the file(s), remove the registry entry, remove the routing line in `copilot-instructions.md`, ask for a restart if it was a service.

## What NOT to register

- One-off scripts in `/tmp/`. The registry is for things Kayo will use again.
- Per-task notes — those go in the vault, not the registry.
- Secrets — those go in `.env`, never in `registry.json` (it's checked in).

## Failure modes to watch for

- `start-all.js` reads the registry on boot. **Invalid JSON in `registry.json` breaks startup.** Always validate before writing.
- A service entry pointing to a missing file silently skips (logged to journald). Check `journalctl --user -u kayo-bot -n 50` after registering a service.
- A skill without a routing line in `copilot-instructions.md` will be invisible. The registry is for tracking; the routing file is for triggering.

## Cross-references

- [[cli-fluency]] — when to register a new tool.
- [[github]] — example of a skill that ships its own CLI dependency (`gh`).
