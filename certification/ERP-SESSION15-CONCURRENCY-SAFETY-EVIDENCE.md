# ERP — SESSION 15: EXPLICIT CONCURRENCY SAFETY FOR CANONICAL CHART INITIALIZATION

**Date:** 2026-09-01 · **Branch:** `cert/data-import-cst-integration` · **Base:** Session 14 GREEN (`a59a5c7`)
**Label:** TEST-VERIFIED. No frozen surface touched; no accounting mapping changed; the customized-chart empty-only
policy unchanged. Reproduce → inspect → implement minimal fix → high-contention → negative control → multi-tenant
E2E → full regression.

Goal: make the concurrency safety of canonical control-account initialization an **explicit architectural
guarantee**, not an emergent property of the current synchronous implementation.

---

## A · CURRENT CONCURRENCY MECHANISM (before this session)

`ensureCanonicalChart` = `seedControlAccountsIfEmpty` (control, empty-only) → `ensureStockAccounts` (stock,
skip-existing). Each helper has exactly **one `await` — `store.load()`** — followed by a **fully synchronous
check-then-create loop**: read `count()` / build an `existing` Set → `hooks.validate` → `store.create` → `ctx.emit`,
none of which `await` (`create` sets a uuid-keyed in-memory map entry and schedules a *coalesced, un-awaited*
background persist). So on the single Node event loop, the first caller past `load()` runs its whole create loop to
completion before any other caller resumes — hence concurrent calls could not double-create.

This is the model Session 14 relied on and documented as "emergent from synchronous critical sections, not a lock."

---

## B · ROOT CAUSE / RISK

The safety was **real but implicit**: it held only because nothing `await`s between the existence check and the
`create`. A single future refactor — an async validate, an awaited emit, an `await` inserted mid-loop — would split
the critical section and let two concurrent callers both observe "empty / missing" and both create, silently
producing **duplicate canonical accounts**. Nothing asserted the property, nothing failed when it broke, and the
persistence layer has **no tenant+code uniqueness constraint** to catch it downstream (see §D). "Do not assume
synchronous behavior is permanently safe."

---

## C · FINAL SYNCHRONIZATION ARCHITECTURE

An **explicit, in-memory, tenant-keyed single-flight latch** wraps initialization. Least-complex mechanism
consistent with the architecture — the product is single-process / single-event-loop with one in-memory store
instance per module, so a process-local latch is the whole boundary; **no distributed lock, no infrastructure
dependency** (a distributed lock would be unfounded complexity here).

```
ensureCanonicalChart(ctx)
  tenantId = ledgerStore.resolvedScope()?.tenantId      // the store's OWN write boundary — key == where writes land
  if (!tenantId) return                                  // unresolved scope → DENY (store denies writes anyway); never coalesce distinct callers under one empty key
  coalesceCanonicalInit(tenantId, run)
     ├─ existing = map.get(tenantId); if (existing) return existing     // ← the ONLY synchronous critical section now (2 lines, pinned)
     ├─ promise = (async () => { try { await run() } finally { map.delete(tenantId) } })()
     ├─ map.set(tenantId, promise)
     └─ return promise
  run = async () => { await seedControlAccountsIfEmpty(ctx); await ensureStockAccounts(ctx); }   // control-first (S13/S14)
```

Properties, each pinned by test:

- **Same tenant, N concurrent → the init body runs EXACTLY ONCE**, and this holds *even when the body yields* — the
  guarantee is the latch, not synchronicity. The "must stay synchronous" surface is reduced from the whole
  multi-account seed loop to the two lines `get(existing) → set`, and that invariant is pinned.
- **Different tenants → independent**: distinct keys, no shared lock, no reuse of another tenant's work.
- **Exception-safe / retryable**: the key is deleted in `finally`, so a run that throws leaves nothing behind and
  the next call starts fresh — a failed init can never poison a tenant. Coalesced callers share the one outcome
  (all succeed, or all see the same failure).
- **Boot/activation-safe**: the key clears on completion, so repeated boot / activation / self-heal calls re-enter
  cleanly; the empty-only / skip-existing guards make the re-runs idempotent.

**Key derivation is drift-proof.** The latch key is the ledger store's own resolved tenant scope
(`EnterpriseRecordStore.resolvedScope()`, a new additive read-only accessor returning the same `scopeOrDeny()` every
read/write already uses), so the coalescing key and the account writes can never target different tenants — in every
path (session, boot fan-out, companion, sandbox) — without importing the `activeTenantScope` composition root into a
module file. Tenant-only key (not tenant+workspace): the chart of accounts is an organization-level registry (boot
seeds it tenant-wide, workspace `''`), matching `TenantDedupe`'s documented tenant-only reasoning.

