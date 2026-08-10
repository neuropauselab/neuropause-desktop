# Program 13C — Security Remediation Gate Report

**Starting commit:** `8f91360` (HEAD was `ac98481`, which differs only by the
Part 3 report markdown — verified: `git diff --stat` shows one file, zero code)
**Final commit:** `c258c1b`
**Branch:** `feat/understanding-holds-motion-system`
**Working tree:** CLEAN

## Verdict

**All six HIGH findings are FIXED.**

**Program 13C is still NOT green.** The mandated fresh adversarial sweep found
eleven further findings. Seven are fixed in this commit. **Four remain open, two
of them HIGH.** Per the stop condition, the E2E, concurrency, performance and
red-team gates have **not** been started.

| Gate | Result |
|---|---|
| Six original HIGH findings | **0 remaining** |
| Fresh sweep HIGH findings | **2 remaining** (N3 Sandbox, N2/N4 closed) |
| Tests | **699 files / 6995 tests, exit 0** (from 693 / 6945) |
| Typecheck | green, per workspace |
| Lint | green |
| Desktop build | green |
| Backend build | **GREEN** — verified natively on macOS (`tsup` → `Build success`). The CI-sandbox failure was an esbuild host/binary version skew from running macOS-installed `node_modules` under Linux, not a code fault; confirmed after the fact. |
| Working tree | CLEAN |

---

## The six findings

### Finding 1 — `syncWorkers` — **FIXED**

`enterprise/org/orgStore.ts`

**Worse than reported.** One line (`const org = this.defaultOrg()`) produced
three distinct cross-tenant defects, and the third was not in the audit:

1. **WRITE** — every tenant's AI workers became members of the first organization.
2. **UPDATE** — the existing-worker index scanned *every* organization, so a row
   in tenant B was mutated while the sync notionally ran for A.
3. **DELETE** — the prune loop also scanned every organization. Syncing tenant
   A's worker list **removed tenant B's AI members** whose ids were absent from
   A's. A read of one tenant's registry silently destroyed another's records,
   and nothing in the system would have reported it.

**Why the fix is shaped as it is.** `Worker` carries no tenant and cannot: the
registry is an install-level *catalogue* of AI worker packages — versions,
skills, a `builtIn` flag — in the same category as installed plugins. So "each
worker's authoritative tenant" is not a fact the data holds, and inventing one
would be a guess. The honest split is between the **catalogue** (install-level)
and the **membership rows** (per-tenant). `syncWorkers(orgId, …)` now requires an
explicit organization, scopes both its index and its prune, ignores units owned
by another organization, and returns 0 for an unknown org rather than throwing —
so one bad row cannot cancel every later tenant's sync. The caller fans out over
the same operable-tenant roster the scheduled jobs use, which means a suspended
tenant stops receiving worker rows for the same reason and in one place.

### Finding 2 — `activeOrg()` / `defaultOrg()` write paths — **FIXED**

`enterprise/index.ts`

Both halves fell back: `workspaceStore.active()` to the first workspace on the
install, `?? orgStore.defaultOrg()` to the first organization. Documented as
display-only, it had stopped being — it was stamped as `orgId` on unit, user and
role **creates**, and fed `orgBundle()`, whose response includes the member list.

Replaced by `activeOrgOrNull()` / `requireActiveOrg()`, resolved through
`activeTenantScope()`. Two consequences worth naming: a background job now
resolves the tenant it is running **for** rather than the one on screen, and an
unresolved caller gets null rather than a stranger. Null rather than a throwing
accessor, because a read should degrade to empty and a write should refuse —
those are different behaviours and one accessor could not express both.

Classification of every call site: three **writes** → `requireActiveOrg`; five
read models with no empty form → `requireActiveOrg`; the approver lookup → null
means no approver.

### Finding 3 — platform read models — **FIXED**

`runtimeCore.ts` — Insight (`orgUnits`), Knowledge Assets (`org`), Automation
Platform (`orgRoles`), Operations (`units`, `users`), Strategy (`units`, `users`).

Each returned real membership data — unit names and lead user ids, member ids and
names, the role catalogue — resolved from the first organization. All seven are
**lazy accessors**, evaluated per request or per background pass rather than
captured at boot, so a single resolver (`activeOrgForReadModel()`) makes each
evaluation answer for its own caller. Each degrades to an empty result; none
substitutes an organization.

