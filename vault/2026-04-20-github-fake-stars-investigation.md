    # GitHub Fake Stars Investigation

## Summary
A comprehensive investigation into the ecosystem of fake GitHub stars — from a peer-reviewed CMU study finding 6 million fake stars across 18,617 repos, to the marketplaces selling them for $0.03–$0.85 each, to the VC pipeline that converts star counts into funding decisions. The article includes original analysis sampling stargazer profiles across 20 projects, revealing manipulation fingerprints like high ghost-account rates and abnormally low fork-to-star ratios.

## Key Ideas
- **Scale**: CMU's StarScout tool found ~6 million fake stars from ~301,000 accounts across 18,617 repos (2019–2024). By July 2024, 16.66% of repos with 50+ stars were involved in fake star campaigns.
- **Marketplace**: Stars sell for $0.03–$0.85 each on dedicated websites, Fiverr, and Telegram. Premium aged accounts with histories cost more. At least a dozen active vendors exist openly.
- **VC pipeline**: Redpoint Ventures found median star count at seed is 2,850 and at Series A is 4,980. VCs run automated scrapers to find fast-growing repos. For $85–$285, a startup can manufacture seed-level stars — a potential 3,500x–117,000x ROI against typical seed rounds.
- **Detection heuristics**: Fork-to-star ratio is the strongest simple signal. Organic projects average ~0.16; manipulated repos drop to 0.02–0.05. Watcher-to-star ratio is even more telling.
- **AI repos are the largest non-malicious category** of fake-star recipients at 177,000 fake stars.
- **Legal risk**: FTC's 2024 rule banning fake social influence metrics carries $53,088 per violation. SEC has charged founders for inflating traction metrics during fundraising.

## Insights & Claims
- The fake star economy is mature and professionalized — not a dark-web phenomenon
- 90.42% of flagged repos were deleted by GitHub, confirming illegitimacy, but 57% of the accounts that delivered stars remain intact
- 78 repos with fake star campaigns appeared on GitHub Trending, proving the gaming works
- Union Labs was ranked #1 on Runa Capital's ROSS Index with 47.4% suspected fake stars — an influential VC report was topped by a manipulated project
- The incentive loop is self-reinforcing: VCs track stars → startups buy stars → VCs see inflated traction → more VCs adopt star-tracking
- npm downloads and VS Code marketplace installs are similarly inflatable

## Detection Fingerprints
| Signal | Organic | Manipulated |
|---|---|---|
| Fork-to-star ratio | ~0.16 | 0.02–0.05 |
| Zero-follower stargazers | 5–12% | 50–81% |
| Ghost accounts | ~1% | 19–36% |
| Median account age | 3,000–4,800 days | 484–1,180 days |

## Actionable Takeaways
- Never trust raw GitHub star counts as a proxy for adoption or quality
- Use fork-to-star ratio (<0.05 with 10K+ stars = red flag) and watcher-to-star ratio as first-pass filters
- Look at contributor activity (Bessemer's approach) over vanity metrics
- For evaluating open-source tools: check actual dependent projects, contributor diversity, and issue activity
- The legal landscape is tightening — FTC and SEC frameworks now cover this behavior

## Notable Cases
- **FreeDomain**: 157K stars, 168 watchers, 81.3% zero-follower stargazers
- **Union Labs**: #1 on ROSS Index, 47.4% suspected fake stars
- **openai-fm**: 66% suspicious accounts, median account age 116 days (likely third-party bots, not OpenAI)
- **Lovable** (GPT Engineer): 50K+ stars → $1.8B valuation
- **Browser-use**: 50K stars in 3 months → $17M seed

## Applications
- Due diligence on open-source projects and developer tools
- Evaluating startup traction claims during investment decisions
- Understanding social proof manipulation in developer ecosystems
- Building better metrics for open-source health

## Connections
- [[2026-04-20-rogue-socket-github-profile.md]] — Yash's GitHub portfolio lives in this ecosystem; fake stars affect discoverability and credibility of real projects

## Source
https://awesomeagents.ai/news/github-fake-stars-investigation/

## Tags
#github #fake-stars #open-source #developer-tools #vc-funding #astroturfing #metrics-manipulation
