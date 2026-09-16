# FG-S85 — Register the governed Reorder Recommendation module

**Gate class:** additive module registration in the frozen composition root `enterprise/index.ts`.
Mirrors every prior ERP module registration (S81/S83/S84). **Frozen footprint = 2 additive lines in ONE frozen file. No other frozen surface.**

## The literal token required (nothing frozen changes without this, verbatim)

```
AUTHORIZED: FG-S85 — register inventory-reorder-recommendation module in enterprise/index.ts (1 import + 1 registerModule line), per gate doc
```

Silence / enthusiasm / "looks good" is NOT consent — only the exact token above.

## The verbatim diff (additive only)

**File:** `apps/desktop/src/main/enterprise/index.ts` (FROZEN)

**(a) Import** — after the existing S81 inventory instance imports (after line 223, `import { atpModule } from './modules/inventory/atpModuleInstance';`):

```ts
import { reorderRecommendationModule } from './modules/inventory/demandReorderModuleInstance';
```

**(b) Registration** — immediately after `registerModule(atpModule); // Inventory → ATP …` (line 1304):

```ts
  registerModule(reorderRecommendationModule); // Inventory → Reorder Recommendations (advisory reorder-attention register from the canonical reorder engine + demand trend; drafts no PR, moves no stock, posts no GL)
```

2 additive lines total (1 import + 1 registerModule). No type, channel, contract, runtimeCore, or Executive Center change.

## Threat analysis (both directions)

- **Grants:** one READ-ONLY, RECOMMENDATION-ONLY immutable snapshot module reachable through the *existing* `enterprise:module.*` channels + existing UI. RBAC `inventory:read`/`inventory:manage`; tenant-scoped by `EnterpriseRecordStore`.
- **Mutation surface:** none — it writes only its own immutable snapshot (regeneration refused) and READS product/PR/PO/shipping. Pinned: generating a recommendation drafts NO purchase request, creates NO PO, mutates NO product/inventory, posts NO GL. It does not import or call `runReorderCheck` (the execution seam).
- **AI reach:** none; AI advisory-only, no store access.
- **Removing it:** reverting the 2 lines removes the module; nothing else imports the instance except this registration.

## Verification plan (after the token)

1. Change-control choreography: gate-detector INTACT (enterprise/index.ts the only frozen file) → apply the 2 lines → suites green → isolated frozen commit. `certification/baseline.json` custody-protected — not re-recorded/staged.
2. Full main + UI + typecheck node/web + eslint + build.
3. Real-Electron journey `e2e/s85DemandReorderJourney.e2e.cjs`: product → inventory + demand history → generate reorder recommendation → governed read → deterministic regeneration → shipping/product read-only → **and the critical negative: no PR drafted, no PO created, no inventory moved, no GL posted.**
4. No push/tag/notarize; release track PAUSED.

## Non-frozen work already landed (this commit, gate-detector PROCEED)

- `inventory/demandReorderModel.ts` — pure recommendation over `assessReorder` + `openSupplyForProduct` + S84 demand.
- `inventory/demandReorderModule.ts` + `demandReorderModuleInstance.ts` — governed immutable recommendation register.
- `inventory/demandReorder.test.ts` — 14 focused tests incl. no-PR/PO/inventory-mutation (green).
- `DECISION-MEMO-S85-DEMAND-REORDER-SEMANTICS.md`.

**⛔ STOP: no frozen edit until the exact FG-S85 token arrives.**
