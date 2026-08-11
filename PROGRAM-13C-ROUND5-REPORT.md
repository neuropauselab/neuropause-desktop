# Program 13C — Remediation Round 5

**Starting commit:** `dfa84ea`
**Branch:** `feat/understanding-holds-motion-system`
**Working tree:** CLEAN

---

## Verdict

**F6, F7, F8 and F10 are FIXED. All six unseamed stores are classified.**

**The fresh sweep found two new HIGH and four pieces of BREAKAGE I introduced
earlier in this same session. All are closed.** It also found two MEDIUM classes
that are **still open**, and corrected several claims in my own comments.

| Target | Status |
|---|---|
| **F6 federation migration fail-open** | **FIXED** — and the first version of the fix was itself unusable; see below |
| **F7 federation platform cache** | **FIXED** |
| **F8 delivered-watch suppression** | **FIXED** |
| **F10 cloud tenancy identity** | **FIXED** |
| Six unseamed stores | **CLASSIFIED** — 4 tenant, 1 workspace, 1 system-global |
| New HIGH from the sweep | **2 found, 2 closed** |
| **HIGH = 0** | **YES for this sweep** |
| **MEDIUM open** | **2 classes** — see below |

| Gate | Result |
|---|---|
| Tests | **720 files / 7318 tests, exit 0** (from 717 / 7281) |
| Tenancy suite | **39 files / 601 tests** (from 36 / 564) |
| Typecheck | green — all three workspaces |
| Lint | green |
| Desktop build | green |
| **Backend build** | **NOT VERIFIED IN THIS ENVIRONMENT** — esbuild host/binary skew in the Linux container. Run `npm run build` on the Mac. |
| **Mac runtime** | **NOT PERFORMED** |

---

## F6 — the migration fail-open, and the fix that was worse than the problem

### What it was

Round 4 gave federation records an owner and filtered every read on it. For trust
and shares that fails closed. For **governance policies** it failed OPEN: an
unowned policy dropped out of `listPolicies()`, `recordAction` evaluates that
list, so a pre-existing DENY rule silently stopped being consulted — and
`setPolicyEnabled` filtered on the same list, so nobody could turn it back on.

### The fix, and why the first version was unshippable

Legacy rows are now marked `migration_required` on load, counted, and governance
evaluation fails closed while any exist.

**Attributing them was not an option.** `addPolicy` stamped no owner and any
tenant could call it, so the data contains no evidence of who authored a given
row. Inventing one is the single thing a migration must never do.

**But the first version of this fix shipped a quarantine nobody could clear.** A
count channel, no way to learn the ids, no renderer surface — so on any upgraded
install `require_approval` would have been forced for every organization forever,
opening a pending delegated approval per call and dragging every tenant's
compliance to `warn`. A control nobody can resolve is not a control; it is an
outage with a security-shaped explanation.

Now: an administrator-only listing channel (`federation:manage`) returns the
quarantined policies so they can be claimed or discarded. The contents are
disclosed there and nowhere else — `FedClaimPolicy` returned the full policy on a
weaker channel, contradicting the design comment two files away.

**A claim in my own code that was untrue:** the comment said a legacy DENY rule
"stopped being ENFORCED". Nothing in the product consults governance before a
federated write — `FedShareResource` and `FedPublishArtifact` never call
`recordAction`. F6 gates the **ledger**, not any federated action. That materially
caps the severity of the whole F6 class and the comment now says so.

---

## F7, F8, F10

- **F7** — `FederationPlatformService`'s keyless, TTL-less memo is now a
  `TenantMemo`. Verified closed on both axes the sweep tested: sign-out (key
  becomes null, cell dropped) and an org switch that does not commit a workspace
  (both halves are in the key).
- **F8** — `deliveredWatch` is keyed `[tenantId, recId]` with a 24h TTL and a cap.
  The cap can evict across tenants, but eviction causes re-delivery, not
  suppression.
