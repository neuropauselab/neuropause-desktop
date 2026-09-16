# FG-S86 — Register the governed Reorder Decision Readiness module

**Gate class:** additive module registration in the frozen composition root `enterprise/index.ts`.
Mirrors every prior ERP module registration (S81/S83/S84/S85). **Frozen footprint = 2 additive lines in ONE frozen file. No other frozen surface.**

## The literal token required (nothing frozen changes without this, verbatim)

```
AUTHORIZED: FG-S86 — register inventory-reorder-decision module in enterprise/index.ts (1 import + 1 registerModule line), per gate doc
```

Silence / enthusiasm / "looks good" is NOT consent — only the exact token above.

## The verbatim diff (additive only)

**File:** `apps/desktop/src/main/enterprise/index.ts` (FROZEN)

**(a) Import** — immediately after the existing S85 reorder-recommendation instance import (after line 224, `import { reorderRecommendationModule } from './modules/inventory/demandReorderModuleInstance';`):

```ts
import { reorderDecisionModule } from './modules/inventory/reorderDecisionModuleInstance';
```

**(b) Registration** — immediately after `registerModule(reorderRecommendationModule); // Inventory → Reorder Recommendations …` (line 1306):

```ts
  registerModule(reorderDecisionModule); // Inventory → Reorder Decision Readiness (decision intelligence over the canonical reorder recommendation + spend policy; drafts no PR, moves no stock, posts no GL, executes nothing automatically)
```

2 additive lines total (1 import + 1 registerModule). No type, channel, contract, runtimeCore, or Executive Center change.

## Threat analysis (both directions)

- **Grants:** one READ-ONLY, DECISION-INTELLIGENCE-ONLY immutable snapshot module reachable through the *existing* `enterprise:module.*` channels + existing UI. RBAC `inventory:read`/`inventory:manage`; tenant-scoped by `EnterpriseRecordStore`.
- **Mutation surface:** none — it writes only its own immutable snapshot (regeneration refused) and READS product/PR/PO/shipping. Pinned: generating a decision report drafts NO purchase request, creates NO PO, mutates NO product/inventory, posts NO GL, and reaches no execution path (`executionReadiness` fail-closed on every row). It does not import or call `runReorderCheck` (the execution seam).
- **AI reach:** none; AI advisory-only, no store access.
- **Removing it:** reverting the 2 lines removes the module; nothing else imports the instance except this registration.

## Verification plan (after the token)

1. Change-control choreography: gate-detector INTACT (enterprise/index.ts the only frozen file) → apply the 2 lines → suites green → isolated frozen commit. `certification/baseline.json` custody-protected — not re-recorded/staged.
2. Full main + UI + typecheck node/web + eslint + build.
3. Real-Electron journey `e2e/s86ReorderDecisionReadinessJourney.e2e.cjs`: product (with purchase cost) → inventory + demand history → generate reorder decision report → governed read → deterministic regeneration → shipping/product read-only → **and the critical negatives: no PR drafted, no PO created, no inventory moved, no GL posted, and execution blocked on every row.**
4. No push/tag/notarize; release track PAUSED.

## Non-frozen work already landed (this commit, gate-detector PROCEED)

- `inventory/reorderDecisionModel.ts` — pure decision-readiness over the S85 recommendation + `applicableSteps`/`DEFAULT_SPEND_POLICY` + canonical `purchaseCost`.
- `inventory/reorderDecisionModule.ts` + `reorderDecisionModuleInstance.ts` — governed immutable decision register.
- `inventory/reorderDecision.test.ts` — 16 focused tests incl. no-PR/PO/inventory-mutation + execution-blocked-on-every-row (green).
- `DECISION-MEMO-S86-REORDER-DECISION-SEMANTICS.md`.

**⛔ STOP: no frozen edit until the exact FG-S86 token arrives.**
