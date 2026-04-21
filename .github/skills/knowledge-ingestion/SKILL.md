---
name: knowledge-ingestion
description: Ingest content from URLs, text, and files into a structured personal knowledge vault. Extracts, enriches, stores, indexes, and retrieves knowledge.
---

When the user shares a URL, article, tweet, video link, PDF, or raw thought to ingest, use this pipeline.
When the user asks about vault content, use the retrieval section at the end of this file.

## 1. Pipeline overview

The ingestion pipeline has 6 stages:

**Input → Normalize → Extract → Enrich → Store → Index**

- Full pipeline (`#ingest`, `#analyze`, or default): all 6 stages.
- Lightweight capture (`#save`, `#later`, `#watch-later`, `#read-later`): Input → Normalize → Store → Index (skip Extract and Enrich, mark `"deferred": true`).

Retrieval is a separate operation, not a pipeline stage — see section 8.

## 2. Input capture

Supported sources:
- Twitter/X links (tweets, threads)
- Articles and blog posts
- YouTube videos
- PDFs (user pastes text or provides path)
- Raw thoughts and notes from the user
- **Anything else**: the system must handle content that doesn't fit any known type. If the source is unrecognized or the format is unexpected, classify it as `other`, store what you can, and never crash or refuse. Log a note in the entry that the type was unrecognized so it can be reclassified later.

### Triggers

Explicit phrases: "ingest", "save this", "remember this", "add to vault", "capture this", or the user shares a URL/text and asks to store it.

### Ambient capture (triggered by copilot-instructions.md)
This skill can also be invoked automatically by the repo-level vault capture rules — not just by explicit trigger phrases. When the agent detects vault-worthy content during normal conversation (a shared URL with opinion, a personal insight, an idea), it will run this pipeline. The confidence thresholds and ask-vs-auto rules live in `copilot-instructions.md` under "Vault Capture (always-on)". This skill just handles the processing once triggered.

### Intent tags
Yash may use explicit tags to control pipeline depth:
- `#ingest` — full pipeline (extract, enrich, store)
- `#save` or `#later` — lightweight capture, skip deep analysis, file for later review
- `#analyze` — full extraction + enrichment, prioritize depth
- `#watch-later` or `#read-later` — store metadata and source only, queue for future processing
- If no tag is given, infer intent from context. When ambiguous, default to full pipeline.

Note: `#vault` is a retrieval tag, not an ingestion tag — see section 8.

Capture must feel frictionless. Accept whatever the user gives, ask only if the source is truly ambiguous.

### Graceful failure for unknown content
- If content arrives in a format or from a source not handled above, do NOT error out or refuse.
- Store whatever metadata and raw text is available, set `type` to `other`, and mark `"classification": "unrecognized"`.
- Mention to Yash that the type was unrecognized so he's aware, but still complete the capture. Only ask about defining a new type if that would materially improve future captures.
- The system should always prefer partial capture over no capture.

## 3. Normalization

### Type classification guide

Use these rules to assign `type`. Check in order — first match wins:

| Source / Signal | Type |
|---|---|
| URL contains `twitter.com` or `x.com` with a single status ID | `tweet` |
| URL contains `twitter.com` or `x.com` with multiple linked statuses, or user says "thread" | `thread` |
| URL contains `youtube.com` or `youtu.be` | `video` |
| URL points to a `.pdf` file, or user says "PDF" | `pdf` |
| URL points to a blog, news site, or long-form page | `article` |
| No URL — user types a thought, idea, or freeform text | `note` |
| Content from a message, chat export, email, or app not listed above | `other` |

When in doubt, prefer `article` for web pages and `other` for truly unrecognized formats. Never refuse to classify — always pick the closest type.

### Internal schema

Convert every input into this internal schema before processing:

```json
{
  "source": "url or 'user-note'",
  "type": "tweet | thread | article | video | note | pdf | other",
  "raw_content": "full text or transcript",
  "metadata": {
    "author": "",
    "created_at": "",
    "captured_at": "YYYY-MM-DD",
    "tags": []
  }
}
```

- For URLs: fetch the page content using the fetch_webpage tool
- For YouTube:
  - If Yash wants analysis (`#analyze` or full pipeline): fetch transcript if available, otherwise summarize from title + description, then run full extraction
  - If Yash wants to watch later (`#watch-later`, `#later`, `#save`): store title, URL, channel, and thumbnail only — skip transcript fetch and deep analysis. Mark `"deferred": true` in the index entry so it can be processed later on request.
- For tweets/threads: reconstruct into a coherent narrative
- For user notes: use the raw text as-is
- For unrecognized formats: extract whatever text/metadata is accessible, set type to `other`
- If content cannot be fetched, store what is available and mark `"fetch_status": "partial"`

## 4. Extraction

Process the normalized content and extract:

- **Summary**: 2-3 sentence short summary + longer detailed summary
- **Key ideas**: bullet list of core concepts
- **Claims / insights**: specific assertions the author makes
- **Actionable takeaways**: things Yash can do with this
- **Notable quotes**: important verbatim quotes (if any)

For threads → weave into a single coherent narrative first, then extract.
For videos → work from transcript/description, structure into notes.

## 5. Enrichment

This turns raw extraction into personal knowledge:

