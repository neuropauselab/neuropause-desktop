# SESSION 85 — GOVERNED DEMAND→REORDER / SAFETY-STOCK RECOMMENDATION INTELLIGENCE CERTIFICATION

**Class:** Tier-2 governed ERP read/intelligence capability (recommendation-only). Baseline S84 GREEN. Release track PAUSED.

## 1. Repository census

Reorder logic already exists: `autoReorderSeam.runReorderCheck` (EXECUTION — drafts a Purchase Request DRAFT) built on the pure `assessReorder` + `openSupplyForProduct` (`packages/shared/types/autoReorder.ts`). Product master carries `reorderLevel`, `safetyStock`, `maximumStock`, `currentStock`, `reservedStock`, `availableStock`, `autoReorder`. Demand trend = S84 `deriveDemandTrendSnapshot`. ATP/inventory = S81. Procurement command bus + approval engine + PR/PO modules present. No existing demand→reorder RECOMMENDATION register.

## 2–3. Canonical sources

- **Reorder trigger + quantity:** `assessReorder` (pure, repo-defined) — reused verbatim.
- **Incoming/open supply:** `openSupplyForProduct` (open PRs draft/pending/approved + POs draft/approved/sent).
- **Availability:** `product.availableStock` (on-hand − reserved).
- **Demand context:** S84 `deriveDemandTrendSnapshot` (shipped/delivered direction).

## 4. Existing reorder/planning logic

`assessReorder` = trigger (`position = availableStock + openSupply ≤ reorderLevel`) + `targetLevel = max(maximumStock, reorderLevel+safetyStock, reorderLevel+1)` + `suggestedQuantity = ceil(targetLevel − position)`. `runReorderCheck` is the EXECUTION path (PR draft) — **S85 does NOT import or call it.**

## 5. Exact data lineage

products (`inventory-products`) + open PRs (`procurement-requests`) + open POs (`procurement-orders`) + shipments (`warehouse-shipping`) → per active SKU: `openSupplyForProduct` + `assessReorder` + S84 demand direction → immutable `inventory-reorder-recommendation` snapshot. Read-only w.r.t. all sources.

## 6. Implemented recommendation semantics

Per active SKU: on-hand, available, reserved, safety stock, reorder level, open supply, position, target level, `attention` (reorder/ok), `recommendedQuantity` (`assessReorder.suggestedQuantity` when triggered, else 0 — never fabricated), `demandDirection` (S84, context only), reason. Portfolio: skuCount, reorderCount, okCount, totalRecommendedQuantity.

## 7. Policy-defined vs undefined

**Defined & reused:** trigger, quantity, safety-stock role, open-supply, availability, attention outcome, RBAC, tenancy. **Undefined & NOT invented (memo):** demand→reorder-point adjustment (demand kept as context, never shifts trigger/quantity), lead-time, MOQ/order-multiple/EOQ, supplier selection, auto-PR authority, approval requirement for a demand-driven draft. No STOP required for the recommendation layer.

## 8. Procurement execution boundary

`runReorderCheck` (→ `CreatePurchaseRequest`-equivalent PR draft) is the existing governed execution seam. **S85 never reaches it** — the model/module do not import it and call only pure read functions. Execution semantics are undefined (memo §C) → S85 STOPS at the recommendation boundary; execution is a separate future gate.

## 9. Files changed (all non-frozen, gate-detector PROCEED)

`inventory/demandReorderModel.ts` · `inventory/demandReorderModule.ts` · `inventory/demandReorderModuleInstance.ts` · `inventory/demandReorder.test.ts` · `e2e/s85DemandReorderJourney.e2e.cjs` · memo + gate doc + this cert.

## 10. Frozen-surface requirements

One frozen touch: register in `enterprise/index.ts` (1 import + 1 `registerModule`) — gated by the literal **FG-S85** token (`FG-S85-DEMAND-REORDER-REGISTRATION.md`). No `packages/shared`/channels/Executive-Center change. STOPPED before the frozen edit awaiting the token.

