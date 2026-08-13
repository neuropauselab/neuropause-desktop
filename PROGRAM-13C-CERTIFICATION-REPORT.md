# Program 13C — Final Certification Report

**Starting commit:** `a425dea` (the prompt named `282bd09`; the difference is three
documentation commits — verified by `git diff --stat`: markdown only, **zero code**)
**Final commit:** `e7b5727`
**Branch:** `feat/understanding-holds-motion-system`
**Working tree:** CLEAN

---

# CERTIFICATION: **NOT CERTIFIED**

**Reason: 7 new HIGH cross-tenant findings**, discovered by the independent red
team required by Phase 33, in subsystems none of the three prior sweeps had
walked.

The gate's own rule applies: *if any new HIGH cross-tenant finding is
discovered, stop the certification.* It is stopped. The next
product-development program does not begin.

| Severity | Count | Change |
|---|---|---|
| **HIGH** | **7** | all new |
| MEDIUM | 7 | 6 new + L3/L4 raised from LOW |
| LOW | 5 | incl. M4 downgraded from MEDIUM |

**What this does not mean.** The work of the previous sessions holds: every
finding fixed in Parts 3a–3c and the two remediation sessions was re-verified and
none regressed. The two-tenant E2E built here passes completely. The failure is
one of **coverage**, not regression — seven subsystems were never in scope of any
prior audit, and they were never tenant-aware to begin with.

---

## Phase 0 — Baseline

| Gate | Result |
|---|---|
| Tests | 703 files / 7047 tests, exit 0 |
| Typecheck | green, per workspace |
| Lint | green |
| Desktop build | green |
| Tenancy suite | 22 files / 330 tests |

## Final gates

| Gate | Result |
|---|---|
| Tests | **706 files / 7100 tests, exit 0** (+3 files, +53 tests) |
| Tenancy suite | **25 files / 383 tests** |
| Typecheck | green, per workspace |
| Lint | green |
| Desktop build | green |
| Backend build | green (verified natively in the previous session; unchanged here) |
| Working tree | CLEAN |

---

# PART 1 — What the certification suites prove

### The fixture (Phases 1–2)

`tenancy/e2e/twoTenantFixture.ts` builds two real tenants across **fifteen
resource types** — CRM, ERP, HR and Finance records, documents, unified search
entities, graph nodes and edges, memory, notifications, audit, conversations,
sandbox workspaces/scenarios/executions/artifacts/datasets, validation runs and
benchmarks.

Three properties make it worth anything:

1. **One store instance, one file, two tenants inside it** — exactly what the
   product does. If isolation only held when tenants had separate files, it
   would not be isolation, it would be separate installs.
2. **`scope` is mutable and every store reads it through its binding.** Switching
   tenants in these tests is the same operation the app performs. Rebuilding the
   stores per tenant would discard the other tenant's rows and make every
   assertion pass for the wrong reason.
3. **Every record carries its tenant's marker** (`NP-TENANT-A-984731` /
   `NP-TENANT-B-472186`). So the strongest assertion is the whole-payload sweep,
   not any named `toBeNull()` — named assertions prove the paths someone
   imagined; the sweep catches the field nobody enumerated.

### Results

| Phase | Area | Result |
|---|---|---|
| 3 | Tenant A full journey | **PASS** |
| 4 | Tenant B full journey | **PASS** |
| 5 | Cross-tenant IDOR matrix, 15 types × 2 directions | **PASS** |
| 6 | Cross-tenant write matrix (update/delete/archive/re-version/overwrite) | **PASS** |
| 7 | Search isolation incl. counts and index-by-id | **PASS** |
| 9 | Memory isolation (id + content recall) | **PASS** |
| 10 | Graph isolation (direct node, traversal) | **PASS** |
| 11 | ERP/CRM/HR/Finance cross-domain composites | **PASS** |
| 12 | Documents incl. the content-hash oracle | **PASS** |
| 13 | Notifications + audit | **PASS** |
| 17–19 | Sandbox, validation, conversations | **PASS** |
| 20 | Tenant switch, both directions | **PASS** |
| 21 | Workspace switch | **PASS** |
| 22–23 | Switch races under concurrent load | **PASS** |
| 24 | Background concurrency (2 jobs × 25 await points) | **PASS** |
| 25 | Cache concurrency incl. the negative case | **PASS** |

Two assertions worth calling out because they test the *absence* of a
convenience:

- **A foreign id and an invented id are indistinguishable.** A distinct "not
  found" would be an existence oracle over another tenant's id space.
- **The cache suite asserts the collision too.** An id-only key is shown to
  overwrite one tenant's value with the other's, so the `tenantKey` fix is
  demonstrably not vacuous.

