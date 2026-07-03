# Billing & Licensing

Plans, usage-based billing, seats, licensing, and the marketplace purchase
ledger. The money math is pure and deterministic; nothing charges a card.

## Plans (`billing/billing.ts`)

| Tier       | Price/mo | Included req/mo | Rate/min | Overage/1k | Seats | Mkt. fee |
|------------|----------|-----------------|----------|------------|-------|----------|
| Free       | $0       | 1,000           | 60       | —          | 1     | 30%      |
| Pro        | $49      | 100,000         | 600      | $0.50      | 5     | 20%      |
| Enterprise | $499     | 2,000,000       | 6,000    | $0.25      | ∞     | 15%      |

A plan defines its gateway **rate limit** and **quota**, so switching a plan
re-tiers the gateway immediately, and its **marketplace fee** percentage, applied
to purchases.

## Usage-based billing

`computeInvoice(plan, periodRequests, purchases, period)` produces an invoice:
the base subscription line, a usage **overage** line when the period's metered
requests exceed the plan's included amount (`ceil(overage / 1000) ×
overagePer1k`), and a line per marketplace purchase in the period. The portal's
"This period" summary shows included-vs-metered usage, overage, marketplace
spend, and an estimated cost; "Preview invoice" renders the computed lines.

## Seats & licensing (`billing/billingStore.ts`)

- A single **subscription** per organization, seeded Free with the owner holding
  one seat.
- **Seats** are assigned to users up to the plan's seat count (Free = 1, so the
  second assignment is rejected until the plan is upgraded) and can be released.
- **Licenses** are issued per listing as `organization` or `seat` licenses.
- A marketplace **purchase** records the amount, the platform `feeAmount`
  (`amount × plan fee`), and issues an organization license for the listing.

## IPC

`ipc.ecosystem.billingSummary | plans | setBillingPlan | invoice | seats |
assignSeat | releaseSeat | licenses | purchase | purchases`. Setting the plan via
either the developer or billing channel keeps the developer account and the
subscription consistent.

## What is real, and what is not

The catalog, invoice computation, summary, seat enforcement, license ledger, and
purchase ledger are all real and tested. There is **no payment processor** — a
purchase records the ledger entry and issues the license, but no charge is made.
