# X Post by @zeddotdev: Building the Post-Git Collaborative AI Workspace

## Summary
Zed shares a strategic position: they are not shipping AI features to subsidize token usage or chase hype, but to support a longer-term product vision around collaborative software development. The linked post argues that while LLMs lower the cost of producing code, the harder and more valuable work is now collaboration, review, and maintaining shared understanding.

Conrad Irwin explains that AI-assisted coding is useful when humans stay in the loop for judgment and architecture, and frames Zed's DeltaDB work as infrastructure for a "post-git" workflow where humans and agents operate on a continuously synchronized code model.

## Key Ideas
- AI features should serve durable workflow outcomes, not short-term token economics.
- LLMs are strong at refactors, tests, and edge-case discovery, but human direction remains essential.
- As code generation gets cheaper, collaboration and review overhead become the bottleneck.
- Existing commit/PR-centric collaboration models are increasingly mismatched to agent-speed code output.
- DeltaDB is presented as a character-level sync engine for human+agent collaboration.

## Insights & Claims
- Zed claims it is not an "AI subsidy" business and now prices LLM usage close to provider cost.
- Agent-heavy coding without strong human review produced brittle code in early experiments.
- The author claims modern developers should treat LLMs as sparring partners, not substitutes for understanding.
- The long-term bet is that software tools must evolve from "code writing tools" to "collaborative problem-solving tools."

## Actionable Takeaways
- Use AI coding agents for constrained tasks (refactors, tests, edge cases), while preserving human architectural control.
- Re-evaluate your review workflow if generated code volume is rising faster than review throughput.
- Invest in collaboration primitives (shared context, live code discussions, tighter sync) rather than only generation speed.

## Notable Quotes
> We're building the thing that comes after git.

> When code production gets cheaper, everything around it gets proportionally more expensive.

## Why This Matters
- This is a practical framing for the next productivity ceiling: not "more generated code," but better shared understanding around rapidly changing codebases.
- It connects AI tooling choices directly to team design and delivery economics.

## Applications
- Team-level AI coding policy design (what to delegate vs what to review manually)
- Engineering workflow redesign for high-volume generated code
- Evaluating editor/platform roadmaps for collaborative agent-native development

## Connections
- [[ai-agents/2026-04-20-ai-orchestration-tools-landscape.md]]
- [[ai-agents/2026-05-05-anthropic-boris-cherny-why-coding-solved-what-comes-next.md]]
- [[2026-05-05-x-post-vmlops-paperdraw-system-design-tool.md]]

## Questions
- What is the right review abstraction when agents can output large, fast code deltas continuously?
- Which collaboration metrics should replace commit/PR volume as quality signals?
- How should teams version intent, rationale, and decision context alongside AI-generated changes?

## Source
https://x.com/i/status/2051754884295205031

## Tags
#x-posts #developer-tools #software-engineering #agentic-coding #zed
