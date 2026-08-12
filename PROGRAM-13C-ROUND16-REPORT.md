# PROGRAM 13C — ROUND 16 REPORT

## VERDICT

# NOT CERTIFIED

**F22 coverage: 5 of 18.** Two adapters added, both for stores that break the
mechanical pattern in ways that fail *silently*. Four decision records written
for the stores whose semantics are genuinely ambiguous — presented, not guessed.

The ten runtime gates are untouched for the sixth consecutive round, because
nothing I do can touch them.

---

## A. REPOSITORY

| | |
|---|---|
| Branch | `feat/understanding-holds-motion-system` |
| Baseline | Round 15 (`round15.patch` applied) |
| Verification | Linux container. **macOS gates are yours.** |

---

## B. TWO ADAPTERS — BOTH SILENT-FAILURE SHAPES

### `workforce-jobs` — the `order[]` index

`persist()` serializes `this.order.map((id) => this.jobs.get(id))` — **from the
index, not the Map**. A merge that updates `jobs` and forgets `order` writes a
file missing every restored row, with no error, and the loss appears only on the
next reload.

Deliberately **not** routed through `put()`: that method stamps ownership from
the live resolver and mutates in place because the runtime aliases the row it is
executing. Restoring through it would re-stamp every job with whoever is active —
the exact substitution this program spent ten rounds removing.

### `companion-device-registry` — `boundTenantId`, not `tenantId`

The store holds a `TenantOwnership`, but `onlyFor`/`onlyMine` read `.tenantId`
— a field these rows **do not have**. An adapter written by pattern-matching the
other three would return an empty list for every row, produce an archive
containing zero devices on every install, and never fail.

Ownership semantics were **not** changed to suit the adapter. The adapter adapts
to the store. It is also *stricter* than the store's own `mine()` on one point:
an empty `boundTenantId` yields nothing, so a device paired before the field
existed belongs to nobody and is never restorable.

---

## C. A NEGATIVE CONTROL THAT FAILED, AND WHAT IT EXPOSED

**NC-F22-ORDER did not discriminate on the first attempt — all 9 tests passed
with `order[]` rebuilding removed.**

My test was wrong, not the guard. The restored job ids were the *same ids already
sitting in* `order`, so forgetting to rebuild the index still produced a correct
file. A test that passes either way proves nothing.

The real hazard needs a restored id **absent** from `order` — which is what
happens when a job is pruned between backup and restore. Added that case:
archive A, delete one of A's jobs from both structures, restore.

| Control | First attempt | After the fix |
|---|---|---|
| **NC-F22-ORDER** | **9 passed — no discrimination** | **FAILS**: `expected ['org-a-job-1','org-a-job-2'] to deeply equal [...'job-0'...]` — the pruned-then-restored job vanished |
| **NC-F22-BOUNDTENANT** — `ownerOf` reads `.tenantId` | — | **FAILS**: the archive silently empties |

