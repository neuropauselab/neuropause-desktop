# ERP — SESSION 8: CRASH RECOVERY, COMPENSATION DURABILITY, RECONCILIATION

**Date:** 2026-09-01 · **Branch:** `cert/data-import-cst-integration` · **Base HEAD:** `4f26e3b`
**Label:** TEST-VERIFIED · No new accounting policy (recovery enforces the all-or-nothing Option A already chosen in
#104). Reuses the Session 6 reversal + existing durable state; no new state store; no full-ledger scan.

---

## ROOT CAUSE

The Session 7-Fix multi-line seam posts movements first and finalizes the document status LAST. So an interrupted
run (process crash) can leave durable inconsistency, and nothing reconciled it on restart:
- **Interrupted post** — some line movements posted (with GL) while the document is still `draft`.
- **Interrupted compensation** — the document is `failed` but not every posted line was voided yet.
- **Lost finalization** — every line posted, but the status write was lost (document still `draft`).

There was no recovery/reconciliation hook for the enterprise multi-line transactions (the M365 reconciler is a
different track).

## CRASH SCENARIOS REPRODUCED + PERSISTENT STATES OBSERVED

Each window is reproduced by constructing the exact durable state a crash leaves, then reconciling:

| Case | Constructed state | Observed → Recovered |
|---|---|---|
| A/B — crash mid-post | 1 of 2 line movements posted, doc `draft` | orphaned posted movement + `draft` → **COMPENSATED**, net 0, doc `failed` |
| C/F — crash during compensation | doc `failed`, one line void + one still posted | partial compensation → **finished**, net 0, all void |
| D — compensation of L1 done, crash before L2 | same shape as C | **finished**, net 0 |
| E — all posted, status write lost | both movements posted, doc `draft` | **COMPLETED** (finalized to `received`, work preserved, net +78) |
| Production START crash | order `released` with a posted consumption | **COMPENSATED** (WIP restored, order stays `released`) |

## RECOVERY ARCHITECTURE

`modules/inventory/multiLineRecovery.ts` — reconciles from EXISTING durable state (document status + `lines`; the
document's movements found by `referenceRecord`; the Session 6 `MOV-<id>-REV` reversal). No new persistent state and
no full-ledger scan — it scans the small document/order stores (bounded).

`reconcileTransaction(ctx, opts)` derives the consistent state deterministically:
- **declared success** (received/dispatched) → trusted (a later manual void is a legitimate reversal, not a crash).
- **declared rollback** (`failed`) with posted movements → finish the compensation.
- **non-terminal (draft) with posted movements** → COMPLETE iff every line is valid AND every line posted
  (finalize status); otherwise COMPENSATE (void every posted line, mark `failed`).

Derived recovery states: `NOT_STARTED · COMPLETED · COMPENSATED · RECOVERED_COMPLETED · RECOVERED_COMPENSATED` —
no new stored state machine (the existing document status expresses the outcome). Production START is reconciled by
`reconcileProductionStart` (its status machine reuses `released` for both pre-start and rollback). `recoverAll­
MultiLineTransactions(ctx)` runs receipt + dispatch + production recovery, wired best-effort at boot (mirrors the
existing migration-inventory background task; contained so it never blocks boot).

## COMPENSATION ARCHITECTURE

Compensation = `voidPostedMovement` (Session 6): sets the movement `void` (the reconciler excludes void from
inventory) and posts the append-only `MOV-<id>-REV` GL reversal. It is idempotent (a void movement is skipped; a
`-REV` is never posted twice) and now **authorized** (`inventory:manage`) so recovery can never become an
authorization bypass. Original movements are never mutated or deleted.

## RECONCILIATION INVARIANTS (executable)

- **Successful**: document terminal-success ∧ all movements posted ∧ no unintended reversals. (Pinned: a consistent
  received receipt is untouched by recovery.)
- **Failed**: document `failed` ∧ every posted movement compensated ∧ **net inventory = 0 ∧ net GL = 0**. (Pinned
  for receipt, dispatch, production.)
- **Interrupted compensation**: recovery deterministically finishes compensation → net 0. (Pinned.)

## IDEMPOTENCY EVIDENCE

`recover(T); recover(T); recover(T)` produces the same final state as `recover(T)`: net inventory 0, **exactly one**
`MOV-<id>-REV` per movement (never duplicated), document `failed` — pinned. Production recovery re-run is a no-op on
a now-`running`/recovered order. QA scrap re-run (×3) posts **exactly one** scrap movement (deterministic
`MV-QA-<inspection>-SCRAP` + `scrapMovement` guard) — no duplicate scrap on retry.

## INVENTORY ↔ GL CONSISTENCY

After recovery: for every posted movement exactly one primary GL effect; for every voided movement exactly one
`MOV-<id>-REV`; product on-hand is restored on compensation (pinned: stock 10 → 0), and the document status matches
its movement state (all void ⇒ `failed`). No movement remains financially orphaned.

## TENANCY / SECURITY EVIDENCE

Recovery runs within the caller's bound scope, so it only ever touches the active tenant's documents: a recovery run
under tenant B returns nothing for tenant A's transaction and leaves A untouched (pinned). Compensation is
authorized — a denied `inventory:manage` makes recovery throw rather than silently void (pinned negative case).

## NEGATIVE-CONTROL RESULTS

Disabling the compensation execution in `reconcileTransaction` → **4 recovery pins fail** → restored byte-identical
→ 11/11. (The authorization gate and idempotency guards are each additionally pinned by dedicated passing tests.)

## RESULTS

| Check | Result |
|---|---|
| Session 8 recovery tests | **11/11** (20-point matrix) |
| Session 7-Fix + Session 6 (re-run together) | **37 passed** — not regressed |
| Blast radius — all `src/main/enterprise` | **1321 passed** |
| `src/main/medicalDevice` + `src/main/erp` | **208 passed** |
| `tsc` node + web · ESLint · `electron-vite build` | clean |

## FILES CHANGED

```
NEW  modules/inventory/multiLineRecovery.ts        reconciler + production recovery + recoverAll (bounded, idempotent)
MOD  modules/inventory/multiLineMovements.ts        voidPostedMovement now authorizes (recovery is never an authz bypass)
MOD  enterprise/index.ts                            best-effort startup recovery hook (contained, mirrors migration task)
NEW  modules/inventory/multiLineRecovery.test.ts    the 20-point crash-recovery matrix (11 pins)
NEW  certification/ERP-SESSION8-CRASH-RECOVERY-RECONCILIATION-EVIDENCE.md  this document
```

## GATE CRITERION — MET

An interrupted multi-line ERP transaction cannot remain silently inconsistent: the system deterministically detects
and reconciles partially-posted or partially-compensated inventory/GL transactions — completing a provably-finished
post, otherwise rolling it back to net zero — with no duplicate movements, GL, reversals, or scrap, and with tenant
isolation and authorization enforced. **Session 8 GREEN.**

## REMAINING LIMITATIONS

- **Business-level, not database, atomicity/recovery**: recovery reconciles the durable *result* state; it is not a
  write-ahead-log rollback. A crash DURING a single `voidPostedMovement` (between the store write and the GL
  reversal) is bounded by the at-most-once `MOV-<id>-REV` idempotency — a re-run finishes it — but it is convergence
  by re-running, not a single-operation transaction.
- **Startup recovery runs in the active tenant scope**; multi-tenant hosts should re-invoke
  `recoverAllMultiLineTransactions` per tenant on activation (the function is exported and idempotent for that).
- Recovery covers the multi-line documents + production START + QA scrap; other single-movement domain actions were
  already idempotent (deterministic movement numbers + status guards) and are out of scope here.
