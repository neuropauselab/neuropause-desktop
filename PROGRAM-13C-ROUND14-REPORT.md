# PROGRAM 13C — ROUND 14 REPORT

## VERDICT

# NOT CERTIFIED

**F22 is no longer architecturally blocked — but it is not closed.** The
mechanism exists, is tested, and refuses the attacks. What it does not yet have
is adapters for all eighteen domains, and the archive says so in its own manifest
rather than pretending otherwise.

Three gates remain:

1. **F22 coverage: 0 of 18 production adapters registered.** The architecture,
   manifest, integrity model, merge-restore and rehydration signal are built and
   proven against fixtures spanning the owner conventions. Registering the real
   stores is the remaining work, and it is now mechanical and measured. §C.
2. **Channel→store coverage is still partial.** I did not extend it this round —
   I chose F22 over breadth and said so upfront. §E.
3. **Ten runtime gates require a launched application.** Unchanged. §F.

---

## A. REPOSITORY

| | |
|---|---|
| Branch | `feat/understanding-holds-motion-system` |
| HEAD at open | `49a87c8` (Round 13) |
| Worktree | clean at open |
| Verification | Linux container. **macOS gates are yours to run.** |

**Sequencing deviation, stated.** Your order was channel coverage → F22. I
inverted it: F22 is on the certification gate, channel coverage is breadth that
retires nothing. If only one finished, it had to be F22.

---

## B. WHAT F22 NOW IS

### The primitive — `authorizeTenantRead` / `onlyFor`

Round 12 identified the missing piece precisely: `TenantOwnership.onlyMine()`
reads the **ambient** scope, and there is no `onlyFor(tenantId)`. A backup of
tenant A must be producible while nobody is signed in as A, and must not be
steerable by whichever organization is on screen.

`onlyFor` takes a **`TenantReadGrant`** — a branded type that cannot be
constructed literally, cast from a string, or widened. The only way to obtain one
is `authorizeTenantRead(principal, tenantId)`, which refuses unless the principal
is that tenant or a platform operator. So the grep for *"who can read another
tenant's rows out of band"* has exactly one answer, and it is an audited act
rather than a parameter.

Refusals use one message for "not yours" and "no such tenant" — the same oracle
rule `orgStore`, the runtime supervisor and `inviteOrg` already follow.

### The archive — adapters, not a base class