### Finding 4 — org intelligence — **FIXED**

`enterprise/orgIntelligence.ts`

This is not an internal read model: it feeds `orgIntelligenceSource`, registered
on the scheduled delivery engine, so its output becomes a **delivered** finding.
Every tenant was sent an assessment of the first tenant's licence state and
headcount, plus an install-wide workspace count — a fact about how many other
customers share the machine, inside a notification they actually receive.

Bound via `bindOrgIntelligenceScope` rather than importing the enterprise root:
the module is Electron-free and unit-tests as a pure model, and importing the
root to reach `activeTenantScope` dragged `app.getPath` into a node test (this
was caught by the suite, and the first attempt was reverted). Unbound denies.
Since Part 3a the delivery engine runs each source once per tenant under that
tenant's principal, so no fan-out logic was needed here — the boundary was
already drawn; this stopped the function stepping around it.

### Finding 5 — ecosystem / marketplace — **FIXED**

`ecosystem/index.ts`, `marketplace/index.ts`

Every install read and write was keyed on `ORG_ID`, the seeded organization's
literal id, so tenant B's installs were written into and read from tenant A's
partition. The store partitions on `orgId` correctly and was simply never told
the truth.

**Two IDORs surfaced while fixing it, neither in the report:** `uninstall` and
`setDisabled` took a renderer-supplied installation id with **no ownership check
at all** — one of them destructive. Both now resolve the id inside the caller's
own partition first. Also removed: `?? ORG_ID` in the OAuth client-credentials
path, which minted a token scoped to the seeded tenant for an app whose developer
record was missing; an unresolvable developer is now `invalid_client`.

### Finding 6 — Administration IDOR — **FIXED**

`runtimeCore.ts`, `renderer/administration/AdministrationView.tsx`

Fourteen channels — `org.get/members/invite/changeRole/removeMember/workspaces`,
the workspace create/rename/delete trio, billing checkout, and
`devices.list/registerCurrent/revoke` — forwarded a renderer-supplied `orgId`
guarded by `requireAuth: true` alone.

**`requireAuth` proves somebody is signed in. It proves nothing about which
organization they may act in.**

The important detail: these are **cloud** organizations, a different id space
from the local enterprise `orgStore`. Validating a cloud id against local tenancy
would have rejected every real organization while *looking* like a security
control — worse than no check, because it would be trusted. The authority is
`orgClient.list()`, which the backend already scopes to the authenticated user's
memberships. `requireCloudOrgMembership()` requires the named id to appear there,
**fails closed if the backend is unreachable** (an offline backend must not
become a bypass), and uses one refusal message for "not yours" and "does not
exist" so the backend's org list cannot be enumerated.

The renderer's `orgs[0]` was also wrong on its own terms — a multi-org account
always saw org #1 — and now matches the active organization, with an ambiguous
match yielding null rather than a fallback.

---

## Fresh adversarial sweep (Phases 7–9)

Run independently, not relying on the first audit. It **verified all six fixes as
genuine and complete** (file and line evidence for each) and found **eleven new
findings**.

### Fixed in this commit

| # | Finding | Severity |
|---|---|---|
| N1 | Cloud admin surface (`CloudAdminOverview`, `CloudAdminCompliance`) returned the **seeded org's real names, emails and titles** to any tenant | HIGH |
| N2 | The two **license channels are PUBLIC** — no auth, no permission — and took `orgId` from the payload. `getStatus` exposed plan/entitlement/grace for any cached org; `refresh` drove `GET /license/:orgId` with the session token, an existence oracle and a network write classified as a read. Payload id now ignored entirely | HIGH |
| N4 | Cloud tenancy list channels treated an **absent `tenantId` as every tenant** — the schema made it optional, so `{}` was the bypass. Writes (`createProject`, `createTeam`, `setTenantStatus`) took a payload tenant with only an existence check; `deleteProject` took a bare id | HIGH |
| N5 | The literal **`?? 'org-default'`** survived in Commercial, driving licence status, **seat binding** and invoices; plus install-wide org and workspace counts | MEDIUM |
| N6 | Enterprise Twin reported **`orgs[0]`'s** headcount, unit count and human/worker split to every tenant | MEDIUM |
| N8 | SCIM sync **wrote** the seeded org's headcount into the calling tenant's federation record | MEDIUM |

