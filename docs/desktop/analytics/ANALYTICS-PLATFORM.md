# Enterprise Analytics & Decision Intelligence Platform (Phase 6 · Stage 12)

The enterprise-layer COMPOSITION over the analytics the repository already
computes, implemented as one additive subsystem
(`apps/desktop/src/main/analyticsPlatform/`) that owns **no engine, no store,
no scheduler, no executor, and no mutation surface**. The KPI producers, the
recorded histories, the Stage 6 heuristics, the P14 scenario projection, the
decision store, and the stage dashboards **stay authoritative and untouched** —
Stage 12 composes their outputs, computed per read (3 s TTL), stored nowhere.

**Structural honesty, stated up front:** this platform is
NOT an analytics engine. There is no metrics database, no OLAP, no statistics library, no ML,
and no extrapolation anywhere in it. Trends are deterministic deltas over
values the platform actually RECORDED; forecasting capability is REGISTERED
(with what each capability cannot predict), never invented; producers stay
authoritative — the catalog recomputes nothing; a failing producer becomes an
explicit unavailable entry, never a fabricated value.

## Relationship to the existing analytics estate (composition, not duplication)

- **Executive snapshot** (`enterprise/executiveCenter.ts`,
  `composeExecutiveSnapshot`): remains the KPI aggregation point (the six core
  executive KPIs PLUS the four specialist KPIs fed into it). Stage 12 reads
  the snapshot; it never re-aggregates the producers behind it.
- **Process mining** (`enterprise/processMiningProvider.ts`,
  `getProcessExplorerKpis`): the process KPI feed, composed as-is.
- **P14 strategy surface** (`StrategyOverview.kpis`) and **P18 network
  surface** (`IntelNetworkOverview.kpis`): REUSE surfaces — they surface
  platform `ExecutiveKpi` values; the catalog attributes them as surfaces,
  never as second producers.
- **Stage 6 Insight layer** (`insight/*`): the seven deterministic prediction
  heuristics, the outcome loop, and the dashboard stay the intelligence
  authority. Stage 12's six channels ride the SAME **`intelligence:read`**
  scope — the `estrat:*`-beside-`strategy:*` precedent. No new permission is
  minted.
- **Stage 9 partial KPI catalog** (`operationsPlatform/operationsModel.ts`
  `buildKpiCatalog`): the acknowledged precursor (executive + process feeds,
  source-tagged). Stage 12 extends the idea by composition across ALL feeds —
  the Stage 9 catalog itself is untouched and registered as `partial-catalog`.
- **Stage 10 business value** (`strategyPlatform/businessOutcome.ts`): the
  decision-window deltas and value verdicts are composed VERBATIM — never
  restated, never re-scored.
- Stage 12 uses the DISTINCT **`eana:*`** namespace; the renderer adds ONE
  **Analytics** tab inside the EXISTING Insight Center (no new Center, no
  navigation changes).

## The registry (typed data — every reference is REAL, locked by test)

`analyticsRegistryIssues()` + this document lock the registries
(`analyticsRegistry.stage12.test.ts`).

**KPI producers** (ten): `executive-core`, `work-intelligence-automation`,
`work-intelligence-knowledge`, `workforce-performance`, `enterprise-insights`,
`process-mining`, `plugin-extensions`, `p14-strategy-surface`,
`p18-network-surface`, `s9-kpi-catalog` — kinds `producer`, `reuse-surface`,
`partial-catalog`.

**Static KPI keys** (the six executive + four specialist keys):
`org-health`, `engineering-health`, `ai-adoption`, `connector-health`,
`license-status`, `active-members`, `automation-success`, `knowledge-graph`,
`workforce-performance`, `enterprise-intelligence`. Dynamic keys (process
mining, plugin tiles, reuse surfaces) are attributed by feed; a live key with
no registered producer is flagged as an attribution gap — never guessed.

