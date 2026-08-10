# Program 13C — Parts 3–5 Report

**Starting commit:** `9639c3d` (Program 13C Part 2a — the webhook egress boundary)
**Final commit:** `8f91360`
**Branch:** `feat/understanding-holds-motion-system`
**Working tree:** CLEAN

## Verdict, stated first

**Program 13C is NOT complete.** Part 3 is substantially delivered. Part 4 is
partial. Part 5 was not performed.

The program's own stop condition applies: *if any required gate is red, do not
claim completion.* Several are. They are listed in full below rather than
summarised away, and no measurement in this report is invented — where something
was not run, it says so.

| Part | Scope | Status |
|---|---|---|
| 3 | Background jobs, notifications, multi-organization, workspace | **DELIVERED** |
| 4 | Two-tenant E2E, cross-domain security, concurrency, adversarial | **PARTIAL** |
| 5 | Performance, final red team, final gate, readiness | **NOT PERFORMED** (performance); red team **PARTIAL** |

Commits, all green at the point of commit:

- `3522e13` — Part 3a: background fan-out
- `69db9cc` — Part 3b: multi-organization and the workspace directory
- `8f91360` — Part 3c: three cross-tenant paths found by an adversarial sweep

---

## Phase 0 — Baseline

`HEAD` verified at `9639c3d` before any change. Branch and clean tree confirmed.

| Gate | Baseline | Final |
|---|---|---|
| Tests (desktop) | 686 files / 6859 tests, exit 0 | **693 files / 6945 tests, exit 0** |
| Typecheck | green (per workspace) | green (per workspace) |
| Lint | green | green |
| Desktop build | green | green |
| Backend build | **ENVIRONMENT FAILURE** | **ENVIRONMENT FAILURE** |

Two environment issues, present at baseline and therefore **not regressions**:

1. **`npm run typecheck` (aggregate) is killed under memory pressure** in the
   4 GB Linux sandbox. Every workspace typechecks green individually
   (`backend`, `cloud`, `desktop`, `shared`, `companion-protocol`, `cloud-core`,
   `shared-cloud`). Verified by running each separately.
2. **`npm run build` fails in `apps/backend`** with
   `Cannot start service: Host version "0.27.7" does not match binary version "0.21.5"` —
   an esbuild host/binary mismatch from `node_modules` installed on macOS being
   executed under Linux. `apps/backend` has no modifications in this program.
   **The desktop build, which is the gate the program names, is green.**

One pre-existing observation, unmodified by this work: `npm run typecheck:test`
(`tsconfig.test.json`) reports errors in `fabricTenancy.test.ts`,
`provenanceTenancy.test.ts`, `timelineTenancy.test.ts` and
`webhookEgressTenancy.test.ts`. That script is not part of `npm run typecheck`
(which is `typecheck:node && typecheck:web`) and none of those files were touched
here. Flagged, not fixed.

---

## PART 3 — Delivered

### Background jobs (Phases 1–10)

Part 1 gave background work *a* principal. Nothing decided *which* principals a
job should have, and every timer in the application was a single per-install
timer resolving its tenant from the signed-in user's current workspace.

On one tenant that reads as correct. On two it is wrong twice, in opposite
directions: the 07:00 brief was built from whichever organization happened to be
open at 07:00, **and** there was only ever one tick, so exactly one organization
was served — the second tenant's brief never fired, its meeting reminders never
scanned, its connectors never synced. The second failure is why this could not be
fixed by wrapping the existing tick in a principal: there is no single correct
principal for work owed to everyone.

`tenancy/backgroundFanOut.ts` returns a **list** of runs, one per operable
tenant, each with its own principal. A caller that handles only `[0]` is
reviewable as wrong, where a caller reading an ambient scope looked fine. No
operable organization means no runs — not the default, not the first, not the one
the UI has open.

**Complete inventory, freshly classified:**

