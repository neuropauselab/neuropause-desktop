# ERP — SESSION 3: MRP → PERSISTED PLANNED ORDERS

**Date:** 2026-09-01 · **Branch:** `cert/data-import-cst-integration` · **Base HEAD:** `be20953`
**Label:** TEST-VERIFIED · **Nature:** makes the requirements engine actionable. Additive; reuses the auto-reorder
drafting pattern + the Session 1 correlation spine; no frozen surface; no new IPC channel; no parallel domain model.

---

## THE GAP (verified)

NeuroPause has a real multi-level requirements engine — `runMultiLevelMrp` / `explodeBom` in shared, surfaced by
the BOM Explosions module, which computes a build's **total purchased-material requirements** and stores them
(`requirements` field). But it **terminated in counts**: nothing turned those requirements into actionable paper.
A planner could see "you need 15 of RM-1" but had to hand-key every purchase request. The engine was real; the
bridge to procurement was missing.

## WHAT WAS BUILT (reuse, not reinvent)

`modules/manufacturing/plannedOrdersSeam.ts` (new):
- **`deriveMrpDraftRequests(reportNumber, requirements, existingRequestNumbers)`** — a pure decision: which
  purchased requirements still need a draft PR. Deterministic PR number per `(explosion, sku)` —
  `PR-MRP-<reportNumber>-<sku>` — is the **idempotency key**: a requirement whose number already exists is skipped,
  so re-running never duplicates. Zero/blank lines are dropped; quantities rounded.
- **`generatePlannedOrders(explosion, ctx)`** — drafts a purchase request for every purchased requirement through
  the **Purchase Requests module's own validate hook** (a system-drafted DRAFT, exactly like the auto-reorder
  seam), so the existing human approval → PO conversion (and the budget control behind it) governs everything
  downstream. **Nothing is ordered automatically; paper is drafted automatically.** Each draft inherits the
  explosion's transaction correlation (Session 1 spine), so a planned order traces back to the build that caused it.
  Honest degradation: no Procurement module → a clear refusal, never a throw.

`modules/manufacturing/bomExplosionModule.ts` (wiring): a `generatePlannedOrders` action on the descriptor +
`runAction` dispatch — a per-record action that fits the framework's action model and reaches the UI through the
existing generic `enterprise:module.action` IPC (no new channel).

## DISCIPLINES KEPT

- **Drafts only, governed downstream** — every request is `status: 'draft'`; the human approval → PO flow is
  unchanged. The AI/engine proposes; it never orders.
- **Idempotent** — deterministic PR number per requirement; a second run drafts nothing new. *Tested.*
- **Correlated** — each draft carries the explosion's correlationId/causationId (Session 1). *Tested.*
- **Tenant-scoped + authorized** — posts through `ctx`; asserts the Purchase Requests write scope
  (`procurement:manage`), not manufacturing. *Tested.*
- **Honest no-op** — Procurement absent → a stated refusal, no throw, no draft. *Tested.*

## TESTS

`modules/manufacturing/plannedOrdersSeam.test.ts` — **6/6 pass**:
- Pure (3): deterministic per-requirement numbering; idempotency (skips an existing number); zero/blank filtering +
  rounding.
- Integration (3), through the REAL create/action handlers (products + BOM + explosion + purchase requests): an
  explosion of FG-1 ×5 over a BOM of 3×RM-1 → one **draft PR for 15 RM-1**, read back from the PR store, correlated
  to the explosion, authorized against `procurement:manage`; a second run drafts nothing new (idempotent);
  Procurement-not-wired → honest refusal, no throw.

| Check | Result |
|---|---|
| New seam tests (pure + real e2e) | **6/6** |
| Negative control (neuter `deriveMrpDraftRequests` → **4 failed**; restore byte-identical `c8668323…` → 6/6) | **load-bearing, proven** |
| Blast radius — all `src/main/enterprise` | **159 files / 1261 passed** |
| `tsc` node + web | **exit 0** |
| ESLint (seam + test + module) | **clean** |
| `electron-vite build` | **exit 0** |

## FILES CHANGED

```
NEW  src/main/enterprise/modules/manufacturing/plannedOrdersSeam.ts       pure decider + generatePlannedOrders
NEW  src/main/enterprise/modules/manufacturing/plannedOrdersSeam.test.ts  6 pins (pure + integration)
MOD  src/main/enterprise/modules/manufacturing/bomExplosionModule.ts      generatePlannedOrders action + runAction
NEW  certification/ERP-SESSION3-MRP-PLANNED-ORDERS-EVIDENCE.md            this document
```

## KNOWN LIMITATIONS / NEXT (recorded)

- **Purchase side only.** This drafts PRs for purchased requirements (the explosion's `requirements` are purchased
  leaves). Drafting **production orders** for manufactured sub-assemblies (`productionSequence` from the aggregate
  MRP) is the natural **Session 3b** — same drafting pattern into the Production Orders module.
- **Per-explosion, not aggregate netting.** This plans one build (a per-record action, which fits the framework).
  A cross-order aggregate MRP run (net across all demand at once) would need an aggregate entry point — a design
  question (new planning module vs a new IPC channel) recorded for a later slice; the per-explosion action is the
  framework-native, immediately-useful first realization.
- The drafted PRs are not yet counted as `incoming` supply by the aggregate MRP input (`collectPlanningModel` reads
  purchase orders, not requests) — irrelevant to this per-explosion action (its own idempotency key prevents
  duplicates), but to note when Session 3b wires the aggregate run.
