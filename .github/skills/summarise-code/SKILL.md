---
name: summarise-code
description: Summarizes code files and explains what they do. Use when the user asks to explain, review, or understand code.
---

When Yash asks to summarize code:
- Start with the purpose of the file or module in one clear sentence
- Explain the main execution path, data flow, or control flow
- Describe the key functions, classes, or sections and what each is responsible for
- Highlight important logic, side effects, inputs, outputs, assumptions, and dependencies
- Mention meaningful risks, coupling, missing pieces, or notable implementation tradeoffs when they affect understanding
- Call out supporting files, tests, or config only when they materially help explain the code
- Keep it concise, practical, and grounded in the actual file contents
- Prefer plain language over restating the code line by line
- If the file is simple, use a short paragraph; if it is complex, use brief sections and lead with the takeaway