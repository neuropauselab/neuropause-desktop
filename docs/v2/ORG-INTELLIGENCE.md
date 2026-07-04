# V2.3 — Organization Intelligence

Adds continuous organization-health monitoring that emits governance-complete
findings through the **existing V2.1 delivery engine** — reusing V2.2's source
pattern. No new org service, scheduler, notifier, Founder AI, or Mission Brief.

## STEP 1 recon — reused, never duplicated
- `connectorStore.all()` → per-account `health` ('healthy'|'degraded'|'down') + status.
- `licenseValidator.getStatus(orgId)` → re-evaluated `LicenseEvaluation`
  (state 'valid'|'grace'|'invalid', `expiresAt`, grace days).
- `orgStore.usersFor()` + `workspaceStore.list()` → org size / workspace presence.
- `getEnterpriseTimeline()` → trailing-7-day activity + distinct AI sources.
- **DeliveryEngine (V2.1)** → org intelligence registers as one `IntelligenceSource`.

## Architecture
```
collectOrgHealthInputs()  ── reads REAL signals (connectors, license, org, timeline)
        │  OrgHealthInputs
        ▼
computeOrgHealth()  ── pure, documented 0..100 sub-scores + weighted overall
        │  OrgHealthScores
        ▼
deriveOrgFindings()  ── governance-complete findings when health drops / risks appear
        │  IntelligenceItem[] (with governance)
        ▼
deliveryEngine.register(orgIntelligenceSource)  ← existing V2.1 engine delivers
```

## Health model (STEP 3 — every calculation documented)
`packages/shared/src/types/orgHealth.ts`, pure functions, each 0..100:
- **connectorHealth** = healthy/total × 100 − errors×10; no connectors ⇒ neutral 70.
- **licenseHealth** = 100 if ≥30d runway; linear decay inside 30d; 0 if expired/invalid; 60 if unknown.
- **activity** = min(events,50)/50 × 100 (trailing 7d).
- **adoption** = activeMembers/members × 80 + (workspace ? 20 : 0).
- **aiUsage** = min(distinctSources,5)/5 × 100.
- **engineering** = briefing 0..1 × 100; unknown ⇒ 65.
- **reliability** = 100 − syncFailures×15.
- **operational** = execActive(60) + workspace(40).
- **security** = 0.5×license + 0.5×connector (heuristic proxy today).
- **overall** = weighted sum (engineering .16, reliability .16, license .14, activity/adoption .12, connector .10, aiUsage .08, security/operational .06).
- **band**: ≥80 healthy, ≥60 watch, ≥40 at-risk, else critical.

## Findings (STEP 4) — never fabricated, always evidenced
Emitted only when real: non-healthy overall band; invalid/expiring license (≤14d,
≤3d ⇒ critical); connector(s) in error; low adoption (<40 with members);
no activity this week; declining engineering (<50). A fully healthy org yields
**zero** findings.

## Governance (STEP 6)
Every finding carries evidence (e.g. `license.daysToExpiry=3`, `connectors.error=1`),
sourceSystems (licensing/connectors/organization/timeline/engineering), confidence
(0.7–0.95), reasoning, and recommendedAction — mapped into the shared
`IntelligenceItem.governance` added in V2.2.

## Delivery (STEP 5)
Registered as `organization-intelligence`, daily at the morning-brief time, on the
existing engine. Delivered via the existing desktop channel; deep-link
`enterprise/organization`. Critical findings (invalid license, ≤3d expiry) override
DND per the engine. Weekly/monthly cadences are future `register()` calls.

## Files changed
- `packages/shared/src/types/orgHealth.ts` (new) — the pure health model + band.
- `packages/shared/src/index.ts` — export orgHealth.
- `apps/desktop/src/main/enterprise/orgIntelligence.ts` (new) — collect inputs,
  derive findings, map to governance items, `orgIntelligenceSource(atMinutes)`.
- `apps/desktop/src/main/services/executiveDelivery.ts` — register the source (+import).
- `apps/desktop/src/main/enterprise/orgIntelligence.test.ts` (new) — 12 tests.

## Tests & verification
Desktop **559 passed** (12 new: health scoring across healthy/expired/expiring/
connector-error/no-connector cases, band mapping, and finding derivation with full
governance assertions + the healthy-org-yields-nothing case). Backend 168 passed.
Desktop + backend typecheck clean. Lint clean.

## Known limitations
- `security` is a license+connector heuristic; a dedicated security-signals feed
  (audit-log anomalies, scope changes) is a future increment.
- `activeMemberCount` uses a conservative activity proxy (per-member activity
  attribution is a follow-up when member-scoped events are available).
- Connector-failure/license signals are read at delivery time; a "since last run"
  diff to avoid resurfacing the same finding daily is a natural next step.
- Multi-org: scores the default org today; per-org iteration is a later increment.
