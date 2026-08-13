# Program 13C — Sandbox + Conversation Remediation Report

**Starting commit:** `79bdac1` (the prompt named `c258c1b`; `79bdac1` is that commit plus
the previous report markdown — verified by `git diff --stat`: one file, **zero code changes**)
**Final commit:** `282bd09`
**Branch:** `feat/understanding-holds-motion-system`
**Working tree:** CLEAN

## Verdict

| Finding | Status |
|---|---|
| **N3 — Sandbox tenancy** | **FIXED** |
| **N7 — Assistant conversations** | **FIXED** |
| **N9 — workspace `active()` fallback** | **FIXED** (both halves — see below) |
| **N10 — federation identity** | **FIXED** (the first attempt was incomplete; the sweep caught it) |

**HIGH tenant findings remaining: 0.**

That number is the output of a fresh independent sweep run *after* the fixes,
which also found **four new HIGH** — all of them fixed in this commit, and
re-verified. MEDIUM: 2 open. LOW: 3 open. All named below.

| Gate | Result |
|---|---|
| Tests | **703 files / 7047 tests, exit 0** (from 699 / 6995) |
| Typecheck | green, per workspace |
| Lint | green |
| Desktop build | green |
| Backend build | **GREEN** — verified natively on macOS (`tsup` → `Build success`). The CI-sandbox failure was an esbuild host/binary version skew from running macOS-installed `node_modules` under Linux, not a code fault; confirmed after the fact. |

---

## N3 — Sandbox

### The problem was the data model, not the queries

`SandboxWorkspace` had no `orgId` or `tenantId`. Scenarios, executions,
artifacts and datasets all hang off a workspace id, so nothing downstream could
be scoped **even in principle**. A post-query filter was not available as an
option.

### The trap

Every sandbox record already has a `workspaceId` — and it is a **sandbox**
workspace (`sbw_…`), a completely different namespace from
`TenantScope.workspaceId`, which is an enterprise workspace. Passing these
records to `recordInScope` unchanged would have compared `sbw_…` against an
enterprise workspace id and denied **everything** — which looks exactly like
working isolation right up until someone notices the product is empty.

Ownership is therefore **tenant-level** and the code says why. A sandbox
workspace is a container for an organization's test assets; scoping it to one
enterprise workspace would make a scenario vanish when the user switched
workspaces inside the same organization, which is not what the product means.

### What changed

**The seam lives on the shared base class.** All five stores extend
`PersistentStore`, so `bindScope` / `requireTenant` / `mine` / `onlyMine` /
`countOwnership` went there — one implementation instead of five that drift, and
a sixth store added later starts out **denying**.

- Eight persisted types plus `SandboxEvent` gained optional `tenantId`. Optional
  so pre-P13C files parse; absent means **unresolved — visible to nobody**, never
  back-filled to the active or first organization.
- Writes stamp from the resolved tenant and **throw** when none resolves. Reads
  filter. A foreign id reads as **absent** on workspace, scenario, execution,
  artifact and dataset — including the sharpest read in the subsystem,
  `artifacts.get`, whose `inline` carries a run's complete result and report JSON.
- Version, timeline and artifact-by-execution reads are gated on the **parent**,
  so one check covers three accessors and cannot disagree with `get`.
- **The optional-`workspaceId` bypass is closed.** An omitted field used to mean
  "every workspace on the install"; it now narrows *within* the tenant, and
  `history()`'s `total` is scoped too (it was an install-wide count).
- `ensureDefault()` returned **the first workspace on the install** — the
  `organizations[0]` fallback in another costume, so every tenant's default
  sandbox was whichever tenant created one first. Now first-of-mine, created
  lazily because at boot there is no tenant to own one.

### The executor

`pump()` deliberately still sees the whole queue via `allForEngine()`. Scoping it
would stall a tenant's runs until that tenant next acted — a stall dressed up as
isolation. What was wrong is that it then **ran** everything in the enqueuer's
context: tenant A calling `enqueue` started tenant B's queued executions inside
A's IPC call stack, and every store those runs touched resolved through A's
session.

