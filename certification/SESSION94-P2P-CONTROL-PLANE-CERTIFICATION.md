# SESSION 94 — END-TO-END PROCURE-TO-PAY CONTROL-PLANE CERTIFICATION

**Class:** whole-workflow certification. **Outcome: the COMPLETE governed Procure-to-Pay lifecycle — PR → PR Approval → PO → PO Approval → PO Send → Goods Receipt → Inventory + GRNI → Supplier Invoice → 3-Way Match → AP Liability → Supplier Payment → AP Settlement — is certified as ONE governed ERP workflow, reusing ONLY the existing canonical modules/commands, with ZERO production change.** No new approval / payment / workflow / inventory / accounting / command-bus engine; no duplicate IPC. No frozen change; no FG-S94 token. Baseline S93 GREEN. Release track PAUSED. This session started no isolated feature — it composes S89–S93 into one chain and adds a restart-durability + AI-boundary proof.

## 1. Live path traced (source-wins)

`UI → preload (window.neuropause) → IPC (secure bridge) → application boundary (applicationService / ElectronClientAdapter, server-resolved principal + tenant) → command bus (dispatchCommand) → authorization (ctx.authorize(PERMISSION_FOR_COMMAND)) → business policy (per-module validate + status machines + three-way match) → domain command → durable transaction (DurableCommandJournal: idempotency + intent-first) → persistence (EnterpriseRecordStore, per-store serialized writes) → event/outbox → governance audit → UI`. This is the FG-ERP-LIVE-IPC path (S22); every consequential P2P command rides it. The renderer `platform:command.dispatch` handler (`platformCommandIpc.ts`) is the one production caller; identity/tenant are never read from the renderer envelope.

## 2. Canonical modules/commands reused (nothing new)

Procurement: `purchaseRequestModule`, `purchaseOrderModule`, `conversion.ts`, commands `CreatePurchaseRequestFromReorderRecommendation` (S89), `Submit/Approve/RejectPurchaseRequest`, `ConvertPurchaseRequestToPO`. Receiving: `goodsReceiptModule`, `postMovement`/`multiLineMovements`, `inventoryGlBridge`, command `PostGoodsReceipt` (S23). Invoice/AP: `vendorBillModule`, `goodsBillMatch` + `erp/threeWayMatch` (`DEFAULT_TOLERANCE`), `postingRules`/`glPosting`, command `ApproveSupplierInvoice` (S25). Payment: `vendorPaymentModule`, `paymentReconcile`, command `PaySupplierInvoice` (S26). Reversal/delete boundary: `paymentReversalModule` + `ECONOMIC_DELETE_GUARD`, commands `ReverseVendorPayment`/`ClearVendorPayment` (S61). Durability/idempotency/event/outbox/audit: the Session-18 `DurableCommandJournal`. All reused verbatim; none modified.

## 3. Fresh-profile real-Electron journey

`e2e/s94P2PControlPlaneJourney.e2e.cjs` — a FRESH isolated `--user-data-dir` with NO seeded ERP state (asserted zero PO/bill/payment at boot) and NO IPC shortcuts (every step is a real governed-bridge call). It drives the whole chain, replays the terminal commands, attempts the refused negatives, then performs a REAL PROCESS RESTART on the same profile and re-checks every count + lineage. See §5 for the run result.

## 4. Control matrix (RED / YELLOW / GRAY / POLICY-BLOCKED)

Legend: **GREEN** = certified & proven; **POLICY-OPEN** = a business rule the existing system does not define (documented, not invented); no RED/YELLOW/GRAY findings.

| # | Control | Status | Evidence |
|---|---|---|---|
| A1 | Create/Submit/Approve PR; Convert to PO | GREEN | governed commands; PR draft→submitted→approved→converted |
| A2 | PO remains draft until explicit approval | GREEN | PO status `draft` after convert; approve/send are explicit governed actions |
| B1 | Receive Goods creates a pending GR | GREEN | `receiveGoods` → one pending GR (`GR-PO-PR-REORDER-…`) |
| B2 | Post Goods Receipt = exactly one inventory + GRNI posting | GREEN | one `receive` movement; Dr Inventory / Cr GRNI |
| B3 | No duplicate receipt on replay | GREEN | same-key `PostGoodsReceipt` replay → deduped, one movement |
| B4 | Receiving cannot occur before required PO state | GREEN | draft PO `receiveGoods` refused; no GR created |
| B5 | Single-product/header receiving; cumulative over-receipt | **POLICY-OPEN** | the header-only reorder receipt path does not cumulative-check an edited pending qty (S91 §4); **no tolerance invented** — recorded as policy-open |
| C1 | Draft invoice creates no AP liability | GREEN | drafting the bill leaves status `draft`, books nothing |
| C2 | Wrong-supplier / mismatch refused or held (canonical) | GREEN | three-way match BLOCKED/MISMATCH/NO_LINES → held (S92) |
| C3 | Matched approval creates AP exactly once; GRNI relief once | GREEN | approve books AP+relief once; re-approve replays, no duplicate GL |
| C4 | Approved-invoice economic edit remains governed | GREEN | edit-door marker fence (approvedAt/etc. uneditable, S55) |
| D1 | Draft/unapproved bill cannot be paid | GREEN | `PaySupplierInvoice` refused for a draft bill (unit test) |
| D2 | Explicit operator payment only; exactly one cleared payment | GREEN | one cleared vendor payment; no automatic payment |
| D3 | Dr AP / Cr Cash journal exactly once; AP settled | GREEN | one `JE-VPAY-*`; bill `paid`, amountPaid=total |
| D4 | Same-key replay does not double-pay | GREEN | replay deduped; one payment, one journal |
| D5 | Second full payment refused; duplicate txn ref refused | GREEN | overpay guard + duplicate-transactionRef guard |
| E1 | Cleared payment DELETE refused | GREEN | `ECONOMIC_DELETE_GUARD` (S61 D6 / S64) |
| E2 | ReverseVendorPayment is the canonical unwind | GREEN | governed reversal creates an immutable reversal record |
| E3 | Bank-reconciled payment reversal fail-closed | GREEN | `bankReconciledAt` set → reversal refused (S55/S61) |
| E4 | Original payment immutable; tenant isolation | GREEN | original fields byte-identical after reversal; tenant-scoped |
| F | Restart durability (counts + lineage + no double-post) | GREEN | rebuilt installation over the same stores + real app restart |
| G | Security: forged tenant / unauthorized / replay fail closed | GREEN | UNRESOLVED_TENANT / CROSS_TENANT_CLAIM / UNAUTHORIZED / replay deduped |
| H | AI/advisory cannot autonomously approve/receive/pay/reverse | GREEN | an advisory context (no manage grants) is refused on every consequential command (§13) |

