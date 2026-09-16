# FG-S83 — Register the governed Budget Variance module

**Gate class:** additive module registration in the frozen composition root `enterprise/index.ts`.
Mirrors how every ERP module was registered (budgetModule, apAgingModule, S81 inventory-aging/atp). **Frozen footprint = 4 additive lines in ONE frozen file. No other frozen surface.**

## The literal token required (nothing frozen changes without this, verbatim)

```
AUTHORIZED: FG-S83 — register finance-budget-variance module in enterprise/index.ts (2 imports + 1 registerModule line), per gate doc
```

Note: this module needs **1** `registerModule` line (not 2). Wording kept explicit so the token matches the actual diff. Silence / enthusiasm / "looks good" is NOT consent — only the exact token above.

## The verbatim diff (additive only)

**File:** `apps/desktop/src/main/enterprise/index.ts` (FROZEN)

**(a) Import** — after the existing budget instance import (line 138, `import { budgetModule } from './modules/finance/budgetModuleInstance';`):

```ts
import { budgetVarianceModule } from './modules/finance/budgetVarianceModuleInstance';
```

**(b) Registration** — immediately after `registerModule(budgetModule); // Finance → Budgets …` (line 1278):

```ts
  registerModule(budgetVarianceModule); // Finance → Budget Variance (immutable point-in-time portfolio variance register; reads budgets + posted journals, mutates nothing, posts no GL)
```

That is **2 additive lines total** (1 import + 1 registerModule). No type, channel, contract, runtimeCore, or Executive Center change.

## Threat analysis (both directions)

- **Grants:** one READ-ONLY immutable snapshot module reachable through the *existing* `enterprise:module.*` channels + existing UI. RBAC `operations:read`/`operations:manage`; tenant-scoped by `EnterpriseRecordStore`. No new channel/authority/tenant resolver.
- **Mutation surface:** none in the books — it only writes its own immutable snapshot records (regeneration refused). It READS the injected budget + journal + account stores. Pinned: books byte-identical after a snapshot; account balances unchanged; **no GL posted** (no governed post-variance command exists).
- **AI reach:** none — no AI path writes budget/GL/finance stores; AI may only read the resulting governed intelligence through existing read channels.
- **Removing it:** reverting the 2 lines removes the module; nothing else imports the instance except this registration.

## Verification plan (after the token)

1. Change-control choreography: gate-detector INTACT (enterprise/index.ts the only frozen file) → apply the 2 lines → suites green → isolated frozen commit. `certification/baseline.json` custody-protected — not re-recorded/staged.
2. Full main suite + full UI suite + typecheck node/web + eslint + build.
3. Real-Electron journey `e2e/s83BudgetVarianceJourney.e2e.cjs`: create accounts → create budget → post journal (actual) → generate variance register (budget/actual/variance/health) → deterministic regeneration → tenant isolation → books read-only + no GL mutation.
4. No push/tag/notarize; release track PAUSED.

## Non-frozen work already landed (this commit, gate-detector PROCEED)

- `finance/budgetVarianceModel.ts` — pure portfolio aggregation over `deriveBudgetActuals`.
- `finance/budgetVarianceModule.ts` + `budgetVarianceModuleInstance.ts` — governed immutable snapshot module.
- `finance/budgetVariance.test.ts` — 14 focused tests (green).
- `DECISION-MEMO-S83-BUDGET-VARIANCE.md`.

**⛔ STOP: no frozen edit until the exact FG-S83 token arrives.**
