# DECISION MEMO — S83 Budget-Variance Intelligence: policy found vs undefined

**Class:** design/policy record for the S83 governed budget-variance intelligence layer.
**Headline:** every semantic S83 needs is ALREADY DEFINED in the repository — no policy was invented, and no STOP was required for the core. The undefined items are non-blocking, honestly-documented limitations (not faked, not crossed).

## Policy FOUND (reused verbatim — the source wins)

| Question | Canonical definition reused |
|---|---|
| Canonical budget source | Finance → Budgets (`budgetModule`, `finance-budgets`): budget master per ledger account per YYYY-MM period. |
| Canonical actual source | `deriveBudgetActuals` (`packages/shared/types/budgets.ts`): **net posted movement in the account's normal direction**, from POSTED journal entries only — never hand-entered. |
| Variance semantics | `deriveBudgetActuals`: `variance = actual − budget`, signed in the account's normal direction. |
| Percentage variance | `deriveBudgetActuals`: `variance / budget × 100`, **0 when budget is 0** (zero-budget behavior defined). |
| Favorable / unfavorable | `deriveBudgetActuals` health band (`on-track` / `over` / `under` / `no-actuals`), account-class-aware (expense over = unfavorable; revenue short = unfavorable). |
| Period convention | YYYY-MM month key (`isGlPeriodKey`), validated by `budgetModule`. |
| Threshold / exception | The budget module's `health` band (±tolerance around budget); `over` is the exception. Reused as-is; no new threshold. |
| RBAC | Finance scopes `operations:read` / `operations:manage` (the budget module's own scopes). |
| Tenant / audit / persistence | `EnterpriseRecordStore` (tenant-scoped `scopeOrDeny`) + the immutable-snapshot pattern (apAging / S81). |
| Accounting consequence | **NONE defined** — there is no governed "post variance" command. Therefore S83 posts nothing. Variance is analytical (accounting-safety rule honored). |

## Policy UNDEFINED — non-blocking, documented (NOT invented, NOT crossed)

1. **Cost-/profit-centre dimension.** The budget module states dimensions are "deliberately absent until the journal carries dimensions." S83 does not add a dimension — variance is per ledger account (+ period), exactly the model's granularity. Recorded as Tier-2, not faked.
2. **Currency normalization across budgets.** The budget/GL model carries **no currency dimension** (single-base-currency assumption). Portfolio totals are plain base-currency sums, and the snapshot note states this. Per-budget variance is currency-safe (budget and actual are the same account). No FX normalization is invented.
3. **Actual for non-GL domains** (procurement committed spend, inventory, project actuals) — no canonical "actual" is defined outside the posted GL. S83 therefore covers the **GL-backed budget domain only** (the one domain with a canonical actual). Other domains are out of scope, documented rather than invented.

## What S83 built (the missing intelligence layer, not a rebuild)

The budget module is a **live per-record master**; there was no **immutable, tenant-scoped, point-in-time portfolio variance register**. S83 adds exactly that — a governed snapshot module (`finance-budget-variance`) mirroring apAging / S81's inventory snapshots: it joins every budget master to its live `deriveBudgetActuals` and rolls them into an immutable register (totals + health counts + per-row projection). It reuses `budgetModule.store`, `deriveBudgetActuals`, the journal + account stores, `EnterpriseRecordStore` tenancy/RBAC, and the snapshot pattern. **No new KPI/persistence/notification/tenant/accounting/workflow/approval/event/dashboard engine.** Read-only w.r.t. all source stores; posts no GL.

## Frozen surface

One frozen touch: register the module in `enterprise/index.ts` (2 imports + 2 `registerModule` lines) — gated by the literal **FG-S83** token (`FG-S83-BUDGET-VARIANCE-REGISTRATION.md`). Everything else non-frozen. No Executive Center / `packages/shared` change (surfaced through the existing `enterprise:module.*` channels + generic UI, like S81's aging modules).