Phases 8 (AI), 15 (webhook transport) and 16 (connectors) were **not re-run
here**; they are covered by existing suites from earlier sessions
(`webhookEgressTenancy`, `companionEgressTenancy`, `fabricTenancy`,
`notificationTenancy`). Stated rather than counted as new evidence.

---

# PART 2 — Measured performance (Phases 28–31)

**Every number below is from a run of `tenantPerformance.bench.test.ts`. Nothing
is estimated.** In-process store reads on a temp filesystem — this is the cost
of the tenant boundary, not an end-to-end product benchmark, and the file says so.

### Tenant resolution — the one on every scoped read

| Measurement | n | p50 | p95 |
|---|---|---|---|
| `resolveTenantScope` (session path) | 5,000 | **0.0001 ms** | 0.0001 ms |
| `resolveTenantScope` (background principal) | 5,000 | **0.0001 ms** | 0.0002 ms |
| `tenantPrincipal` (build) | 2,000 | 0.0003 ms | 0.0003 ms |
| Tenant switch (assign + re-resolve) | 5,000 | 0.0001 ms | 0.0002 ms |

This was the number most worth knowing: the resolver multiplies into everything
else, and it is ~100 nanoseconds on both paths.

### Records, two tenants 50/50

| Dataset | `list` p50 | `get` own | `get` foreign (deny) |
|---|---|---|---|
| 100 | 0.0100 ms | 0.0003 ms | 0.0002 ms |
| 1,000 | 0.0241 ms | 0.0002 ms | 0.0002 ms |
| 10,000 | **0.2395 ms** | 0.0002 ms | 0.0002 ms |

**A denial costs the same as a hit.** The refusal is not a timing oracle.

### Search and graph

| Measurement | n | p50 | p95 |
|---|---|---|---|
| `unified.query` (2,000 rows, scoped) | 30 | 0.0524 ms | 0.2336 ms |
| `graph.listNodes` (400 nodes, scoped) | 50 | 0.0216 ms | 0.0280 ms |
| `graph.getNode` own / foreign | 200 | 0.0002 / 0.0002 ms | — |

### The cost of the boundary (Phase 31)

**NO VALID PRE-13C BASELINE EXISTS.** No measurements were taken before the
scoping work, and reconstructing one by reverting nine commits is not something
to do inside a certification run. Rather than invent a historical figure, the
delta that *can* be measured honestly today:

| 5,000 rows | p50 |
|---|---|
| `list` SCOPED | 0.1172 ms |
| `list` UNSCOPED (same rows, no ownership predicate) | 0.0167 ms |
| **Delta** | **+0.1005 ms** |

Roughly 7× the raw filter in relative terms, a tenth of a millisecond in
absolute terms, and the same complexity class — the boundary is a predicate on a
walk the code already performs. The scoped path also does more than the
comparator (ownership check *and* status filter *and* sort), so 7× overstates
the boundary's share.

**100,000 rows was not measured**, and the reason is stated rather than the row
silently omitted: these stores hold every record in memory and serialize the
whole file on write, so a 100k fixture measures the fixture builder. 10k is
where "practical" ends for an in-memory JSON store.

**p95 is omitted wherever n < 20** — below that a "p95" is the maximum wearing a
percentile's name.

---

# PART 3 — The seven HIGH findings

Every one is a subsystem that predates tenancy, whose store never grew a scope
seam, reached by a channel that checks *capability* rather than *ownership*.
This is the fourth time this program has hit that exact pattern.

### H1 — Automation rules: read, overwrite, execute and evict, install-wide

`AutomationRule` has no tenant field; `AutomationStore` has no scope seam.

- `enterprise/automationStore.ts:50` — `all()` returns every rule
- `enterprise/automationSubsystem.ts:127` — `AutomationList` serves it
- **`ipc/runtimeAuthz.ts:423` — `AutomationList` is in `PUBLIC_CHANNELS`**, so no permission at all
- `automationStore.ts:73` — `AutomationSave` overwrites by payload id
- `automationSubsystem.ts:169` — `AutomationRun` **executes** another tenant's rule by bare id
- `automationStore.ts:77` — `MAX_RULES = 500`, install-wide, oldest-first → one tenant **deletes** another's live automations

Worse: the runner is wired to `wireAutomationProducers`, so **every install rule
is dispatched against every tenant's platform events**, and the action set
includes `save-memory` and `ai-generate` — another tenant's record data leaving
the machine through a rule its owner never wrote.

### H2 — Executive decisions, install-wide and unpermissioned

