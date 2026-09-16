# SESSION 93 — SUPPLIER PAYMENT → AP SETTLEMENT (PaySupplierInvoice) — CERTIFICATION

**Class:** governed payment continuation + certification. **Outcome: the S92 payment-ready Accounts-Payable liability (an approved, three-way-matched reorder supplier invoice) settles through the EXISTING governed supplier-payment path (`PaySupplierInvoice` → one cleared Vendor Payment → Dr AP / Cr Cash → the bill reconciles → AP settled) with ZERO production changes.** No new payment engine, no second GL, no invented payment authority / bank-reconciliation / reversal semantics, no bypass, no auto-payment, no AI payment. No frozen change; no FG-S93 token. Baseline S92 GREEN. Release track PAUSED.

## 1. STOP-check — NO undefined financial rule → certification gate, not a STOP

Payment authority is DEFINED: `operations:manage` RBAC (`PERMISSION_FOR_COMMAND['PaySupplierInvoice']`) + the vendor-payment `validate` eligibility set. There is NO separate payment limit, approval hierarchy, dual-control, finance threshold, or segregation-of-duties rule in the source — and the directive forbids inventing any. Bank reconciliation, reversal, and delete semantics are all defined (S55/S61/S64). Because nothing consequential is undefined, S93 certifies the source; it invents nothing. DECISION-MEMO-S93 §1.

## 2. Canonical PaySupplierInvoice path (source-wins)

`approved goods bill (AP liability) → operator PaySupplierInvoice [operations:manage; always 'cleared'] → EnterpriseModuleCreate on finance-vendor-payments → validate (approved bill; amount>0; no overpay; no dup txn ref; tenant) → onChange (reconcile bill from cleared ledger → paidDate + Dr AP / Cr Cash JE-VPAY-*) → durable journal (idempotency + SupplierInvoicePaid event + outbox + audit) → AP SETTLED (bill 'paid')`. Full trace in DECISION-MEMO-S93 §2.

## 3. Existing commands / modules reused

`PaySupplierInvoice` (S26 — command bus, durable journal), the vendor-payment module (validate + onChange + S49 edit fence + S57 clear action), the shared `reconcileBillFromLedger`, the GL bridge (`handleVendorPaymentChangeForGl`, JE-VPAY-*), the payment-reversal module (S61 D4) + the `ECONOMIC_DELETE_GUARD` (S61 D6 / S64). Reused verbatim; none modified.

## 4. Payment authorization semantics

DEFINED: `operations:manage` RBAC at the command + the eligibility guards at validate. No advanced approval hierarchy/limit/dual-control exists (existing design; recorded policy gap, not invented). Actor server-derived; a denied actor → `UNAUTHORIZED`, no payment. DECISION-MEMO-S93 §1, §3.

## 5. Payment eligibility rules

DEFINED at validate: the bill must be approved (a `draft`/`cancelled`/held bill is refused — "approve it first"); amount > 0; cumulative cleared + this ≤ bill total (no overpay / no re-pay of a settled bill; remainder stated); no duplicate transaction ref; tenant-scoped; supplier via `billRef`. An unmatched/held reorder bill stays draft (S92) → refused. DECISION-MEMO-S93 §3.

## 6. Accounting entries + AP settlement proof

Each cleared payment books **Dr Accounts Payable / Cr Cash** (`JE-VPAY-*`, idempotent); the bill's `amountPaid`/`paidDate` are re-derived from the cleared ledger (the ledger is the source of truth) → status `paid` when covered. Original bill/AP journal immutable; payment journal separately identifiable; replay does not duplicate. Proven: happy-path test asserts one cleared payment + journal increase + bill `paid`/`paidDate`/`amountPaid === total`; the journey asserts the same in the real runtime.

## 7. Duplicate / idempotency proof

Same-key replay → durable-journal dedup (no second payment or journal); distinct-key second full payment → refused (overpay guard); duplicate transaction ref → refused; already-paid → refused. `reorderPaymentSettlementLifecycle.test.ts` idempotency block + the journey.

## 8. Restart proof

Replay across a durable-journal restart (fresh journal over the same file) does not double-pay — one payment, one journal. Proven in the focused test.

## 9. Bank-reconciliation semantics

Payment execution creates a `cleared` payment with **no `bankReconciledAt`**; reconciliation is a SEPARATE step (`bankStatementModule` FW-8 stamps `bankReconciledAt` + `bankStatementRef`). Payment and reconciliation remain distinct — S93 neither invents nor alters reconciliation. DECISION-MEMO-S93 §7.

## 10. Reversal-boundary proof (S93 performs no reversal)

The only unwind of a cleared payment is the governed `ReverseVendorPayment` (S61 D4): it creates a separate immutable reversal record, the original payment is never mutated, it books the compensating `${base}-REV` GL and re-opens the bill, and it is fail-closed for a non-cleared / **bank-reconciled** / foreign-tenant / already-reversed original (at-most-one reversal per payment). A generic DELETE of a cleared payment (or a reversal record) is refused (`ECONOMIC_DELETE_GUARD`). Proven: the reversal test asserts an immutable original (byte-identical fields), a re-opened bill (amountPaid 0), at-most-one reversal, and a bank-reconciled payment refused; the delete test asserts a cleared payment cannot be deleted. **S93 does not perform a reversal in the happy path/journey — it only certifies the boundary.**