`tenantOwnedStore.ts` says in its own header that these stores *"share NO base
class at all"*. So `TenantDomainSource` is an **adapter**: each store keeps its
own filter and file format and contributes `ownerOf` / `snapshot` / `merge`. A
generic filter would have to understand four owner conventions
(`tenantId`+`workspaceId`, `tenantId`, `MemoryOwner`+`sync.orgId`, `orgId`, plus
the timeline's scope buckets) and would get one of them wrong.

### The honesty mechanism — the part that matters most

Round 12's warning was that a partial tenant archive is **more dangerous than
none**: it looks like "tenant A's backup" while silently omitting A's memory,
graph and ERP records. That is why I declined it twice.

What changed is not that the work got smaller. It is that coverage is now
**declared**:

- `TENANT_DERIVED_DOMAINS` — the denominator, all 18, named.
- `uncoveredDomains` and `complete` — manifest fields on **every** archive.
- `tenantArchiveCoverageGaps()` — what is missing, by name.
- A gate test asserting `covered + gaps === 18`, plus a guard on the denominator
  itself so shrinking the list cannot fake completeness.

An archive can no longer imply a completeness it does not have. That is the
difference between incomplete and dishonest.

### Integrity — per domain, not whole-file

A whole-file sha256 cannot validate a merge: the file it hashed will legitimately
differ once another tenant writes. Integrity is computed per domain over that
tenant's rows, via a canonical serializer with deterministic key ordering —
because a hash that varies with Node's key order fails for the wrong reason, and
an integrity check that cries wolf gets disabled.

### Restore — merge, pre-flighted, with a restart signal

Validation order is schema → tenant → integrity → row-owner → presence, and
**nothing is written until every check on every domain passes**. A refusal never
half-restores.

`requiresRestart` is set when any merged store holds its collection in memory.
Round 12 found the latent version of this: `persist()` writes the whole
collection, so a disk-level restore is reverted by the next live write. Whole
install restore had the same problem and no signal; per-tenant restore makes it
**certain**, because it is precisely the case where other tenants stay live.

---

## C. TWO DEFECTS MY OWN TESTS FOUND — AND THIS IS THE USEFUL PART

Both were in my first draft, both were caught by writing the adversarial cases
before believing the code.

**1. The archive aliased live state.** `createTenantArchive` stored the array the
source returned. An adapter handing back live objects produced an "archive" that
mutated along with the store — so the integrity hash failed for the wrong reason,
and a backup tracked the data it was supposed to preserve. Fixed by cloning at
snapshot time, once, rather than trusting eighteen adapters to remember.

**2. Relabelling the manifest defeated the tenant check.** Editing
`manifest.tenantId` from `org-b` to `org-a` produced a **self-consistent**
archive — the hashes still matched, because the rows were never touched — and an
operator holding a grant for A could restore B's archive. The only thing saying
"this is A's" was the string the attacker had just edited.

That is the Round 10 lesson recurring inside my own code: *a scope field is not
ownership*. Closed with `ownerOf(row)` on the adapter: the manifest says whose
archive it **claims** to be, the rows carry the **proof**, and restore requires
both. Refusal `ROW_OWNER_MISMATCH`.

---

## D. TESTS AND NEGATIVE CONTROLS

`round14TenantArchive.test.ts` — **22 tests**: grant authorization and its oracle
behaviour; A/B/C archives containing only their own tenant (asserted by scanning
the bytes for foreign ids); per-domain counts and hashes; declared coverage;
merge preserving other tenants byte-for-byte; cross-tenant restore denial in both
directions; and seven tamper cases — relabelled tenant, edited record, added
record, wrong schema, missing domain, unregistered domain, and a
one-bad-domain-aborts-everything case proving no partial write.

| Control | Result |
|---|---|
| **NC-F22-RESTORE** — merge becomes whole-collection replacement (today's `fs.copyFile`) | **FAILS**: `expected '[]' to be '[{"id":"b1","tenantId":"org-b"…]'` — B's rows destroyed |
| **NC-F22-OWNER** — drop the row-owner pre-flight | **FAILS**: the relabel attack succeeds |

**Program total: 18 discriminating negative controls.**

---

## E. WHAT I DID NOT DO

**Channel→store coverage was not extended.** Still seeded, not complete. Stated
plainly because the Round 13 report promised this as the next increment and I
chose F22 instead. The mechanism and its rules are unchanged and still pass.

**No production adapters are registered.** The 22 tests exercise the mechanism
against fixtures modelling the ERP (`tenantId`) and memory conventions. **Zero of
eighteen** real stores are wired. The archive reports `complete: false` and names
all eighteen as uncovered, which is correct and is the point — but it means F22
delivers no tenant backup in production yet.

I am not going to describe that as "F22 closed". It is F22 *unblocked*: the hard
parts — the authorized read primitive, the four-convention adapter shape, the
merge-restore, per-domain integrity, the restart signal, and the coverage
invariant — exist and are proven. What remains is eighteen adapters, each small,
each now measured.

---

## F. AUTOMATED VERIFICATION

| Gate | Round 13 | **Round 14** |
|---|---|---|
| Desktop main | 670 / 6966 | **672 files / 6993 tests, 0 fail** |
| Typecheck node / web | 0 / 0 | **0 / 0** |
| Lint (`apps/desktop/src` + `packages/shared/src`) | clean | **clean** |
| Negative controls | 16 | **18** |
| Renderer + shared, 46 workspaces, both builds | PASS on Mac | **re-run on the Mac** |

No test disabled, no assertion weakened. **No existing test needed changing this
round** — the new code is additive.

---

## G. CERTIFICATION GATE

| | |
|---|---|
| HIGH / Security MEDIUM | **0 / 0** |
| M-13 / M-14 | CLOSED |
| Retention / resolver / authority invariants | PASS |
| Channel→store invariant | PASS, **coverage partial** |
| **F22** | **OPEN — architecture built, 0/18 adapters registered** |
| Desktop suite / typecheck / lint | PASS |
| Negative controls | PASS (18/18) |
| 10 runtime gates | **NOT TESTED** |

# PROGRAM 13C — STATUS: NOT CERTIFIED

**BLOCKER 1 — F22 adapter coverage.**
*Root cause:* 0 of 18 `TenantDomainSource` adapters registered; archives correctly
report `complete: false`.
*File:* `backup/tenantArchive.ts` (mechanism), the 18 stores (adapters).
*Required action:* register adapters, starting with the ~10 mechanical
`tenantId` stores, then memory / graph / unified / timeline / governance.
*Required test:* `tenantArchiveCoverageGaps()` returns `[]`, and an A/B/C archive
round-trip across all 18 domains against real stores.

**BLOCKER 2 — channel→store coverage.**
*Root cause:* declarations seeded, not wired across the sensitive IPC surface.
*File:* `ipc/channelResource.ts` + handler modules.
*Required test:* an undeclared sensitive channel fails composition.

**BLOCKER 3 — the ten runtime gates.**
*Root cause:* they require a launched application driven by a person.
*Required action:* Phases 18–27 on your Mac.
*Required test:* the A/B/C matrix verified against persisted state, not response
codes.

---

## H. HONEST ASSESSMENT AFTER FOUR ROUNDS

Rounds 11–14: **19 MEDIUM closed**, HIGH 0 since Round 10, **18 discriminating
negative controls**, two structural invariants built that ask questions the
program previously could not (correspondence, and tenant-archive coverage), and
F22 taken from "not attempted, not contained" to "built and measured".

The pattern across the last two rounds is worth naming, because it is different
from the earlier ones. Round 13's findings came from **comments contradicting
each other**. Round 14's two findings came from **my own first draft**, caught by
adversarial tests written before trusting the code. The external attack surface
is not producing new findings; the remaining risk is in **unfinished work** and
in **an application nobody has run three tenants through**.

Neither is a reason for another audit round. F22 adapters and the Mac are the
whole remaining list.
