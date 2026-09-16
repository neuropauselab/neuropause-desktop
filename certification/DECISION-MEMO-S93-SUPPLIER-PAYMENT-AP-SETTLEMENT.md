# DECISION MEMO — S93 AP Liability → Supplier Payment → AP Settlement (canonical payment reused; nothing invented)

**Outcome.** The S92 payment-ready Accounts-Payable liability (an approved, three-way-matched reorder supplier invoice) continues into the **existing** governed supplier-payment path — `PaySupplierInvoice` (S26) → one cleared Vendor Payment → Dr AP / Cr Cash → the bill reconciles and settles — with **zero production changes**. No new payment engine, no second GL, no invented payment authority / bank-reconciliation / reversal semantics. S93 is a certification/verification gate. **NOT a STOP** — every consequential financial rule the path needs is already DEFINED. No frozen change; no FG-S93 token.

## 1. STOP-check — is payment authority (or any consequential rule) undefined? NO.

Per §2 of the directive, a STOP+memo is required only if payment authority is undefined. Source-wins discovery found it DEFINED, and defined the way the directive requires it be reused (not invented):

- **Payment authority = `operations:manage` RBAC + `validate` eligibility.** The governed `PaySupplierInvoice` command carries `PERMISSION_FOR_COMMAND['PaySupplierInvoice'] = 'operations:manage'` (`domainCommand.ts`), and the vendor-payment `validate` enforces the economic prerequisites. **There is NO separate payment-limit, approval hierarchy, dual-control, finance threshold, or segregation-of-duties rule in the source** — and the directive forbids inventing any. So authority is not "undefined"; it is "RBAC + eligibility, with no additional approval layer" — the existing, settled design (established at S26). Recorded as a policy gap (advanced approval hierarchy / limits) for a future operator-gated decision — **not invented here**.

Because nothing consequential is undefined, S93 certifies what the source implements.

## 2. Canonical path (source-wins)

```
approved goods bill (AP liability booked by S92)
  → operator PaySupplierInvoice command  [operations:manage; deny-by-default: always status 'cleared']
       → EnterpriseModuleCreate on finance-vendor-payments → vendor-payment validate:
           bill resolves (by id or number); bill must be approved/paid (draft/cancelled → refused);
           amount > 0; cumulative cleared + this ≤ bill total (no overpay / no re-pay); no duplicate txn ref
       → onChange: reconcileBillFromLedger (paidDate stamped when covered) + Dr AP / Cr Cash (JE-VPAY-*)
       → durable journal: idempotency (same-key replay deduped) + SupplierInvoicePaid event + outbox + audit
       → compensation: a failed durable commit soft-deletes the payment (its reconciler un-pays the bill)
  → AP SETTLED (bill status 'paid')
```

Sources: `commandBus.ts` (`PaySupplierInvoice`, S26), `vendorPaymentModule.ts` (validate + onChange + S49 edit fence + S57 clear action), `paymentReconcile.ts` (`reconcileBillFromLedger`), `glPosting.ts` (`handleVendorPaymentChangeForGl`, JE-VPAY-*), `paymentReversalModule.ts` + `moduleRegistry.ts` `ECONOMIC_DELETE_GUARD` (the reversal/delete boundary).

## 3. Payment eligibility — DEFINED (source-of-truth status semantics)

An invoice must satisfy the canonical prerequisites before it can be paid, all enforced at vendor-payment `validate`:
- **Approved bill:** a `draft` or `cancelled` bill is refused ("Cannot pay a … bill — approve it first."). A held/unmatched reorder bill stays `draft` (S92), so it is refused here too — an unmatched invoice cannot become paid.
- **Amount > 0**, **no overpay** (cumulative cleared + this ≤ bill total; the remainder is stated), **no duplicate transaction ref**, **tenant-scoped** (a foreign-tenant bill is invisible → refused), **supplier via `billRef`** resolution.
A settled bill has zero remaining balance, so a second full payment is refused by the overpay guard — **an already-paid invoice cannot be paid again.**

## 4. Payment execution — reuse verbatim, no automation

`PaySupplierInvoice` is the governed path and is reused verbatim. The target is: AP liability → explicit operator payment action → governed `PaySupplierInvoice` → exactly ONE cleared payment → AP settled. Deny-by-default: the command always creates a `cleared` payment (a client can never mint a void/pending "payment"). **No automatic payment, no background payment, no AI payment** — AI holds no `operations:manage` path (§13).

