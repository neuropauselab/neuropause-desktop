# DECISION MEMO — S75 · Project cost & revenue → General Ledger (UNDEFINED, STOPPED)

**Status:** STOPPED — awaiting operator accounting policy. Nothing invented. This memo blocks ONLY the project-cost/revenue GL behaviors below; the entire operational Projects workflow (portfolio → tasks → time → billing → draft invoice → closure) is GREEN and unaffected.

## What is defined and working (NOT blocked)

- **Billing run → REAL draft customer invoice.** The billing run aggregates unbilled billable time (person × rate), creates a real draft invoice through the **existing Finance invoice module**, stamps every gathered time entry `invoicedBy` (frozen/immutable), and closes the run (`invoiced`). One invoice per run; a re-issue is refused. Measured live in `projectBilling.test.ts` and the S75 journey pin.
- **The draft invoice walks the certified chain.** GL/AR posting for that invoice is the already-certified **customer-invoice issue → GL → payment chain (S28/S29)**, which lives in Finance — not in Projects. Projects hands off a draft; it does not post GL itself.
- **Billing rate is a defined field** on the time entry (`hourlyRate`), not an invented labor-cost methodology.

## What is UNDEFINED (the STOP) — and is NOT currently attempted by the code

The Projects domain does **not** implement any of the following, and each requires operator policy; none may be invented:

1. **Project cost → GL.** There is no posting of project cost (labor, expense, material) to a GL cost/WIP account. No project-cost GL account is defined.
2. **Revenue recognition.** Billing issues a draft invoice at time×rate; there is no revenue-recognition policy (percentage-of-completion, milestone, on-invoice, deferred). Undefined.
3. **Project-cost capitalization.** Whether project costs capitalize (e.g. internal-use software / capital projects) vs expense is undefined, including any threshold.
4. **Labor-cost methodology.** The billing `hourlyRate` is a billing rate, not a cost rate; there is no labor **cost** capture or costing method.
5. **Budget-variance / write-off policy.** No budget-variance threshold or project write-off treatment is defined.

## Recommendation

When the operator supplies the project accounting policy (revenue-recognition method, project-cost/WIP GL accounts + capitalization rule + threshold, labor-cost method, budget-variance/write-off treatment), wire it through the **existing** GL seam (the finance journal path) — the same durable, audited, idempotent chain used by O2C/P2P — via a decision memo → implementation gate. Until then, Projects is an operational + billing-integral workflow whose only financial effect is a **draft** invoice handed to the certified Finance chain, and that boundary is stated honestly.

## Inputs needed from the operator

- Revenue-recognition method for project billing.
- Project-cost / WIP GL account(s) and the capitalize-vs-expense rule + threshold.
- Labor-cost methodology (cost rate source), if project cost is to be captured/posted.
- Budget-variance threshold and project write-off treatment.