- `enterprise/decisionStore.ts:174` — `all()` unscoped
- `enterprise/decisionSubsystem.ts:37` — `DecisionList` serves it
- **`ipc/runtimeAuthz.ts:422` — in `PUBLIC_CHANNELS`**
- `decisionSubsystem.ts:64` — status write by bare payload id
- `decisionStore.ts:190` — install-wide 500 cap

`ExecutiveDecision` carries `description`, `reasoning`, `evidence[]`,
`businessImpact` and `owner`.

### H3 — Workforce jobs and the governance audit trail

`Job` has no tenant field.

- `workforce/runtime/jobStore.ts:127` / `:122` — `page()` and `get()` filter on worker/status only
- `workforce/index.ts:315, 328` — served by IPC
- `workforce/index.ts:333` — **approving another tenant's proposal re-enters the ExecuteEngine**
- `workforce/index.ts:411` → `governance/index.ts:66` — audit page, no tenant filter
- `workforce/authzGate.ts:58` — `withWorkforceAuthz` adds auth + permission + audit, **no scope**

`Job.summary`, `.evidence`, `.logs` and `.proposals` are the worker's output over
the tenant's connected data, and `workforce:read` is a base role.

### H4 — `workflowRuns` Map keyed by run id, no tenant

- `workforce/index.ts:215` — the Map
- `:368` — `WorkforceWorkflowRuns`, schema `EmptyRequest`, enumerates every tenant's runs **and their specs**
- `:379`, `:397` — resume another tenant's run; approve another tenant's human-approval gate

### H5 — ExecuteEngine sessions and history, install-wide and public

- `executeEngine.ts:161, 165` — `activeSessions()`, `getHistory()` unscoped
- `runtimeCore.ts:2334, 2339` — served
- **`ipc/runtimeAuthz.ts:442-443` — both in `PUBLIC_CHANNELS`**
- `runtimeCore.ts:2344` — cancel by bare payload id
- `executionStore.ts:48` — persisted install-wide, `MAX_PERSISTED = 500`

`ExecutionSession.result` is the full structured output of every executed action
— infrastructure changes, M365 sends, approved worker actions — for every tenant,
behind no permission.

### H6 — Data Plane relationship queue: cross-tenant read *and* write

- `dataPlane/relationshipStore.ts:199` — `queue()` has no scope; the store has no
  `bindScope` at all, unlike its sibling `ProvenanceStore` which does
- `dataPlane/index.ts:1197` + `:440-455` — emits `sourceTitle`, `sourceField`,
  **`sourceValue`** and candidates
- `dataPlane/index.ts:1201` → `relationshipEngine.ts:212` — `pendingId` resolved
  unscoped; only the *target* is scoped, so the write links **tenant A's source
  record** to tenant B's target

`data:read` is a base role.

### H7 — Seven platform read-model caches survive the tenant switch

Each holds a fully composed, tenant-derived snapshot behind a ~3 s TTL, cleared
**only in `dispose()`**: `analyticsPlatform:136`, `operationsPlatform:158` (+
`continuityCache:279`, whose snapshot includes the org roster),
`strategyPlatform:155`, `digitalTwinPlatform:164`, `knowledgeAssets:174`,
`automationPlatform:155`, `insight:176`.

The switch hook (`runtimeCore.ts:943-956`) flushes only four things — plans, the
relationship and trust model caches, and live-sync. Only two subsystems in the
whole codebase register `onWorkspaceSwitch`.

**Switching organization and opening a dashboard is the most common
multi-tenant action there is**, and the renderer's reload lands inside the TTL —
so tenant B is served tenant A's composed KPIs, incidents, objectives, board pack
and roster.

---

# PART 4 — MEDIUM and LOW

### MEDIUM (7)

| # | Finding |
|---|---|
| M-A | `infrastructure/resourceStore.ts` has no tenant column; graph/neighbors/search return every tenant's discovered cloud resources under `connectors:read` |
| M-B | `sandbox/executionEngine.ts:154` — `this.running` is the engine's install-wide set and the omitted-`workspaceId` branch is `true`. **The exact "omitted field widens" bypass P13C removed from the four sibling stores survives here**, reachable with `{}` |
| M-C | `runtimeCore.ts:767` — a value named `tenantId` is a *workspace* id, and every unresolved caller shares one `'local'` bucket of saved column mappings |
| M-D | `federation/index.ts:249` — publishes with a hardcoded `ORG_ID`; `:246` lists `private` artifacts install-wide |
| M-E | `cloud/index.ts:188, 277` — install-wide tenant roster and per-tenant byte counts; and `:101` compares an **organization** id against `CloudTenant.id` (`tnt_…`), so the scoped channels are empty by accident rather than closed by design |
| M-F | `workspaces/workspaceContextStore.ts:144, 218, 259` — no tenant column, three `workspaces[0]` fallbacks; tab labels name records |
| L3/L4 → **MEDIUM** | see re-classification below |