| Job | Classification | Status |
|---|---|---|
| Delivery engine (briefs, org intelligence, founder proactive) | TENANT_SCOPED | fan-out per tenant |
| Meeting-soon scan | TENANT_SCOPED | via the engine's fan-out |
| Notification bus routing | TENANT_SCOPED (by EVENT) | principal from the event |
| Connector / cloud sync tick | WORKSPACE_SCOPED | fan-out per workspace |
| Sync retry queue | WORKSPACE_SCOPED | principal captured per item |
| Workforce job queue | TENANT_SCOPED | principal captured at ENQUEUE |
| Webhook dispatcher | TENANT_SCOPED | already done (Part 2a), not regressed |
| Graph / memory reprojection | TENANT_SCOPED | already done (Part 1) |
| Runtime supervisor | SYSTEM_GLOBAL | explicit system principal |
| Health monitor | SYSTEM_GLOBAL | explicit system principal |
| Update checker | SYSTEM_GLOBAL | explicit system principal (both entry points) |
| Scheduled backup | SYSTEM_GLOBAL | explicit system principal + rationale |
| Timeline flush | SYSTEM_GLOBAL | local I/O of already-stamped events |

**Scheduled backup — classified, not guessed.** `backup.create` is `fs.copyFile`
over `DOMAIN_FILES`. It never opens a scoped store and never reads a record; it
copies bytes inside `userData`. It therefore operates *below* the application's
authorization layer, at the level the migration inventory already names BLOCKED
("the filesystem itself"). A per-tenant backup is not expressible while every
tenant's records share one JSON file per module — the honest options were a
whole-install copy filed under a tenant's name, claiming an isolation the storage
does not have, or saying so. What the classification obliges is done: it runs
under a system principal so its events are not stamped into whichever
organization is open, and its destination stays inside `userData`, so it is not
an egress. A privileged local user reads a backup exactly as they read the live
files. That limit is stated, not papered over.

**Fail-closed (Phase 8).** No default tenant, first tenant, first workspace,
admin tenant or active-UI tenant anywhere in the fan-out. A suspended or archived
organization is excluded, so suspension stops background work too. A workforce
job enqueued with no resolvable tenant is **dropped**, not run.

**Connector sync — the subtle half.** Fanning the tick alone would have changed
nothing, because `connectorStore.all()` filters on the *session's* workspace: each
pass would have listed the signed-in user's accounts and synced them N times,
stamping each pass with a different tenant. That is a cross-tenant **write**,
strictly worse than the single-workspace sync it replaced. The store's workspace
binding now follows the principal.

### Notifications (Phases 11–15)

- Scheduled items are produced once per tenant, under that tenant's principal.
- A bus-driven item is delivered under a principal built from the **event's** own
  tenant (13B stamped it), so a connector failure raised by tenant A no longer
  lands in whichever inbox is open. An **unowned** event is dropped rather than
  given to somebody.
- `deliverNow` deliberately does **not** fan out — an event already has one owner,
  so one delivery is the only correct number.
- Two de-dupe keys grew a tenant. Notification cooldowns and the engine's
  per-minute guard both let one tenant's alert silence another's, because item ids
  are stable per *subject* and two tenants can hold the same subject.
- The unread badge broadcast to the renderer is computed **outside** the running
  principal, so a background pass for A cannot push A's count into a window
  showing B.
- SYSTEM-scoped events (runtime supervisor criticals) are deliberately fanned to
  every tenant. `scopeKind: 'system'` is stamped only from a system principal,
  which carries no tenant and so cannot have read customer data into its payload.
  This restores alerts that 13B's fail-closed stamping had correctly made
  invisible to everyone.

### Multi-organization (Phases 17–22)

There was **no way to create a second organization at all** — no channel, no
composition.

`provisionOrganization` creates organization → roles → owner → membership →
default workspace as one step, because any subset is inert: an organization with
no workspace cannot be entered (the resolver derives the tenant *from* the
workspace), a workspace with no member denies every read, an owner with no role
cannot even invite anyone. The creator becomes the owner because they are the
session; a request that could name someone else would be a caller-supplied answer
to "whose tenant is this". Creating with no signed-in account is refused rather
than producing a tenant nobody can enter or delete.

Built-in role definitions are extracted and shared, so a second tenant gets the
same Admin the seeded one has — and keeps getting it when a permission is added.
Role **rows** are per-tenant with generated ids; two organizations sharing a role
id would share a role.

Switching organization is switching workspace, deliberately. There is no separate
active-organization pointer in this system, and adding one would create a second
authorization path that could disagree with the first — invisibly, showing one
organization while every read resolved another.

### Workspace (Phases 23–26) — and a real disclosure

**FINDING (fixed): `EnterpriseWorkspaceList` returned every workspace on the
install.** `workspaceSummaries()` called `workspaceStore.list()` across every
organization, each row enriched with that organization's **name, user count and
unit count**. It backs the workspace switcher.