- **F10** — the org↔cloud-tenant mapping is real for the first time.
  `callerTenantId()` returned an `org_…` id and every call site fed it to a store
  keyed on `tnt_…`, so the scoped half of `TenancyStore` was **dead code** — and
  *any* isolation test on those channels passed vacuously. `listTenants` /
  `listIsolation` (namespaces, encryption key ids) are scoped; every project,
  team and worker path resolves ownership; `createTenant` stamps the caller
  instead of deriving an org id from a display name.

  My first version resolved the caller's cloud tenant as `listTenants()[0]`,
  which sorts home first — so `CloudSetTenantStatus` could never succeed for the
  seeded organization and a second provisioned tenant was invisible. The mapping
  helper returns a Set and its own comment warns against taking the first; the
  caller then took the first.

---

## The six unseamed stores

| Store | Classification | The single fact that decided it |
|---|---|---|
| `executionStore` | **TENANT** | `result` is the full output of an executed action |
| `erp/approvalStore` | **TENANT** | the primary key IS a tenant's document id |
| `enterprise/healthHistoryStore` | **TENANT** | `overall` is derived from one org's headcount and licence state |
| `enterprise/governance/governanceStore` | **TENANT** | chains and rules carry an `orgId` nothing read |
| `unified/sync/syncStateStore` | **WORKSPACE** | a connection is a workspace object |
| `workforce/install/installStore` | **SYSTEM-GLOBAL** | publisher-authored package metadata only |

Three were behavioural defects rather than missing declarations:

- **`healthHistoryStore` was keyed by CALENDAR DAY** — one row per day for the
  whole install, last-write-wins, so whichever tenant opened the Executive Center
  last that day *destroyed* the other's datapoint, and six subsystems then drew
  trend lines and forecasts from whoever wrote last. It is the store that looked
  most global — three primitives, no ids, no text — and was not.
- **`governanceStore.setChainEnabled(id)`** took a bare payload id, so a
  `governance:manage` holder in one tenant could disable the approval chain
  gating another tenant's documents.
- **`governanceStore`'s audit scope parameter** was optional with `undefined`
  meaning *every workspace*; two callers omitted it, so an install-wide count of
  a trail naming record ids surfaced through `commercial:read`.

**`installStore`'s system-global declaration is tested, not asserted** — a test
reads a stored record and proves no tenant-derived field exists. The declaration
also states its COST (a shared administration surface: a `workforce:manage`
holder can uninstall a package other tenants use), because that is the difference
between a declaration and a dismissal.

**One thing I did NOT do:** `syncStateStore.get()` is deliberately left
unfiltered. I added a filter and it broke live sync — the orchestrator writes
under a workspace principal and reads back through paths that resolve
differently, so the filter denied the writer its own row. Rather than ship a
plausible-looking check that fails the product, the boundary is applied where it
is unambiguous (`deadLettered()`), the rest is inherited from `connectorStore`'s
workspace filter, and that borrowed guarantee is written down. **`all()` is still
unfiltered and has no production caller** — the sweep caught that my comment
claimed both accessors were done when one was.

---

## The sweep — two new HIGH, both closed

### H-1 — `executionStore.replaceAll()` truncated install-wide at boot

`save()` was changed to `pruneOwn` and `replaceAll()` was not, so every boot that
found an interrupted session re-applied a flat newest-first `slice(0, 500)`. The
file is newest-first, so one tenant generating 500 sessions pushed another
tenant's rows past the cut and the next start deleted them permanently.

Found in the fix from four hours earlier, in the same file. **A retention cap is
a write, and there is always more than one of them.**

### H-2 — seven composed read models were still keyless

The largest surviving instance of the class `TenantMemo` was built for. Round 3
fixed eleven services *by name*, Round 4 fixed a twelfth, and these seven had the
identical shape: `let cache` behind a 3s TTL, flushed only on
`onWorkspaceSwitch` — which cannot see `forEachTenant` running each tenant's
`produce()` back to back with no switch announced. An interactive read from
another tenant inside the TTL returned the composed operations, insight,
analytics, strategy, automation, twin or knowledge dashboard of whoever ran last.

