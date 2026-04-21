---
name: scheduler-manager
description: Manage recurring local workflows and cron jobs for the Telegram bridge runtime
---

When the user asks to schedule, automate, pause, resume, inspect, or delete recurring work, use this process.

1. Data source
- Use `telegram-bridge/runtime/jobs.json` as the source of truth.
- If the file does not exist, create it with:
  - `{"version": 1, "jobs": []}`
- Preserve existing jobs unless the user explicitly asks to delete one.
- Runtime fields may be updated by `scheduler.js`; do not remove them unless required for a repair.

2. When to use this skill
- Requests like `every day`, `every Monday`, `monthly`, `run this automatically`, `schedule this`, `pause that job`, `resume it`, `delete that reminder`, `list my scheduled jobs`.
- Recurring summaries, recurring prompts, recurring reminders, or any request that implies cron-like local automation.

3. Job schema
- Keep a top-level object with `version` and `jobs`.
- Each job should include:
  - `id`
  - `name`
  - `schedule`
  - `timezone`
  - `enabled`
  - `workflow`
  - `sessionMode`
  - `createdAt`
  - `updatedAt`
- Runtime-managed fields may also be present:
  - `runtimeUpdatedAt`
  - `lastRunAt`
  - `nextRunAt`
  - `lastStatus`
  - `lastError`

4. Workflow rules
- Prefer `workflow.kind = "copilot-prompt"` unless the user clearly wants a different workflow type.
- For `copilot-prompt`, store a self-contained `workflow.prompt` that can be run later without relying on the immediate chat turn.
- Store delivery under `workflow.delivery`.
- For Telegram delivery, use:
  - `{"channel": "telegram", "target": "<chat id>"}`

5. Delivery target defaults
- If the request context includes `telegram_chat_id` and the user does not specify a delivery target, default Telegram delivery to that `telegram_chat_id`.
- If the request does not imply a destination and no default target is available, ask one short clarifying question instead of inventing a target.

6. Scheduling rules
- Translate natural-language schedules into 5-field cron expressions.
- Use IANA timezone names in `timezone`.
- Default `sessionMode` to `per-job`.
- Default `enabled` to `true` for newly created jobs.
- Do not hand-compute `nextRunAt` unless necessary; the scheduler can populate runtime fields.

7. Update rules
- Create new jobs with deterministic IDs in the form `job-###`.
- On create:
  - append a new job
  - set `createdAt` and `updatedAt` to the current ISO timestamp
- On edit:
  - change only the requested fields
  - bump `updatedAt`
- On pause:
  - set `enabled` to `false`
  - bump `updatedAt`
- On resume:
  - set `enabled` to `true`
  - bump `updatedAt`
- On delete:
  - remove the job only if the user explicitly asks to delete it

8. Response rules
- Confirm what was scheduled or changed.
- Include the plain-language cadence, timezone, and delivery target.
- If the user asks to list jobs, summarize enabled and paused jobs first, then mention useful runtime status.
- If timing is ambiguous, ask one concise follow-up question.