# DECISION MEMO — S85 Demand→Reorder / Safety-Stock semantics

**Class:** design/policy + execution-boundary record for S85 governed reorder-recommendation intelligence.
**Headline:** the reorder TRIGGER and QUANTITY are already repository-defined (`assessReorder`) and reused verbatim; S85 is RECOMMENDATION-ONLY and never executes. The execution boundary (drafting a PR / creating a PO) exists in the repo but S85 does not reach it — the operator decisions required to authorize execution are listed below.

## A. Repository-defined semantics (reused — source-wins)

| Semantic | Canonical definition reused |
|---|---|
| Reorder trigger | `assessReorder` (`packages/shared/types/autoReorder.ts`): `position = availableStock + openSupply ≤ reorderLevel` (active product, `reorderLevel > 0`). |
| Recommended quantity | `assessReorder.suggestedQuantity` = `ceil(targetLevel − position)`, min 1; `targetLevel = max(maximumStock, reorderLevel + safetyStock, reorderLevel + 1)`. **Repo-defined — reused, not invented.** |
| Safety-stock interpretation | Feeds `targetLevel` (repo formula above). |
| Incoming / open supply | `openSupplyForProduct`: open PRs (`draft/pending/approved`) + open POs (`draft/approved/sent`) quantity, matched by SKU. |
| Availability / ATP input | `product.availableStock` (= on-hand − reserved), the S81/product-master definition. |
| Demand trend (context) | S84 `deriveDemandTrendSnapshot` (shipped/delivered demand direction). Attached as CONTEXT only. |
| RBAC / tenancy / persistence | `inventory:read`/`inventory:manage` · `EnterpriseRecordStore` · the S81–S84 immutable-snapshot pattern. |
| Reorder attention outcome | `reorder` (triggered) / `ok` (not) — no invented band. |

## B. Implementable S85 behavior (built)

A governed immutable **reorder-recommendation register** (`inventory-reorder-recommendation`): per active SKU — on-hand, available, reserved, safety stock, reorder level, open supply, position, target level, `attention` (reorder/ok), `recommendedQuantity` (from `assessReorder` when triggered, else 0), S84 `demandDirection` (context), reason. Portfolio counts + total suggested quantity. Reuses `assessReorder`, `openSupplyForProduct`, S84's demand model, `EnterpriseRecordStore`, the snapshot pattern. **No** new reorder/forecast/inventory/KPI/persistence/notification/workflow/approval/event/tenant engine. Read-only against all sources; posts no GL; drafts no PR.

## C. Operator decisions required BEFORE any execution (NOT built)

The repo already contains a governed execution seam — `runReorderCheck` (`autoReorderSeam.ts`) → drafts a Purchase Request DRAFT → the existing human approval → PO conversion flow. **S85 deliberately does NOT import or call it.** To let a demand-driven recommendation execute automatically, the operator must define:

1. **Whether a recommendation may auto-draft a PR at all** (today `runReorderCheck` is triggered by movement reconciliation / a manual product action — NOT by demand intelligence). Wiring S85 → `runReorderCheck` is a distinct authority decision.
2. **How (if at all) the demand trend adjusts the reorder point / quantity.** Undefined. S85 keeps demand as context and does NOT let it shift `assessReorder`'s trigger or quantity — that adjustment is an invented policy until the operator defines it.
3. **Supplier selection, MOQ, order multiple, EOQ, lead-time** — none defined for a demand-driven order; `assessReorder` sets only a quantity-to-target, no supplier/MOQ. Execution needs these.
4. **Approval requirement for a demand-driven draft** vs the existing manual/auto-reorder path.

Until these are defined, S85 stays at the **recommendation boundary**. Execution is a separate future gate.

## Undefined items deliberately NOT invented

Demand horizon for reorder, lead-time treatment, trend→reorder-point adjustment, MOQ/order-multiple/EOQ, supplier selection, auto-PR authority. None invented; the recommendation uses only `assessReorder`'s defined inputs + demand as context.

## Frozen surface

One frozen touch: register the module in `enterprise/index.ts` (1 import + 1 `registerModule`) — gated by the literal **FG-S85** token (`FG-S85-DEMAND-REORDER-REGISTRATION.md`). No `packages/shared` / channels / Executive Center change.
