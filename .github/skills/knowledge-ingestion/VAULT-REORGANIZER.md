---
name: vault-reorganizer
description: Reorganize, cluster, and improve vault notes. Use when user wants to restructure the vault, group notes into folders, or review note quality.
---

Reorganize and improve the vault structure. This skill operates on the same vault and indexes as the knowledge-ingestion skill but is only loaded when Yash explicitly wants to restructure.

Triggers: "reorganize vault", "cluster my notes", "restructure vault", "tidy the vault", "review vault structure", "review vault", "improve notes"

## Prerequisites

Before doing anything, read these two files to load the full vault map:
- `vault/knowledge-base.json` — the master index
- `vault/topics.json` — topic-to-notes mapping

These two files contain everything needed for the analysis phase: topics, tags, connections, summaries, filenames. **Do NOT read individual note files during analysis.** The indexes are the analysis input. Only read specific note files during execution (to update connection sections) or if Yash explicitly asks for detail on a specific note.

All vault access rules from `copilot-instructions.md` apply here too (index-first, never grep the vault).

## 1. Analysis phase (always do this first)

1. Read `vault/knowledge-base.json` and `vault/topics.json` to load the full map. This is all you need — do not read note files yet.
2. Build a topic co-occurrence matrix: which topics appear together on the same notes?
3. Identify **clusters** — groups of notes that share overlapping topics or are thematically connected. A cluster is NOT a 1:1 mapping of topic→folder. Clusters are broader groupings:
   - e.g., `github` + `open-source` + `developer-tools` + `metrics-manipulation` → cluster: `tech-industry`
   - e.g., `hiring` + `leadership` + `management` + `startups` → cluster: `business-leadership`
   - e.g., `ai-agents` + `agent-frameworks` + `self-improving-systems` → cluster: `ai-agents`
4. Flag notes with weak/missing connections that clustering would surface.
5. Flag notes with thin content that could benefit from enrichment.
6. Identify potential duplicates or highly overlapping notes.

## 2. Execute and report

After analysis, act immediately. Do not ask for approval — just do it and report what you did.

Rules:
- Notes that belong to multiple clusters go to their **primary** cluster (the topic most central to the note). Do not duplicate files.
- Only create a folder when a cluster has **3+ notes**. Below that, notes stay in the vault root.
- **Only pause for confirmation if:** deleting notes, merging notes in a way that loses content, or moving 10+ files in a single operation. Everything else: execute.

Steps:

1. **Create cluster directories**: `vault/<cluster-name>/`
2. **Move note files** into their cluster directories. Use terminal `mv` commands — never copy-and-delete.
3. **Create subdirectory index**: each cluster folder gets an `index.json` with entries for the notes it contains, following the same schema as knowledge-base.json.
4. **Update `vault/knowledge-base.json`**: change `filename` for every moved note to include the relative path (e.g., `ai-agents/2026-04-20-trip-planning-agent-self-grow.md`).
5. **Update `vault/topics.json`**: update all filename references to include the new paths.
6. **Update connections**: if notes within a cluster aren't already connected, add bidirectional `connections` entries in both the index and the note files.
7. **Update note Connections sections**: if any moved note references other notes by filename in its markdown body, update those references too.
8. **Verify**: after all moves, read back knowledge-base.json and confirm every `filename` points to an existing file. Report any broken references.
9. **Report**: show Yash what was done — what moved where, connections added, issues found. This is a summary after the fact, not a proposal.

## 3. Incremental re-clustering

This isn't one-and-done. As new notes arrive:
- When a new note is added and it fits an existing cluster, move it there and report.
- When a cluster grows large (10+ notes), split into sub-clusters and report.
- When Yash asks to "review vault" or "improve notes", run the full analysis phase again and act.

## 4. Note quality improvement

During reorganization, also fix:
- **Thin notes**: few key ideas, no "Why This Matters", no connections. Re-run extraction and enrichment.
- **Missing connections**: notes in the same cluster that don't reference each other. Add them.
- **Stale deferred items**: `"deferred": true` entries queued for a long time. Process them through the full pipeline and report what was enriched.
- **Topic sprawl**: too many one-note topics that could be merged into a broader topic. Merge them.
- Never auto-delete notes. Merges that preserve all content are fine — merges that lose content need confirmation.