- **Topic detection** (dynamic clustering):
  - Do NOT use a fixed list of topics. Topics emerge organically from the content.
  - Before assigning topics, scan existing entries in knowledge-base.json to find established topic names.
  - Reuse an existing topic when the content clearly fits. Only mint a new topic when nothing existing covers the concept.
  - Assign 1-3 topics per note. Keep topic names short (1-3 words), lowercase, hyphenated (e.g., `ai-agents`, `systems-design`, `personal-finance`).
  - Over time this builds a living topic graph. When topics grow large (10+ notes), split or sub-cluster them during re-processing and report what changed.
  - Maintain a `vault/topics.json` index mapping each topic to its note filenames for fast lookup.
- **Why this matters**: 1-2 sentences on why Yash should care
- **Where I can use this**: practical applications
- **Connections**: link to existing notes in the vault if related topics exist (check knowledge-base.json for matches)
- **Generated questions**: 1-3 questions this content raises

## 6. Storage

### Vault location
- All processed notes go in `vault/` at the repo root
- Filename format: `YYYY-MM-DD-<slugified-title>.md`
- No spaces in filenames; use hyphens

### Markdown note format

Every note must follow this template:

```md
# <Title>

## Summary
<short summary>

<detailed summary>

## Key Ideas
- ...

## Insights & Claims
- ...

## Actionable Takeaways
- ...

## Notable Quotes
> ...

## Why This Matters
- ...

## Applications
- ...

## Connections
- [[related-note-filename]]

## Questions
- ...

## Source
<url or "personal note">

## Tags
#topic1 #topic2
```

Omit any section that has no content (e.g., no quotes for a personal note). Never leave a section empty.

### Raw content backup
- If the raw content is long (>500 words), also save it to `vault/raw/<same-filename>.md` for reference
- Short content can live inline in the processed note under a collapsed `<details>` block

## 7. Indexing

Maintain `vault/knowledge-base.json` as the root structural index.

```json
{
  "entries": [
    {
      "id": "kb-YYYYMMDD-###",
      "title": "",
      "filename": "",
      "source": "",
      "type": "tweet | thread | article | video | note | pdf | other",
      "topics": [],
      "tags": [],
      "connections": [],
      "captured_at": "YYYY-MM-DD",
      "summary_short": "",
      "deferred": false
    }
  ]
}
```

### Subdirectory indexes
- When a topic accumulates 10+ notes, it may get its own subdirectory: `vault/<topic>/`
- Each subdirectory can have its own `index.json` following the same entry schema but scoped to that topic
- The root `knowledge-base.json` remains the master index and must always contain every entry regardless of subdirectory
- Subdirectory indexes are optional conveniences for faster scoped lookups — the system must work correctly with or without them
- When moving a note into a subdirectory, update its `filename` in the root index to include the relative path (e.g., `ai-agents/2026-04-20-some-note.md`)

### Topic index
- Maintain `vault/topics.json` as a topic-to-notes mapping:
```json
{
  "ai-agents": ["2026-04-20-some-note.md"],
  "systems-design": ["2026-04-19-another-note.md"]
}
```
- Update this index every time a note is added, updated, or reclassified

Rules:
- Append new entries; never overwrite existing ones unless the user asks to update
- IDs are deterministic: `kb-YYYYMMDD-###` where ### is a zero-padded sequence for that day
- Keep `summary_short` under 150 characters
- `connections` stores filenames of related notes (bidirectional: update the connected note's entry too)
- After adding a new entry, scan existing entries for topic overlap and add connections directly, then mention the important ones in the response
- For `#watch-later` / `#save` items, set `"deferred": true` — these are queued for full processing later

## 8. Retrieval

Retrieval is a separate operation from ingestion. It is governed by two layers:

### Vault awareness and `#vault` tag (source of truth: copilot-instructions.md)
The ambient vault scan (checking the index on every knowledge question) and the `#vault` hard-signal tag are defined in `copilot-instructions.md` under "Vault Awareness (always-on)". That file is the single source of truth for:
- When to check the vault
- How to access it (read index → match → read note — never grep)
- How to surface results

Do NOT duplicate those rules here. If behavior needs to change, change it in copilot-instructions.md.

### Query
"What have I learned about X?" or "Find notes on X"
- Read `vault/knowledge-base.json`, match against topics, tags, title, and summary_short
- Return a ranked list of relevant notes with their short summaries
- Read and synthesize from the top matches if the user wants depth

### Synthesis
"Merge my notes on X" or "What's the big picture on X?"
- Read all related notes
- Produce a new synthesis note combining insights, resolving contradictions, and surfacing patterns
- Store the synthesis as a new vault note with type `synthesis`

### Context injection
When Yash is working on something and asks "What do I know about X?", pull relevant vault knowledge into the conversation without creating a new note.

### Stats
"How many notes do I have?" or "Show vault stats"
- Count entries by type, topic, and month
- Show recent additions

## 9. Vault reorganization

Vault restructuring, clustering, and note quality improvement are handled by a separate skill file:
[VAULT-REORGANIZER.md](.github/skills/knowledge-ingestion/VAULT-REORGANIZER.md)

That file is only loaded when Yash asks to reorganize, cluster, or review vault structure. Do not load it during normal ingestion or retrieval.

## 10. Failure modes to avoid

- Never dump raw content without extraction and enrichment
- Don't over-tag: max 5 tags per note
- Always attempt connections to existing notes
- Don't create notes without updating knowledge-base.json
- If fetch fails, tell the user and store what you can with a "partial" marker