The switch itself was never open — `canSwitchTo` has denied since P11. But a
denied switch is not the whole boundary. Existence and names are disclosure on
their own, and this list is where an attacker gets the **ids** every other
direct-object-reference attempt needs.

Now filtered through the same chain `tenantContext` enforces on a request, so a
workspace offered is one the member could actually enter and one they could enter
is offered — two predicates that can drift is how a switcher shows a destination
every read then refuses. The decision lives in `org/tenantDirectory.ts`, pure and
injected, because who can see whom deserves to be read end-to-end.

`OrgUser.workspaceIds` semantics are **preserved, not redefined**: absent means
every workspace in the tenant, present restricts to exactly that list, empty
denies.

**Phase 23 UI** is a Settings panel (`TenantMembershipPanel`) showing current
organization, role, current workspace, available workspaces and other
organizations. Deliberately **not** a change to `WorkspaceSwitcher`, which drives
renderer-local tabs that merely share the word "workspace" — merging a tenancy
boundary into a UI grouping would blur exactly what the panel exists to state.

**The repository's own guard caught these channels unguarded** before any test I
wrote did: `ENTERPRISE_CHANNEL_PERMISSIONS` fails at startup for an unmapped
enterprise channel. List and switch are gated on a **read** scope rather than
`workspace:manage`, because permissions resolve against the *current*
organization and a manage gate on the exit traps a low-privilege member inside
whichever tenant they last opened. The gate that matters is target-side and
unchanged.

---

## PART 4 — Partial

### Delivered

An adversarial sweep was run against the **whole** tenant architecture, not only
the files this program touched: a repository-wide dangerous-pattern search and an
external-egress audit. Three findings were cross-tenant in effect and are fixed.

**1. The companion gateway pushed every tenant's events to every phone.**
`broadcastEvent` subscribed to the entire bus and wrote every event to every live
socket of every paired device. `PlatformEvent` has carried `tenantId` since 13B
and the function never read it; `EventResource` carries record ids and **names**.
This is the webhook defect Part 2a closed, on a different transport and a worse
one — the bytes leave the machine over a LAN socket to a device with no tenant
selector. Devices had no tenant to check against, so pairing now records one. A
device paired before the field existed is **not** adopted into the event's tenant
(that is "first tenant to send it something claims it") and receives system events
only. Tests assert at the **transport**, counting what each socket received.

**2. The sync retry queue escaped the fan-out, and its shared timer made that
worse.** The queue carried no principal, and `schedule()` clears and re-arms one
shared timer on every enqueue — so during the fan-out loop workspace B's enqueue
cancelled the timer armed inside A's principal and re-armed it inside B's.
`drain()` then ran every due item, including A's, under B's context, and the
orchestrator resolves its tenant at drain time. Not a stale read: a cross-tenant
**write**. The principal is now captured per item at enqueue and carried across
attempts, which also makes the shared timer irrelevant.

**3. Sync audit rows were filed under the watcher, not the workspace synced.**
`workspaceId` is not decoration on an audit record — `governanceStore`
**partitions** audit reads on that field. Stamping it from the window's workspace
meant tenant B's sync rows, carrying B's record ids and titles, were written into
tenant A's audit trail and were missing from B's. A disclosure and an evidentiary
gap from one line.

Also fixed: the companion pairing response and every `session.hello` labelled
themselves with `orgStore.defaultOrg().name`, so every phone in every tenant was
told the same organization's name.

**Concurrency covered:** two concurrent background jobs sampled across 25 await
points each, asserting every read (a context that is right at the start and wrong
after an await is exactly what `AsyncLocalStorage` is here to prevent). Two
tenants' jobs in one workforce queue. Per-tenant cache-key collisions
(notification cooldown, delivery de-dupe, inbox de-dupe).

### NOT delivered — Part 4 gaps

- **Phase 28–30, 39: the full two-tenant E2E fixture was not built.** No
  per-tenant CRM/ERP/HR/Finance/Document/Graph/Memory/Opportunity/Decision/
  Outcome fixture, no scripted Tenant A and Tenant B journeys, no automated
  cross-domain business-intelligence chain. The existing `crossTenant.test.ts`
  (from P11–13B) covers the record/document/hold/audit/notification IDOR matrix
  with real stores and real temp files, and the new suites cover background,
  notification, companion egress, multi-org and workspace isolation — but that is
  not the same as the fixture Phase 28 specifies.
