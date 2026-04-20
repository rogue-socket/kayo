---
name: finance-manager
description: Track personal finances from chat using a JSON database and summarize by day, week, month, and year
---

When the user asks to track or review money, use this process

1. Data source
- Use finance/finance-data.json as the source of truth
- Browser local storage is scratch state for the dashboard UI; durable repo-side updates must land in finance/finance-data.json
- Keep keys stable so future edits remain compatible with the dashboard
- Preserve existing records unless the user explicitly asks to delete or rewrite

2. What to track
- expenses in expenses[]
- income in income[]
- subscriptions in subscriptions[]
- budget targets in budgets[]
- long term investments in investments, including ppf
- subscriptions should be first-class records the user can add, review, and update

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
  - sub-### for subscriptions
- Do not change date formats
- For PPF yearly checks, determine done status by comparing yearly contribution sum with annualDepositTarget
- Always keep amounts as numbers, not strings

5. Reporting rules
- If user asks for a period report, compute totals for day, week, month, or year
- Include total income, total expenses, net savings, and top categories when possible
- Always provide an analysis of the user's finances, not just raw numbers
- If the user asks for analysis or a period report, give the analysis first and include the full /dashboard.html localhost link only as a companion when it is useful
- For PPF:
  - show contribution total for requested year
  - show done/not done against annualDepositTarget
  - estimate yearly interest as contributionTotal * (interestRatePercent / 100)

6. UI integration
- The HTML dashboard reads this JSON and can store user edits in browser local cache for quick testing
- The dashboard should let the user switch between expenses and subscriptions as separate tabs in the spending area
- The dashboard should provide clear separate forms to add expenses, income, and subscriptions
- The dashboard should also allow adding new subscriptions from the UI
- Common settings should be easily configurable in the UI (default currency, common categories/sources/payment methods)
- If the user asks to permanently save dashboard-entered sample entries, sync those entries back into finance/finance-data.json

7. Launch dashboard on invoke
- Prefer finance/run-dashboard.sh when the current shell can execute it
- If the current platform cannot run that script directly, start an equivalent local static server from finance/ and return the same dashboard URL
- When the user explicitly asks to open or launch the finance UI, return only the full dashboard URL with no extra text
- Always return a URL ending in /dashboard.html, never a bare localhost root
- Use localhost only (127.0.0.1), never a public or remote URL
