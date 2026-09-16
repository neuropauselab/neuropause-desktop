# DECISION MEMO — S60 PAYMENT REVERSAL (D4) + FINANCIAL DELETE BOUNDARY (D6)

**Session:** ERP S60 · **Status:** POLICY-BLOCKED — the operator INTENT is fully specified, but the canonical **reversal record model** it requires is undefined, and inventing it is inventing accounting (S60 STOP: "accounting treatment undefined · reversal mathematics ambiguous"). **No code was written for D4 or D6.** D5 (the sibling in this P0 batch) WAS implemented and certified — see `SESSION60-GOVERNED-REVERSAL-APPROVAL-CERTIFICATION.md`.

---

## D4 — Clear-payment reversal (ALLOWED ONLY THROUGH A GOVERNED REVERSAL TRANSACTION)

### The operator policy (verbatim intent)
Reverse a cleared payment ONLY through a **separate governed transaction**. The **original payment record remains immutable**. Book **compensating GL entries**. Be **idempotent**. Do **NOT** implement reversal as `payment.status = reversed`, `payment.status = pending`, `DELETE payment`, or a direct GL mutation.

### The measured blocker — the existing mechanism does the OPPOSITE of "immutable original"
`handlePaymentChangeForGl` (`glPosting.ts:552-555`) computes:

```
const deleted = event.record.status === 'deleted';
const revoked = deleted || payment.status === 'void';
… decideLifecycle({ live: !revoked && payment.status === 'cleared', revoked, … })
```

The ONLY way the current code reverses a cleared payment's GL is by **mutating the original payment** — setting its `status` to `void` or soft-deleting it. That is exactly the `payment.status = reversed` / `DELETE` shape the operator forbids. There is **no** reversal path that leaves the original untouched and books a compensating entry from a *distinct* record. The `paymentModule`/`vendorPaymentModule` have no `reverse` action.

So D4 cannot reuse the existing lifecycle-GL branch: satisfying "immutable original + separate transaction" means introducing a **new reversal record** whose own `onChange` books the compensating GL — and the shape of that record is undefined.

### What is genuinely undefined (must not be guessed)
1. **The reversal record model.** Is a payment reversal (a) its own module (`paymentReversals`)? (b) a payment row with a negative/offset amount carrying a `reverses: <originalId>` reference? (c) something else? Each choice changes idempotency keys, list/detail UX, and reporting. The credit/debit-note model is **invoice/bill-scoped**, not payment-scoped, so it does not transfer.
2. **The compensating GL treatment.** The forward clear books (single-currency) Dr Cash / Cr AR. The mirror is presumably Dr AR / Cr Cash — but the **multi-currency realized-FX leg** (`realizedReceivableFxLines`, booked at booking-vs-settlement rate) must also be defined for a reversal: does a reversal re-open the FX exposure at the original settlement rate, or at a reversal-date rate? This is a real accounting decision with a P&L consequence.
3. **Authority (SoD).** Who may authorize a reversal — the same `operations:manage`, or a finance role, with `creator_cannot_approve`? (Shares the D8–D11 approval-plane question.)

### Existing enforcement to REUSE once the model is chosen (no new engine)
The command bus (a new `ReverseCustomerPayment` / `ReverseVendorPayment` command), `glPosting` compensating entries (a mirror of `handlePaymentChangeForGl` keyed to the reversal record), the `creator_cannot_approve` SoD vocabulary, the payment `validate` fence (S46 keeps mutation off the edit/DELETE door — already in force). **No parallel reversal engine.**

### Minimum information needed from the operator (to unblock)
1. **Reversal record model** — (a) dedicated module, (b) offsetting negative payment referencing the original, or (c) other.
2. **Compensating GL** — confirm Dr AR / Cr Cash mirror AND the reversal-date FX-rate rule (re-open at original settlement rate vs reversal-date rate).
3. **Authorization** — which role, and whether `creator_cannot_approve` applies.

Then ONE bounded session implements `ReverseCustomerPayment` verbatim on those semantics: immutable original, distinct reversal record, compensating GL, idempotent (deterministic reversal entry number + issued-reversal immutability, the D2 pattern).

---

## D6 — Financial delete boundary (REFUSE + ROUTE TO GOVERNED REVERSAL)

### The operator policy (verbatim intent)
NEVER physically delete financial history. REFUSE deleting economically-active records. ROUTE the caller to the governed reversal/void mechanism. STOP+memo if the "economically active" classification is undefined.

### The measured state (source-accurate)
- Physical deletion never happens: the shared `EnterpriseModuleDelete` handler (`moduleRegistry.ts`) does a **soft** delete (`store.softDelete`) and already HOLDs on dependency links via `ctx.assessDelete`. So "history is never physically deleted" **already holds**.
- `glPosting.ts:612` explicitly `return`s on `status === 'deleted'` — the Delete door posts **NO** GL reversal. A soft delete hides the row while its GL persists; it does not reverse anything.
- The **residual risk** the operator names is real: soft-deleting an economically-active-but-unlinked financial row (an issued invoice, a cleared payment, an issued note, a posted journal, a closed period) hides it from the operator's view while its posted GL stays live — a truthfulness gap, not a double-post.

### Why this is STOP — coupling to D4, not an undefined classification
The "economically active" **classification is proposable** (issued/partially_paid/paid invoice · cleared payment · issued credit/debit note · posted journal · closed period) and could be a per-module `blockDeleteWhenEconomicallyActive` predicate in the shared delete handler — a no-accounting refuse+redirect slice. **The blocker is the redirect TARGET:** the operator requires the refusal to "direct the caller toward the governed reversal/void mechanism."
- For **invoices**, that mechanism is the credit note — it **exists** (S57, certified S59/S60).
- For **payments**, that mechanism is **D4 — which does not exist yet.**

Implementing D6 now would refuse payment deletion and point at a nonexistent `ReverseCustomerPayment` command — a **partial control that redirects into a void**, which the STOP rule forbids. D6 must land **together with D4**, as one bounded slice, so every refusal names a real governed reversal.

### The bounded slice (proposed, not implemented)
1. A per-module `protectDelete(record)` predicate declared by each finance module (issued invoice, cleared payment, issued note, posted journal, closed period).
2. The shared `EnterpriseModuleDelete` handler consults it: economically-active → **refuse** the soft delete + name the governed reversal (credit note for invoices; `ReverseCustomerPayment` for payments — **requires D4**).
3. No GL invented — refuse + redirect only. Reuse the existing `assessDelete`/HOLD plumbing.

### Minimum information needed
None beyond D4. D6 is a bounded, no-accounting engineering slice **coupled to D4** (its payment redirect target). Confirm the economically-active set above (or amend it) and land the pair together.

---

## Safest temporary state (in force now)
Unchanged and defined: the payment edit-door clearing fence (S46) + the governed `clear` action (S57) stand; the Delete door is soft-only and HOLDs on dependency links; issued-invoice economic edits are now **fenced to the credit/debit note** (S60 D5). Nothing was silently narrowed; no reversal accounting was invented. **POLICY-BLOCKED, not RED** — reachable-by-design, pending the D4 reversal-record decision that also unblocks D6.