- **Phase 32–35: search / AI / memory / graph leak probes were not run as
  described.** No `NP-A-CONFIDENTIAL-984731` marker test, no AI prompt-injection
  attempts, no planted cross-tenant graph edge traversal. The underlying stores
  were scoped in 13A/13B and have their own suites; the specified adversarial
  probes were not performed.
- **Phase 42–44: tenant-switch, workspace-switch and cache races were not
  exercised.** Background concurrency was. Switching under concurrent load was
  not.

---

## PART 5 — Not performed

**Performance (Phases 49–52): NO MEASUREMENTS WERE TAKEN.** No tenant-resolution,
search, graph, memory, AI, notification, background-startup, switching or
webhook-authorization timings. No 100 / 1,000 / 10,000 / 100,000-record dataset
runs. No p50, no p95, no delta against a pre-13C baseline.

Reporting this as not done rather than producing numbers. The program is explicit
that invented measurements are unacceptable, and a plausible-looking table would
be worse than this paragraph.

**Mac visual verification (Phase 54): NOT PERFORMED.** No Mac runtime was
available in this session. No screen was observed. Nothing about the
Organization Switcher, Workspace Switcher, Business Home, AI Home, Data Command
Center, ERP, CRM, HR, Finance, Documents, Search, Graph, Memory, Notifications,
Connectors, Approvals or Audit views is claimed on visual evidence.

**Final red team (Phase 47): PARTIAL.** The sweep covered dangerous patterns and
external egress across the repository and produced the three fixes above. It did
not systematically answer every question in the Phase 47 list; in particular
forged-tenant/forged-workspace probes beyond the existing suite, stale-cache
exploitation, and concurrency exploitation were not attempted as adversarial
exercises.

---

## Open findings — located, severity-rated, NOT fixed

These were found by the sweep and are reported rather than silently carried.
Each is a real cross-tenant path.

| # | Finding | Location | Severity |
|---|---|---|---|
| 1 | `syncWorkers()` writes **every** tenant's AI workers as members of the *first* organization, where they appear in that tenant's roster, org graph and headcount. Runs at boot and on every registry change. | `enterprise/org/orgStore.ts:426` | **HIGH** (cross-tenant write) |
| 2 | `activeOrg()` retains `?? orgStore.defaultOrg()` and reaches **write** paths — stamped as `orgId` on unit/user/role creates, and feeds `orgBundle()` (which returns users). | `enterprise/index.ts:1359` | **HIGH** |
| 3 | ~10 platform read models built from `orgStore.defaultOrg()`: Insight, Knowledge Assets (full user list), Automation Platform (role catalogue), Operations, Strategy. | `runtimeCore.ts:2375, 2428, 2568, 2999, 3005, 3174, 3180` | **HIGH** (cross-tenant read) |
| 4 | `orgIntelligenceSource` — a *scheduled delivery source* built entirely on the first tenant's licence state and headcount, plus an install-wide workspace count. | `enterprise/orgIntelligence.ts:44, 61, 63` | **HIGH** |
| 5 | Ecosystem/marketplace installs keyed on the seeded `ORG_ID`: tenant B's app installs and entitlements land in and are read from tenant A's partition. | `ecosystem/index.ts:217, 385, 463, 669, 678, 682, 775`; `marketplace/index.ts:73` | **HIGH** (read + write) |
| 6 | `AdministrationView` sends `orgs[0].orgId` to `ipc.org.members()` / `ipc.devices.list()`, and the handler forwards the renderer-supplied `orgId` with `requireAuth` only — no active-tenant check. | `renderer/administration/AdministrationView.tsx:104`; `runtimeCore.ts:1414` | **HIGH** (IDOR) |
| 7 | Commercial platform: `orgId` falls back through `defaultOrg()` to the literal `'org-default'`, then drives licence status, seat binding and invoices. Also discloses install-wide org and workspace counts. | `commercial/index.ts:102, 183, 187` | **MEDIUM** |
| 8 | Cloud admin and SCIM emit the seeded org's member **name + email + role**, and write that org's headcount as the caller's SCIM result. | `cloud/index.ts:77, 317` | **MEDIUM** |
| 9 | Orchestration read model returns **every** organization's name, unit count and worker count. | `orchestration/index.ts:134` | **MEDIUM** |
| 10 | Every companion RPC (`dashboard.family`, `approvals.list/act`, `timeline`, `search`, `notifications`, `briefing`) resolves through the ambient session — so the same phone sees different tenants depending on what the laptop user clicked. | `companion/index.ts:106–262` | **MEDIUM** |
| 11 | Cloud live-sync selects its org from a renderer-set module variable and runs on a 60 s timer, so only the currently-open organization ever syncs. Attribution is correct (13A); **availability** is not. | `cloud/livesync/scheduler.ts:118` | **MEDIUM** |
| 12 | Infrastructure clients (AWS/Azure/GCP/Cloudflare/Databricks/Snowflake/K8s/VMware/IaC) have no app-tenant concept at all; credentials are process-env and discovered resources are install-wide. | `infrastructure/*/**Client.ts` | **MEDIUM** |
| 13 | `feedbackStore.exportAll()` writes install-wide feedback to a user-chosen path with no tenant scoping. | `feedback/index.ts:57` | **LOW** |

