---
name: finance-manager
description: Track personal finances from chat using a JSON database and summarize by day, week, month, and year
---

When the user asks to track or review money, use this process

1. Data source
- Use finance/finance-data.json as the source of truth
- Keep keys stable so future edits remain compatible with the dashboard
- Preserve existing records unless the user explicitly asks to delete or rewrite

2. What to track
- expenses in expenses[]
- income in income[]
- subscriptions in subscriptions[]
- budget targets in budgets[]
- long term investments in investments, including ppf

3. Record formats
- expense record: id, date (YYYY-MM-DD), category, amount, currency, note, paymentMethod
- income record: id, date (YYYY-MM-DD), source, amount, currency, note
- subscription record: id, name, amount, currency, frequency (monthly|yearly), startDate, renewalMonthDay, active
- ppf structure:
  - accountName
  - annualDepositTarget
  - interestRatePercent
  - yearlyContributions: [{year, amount, date, note}]

4. Update rules
- When logging a new item, append a new object with a deterministic id:
  - exp-YYYYMMDD-### for expenses
  - inc-YYYYMMDD-### for income
- Do not change date formats
- For PPF yearly checks, determine done status by comparing yearly contribution sum with annualDepositTarget
- Always keep amounts as numbers, not strings

5. Reporting rules
- If user asks for a period report, compute totals for day, week, month, or year
- Include total income, total expenses, net savings, and top categories when possible
- Always provide an analysis of the user's finances, not just raw numbers
- If the dashboard UI exists or is relevant to the request, include the full /dashboard.html localhost link as a companion to the analysis
- For PPF:
  - show contribution total for requested year
  - show done/not done against annualDepositTarget
  - estimate yearly interest as contributionTotal * (interestRatePercent / 100)

6. UI integration
- The HTML dashboard reads this JSON and can store user edits in browser local cache for quick testing
- If the user asks to permanently save dashboard-entered sample entries, sync those entries back into finance/finance-data.json

7. Launch dashboard on invoke
- If the user asks to open or launch the finance UI, run finance/run-dashboard.sh
- Return only the full dashboard URL with no extra text when requested
- Always return a URL ending in /dashboard.html, never a bare localhost root
- Use localhost only (127.0.0.1), never a public or remote URL