---

## D · ACCOUNT-UNIQUENESS PROOF / DETERMINATION (§5)

**Inspected — there is NO persistence-layer tenant+code uniqueness constraint.** `EnterpriseRecordStore` keys records
by a random uuid; `code` is an ordinary field. The `ledgerAccountModule` docstring says "account codes are unique
(case-sensitive, trimmed)", but the `validate` hook is **stateless** (`validateEnterpriseRecordInput` + non-empty +
class-rule stamping; no store lookup) — the trim is enforced, the uniqueness is **not**. It is a JSON-file store, not
a database: **there is no schema/DB migration to modify, so no STOP is required.**

**Where a constraint could safely go, and why it is not added here:** a *general* tenant+code uniqueness constraint
would require either changing the framework `validate` hook signature to grant store access (a generic primitive
shared by all 106 modules — out of scope and risky) or a ledger-module-specific create guard (a broader integrity
feature = ERP-functionality expansion, which this session forbids). Not done; recorded in §M.

**For the CANONICAL accounts — this session's actual subject — uniqueness is EXPLICITLY PROVEN**, satisfying
acceptance #6 by the "explicitly proven" arm:

- **Concurrent** double-create is impossible → the single-flight latch: 100 concurrent `ensureCanonicalChart` →
  **exactly one** of each canonical code (pinned).
- **Sequential** double-create is impossible → the empty-only / skip-existing guards: sequential 3× → one set
  (pinned), and NC-6 proves that guard load-bearing (remove it → duplicates).

---

## E · HIGH-CONTENTION RESULTS

`ensureCanonicalChart` through the real scoped store, fresh (never-seeded) tenant:

| Contention | Result |
|---|---|
| 10 concurrent | exactly one canonical set · no duplicates · none of the 13 required canonical codes missing |
| 50 concurrent | exactly one canonical set · no duplicates · none missing |
| 100 concurrent | exactly one canonical set · no duplicates · none missing |
| sequential 3× | one set (guards, after the latch clears) |
| 100 concurrent inits **+ a first stock posting** | complete chart observed by the posting · GRNI accrues (10 @ 10 = 100) · no duplicate accounts against a partial chart |

Latch-primitive proof (independent of the store): 100 concurrent `coalesceCanonicalInit('T', body)` with a
*yielding* body → body runs **once** — demonstrating the guarantee does not depend on the body being synchronous.

---

## F · MULTI-TENANT RESULTS

Registry bound to the production principal-aware resolver (`resolveTenantScope(() => scope)`), so `runAsPrincipal`
captures each tenant's scope across awaits — the boot fan-out's exact mechanism — enabling **true** cross-tenant
concurrency (not a scope flipped between synchronous batches):

