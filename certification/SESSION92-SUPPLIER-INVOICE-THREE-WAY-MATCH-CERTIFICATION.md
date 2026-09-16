# SESSION 92 — REORDER SUPPLIER INVOICE → THREE-WAY MATCH → ACCOUNTS PAYABLE — CERTIFICATION

**Class:** governed payable continuation + certification. **Outcome: the S91 reorder-originated, POSTED Goods Receipt enters the EXISTING governed supplier-invoice → three-way-match → Accounts-Payable path (draft Vendor Bill → ApproveSupplierInvoice → GRNI relief / Cr Accounts Payable) with ZERO production changes.** No new AP engine, no second matcher, no invented accounting / matching tolerance / tax / currency / payment authority, no bypass, no auto-invoice, no auto-approve, no payment. No frozen change; no FG-S92 token. Baseline S91 GREEN. Release track PAUSED.

## 1. STOP-check — NO undefined financial rule → certification gate, not a STOP

Every consequential rule the path needs is already DEFINED in source: the pure three-way match (`erp/threeWayMatch.ts`, `DEFAULT_TOLERANCE`), goods-bill resolution (`finance/goodsBillMatch.ts` `evaluateGoodsBill`), GRNI relief / PPV / tax / AP posting (`finance/glPosting.ts` + `erp/postingRules.ts`), and the at-most-once approve guard. Payment authority is SEPARATE (`PaySupplierInvoice`, S26) and **is not used** — the outcome is a payment-ready liability. Because nothing consequential is undefined, S92 certifies what the source implements and invents nothing. DECISION-MEMO-S92 §1.

## 2. Canonical path (source-wins)

`reorder GR (posted, GRNI accrued) → draft Vendor Bill (vendor, amount, sourcePurchaseOrder = PO, lines) [CRUD, NO payable] → (ApproveSupplierInvoice command) vendor-bill approve → evaluateGoodsBill → threeWayMatch(PO↔GR↔Bill) → MATCHED → stamp approvedAt → onChange → GRNI relieved / Cr Accounts Payable booked ONCE → payment-ready liability`. Full trace + guards in DECISION-MEMO-S92 §2.

## 3. Existing commands / actions reused

`ApproveSupplierInvoice` (S25 — command bus, durable journal: idempotency + `SupplierInvoiceApproved` event + outbox + audit) is the governed economic step: it calls the vendor-bill `approve` action → the fail-closed three-way match → GRNI relief / AP booking. Vendor-bill CREATE is the existing CRUD path (`operations:manage` + validate; a named source PO must resolve). Both reused verbatim; none modified.

## 4. The operator-input boundary (S88/S91 pattern extended) — recorded, not a gap

A reorder recommendation is SKU-level and supplies **SKU + quantity + lineage only**; the PR carries no cost and the PR→PO conversion carries no supplier and no unit price. The canonical goods three-way match needs **bill vendor = PO supplier**, a **PO ordered unit price** (`unitCost`), and **bill line items**. These are the same class of operator inputs as S88 (supplier) and S91 (warehouse): the operator sets the PO `supplier`/`unitCost` (optional edit-door fields) and the invoice line items. **No default supplier, price, or line is invented.** DECISION-MEMO-S92 §3.

## 5. Fail-closed proof (no AP booked)

The three-way match holds a reorder bill missing any operator input, each producing NO payable and leaving the bill draft: **NO_LINES** (a header-only bill), **MISMATCH** (no PO ordered price — the overcharge control), **BLOCKED** (vendor ≠ PO supplier — the wrong-supplier control), **LINES_INCONSISTENT** (lines ≠ subtotal), **MISMATCH** (billed > received — never pay for goods not in). Nothing invented; the DEFAULT_TOLERANCE is explicit. `reorderInvoiceApLifecycle.test.ts` fail-closed block + the journey's NO_LINES step.

## 6. AP-once proof