### LOW (5)

`assistant:cancel` as an in-flight oracle (needs an unguessable id); AI routing
counters; the companion device roster; `defaultOrg()` in a boot log line;
`activeOrgId` (now setter-guarded, switch-nulled, and bypassed by an
owner-derived queue).

---

# PART 5 — Re-classification of the four known findings (Phase 34)

Re-examined under real E2E conditions, not assumed.

**M4 (Data Plane plan cache) → DOWNGRADED to LOW.** `dataPlane/index.ts:1265`
`forgetPlans()` is wired into `onWorkspaceSwitch` (`runtimeCore.ts:944`), and an
organization switch fans the same listeners — so no plan survives the only
transition that changes tenant. The id is `imp_${randomUUID()}`, and every place
it appears was traced: app/audit logs (files, no tail channel), provenance
records (scoped), and `onImported` (main-side only, never broadcast). **No
channel, log, event or broadcast hands a planId to another tenant while the plan
is cached.**

**L1 (sandbox payload workspaceId) → STAYS LOW.** Every write stamps the owner
server-side and every read runs `onlyMine()` *before* the workspace filter, so a
payload `workspaceId` narrows strictly within the caller's tenant. It can never
become a read disclosure. (The one place this pattern is still open is M-B, a
different line.)

**L2 (`assistant:cancel`) → STAYS LOW, but it does more than cancel.** It is an
existence oracle *plus* a cross-context abort *plus* it publishes the foreign
`conversationId` into the canceller's timeline. Never a content read — `get`,
`branch` and `decideStep` all resolve through the scoped store — and the id is a
uuid.

**L3/L4 (retention caps) → RAISED to MEDIUM.** The caps are deterministic,
oldest-first and install-wide, so a noisy tenant *chooses* what another loses —
and what is lost is **certification and validation evidence**: artifacts carry
the full result/report JSON, and validation runs are the compliance record the
exports are built from. That is evidence destruction triggerable by another
tenant, not merely a service gap.

---

# PART 6 — Mac runtime verification

**MAC RUNTIME VERIFICATION: NOT PERFORMED.**

No Mac runtime was available in this session. No screen was observed. Nothing
about the Organization Switcher, Workspace Switcher, Business Home, AI Home,
Data Command Center, ERP, CRM, HR, Finance, Documents, Search, Graph, Memory,
Notifications, Connectors, Approvals, Audit, Sandbox, Validation or Assistant
Conversations is claimed on visual evidence.

---

# PART 7 — Verdict and what happens next

## PROGRAM 13C: **NOT CERTIFIED**

**Certification reason:** seven HIGH cross-tenant findings, each an
unpermissioned or bare-id path into a subsystem with no tenant field. Five of
them are reachable through channels on the **public allowlist** or taking
`EmptyRequest`. Two of them (`AutomationRun`, workforce proposal approval) let
one tenant **execute** work inside another's context.

### Required before certification can be re-attempted

1. **H1–H5** — give `AutomationRule`, `ExecutiveDecision`, `Job`, `WorkflowRun`
   and `ExecutionSession` an owner; scope their stores; remove the five channels
   from `PUBLIC_CHANNELS`; resolve every bare payload id inside the caller's own
   partition. The `PersistentStore` seam built for the sandbox is the precedent.
2. **H6** — give `relationshipStore` the `bindScope` its sibling
   `ProvenanceStore` already has, and scope `pendingId` on the decide path.
3. **H7** — register the seven platform caches on `onWorkspaceSwitch`, or key
   them by tenant. Only two subsystems in the codebase currently register.
4. **M-B** — `this.running` in the sandbox engine: the last surviving instance of
   the omitted-field bypass.
5. Re-run the E2E suites built here (they will exercise the new scoping for
   free), then a **fresh** red team.

### An observation worth carrying forward

Four sweeps have now found the same pattern, and each found it in subsystems the
previous sweep had not walked. The remaining risk is not in the code that has
been audited — it is in the code that has not. Before the next certification
attempt, it is worth enumerating **every** `SecureHandlerDef` array in
`apps/desktop/src/main` and classifying each channel's store as scoped or not,
so the coverage question is answered by construction rather than by another
sweep's reach.

The strongest structural fix available is the one `initSandbox` now demonstrates:
**a composition-time throw when a store is unbound**, so an unscoped store cannot
ship at all. Extending that to every store registry would convert this entire
class of finding from "found by audit" to "cannot start".
