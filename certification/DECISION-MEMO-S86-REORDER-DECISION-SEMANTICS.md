# DECISION MEMO — S86 Reorder DECISION-READINESS semantics (what is defined, what is derived, what stays operator-gated)

**Purpose.** S86 advances the S85 reorder RECOMMENDATION into a **decision-readiness** view: for each active SKU that needs reorder, surface the information an operator needs to DECIDE — the estimated order value, the approval steps that would apply, and the outstanding blockers — WITHOUT executing anything and WITHOUT inventing any business policy. This memo records exactly which semantics are reused from existing engines, which are derived, and which remain undefined (and are therefore surfaced as blockers, never guessed).

## A. Reused verbatim (no new policy)

- **Reorder trigger, target level, suggested quantity** — S85 `deriveReorderRecommendations`, which is itself `assessReorder` + `openSupplyForProduct` (`packages/shared/types/autoReorder.ts`). S86 does not recompute any of these.
- **Demand direction** — S84 `deriveDemandTrendSnapshot`, carried through S85 as informational context. It never alters the decision.
- **Estimated order value** — `suggestedQuantity × product.purchaseCost`. `purchaseCost` is the canonical purchase cost on the product master (`packages/shared/types/inventory.ts`); it is the only pricing field the master carries. When it is absent (≤ 0) the order value is **undeterminable** and is left `null` — never defaulted to standardCost or any other figure.
- **Required approval steps** — `applicableSteps(DEFAULT_SPEND_POLICY, estimatedOrderValue)` from the EXISTING `erp/approvalEngine.ts`. S86 reports the step *labels* that the current default spend policy would require for that order value (manager always; finance ≥ 10,000; executive ≥ 100,000). No new approval engine, no invented thresholds.

## B. Derived (mechanical, from A only)

- **`readinessStatus`** — a source-driven classification with no invented threshold:
  - `REORDER_NOT_REQUIRED` — the S85 recommendation is `ok` (not triggered).
  - `SUPPLIER_DATA_MISSING` — triggered, but `purchaseCost ≤ 0`, so the order cannot be valued and the approval requirement cannot be derived. Fail-closed, not guessed.
  - `READY_FOR_OPERATOR_REVIEW` — triggered and valuable; the operator has the value + approval requirement in hand.
- **`blockers[]`** — the concrete gaps standing between the recommendation and a decision, each stating its cause: missing purchase cost, **no preferred supplier on the product master** (supplier selection is an operator decision — the master has no supplier/lead-time/MOQ fields), insufficient demand history (informational), and the undefined automatic-execution policy.

## C. Undefined — NOT invented; surfaced, and left to the operator (STOP boundary)

Each of these is a genuine gap in the canonical model. S86 does not fabricate a value for any of them; it names them as blockers and stops:

1. **Supplier selection / award.** The product master carries no preferred-supplier, lead-time, MOQ, or order-multiple field (confirmed against `packages/shared/types/inventory.ts`). S82 supplier risk is keyed by supplier *name* with no product→supplier link. So which supplier to order from is genuinely undefined data — an operator decision. Surfaced as a blocker on every triggered row.
2. **The authoritative spend policy.** `DEFAULT_SPEND_POLICY` is documented in source as *"illustrative and configurable — the thresholds are data, not logic, and an operator is expected to replace them."* S86 reports what that DEFAULT policy would require and does **not** assert it as the tenant's final authority. Wiring a tenant-configured policy is a separate future gate.
3. **Automatic execution (auto-PR authority).** Whether a reorder decision may ever become an automatic Purchase Request draft is undefined. The execution seam (`runReorderCheck`, `autoReorderSeam.ts`) exists but is a human-gated future path. **S86 does not import or call it.** `executionReadiness` is the constant `BLOCKED_UNDEFINED_POLICY` on every row, and the snapshot's `executionBlocked` is always true — fail-closed by construction.
4. **Demand→reorder-point adjustment.** Carried from S85: demand trend never shifts the trigger or quantity. Undefined policy, not invented.

## D. Boundary statement

S86 is **decision intelligence only**. It reads product / PR / PO / shipping stores, writes only its own immutable snapshot, and reaches no execution path. It drafts no purchase request, creates no PO, moves no stock, reserves nothing, awards no supplier, and posts no GL. The reorder EXECUTION gate (recommendation → governed PR draft authority) remains a separate, operator-gated future slice; S86 STOPS at the decision-readiness boundary.
