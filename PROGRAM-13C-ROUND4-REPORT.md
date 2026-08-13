# Program 13C — Remediation Round 4 (Federation)

**Starting commit:** `268cb3a`
**Branch:** `feat/understanding-holds-motion-system`
**Working tree:** CLEAN

---

## Verdict

**S-10 is FIXED.** Federation now has a tenant dimension, built as a relationship
model rather than an ownership model.

**HIGH IS NOT ZERO.** The mandated fresh sweep found **five new HIGH**. All five
are closed in this commit. It also found **six MEDIUM and three LOW**, of which
two MEDIUM are closed and **four MEDIUM and three LOW remain open**.

So the required outcome — *S-10 fixed AND all newly discovered cross-tenant HIGH
= 0* — **is met for HIGH**, and this session does **not** certify Program 13C.

| Target | Status |
|---|---|
| **S-10 Federation tenancy** | **FIXED** |
| Federation HIGH found by the sweep (F1, F2, F3, F4, F9) | **all 5 CLOSED** |
| Round 3 MEDIUM #1 `setPlan` install-wide | **FIXED** |
| Round 3 MEDIUM #3 livesync `applyRemote` | **FIXED** |
| Round 3 MEDIUM #5 AI destination ungated | **FIXED** |
| Round 3 MEDIUM #4 `holdStore` | **NOT A DEFECT** — verified already scoped |
| Round 3 MEDIUM #2 gateway audit retention | **DOCUMENTED**, structurally bounded |
| Unseamed-store backlog | **PARTIALLY** triaged — 2 declared, 6 still open |
| **HIGH = 0** | **YES for this sweep** — 4 MEDIUM + 3 LOW remain |

| Gate | Result |
|---|---|
| Tests | **717 files / 7281 tests, exit 0** (from 716 / 7266) |
| Tenancy suite | **36 files / 564 tests** (from 34 / 508) |
| Typecheck | green — `packages/shared`, `apps/desktop`, `apps/backend` |
| Lint | green |
| Desktop build | green |
| **Backend build** | **NOT VERIFIED IN THIS ENVIRONMENT** — esbuild host/binary skew in the Linux container. Run `npm run build` on the Mac. |
| Mac runtime verification | **NOT PERFORMED** |

---

## S-10 — federation had no tenant dimension

### What it actually was

Not an IDOR to patch. `FederationRuntimeStore` and `GlobalGovStore` each took
their home organization as a **constructor argument**, wired to the seeded
`ORG_ID`. Home was a property of the machine, so:

- `listOrgs()` returned the install's organization directory — on a multi-tenant
  machine, the names, slugs and regions of every other customer, before any
  federation existed between them.
- `listInvitations()`, `listTrust()`, `listShared()`, `listArtifacts()`,
  `listPolicies()`, `listApprovals()` and `listAudit()` each returned everything.
- `revokeShare(id)`, `respondInvitation(id)`, `rollback(artifactId)`,
  `setVerification(...)`, `setScope(...)`, `publishVersion(...)`,
  `setPolicyEnabled(id)` and `resolveApproval(id)` each acted on a bare payload
  id.
- The publish handler passed the literal `ORG_ID` as `publisherOrg` — so every
  tenant's artifact was **Ed25519-signed** as the seeded organization. A forged
  attribution, cryptographically attested.

The file's own doc comment said *"tenant isolation is strict"*. That sentence is
left in the history rather than deleted: a confident comment is read as evidence,
and it is a large part of why five sweeps never opened this file.

### The trap the fix had to avoid

The obvious move is to stamp `tenantId` on every federation row and filter. That
produces a system where federation cannot federate: A shares a resource with B
and **B cannot see it** — isolation that looks correct and is a broken product,
which someone then "fixes" by removing the filter.

### What replaced it

`FederationBoundary` — relationship scoping. A federation record names **two**
organizations and the caller must be one of them.

- Invitations already carried `fromOrg`/`toOrg`. Trust and shares gained
  `ownerOrg` beside their existing `peerOrg`. Governance approvals and audit
  entries were already two-party and simply unfiltered.
- The org **directory is derived** from relationships rather than listed: you
  learn another organization exists when a record names you both.
- Fields that are **relative to the viewer** — a share's `direction`, an
  invitation's `direction`, a trust row's `peerOrg`, an org's `role` — are
  re-derived per caller. A stored value cannot be relative, and every one of
  these was stored.
- Artifact visibility follows the publisher's **scope**: `private` (publisher
  only), `partner` (organizations with trust to the publisher), `regional`
  (matching region, two-way), `public` (any organization). An unresolved caller
  sees nothing, including public artifacts.
