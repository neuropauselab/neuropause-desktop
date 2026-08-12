# PROGRAM 13C — ROUND 15 REPORT

## VERDICT

# NOT CERTIFIED

**F22 coverage: 3 of 18.** Not 18, and not the 10 I told you to expect.

The headline finding of this round is that **my own estimate was wrong**. "About
ten mechanical stores" has been repeated in the Round 12, 14 and 15 briefs — it
came from me, and a store-by-store inventory this round showed it does not
survive contact with the code. Six of those ten are not mechanical, each for a
different and real reason (§B). I would rather correct that now than deliver six
adapters that quietly produce wrong backups.

Three production adapters are wired, tested against real stores writing real
files, and negative-controlled. The archive still says `complete: false`, and it
is still telling the truth.

---

## A. REPOSITORY

| | |
|---|---|
| Branch | `feat/understanding-holds-motion-system` |
| HEAD at open | `ee1a65e` (Round 14, pushed) |
| Worktree | clean at open |
| Verification | Linux container. **macOS gates are yours.** |

---

## B. THE INVENTORY — WHY "TEN MECHANICAL" WAS WRONG

A per-store read of all ten candidates. **Four are mechanical. Six are not.**

| Store | Verdict | Why |
|---|---|---|
| `executive-decisions` | **mechanical** | array + optional `tenantId` + whole-collection persist |
| `automation-rules` | **mechanical** | same shape |
| `enterprise-health-history` | **mechanical** | same shape; key is `(tenantId, day)` so merge must re-sort |
| `workforce-jobs` | mechanical **+ hazard** | keeps a parallel `order[]` index that `persist()` serializes **from** — a merge that misses it silently drops rows |
| `workforce-governance-audit` | **BESPOKE** | a SHA-256 **hash chain** over the whole array. Splicing one tenant's rows invalidates `verifyIntegrity()` for **every** tenant. The store's own comment states the invariant: *"THE OUTPUT IS FILTERED, NEVER THE ARRAY."* |
| `connector-accounts` | **BESPOKE** | **no tenant field on the row at all.** Owner derives by joining `workspaceId` against the workspace directory, making `ownerOf` a function of another store's live state. Class isn't exported; Electron-coupled |
| `organization-directory` | **BESPOKE** | four collections; `Organization` is owned by its own `id`, not an `orgId`. Restoring one **re-creates a tenant**. `load()` rewrites built-in role permissions from seed |
| `workspace-directory` | semi-bespoke | owner is `organizationId`; **no `bindScope` exists**; `load()` seeds a default workspace a restore would collide with |
| `companion-device-registry` | semi-bespoke | owner is `boundTenantId`, so `TenantOwnership.onlyFor` — which reads `.tenantId` — returns **nothing** for every row |
| `assistant-conversations` | mechanical **+ wiring gap** | no exported instance; the live store is module-local inside `initAssistant` |

The `workforce-governance-audit` case is the one worth pausing on. It is not
harder work — it is a **decision**: per-tenant chains, or accept that a restore
silently re-blesses tamper evidence for everyone. That belongs to you, not to me
at the end of a long session.

---

## C. WHAT SHIPPED — 3 ADAPTERS

### The store-side seam

`snapshotForGrant(grant)` / `mergeForGrant(grant, rows)` on `DecisionStore`,
`AutomationStore`, `HealthHistoryStore`.

They live **on the store** because the store owns its collection and its
serialization — an adapter reaching into a private field from outside would be a
second copy of that knowledge, and the two would drift.

**Both take a `TenantReadGrant`**, the branded type only `authorizeTenantRead`
mints. So these are not unscoped reads anything can call: the authority is in the
type. `onlyMine` remains the seam for every ordinary caller, unchanged.

The merge updates memory **before** the write, because `persist()` serializes
from memory — a disk-only merge would be erased by the next ordinary write, which
is exactly what `requiresRestart` exists to flag.

### `backup/tenantDomainSources.ts`

