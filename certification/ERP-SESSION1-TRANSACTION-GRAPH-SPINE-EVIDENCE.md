# ERP — SESSION 1: CORRELATION_ID / CAUSATION_ID TRANSACTION-GRAPH SPINE

**Date:** 2026-09-01 · **Branch:** `cert/data-import-cst-integration` · **Base HEAD:** `f0ac6c1`
**Label:** TEST-VERIFIED · **Nature:** first seam of the autonomous ERP program. Additive; reuses the record
`metadata` bag + the existing lifecycle/funnel seams; no frozen surface touched; no readiness gate changed; no
parallel domain model.

---

## THE GAP (reproduced from source before any edit)

The correlation/causation primitives half-existed and were **not usable as a transaction graph**:

- The action context already carried `correlationId?` (`framework/enterpriseModule.ts:212`) and the lifecycle
  emitter propagated it (`framework/moduleRegistry.ts:292-308`) — but **only for Data-Plane import replay**, riding
  the *event*, never persisted onto the *record*, and there was **no `causationId` anywhere** (0 hits in the
  enterprise tree).
- Every cross-module conversion created its target with `{ title, fields, actor, now }` and **no `metadata`** — a
  grep for `metadata:` across all module files found only throwaway in-memory projections. So each record knew only
  its own document cross-reference (`sourceQuote`, `sourceOrder`, `referenceRecord`, `sourceRef`); nothing shared a
  single id across the SO→…→INV→GL chain.

Consequence, stated plainly: **"show me everything that happened to this sales order" — or "why is it delayed?" —
could not be answered from persisted data.** The document links existed; the transaction did not. (The pre-fix
behaviour is pinned as the negative control below: with the spine neutered, the trace returns nothing connected.)

## WHAT WAS BUILT (reuse, not reinvent)

**`framework/transactionGraph.ts`** (new, exported from the framework barrel) — the reusable spine:
- Four flat metadata keys (`correlationId`, `causationId`, `causedByModule`, `correlationRoot`) — persisted in the
  record's free-form `metadata` bag, the **sanctioned home for cross-cutting bookkeeping** (the record-store
  docstring reserves `fields` for validated module data and warns only against smuggling identity/scope through
  metadata; correlation ids are exactly what the bag is for).
- **`childCorrelationMeta(source, sourceModuleId)`** — the metadata patch for a record CAUSED BY `source`. Inherits
  the source's correlationId/root when it has one, else roots the transaction at the source. **The whole chain
  therefore converges on ONE correlationId with no back-writing** — a child derives the same value whether or not
  the root was ever stamped.
- **`rootMetaIfUnset(record, moduleId)`** — stamps a genuine origin as its own root, but returns `{}` (never
  clobbers) for a record already in a transaction.
- **`traceTransactionGraph(modules, correlationId)`** — reconstructs one transaction from persisted data: every
  record sharing the correlationId, plus the root resolved from the id's global ref, ordered **root-first by
  causation depth**. Read-only; makes no authorization decision and grants nothing (§2 #13 — it informs, it does
  not govern). Tenant isolation is inherited (each store is already scope-bound).

**Wiring — two shared funnels + the sales document chain** (chosen because the two funnels light up
movement- and GL-producing chains across *every* domain from a single edit each):
- `modules/inventory/postMovement.ts` — a movement inherits the correlation of the document that caused it (the
  `referenceModule`/`referenceRecord` the caller already supplies). One edit ⇒ every stock movement (sales ship,
  goods receipt, production consume/output, warehouse, maintenance) joins its source's transaction.
- `modules/finance/glPosting.ts` (`applyGlDerivedEntries`) — a journal entry inherits the correlation of the record
  it posts for (the `sourceModule`/`sourceRef` the derived entry already names). One edit ⇒ every GL posting
  (invoice, bill, movement→GL, payroll, credit/debit note, fixed asset) joins its source's transaction.
- `modules/sales/conversion.ts` — quote→order and order→invoice stamp the child (`childCorrelationMeta`) and root
  the origin (`rootMetaIfUnset`).

Best-effort throughout: an unresolvable reference simply leaves a record unstamped (still a valid ledger/GL entry).
No signature changed; the funnels already carried the source reference, so nothing downstream was disturbed.

## THE CONNECTED GRAPH, PROVEN END TO END (real ids)

Driving the REAL `convertToOrder` / `convertToInvoice` module actions + the REAL `postStockMovement` funnel + the
REAL inventory→GL bridge, one transaction now shares one correlationId with correct causation edges:

```
quote  (root)                      correlationId = sales-quotes:<quoteId>
 └─ order        caused-by quote   correlationId = sales-quotes:<quoteId>, causationId = <quoteId>
     ├─ invoice  caused-by order   correlationId = sales-quotes:<quoteId>, causationId = <orderId>
     └─ movement caused-by order   correlationId = sales-quotes:<quoteId>, causationId = <orderId>
         └─ journal (MOV-…) caused-by movement  correlationId = sales-quotes:<quoteId>, causationId = <movementId>
```

`traceTransactionGraph(registry.list(), correlationId)` returns all five, root-first. The correlationId flows to
the renderer for free: record `metadata` is already included in the CRUD DTO (`moduleRegistry.ts:474/482/511/554`),
so the UI readback path is real through existing IPC — **no frozen channel was needed.**