### STILL OPEN — not fixed

| # | Finding | Severity |
|---|---|---|
| **N3** | **The entire Sandbox subsystem has no tenant dimension.** `SandboxWorkspace` has no `orgId`/`tenantId`, so scenarios, executions, artifacts and datasets cannot be scoped. `SandboxWorkspaceList` returns every sandbox workspace on the install; reads take an unvalidated payload `workspaceId` and two make it **optional**, so omitting it is the bypass; creates write into a caller-named workspace. Requires a schema change plus a scoped store | **HIGH** |
| **N7** | Assistant conversations: `list(null)` means **no filter — every conversation on the install**, and the schema makes the field nullable *and* optional so `{}` returns everything. `get(id)` selects by bare id. These channels are on the **public allowlist**. Bodies carry answers synthesised from tenant data | **MEDIUM** |
| N9 | `workspaceStore.active()` falls back to the first workspace across all orgs; returned verbatim by `EnterpriseWorkspaceActive` (no permission), leaking a foreign workspace name + orgId when `activeId` misses | LOW |
| N10 | `federationPlatform` identifies itself as `?? ORG_ID`, captured at init so it cannot follow a switch | LOW |
| N11 | `runtimeCore` sandbox executor adopts `list[0]` and then **writes** into it (a consequence of N3) | LOW |

N3 and N11 are the same root cause and should be fixed together.

---

## Regression tests (Phase 10)

Six suites, two tenants and unique markers throughout. **+50 tests.**

| Suite | Tests | Covers |
|---|---|---|
| `syncWorkersTenancy.test.ts` | 8 | A→A, B→B, no cross-org write, **no cross-org delete**, no cross-org rename, in-tenant prune still works, unknown/blank org writes nothing, foreign unit not adopted |
| `orgWriteTenancy.test.ts` | 11 | unit/user/role writes land in one org; resolver is session on IPC, **principal in a job**, null when unresolved, null for unknown id, **null inside a SYSTEM job even with a session** |
| `platformReadModelTenancy.test.ts` | 8 | all five accessor shapes per tenant, marker-string leak check, background pass resolves the job's tenant, unresolved → empty while `defaultOrg()` still returns Alpha |
| `orgIntelligenceTenancy.test.ts` | 6 | A's vs B's licence days and headcount, **own workspaces not the install's**, unresolved → neutral, **unbound → denies** |
| `marketplaceTenancy.test.ts` | 9 | per-tenant partitions, same listing → two rows, foreign id not in caller's set, uninstall isolation |
| `administrationIdor.test.ts` | 11 | A→B denied, B→A denied, own allowed, multi-org allowed for both, invented denied, blank denied **without calling the backend**, **unreachable backend denies**, no-memberships denies, **"not yours" and "does not exist" are indistinguishable** |

Tenancy suite total: **18 files / 278 tests**.

---

## Migration inventory (Phase 12)

Updated in code. **It does not claim zero HIGH findings, because that is not
true.** Four entries added or rewritten:

- `organization roster + platform read models` → PARTIAL, naming the delete
- `caller-supplied tenant identifiers (IPC)` → PARTIAL
- `sandbox (workspaces / scenarios / executions / datasets)` → **REQUIRES_MIGRATION, HIGH, OPEN**
- `assistant conversations (conversationStore)` → **REQUIRES_MIGRATION, MEDIUM, OPEN**

---

## Stop condition

The program's rule: proceed to E2E, concurrency, performance and red team **only
if** no HIGH cross-tenant findings remain.

**N3 remains HIGH. Those gates have not been started.**

### Before Program 13C can proceed

1. **N3 + N11** — give `SandboxWorkspace` a tenant, scope the store, server-resolve
   every payload `workspaceId`, and make an absent one deny rather than widen.
2. **N7** — make the assistant workspace server-resolved; `null` must mean "the
   caller's", never "all". Review why those channels are public.
3. **N9, N10** — mechanical, same shape as fixes already made.
4. Re-run the sweep. Only at zero HIGH does the E2E/performance prompt begin.

Program 13C remains the tenant operating security gate. It is not green.
