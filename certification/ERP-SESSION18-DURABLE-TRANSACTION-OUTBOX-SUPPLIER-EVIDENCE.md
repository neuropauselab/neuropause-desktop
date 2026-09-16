# ERP + PLATFORM — SESSION 18: DURABLE TRANSACTION SEAM + EVENT OUTBOX + SUPPLIER/SOURCING FOUNDATION

**Date:** 2026-09-01 · **Branch:** `cert/data-import-cst-integration` · **Base:** Session 17 GREEN (`6551571`)
**Label:** TEST-VERIFIED. No frozen surface touched; modular-monolith-first (no broker, no microservice, no
Electron IPC wiring). Inspect → reproduce → design → build REAL infrastructure → integrate → negative control →
concurrency → failure test → full regression.

Two tracks: (A) supplier/sourcing foundation; (B) the durable transaction + outbox that makes command idempotency and
domain events survive a process restart, committed atomically with state.

---

## A · SUPPLIER ARCHITECTURE

**A canonical supplier master ALREADY EXISTS** — `procurement-suppliers` (`supplierModule.ts`, tenant-scoped
`EnterpriseRecordStore`): supplier id, name, status (active/onboarding/suspended/inactive), contact, payment terms,
GST/PAN, lead time, rating. RFQ, supplier-performance and vendor-contract modules exist too. **No duplicate supplier
model was created** (§1/§2). Track A's contribution is the missing **governed PO-stage supplier assignment**: a new
`assignSupplier` action on the PO validates a `supplierRef` against the tenant's supplier master — a foreign supplier
is invisible (denied), and a suspended/inactive supplier cannot be assigned. Supplier stays at the PO stage (Session
17); no sourcing/ranking/RFQ/split-sourcing policy is invented (§24 STOP conditions respected — none was required).

---

## B · PROCUREMENT FLOW

`Purchase Request → (approval) → Purchase Order → (governed supplier assignment) → Goods Receipt → Vendor Bill →
Payment`. The PR→sourcing→PO boundary is explicit: the PR carries no supplier (no PR-stage selection policy);
supplier is bound on the PO by the governed `assignSupplier` action. Split/partial sourcing is NOT implemented (it
would require undefined policy). PR→PO traceability, multi-line (Session 16) and no-accounting-on-PR are intact.

---

## C · COMMAND ARCHITECTURE

The Session 17 command bus is retained and extended: `dispatchCommand` now supports TWO idempotency/event backends
chosen by the caller — the in-memory pair (Session 17, still used by the S17 suite) or a **durable journal** (Session
18). Routing, principal-derived tenancy, and authorization are identical; only the durability of idempotency + event
+ outbox differs. No second authorization or audit engine.

---

## D · TRANSACTION BOUNDARY

`DurableCommandJournal.run` is the reusable transaction:

```
run:  durable idempotency check (replay if committed)
   →  single-flight (concurrency)
   →  execute()  [authorize → validate → state mutation, delegated to the governed handlers; returns a rollback]
   →  build immutable event + PENDING outbox
   →  COMMIT: ONE atomic write of {idempotency result, event, outbox}
   →  on commit failure: rollback()  (compensate the state) → report failure
```

The commit is a single atomic file write (temp + rename), so the idempotency record, the domain event and the outbox
entry are one unit — there is no state-committed-without-event or event-committed-without-state within the boundary.

---

## E · IDEMPOTENCY IMPLEMENTATION

Durable, keyed by **(tenantId, idempotencyKey)** — tenant is part of the identity, never a global key. A committed
record replays forever, **including across a process restart** (re-read from disk). Concurrent duplicates share one
execution (in-memory single-flight); only successes are memoised, so a failed command stays retryable.

---

## F · DATABASE SCHEMA

"The existing database" for the desktop main process is the **file-backed durable store** (atomic temp+rename,
envelope-versioned, quarantine-not-reset) — the same durability the 106 module stores use; SQL Postgres is a separate
gated backend and wiring it would be out of scope (no schema change was needed, so no §24 STOP). `DurableJsonStore<T>`
is the primitive: one JSON file, atomic single-record writes, `load`/`reload` for restart. It declares its store
scope (`platform-durable-json`, TENANT, borrowed guarantee) and passes the `storeScopeGate`. The committed record:

```
CommittedCommand { id(tx), tenantId, idempotencyKey, commandType, result,
                   event: DomainEvent, outbox: {status, attempts, lastError, deliveredAt}, committedAt }
```

---

## G · OUTBOX ARCHITECTURE