## DISCIPLINES KEPT (nothing weakened)

- **One correlationId per transaction** — inheritance, proven by a chain that converges (`childCorrelationMeta`
  pins). *Tested.*
- **Never overwrite an inherited chain** — `rootMetaIfUnset` returns `{}` for a record already in a transaction
  (so a quote raised from a lead keeps the lead's chain). *Tested.*
- **Deny-by-default / honest gaps** — an unresolvable source leaves the record unstamped, never a guessed id.
  *Tested (GL-not-wired, unknown-ref paths inherited from the funnels).*
- **Tenant-scoped** — the trace runs over scope-bound stores; a trace under another tenant returns `[]`. *Tested.*
- **Untrusted input** — correlation ids are system-derived from the main-resolved source record, never from AI
  output or a renderer payload (§2 #6/#13). *By construction.*
- **AI never governs** — the trace is read-only and grants nothing. *By construction.*

## TESTS

`framework/transactionGraph.test.ts` (14) — pure algebra + trace: globalRef round-trip, inherit-vs-root,
`rootMetaIfUnset` guard, root-first depth ordering, root-resolved-when-unstamped, fan-out at one depth, exclusion of
other transactions + deleted records, empty-id.
`framework/transactionGraphSpine.test.ts` (5) — REAL end-to-end through the actual modules/actions: quote→order→
invoice share one correlationId with correct causation; a shipped movement + its GL entry join the same
transaction; `traceTransactionGraph` reconstructs the whole multi-module transaction root-first; tenant isolation
(other tenant → `[]`); a directly-created order (no quote) becomes its own root.

| Check | Result |
|---|---|
| New spine tests (pure + real e2e) | **19/19** |
| Negative control (neuter `childCorrelationMeta` → run → **7 failed**; restore byte-identical, sha `734b3833…` → 19/19) | **load-bearing, proven** |
| Blast radius — all `src/main/enterprise` (every movement/GL/conversion producer + framework) | **157 files / 1253 passed** |
| Blast radius — external seam importers `src/main/medicalDevice` + `src/main/erp` | **10 files / 208 passed** |
| `tsc` node + web | **exit 0** |
| ESLint (all touched files) | **clean** |
| `electron-vite build` | **exit 0** |

Regression scope note: the full ~9,500-test suite exceeds this sandbox's per-command cap; the run above is the true
blast radius — the only production changes are the two shared funnels (`postStockMovement`, `applyGlDerivedEntries`),
the sales conversion, and the new framework helper, and every module that reaches them lives under
`src/main/enterprise`, `src/main/medicalDevice`, or `src/main/erp` (all green). No renderer code changed (metadata
already flows through the existing DTO), so the UI suite is not in scope.

## FILES CHANGED

```
NEW  src/main/enterprise/framework/transactionGraph.ts             the spine (keys, algebra, trace)
NEW  src/main/enterprise/framework/transactionGraph.test.ts        14 pure/trace pins
NEW  src/main/enterprise/framework/transactionGraphSpine.test.ts   5 real end-to-end pins
MOD  src/main/enterprise/framework/index.ts                        export the spine from the barrel
MOD  src/main/enterprise/modules/inventory/postMovement.ts         movement inherits its source's correlation
MOD  src/main/enterprise/modules/finance/glPosting.ts              journal entry inherits its source's correlation
MOD  src/main/enterprise/modules/sales/conversion.ts               quote→order→invoice stamp child + root
NEW  certification/ERP-MASTER-PLAN.md                              Phase 0 dependency-ordered backlog
NEW  certification/ERP-SESSION1-TRANSACTION-GRAPH-SPINE-EVIDENCE.md this document
```

## KNOWN LIMITATIONS / NEXT (recorded, per the master plan)

- **Session 1b** — the remaining ~18 hand-written conversions (procurement, manufacturing, warehouse, maintenance,
  CRM, projects) do not yet stamp correlation. They are mechanical: each adds `childCorrelationMeta(source,…)` to its
  create and `rootMetaIfUnset` to its source update, reusing this helper. The two funnels already carry correlation
  for every movement/GL entry those chains produce, so their *financial/physical* legs are already connected today;
  what Session 1b adds is the *document* legs (e.g. PR→PO→GR).
- No new IPC surface yet — the trace is a main-side service (for the intelligence layer / a future "explain this
  transaction" panel). The correlation ids are already visible to the renderer via the existing record DTO; a
  dedicated trace channel is a later, gated slice if a UI needs the assembled graph.
- The trace respects the modules passed to it; a caller wanting a read-permission-filtered graph passes the filtered
  module set (the system/intelligence caller passes `registry.list()`).

## MAP TO THE LEVEL-2 / LEVEL-3 TARGET

This is the operator's Level-2 `correlation_id` transaction envelope and Level-3 `causation_id` event lineage,
realized on the existing store: one id shared across a business transaction (Level-2), each record naming the single
record that caused it (Level-3 causation), reconstructable as a graph — the substrate the predictive/AI layer needs
to answer "why", attribute variance, and explain a delay, without ever granting the AI authority.
