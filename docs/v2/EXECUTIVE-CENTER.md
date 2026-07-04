# V2.4 — Executive Intelligence Center

A **presentation/composition layer** that assembles ONE executive snapshot from
intelligence that already exists (V1 Mission Brief, V2.2 Founder AI proactive,
V2.3 Organization Intelligence + org-health KPIs). It creates no new intelligence
engine and no new dashboard framework — every card deep-links to the existing page
that owns the detail.

## STEP 1 recon — reused, never duplicated
- `buildFounderProactiveItems()` (V2.2) → founder recommendations.
- `buildOrgIntelligenceItems()` (V2.3) → organization findings.
- `collectOrgHealthInputs()` + `computeOrgHealth()` (V2.3) → KPIs + health scores.
- Existing IPC channels + `secureBridge` handler pattern → the snapshot handler.
- Existing `EmptyRequest` Zod contract → reused (no duplicate contract added).

## Architecture
```
composeExecutiveSnapshot(sources)   ← PURE, injectable, unit-tested
   sources = { founderItems, orgItems, orgHealthInputs, now }
        │  calls the EXISTING build functions
        ▼
   ExecutiveCenterSnapshot { kpis, orgHealth, criticalAlerts,
     founderRecommendations, organizationHealth, engineeringHealth,
     upcomingPriorities, attentionCounts }
        ▲
   initExecutiveCenter() wires the real producers + exposes one IPC handler
   (IpcChannel.ExecutiveCenterSnapshot) → renderer renders the dashboard
```

## Sections (STEP 2) + drill-down (STEP 3)
Each card carries a `deepLink` to the existing page — no duplicated detail views:
- Critical Alerts → `notifications`
- Founder Recommendations → `ai-workforce/founder`
- Organization Health → `enterprise/organization`
- Engineering Health → `ai-workforce/engineering`
- Upcoming Priorities → `enterprise/briefings`

Critical Alerts aggregates every `critical` item across founder + org (deduped by
id); Engineering card routes engineering-flavored items; Upcoming Priorities holds
`high` items; `attentionCounts` gives the 30-second glance.

## KPIs (STEP 4) — reuse existing calculations
Six KPIs built purely from the V2.3 org-health scores + raw inputs: Organization
Health, Engineering Health, AI Adoption, Connector Health, License, Active Members.
Each has value, display string, band (healthy/watch/at-risk/critical), and a
deep-link. No KPI is recomputed — they read `computeOrgHealth` output.

## Files changed
- `packages/shared/src/types/executiveCenter.ts` (new) — snapshot/card/KPI types
  (named `ExecutiveCenterSnapshot` to avoid the existing `ExecutiveSnapshot`).
- `packages/shared/src/index.ts` — export the new types.
- `packages/shared/src/ipc/channels.ts` — `ExecutiveCenterSnapshot` channel.
- `apps/desktop/src/main/enterprise/executiveCenter.ts` (new) — the pure composer.
- `apps/desktop/src/main/enterprise/executiveCenterSubsystem.ts` (new) — wires real
  sources + the IPC handler (reuses `EmptyRequest`).
- `apps/desktop/src/main/enterprise/executiveCenter.test.ts` (new) — 8 tests.
- `apps/desktop/src/main/runtimeCore.ts` — init + push handlers (2 lines + import).

## Tests & verification
Desktop **567 passed** (8 new: all sections present, KPI reuse of org-health,
every KPI/card deep-links, critical dedup aggregation, engineering routing, upcoming
routing, empty-state summary). Backend 168 passed. Typecheck + lint clean.

## Known limitations — read honestly
- **This increment ships the verified DATA/COMPOSITION layer + IPC**, not a
  pixel-verified renderer. The composer and its contract are fully tested; the
  actual dashboard *panel* (React view consuming `ExecutiveCenterSnapshot`) should
  be built + visually checked on macOS, since a renderer can't be visually verified
  in CI. The snapshot shape is designed so that panel is a straightforward map over
  `kpis` + the five cards.
- Weekly Trends / Recent Decisions / Recent Deliveries / Executive Timeline / Evidence
  Summary (from STEP 2's fuller list) are natural follow-on cards: each is another
  read of an existing source (timeline, memory) composed the same way — not yet in
  this first increment.
- The snapshot is computed on demand (per IPC call); a cached/refreshed snapshot to
  avoid recompute on every open is a later optimization.
- Engineering KPI reuses the org-health engineering sub-score; a dedicated
  Engineering AI feed can enrich that card later.

## How the renderer uses it
Call `IpcChannel.ExecutiveCenterSnapshot` (no args) → receive
`ExecutiveCenterSnapshot` → render the KPI strip from `kpis` and one card component
per section, each navigating via its `deepLink`. That panel is the next increment.