- **Installation records the installer without rewriting the publisher.** The
  aggregate `installs` count stays — an ordinary marketplace signal — while
  *which* organizations installed is visible only to each installer.

### Tests

`tenancy/e2e/federationTenancy.test.ts` — **41 tests, three organizations.**

Three and not two, for a specific reason: with only A and B, "A can see the A↔B
share" and "everyone can see everything" produce identical output. **C** is a
real signed-in tenant related to nobody, and every C assertion is the assertion
that a relationship between two parties is not a disclosure to a third.

---

## The sweep — five new HIGH, all closed

Two were in code written this session.

### F1 — the sender could accept its own invitation (HIGH)

Party membership was **necessary and not sufficient**. `respondInvitation`
resolved the row for either side, so a sender could accept its own invitation —
manufacturing a mutual relationship with no consent from the other organization.

Combined with `inviteOrg` deriving the target id from a caller-supplied display
**name**, tenant C could invite "Default", accept on its behalf, and hold a
full-trust relationship with `org-default`: overwriting that organization's
directory row with attacker-chosen values, and making every `partner`-scoped
artifact it had ever published visible to C.

**The certification suite for this very fix was built on the bypass.** Its
fixtures called `respondInvitation` as the sender to establish trust. A test that
uses a hole to reach its precondition cannot detect that hole, and it passes
forever. The fixtures now accept as the recipient, which is also what the product
does.

Accept is recipient-only; a separate `revokeInvitation` gives the sender the
withdrawal it legitimately needs. Splitting them is the point — collapsing two
different authorizations over one row is how the hole existed.

*Closing this surfaced a second bug it had been masking:* the acceptor's own
directory row was never created, so after a legitimate accept neither side
appeared in the other's `listOrgs()`. Invisible while the sender could
self-accept, because the sender happened to create the row it needed.

### F2 — `rate()` returned the unredacted artifact (HIGH)

It used `visible()` as a boolean and then re-read the raw map entry, so the
response carried `installations` for **every** organization. `rate` is
deliberately open to any org that can see an artifact — which is exactly what made
it the reachable one: a five-star rating on any public package returned a
cross-customer list of who uses it, with timestamps and pinned versions.

`publishVersion`, `setVerification`, `setScope` and `rollback` had the same shape
with a narrower radius. That is the version of this bug that survives review:
four callers looked fine because the fifth was the only one an outsider could
reach.

### F3 — `recordAction` took `peerOrg` from the payload (HIGH)

Every other write in the governance store checks party membership on an
**existing** record. This one **creates** the record and let the payload choose
the second party. One call wrote attacker-controlled `action`, `peerOrgName` and
`detail` permanently into an unrelated organization's federated audit trail; a
self-authored `require_approval` policy then inserted a pending delegated
approval into that organization's queue, moving its compliance score.

An audit trail a stranger can append to is not evidence. The peer is now
validated against the caller's real relationships.

### F4 — `KnowledgeFabricService` keyless snapshot under the fan-out (HIGH)

The exact shape Round 3 fixed in eleven sibling services — and it was not in the
list of eleven. Keyless snapshot, 3s TTL, protected only by `onWorkspaceSwitch`,
which this program has already documented as insufficient against
`forEachTenant`: the delivery engine runs a knowledge-assets pass once per tenant,
back to back, announcing no switch.

**The lesson is about the sweep, not the code.** Round 3 fixed the eleven
services a review named and did not go looking for a twelfth with the same shape.
A list of instances is not a definition of a class.

### F9 — `packsStore` had no seam and an unrecoverable cross-tenant delete (HIGH)

`publish()` stamped `publisherOrgId` from the seeded `ORG_ID` — every row *looked*
owned and the value was a constant nothing read back. `list()`/`stats()` returned
every organization's packs (which carry real content: documents, workers,
automations, connector definitions); `importPack(id)` mutated another tenant's
counters; `remove(id)` was `packs.delete(id)` on a bare id.

It was also conspicuously **absent from the binding block that binds its three
siblings** while being loaded beside them — what an omission looks like when
nothing enforces the list.

---

## Round 3's remaining MEDIUMs

