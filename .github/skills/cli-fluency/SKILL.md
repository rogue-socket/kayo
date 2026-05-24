---
name: cli-fluency
description: General heuristics for using CLI tools well — discovery, preferring specialized tools over hand-rolled scripts, capturing reusable patterns
---

This is a base behavior for how to think about CLI work, not a skill keyed to a specific topic. Apply it whenever a task could be solved by a CLI — which is most of them on Yash's machine.

## Discovery before guessing

When you're about to do something with a CLI tool you haven't used in this session:

1. `<tool> --help` first. Faster than guessing flags.
2. If `--help` is sparse, `<tool> <subcommand> --help`.
3. If still unclear, `man <tool>`.
4. Last resort: web search. But almost everything is in `--help`.

Don't pattern-match from memory if the syntax is non-trivial. Memory drifts; `--help` is current.

## Prefer specialized tools over hand-rolled scripts

| If the job is | Use | Not |
|---|---|---|
| Parsing JSON | `jq` | `grep`/`sed`/`awk` on JSON |
| Searching code | `rg` (ripgrep) | `grep -r`, `find ... | xargs grep` |
| Talking to GitHub | `gh` (see [[github]]) | `curl` against the GitHub API |
| Talking to a generic URL | `web-fetcher/fetch.js` | `curl` + manual extraction |
| Reformatting JSON / YAML | `jq` / `yq` | hand-written scripts |
| File-tree exploration | `rg --files`, targeted globs | `find /`, `ls -R` |
| HTTP requests for testing | `curl` (or `xh` if installed) | wrapping `node` |
| Diff between text | `diff -u`, `git diff --no-index` | manual eyeballing |
| Date math | `date -d "..."`, `python -c "..."` | guessing |

If the right specialized tool isn't installed and Yash uses the pattern more than once, add it via `self-extend` so the installation/usage is recorded.

## Avoid noisy output

Yash's global rule: don't dump thousands of lines. Always bound output before surfacing it.

- Pipe through `head -n 50`, `tail -n 50`, `wc -l`, or `| less` (only if interactive).
- For repeated grep-style filtering, prefer `rg pattern` over `grep pattern` (faster, respects `.gitignore`).
- For huge command outputs (builds, tests), redirect to `/tmp/<job>.log 2>&1` then grep.

## Use `--dry-run` when available

Many CLIs (`gh`, `rsync`, `kubectl`, `git`, `aws`) support `--dry-run` or `-n`. For any write-side operation, do a dry run first and report what would happen before doing it for real.

## Capture reusable knowledge

Three signals you should record what you just learned:

1. You spent more than ~3 attempts figuring out the right flag combo. → Save the pattern as a snippet under the relevant skill.
2. You used a CLI tool that isn't already in `.github/registry.json`. → Add it via `self-extend`.
3. Yash uses a phrase that consistently means "run command X". → Add a routing line to the relevant skill so next time it's automatic.

The principle: every time a CLI invocation goes from "had to look it up" to "I'll need this again", that's a memory leak unless you write it down.

## Sandboxing

Kayo runs as Yash's user with file access constrained to `FILE_ACCESS_ROOTS`. But there is **no sandbox on shell commands**. A bad `rm -rf` or `kill -9` lands on the real host. Apply the same caution as a human at the terminal:

- Confirm before `rm -rf`, `truncate`, `dd`, `mkfs`, `kill -9 <pid>`, `pkill`, `systemctl stop`, package removals.
- Never edit files under `~/.copilot/`, `~/.config/systemd/user/kayo-bot.service`, or anything inside `telegram-bridge/runtime/` unless Yash explicitly asks — these are Kayo's own runtime state.

## Cross-references

- [[github]] — the `gh` CLI specifically.
- [[self-extend]] — how to grow Kayo's CLI fluency over time.