A matched supplier invoice books the payable EXACTLY ONCE: `approve` stamps `approvedAt` → `onChange` relieves GRNI / Cr Accounts Payable via the shared GL seam; a journal entry appears. At-most-once: a distinct-key re-approve is refused (non-draft guard); a same-key replay is deduped by the durable journal (no second booking). `reorderInvoiceApLifecycle.test.ts` happy-path + at-most-once blocks + the journey.

## 7. No-payment proof

The bill is a payment-ready LIABILITY, never a payment: S92 never dispatches `PaySupplierInvoice`; `paidDate`/`amountPaid` stay empty/0; no vendor-payment record is created (`finance-vendor-payments` store empty throughout). Proven in the test + the journey (`paymentCount() === 0`).

## 8. Edit-door / forgery proof

Lifecycle markers are action-owned: a generic edit cannot hand-stamp/clear `approvedAt` (validate refuses — no forged approval, no forged AP), and `sourcePurchaseOrder` must resolve to a real PO at create (the PO↔bill audit trail cannot be forged). `reorderInvoiceApLifecycle.test.ts` edit-door block + the journey's marker-edit step.

## 9. Lineage proof

recommendation → PR (`PR-REORDER-<report>-<sku>`) → PO (`PO-PR-REORDER-…`, `sourceRequest`) → GR (`GR-PO-PR-REORDER-…`, `purchaseOrder`) → Vendor Bill (`sourcePurchaseOrder` = PO). End-to-end, through existing fields; no second lineage system.

## 10. Tenant / security proof

`ApproveSupplierInvoice` requires `operations:manage` (denied actor → `UNAUTHORIZED`, no approval, no AP); `NO_TENANT` → `UNRESOLVED_TENANT`; forged tenant → `CROSS_TENANT_CLAIM`; a foreign-tenant actor cannot see the bill → refused. Actor server-derived; AI holds no `operations:manage` path and cannot draft, approve, or pay (§13). `reorderInvoiceApLifecycle.test.ts` security block.

## 11. Side-effect proof

One matched supplier invoice → one AP booking (GRNI relief / Cr Accounts Payable, the defined goods-bill accounting — tested, not invented); durable event + outbox + audit; complete lineage. **No** payment, no unrelated GL, no duplicate PO/GR/bill, no inventory movement (receiving already happened in S91). `reorderInvoiceApLifecycle.test.ts` side-effect assertions + the journey.

## 12. Real-Electron result — GREEN (operator Mac, 2026-09-04)

`e2e/s92SupplierInvoiceThreeWayMatchJourney.e2e.cjs` on the alternate build (`out-seam-s92`), fresh isolated profile, governed bridge only. **Passed every assertion + RESULT, exit 0** (30 assertions): product → demand → S86 → S89 confirmation → PR → Submit/Approve/Convert → PO (`PO-PR-REORDER-…`) → operator sets warehouse WH-1 + supplier + ordered unit price on the PO → PO Approve/Send/Receive Goods → PostGoodsReceipt (**inventory 70 → 500, +430** + canonical GRNI) → drafted a header-only supplier invoice → **ApproveSupplierInvoice REFUSED with a governed `CONFLICT` refusal** (boundary-sanitized; the bill stayed draft, no AP booked) → drafted a lined supplier invoice → **ApproveSupplierInvoice MATCHED → AP liability booked exactly once** (GRNI relieved / Cr Accounts Payable) as a payment-ready liability → distinct-key re-approve refused (no second booking) → edit-door `approvedAt` clear refused → full lineage recommendation → PR → PO → GR → bill → **NO payment at any point** (`finance-vendor-payments` empty throughout). The first run correctly caught an assertion-shape defect in the journey (see the note below); the corrected journey is fully GREEN.

### 12a. Boundary-contract note (first-run finding, journey-only correction, no product change)

