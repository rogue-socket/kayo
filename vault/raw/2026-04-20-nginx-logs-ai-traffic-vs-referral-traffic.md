# Raw capture — What nginx logs prove about AI traffic vs referral traffic

Source: https://surfacedby.com/blog/nginx-logs-ai-traffic-vs-referral-traffic
Captured: 2026-04-20

## Excerpted raw content

Last month I wanted a straight answer to a question most AI visibility write-ups dodge: when someone asks ChatGPT, Claude, Perplexity, Gemini, or Google AI Mode about a site I own, does that product actually fetch the page or answer from a prebuilt index?

The approach used nginx access logs with a custom format:

```nginx
log_format ai_probe '$time_iso8601 $remote_addr "$request" $status '
                    '"$http_user_agent" "$http_referer"';
```

Core distinction:
- **Provider-side fetch**: AI provider hits origin directly, often dedicated UA and no referrer.
- **Real clickthrough visit**: human clicks citation link and arrives as a browser session with AI referrer.

Observed patterns:
- **ChatGPT**: `ChatGPT-User/1.0`, no referrer, bursty multi-page fetches and multiple source IPs.
- **Claude**: `Claude-User/1.0`, no referrer, `/robots.txt` precheck, redirects followed.
- **Perplexity**: `Perplexity-User/1.0` direct fetch observed in sampled runs.

Google/Gemini findings:
- Real clickthrough referrals from `gemini.google.com` and `google.com` were captured.
- No dedicated Gemini retrieval user-agent was observed.
- Structural explanation: Google states AI Overviews/AI Mode are grounded from the Search index populated by `Googlebot`.

Practical consequences highlighted in the article:
1. `Googlebot` hits cannot be attributed to Gemini vs classic Search from request data alone.
2. `Google-Extended` does not block `Googlebot`; it controls usage permissions for training/grounding.
3. Not observing a direct Google fetch in a test is not proof that no fetch happened.

Bot taxonomy in the appendix classifies bots as:
- **retrieval** (`ChatGPT-User`, `Claude-User`, `Perplexity-User`, `Meta-ExternalFetcher`)
- **search_indexing** (`OAI-SearchBot`, `Claude-SearchBot`, `PerplexityBot`, `Googlebot`, `Bingbot`)
- **training** (`GPTBot`, `ClaudeBot`, `CCBot`)

The post emphasizes that analytics products should not merge these classes into one "AI traffic" metric.
