---
name: github
description: Interact with Yash's GitHub via the gh CLI for issues, PRs, repos, releases, gists, workflows, and arbitrary REST calls
---

When Yash mentions anything that lives on GitHub — issues, PRs, repos, branches, releases, gists, GitHub Actions, workflow runs, stars, notifications, his profile — use the `gh` CLI. Authentication is already wired: the gateway injects `GH_TOKEN` from `GITHUB_PAT` in `telegram-bridge/.env`, so `gh` works out of the box from any cwd inside any copilot session.

## Authentication: it is already done. Do not ask for a PAT.

**This is the most important rule in this skill. Read it twice.**

`gh` is authenticated. `GH_TOKEN` is injected into every copilot subprocess by the gateway. **You will never need to ask Yash for a Personal Access Token. Ever.** Don't suggest he generate one. Don't link to `/settings/tokens`. Don't say "I need auth." Don't say "the PAT is invalid" or "expired" — you have no way to know that; the truth is auth works.

If `gh` returns an error, the failure is **not** auth unless the literal error message is one of:
- `gh auth login` required
- `HTTP 401`
- `bad credentials`
- `requires authentication`

Every other error means something else:
- **HTTP 404** = the repo/issue/PR/etc. does not exist (or it's private and your token can't see it, but that's a scope issue not "invalid auth"). **Check for typos** in the name — search the user's repos with `gh repo list <owner> --limit 100` and look for close matches before concluding it doesn't exist.
- **HTTP 403** = rate limited or insufficient scope for a specific endpoint. Report the literal message.
- **HTTP 422** = validation error (e.g. branch already exists). Report it.
- Network errors = the network, not auth.

If something fails, **paste the literal stderr from `gh`** in your reply. Do not paraphrase. Do not interpret "not found" as "auth broken." Do not suggest token rotation as a fix unless you got an actual 401.

**If you ever feel the urge to ask "please generate a new PAT" — stop. Run `gh api user` first. If that returns a login, auth is fine and the issue is somewhere else.**

## When to use `gh` vs `git`

- **`gh`** — anything that talks to github.com over HTTPS: issues, PRs, releases, gists, repo listing, workflow runs, `gh api` for arbitrary REST endpoints.
- **`git`** — local repo operations: branching, committing, diffing, staging, log inspection.

If both could work (e.g. "push my branch"), use `git push` for the push itself and `gh pr create` for the PR.

## Hard rules (inherited from copilot-instructions.md)

- **Never push, create PRs, create releases, merge, or close issues/PRs unless Yash explicitly asks.** "Show me my open PRs" is a read; "open a PR for this branch" is a write — only the write needs an explicit ask.
- Never run `gh auth login`, `gh auth logout`, or `gh auth refresh`. Auth is already configured via the keyring + `GH_TOKEN` env var. Touching it can wipe Yash's session.
- Never `gh repo delete`, `gh release delete`, `gh issue delete`, `gh gist delete`, `gh ssh-key delete`, or `gh pr close` without explicit confirmation, even if it seems implied.

## Common patterns

### Read operations (do these freely)

```bash
gh issue list --repo owner/name --state open --limit 20
gh issue view 42 --repo owner/name
gh pr list --author "@me" --state open
gh pr view 17 --repo owner/name
gh pr diff 17 --repo owner/name
gh pr checks 17 --repo owner/name
gh repo list --limit 30 --json name,description,updatedAt
gh run list --workflow ci.yml --limit 10
gh run view <run-id> --log-failed
gh release list --repo owner/name
gh api user                              # who am I
gh api /repos/owner/name/topics          # any REST endpoint
gh api graphql -f query='...'            # GraphQL when REST is awkward
```

### Write operations (always confirm first unless Yash explicitly asked)

```bash
gh issue create --repo owner/name --title "..." --body "..."
gh issue comment 42 --repo owner/name --body "..."
gh pr create --title "..." --body "..." --base main
gh pr review 17 --approve --body "lgtm"
gh release create v1.2.3 --notes "..."
gh gist create file.md --public
```

### Output handling

- `gh` defaults to colored TTY output. For programmatic use add `--json field1,field2` and pipe through `jq`.
- For large lists, use `--limit N` to keep responses bounded.
- `gh api` outputs raw JSON — pipe through `jq` immediately rather than trying to read it raw.

## When `gh` is the wrong tool

- The fetcher under `web-fetcher/` is for arbitrary URLs (tweets, articles, YouTube). For a GitHub URL, prefer `gh` because it returns structured data instead of rendered HTML.
- For browsing the user's *own* repos in this workspace, `git` operations are faster than `gh` round-trips.

## Reporting back

When you've done a `gh` operation:
- For reads: summarize the result, don't paste 50 lines of JSON.
- For writes: report the resulting URL (`html_url` from the response) so Yash can click through.
- For destructive operations: state what changed and what's now irrecoverable.

## Extending this skill

If you find a new common `gh` pattern Yash uses, append it to the "Common patterns" section. If you start using a new GitHub-adjacent CLI (e.g. `gh-dash`, `act`), register it as a tool via the `self-extend` skill — don't bury it inline here.