**No RED (mechanical defect), no YELLOW, no GRAY.** One POLICY-OPEN item (B5, single-product cumulative over-receipt), carried from S91, deliberately not invented.

## 5. Real-Electron result — GREEN (operator Mac, 2026-09-04)

`out-seam-s94` build → fresh-profile journey with a real restart. **Passed every assertion + RESULT, exit 0** (51 assertions): FRESH isolated profile with NO seeded ERP state → product/receive/ship → reorder recommendation → PR Submit/Approve/Convert → PO (`PO-PR-REORDER-…`, **draft until explicit approval**) → **draft PO cannot be received** → PO Approve/Send → Receive Goods → Post Goods Receipt (**inventory 70 → 500**, exactly one new receive movement, replay deduped) → Supplier Invoice (**draft books no AP**) → 3-Way Match approve (**AP + GRNI relief once**, re-approve replays with no duplicate GL) → **no automatic payment before the operator action** → PaySupplierInvoice (**one cleared vendor payment, Dr AP / Cr Cash JE-VPAY-***) → **AP SETTLED (bill paid)** → same-key replay no double-pay → **second full payment refused (overpay)** → **duplicate txn ref refused** → **cleared payment DELETE refused** (governed reversal is the only unwind) → **REAL PROCESS RESTART on the same profile: every count (PR/PO/GR/movement/invoice/payment/journal) unchanged, the bill still SETTLED, lineage survived, and a post-restart replayed payment deduped with no duplicate GL.**

Two first-run harness/assertion defects were found and corrected (both Class B, no product change): (1) the receive-movement assertion counted the TOTAL rather than the DELTA from the post (the initial stock seed is its own `receive` movement) → made delta-based; (2) a leftover `earlyPay2` stub ran after the bill was approved and settled it in full, so the real payment was correctly refused as overpay → removed. The product behaved correctly throughout both runs. **GREEN end-to-end.**

## 6. Focused test totals

`p2pControlPlaneCertification.test.ts` **9/9** in the sandbox: full-chain composition + exactly-once accounting; restart durability (rebuild over the same stores + replay dedup); reversal/delete boundary (immutable original + re-open + at-most-one + bank-recon fail-closed); security (unauthorized approve/receive/pay + forged/no/cross tenant + replay); AI/advisory boundary (no autonomous consequential execution). Regression: platform/command **155/155**; finance + procurement modules **382/382**. Typecheck node clean; eslint clean. Full main + UI + build + journey PENDING operator Mac.

## 7. Frozen-file changes

**None.** gate-detector PROCEED on all S94 files. `enterprise/index.ts`, `runtimeCore.ts`, `packages/shared`, `commandBus.ts`, `cst/`, all finance/procurement/inventory modules untouched. No FG-S94 token. `certification/baseline.json` untouched.

## 8. Exact files changed (test/docs-only — ZERO production code)

- `apps/desktop/src/main/platform/command/p2pControlPlaneCertification.test.ts` (new test)
- `apps/desktop/e2e/s94P2PControlPlaneJourney.e2e.cjs` (new journey)
- `certification/SESSION94-P2P-CONTROL-PLANE-CERTIFICATION.md` (this doc)

No production `.ts` under `src/main` (other than test files) changed; no shared/frozen change.

## 9. Policy gaps (documented, not implemented)

B5 single-product cumulative over-receipt bound; advanced payment approval hierarchy / limits / dual-control / SoD (none exists — RBAC + eligibility is the current design); bank-side correction workflow for reversing a bank-reconciled payment (S55/S61); reorder chain carrying supplier/price/line + legacy-door fencing (S88–S93). Each is a future operator-gated decision; none blocks the S94 target.

## 10. Exact commit

One non-frozen commit (test + journey + cert), recorded on landing.

## 11. Final S94 status — GREEN

**The end-to-end P2P control plane is CERTIFIED and VERIFIED as one governed workflow in the real Electron runtime (operator Mac, 2026-09-04), with ZERO production change.** Every defined control (procurement gating, receiving idempotency, three-way-match fail-closed, AP-once, payment-once, reversal/delete boundary, restart durability, tenant/security, AI boundary) passes; the single POLICY-OPEN item (single-product over-receipt) is documented, not invented. Proven by 9/9 focused tests + platform/command 155/155 + finance/procurement 382/382 (sandbox) + the fresh-profile real-Electron journey with a real process restart (51 assertions + RESULT, exit 0). No frozen change; no FG-S94 token; AI advisory-only. `certification/baseline.json` untouched. Release-track files left untouched (paused). Full main suite + build recorded on the operator's run when available.
