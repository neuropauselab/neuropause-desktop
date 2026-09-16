# DECISION MEMO — S84 Demand-Trend Intelligence: policy found vs undefined

**Class:** design/policy record for S84 governed demand-trend intelligence.
**Headline:** the demand SOURCE and eligible-status semantics are already repository-defined and reused verbatim; the trend was built so it invents NO threshold. The genuinely undefined items are avoided (not guessed) and recorded here as bounded limitations.

## Policy FOUND (reused — source-wins)

| Question | Canonical definition reused |
|---|---|
| Canonical actual demand | `calculateHistoricalShipped` (`packages/shared/types/planning.ts`): SHIPPED/DELIVERED shipment quantities (`abs`). The planning engine's own "historical run-rate" demand — reused verbatim as the eligible-status set (`{shipped, delivered}`) and quantity treatment. |
| Committed vs actual | `calculateFirmDemand` = pending sales orders (committed); actual = shipped/delivered. S84 uses **actual** (fulfilled) demand and does not collapse the two. |
| Cancellation treatment | `cancelled` shipments are not in the shipped/delivered set → excluded (matches the planning definition). `pending` excluded (not yet demand-realized). |
| Period convention | YYYY-MM month key (the repo convention: `isGlPeriodKey`, budgets, GL). Bucketed by `shippedDate` (fallback `createdAt`). |
| Aggregation grain | Per SKU × month — matching planning's per-SKU demand and the repo month period. |
| Accounting/reorder consequence | NONE — analytical, historical only. No PR/PO/reservation/inventory/GL effect (a variance/trend never posts). |
| RBAC / tenancy / persistence | `operations:read`/`operations:manage` (as apAging/budget) · `EnterpriseRecordStore` tenant scope · the immutable-snapshot pattern (S81/S83/revenueForecast). |

## Policy UNDEFINED — avoided, not invented (bounded limitations)

1. **Trend classification bands (rising/flat/falling tolerance).** Undefined. S84 does NOT emit a business-classified band. `direction` is a **threshold-free strict comparison** of the latest month's demand to the mean of the prior covered months: `up` (>), `down` (<), `flat` (exactly equal), `insufficient-data` (<2 periods). A tolerance band (e.g. ±X%) would be an invented policy → deliberately omitted; the raw `delta`/`deltaPercent` numbers are provided so the operator can apply their own band later.
2. **Forecasting.** Explicitly out of scope (directive). S84 is **historical only** — no forecast horizon, no smoothing policy. The trailing average is a plain arithmetic mean (the same `average` planning uses), not a business smoothing method.
3. **Gap-month zero-fill.** Whether months with no shipments count as zero demand is an undefined convention. S84 reports only OBSERVED periods (months with shipped/delivered activity); it does not zero-fill gaps (that would be an invented convention).
4. **Returns netting.** Returns are a separate movement, not a shipment status; the shipped/delivered run-rate does not net returns (consistent with `calculateHistoricalShipped`). Not invented.
5. **Demand source choice (orders vs shipments).** The directive warned against assuming sales orders. The repo's OWN demand definition (`calculateHistoricalShipped`) uses shipments — so actual demand = shipments, and committed demand = pending orders. S84 follows the repo, not an assumption.

## Future governed integration (recorded, NOT built)

A demand trend could feed the existing reorder/safety-stock seam (`autoReorderSeam`) — but the exact execution semantics (how a trend adjusts reorder level) are undefined, so S84 does NOT wire it. Recorded as a future governed gate, not implemented.

## What S84 built

A governed immutable **demand-trend register** (`sales-demand-trend`) mirroring apAging/revenueForecast/S81/S83: per SKU, the historical demand series by month + threshold-free direction + portfolio counts. Reuses the shipping store, the planning demand definition, `EnterpriseRecordStore` tenancy/RBAC, and the snapshot pattern. **No** new KPI/forecast/persistence/notification/tenant/dashboard/event/workflow engine. Read-only against shipments; posts no GL.

## Frozen surface

One frozen touch: register the module in `enterprise/index.ts` (1 import + 1 `registerModule`) — gated by the literal **FG-S84** token (`FG-S84-DEMAND-TREND-REGISTRATION.md`). No `packages/shared` / channels / Executive Center change.
