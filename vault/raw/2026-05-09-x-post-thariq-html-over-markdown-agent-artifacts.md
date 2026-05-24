# Raw Capture: X Post by @trq212

Source: https://x.com/i/status/2052809885763747935

Markdown has become the dominant file format used by agents to communicate with us. It’s simple, portable, has some rich text capability and is easy for you to edit. Claude has even gotten surprisingly good at using ASCII to make diagrams inside of markdown files.

But as agents have become more and more powerful, I have felt that markdown has become a restricting format. I find it difficult to read a markdown file of more than a hundred lines. I want richer visualizations, color and diagrams and I want to be able to share them easily.

I'm also increasingly not editing these files myself, but using them as specs, reference files, brainstorming outputs, etc. When I do make edits, I’m usually prompting Claude to edit them, which removes one of markdown’s largest benefits.

I’ve started preferring HTML as an output format instead of Markdown and increasingly see this being used by others on the Claude Code team.

Why HTML?

Information Density:
- Tabular data using tables
- Design data with CSS
- Illustrations with SVG
- Code snippets with script tags
- Interactions using HTML + JavaScript + CSS
- Workflows using SVG and HTML
- Spatial data using absolute positions and canvases
- Images using image tags

Visual Clarity & Ease of Reading:
As Claude writes larger specs and plans, long markdown is hard to read and hard to get others to read. HTML can organize content with tabs, illustrations, links, and responsive layouts.

Ease of Sharing:
Markdown often requires attachments or renderers. HTML can be uploaded and shared as a link, increasing the chance teammates actually read it.

Two-way Interaction:
HTML artifacts can include sliders, knobs, controls, and copy-back actions so the document is not static.

Data Ingestion:
Claude Code can ingest rich context from filesystem, MCPs, browser context, and git history, and package output into digestible HTML artifacts.

Use Cases highlighted:
1. Specs, Planning & Exploration
2. Code Review & Understanding
3. Design & Prototypes
4. Reports, Research & Learning
5. Custom Editing Interfaces

Frequently discussed tradeoffs:
- HTML may use more tokens than markdown
- HTML generation can be 2-4x slower
- HTML diffs are noisier in version control

Core thesis:
The richer, more readable, more shareable format keeps humans in the loop better as agent outputs become larger and more complex.
