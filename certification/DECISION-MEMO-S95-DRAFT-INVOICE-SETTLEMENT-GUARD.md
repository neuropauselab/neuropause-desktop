# DECISION MEMO — S95 F-S95-1: a customer receipt could settle a DRAFT (unissued) invoice (YELLOW, fixed by canonical mirror)

**Classification: YELLOW — financial-integrity control gap (defined-but-violated), reproduced and FIXED by mirroring the existing buy-side guard. Not RED (no security/tenant bypass), not GRAY (cause fully understood), not POLICY-OPEN (the rule is defined by the system's own accounting model + the buy-side).**

## 1. Finding (reproduced first)

The canonical customer-receipt path (`ReceiveCustomerPayment` → `paymentModule` validate → onChange) accepted a receipt against a **DRAFT (unissued)** customer invoice. Reproduced directly: creating a draft invoice (amount 100, status `draft`) and dispatching `ReceiveCustomerPayment` for 100 **succeeded** — the invoice went `draft → paid`, `amountPaid = 100`, and the payment `onChange` booked Dr Cash / Cr Accounts Receivable.

## 2. Why it is a defect (not an undefined rule)

The system's own accounting model defines that **Accounts Receivable is booked ONLY when a customer invoice is ISSUED** — `IssueCustomerInvoice` posts Dr AR (1100) / Cr Sales Revenue (4000); a DRAFT invoice "posts NOTHING to the GL" (S28, per the `InvoiceSalesOrder`/invoice-module design). So settling a draft books **Cr AR / Dr Cash against an AR that was never booked**, leaving AR net-negative for that invoice and revenue unrecognised — a broken double-entry. This is inconsistent with defined behavior, i.e. a defect, not a missing policy.

It is also the **exact asymmetry with the buy side**, which already refuses the mirror case: `vendorPaymentModule` validate — *"Cannot pay a `${bill.status}` bill — approve it first."* (a draft/cancelled bill is refused). The sell-side simply lacked the mirror guard.

## 3. Canonical fix (reuses existing architecture; invents nothing)

One guard added to `paymentModule.ts` validate, mirroring the buy-side verbatim in intent: when the referenced invoice resolves and its status is `draft` or `cancelled`, refuse with *"Cannot settle a `${invStatus}` invoice — issue it first."* `paid`/over-application remain handled by the existing overpay guard; `issued`/`partially_paid` remain payable. This **strengthens a fail-closed control** — it does not weaken the gate, invent payment authority, or add reversal/credit-note policy. Non-frozen file (gate-detector PROCEED).

This is permitted by the S95 directive's rule: *"fix only if the fix reuses the canonical architecture"* — the fix is the buy-side guard mirrored.

## 4. Verification

- Reproduce → now refused: `o2cControlPlaneCertification.test.ts` "REPRODUCES + FIXES the finding" asserts a receipt against a draft invoice is refused, no receipt created, no GL booked.
- Happy path preserved: an ISSUED invoice still settles (full O2C chain green).
- Existing `paymentModule.test.ts`: its reconciliation fixtures previously relied on paying a draft invoice (incidental setup, not an assertion that drafts are payable); the `newInvoice` helper now stamps the invoice to its ISSUED payable state (the real precondition, matching the aging `inv()` fixture and the buy-side flow). 18/18 pass; finance regression 314/314.
- Not faking green: the failing tests were using an accounting-incorrect precondition; correcting the precondition preserves every reconciliation assertion's intent.

## 5. Scope / bounds

The guard applies to the customer-receipt path only. It does not change reversal, bank-reconciliation, or credit/debit-note behavior (none invented). Advance-payment/deposit flows are not a feature of this system (an advance would credit a customer-advances liability, not AR), so blocking draft settlement does not remove any intended capability.

## 6. Files changed

Production: `apps/desktop/src/main/enterprise/modules/finance/paymentModule.ts` (one guard). Test: `apps/desktop/src/main/enterprise/modules/finance/paymentModule.test.ts` (fixture issues the invoice). Both non-frozen.