## 11. Focused test results — 14/14 green (`demandReorder.test.ts`)

Pure: assessReorder trigger + suggested quantity, open-supply lifts position → ok, no-reorder-level (no trigger), inactive excluded, empty, demand direction as context (does not change attention), determinism. Governed: RBAC (inventory:manage/read), reorder recommendation, **CRITICAL — no PR drafted / no PO created / products untouched**, empty honesty, deterministic regeneration, immutability, NO_TENANT fail-closed, tenant isolation.

## 12. Full regression (Linux sandbox)

gate-detector new files PROCEED · typecheck node+web **0** · eslint clean · S85 **14/14** · inventory+procurement+coverage+registry **219/219**.

## 13. Real-Electron result

`e2e/s85DemandReorderJourney.e2e.cjs` written + syntax-checked. **PENDING Mac**: product → receive → ship (demand) → reorder recommendation (attention reorder, recommendedQuantity 430 from the engine) → deterministic regeneration → governed read → **and the critical negative: no PR, no PO, no inventory mutation, no GL posted by generation.**

## 14. Tenant/RBAC/security evidence

RBAC inventory:read/manage (unit-pinned) · tenant-scoped `EnterpriseRecordStore` (isolation unit-pinned) · NO_TENANT fail-closed (unit-pinned) · reads via governed `enterprise:module.*` only · no renderer tenant · AI advisory-only.

## 15. Immutability / read-only evidence

Immutable snapshot (regeneration-in-place refused) · deterministic byte-identical regeneration · stable identity (`REORDER-<asOf>-<n>`) · source references per row · sources byte-identical after generation.

## 16. No-PR/PO/inventory/GL mutation evidence

Unit + journey pinned: generating a recommendation drafts NO purchase request, creates NO PO, mutates NO product/inventory, posts NO GL. The execution seam (`runReorderCheck`) is not imported/called.

## 17. Decision memos

`DECISION-MEMO-S85-DEMAND-REORDER-SEMANTICS.md` (A defined / B built / C operator decisions required before execution).

## 18. Remaining Tier-2 gaps

Demand→reorder-point adjustment policy; MOQ/order-multiple/EOQ; supplier selection for a recommendation; the governed execution gate (recommendation → PR draft authority); optional KPI/Executive-Center reorder-attention surfacing.

## Mac validation (operator, 2026-09-04) — GREEN

FG-S85 registration applied (isolated frozen commit; `enterprise/index.ts` the only frozen file). Then:
- Real-Electron `e2e/s85DemandReorderJourney.e2e.cjs`: **passed** (all 19 assertions + RESULT, exit 0) on the alternate build (`out-seam-s85`), fresh isolated profile, governed bridge only — product → receive → ship (demand) → reorder recommendation (attention `reorder`, `recommendedQuantity 430` from the canonical engine) → deterministic byte-identical regeneration → governed read → **and every critical negative: NO purchase request drafted, NO PO created, products byte-identical (no inventory mutation), shipping byte-identical (read-only), journal count unchanged (no GL posted).**
- Full main suite (excluding the class-D `releaseDiscipline` paused-release guards) and full UI suite: **all passed** — clean of S85 failures.

## 19. Final S85 status

**GREEN — Governed Demand→Reorder Recommendation Intelligence VERIFIED end-to-end in the real Electron runtime, advisory-only.** Non-frozen recommendation core + FG-S85 registration (2 additive lines, one frozen file) + real-Electron journey + full main/UI all proven. Reuses the canonical reorder engine (`assessReorder`/`openSupplyForProduct`) + S84 demand; zero policy invented; the execution seam (`runReorderCheck`) is NOT wired; proven no PR/PO/inventory/GL from generation. `certification/baseline.json` untouched. Execution stays an operator-gated future gate (memo §C). Release track PAUSED. S86 not started.