## 11. Tenant / security proof

`PaySupplierInvoice` requires `operations:manage` (denied → `UNAUTHORIZED`, no payment); `NO_TENANT` → `UNRESOLVED_TENANT`; forged tenant → `CROSS_TENANT_CLAIM`; a foreign-tenant bill is invisible → refused. Renderer cannot bypass the governed command (identity/tenant never read from the envelope); AI cannot pay (§13); a generic edit cannot flip a payment to cleared (S49) or mark a bill paid. `reorderPaymentSettlementLifecycle.test.ts` security + edit-door blocks.

## 12. UI result

No new payment application. The existing Finance → Vendor Bills / Vendor Payments surfaces render the supplier, invoice, AP liability, payment eligibility (draft cannot pay), payment status, and the payment action (governed → PaySupplierInvoice). Payment requires explicit human action; no automatic payment. **No UI change was required.**

## 13. Real-Electron result — GREEN (operator Mac, 2026-09-04)

`e2e/s93SupplierPaymentJourney.e2e.cjs` on the alternate build (`out-seam-s93`), fresh isolated profile, governed bridge only. **Passed every assertion + RESULT on the first run, exit 0** (35 assertions): reorder chain → PO (`PO-PR-REORDER-…`) → GR → PostGoodsReceipt (**inventory 70 → 500**) → ApproveSupplierInvoice (AP liability, S92) → **no payment exists before any operator action** → **a draft invoice cannot be paid** (refused, no payment created) → approve → **operator PaySupplierInvoice → exactly ONE cleared vendor payment + Dr Accounts Payable / Cr Cash (JE-VPAY-*)** → **bill `paid` (AP settled)**, `paidDate` stamped, `amountPaid === total` → same-key replay does not double-pay → **a second full payment refused (overpay guard)** → **a cleared payment cannot be deleted** (economic delete guard; still present and cleared). Refusals surfaced through the boundary as the sanitized `ok:false` contract; the specific reasons are pinned at the command-bus layer in the focused unit test. **GREEN end-to-end.**

## 14. Side-effect proof

One explicit payment → one cleared vendor payment + one `JE-VPAY-*` GL (Dr AP / Cr Cash) + bill settled + durable event/outbox/audit. **No** second payment, no duplicate GL, no inventory movement, no auto-payment, no reversal. Original records immutable. `reorderPaymentSettlementLifecycle.test.ts` + the journey.

## 15. Frozen-file changes

**None.** gate-detector PROCEED on all S93 files (`reorderPaymentSettlementLifecycle.test.ts`, `s93SupplierPaymentJourney.e2e.cjs`, both memo/cert docs). `enterprise/index.ts`, `runtimeCore.ts`, `packages/shared`, `commandBus.ts`, `cst/`, the finance/procurement modules untouched. No FG-S93 token. `certification/baseline.json` untouched. Zero production code changed.

## 16. Test totals

`reorderPaymentSettlementLifecycle.test.ts` **13/13** in the sandbox (happy path AP settle; idempotency replay/restart/overpay/dup-txn; eligibility draft-cannot-pay/overpay; edit-door clear fence + cleared-payment delete guard; reversal boundary [immutable original + re-open + at-most-one + bank-recon fail-closed]; security operations:manage / NO_TENANT / forged / cross-tenant). Regression: platform/command **146/146**; finance vendorPayments + session61PaymentReversal + session11VendorBillP2P **31/31**. Typecheck node clean; eslint clean. Full main + UI + build + journey PENDING operator Mac.

## 17. Policy gaps (documented, not implemented)

Advanced payment approval hierarchy / limits / dual-control / SoD (none exists — RBAC + eligibility is the current design); a bank-side correction workflow for reversing a bank-reconciled payment (S55/S61 gap); vendor-payment create legacy-door fencing to governed-only. Each is a future operator-gated decision; none blocks the S93 target.

## 18. Exact commits

One non-frozen commit (test + journey + memo + cert), recorded on landing.

## 19. Final S93 status — GREEN

**Supplier payment → AP settlement CERTIFIED and VERIFIED end-to-end in the real Electron runtime (operator Mac, 2026-09-04), with ZERO production change.** The S92 AP liability settles through the existing governed `PaySupplierInvoice` path: a draft invoice cannot be paid; an explicit operator payment creates exactly ONE cleared vendor payment (Dr AP / Cr Cash, JE-VPAY-*) and settles the bill (`paid`); idempotent (no double-pay on replay/restart, overpay/dup/already-paid refused); the reversal + economic-delete boundary is fail-closed and original records immutable; bank reconciliation stays a distinct step; tenant/security fail closed; no auto/AI payment. Proven by 13/13 focused tests + platform/command 146/146 + finance payment/reversal/bill 31/31 (sandbox) + the real-Electron journey (35 assertions + RESULT, exit 0). No frozen change; no FG-S93 token; AI advisory-only. `certification/baseline.json` untouched. Release track PAUSED. Full main suite + build recorded on the operator's run when available.
