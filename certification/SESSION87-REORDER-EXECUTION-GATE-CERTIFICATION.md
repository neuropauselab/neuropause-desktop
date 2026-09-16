# SESSION 87 — GOVERNED REORDER EXECUTION DESIGN & OPERATOR-CONFIRMATION GATE — CERTIFICATION

**Class:** discovery / governance / execution-readiness gate. **Determination: STOP at decision-readiness.** No execution command built; no automatic procurement; no policy invented; no frozen change; no FG-S87 token required. Baseline S86 GREEN. Release track PAUSED.

## 1. Canonical `runReorderCheck()` execution trace

`runReorderCheck(productRecord, ctx, trigger)` (`inventory/autoReorderSeam.ts`): resolves the PR module via `ctx.moduleFor`, computes `openSupplyForProduct` (open PRs + POs), runs `assessReorder`; if triggered, builds a PR via `requestsModule.hooks.validate` + `store.create` (`status:'draft'`, quantity = `suggestedQuantity`) and `ctx.emit('created')`. A DRAFT only — no PO, no stock, no GL. Its idempotency is soft: the draft counts as open supply so the next assessment stays quiet. Two governed entry points: the product `reorderCheck` action (`inventory:manage`, tenant, audit) and the movement reconciler (`autoReorder:'on'`). Neither is a renderer-to-store bypass. Full trace in DECISION-MEMO-S87 §1.

## 2. Source-wins findings

- The governed **PR-draft primitive already exists** in the command spine: `commandBus.ts` `CreatePurchaseRequest` → `authorize('procurement:manage')` → durable journal (idempotency + `PurchaseRequestCreated` event + outbox, atomic) → PR draft → audit → compensation. Confirmed `PERMISSION_FOR_COMMAND`/`EVENT_FOR_COMMAND`.
- A **PR draft requires no supplier and no cost** (`PURCHASE_REQUEST_DESCRIPTOR`: only `requestNumber`+`status` required; no supplier field).
- **S85 and S86 modules expose no `actions`/`runAction`** — structurally non-executing; the framework refuses any action on them (`"Unknown action"`).
- **No renderer surface** wires a recommendation/decision to PR creation.
- Quantity source is `assessReorder.suggestedQuantity`; demand/lead-time/MOQ/EOQ do not modify it.

## 3. Execution-policy matrix

Full 17-row matrix in DECISION-MEMO-S87 §3. Summary: DEFINED — who may execute, no-approval-for-draft, downstream approval chain, order-value calc, missing-cost/supplier for a draft, quantity source, demand-does-not-modify. UNDEFINED — MOQ / order multiples / EOQ / lead time (absent); operator quantity-override policy; **recommendation identity/lineage**; **recommendation-scoped idempotency** (one recommendation → at most one PR); **stale-recommendation policy**; supplier at reorder time (no product→supplier link).

## 4. Whether governed execution is safe

**Not as a reorder-recommendation-driven action.** The generic PR-draft primitive is safe today, but promoting it to a *reorder execution* requires recommendation identity, recommendation-scoped idempotency, and a stale-recommendation policy — all undefined. Without them, two operator confirmations create two PRs with no stale re-check (the exact duplicate/stale hazard §3/§6/§7 require closed). CLAUDE.md §2 + the S87 HARD RULE forbid inventing them for GREEN. → **STOP at decision-readiness.**

## 5. Implementation performed

None to the execution path (correctly). Added: `DECISION-MEMO-S87-REORDER-EXECUTION-SEMANTICS.md`, `reorderExecutionBoundary.test.ts` (proves the blocked state), `e2e/s87GovernedReorderExecutionJourney.e2e.cjs` (proves the blocked state in the real runtime), this certification. No command, no module, no action, no UI execution surface.

## 6. Frozen-file changes

**None.** gate-detector PROCEED on all S87 files. `enterprise/index.ts`, `runtimeCore.ts`, `cst/`, `packages/shared` untouched. No FG-S87 token requested (none needed). `certification/baseline.json` untouched.

## 7. Focused tests — 8/8 green (`reorderExecutionBoundary.test.ts`)

Structural: decision + recommendation descriptors declare no actions; the existing execution primitive is the product `reorderCheck` action (`inventory:manage`), separate from the intelligence modules; the governed PR-draft command exists and is `procurement:manage`. Governed path: a READY_FOR_OPERATOR_REVIEW report drafts no PR; every plausible execution verb on the decision module is refused (`Unknown action`) with no PR/PO created; the recommendation module refuses execution too; report generation mutates no procurement/inventory records.

## 8. Real-Electron journey

`e2e/s87GovernedReorderExecutionJourney.e2e.cjs` written + syntax-checked. **PENDING Mac** (proven-blocked form per §10): product (purchaseCost 4) → receive → ship → S85 recommendation → S86 decision (READY_FOR_OPERATOR_REVIEW, executionReadiness BLOCKED_UNDEFINED_POLICY) → attempt every execution verb on the decision + recommendation modules → all refused (`Unknown action`) → **NO PR, NO PO, no inventory mutation** → decision report is the terminal.

## 9. Regression

gate-detector new files PROCEED · typecheck node **0** · eslint clean · S87 boundary **8/8** · (broader inventory + procurement + command-spine sweep recorded below).

## 10. Duplicate/idempotency proof

N/A for a built command (none built). The relevant proof is that no execution occurs at all: no PR is created by any decision/recommendation action attempt (unit + journey). The undefined recommendation-scoped idempotency is exactly why no execution command is built (DECISION-MEMO-S87 §4–§5).

## 11. Tenant/RBAC/security proof

The intelligence modules remain read-only, tenant-scoped, `inventory:read`/`inventory:manage` (S85/S86 certs). No new authority surface introduced. The existing governed execution primitives (`reorderCheck` product action `inventory:manage`; `CreatePurchaseRequest` command `procurement:manage`) are documented, not altered.

## 12. Exact PR-side-effect proof

PR: **none created**. PO: unchanged. Inventory: unchanged. GL: unchanged. Unrelated procurement records: unchanged. (Unit + journey.)

## 13. Remaining operator decisions

To unblock a future execution gate, an operator ruling is needed on: (1) recommendation identity/lineage; (2) recommendation-scoped idempotency + re-open condition; (3) stale-recommendation policy; (4) quantity-override policy; (5) supplier-at-reorder confirmation. With those ruled, a `CreatePurchaseRequestFromReorderRecommendation` command would reuse the existing spine verbatim (`procurement:manage`, durable journal, `PurchaseRequestCreated`, outbox, audit) plus the ruled checks. DECISION-MEMO-S87 §7.

## 14. Exact commits

Non-frozen S87 discovery + boundary evidence: one commit (recorded on landing). No frozen commit.

## 15. Final S87 status

**GATE COMPLETE — STOP at decision-readiness (source-proven).** Governed reorder execution as a recommendation-driven action is not policy-complete; the required semantics are undefined and were not invented. The execution path is proven blocked (8/8 focused + real-Electron journey pending Mac). No command, no frozen change, no FG token, no automatic procurement. S86 decision-readiness remains the terminal until the §13 operator decisions are ruled. Release track PAUSED.