Confirmed clean: telemetry (`services/telemetry.ts`) writes JSONL locally with
**no endpoint**; crash reporting is `uploadToServer: false` with a redacting
builder — neither carries tenant ids, record contents or org names off the
device. `globalStore` / `globalSearch` / `globalGraph` / `globalMemory`: **zero
hits**. Non-null `workspaceStore.activeWorkspaceId()`: **zero production
callers**.

---

## Known out-of-scope security items

Per the program's instruction, stated plainly and **not** claimed as fixed:

1. **Webhook signing secrets remain plaintext in `webhooks.json`.** NOT FIXED.
2. **Tier-4 infrastructure clients accept user-supplied base URLs without
   `redirect: 'error'`.** NOT FIXED. (The egress audit independently confirmed
   these clients carry no tenant concept either — finding 12 above.)

---

## Trust boundary — what is actually true

| Layer | Claim |
|---|---|
| Application — tenant isolation | **YES**, for the surfaces migrated through 13C. The open findings above are exceptions and are named. |
| Workspace authorization | **YES.** `memberMayUseWorkspace` semantics preserved; the directory and the resolver agree. |
| Background principal | **YES.** Every timer classified; tenant-sensitive jobs fan out; missing principal fails closed. |
| External egress — tenant authorization | **PARTIAL.** Webhooks, connector sync (scheduled and retry), memory sync and companion event push are authorized from the artefact. Companion RPC is ambient; infrastructure clients are unscoped. |
| Local OS — same-process filesystem | **TRUSTED APPLICATION BOUNDARY.** Every tenant's records share one mode-0600 JSON file per module. |
| Local OS — privileged direct access | **OUTSIDE application authorization.** Anyone who can read those files reads every tenant and bypasses all of the above. No OS-level isolation is claimed. |

---

## Migration inventory

Updated in code (`tenancy/migrationInventory.ts`), because a markdown table
claiming isolation rots the moment someone adds a store:

- `background jobs` — was `REQUIRES_MIGRATION` ("9 of 10 timers"), now **PARTIAL**
  with the full classification. Partial rather than complete because the fan-out
  reads the live organization roster, so a tenant created mid-tick is picked up on
  the next one.
- `scheduled backup` — **new entry**, BLOCKED, with the classification rationale.
- `notifications (inboxStore)` — the note claiming "the delivery engine upstream
  still has no tenant context" is no longer true and was rewritten.

---

## Final gates

| Gate | Result |
|---|---|
| Desktop tests | **693 files / 6945 tests, exit 0** (+7 files, +86 tests vs baseline) |
| Tenancy suite (`src/main/tenancy/`) | green |
| Typecheck (per workspace) | green |
| Lint | green |
| Desktop build | green |
| Backend build | **environment failure** (esbuild host/binary mismatch, pre-existing) |
| Mac visual verification | **NOT PERFORMED** |
| Performance | **NOT MEASURED** |
| Two-tenant E2E (Phase 28–40) | **PARTIAL** |
| Working tree | CLEAN |

## What must happen before 13C can be called complete

1. Fix findings 1–6 (all HIGH, all cross-tenant read or write).
2. Build the Phase 28 two-tenant fixture and run Phases 29–40.
3. Run Phases 42–44 (switch and cache races).
4. Measure Phases 49–52 honestly.
5. Perform Mac verification, or continue to state it was not performed.

Program 13C remains the tenant operating security gate. It is not green.
