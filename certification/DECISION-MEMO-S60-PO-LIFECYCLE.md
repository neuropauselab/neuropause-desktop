# DECISION MEMO — S60 PURCHASE-ORDER COMMITMENT LIFECYCLE (D12)

**Session:** ERP S60 · **Status:** POLICY-BLOCKED — this is P2 in the S60 scope order, and it hits the explicit S60 STOP condition "D12 uncontrolled P2P redesign." The commands it needs do not exist, and binding receiving to a PO commitment state re-pins a large P2P test surface. **No code was written.**

## The operator policy (verbatim intent)
Draft-PO receiving: REQUIRE PO approval/send before receiving. Do NOT fake it with a UI-only status check. Model the canonical `ApprovePurchaseOrder` / `SendPurchaseOrder` commands if they do not exist, then bind receiving (`PostGoodsReceipt`) to the authoritative PO commitment state, server-side. Preserve existing receiving / inventory / GRNI behavior and idempotency. Draft→Receive must fail.

## Measured state (source-accurate)
1. **The commands do not exist.** `grep ApprovePurchaseOrder\|SendPurchaseOrder src/main/platform/command/domainCommand.ts` → NONE. `DomainCommandType` has no PO approve/send op; the PO module has no approve/send lifecycle action carrying a commitment state. Both must be modeled first (status states draft→approved→sent, guards, events, audit, idempotency — no GL, a PO is a commitment not a posting).
2. **Receiving-against-draft is LOAD-BEARING by construction.** The governed command lane has no PO commitment gate today, so `PostGoodsReceipt` receives against a DRAFT PO across the whole P2P test surface. **18 test files post a goods receipt** (`enterpriseProcessMining`, `transactionGraphChains`, `session11VendorBillP2P`, `session13BootSeed`, `postedMovementReversal`, `multiLineTransactionIntegrity`, `productionCostingAndVariance`, `procurement`, `session16MultiLineProcurement`, `documentAdapter`, `erp`, `erpIntegration`, `session10GlOwnership`, `session23GoodsReceipt`, `session24InventoryLedger`, `session25SupplierInvoice`, `session30GlControlPlane`, `session19ApplicationBoundary`). Every one that receives against a draft PO must be updated to approve+send first — a coordinated re-pin, not an additive fence.
3. **Correctness coupling.** GRNI relief, three-way match, receipt idempotency, and multi-line receipt atomicity all assume the current draft-receivable flow. Inserting a commitment gate must preserve every one of those invariants (the operator requires it explicitly) — exactly the multi-file, invariant-sensitive change the STOP rule reserves for its own bounded session.
4. **It is the buy-side twin of D1** (sales-order approval), which the operator left as "no mandatory approval by default." The asymmetry (require PO approval, not SO approval) is a deliberate operator choice — D12 is a genuine new control, not a symmetry cleanup.

## The bounded slice this needs (proposed sequence, not implemented)
1. **Model `ApprovePurchaseOrder` + `SendPurchaseOrder`** as governed commands wrapping new PO lifecycle actions (draft → approved → sent), with RBAC (`procurement:manage`), events, audit, idempotency — the S17/S57 promotion pattern. No GL.
2. **Add the receiving gate:** `PostGoodsReceipt` refuses a PO not in the committed state (`approved` or `sent`, per the operator's commitment definition), **server-side** — never a UI-only check.
3. **Re-pin the goods-receipt test surface** to approve+send the PO before receiving; preserve GRNI / three-way-match / idempotency / multi-line assertions unchanged.
4. **Negative + idempotency tests:** receive-against-draft refused; the governed approve/send path admits; replay idempotent; cross-tenant denied.

## Minimum information needed from the operator (to unblock)
1. **Commitment state that gates receiving** — `approved`, `sent`, or both? (Determines the gate predicate.)
2. **PO approval authority** — who approves/sends (threshold? role? SoD?) — this shares the D8–D11 approval-control-plane question (a threshold there implies one here).
3. **Confirmation that the multi-file re-pin (~18 goods-receipt test files) is in scope** for the follow-up session (it is unavoidable) — and that it lands as its own bounded slice, not folded into an unrelated session.

## Safest temporary state (in force now)
Unchanged: receiving against a draft PO remains the DEFINED, pinned command-lane behavior; S55 already fenced the CANCELLED-PO half (no flow legitimately receives against a cancelled PO). **POLICY-BLOCKED, not RED** — reachable-by-design pending the approve/send commitment model. Nothing faked with a UI-only check; nothing invented.
