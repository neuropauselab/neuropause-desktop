# FG-S84 — Register the governed Demand Trend module

**Gate class:** additive module registration in the frozen composition root `enterprise/index.ts`.
Mirrors every prior ERP module registration (orderModule, revenueForecastModule, S81/S83). **Frozen footprint = 2 additive lines in ONE frozen file. No other frozen surface.**

## The literal token required (nothing frozen changes without this, verbatim)

```
AUTHORIZED: FG-S84 — register sales-demand-trend module in enterprise/index.ts (1 import + 1 registerModule line), per gate doc
```

Silence / enthusiasm / "looks good" is NOT consent — only the exact token above.

## The verbatim diff (additive only)

**File:** `apps/desktop/src/main/enterprise/index.ts` (FROZEN)

**(a) Import** — after the existing revenue-forecast instance import (line 166, `import { revenueForecastModule } from './modules/sales/revenueForecastModuleInstance';`):

```ts
import { demandTrendModule } from './modules/sales/demandTrendModuleInstance';
```

**(b) Registration** — immediately after `registerModule(revenueForecastModule); // Sales → Revenue Forecast …` (line 1271):

```ts
  registerModule(demandTrendModule); // Sales → Demand Trend (immutable historical demand-by-month register from shipped/delivered shipments; analytical only, mutates nothing, posts no GL)
```

2 additive lines total (1 import + 1 registerModule). No type, channel, contract, runtimeCore, or Executive Center change.

## Threat analysis (both directions)

- **Grants:** one READ-ONLY immutable snapshot module reachable through the *existing* `enterprise:module.*` channels + existing UI. RBAC `operations:read`/`operations:manage`; tenant-scoped by `EnterpriseRecordStore`. No new channel/authority/tenant resolver.
- **Mutation surface:** none — it only writes its own immutable snapshot (regeneration refused); it READS the injected shipping store. Pinned: shipping store byte-identical after generation. No forecast, no reorder, no PR/PO/reservation, no inventory or GL effect.
- **AI reach:** none — no AI path writes any store; AI may only read the resulting governed intelligence.
- **Removing it:** reverting the 2 lines removes the module; nothing else imports the instance except this registration.

## Verification plan (after the token)

1. Change-control choreography: gate-detector INTACT (enterprise/index.ts the only frozen file) → apply the 2 lines → suites green → isolated frozen commit. `certification/baseline.json` custody-protected — not re-recorded/staged.
2. Full main + UI + typecheck node/web + eslint + build.
3. Real-Electron journey `e2e/s84DemandTrendJourney.e2e.cjs`: create product → receive stock → create + ship shipments (governed; canonical demand) → generate demand-trend register → governed read → deterministic regeneration → shipping store read-only. (Single-session shipments carry the current month via the governed `ship` action, so direction is honestly `insufficient-data`; multi-month direction is unit-proven.)
4. No push/tag/notarize; release track PAUSED.

## Non-frozen work already landed (this commit, gate-detector PROCEED)

- `sales/demandTrendModel.ts` — pure per-SKU per-month demand + threshold-free direction.
- `sales/demandTrendModule.ts` + `demandTrendModuleInstance.ts` — governed immutable snapshot module.
- `sales/demandTrend.test.ts` — 14 focused tests (green).
- `DECISION-MEMO-S84-DEMAND-TREND.md`.

**⛔ STOP: no frozen edit until the exact FG-S84 token arrives.**