Factories over instances, not module-level registration, so the composition root
decides what is registered and a test wires the same code the product runs.
`ownerOf` returns `null` for an unowned row — pre-migration rows belong to nobody
and must never be restorable, the same fail-closed direction `TenantOwnership.mine`
takes.

### Tests — 8, against real stores on real files

`round15ProductionAdapters.test.ts`: A's archive holds A's decisions and the
bytes contain no `org-b`/`org-c`; per-domain archive counts equal live per-tenant
counts; restore rolls A back while B and C keep 3 and 1; **the merge reaches disk**
(a fresh store over the same file sees it); the relabelled manifest is caught by
`ROW_OWNER_MISMATCH`; and two-domains-one-corrupted writes nothing.

| Control | Result |
|---|---|
| **NC-F22-PROD** — production `mergeForGrant` becomes whole-collection replacement | **2 fail**: `expected [] to have a length of 3` — B's and C's decisions destroyed |

**Program total: 19 discriminating negative controls.**

---

## D. WHAT I DID NOT DO

- **15 of 18 adapters.** Named above with the specific blocker for each.
- **Channel→store coverage** — still seeded, not complete. Second round running.
  I chose adapters over breadth again.
- **Everything runtime.** Ten gates, unchanged.

---

## E. AUTOMATED VERIFICATION

| Gate | Round 14 | **Round 15** |
|---|---|---|
| Desktop main | 672 / 6993 | **673 files / 7001 tests, 0 fail** |
| Typecheck node / web | 0 / 0 | **0 / 0** |
| Lint | clean | **clean** |
| Negative controls | 18 | **19** |
| Renderer/shared, 46 workspaces, both builds | PASS on Mac | **re-run on the Mac** |

No test disabled, no assertion weakened, **no existing test changed** — this
round is additive.

---

## F. CERTIFICATION GATE

| | |
|---|---|
| HIGH / Security MEDIUM | 0 / 0 |
| M-13 / M-14 | CLOSED |
| Retention / resolver / authority | PASS |
| Channel→store mechanism | PASS, **coverage partial** |
| **F22** | **OPEN — 3/18 adapters** |
| Desktop suite / typecheck / lint | PASS |
| Negative controls | PASS (19/19) |
| 10 runtime gates | **NOT TESTED** |

# PROGRAM 13C — STATUS: NOT CERTIFIED

**BLOCKER 1 — F22 adapters, 15 remaining.**
*File:* `backup/tenantDomainSources.ts` + the stores in §B.
*Required action:* `workforce-jobs` next (mechanical, watch `order[]`), then
`assistant-conversations` (needs `AssistantSubsystem` widened),
`companion-device-registry` and `workspace-directory` (different owner fields).
Then the five that need a decision first: audit-log chaining, connector
workspace→org join, org-directory's four collections, and the four bespoke
domains from the Round 12 audit.
*Required test:* `tenantArchiveCoverageGaps()` returns `[]` with real stores.

**BLOCKER 2 — channel→store coverage.** Unchanged.

**BLOCKER 3 — the ten runtime gates.** Unchanged. Requires a person driving the
application.

---

## G. AN HONEST NOTE ON PACE

Five rounds: 19 MEDIUM closed, HIGH 0 since Round 10, 19 negative controls, two
structural invariants that ask questions the program previously could not, and
F22 taken from "not attempted" to "3/18 wired with the mechanism proven".

But this round produced **three adapters where the plan said ten**, and the
reason is that the plan was mine and it was optimistic. The same optimism is
visible in the brief you wrote from it. If the next brief says "finish the
remaining 15", the honest forecast is: four more are genuinely mechanical, five
need a design decision from you first, and the rest are the bespoke four the
Round 12 audit already flagged.

The runtime gates have now been the top item for five consecutive rounds and have
not moved, because nothing I do can move them. **An afternoon on the Mac retires
ten of them.** That is the single highest-value action available to this program,
and it has been available since Round 11.
