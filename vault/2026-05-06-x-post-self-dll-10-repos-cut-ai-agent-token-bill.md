# X Post by @seelffff: 10 Repos to Cut AI Agent Token Costs

## Summary
This post compiles 10 open-source repos that reduce agent-token spend by shrinking prompts, routing to cheaper models, narrowing retrieval context, and enforcing token budgets before calls are sent.

The core idea is that high AI-agent cost usually comes from oversized context payloads rather than model pricing alone. The thread recommends combining compression (LLMLingua), selective memory (mem0, Letta), model routing (LiteLLM), retrieval filtering (LlamaIndex, Chroma), constrained generation (Guidance), scoped code context (Aider), and preflight token accounting (tiktoken, ttok) to systematically reduce waste.

## Key Ideas
- Prompt compression can slash payload size without major quality loss.
- Memory and retrieval should be selective, not full-history/full-document dumps.
- Model routing by task complexity cuts cost while preserving quality where needed.
- Structured output constraints reduce verbose, unnecessary generations.
- Token counting and hard caps should be enforced before API calls.

## Insights & Claims
- The post claims some setups can reduce agent token bills by up to ~80%.
- It frames token inefficiency as an orchestration and context-engineering problem.
- It suggests many teams overspend because they do not inspect what is sent to models.

## Actionable Takeaways
- Add a pre-send token budget gate (`tiktoken`/`ttok`) in your agent pipeline.
- Route calls by complexity via LiteLLM instead of defaulting to one expensive model.
- Replace full-history prompts with memory retrieval (mem0/Letta).
- Use RAG chunk retrieval (LlamaIndex/Chroma) rather than sending full docs.
- Constrain outputs with Guidance to reduce response bloat.

## Notable Quotes
> most agents are expensive not because the model is expensive. because nobody checked what was being sent to it.

## Why This Matters
- It gives a practical cost-control stack for agent systems without reducing throughput.
- It reinforces that strong context engineering is now as important as model choice.

## Applications
- Agent architecture reviews focused on cost/performance tradeoffs
- Production token governance and budget enforcement
- Building leaner autonomous workflows with scoped context windows

## Connections
- [[ai-agents/2026-04-20-ai-orchestration-tools-landscape.md]]
- [[ai-agents/2026-05-05-anthropic-boris-cherny-why-coding-solved-what-comes-next.md]]
- [[2026-05-06-x-post-zed-post-git-collaborative-ai-workspace.md]]

## Questions
- Which combination of compression, memory, and routing gives the best quality-per-token for your current workloads?
- Where in your stack should token budgets fail fast versus degrade gracefully?
- How do you measure quality drift when aggressively compressing prompts?

## Source
https://x.com/i/status/2051650051428983234

## Tags
#x-posts #developer-tools #ai-agents #token-efficiency #llm-ops
