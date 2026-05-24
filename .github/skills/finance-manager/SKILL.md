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
- meta.config (durable, written by the dashboard):
  - expenseCategories: string[]
  - incomeSources: string[]
  - paymentMethods: string[]
  - Treat as the canonical lists for dropdowns. Preserve and extend rather than overwriting.

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

8. Receipt images (capture from Telegram)
- When Yash sends a photo of a receipt, bill, payment confirmation, or order summary, treat it as a request to log an expense — even without explicit instructions. The image arrives via `--attachment`, so you can see it directly.
- Extract these fields from the image:
  - **date** (YYYY-MM-DD) — prefer the printed date on the receipt; fall back to today in IST if unreadable
  - **amount** (number) — the final total Yash paid (after discounts, taxes, tip)
  - **currency** — default `INR` unless the receipt's currency symbol clearly says otherwise (₹/Rs/INR → INR, $/USD → USD, €/EUR → EUR, £/GBP → GBP)
  - **merchant / source** — name printed at the top (e.g. "Blue Tokai", "Zepto", "Indian Oil", "Uber", "Amazon")
  - **category** — infer from merchant + items. Reuse an existing value from `meta.config.expenseCategories`; only invent a new category if none fits, and tell Yash you're adding it.
  - **paymentMethod** — infer if visible ("UPI", "Card", "Cash"). Use an existing value from `meta.config.paymentMethods` when possible; otherwise leave blank and ask Yash.
  - **note** — one short line (≤60 chars) summarising what was purchased, useful for later review.
- ID format: `exp-YYYYMMDD-###` per existing rules.
- Confirmation pattern: log the expense optimistically (YOLO), then reply with a one-line summary like:
  `Logged ₹248 at Blue Tokai on 2026-05-24 → Cafe & dining (UPI). Reply "undo last" to remove.`
- Handle "undo last": find the most recent expense by `id` ordering and remove it from `expenses[]`. Confirm what was removed.
- If extraction is genuinely ambiguous (blurry receipt, can't read the total, conflicting amounts), ask **one** clarifying question instead of guessing — never invent a number.
- Multiple line items: if the receipt is itemised but you only need one expense entry, sum to the total and put the itemisation in `note` (truncated to 60 chars).
- Non-receipt images: if the photo isn't a financial document (landscape, screenshot of an article, whiteboard), defer to other skills (knowledge-ingestion for articles/screenshots) — don't force-fit it into expenses.

9. Other financial documents
- Order confirmations (Amazon, Flipkart, Swiggy, Zepto, Blinkit): same flow as receipts. Order total → expense entry. Merchant is the platform; category is best-fit (groceries, food, household, etc.).
- Salary slips / income statements: treat as `income[]` entries, not expenses. Extract source (employer), amount, date.
- Bank statements / multi-transaction PDFs: do **not** auto-bulk-import. Acknowledge it, summarise the totals, and ask Yash which entries to actually log. Bulk-importing without consent leads to duplicates with manually-logged entries.
