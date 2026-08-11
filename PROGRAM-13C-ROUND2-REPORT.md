# Program 13C — Remediation Round 2 (continuation)

**Starting commit:** `8e9bb90`
**Final commit:** `b82c049`
**Branch:** `feat/understanding-holds-motion-system`
**Working tree:** CLEAN

---

## Verdict

**The three targets of this session are FIXED and independently verified.**

**Program 13C is NOT ready for certification.** The mandated fresh sweep, run
after the fixes, found **3 new HIGH** in code no prior sweep had walked. Per the
stop condition: HIGH ≠ 0, so no certification claim is made.

| Finding | Status |
|---|---|
| H1 Automation rules | FIXED (previous session) |
| H2 Executive decisions | FIXED (previous session) |
| **H3 Workforce jobs + governance audit** | **FIXED** |
| **H4 Workflow runs** | **FIXED** |
| H5 ExecuteEngine sessions/history | FIXED (previous session) |
| H6 Relationship queue | FIXED (previous session) |
| H7 Platform read-model caches | FIXED (previous session, **partially** — see H-2) |
| **M-B Sandbox running set** | **FIXED** |

| Gate | Result |
|---|---|
| Tests | **710 files / 7156 tests, exit 0** (from 708 / 7128) |
| Tenancy suite | **29 files / 439 tests** |
| Typecheck | green, all 7 workspaces |
| Lint | green |
| Desktop build | green |
| Backend build | green (verified natively in an earlier session; unchanged here) |

---

## H3 — Workforce jobs, proposals, approval, audit

### The finding was not a read

`Job` had no owner and `JobStore.get()` took a bare id, which made every job's
`summary`, `evidence`, `logs` and `proposals` — a worker's output over the
tenant's connected data — readable across tenants under `workforce:read`, a base
role.

But `WorkerRuntime.decide()` resolves the job through that same `get()` before
approving a proposal, and **an approved proposal re-enters the ExecuteEngine**.
So one tenant could cause another tenant's action to *execute*. That is an
execution-authorization failure, and it is why the fix is one line in the store
rather than a check in every handler: scoping the accessor closes the path at its
root, where a future caller cannot route around it.

### What changed

- `JobStore` gained the `TenantOwnership` seam. `page()` filters before
  `workerId`/`status` narrow, so those filters cannot widen. `get()` denies a
  foreign id. `put()` refuses to replace a row it does not own — without that it
  was a write-side IDOR, since the runtime writes back through it on every state
  transition.
- Retention moved to `pruneOwn`: the cap was install-wide and oldest-first, so a
  busy tenant *chose* which of another tenant's jobs — and therefore which
  evidence — was destroyed.
- The governance audit needed the **opposite** treatment. Its array backs a
  tamper-evident hash chain, so the **output** is filtered and the array never
  is; filtering it would break `verifyIntegrity()` and destroy the property the
  log exists for. `verifyIntegrity` and `totalRecorded` stay deliberately
  install-wide — they are statements about the *chain*, not about anyone's
  records, and a per-tenant chain would be a weaker claim.

### Two things this fix broke, and then fixed

Worth recording because both are the shape where a security change quietly
becomes a correctness bug:

1. **Reference aliasing.** Stamping in `put()` by spreading into a new object
   broke the aliasing the runtime depends on — it holds a job reference, mutates
   it, and reads it back. Jobs stranded in `running`. Now stamped in place.
2. **`settleExecution` after a tenant switch.** It runs in a promise
   continuation *after* the approving IPC call returned, so switching
   organizations mid-execution made the scoped read return null and stranded the
   job until restart. That is precisely what `unscopedForRuntime` was built for,
   and it had **no production caller** until the sweep pointed this out. It is
   safe there because the id comes from the engine's own dispatch, not a caller,
   and the approval that authorized it was already gated.

---

## H4 — Workflow runs

`workflowRuns` was `Map<runId, …>`, install-wide. Three consequences, and only
the first is disclosure:

- `WorkforceWorkflowRuns` takes `EmptyRequest` and enumerated every tenant's runs
  **and their specs**.
- `Resume` *recovered* another tenant's failed run — replaying its unfinished
  branches.
- `Checkpoint` *approved* another tenant's human-approval gate.

Now `Map<tenantId, Map<runId, …>>`, **keyed** rather than filtered on read —
because a filter is something a future accessor can forget and a key is not.
There is no way to reach another tenant's entry without naming their tenant, and
the tenant is never taken from a payload.

---

## M-B — The last "omitted field widens"

`queueState()` filtered the engine's install-wide `running` set with
`workspaceId ? … : true`, so `{}` returned every tenant's running execution ids.
`pending` and `concurrency` were already scoped; this one line was the exception,
and it was the last surviving instance of the bypass this program removed from
four sibling stores. Each id is now re-resolved through the scoped accessor
first, so an omitted `workspaceId` means "every running execution of **mine**".

---

## Regression tests

**+28 tests**, two tenants throughout.

