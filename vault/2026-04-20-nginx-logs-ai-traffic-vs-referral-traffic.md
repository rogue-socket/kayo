# What nginx logs prove about AI traffic vs referral traffic

## Summary
An experiment using nginx access logs shows that "AI traffic" is not one metric but two distinct signals: provider-side fetches (the model system retrieving pages) and real clickthrough visits (humans clicking citations). The author captured clear retrieval patterns for ChatGPT, Claude, and Perplexity, and contrasted that with Google/Gemini where attribution is structurally limited by crawler design.

The post argues that accurate analytics products must separate retrieval, search indexing, training, and human referral layers instead of collapsing everything into one AI bucket. The central takeaway is that careful wording and strict taxonomy are required to avoid misleading dashboards, especially for Google-origin traffic where HTTP logs alone cannot isolate AI Mode from classic Search.

## Key Ideas
- AI-origin traffic has two different behaviors: provider retrieval requests vs human referral clicks.
- ChatGPT, Claude, and Perplexity can emit dedicated retrieval user-agent signals in server logs.
- Google/Gemini does not expose an equivalent dedicated retrieval token; AI answers are grounded via Search index behavior.
- Search-indexing bots and training bots are separate classes and should not be counted as live retrieval events.
- Measurement quality depends on preserving distinctions, not maximizing one blended metric.

## Insights & Claims
- ChatGPT retrieval showed bursty, multi-IP origin fetches with `ChatGPT-User/1.0` and no referrer.
- Claude retrieval showed `robots.txt` precheck behavior and normal redirect handling with `Claude-User/1.0`.
- Perplexity can perform direct origin retrieval with `Perplexity-User/1.0`, but not every response should be assumed to do so.
- Google/Gemini absence of a distinct retrieval token means "no observed fetch" is not proof of no fetch.
- Mislabeling bot classes creates believable trend charts but unreliable row-level truth.

## Actionable Takeaways
- Track provider retrieval and human referral as separate metrics in analytics and reporting.
- Build parser rules around documented retrieval user-agents; keep search-indexing and training in separate buckets.
- Treat Google-origin attribution as constrained: report what HTTP can prove, not what it cannot.
- Use explicit metric definitions in UI copy to avoid trust loss from overclaiming.
- Audit existing "AI traffic" dashboards for mixed-class contamination.

## Notable Quotes
> Collapsing these into one AI-traffic number papers over the most useful distinction in the data.

> Careful wording is boring and it is the only wording that survives a smart customer checking one row.

## Why This Matters
- If you build products around AI visibility or SEO analytics, attribution precision is core to user trust.
- This framework prevents false confidence by separating observable signals from structural unknowns.

## Applications
- Designing analytics pipelines for LLM referral attribution.
- Building bot-taxonomy-aware dashboards for content teams.
- Writing safer product claims around AI traffic and discoverability.
- Debugging mismatches between referral reports and server logs.

## Connections
- [[2026-04-20-github-fake-stars-investigation.md]] — both notes focus on metric integrity and how bad measurement incentives distort decisions.

## Questions
- How should attribution confidence be represented when only partial observability exists (especially for Google/Gemini)?
- What default bot taxonomy should a product ship with, and how should it evolve as vendors change behavior?
- Can retrieval and referral timelines be joined to estimate citation-to-click conversion quality per model?

## Source
https://surfacedby.com/blog/nginx-logs-ai-traffic-vs-referral-traffic

## Tags
#ai-crawlers #web-analytics #llm-traffic #referral-traffic #metrics-manipulation
