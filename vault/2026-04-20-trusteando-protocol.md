# Trusteando Protocol — Decentralised Verifiable Knowledge Graph

## Summary
An open protocol for expressing verifiable facts as folder structures on web servers you already control. The core insight: a folder is a credential, the hierarchy is the trust chain, and your domain is your identity. No new infrastructure needed — your web server is your node. The entire cryptographic core is four functions and twenty lines of code.

## Key Ideas
- **A folder is a credential**: `university.es/trusteando/professors/juan-ruiz/` is proof the university recognises Juan as a professor
- **Hierarchy = trust chain**: Keys are derived from folder structure — controlling a folder means controlling its key
- **Append-only and cryptographically sealed**: Facts cannot be modified after publication; history is permanent and auditable
- **Zero new infrastructure**: Your domain is your identity, your web server is your node
- **Interoperability by schema**: Any org publishing in the same schema becomes automatically interoperable with any other — the schema is the contract
- Part of the **ConfidenceNode ecosystem** — three protocols tackling information asymmetry, verification, and uncertainty capture

## Protocol Design
- `TrusteandoNode` class with four core functions: `grant_key`, `respond_to_challenge`, `verify_child_authorship`, and `reduce_hash`
- Temporal model with `since/until`
- `private/` access control
- Three conformity states (b9/v9/t9)
- v0.3 additions: credential scoping, distributed vocabulary repos, name discovery, active auth with key rotation, social identity recovery via Shamir's Secret Sharing, ZKP direction

## ConfidenceNode Ecosystem
| Protocol | Role | What It Solves |
|---|---|---|
| ConfidenceNode Protocol | Theoretical framework | Information asymmetry |
| Trusteando Protocol | Verification layer | Who is who, what they're authorised to do |
| ctx | Uncertainty capture | Structured capture of what is not yet known |

## Why It's Interesting
- Radically simple approach — uses existing web infrastructure (domains, folders, servers) instead of blockchain or new networks
- Elegant mapping of real-world trust hierarchies to file system hierarchies
- Could be powerful for credential verification, organisational transparency, and decentralised identity
- GPLv3 — free and irrevocably public

## Applications
- Verifiable credentials without blockchain
- Organisational structure transparency
- Decentralised identity and authorisation
- Academic credential verification
- Cross-organisation interoperability

## Connections
- [[2026-04-20-rogue-socket-github-profile.md]] — both are GitHub repos of interest; Trusteando's decentralised identity model could complement Yash's agent frameworks

## Source
https://github.com/confidencenode/Trusteando_Protocol

## Tags
#decentralisation #cryptography #identity #credentials #open-protocol #knowledge-graph
