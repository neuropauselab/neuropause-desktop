# DECISION MEMO — S59 ECONOMIC REVERSAL + ADJUSTMENT SEMANTICS (D4 · D5 · D6)

**Session:** ERP S59 · **Status:** POLICY-BLOCKED — the operator policy is approved, but the *record model* the implementation needs is undefined and must not be guessed (S59 STOP condition: "accounting semantics are undefined"). **No code was written for these three.**

The operator's D4/D5/D6 policies are clear on INTENT (immutable original, compensating GL, authorized, idempotent, never a raw status/DELETE). What is missing is the **canonical record shape** each needs — and inventing that shape is inventing accounting, which the directive forbids. Each below names the exact bounded slice that would close it.

## D4 — Clear-payment reversal (ALLOWED ONLY THROUGH GOVERNED REVERSAL)

- **Current state (measured):** `ClearCustomerPayment`/`ClearVendorPayment` are governed (S57). There is NO reversal path for an already-cleared payment — no `reverse`/`void` action booking compensating GL exists in `paymentModule`/`vendorPaymentModule`; the `void` status value books nothing.
- **Why STOP:** the operator requires "the original payment remains immutable" + "compensating accounting entries" + "preserve the original transaction and audit trail." That mandates a **new reversal RECORD** (a distinct row that references and offsets the original), not a status flip on the original — but the repo has no reversal-record model for payments (the credit/debit-note model is invoice/bill-scoped, not payment-scoped). Choosing that model (is a payment reversal its own module? a payment with a negative/offset amount referencing the original? what GL — Dr AR / Cr Cash mirroring the original clear?) is an accounting-design decision.
- **Existing enforcement to reuse (once the model is chosen):** the command bus (a new `ReverseCustomerPayment` command), `glPosting` compensating entries (mirror of `handlePaymentChangeForGl`), the `creator_cannot_approve` SoD vocabulary, the payment `validate` fence (keep it off the edit/DELETE door — already fenced by S46).
- **Decision required:** the reversal record model + its compensating GL + who may authorize (SoD). Then ONE bounded session implements `ReverseCustomerPayment` verbatim on those semantics.

## D5 — Issued-invoice economic adjustment (GOVERN)

- **Current state (measured):** editing an issued invoice's economic fields (amount/taxRate/exchangeRate) books GL ADJUSTMENT entries via `glPosting` on the legacy update door — a DEFINED drift-correction behavior. S46 fenced the STATUS edit; the economic-FIELD edit is currently a pilot fence (operators told not to).
- **Why STOP:** the operator requires the economic effect "behind explicit governed policy/command behavior" that is "authorized, produces explicit accounting impact, is auditable, preserves original transaction history, never silently mutates posted accounting history." Today the adjustment MUTATES the invoice in place (it does not preserve the original as a distinct record). Governing it needs a **new adjustment RECORD/command** that captures before/after and books the delta as compensating entries — an accounting-design decision (is an adjustment its own document? which fields are adjustable governed? does it require approval?). Not defined.
- **Existing enforcement to reuse:** the command bus (`AdjustCustomerInvoice`), the `glPosting` adjustment entries (exist), the invoice `validate` fence (S46 pattern to move the economic-field edit off the update door once the command exists).
- **Decision required:** the adjustment record model + adjustable-field set + approval requirement. Then one bounded session governs it and fences the edit door.

## D6 — Delete-door reversal (REPLACE WITH GOVERNED VOID/REVERSAL)

- **Current state CORRECTED (measured — the S58 memo speculated wrongly):** `glPosting.ts:612` explicitly `return`s on `status === 'deleted'` — the Delete door is a SOFT delete that posts **NO** GL reversal (the "DELETE posts reversals" line in the S58 memo is FALSE at source). The delete handler already HOLDs on dependency links. The residual risk is soft-deleting an economically-active-but-unlinked financial row (hiding it while its GL persists) — physical deletion never happens (soft delete only), so "history is never physically deleted" already holds.
- **Why STOP (coupling):** the operator requires the Delete door to "refuse active financial reversal attempts and direct the caller toward the governed reversal/void mechanism." For invoices that mechanism is the credit note (exists). **For payments it is D4 — which does not exist yet.** Implementing D6 in isolation would refuse payment deletion and redirect to a nonexistent command (a partial control the STOP rule forbids). D6 should land TOGETHER WITH D4, as one bounded slice: a module-declared `blockDeleteWhenEconomicallyActive` predicate (issued invoice, cleared payment, issued note, posted journal, closed period) checked in the shared delete handler, refusing + naming the governed reversal. No GL is invented (refuse + redirect only).
- **Existing enforcement to reuse:** the shared `EnterpriseModuleDelete` handler (add a per-module protection predicate), the finance modules' status fields.
- **Decision required:** none beyond D4 — D6 is an engineering slice paired with D4. It is bounded and no-accounting, but coupled.

## Safest temporary state (in force now)

Unchanged and defined: credit/debit notes ARE the governed invoice/bill reversal (S57, D2 certified S59); the payment edit-door clearing fence (S46) + the governed clear (S57) stand; issued-invoice economic edits + deletes remain the DEFINED-legacy behavior under a pilot fence. Nothing was silently narrowed; nothing invented.