## 5. Idempotency / duplicate protection — DEFINED (double-guarded)

- **Same-key replay** → durable-journal dedup, no second payment or journal.
- **Restart** → a fresh journal over the same file replays, no double-pay.
- **Distinct-key second full payment** → refused by the overpay guard (remaining balance 0).
- **Duplicate transaction ref** → refused.
- **Already-paid** → refused (overpay guard).
- **Edit-door** cannot flip a payment to `cleared` (S49 fence); a **cleared payment cannot be deleted** (S61 D6 / S64 economic delete guard) — no back-door settlement or un-settlement.

## 6. Accounting — canonical, not invented

Each cleared payment books **Dr Accounts Payable / Cr Cash** (`JE-VPAY-*`, idempotent) via `handleVendorPaymentChangeForGl`; the bill's `amountPaid`/`paidDate` are re-derived from the cleared ledger by the shared reconciler (the payment ledger is the source of truth). The original bill/AP journal remains immutable; the payment journal is separately identifiable (`JE-VPAY-*`); replay does not duplicate the accounting. Voiding/soft-deleting a payment (internal compensation only) un-pays the bill and reverses the GL.

## 7. Bank reconciliation — a SEPARATE, distinct step (unaltered)

Payment execution creates a `cleared` payment with **no `bankReconciledAt`**. Bank reconciliation is a separate step: `bankStatementModule` (FW-8) matches a cleared payment against a finalized statement and stamps `bankReconciledAt` + `bankStatementRef`, making it immutable. So **payment and reconciliation remain distinct** — S93 does not invent or alter reconciliation behavior.

## 8. Payment reversal — existing boundary certified (S93 performs no reversal)

The only unwind of a cleared payment is the governed `ReverseVendorPayment` (S61 D4). It creates a **separate immutable reversal record**; the original payment is never mutated; guards refuse a non-cleared, **bank-reconciled** (`bankReconciledAt` set → fail-closed, S55/S61), foreign-tenant, nonexistent, or already-reversed original (at-most-one reversal per payment); its `onChange` books the compensating `${base}-REV` GL and re-opens the bill. A generic DELETE of a cleared payment or of a reversal record is refused (`ECONOMIC_DELETE_GUARD`). **S93 does not automatically perform a reversal** — it only certifies this boundary.

## 9. Security / tenancy — fail closed

`PaySupplierInvoice` requires `operations:manage` (denied actor → `UNAUTHORIZED`, no payment); `NO_TENANT` → `UNRESOLVED_TENANT`; forged tenant → `CROSS_TENANT_CLAIM`; a foreign-tenant bill is invisible → refused. Actor is server-derived; the renderer cannot bypass the governed command (identity/tenant never read from the envelope); AI cannot execute payment; a generic edit cannot mark a payment cleared or a bill paid.

## 10. Legacy-door status (recorded, not changed)

A direct `enterprise:module.create` of a `cleared` vendor payment is still governed by `validate` (RBAC `operations:manage` + the full eligibility set) + tenant + audit + the same `onChange` GL/reconcile — but it bypasses the durable command journal (idempotency/event/outbox). This is the same legacy-door characteristic recorded in S90–S92 (the governed command is the journaled path). Fencing vendor-payment create to governed-only (reusing the S46 mechanism) is a future hardening option; not implemented here.

## 11. HARD RULE compliance

No automatic payment; no AI payment; no invented payment authority, limit, threshold, dual-control, or bank-reconciliation policy; no duplicate payment or GL engine; no mutation of historical payment records (originals immutable, reversal is additive). The existing `PaySupplierInvoice` and payment-reversal architecture are reused verbatim. Payment authority is DEFINED (RBAC + eligibility), so no STOP.

## 12. Policy gaps (documented, not implemented)

Advanced payment approval hierarchy / limits / dual-control / segregation-of-duties (none exists — deliberately, RBAC + eligibility is the current design); a bank-side correction workflow for reversing a bank-reconciled payment (S55/S61 recorded gap); vendor-payment create legacy-door fencing to governed-only. Each is a future operator-gated decision; none blocks the S93 target.
