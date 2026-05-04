# Raw Capture: Building Agents That Reach Production Systems with MCP

Source: https://claude.com/blog/building-agents-that-reach-production-systems-with-mcp
Captured at: 2026-04-23

Agents are only as useful as the systems they can reach. Teams tend to converge on three approaches for connecting them to external systems—direct API calls, CLIs, and MCP. This post lays out where each fits, why production agents tend to land on MCP, and the patterns for building those integrations effectively.

## Connecting agents to external systems

We generally see three paths for connecting agents to external systems: direct API calls, CLIs, and MCP. Each makes sense somewhere, depending on what you're building. The key distinction is whether there's a common layer between agents and services, and how far that layer reaches.

### Direct API calls

The agent calls your API directly—either by writing code that issues HTTP requests inside a code-execution sandbox, or through a generic function-calling tool. This is where most teams start, and it works fine for one agent talking to one service, or a small number of integrations that don't need to be reused across agent platforms.

The challenges start to hit at scale. With no common layer between agents and services, each agent–service pair becomes a bespoke integration with its own auth handling, tool descriptions, and edge cases—the M×N integration problem.

### Command-line interface (CLI)

The agent runs your command-line tool in a shell. This is fast, lightweight, and leans on pre-existing tooling. It works great for local environments and sandboxed containers—anywhere there's a filesystem and a shell. This provides a common layer, but it's thin.

CLIs hit hard limits reaching mobile, web, or cloud-hosted platforms that don't expose a container, and auth is handled by the CLI's own mechanism—usually a credential file on disk. This is best suited to quick, permissive integrations in local environments.

### Model Context Protocol (MCP)

MCP provides the common layer as a protocol. The agent connects to a server that exposes your system's capabilities, with auth, discovery, and rich semantics standardized. One remote server reaches any compatible client (Claude, ChatGPT, Cursor, VS Code, and more), in any deployment environment.

It requires a little bit more upfront investment. The return is that the integration is portable, and provides the semantics needed for a feature-rich agent integration.

## Production agents run in the cloud

Production agents increasingly run in the cloud, so they can scale and operate continuously. The systems they need to reach are cloud-hosted too: where your data lives, work is tracked, and your infrastructure runs. Often these systems are remote and behind auth, where MCP provides the common layer.

Anthropic cites rapid MCP adoption (SDK downloads and daily user footprint) and points to Claude product surfaces already using MCP. They then share practical patterns for building integrations that hold up in production.

## Building effective MCP servers

- Build remote servers for maximum client and environment reach.
- Group tools around intent instead of mirroring API endpoints one-to-one.
- For very large surfaces (e.g., cloud providers), use thin tool surfaces that allow code orchestration in sandboxed execution.
- Ship rich semantics where useful, including MCP Apps and elicitation modes for user input and OAuth/payment handoffs.
- Lean on standardized auth flows (including CIMD and managed credential handling patterns).

## Making MCP clients more context-efficient

- Tool search enables loading tool definitions on demand instead of upfront.
- Programmatic tool calling processes intermediate tool data in code, returning only final outputs to model context.
- Combined, these patterns cut token load and round-trips in multi-step workflows.

## Pairing MCP servers with skills

MCP provides access to external capabilities; skills provide procedural knowledge for completing work with those capabilities. Anthropic recommends combining both, either by packaging them together in plugins or distributing skills directly alongside MCP servers.

## The compounding layer

The article concludes that mature integrations often include API + CLI + MCP together, but MCP is the cloud-production layer that compounds over time as more clients and protocol extensions adopt the spec.