**Series** (honestly kind-tagged): `org-health-history` and
`engineering-health-history` (`daily-history` — the 90-day recorded series),
`decision-window-deltas` (`decision-window` — Stage 10's measured windows),
and `sla-status`, `kpi-bands`, `capability-conditions` (`point-in-time` —
composed per pass; **declared untrendable** because no recorded series
exists for them).

**Predictive capability** (registered, never invented): the seven Stage 6
heuristic kinds `approval-backlog`, `project-delay`, `connector-instability`,
`automation-failure`, `inactivity`, `operational-drift`, `risk-trend`
(`deterministic-heuristic` — joined to their currently-firing instances);
`p14-simulation` (`scenario-projection` — advisory what-if comparison;
nothing is applied); `capacity-pressure` (`present-state-composition` —
registered precisely to state that it predicts NOTHING). Every entry states
what it CAN and CANNOT predict. A missing prediction means "not enough
evidence", never "no risk". Stage 12 adds zero forecasting.

**Reports**: `briefing-generator`, `s10-board-report`,
`s11-federation-report`, `quarterly-ops-report`. **Dashboards**:
`executive-snapshot`, `insight-dashboard`, `s8-automation-dashboard`,
`s9-operations-dashboard`, `s10-strategy-dashboard`,
`s11-federation-dashboard`. **Decision sources**: `decision-store`,
`s6-outcome-loop`, `s10-business-value`, `s10-strategy-recommendations`,
`s11-federation-recommendations`. **Benchmarks**: `p18-network-benchmarks`
(the sanitized P18 posture, which composes the P13 industry reference — no
raw enterprise records are exchanged, and Stage 12 composes that projection
unchanged).

## The computed views (all pure; all per read; failures declared)

- **Unified KPI catalog** (`kpiCatalog.ts`): every reachable feed
  (executive snapshot · process mining · P14 surface · P18 surface),
  source-attributed with producer, surfaces, availability, and evidence.
  Bands are composed VERBATIM from the producers. Keys served by more than
  one live feed are reported as overlaps (reuse made visible, not resolved).
  A failed feed marks ONLY that feed unavailable — the catalog never fails
  whole, and it never recomputes a value.
- **Trends** (`trendAnalytics.ts`): deterministic deltas over RECORDED
  windows only — the 90-day health history and the Stage 10 decision
  windows. Directions are `improving` / `stable` / `regressing` /
  `unavailable` (stability threshold ±1). Point-in-time series appear
  ONLY as declared-untrendable rows. No extrapolation, no prediction, no
  smoothing — the trend module never guesses a future value.
- **Forecast inventory** (`forecastInventory.ts`): a REGISTER of existing
  predictive capability joined to live instances. This module computes
  counts, never futures.
- **Decision intelligence** (`decisionAnalytics.ts`): the decision store's
  funnel × the Stage 6 outcome loop (`recommended` / `approved` /
  `executed` / `verified`) × Stage 10's computed value verdicts (verbatim)
  × the Principle-C recommendation inventory from the SYNC Stage 10/11
  dashboards. The Stage 8 monitor surfaces findings (not Principle-C
  recommendations) and the Stage 9 recommendations are async-composed —
  both registered, neither counted live. No new decision model, no scoring,
  no second confidence system.
- **Executive analytics dashboard + report** (`executiveAnalytics.ts`):
  the four views above + the S8–S11 domain rollups (PRE-COMPOSED slices —
  no dashboard logic duplicated) + the P18 benchmark posture as ONE input.
  Its recommendations are Principle-C complete (the Stage 9 throwing guard)
  and point ONLY at existing governed surfaces — nothing executes from
  analytics, ever.

## IPC (read-only; fail-closed; zero mutation)

Six channels, each `requireAuth` + RBAC **`intelligence:read`**, each a pure
read of the 3 s-TTL composition:
`eana:kpis`, `eana:trends`, `eana:forecasts`, `eana:decisions`,
`eana:dashboard`, `eana:report`. The runtime completeness lock
(`runtimeAuthz.test.ts`) covers the `eana:` namespace; the subsystem lock
(`index.stage12.test.ts`) proves every handler carries the permission and
that no mutation channel exists.

## Assistant (D-8) + monitoring

Ten analytics questions ride the EXISTING `'intelligence'` structured-report
kind through one in-process port (`analyticsAnswer`, the eighth):
`analytics-status`, `kpi-catalog`, `kpi-health`, `trends`, `regressions`,
`forecast-capability`, `decision-intelligence`, `benchmark-position`,
`data-coverage`, `analytics-report`. EIGHT-WAY resolver disjointness
(S5 brief/work-summary + S6 + S7 + S8 + S9 + S10 + S11 + S12) is test-locked
in both directions (`analyticsModel.stage12.test.ts`).

ONE delivery source — **`analytics-watch`** (daily, 09:30) — emits governed
recommendation ITEMS (regressing recorded series; attention-band KPIs) into
the EXISTING delivery engine with evidence, reasoning, and confidence;
deep-links land in the existing Intelligence workspace. Items only — the
watch never acts.

## Renderer

The EXISTING Insight Center gains a tab strip (host-level): **Overview**
(the Stage 6 dashboard, unchanged) and **Analytics**
(`renderer/src/enterpriseAnalytics/EanaPlatformTab.tsx` over the pure,
tested view-model `eanaPlatformModel.ts`). The tab renders the composed
views verbatim — attribution, cannot-predict statements, gaps, disclosures,
and unavailability always visible. Nothing in the tab mutates anything.

## Performance (test-enforced budgets)

Measured over a realistic seeded fixture after a warmup pass
(`analyticsBench.stage12.test.ts`): KPI catalog / trends / forecasts /
decisions component builds ≤ 100 ms each; the full dashboard ≤ 500 ms; the
analytics report ≤ 500 ms; a warm read (inside the 3 s TTL) ≤ 20 ms.