Recording the miss because a broken negative control that *looks* like coverage
is exactly the false confidence this program exists to prevent. It is the second
time this has happened (Round 13's was a syntax error) and both are in the
reports.

---

## D. THE ROUND 10 GATE CAUGHT MY OWN CHANGE

Adding `mergeForGrant` introduced a `.delete(` into
`companion/deviceRegistryStore.ts`, so `storeScopeGate` **refused the build**
until the new removal was declared in checkable enum form:

> `expected [ 'companion/deviceRegistryStore.ts' ] to deeply equal []`

Declared `retentionScope: 'OWNER'` (the delete is filtered on
`boundTenantId === grant.tenantId` before it runs, so a restore of A cannot reach
B's phones) and `retentionAuthority: 'PLATFORM_OPERATOR'` (a restore is a
`cloud:operate` act; `revoke` is the narrower owner action, and naming the wider
of the two is the honest answer).

A Round 10 invariant doing exactly its job against a change made six rounds
later, written by someone who knew it existed and still tripped it.

---

## E. DECISION RECORDS — FOUR STORES I DID NOT IMPLEMENT

The brief asked for these rather than invented semantics. Each needs your call.

### D-1 · `workforce-governance-audit` — the hash chain

**Semantics:** `private readonly chain = new AuditChain(...)`. The array backs a
SHA-256 chain persisted as `integrity`; the class comment states the invariant —
*"THE OUTPUT IS FILTERED, NEVER THE ARRAY."*

**Why a generic merge is unsafe:** splicing one tenant's rows invalidates
`verifyIntegrity()` for **every** tenant. A restore of A would break B's and C's
tamper evidence.

| Option | Cost |
|---|---|
| **A · per-tenant chains** | Correct and restorable per tenant. Changes the persisted `integrity` shape; needs a migration; loses the single install-wide ordering proof. |
| **B · global chain, tenant-aware partitioning** | Keeps one chain. Substantially more crypto design; easiest to get subtly wrong. |
| **C · exclude from tenant backup; platform-level only** | Zero risk to existing tamper evidence. A tenant archive then does **not** contain that tenant's audit trail — which must be declared, and `uncoveredDomains` already does that. |

**My recommendation: C now, A later if per-tenant audit restore becomes a
requirement.** An audit log's value is that it is *not* rewritable; making it
per-tenant restorable weakens the property it exists for. **Data-loss risk of C:
none. Security risk of C: none — it removes a restore path rather than adding
one.** But this is a compliance-facing decision and it is yours.

### D-2 · `connector-accounts` — owner by join

**Semantics:** no tenant or org field on the row. Only `workspaceId`.
Ownership = `workspaceId → Workspace.organizationId`.

**Why unsafe generically:** `ownerOf(row)` becomes a function of *another store's
live state*, while `TenantDomainSource` treats it as a pure row property. Rows
from `unclaimed()` map to no tenant. The class is also not exported and is
Electron-coupled.

| Option | Cost |
|---|---|
| **A · resolve through the workspace directory at adapter time** | No schema change. Adapter depends on workspace-directory being loaded and consistent; a workspace deleted between backup and restore orphans rows. |
| **B · deliberate schema migration adding `tenantId` to the account row** | Makes `ownerOf` pure and matches every other store. It is a real migration with a backfill, and the backfill has the same join problem once. |

**Recommendation: B**, because A permanently couples backup correctness to
another store's state. But B is a migration and should not be done at the end of
a session.

### D-3 · `organization-directory` — four collections, and restore re-creates a tenant

**Semantics:** `organizations`, `units`, `roles`, `users`. `OrgUnit`/`OrgUser`/
`OrgRole` carry `orgId`; **`Organization` is owned by its own `id`**. `load()`
also calls `reconcileBuiltInRoles()`, which rewrites every built-in role's
permissions from seed on every load.

**Why unsafe generically:** restoring an `Organization` row **re-creates a
tenant**, and restoring a built-in role's permissions is pointless because load
overwrites them.

**Required decision — what is a tenant backup of the directory *for*?** My
reading: customer state (units, users, custom roles, org metadata) yes; seed
state (built-in roles, the default organization) no. **Separating those two is
the actual work**, and it is a product question about whether restoring a
directory should be able to resurrect a deleted organization.

### D-4 · `workspace-directory` — owner is `organizationId`, and load seeds

**Semantics:** owner is `organizationId` (required, no pre-migration rows). No
`bindScope` at all — this store has no tenant seam. `load()` seeds
`workspace-default` bound to the seeded org; `persist()` also writes `activeId`.

**Why unsafe generically:** a restore collides with the seeded default workspace,
and a naive merge can move another tenant's active-workspace pointer.

**Recommendation:** treat `workspace-default` as seed state and exclude it;
restore only customer-created workspaces; never write `activeId`. Low risk, but
it is three explicit rules rather than a filter, so it needs to be written down
before it is written in code.

---

## F. AUTOMATED VERIFICATION

| Gate | Round 15 | **Round 16** |
|---|---|---|
| Desktop main | 673 / 7001 | **674 files / 7011 tests** |
| Typecheck node / web | 0 / 0 | **0 / 0** |
| Lint | clean | **clean** |
| Negative controls | 19 | **21** |
| Renderer/shared, 46 workspaces, builds | PASS on Mac | **re-run on the Mac** |

**One flake, diagnosed rather than dismissed.** The full run showed
`knowledgeBench.test.ts` failing `expected 126.66 to be less than or equal to
120`. It is a wall-clock benchmark in a file I did not touch, and it was running
against a 2-core container while my own typecheck and lint jobs were in flight.
Re-run three times in isolation: **86.1ms, 84.6ms, 75.6ms** — all comfortably
inside budget. Recorded as environmental; **confirm on your Mac**, where the run
is not competing with anything.

---

## G. CERTIFICATION GATE

| | |
|---|---|
| HIGH / Security MEDIUM | 0 / 0 |
| Retention / resolver / authority | PASS |
| Channel→store mechanism | PASS, **coverage partial** |
| **F22** | **OPEN — 5/18 adapters** |
| Desktop suite / typecheck / lint | PASS |
| Negative controls | PASS (21/21) |
| 10 runtime gates | **NOT TESTED** |

# PROGRAM 13C — STATUS: NOT CERTIFIED

**BLOCKER 1 — F22, 13 domains remaining.** Four need your decision (§E). Of the
rest: `assistant-conversations` needs `AssistantSubsystem` widened;
`org-license-cache` is genuinely one line (already `Record<orgId, …>`);
`user-feedback` has no scope declaration at all; and memory / graph /
unified-entities / platform-timeline / enterprise-module-records /
enterprise-governance are the bespoke set from the Round 12 audit.

**BLOCKER 2 — channel→store coverage.** Unchanged, third round running.

**BLOCKER 3 — the ten runtime gates.** Unchanged, sixth round running.

---

## H. THE THING I HAVE NOW SAID SIX TIMES

Rounds 11–16 have produced real work: 19 MEDIUM closed, 21 discriminating
negative controls, three structural invariants, and F22 from nothing to 5/18 with
the mechanism proven and two silent-failure adapter traps caught.

**And the runtime gates have not moved once.** They were identified in Round 11.
Every round since has closed work *around* them. They cannot be closed from here
— not by me, not by more static rounds, not by a better brief.

Two of this round's three most interesting findings came from **my own code**
(the failed negative control, the retention gate catching my delete). The
external attack surface stopped producing findings three rounds ago. That is the
signal that the static phase has given what it has.

**An afternoon on the Mac retires ten gates.** It has been the highest-value
available action since Round 11, and it is now the only one that changes the
verdict. I would rather you spend that afternoon than write Round 17.