| Suite | Tests | Notable coverage |
|---|---|---|
| `e2e/workforceTenancy.test.ts` | 16 | page/get/filters/size scoped; foreign id indistinguishable from invented; **a cross-tenant approval dispatches NOTHING** (no session, no side effect); write-side IDOR on `put`; audit output scoped while the chain still verifies across both tenants; retention cannot evict the other tenant's oldest row |
| `e2e/workflowRunTenancy.test.ts` | 12 | EmptyRequest listing scoped incl. specs; cross-tenant resume and checkpoint start nothing; identical run ids in two tenants stay separate; `queueState({})` returns only the caller's running ids; A cannot cancel B's execution |

Four existing tests changed to reflect **genuine new semantics**, not to make
failures go away:

- Crash recovery now asserts through `unscopedForRuntime` (a crash orphans every
  tenant's jobs, so recovery must settle all of them) *and* asserts the
  pre-P13C row is invisible to any tenant and counted as unresolved.
- The legacy audit-file upgrade asserts `size() === 0` with
  `ownershipCounts() = {total: 3, assigned: 0, unresolved: 3}` — the rows are
  retained in the chain and shown to nobody.

---

## Fresh adversarial sweep — 3 new HIGH

Run independently after the fixes. It verified H3, H4 and M-B closed with a
line-by-line table, and found:

### HIGH — open

| # | Finding |
|---|---|
| **H-1** | `enterprise/processMiningProvider.ts:56` — an install-wide cache holding the materialised records of **13 tenant-scoped module stores** (leads, contacts, customers, quotes, orders, invoices, payments, purchase orders, goods receipts, stock movements, production orders, schedules). **No TTL and no invalidator** — unlike its two siblings in the same directory, which are both wired to `onWorkspaceSwitch`. `EnterpriseProcessCase` resolves a **payload caseId** against it with no ownership check. Its only guard is a 13-tuple count signature a tenant can deliberately collide. **The migration inventory claims this provider has a "~2.5s TTL". It does not — and that inaccurate line is why five sweeps walked past it.** |
| **H-2** | Eleven memoised projection services carry a tenant-derived snapshot across an organization switch: `autonomousOps`, `experience`, `commercial`, `orchestration`, `twin`, `intent`, `strategy`, `intelligenceNetwork`, and — with **no TTL at all** — `industry`, `ecosystem/developerPlatform`, `cloud/controlPlane`. The previous session fixed this exact pattern in nine platform subsystems and these eleven were not in that set. `autonomousOps` is sharpest: it copies job `summary` and `error` verbatim. |
| **H-3** | The developer / API-key / OAuth / billing-seat / gateway-audit surface is one install-wide partition pinned to `ORG_ID`. An earlier fix corrected only the *installs* store. `EcosystemKeysRevoke` and `EcosystemOAuthDelete` take a **bare payload id**; `releaseSeat` is a cross-tenant **write**. |

### MEDIUM — 9 open, 2 fixed here

Fixed in this commit because they were in code this session touched:

- **M-1** — `settleExecution` stranding jobs after a tenant switch (a regression
  introduced by the H3 fix, caught by the sweep).
- **M-3** — governance audit rotation was install-wide over rows that now carry
  an owner.
- **M-2** — `ExecuteEngine` history retention, same shape.

Open: **M-4/M-5** the startup gate covers **6 of roughly 26** bindable
tenant-sensitive stores, which is less than its own doc-comment claims;
**M-6** two live read models call `governanceStore.auditCount()` with no scope;
**M-7** gateway audit trail unscoped and IPC-reachable; **M-8** medical-device
record history reads every tenant's audit before filtering; **M-9** a `?? ''`
used as a match value rather than a deny.

### LOW — 7 open

`assistant:cancel`; `defaultOrg()` in a startup log line; workforce install
enable/disable by bare id; the inaccurate inventory TTL claim (L-4, which caused
H-1 to be missed); an empty-workspace principal matching pre-P11 rows; unbounded
growth of the per-tenant workflow map; the documented `'local'` sentinel.

**HIGH: 3, MEDIUM: 9, LOW: 7**

---

## What this session establishes about method

Six sweeps have now each found new subsystems the previous five had not walked,
and the count is not converging. This session adds two specific lessons:

1. **A documentation error concealed a HIGH for five sweeps.** The migration
   inventory asserted a TTL that does not exist, and every reviewer who checked
   that entry moved on. An inventory that can be wrong is a liability
   proportional to how much it is trusted.
2. **The startup gate is real but narrow.** `assertAllTenantStoresBound()` does
   make an unscoped *registered* store fail to boot — but only six stores
   register. Extending registration to all ~26 is worth more than another sweep,
   because it is the only measure whose coverage is verifiable by construction
   rather than by someone's reading.

### Before the next certification attempt

1. **H-1** — wire the process-mining cache to `onWorkspaceSwitch` and scope the
   `caseId` lookup. Fix the inventory line that hid it.
2. **H-2** — the eleven memos, same fix the nine platforms already received.
3. **H-3** — scope the developer/billing surface off `ORG_ID`.
4. **M-5** — register the remaining ~20 stores so the gate's claim becomes true.
5. Re-run the certification suites (they are unmodified and green), then a fresh
   sweep.

Program 13C remains the tenant operating security gate. It is not green.
