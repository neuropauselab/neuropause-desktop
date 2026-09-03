# DECISION MEMO — S59 PURCHASE-ORDER COMMITMENT LIFECYCLE (D12)

**Session:** ERP S59 · **Status:** POLICY-BLOCKED — the operator explicitly instructed STOP+memo if D12 "requires a larger bounded implementation than can be safely completed in this session." It does. **No code was written.**

## The operator policy

D12 — Draft-PO receiving: REQUIRE PO approval/send before receiving. Do NOT fake it with a UI-only status check. Model the missing canonical `ApprovePurchaseOrder` / `SendPurchaseOrder` commands if they do not already exist, then bind receiving to the authoritative PO commitment state. Preserve existing receiving/inventory/GRNI behavior and idempotency.

## Why this is a larger bounded implementation (measured)

1. **The commands do not exist.** `DomainCommandType` has no `ApprovePurchaseOrder`/`SendPurchaseOrder`; the PO module has no approve/send lifecycle action carrying a commitment state. Both must be modeled first (status states, guards, GL/none, events, audit) — a new governed lane, not a one-liner.
2. **Receiving-against-draft is LOAD-BEARING by construction.** The governed command lane has no PO commitment gate today, so the entire pinned command-lane P2P (PostGoodsReceipt) receives against a DRAFT PO in **8 pinned test files**. Binding receiving to an approved/sent PO is a behavior change that RE-PINS all 8 — a coordinated rework, not an additive fence.
3. **Correctness coupling.** GRNI, three-way match, and receipt idempotency all assume the current draft-receivable flow. Inserting a commitment gate must preserve every one of those invariants (the operator requires it explicitly), which is exactly the kind of multi-file, invariant-sensitive change that the STOP rule reserves for its own bounded session.
4. **It is the buy-side twin of D1 (sales-order approval), which the operator left as "no mandatory approval by default."** The asymmetry (require PO approval, but not SO approval) is a deliberate operator choice that is fine — it just means D12 is a genuine new control, not a symmetry cleanup.

## The bounded slice this needs (proposed sequence, not implemented)

1. **Model `ApprovePurchaseOrder` + `SendPurchaseOrder`** as governed commands wrapping new PO lifecycle actions (draft → approved → sent), with RBAC (`procurement:manage`), events, audit, idempotency — the exact S17/S57 promotion pattern. No GL (a PO is a commitment, not a posting).
2. **Add the receiving gate:** `PostGoodsReceipt` refuses a PO that is not `sent` (or `approved`, per the operator's commitment definition), server-side — never a UI-only check.
3. **Re-pin the 8 command-lane P2P files** to approve+send the PO before receiving; preserve GRNI/three-way-match/idempotency assertions unchanged.
4. **Negative + idempotency tests:** receive-against-draft refused; the governed approve/send path admits; replay idempotent; cross-tenant denied.

## Minimum information needed from the operator (to unblock)

1. **Commitment state that gates receiving:** is it `approved`, or `sent`, or both? (Determines the gate predicate.)
2. **PO approval authority:** who approves/sends (threshold? role? SoD?) — this shares the D8–D11 approval-hierarchy question (a threshold there implies one here).
3. **Confirmation that the 8-file re-pin is in scope** for the follow-up session (it is unavoidable).

## Safest temporary state (in force now)

Unchanged: receiving against a draft PO remains the DEFINED, pinned command-lane behavior; S55 already fenced the CANCELLED-PO half (no flow legitimately receives against a cancelled PO). **POLICY-BLOCKED, not RED** — reachable-by-design pending the approve/send commitment model. Nothing faked with a UI-only check; nothing invented.