All seven now hold a `TenantMemo` with the scope **injected**, not imported —
importing `activeTenantScope` drags Electron into a pure-model test, a trap this
program has now hit **four times, once per round**. It is written down as a rule
in each file rather than a note.

---

## Still open

**MEDIUM (2 classes):**

1. **Twelve process-wide dedupe sets** (`operationsPlatform`, `digitalTwin`,
   `strategy`, `automation`, `analytics`, `knowledgeAssets`, `insight` ×4,
   `dataPlane/relationshipStore`) keyed on bare recommendation/incident ids and
   consumed by the same per-tenant fan-out F8 was fixed for. The first tenant
   claims each id permanently; every other tenant's identical critical alert is
   suppressed forever, with no TTL and no cap. Cross-tenant **suppression**, not
   disclosure. This is F8 again, in twelve places, and it is the item I would take
   first.
2. **`syncStateStore.all()`** unfiltered (latent, no caller); **`M365ActionExecute`**
   reaches sync state with a payload `accountId`, guarded only by every shipped
   action declaring a non-empty scope; **governance audit** partitions on
   `workspaceId` alone, so rows stamped with an empty workspace merge under a
   non-per-workspace background principal.

**Also open:** `TenancyStore.homeTenant()` is unscoped and used at boot to bind
SSO connections and API deployments to the seeded org's cloud tenant — the F10
boundary does not extend to those two subsystems. And the Executive Center's
monthly trend reports `-100%` for every tenant because `composed` is read before
it is assigned (pre-existing; this session made it per-tenant so it now fires
independently for each).

**LOW (3), reviewed as required:** `sharedOut`/`sharedIn` counts on a visible
directory row — real, bounded to organizations you already federate with, left as
documented; install-wide DR writes — accepted, `drStore` is declared
system-global with a reason that survives inspection; artifact verification
self-attestation — a platform verifier role is a product decision, recorded.

---

## Claims in my own code the sweep found untrue

Recorded because a confident comment is read as evidence, which is how federation
went five sweeps unexamined:

- "a pre-existing DENY rule silently stopped being ENFORCED" — nothing enforces;
  F6 gates the ledger.
- "a COUNT and not a listing… not to disclose their contents" — `FedClaimPolicy`
  returned the contents.
- "the boundary is applied to the two install-wide accessors below" — one of two.
- `createTenant` "is both the security fix and the thing that makes the feature
  work" — not for the seeded organization.
- "bind before load: the seed stamps chains and rules" — `applySeed` copied a
  constant.
- `executionStore`'s header implied the file-level install-wide cap was gone —
  `replaceAll` still had it.

All six are corrected in place.

---

## What this round establishes about method

**1. A test that asserts an empty list is weak twice over.** My own test asserted
a non-seeded organization had zero approval chains and zero compliance rules, and
I read that emptiness as isolation working. It was the breakage — every
organization but the seeded one was ungoverned, and the compliance score returned
a perfect 100% because it divides by an evaluated count of zero. The test now
asserts both that A *has* governance and that it cannot touch B's.

**2. A fix can be less shippable than the defect.** The first F6 quarantine was
correct and unclearable. Security work that takes the product down gets removed,
and then the defect is back with a story attached.

**3. Four rounds, four repeats of the same import trap.** Every round has pulled
`activeTenantScope` into a pure-model file and broken its node test. It is now
written as a rule in each of the seven files rather than rediscovered.

### Before the next certification attempt

1. The twelve dedupe sets — F8 in twelve places.
2. `homeTenant()` and the two subsystems bound through it.
3. The Executive Center `-100%` trend.

Program 13C remains the tenant operating security gate. **It is not green, and
this session does not certify it.**