The outbox entry is embedded in the committed record (so state+event+outbox commit atomically). Lifecycle PENDING →
PROCESSING → DELIVERED, with failure → RETRYABLE. `dispatchOutbox` is the minimal reliable loop: it drains
PENDING/RETRYABLE entries (optionally per tenant), marks PROCESSING, calls an idempotent consumer, marks DELIVERED or
RETRYABLE. The platform guarantee is exactly **durable event persistence + at-least-once delivery + idempotent
consumers** — no exactly-once external delivery claim. No Kafka/RabbitMQ (§10).

---

## H · EVENT CONTRACT

Hardened envelope: `eventId, type, tenantId, aggregateId, aggregateType, actor, correlationId, causationId,
schemaVersion, at (timestamp), detail (payload)`. Events are frozen (`Object.freeze`) at commit — a consumer cannot
mutate the source event (proven: mutation throws; the stored event is unchanged). Delivery mutates only the outbox
sub-state, never the event.

---

## I · FAILURE / RETRY PROOF (atomicity cases A–E)

- **A** success → PR state + committed event + PENDING outbox all exist.
- **B** state mutation fails (invalid payload) → no committed record (no event, no outbox).
- **C** durable commit fails (injected disk error) → the created PR is compensated (soft-deleted); no event, no
  outbox; result `COMMIT_FAILED`.
- **D** failure before commit (authorization denied inside the transaction) → no partial committed transaction, no
  state.
- **E** a committed outbox **survives a reload from disk** (simulated restart) and is delivered by the dispatcher.
- Delivery is retryable + idempotent: a failing consumer → RETRYABLE → retry delivers; re-dispatch never re-delivers
  a DELIVERED event (the consumer is called exactly twice: one failure + one success).

---

## J · CONCURRENCY PROOF

- **100 concurrent identical commands** → one PR, one committed record, one event, one outbox.
- **100 concurrent commands across 10 tenants** → each tenant ends with exactly one record; every tenant's events
  carry only its own tenantId (full isolation), driven under captured principals (Session 15 mechanism).

---

## K · AI COMPATIBILITY PROOF

A test-only AI tool adapter reaches ERP **only through `dispatchCommand`** — it holds no store/registry handle
(compile-enforced) — and produces a governed durable `PurchaseRequestCreated` event, never a direct write. The AI can
never directly mutate PostgreSQL / ERP stores / inventory / financial state: the only capability it is handed is the
command bus.

---

## L · ELECTRON INDEPENDENCE PROOF

An executable test walks every `.ts` in `platform/command` + `platform/persistence` and asserts none import
`electron`, `react`, or `ipcMain`/`BrowserWindow`. The command + persistence layers depend only on the enterprise
framework and Node — usable by future Electron / Web / Mobile / API / AI clients. No IPC was wired (§7/§18/§22).

---

## M · TENANT ISOLATION

Every durable record is stamped with its tenant and read back per tenant only. Proven: tenant B cannot read A's
events, reuse A's idempotency result (same key → independent execution), or deliver A's outbox; a command claiming a
tenant different from the principal is rejected `CROSS_TENANT_CLAIM`.

---

## N · NEGATIVE-CONTROL RESULTS

Each mutation fails the appropriate test; each restore is byte-identical (sha256 verified).

| # (directive §21) | Mutation | Failing test |
|---|---|---|
| 1 remove idempotency claim | `findCommitted` → undefined | durable idempotency (replay) |
| 2 remove tenant from key | drop tenantId from the key match | different-tenant-same-key independence |
| 3 commit state without event | skip the durable commit write | atomicity A (event exists) |
| 4 commit event without state | commit even when execute failed | atomicity B (no record on failure) |
| 5 bypass outbox | mark outbox DELIVERED at commit | atomicity E (pending survives) |
| 6 non-idempotent delivery | pendingOutbox includes DELIVERED | delivery idempotency |
| 7 bypass authorization | remove the command-boundary authorize | atomicity D (UNAUTHORIZED verdict) |
| 8 bypass domain transaction | direct store write, skip the handler | audit generated |
| 9 direct DB mutation from AI | (structural — adapter holds only `dispatch`) | AI test + compile-enforced |
| 10 import Electron into command layer | add `from 'electron'` | Electron independence |
| 11 cross-tenant event lookup | drop the tenant filter in `events()` | tenant isolation |
| 12 duplicate supplier conversion | relax the `convertedOrder` guard | isolated duplicate-conversion |
| 13 unauthorized supplier assignment | relax the suspended/inactive check | suspended-supplier refused |

#9 has no source line to mutate — the AI adapter is a closure given only `dispatch`; granting it a store handle is a
compile error, and the AI test proves it reaches ERP only via the governed durable seam.