`e2e/s92SupplierInvoiceThreeWayMatchJourney.e2e.cjs` on the alternate build (`out-seam-s92`), fresh isolated profile, governed bridge only. Drives: product → demand → S86 → S89 confirmation → PR → Submit/Approve/Convert → PO → operator sets warehouse + supplier + ordered price → PO Approve/Send/Receive → PostGoodsReceipt (inventory 70 → 500, +430 + GRNI) → draft header-only bill → ApproveSupplierInvoice REFUSED (governed `CONFLICT` refusal — the boundary sanitizes the raw `NO_LINES` reason; that specific reason is pinned at the command-bus layer in the focused unit test) → draft a lined bill → ApproveSupplierInvoice → AP booked once → re-approve refused → marker edit refused → NO payment.

**Boundary-contract note (found on the first operator Mac run, corrected in the journey — no product change):** the application boundary (`applicationService` + `applicationErrors.mapCommandError`) maps every action refusal to the CLOSED, deny-by-default client error set — a state-precondition refusal (NO_LINES / MISMATCH / BLOCKED / LINES_INCONSISTENT) surfaces to the client as `CONFLICT` with a fixed safe message; the raw internal reason is intentionally never leaked. The first journey draft asserted the raw `NO_LINES` string on the client response (available only at the command-bus layer, where the focused unit test pins it) and correctly FAILED — the header-only bill WAS held (that step passed) but the reason string is sanitized. The journey now asserts the exposed `held.error.code === 'CONFLICT'` contract; the `NO_LINES`-specific reason stays pinned in `reorderInvoiceApLifecycle.test.ts` at the layer that produces it. Classification: harness/assertion (Class B) — not a product defect. The corrected journey ran fully GREEN on the operator Mac (§12).

## 13. Frozen-file changes

**None.** gate-detector PROCEED on all S92 files (`reorderInvoiceApLifecycle.test.ts`, `s92SupplierInvoiceThreeWayMatchJourney.e2e.cjs`, both memo/cert docs). `enterprise/index.ts`, `runtimeCore.ts`, `packages/shared`, `commandBus.ts`, `cst/`, the finance/procurement modules untouched. No FG-S92 token. `certification/baseline.json` untouched. Zero production code changed.

## 14. Test totals

`reorderInvoiceApLifecycle.test.ts` **11/11** in the sandbox (happy path + AP-once/at-most-once; fail-closed NO_LINES / price-MISMATCH / supplier-BLOCKED / LINES_INCONSISTENT / over-billed-MISMATCH; edit-door approvedAt fence + non-existent-PO refusal; security operations:manage / NO_TENANT / forged / cross-tenant). Typecheck node clean; eslint clean. Full main + finance/procurement/command-spine regression + build + journey PENDING operator Mac.

## 15. Policy gaps (documented, not implemented)

Reorder chain carrying a supplier/ordered-price/single-line (a design change rippling S88–S91, its own gate); S46 origin fence for vendor-bill create/approve; header-only over-receipt bound; PO approve/send governance promotion. Each is a future operator-gated decision (DECISION-MEMO-S92 §6); none blocks the S92 target.

## 16. Exact commits

One non-frozen commit (test + journey + memo + cert), recorded on landing.

## 17. Final S92 status — GREEN

**Reorder supplier-invoice → three-way-match → Accounts-Payable CERTIFIED and VERIFIED end-to-end in the real Electron runtime (operator Mac, 2026-09-04), with ZERO production change.** The reorder Goods Receipt enters the existing governed supplier-invoice path: a header-only bill is correctly fail-closed (a governed `CONFLICT` refusal — `NO_LINES` at the command-bus layer); a matched supplier invoice books the payable EXACTLY ONCE (GRNI relieved / Cr Accounts Payable) as a payment-ready liability; the reorder recommendation supplies SKU + quantity + lineage while supplier/price/lines are operator inputs (S88/S91 pattern); at-most-once enforced; markers cannot be forged; tenant/security fail closed; NOTHING is paid; full lineage recommendation → PR → PO → GR → bill (inventory 70 → 500 on the way). Proven by 11/11 focused tests + platform/command 133/133 (sandbox) + the real-Electron journey (30 assertions + RESULT, exit 0). No frozen change; no FG-S92 token; AI advisory-only. `certification/baseline.json` untouched. Release track PAUSED. Full main suite + build recorded on the operator's run when available.