Each run now executes under a principal built from **its own row** (the webhook
dispatcher's rule), and an **unowned** row is failed rather than run — visible,
rather than skipped and silent. Dataset attach resolves through the scoped
accessor, so B cannot attach A's fixture and read its rows through the run.

The `let workspaceId` in `buildSandboxExecutorBackend` — one process-wide memo of
the first sandbox workspace, into which every AI-QA session, perf-lab run and
validation pipeline for **every** tenant wrote forever — is now keyed by tenant
and fails closed.

---

## N7 — Assistant conversations

Conversation bodies carry assistant answers **synthesised from tenant data**.

- `list(null)` meant **no filter — every conversation on the install**, and the
  schema makes `workspaceId` nullable *and* optional, so `{}` was a valid payload
  that returned everything. It now means "mine", and there is deliberately no
  argument that widens it.
- `get(id)` took a bare id, so knowing a uuid was the authorization.
- `upsert` was a **write-side IDOR**: a caller who knew an id could overwrite
  another tenant's title and message history.
- The channels were on the **PUBLIC allowlist** — no auth, no permission. They
  are now under `dashboard:read`, the universal signed-in scope this codebase
  already uses for per-user surfaces whose owner is resolved server-side.
  `assistant:ask` and `assistant:cancel` remain public deliberately.

The store closes the cross-tenant path; the allowlist change closes the
unauthenticated one. Both, because either alone leaves a layer.

---

## N9 — `workspaceStore.active()`

Two halves, and fixing only one would have been worse than obvious.

1. **Read time.** `?? this.workspaces.values().next().value` — the first
   workspace on the install, across every organization, returned verbatim by
   `EnterpriseWorkspaceActive`, which declares no permission. Now returns
   `Workspace | null`; the handler throws rather than substituting.
2. **Load time.** The same guess, one moment earlier:
   `this.activeId = this.workspaces.keys().next().value`. Fixing only the
   accessor would have left the pointer already aimed at a stranger before
   anything read it. It now prefers the seeded default, or leaves the pointer
   unresolvable so both accessors report nothing and the user is asked to choose.

---

## N10 — Federation identity

**The first attempt was incomplete, and the sweep said so.** `homeOrgId` was
typed `string`, so a "resolve per call" comment sat above a value that was still
evaluated once at boot. The readers are now **functions**. And the service
memoised the whole federation snapshot, invalidating only when a *backing store*
changed — switching organizations changes none of them, so the memo survived the
switch and kept serving the previous tenant's home identity. It is now dropped on
the existing workspace-switch residue seam.

This matters because `homeOrgId` is not a label: `federationModel` compares it
against `artifact.publisherOrg` to decide which **private** exchange artifacts
are visible.

---

## The fresh sweep (Phase 35) — four new HIGH, all fixed

Run independently after the four fixes. It verified N3, N7 and N9 as complete,
flagged N10 as incomplete, and found:

| # | Finding | Severity | Status |
|---|---|---|---|
| H1 | `ValidationRunStore` never bound and `ValidationRun` had no tenant — `get`/`all`/`recent`/`history` were raw array reads | HIGH | **FIXED** |
| H2 | `sandbox:validation.run.get` — the `outputs` cache keyed by runId alone, returning another tenant's certification report incl. **live executive KPI figures** and ready-made exports | HIGH | **FIXED** (keyed by `(tenant, runId)`) |
| H3 | `sandbox:validation.summary` returned every tenant's run history — and the runIds that unlock H2 | HIGH | **FIXED** |
| H4 | `sandbox:validation.dashboard` — same, plus trends over other tenants' data | HIGH | **FIXED** |
| M1 | `current` — one module-level `let`, so B was told A had a pipeline running and handed its runId | MEDIUM | **FIXED** (per tenant) |
| M2 | `BenchmarkStore` unbound and untenanted; a **baseline is copied verbatim** into the next run's regression findings, so A's measured latency printed inside B's certification report | MEDIUM | **FIXED** |
| L5 | No boot invariant that sandbox stores are bound — `hasScope()` had **zero callers** | LOW | **FIXED** (`initSandbox` throws) |

**Why H1/M2 happened is the interesting part.** Both extend the same
`PersistentStore` as the five S1 stores and gained the same seam in the same
change. Nobody bound them, so they stayed open while their siblings closed —
and the accessor that would have caught it existed with no caller. That is now a
composition-time throw, not a convention.

### Still open

| # | Finding | Severity |
|---|---|---|
| M4 | Data Plane import-plan cache: `plans` keyed by `planId` with no owner; a leaked plan id lets another tenant preview the parsed rows or import that file into their own tenant. Mitigated only by the id being a uuid. Pre-existing, out of this session's scope | MEDIUM |
| L1 | `sandbox:scenario.create` / `dataset.create` accept a payload `workspaceId` without checking it is the caller's. The row is stamped with the caller's own tenant, so there is **no disclosure** — a scenario can be parked under a foreign `sbw_…` id. Write-side namespace pollution | LOW |
| L2 | `assistant:cancel` resolves an in-flight turn by conversation id with no tenant check, and remains public. Availability only — nothing is returned | LOW |
| L3/L4 | Execution and validation retention caps are **install-wide**, so a noisy tenant can evict another's history. Fairness, not disclosure; both now documented in-file | LOW |

---

## Regression tests (Phases 36–37)

**+52 tests**, two tenants and unique markers throughout.

| Suite | Tests | Covers |
|---|---|---|
| `sandboxTenancy.test.ts` | 22 | per-tenant list/get/count; cross-tenant id refused for all five object types (both directions); artifact **content** and scenario **spec** never leak; timeline gated; update/archive/delete refused; the optional-`workspaceId` bypass; unresolved and **unbound** deny; `ensureDefault` per tenant; a pre-P13C row visible to neither and **counted, not destroyed** |
| `sandboxValidationTenancy.test.ts` | 10 | run get/history/recent/count scoped; `update` cannot overwrite another tenant's run; benchmark baseline never crosses; a tenant with no measurements has **no** baseline rather than borrowing one; unbound denies |
| `assistantConversationTenancy.test.ts` | 15 | `list()`/`list(null)` mean mine; marker-leak check; `get` both directions; ownership on create; delete refused; **`upsert` cannot overwrite by id**; unresolved/unbound deny; pre-P13C row invisible to both |
| `workspaceFallbackTenancy.test.ts` | 5 | active resolves; **stale persisted pointer returns null**, not the first workspace; fresh store's seeded default is legitimately its own; agrees with `activeWorkspaceIdOrNull`; federation empty-home admits no private artifact |

One of these caught a scenario `archive()` I had left unscoped — a real miss,
found by the suite rather than by review.

Existing suites that had to name a tenant, exactly as ~40 sites did when
`EnterpriseRecordStore` started denying in P11: 10 sandbox/lab/validation
harnesses and 3 conversation-store suites.

Tenancy suite total: **22 files / 340 tests**.

---

## Migration inventory (Phase 39)

Updated in code, truthfully:

- `sandbox (workspaces / scenarios / executions / datasets)` — was
  `REQUIRES_MIGRATION`, now **PARTIAL**. Not `COMPLETE`, because pre-P13C rows
  remain unresolved and the retention caps are still install-wide.
- `sandbox validation runs + perf benchmarks` — **new entry**, PARTIAL, recording
  that it was missed by the first sweep and why.
- `assistant conversations (conversationStore)` — was `REQUIRES_MIGRATION`, now
  **PARTIAL**, with `assistant:cancel` named as the residue.

`HIGH = 0` is stated nowhere in the inventory as a headline, because the
inventory reports per store and the summary is computed from the rows.

---

## Known limitations and out-of-scope items

- **Retention caps are install-wide** (executions, validation runs). A noisy
  tenant evicts another's history. Fixing it means a per-tenant budget — a
  capacity design, not a boundary.
- **Pre-P13C sandbox and conversation rows are invisible to everyone.** Data is
  preserved and counted as unresolved, never destroyed and never adopted.
- **Out of scope, unchanged, and not claimed fixed:** webhook signing secrets
  remain plaintext in `webhooks.json`; Tier-4 infrastructure clients accept
  user-supplied base URLs without `redirect: 'error'` and carry no app-tenant
  concept.
- **The filesystem remains the honest limit.** Every tenant's records share one
  mode-0600 JSON file per module. A privileged local user reads all of them and
  bypasses every boundary above. No OS-level isolation is claimed.

---

## Stop condition

**HIGH TENANT FINDINGS = ZERO.**

Per the gate, the next program may begin: two-tenant E2E, concurrency,
performance, final red team. **None of those phases were started in this
session** — this was remediation only, and mixing the two is what the stop
condition exists to prevent.

Two MEDIUM and three LOW findings remain open and are listed above. None is a
cross-tenant read or write of customer data: M4 requires a leaked uuid, L1 is
write-side pollution with no disclosure, L2 and L3/L4 are availability and
fairness.
