# Finance — Getting Started

**For pilot users · v1.0.0-rc.14 lineage.** Business → Finance. Twenty-one modules; you need four to start.

## 1. Chart of accounts

Open **Ledger Accounts** and create the accounts your business posts to — each has a code (e.g. `1000 Cash`, `4000 Revenue`, `5000 Expenses`), a name, and a class (asset, liability, equity, revenue, expense). Most other Finance modules validate against this register, so it comes first.

## 2. First invoice

Open **Invoices → New Invoice**: customer, line amount, currency, dates. The invoice tracks its own status (draft → issued → partially paid → paid → overdue) and its outstanding balance is derived — never typed.

## 3. Record the payment

Open **Payments → New Payment** referencing the invoice. Guards are real: you cannot overpay an invoice, reuse a transaction reference, or pay a nonexistent invoice. When the payment clears, the invoice's paid amount re-derives automatically. When a bank statement later evidences the payment (Bank Statements → Reconcile → Finalize), the payment is stamped bank-reconciled and becomes immutable.

## 4. Journals and the books

Postings land in **Journal Entries** — payroll accruals, expense claims, depreciation and bill approvals write deterministic, idempotent entries (numbered like `JE-PAYROLL-2026-08`). **Treasury Positions → Refresh** derives your cash + receivables − payables position from the books; **AR Aging** ages open invoices; **Budgets** can govern purchasing (a budget's commitment policy gates purchase-order approval at off/warn/block).

## Good to know

Every figure on the Finance dashboard is derived from live records. Deleted records never count. Backups (Operations → Recovery Center) cover every Finance store.
