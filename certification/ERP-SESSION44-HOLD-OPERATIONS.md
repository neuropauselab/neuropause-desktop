# ERP SESSION 44 — GOVERNED HOLD / RECONCILIATION OPERATIONS

**Gate:** S42-G2 · **Mode:** DISCOVER → BUILD → ATTACK → OPERATE
**Classification:** **GREEN** — a crash-orphaned governed command HOLD is safely and durably operator-actionable under the existing, already-defined governance policy; every invariant passes.
**Baseline HEAD:** `aa093d8` (`docs(erp-s43): expose governed sales order UI`) · branch `cert/data-import-cst-integration`
**Frozen surfaces:** UNTOUCHED (0 changes; gate-detector `PROCEED` ×4; `runtimeCore.ts` never edited). **External effects:** 0.

---

## 1 · BASELINE

HEAD `aa093d8`, branch `cert/data-import-cst-integration`. Working tree carried only the pre-existing `certification/baseline.json` modification (custody-protected, NOT staged) plus pre-existing untracked artifacts — none touched or staged. Typecheck + lint clean before work.

## 2 · EXISTING HOLD SEMANTICS (discovery)

Two things exist and are distinct:

- **The S40 journal HOLD** (`DurableCommandJournal`). Intent-first (S39 Option A): a durable `CommandIntent` is reserved BEFORE the domain effect; an unclean shutdown between reservation and the journal commit leaves it orphaned (a prior process's `bootEpoch`, no committed record), and boot reconciliation transitions it `IN_FLIGHT → HOLD`. A same-key dispatch then returns `RECONCILIATION_REQUIRED` — the command is **never silently re-executed**. This is a genuinely AMBIGUOUS command: the domain effect MAY or MAY NOT have run. The intent stores only `{ tenantId, idempotencyKey, state, bootEpoch, reservedAt, reason }` — **not** the command type or aggregate.
- **The canonical Hold / Decision mechanism** (`src/main/decisions/`). `HoldStore` (tenant-scoped, append-only) + `createHoldRaiser` (open hold → Decision Record → audit, deduped per subject) + `IpcChannel.HoldResolve` (`governance:manage`, audited) + `IpcChannel.HoldList` (`governance:read`) + `DecisionRecordStore` + the `HoldsView` UI. Its `HoldReason` already includes **`verification_unavailable` ("Cannot verify the outcome")** — the exact ABSENCE semantics of an ambiguous execution — and the **M365 `OUTCOME_UNKNOWN`** producer (`buildM365UnknownHoldInput` → `raiseHold`) is the working precedent for mapping an ambiguous governed execution onto it. **Resolving a hold records a governed decision (`proceeded` / `took_alternative` / `cancelled`) + a Decision Record + audit, and NEVER re-executes anything.**

**The gap:** the S40 journal HOLD was surfaced only in the journal's `.intents.json` (readable via `heldIntents`/S35), invisible to the operator's Hold Center — a fail-closed guard nobody could act on.

## 3 · POLICY DECISION — REUSE, no memo

The critical-safety question ("what should an operator do with an ambiguous command?") is **already answered by the existing mechanism**, and the M365 `OUTCOME_UNKNOWN` hold is the exact precedent. The resolution vocabulary (`proceeded` / `took_alternative` / `cancelled`) is a **recorded operator judgment**, not an action — resolving writes a Decision Record + audit and closes the hold; it re-executes nothing. That is precisely the required posture ("first establish an explicit governed decision"; "do NOT automatically execute"; "do NOT silently convert HOLD → SUCCESS"). **Policy exists → REUSE the mechanism whole. No `ERP-SESSION44-HOLD-DECISION-MEMO.md` was required, and none was written.** No resolution semantics were invented to make tests pass.

## 4 · OPERATOR AUTHORITY

The existing governance permission, reused unchanged (no new permission invented):

- `RUNTIME_CHANNEL_PERMISSIONS[IpcChannel.HoldResolve] === 'governance:manage'`
- `RUNTIME_CHANNEL_PERMISSIONS[IpcChannel.HoldList] === 'governance:read'`

Both are stamped in `ipc/runtimeAuthz.ts` and enforced by the secure bridge (`requireAuth` + channel permission) — the same two-layer gate every privileged runtime channel uses, so the subsystem cannot ship unclassified.

## 5 · EXACT UI PATH

```
Operator → Hold Center (HoldsView)
  → ipc HoldList (governance:read)                 → open holds incl. the surfaced held-command hold
  → operator reads: title · reason · what is KNOWN · what is NOT known · required decision
  → clicks a decision (proceeded / took the safer route / cancelled)
  → ipc HoldResolve (governance:manage, audited)   → HoldStore.resolve + DecisionRecord + audit
  → view refreshes from the backend → the hold shows RESOLVED with the recorded outcome
```
No new UI. The surfaced item is an ordinary `HoldRecord` the existing `HoldsView` already renders.

## 6 · EXACT GOVERNED BACKEND PATH

```
[boot / 60s cadence] serviceManager.startAll (already called by frozen runtimeCore)
  → heldCommandHoldService.tick
  → forEachTenantBackground('surface-held-command-holds')   [per tenant, under that tenant's own principal]
     → heldCommandIntentsFor(tenant)        [READ-ONLY view of the ONE production DurableCommandJournal]
     → for each held intent: raiseHold(buildHeldCommandHoldInput(intent))
        → HoldStore.open (dedupe by subject) → DecisionRecordStore.record → governance audit
```
The surfacing is READ + MAP only. It never resolves a hold, never touches the journal / intent / Sales Order / command bus. Resolution flows through the existing `HoldResolve` handler (§5).

## 7 · STATE-TRANSITION SEMANTICS

- Journal intent: `IN_FLIGHT → HOLD` (S40 boot reconciliation) — **permanent** fail-closed guard; a same-key dispatch stays `RECONCILIATION_REQUIRED` forever. S44 does **not** clear it.
- Operator hold: `open → resolved(outcome, note)` — a governed decision recorded on TOP of the journal guard. The two are deliberately separate: resolving the operator hold records a human judgment; it does not license a silent replay of the ambiguous command. Any legitimate follow-up is a NEW governed command (a new idempotency key) through the existing S43 path.

## 8 · SECURITY / TENANT PROOF

- **Authority:** HoldResolve = `governance:manage`, HoldList = `governance:read` (asserted against the authz map).
- **Tenant isolation (two tenants):** the journal reader is tenant-filtered (`heldIntents('tenant-B')` is empty for tenant-A's intent); the HoldStore is tenant-scoped (unbound denies, out-of-scope reads `[]`); surfacing runs under `forEachTenantBackground` so `raise` runs in the tenant's own principal scope. Tenant B sees no tenant-A hold and **cannot resolve tenant-A's hold id** (`resolve` returns `null`).
- **No renderer tenant authority:** the surfacing uses `run.scope.tenantId` from the server principal; the resolve path resolves tenant from the authenticated session — the renderer never supplies a tenant. A forged `claimedTenantId` never reaches this path.
- **AI cannot resolve directly:** resolution is only the `governance:manage`-gated `HoldResolve` channel; the AI holds no such permission and no direct store handle, and the surfacing service has no execution path.
- **Malformed fail-closed:** `HoldResolveRequest` is `.strict()` — a bad `outcome`, a missing `id`, or an extra field is rejected.

## 9 · CONCURRENCY PROOF

Reproduce-first + attack: two concurrent resolves against one hold → **exactly one** returns a resolved record, the other returns `null`; exactly ONE resolved row and ONE "Resolve hold" Decision Record. This is the existing `HoldStore.resolve` guarantee (a resolved hold refuses re-resolution) — reused, no new lock framework. Duplicate surfacing ticks → exactly ONE hold (dedupe by subject).

## 10 · RESTART / CRASH PROOF

- HOLD survives restart: a real crash-orphaned intent → HOLD, surfaced after a fresh-store reload.
- Decision survives restart: after resolve + flush, fresh `HoldStore`/`DecisionRecordStore` over the same files show the hold `resolved` (never re-presented as open) and the Decision Record present.
- **No silent ERP re-execution across restart:** after surface + resolve, a same-key `journal.run` STILL returns `RECONCILIATION_REQUIRED` — the S40 guard is intact.
- S38 stale-PROCESSING recovery and S40 intent recovery run unchanged (full suites green, §13); the surfacing is additive and read-only.

## 11 · AUDIT PROOF

Every resolution produces the existing governance audit `hold.resolved` (actor, subject/target, outcome + note) via the SAME `governanceStore` sink, plus the paired Decision Record (hold id, actor, subject, outcome, assessment, timestamp). Surfacing itself audits `hold.raised`. No second audit mechanism.

## 12 · UI PROOF

`session44HeldCommandHold.ui.test.tsx` mounts the real `HoldsView` over the real `initDecisions` handlers and a surfaced held-command hold (seeded exactly as the service raises it, `holds.open(buildHeldCommandHoldInput(...))`): it renders **"On hold · Cannot verify the outcome"** (never success), shows *What I know* (the command reference), *What I don't know* (**"whether the underlying business effect actually took place"**), and *What would resolve this*; and a decision click resolves it and writes a Decision Record. The ambiguous HOLD is never presented as successful.

## 13 · REGRESSION RESULTS

Sandbox is ~3.9 GB RAM / 4 CPU, so the full 961-file main suite is run on the Mac (it was green at S43 = 961f/10068p). Everything touched was run green here in memory-safe single-fork batches:

| Suite (`--pool=forks --singleFork`) | Result |
|---|---|
| S44 main test (isolated) | **12 / 12 passed** |
| S44 UI test (isolated) | **2 / 2 passed** |
| `src/main/decisions` + `src/main/platform` + `src/main/ipc` + `src/main/services` (incl. S38/S39/S40 crash-recovery, S31–S35 delivery ops, S32/S34 reads, the S44 suite) | **55 files / 563 passed** |
| `src/main/tenancy` + `src/main/reconciliation` (the fan-out + readback the service reuses) | **97 files / 1348 passed / 4 skipped** |
| Full UI suite `vitest.ui.config.ts` (incl. the S44 UI test) | **75 files / 421 passed** |
| typecheck (node + web) | **clean** |
| eslint (changed + new files) | **clean** |
| `electron-vite build` | **exit 0 (✓ built)** |

No existing test was weakened, skipped, or deleted. **Mac full-suite confirmation is the one external step.**

## 14 · FROZEN-SURFACE AUDIT

`runtimeCore.ts` is FROZEN and was **not** touched — the surfacing service is registered through the non-frozen `serviceManager.ts` array that frozen `runtimeCore` already `startAll`s (the same seam the read-back reconciler uses; zero frozen lines). gate-detector on all four changed production files → **PROCEED ×4**. `git status` shows no change under `packages/shared`, `cst/`, `runtimeCore.ts`, `contracts.ts`, or `channels.ts`. `certification/baseline.json` carries only its pre-existing modification and is not staged. **Zero frozen surfaces touched; no FG gate required.**

## 15 · ARCHITECTURE-SINGULARITY AUDIT

Confirmed — exactly one of each, no duplicates:
- ONE command bus, ONE Application Boundary, ONE **DurableCommandJournal** (`platformCommandIpc.ts:264`; S44 adds only a read-only `heldIntents` view of it), ONE intent/recovery mechanism, ONE outbox, ONE delivered sink, ONE `DurableJsonStore` primitive.
- ONE audit/governance mechanism (`governanceStore`), ONE canonical **Holds/Decision** mechanism (the `decisions/instances` singletons) — S44 constructs **no** HoldStore/DecisionRecordStore and adds **no** reconciliation engine, hold store, decision engine, or approval engine.
- No renderer filesystem authority (all new code is main-only). No AI direct execution (the service has zero execution path — no command bus, `.run`, `resolve`, `executeEngine`, `process`, `child_process`, or `fetch`).

## 16 · REMAINING GAPS

- **Full 961-file main suite** must be run on the Mac (memory-bound in this sandbox). Expected unchanged base + the 12 new main tests.
- **No automated ERP read-back oracle for held commands.** The intent stores only the idempotency key (not the aggregate), so the operator must manually investigate whether the interrupted command's effect landed. An ERP-domain read-back oracle (analogous to S16's M365 Sent-Items oracle) that reports whether the aggregate for a held key exists would make the operator's decision evidence-backed rather than manual — a real future gate, not a blocker.
- The surfacing service's composition root (`realDeps` over the live singletons) is exercised at runtime, not by a Node test (the same honest bound the read-back reconciler records); the per-tenant surfacing logic IS covered directly.
- Scope fence honored: only the surfacing + the existing resolution path; no new workflow, no automated reconciliation, no change to S43.

## 17 · RECOMMENDED NEXT GATE (ONE, not implemented)

**S45 = extend the governed-UI exposure to the next O2C write (recommended: `InvoiceSalesOrder` / `IssueCustomerInvoice`, or `ShipSalesOrder`).** S43 exposed exactly one governed write (`CreateSalesOrder`); every other O2C write still uses the non-governed module CRUD door. Extending the proven S43 pattern to the next step continues closing the S42-G1 exposure gap, is non-frozen and low-risk, and multiplies the value of the now-actionable governance (more governed writes ⇒ more crash-boundary safety that S44 makes resolvable). Runner-up: an **ERP-domain read-back oracle** for held commands (§16), which would upgrade held-command resolution from operator-investigated to evidence-backed.

---

*Evidence label: TEST-VERIFIED (real journal + real HoldStore/DecisionRecordStore/HoldResolve + real DOM). Full-main confirmation: PENDING on Mac (memory-bound in this sandbox). No external effects. No frozen surface touched.*
