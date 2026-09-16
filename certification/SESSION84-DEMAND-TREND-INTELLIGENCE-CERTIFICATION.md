# SESSION 84 — GOVERNED DEMAND-TREND INTELLIGENCE CERTIFICATION

**Class:** Tier-2 governed ERP read/intelligence capability. Baseline S83 GREEN. Release track PAUSED.

## 1. Repository census

Demand candidates: sales orders (`orderModule` — quantity/orderDate/status/lines), shipments (`shippingModule`), stock issues, and the planning model (`collectPlanningModel`). Existing forecast: `revenueForecastModule` (REVENUE/opportunity pipeline in money — NOT unit demand; the immutable-snapshot pattern to mirror). Existing demand math: `packages/shared/types/planning.ts` — `calculateFirmDemand` (pending orders = committed) and `calculateHistoricalShipped` (shipped/delivered units = actual run-rate). Reorder/safety-stock: `autoReorderSeam`. Trend helpers: `monthlyTrendFor` (executiveCenter, health-score-specific). No existing demand-trend register.

## 2. Canonical demand source

`calculateHistoricalShipped` (`packages/shared/types/planning.ts`) — the repository's OWN definition of historical actual demand: **SHIPPED/DELIVERED shipment quantities** (`abs`). S84 reuses this status set + quantity treatment verbatim; it does NOT assume sales orders (the directive's warning). Committed demand (pending orders) is kept distinct and not collapsed.

## 3. Existing calculations reused

`calculateHistoricalShipped` (eligible-status + abs) · `shippingFromRecord` · the arithmetic mean used across planning (`average`) · YYYY-MM period convention · `EnterpriseRecordStore` tenancy/RBAC · the immutable-snapshot pattern (revenueForecast/apAging/S81/S83). **No** new KPI/forecast/persistence/notification/tenant/dashboard/event/workflow engine.

## 4. Exact data lineage

Shipping records (`warehouse-shipping`) → shipped/delivered filtered → bucketed by `shippedDate` (fallback `createdAt`) YYYY-MM per SKU → immutable `sales-demand-trend` snapshot (per-SKU series + threshold-free direction + portfolio counts). Read-only w.r.t. shipping.

## 5. Demand/trend semantics

Demand = Σ abs(quantity) of shipped/delivered shipments per SKU per month. Series sorted ascending. `priorAverage` = arithmetic mean of demand over the covered months before the latest. `delta` = latest − priorAverage; `deltaPercent` = delta/priorAverage×100 (0 when priorAverage 0). `direction` = **threshold-free**: `up` (>), `down` (<), `flat` (=), `insufficient-data` (<2 periods). Historical only; no forecast/smoothing.

## 6. Policy assumptions found (reused, not invented)

Demand source + eligible statuses (`calculateHistoricalShipped`), cancellation/pending exclusion, period (YYYY-MM), aggregation grain (SKU×month), RBAC (`operations:read`/`operations:manage`), accounting consequence (NONE — analytical).

## 7. Undefined decisions (avoided, not guessed) — memo `DECISION-MEMO-S84-DEMAND-TREND.md`

Trend classification bands (→ threshold-free direction + raw delta numbers), forecasting (→ out of scope, historical only), gap-month zero-fill (→ observed periods only), returns netting (→ not netted, matches planning), reorder consequence (→ NONE; future governed seam recorded, not built).

## 8. Files changed (all non-frozen, gate-detector PROCEED)

`sales/demandTrendModel.ts` · `sales/demandTrendModule.ts` · `sales/demandTrendModuleInstance.ts` · `sales/demandTrend.test.ts` · `e2e/s84DemandTrendJourney.e2e.cjs` · the memo + gate doc + this cert.

## 9. Frozen-surface requirements

One frozen touch: register the module in `enterprise/index.ts` (1 import + 1 `registerModule`) — gated by the literal **FG-S84** token (`FG-S84-DEMAND-TREND-REGISTRATION.md`). No `packages/shared` / channels / Executive Center change. STOPPED before the frozen edit awaiting the token.

## 10. Focused test results — 14/14 green (`demandTrend.test.ts`)

Pure: aggregation by month, status inclusion/exclusion (pending/cancelled excluded), direction up/down/flat, insufficient-data, empty + no-valid-month, createdAt fallback, deterministic ordering/regeneration. Governed: RBAC (operations:manage/read), empty honesty, multi-period register, deterministic regeneration (byte-identical rows), immutability, **read-only source proof**, **NO_TENANT fail-closed**, **tenant isolation**.

## 11. Full regression (Linux sandbox)

gate-detector new files PROCEED · typecheck node+web **0** · eslint clean · S84 **14/14** · sales+warehouse+coverage+registry regression **133/133**.

## 12. Real-Electron result

`e2e/s84DemandTrendJourney.e2e.cjs` written + syntax-checked. **PENDING Mac**: product → receive → create + governed ship → demand-trend register (2 SKUs, total 50, `insufficient-data` — one real month) → deterministic regeneration → shipping read-only → governed read. (Multi-month direction is unit-proven; the governed ship action stamps the current date, so a single session yields one month — honest.)

## 13. Tenant/RBAC/security evidence

RBAC operations:read/manage (unit-pinned) · tenant-scoped `EnterpriseRecordStore` (isolation unit-pinned) · NO_TENANT fail-closed (unit-pinned) · reads via governed `enterprise:module.*` only · no renderer-supplied tenant · AI advisory-only, no store access.

## 14. Immutability / read-only evidence

Immutable snapshot (regeneration-in-place refused) · deterministic regeneration byte-identical · stable identity (`DEMAND-<asOf>-<n>`) · source references (sku/periods per row) · shipping source byte-identical after generation · no duplication of full source records.

## 15. Accounting non-mutation evidence

Writes ONLY its own snapshot; shipping store byte-identical after generation; **no GL posted**, no PR/PO/reservation/inventory/order effect. Analytical + historical only.

## 16. Decision memos

`DECISION-MEMO-S84-DEMAND-TREND.md` (policy found vs undefined; avoided policy; future reorder-seam integration recorded).

## 17. Remaining Tier-2 intelligence gaps

Demand-trend → reorder/safety-stock governed integration (execution semantics undefined); order-vs-fulfilled demand-fill-rate; trend classification bands (operator policy); multi-month backfilled history via a governed dated-demand path; KPI/Executive-Center demand exception surfacing (optional; separate gate).

## Mac validation (operator, 2026-09-04) — GREEN

FG-S84 registration applied (isolated frozen commit; `enterprise/index.ts` the only frozen file). Then:
- Real-Electron `e2e/s84DemandTrendJourney.e2e.cjs`: **passed** (all assertions + RESULT, exit 0) on the alternate build (`out-seam-s84`), fresh isolated profile, governed bridge only — product → receive → create + governed ship (canonical demand) → demand-trend register (2 SKUs, total 50, SKU-1 = 30 in 2026-09, direction `insufficient-data` for one real month) → deterministic byte-identical regeneration → shipping store byte-identical (read-only) → governed read.
- Full main suite (excluding the class-D `releaseDiscipline` paused-release guards) and full UI suite: **all passed** — clean of S84 failures.

## 18. Final S84 status

**GREEN — Governed Demand-Trend Intelligence VERIFIED end-to-end in the real Electron runtime.** Non-frozen core + FG-S84 registration (2 additive lines, one frozen file) + real-Electron journey + full main/UI all proven. Canonical actual demand reused verbatim (`calculateHistoricalShipped`); zero policy invented (threshold-free direction, historical only); shipping source read-only; no GL posted. `certification/baseline.json` untouched. Release track PAUSED. S85 not started.