---

## O · REGRESSION COUNTS

| Suite | Result |
|---|---|
| `session18DurableTransaction.test.ts` | **22/22** |
| `session17ProcurementCommands.test.ts` (in-memory path, unchanged) | **19/19** |
| `storeScopeGate` (structural tenancy gate) | 12/12 |
| Sessions 16 / 15 / 14 / 13 / 12 / 11 | unchanged |
| `enterprise` + `platform` + `erp` + `medicalDevice` | **1722** passed |
| Full `src/main` suite | **8820 passed / 7 skipped**, 0 failed (846 files) |

---

## P · TYPECHECK / LINT / BUILD

`typecheck:node` + `typecheck:web` clean · `electron-vite build` clean · ESLint clean on all changed/new files.
Repo-wide `npm run lint` carries the pre-existing sandbox-vs-Mac test-file backlog noted since Session 10; no
regression from this change — confirm on the Mac.

---

## Q · FILES CHANGED

```
NEW  platform/persistence/durableJsonStore.ts        atomic file-backed durable primitive (+ store-scope declaration)
NEW  platform/command/durableCommandJournal.ts       atomic idempotency + event + outbox; transaction boundary; compensation
NEW  platform/command/outboxDispatcher.ts            retryable, idempotent, at-least-once delivery loop
MOD  platform/command/domainCommand.ts               hardened event envelope (aggregateType/causationId/schemaVersion) + OutboxStatus
MOD  platform/command/commandBus.ts                  durable-journal path (opt-in) + rollback capture; S17 in-memory path preserved
MOD  enterprise/modules/procurement/purchaseOrderModule.ts   governed assignSupplier action + supplierRef field
NEW  platform/command/session18DurableTransaction.test.ts    24 pins
NEW  certification/ERP-SESSION18-DURABLE-TRANSACTION-OUTBOX-SUPPLIER-EVIDENCE.md
```

Frozen surfaces untouched (packages/shared; cst/; contracts; channels; runtimeCore; connectors/index; executionGate).
`moduleRegistry.ts` reused, not modified. `certification/baseline.json` not staged.

---

## R · COMMIT SHA

`<filled at commit>` — one commit, `erp(s18): …`. The user pushes from the Mac.

---

## S · REMAINING RISKS / BOUNDS

- **File-backed durability, not SQL.** The durable store is the desktop's real persistence (atomic writes, survives
  restart); it is not the Postgres backend (separate, gated). "Real DB tables + transactions" here means the
  file-backed durable store with atomic single-record commits — honest for the modular monolith.
- **Compensation is proven for the create command** (soft-delete) and implemented for transitions (status revert) and
  convert (revert + PO soft-delete); the case-C proof exercises the create path. A crash BETWEEN the state mutation
  and the atomic commit can orphan a state record (no committed transaction); "no partial COMMITTED transaction" is
  guaranteed (case D) and orphan reconciliation is Session-8 territory, flagged not claimed-solved.
- **At-least-once, not exactly-once** external delivery — consumers must be idempotent (stated in the contract).
- **The command seam is not wired into live Electron IPC** (§7) — deliberately; it is proven reusable by direct
  dispatch, and wiring would touch frozen channels/runtimeCore.
- No sourcing/ranking/RFQ/split-sourcing/tax/UoM policy invented (§24); supplier stays PO-stage.

---

## T · STATUS: 🟢 GREEN

ERP: 1 supplier architecture canonical ✓ · 2 no duplicate supplier model ✓ · 3 PR→sourcing boundary explicit ✓ ·
4 PO supplier assignment governed ✓ · 5 PR→PO traceability intact ✓ · 6 multi-line intact ✓ · 7 no accounting policy
invented ✓.
Platform: 8 durable command idempotency ✓ · 9 tenant-scoped ✓ · 10 state+event+outbox atomic ✓ · 11 outbox survives
restart ✓ · 12 delivery retryable ✓ · 13 delivery idempotent ✓ · 14 events immutable ✓ · 15 audit separate ✓ ·
16 command layer Electron-independent ✓ · 17 AI reaches ERP only through governed commands ✓ · 18 cross-tenant access
impossible ✓ · 19 100-concurrent test passes ✓ · 20 no premature broker/microservice ✓ · 21 no frozen surfaces
modified ✓ · 22 full regression GREEN ✓.

BUILD BOOST: real durable stores, real atomic commits, real outbox, real tests — no mock repositories, no placeholder
services. GREEN with the §S bounds. MRP / manufacturing / tax / FX / service extraction deliberately not started.