- **A×50, B×50, C×50 fired concurrently** → each tenant ends with exactly one independent canonical set; all three
  sets equal in size (none inflated by another tenant's rows, none starved); no duplicates within any tenant.
- Init under tenant A is **invisible** to tenant B (B reads an empty chart until it initializes its own).
- Negative boundary: an **unresolved scope** (`scope = null`) initializes nothing, throws nothing, and leaves no
  latch entry — a real tenant immediately afterward still initializes correctly (the null pass poisoned nothing).

---

## G · FAILURE / RETRY RESULTS

- Latch primitive: a throwing run → **all** coalesced callers reject with the one failure; `attempts === 1`; the key
  is cleared, so a subsequent good init runs and succeeds.
- Integration: a `store.create` that throws on first call → `ensureCanonicalChart` rejects, nothing half-committed is
  observable (chart empty), the latch clears, and a **retry seeds the full set with no duplicates**.
- Completion clears the key → later calls re-enter (no permanent memo); idempotency is then the guards' job.

---

## H · NEGATIVE-CONTROL RESULTS

Each mutation fails the appropriate test; each restore is byte-identical (sha256 verified equal to the pre-mutation
file).

| # | Mutation (directive §9) | Failing test |
|---|---|---|
| 1 | remove concurrency protection (`if (existing) return existing`) | latch: N concurrent → runs once |
| 2 | insert a yield between check and create (defer the `set`) | latch: N concurrent → runs once |
| 3 | remove the tenant key from the coalescer (global key) | latch: different tenants run independently |
| 4 | reuse another tenant's init promise (constant key at derivation) | multi-tenant: each tenant one independent set |
| 5 | suppress initialization errors (`catch {}` around `run`) | failure/retry: a failed init rejects all callers |
| 6 | bypass account-uniqueness protection (remove empty-only guard) | sequential 3× → one set (+ session13 + glAutoPosting) |

---

## I · REGRESSION COUNTS

| Suite | Result |
|---|---|
| `session15ConcurrencySafety.test.ts` | **12/12** |
| Session 14 / 13 / 12 / 11 (P2P + boot) | unchanged (8 / 7 / 11 / 16) |
| `src/main/enterprise` (blast radius incl. the framework-store touch) | **1375** (Session 14 1363 + 12) |
| Full `src/main` suite | **8765 passed / 7 skipped**, 0 failed (844 files) |
| `src/main/erp` + `src/main/medicalDevice` | **220** (unchanged) |

The full `src/main` suite was run because the change touches `EnterpriseRecordStore` (behind all 106 modules); the
new method is purely additive and no existing test changed behavior.

---

## J · TYPECHECK / LINT / BUILD

`typecheck:node` + `typecheck:web` clean · `electron-vite build` clean · ESLint clean on all changed/new files.
Repo-wide `npm run lint` carries the same pre-existing test-file backlog noted since Session 10 (sandbox-vs-Mac
config); no regression from this change — confirm on the Mac.

---

## K · FILES CHANGED

```
MOD  enterprise/framework/enterpriseRecordStore.ts   + resolvedScope(): TenantScope | null — additive, read-only (exposes the existing scopeOrDeny decision so the latch key == the store's write boundary)
MOD  enterprise/modules/finance/controlChart.ts      + coalesceCanonicalInit tenant-keyed single-flight latch; ensureCanonicalChart runs behind it; + __resetCanonicalChartLatchForTests
NEW  enterprise/modules/finance/session15ConcurrencySafety.test.ts   12 pins (latch primitive · 10/50/100 contention · racing posting · A/B/C×50 true concurrency · failure/retry · unresolved-scope boundary)
NEW  certification/ERP-SESSION15-CONCURRENCY-SAFETY-EVIDENCE.md
```

Frozen surfaces untouched (packages/shared, cst/, contracts.ts, channels.ts, runtimeCore.ts, connectors/index.ts,
executionGate.ts). `certification/baseline.json` not staged.

---

## L · COMMIT SHA

`<filled at commit>` — one commit, `erp(s15): …`. The user pushes from the Mac.

---

## M · REMAINING RISKS / BOUNDS

- **General account-code uniqueness is still unenforced** at the store/module layer (docstring vs enforcement gap,
  §D). It is *not* required for the canonical-chart guarantee (latch + guards) and adding a general constraint is
  ERP-functionality expansion — deliberately out of scope. Recommend a future ledger-module create guard if operator
  duplicate-code prevention is desired; it would need its own session (does it reject, or quarantine? interaction
  with the customized-chart policy?).
- **The one remaining synchronous invariant** is the latch's `get(existing) → set` (two lines). It is pinned (NC-2),
  and far smaller than the previous "the entire multi-account seed must stay synchronous."
- **In-memory, per-process latch** — correct for this single-process product. If NeuroPause ever runs the store in
  multiple processes sharing one file, this latch would not coordinate across processes; that is a different
  architecture and would need file-level or DB-level coordination (flagged, not present today).
- Session 13/14 bounds carry forward: activation hook is best-effort (the posting-seam control-first ensure is the
  deterministic backstop); customized-chart empty-only policy preserved.

---

## N · STATUS: 🟢 GREEN

1. Canonical chart initialization has an explicit concurrency guarantee (tenant-keyed single-flight latch). ✓
2. Same-tenant concurrent calls converge to exactly one canonical account set (10/50/100 proven). ✓
3. Different tenants remain completely independent (A/B/C×50 true concurrency). ✓
4. Initialization failure is retryable (latch cleared in `finally`; integration + primitive proven). ✓
5. First transaction racing initialization remains safe (no partial chart observed). ✓
6. Account uniqueness explicitly proven for the canonical set (latch + guards). ✓
7. Customized-chart empty-only policy unchanged. ✓
8. No accounting mappings changed. ✓
9. No frozen surface changed. ✓
10. Negative controls prove the concurrency boundaries (6/6). ✓
11. Existing ERP/P2P/security regressions remain GREEN (full main 0 failures). ✓
12. Typecheck, lint, build clean. ✓

GREEN with the explicitly-stated bounds in §M. Session 16 not started.
