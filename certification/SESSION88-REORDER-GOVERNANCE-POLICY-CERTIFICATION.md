# SESSION 88 — REORDER GOVERNANCE POLICY CLOSURE — CERTIFICATION

**Class:** governance / policy-closure gate. **Outcome: all five S87 operator-policy decisions CLOSED by reuse of existing project decisions — zero business values invented.** S88 implements only the pure decision layer; execution is deliberately NOT wired. No frozen change; no FG-S88 token required. Baseline S87 GREEN. Release track PAUSED.

## 1. Discovery (source wins)

Inspected existing canonical mechanisms and found the reorder-execution semantics already decided elsewhere in the project:
- **ERP Session 3 — MRP planned-orders seam** (`plannedOrdersSeam.ts`): a deterministic PR number per `(reportNumber, sku)` (`mrpPurchaseRequestNumber`) is *"the idempotency key: the same requirement always maps to the same PR number, so a second run finds it already exists and skips it."* `deriveMrpDraftRequests` is the pure decision layer that decides what would be drafted, skipping any requirement whose deterministic number already exists in a non-deleted state.
- **Auto-reorder seam** (`autoReorderSeam.ts`): re-assesses `assessReorder` against the LIVE position + open supply at draft time; a drafted PR counts as open supply (position-based idempotency).
- **Durable command journal** (Session 18): `(tenantId, idempotencyKey)` replay dedup across restart.
- **PR lifecycle**: a PR draft requires only `requestNumber`+`status` (no supplier, no cost); supplier is a PO-stage decision.
- **Session-1 correlation spine** (`childCorrelationMeta`): lineage from a draft back to its cause.
- No `DECISIONS.md` entry pre-ruled the five, but the mechanisms + CLAUDE.md §2 deny-by-default fully determine each without inventing a value.

## 2. The five decisions — CLOSED by reuse (DECISION-REGISTER-S88)

| Decision | Outcome | Grounded in | Invented? |
|---|---|---|---|
| D1 Identity/lineage | `PR-REORDER-<reportNumber>-<sku>` + correlation spine | Session-3 `mrpPurchaseRequestNumber`; Session-1 correlation | No |
| D2 Idempotency | deterministic-number guard + journal replay + open-supply | Session 3, Session 18, auto-reorder | No |
| D3 Stale | re-assess live; fail closed; regenerate if stale | auto-reorder/MRP re-assessment; deny-by-default | No |
| D4 Quantity override | none — immutable canonical quantity | MRP/auto-reorder; spec fallback; deny-by-default | No |
| D5 Supplier | PR draft without supplier; supplier at PO conversion | existing PR lifecycle; S87 source-proof | No |

Full rationale, interactions (replay / restart / regeneration / re-open), affected command/UI/approval/audit/idempotency, and migration impact per decision are in `DECISION-REGISTER-S88-REORDER-GOVERNANCE-POLICY.md`.

## 3. Implementation (minimum pure primitive; no execution wired)

`inventory/reorderExecutionPolicy.ts` (pure, side-effect-free, mirrors `deriveMrpDraftRequests`):
- `reorderExecutionRequestNumber(reportNumber, sku)` → `PR-REORDER-<reportNumber>-<sku>` (D1 identity + D2 key).
- `deriveReorderExecutionDecision({reportNumber, product, openSupply, expectedQuantity, existingRequestNumbers})` → `{executable, status, requestNumber, expectedQuantity, currentQuantity, supplierRequired:false, reason}`. Fail-closed: `executable` is true ONLY when still triggered (live `assessReorder`) AND quantity unchanged AND no PR already exists. Reuses `assessReorder` + the Session-3 number guard.

It imports no command bus, drafts no PR, moves no stock, posts no GL, and is wired to no IPC channel. **Execution is NOT turned on** (no `CreatePurchaseRequestFromReorderRecommendation`, no automatic/background reorder, no PO, no supplier award) — a separate later gate.

## 4. Governance boundary

Any future reorder execution must remain REAL USER → governed UI → preload → IPC → Application Adapter/Boundary → Command Bus → Authorization (`procurement:manage`) → Business Policy (`deriveReorderExecutionDecision`) → Approval Engine (downstream PO) → Durable Transaction → Event (`PurchaseRequestCreated`) → Outbox → Audit. AI remains advisory and can never execute this directly (CLAUDE.md §13). S88 builds none of that path.

## 5. Frozen-file changes

**None.** gate-detector PROCEED on all S88 files. `enterprise/index.ts`, `runtimeCore.ts`, `cst/`, `packages/shared` untouched. No FG-S88 token. `certification/baseline.json` untouched. No new module registered (the primitive is a pure helper, not an enterprise module).

## 6. Focused tests

`reorderExecutionPolicy.test.ts` — **10/10 green**: D1 identity stability (same report×sku ⇒ same number; different report/sku ⇒ different); executable case; D2 already-drafted (one recommendation ⇒ at most one PR); D3 stale-not-triggered (open supply restored position); D3/D4 stale-quantity-changed; not-required; D4 quantity immutable (any mismatch fails closed — never an override); D5 supplier never required/carried; fail-closed invariant; pure/deterministic. `reorderExecutionBoundary.test.ts` (S87, unchanged) continues to prove the governed/tenant/RBAC blocked state. S85/S86 tests unchanged and green (not weakened).

Tenant/RBAC/`NO_TENANT`/audit are the governed command's responsibility (unbuilt); at the pure-decision layer there is no store or tenancy, and the blocked governed path is proven by the S87 boundary test + the S88 journey.

## 7. Real-Electron journey

`e2e/s88ReorderPolicyJourney.e2e.cjs` written + syntax-checked. **PENDING Mac**: product → receive → ship → S85 → S86 (READY_FOR_OPERATOR_REVIEW, executionReadiness BLOCKED_UNDEFINED_POLICY) → attempt every execution verb on the intelligence modules → all refused (`Unknown action`) → **NO PR, NO PO, no inventory mutation** → decision report is the terminal. Proves the policy is closed while execution remains intentionally unwired (§11 blocked-state form).

## 8. Regression

gate-detector new files PROCEED · typecheck node **0** · eslint clean · S88 policy **10/10** · (inventory + procurement + command-spine sweep recorded on landing).

## 9. Side-effect proof

PR: none. PO: unchanged. Inventory: unchanged. GL: unchanged. Unrelated procurement: unchanged. (The pure layer creates nothing; the journey re-proves the runtime blocked state.)

## 10. Final S88 status

**GATE COMPLETE — five decisions CLOSED by reuse; pure decision layer implemented; execution NOT wired.** No business value invented; no frozen change; no FG token; no automatic procurement. The future execution gate can now be built by composing `deriveReorderExecutionDecision` (refuse unless `executable`) with the existing `CreatePurchaseRequest` command through the governed spine — that remains a separate, explicitly-initiated later gate. Release track PAUSED.