| # | Outcome |
|---|---|
| `developerStore.setPlan` install-wide | **FIXED.** Plan tier is now per organization. `runGateway` derives rate limit and quota from it, so one tenant setting `'free'` collapsed another's production API limits — a cross-tenant denial of service through a config write. |
| livesync `applyRemote` org mismatch | **FIXED.** The pull loop now drops a change whose `orgId` differs from the org it pulled for. The guard already existed one layer down for a single entity type; applying it at the loop covers every type instead of the one somebody remembered. |
| AI destination ungated | **FIXED.** Five `ai:config.set*` channels moved off the PUBLIC allowlist to `org:manage`. The payload was correctly scoped; the destination was not. The allowlist's own comment said "revisit if any becomes multi-tenant" — it had. |
| `holdStore` unscoped | **NOT A DEFECT.** Verified: every accessor already routes through the base class's scoped `visible()`. Round 3's sweep was wrong on this one, which is worth recording — a finding list is not evidence either. |
| gateway audit retention | **DOCUMENTED.** Structurally bounded by the hash chain, which permits dropping only from the front. Round 3 raised the floor to scale with tenant count; full fairness needs a per-tenant chain. |

---

## Still open

### MEDIUM (4)

- **F6 — no migration for pre-Round-4 federation rows, and it is fail-OPEN on
  policies.** `ownerOrg` is optional, and `load()` stamps nothing. For trust and
  shares this is fail-closed. For **policies** it is not: an unowned policy drops
  out of `listPolicies()`, and `recordAction` evaluates that list — so on an
  install predating this session, every pre-existing rule including `deny` rules
  silently stops being enforced, and nobody can re-enable it. This is the one I
  would fix first.
- **F7 — `FederationPlatformService`'s memo is keyless, has no TTL, and is
  invisible to the startup gate.** No live background path found into it, so not
  rated HIGH; but sign-out does not invalidate, an org switch that does not commit
  a workspace does not invalidate, and with no TTL a stale snapshot persists
  indefinitely. The last keyless composed cache over federation data.
- **F8 — `enterpriseFederation`'s `deliveredWatch` set is shared across tenants.**
  The first tenant in the fan-out claims a recommendation id and every other
  tenant's identical-id item is suppressed permanently. Cross-tenant
  *suppression*, not disclosure, plus an unbounded set.
- **F10 — cloud tenancy lists are install-wide** (`listTenants`,
  `listIsolation`) on `cloud:read`, including namespaces and encryption key ids.
  With a sharp corollary: `callerTenantId()` returns an **organization** id while
  `TenancyStore` keys tenants as `tnt_…`, so the two id spaces never intersect —
  the scoped half of that store is dead code, and **any isolation test of the form
  "B cannot read A's project" on those channels passes vacuously.**

### LOW (3)

`sharedOut`/`sharedIn` counts on a visible directory row; install-wide DR writes
reachable by any tenant; artifact verification self-attestation (a publisher can
still mark its own artifact `official` — a platform verifier role is a product
decision).

### Unseamed-store backlog

Two declared system-global with written reasons this round (`federation-dr`,
`federation-observability`). Six remain untriaged: `erp/approvalStore`,
`enterprise/healthHistoryStore`, `unified/sync/syncStateStore`,
`workforce/install/installStore`, `executionStore`, and
`enterprise/governance/governanceStore`.

---

## Two structural notes that bound what any test here can prove

1. **Real federation between two UI-created organizations is not currently
   expressible.** `inviteOrg` derives the target id from a display name and can
   only produce hyphen-slugs; `createOrganization` mints `org_${uuid}`. So the
   only ids the federation runtime can address are `org-default` and demo
   fixtures. That bounded F1's blast radius — and it means any A↔B relationship
   in a test exists against a slug-addressable org, which is worth knowing before
   reading such a test as evidence.
2. **`ORG_ID` is out of the authorization path under `federation/`** — it remains
   only inside `applySeed` in both stores.

---

## What this round establishes about method

**1. A test that exploits a hole to reach its precondition cannot detect that
hole.** F1 is the cleanest example this program has produced: a 41-test
certification suite, green, built on the bypass it existed to disprove.

**2. Closing a hole reveals the bugs it was masking.** Making accept
recipient-only immediately exposed a missing directory row that had been invisible
because the sender happened to create the row it needed.

**3. A list of instances is not a definition of a class.** Round 3 fixed eleven
memoised projections by name and left a twelfth with the identical shape.

**4. A finding list is not evidence either.** Round 3's sweep reported
`holdStore` as unscoped. It was already fully scoped. Checking cost minutes;
"fixing" it would have added noise and false confidence.

### Before the next certification attempt

1. **F6** — stamp or explicitly retire pre-Round-4 federation rows. The
   fail-open on governance policies is the sharpest item on this list.
2. F7, F8, F10.
3. Triage the six remaining unseamed stores.
4. Re-run the certification suites, then a fresh sweep.

Program 13C remains the tenant operating security gate. **It is not green, and
this session does not certify it.**
