# Subscription Scan

## When To Use

Use this skill when the user asks to find subscriptions, recurring payments,
trials, renewals, invoices, receipts, or monthly spending hidden in email.

## Workflow

1. Search for billing, invoice, receipt, renewal, subscription, trial, and payment
   terms across the requested time range.
2. Extract service name, amount, currency, billing period, date, plan, category,
   and cancellation or account-management links when present.
3. Deduplicate by service and keep the most recent reliable billing evidence.
4. Estimate monthly and annual totals only from evidence-backed amounts.
5. Flag free trials, price changes, failed payments, and unclear billing periods.

## Evidence

- Keep the source email id for every extracted charge.
- Mark inferred monthly equivalents separately from original amounts.
- Do not treat marketing copy as a charge without receipt or billing evidence.

## Stop Conditions

- Ask the user before visiting external cancellation links.
- Mark the item uncertain if amount, period, or service identity cannot be proven.

## Output

Return a table of subscriptions, totals by month and year, uncertain items, and
recommended follow-up actions.
