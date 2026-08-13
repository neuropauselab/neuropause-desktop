# Program 13C — Remediation Round 3

**Starting commit:** `03a5c12` (the Round 2 report, on top of `b82c049`)
**Branch:** `feat/understanding-holds-motion-system`
**Working tree:** CLEAN

---

## Verdict

**H-1, H-2 and H-3 are FIXED and independently verified. All tenant seams are
now registered. The migration inventory has been corrected and is tested.**

**HIGH IS NOT ZERO, so the required outcome of this session was not reached and
Program 13C is not ready for certification.**

The mandated fresh sweep, run after the planned work was complete, found **six
new HIGH**. Five of them are now closed. **One remains open**: the `federation/`
subsystem has no tenant dimension at all, which is a subsystem-scale piece of
work rather than a fix.

| Target | Status |
|---|---|
| **H-1 Process mining cache** | **FIXED** |
| **H-2 Memoised projections (11 services + 2 providers)** | **FIXED** |
| **H-3 Developer / API keys / OAuth / billing / gateway audit** | **FIXED** |
| **Universal tenant-store registration** | **DONE** — 0 unregistered seams |
| **Migration inventory corrected** | **DONE** — and now under test |
| **HIGH = 0** | **NOT REACHED — 1 HIGH open** |

| Gate | Result |
|---|---|
| Tests | **715 files / 7225 tests, exit 0** (from 710 / 7156) |
| Tenancy suite | **34 files / 508 tests** (from 29 / 439) |
| Typecheck | green — `packages/shared`, `apps/desktop`, `apps/backend` |
| Lint | green |
| Desktop build | green |
| **Backend build** | **green — verified natively on macOS at this commit** |
| Mac runtime verification | **NOT PERFORMED** |

### Backend build

`npx tsup` fails in the Linux sandbox with `Host version "0.27.7" does not match
binary version "0.21.5"` — an esbuild host/binary skew in the container, the same
fault the previous two rounds hit. It is an environment problem, not a code one,
and the report initially declined to call it green for that reason.

It has since been run natively on macOS at commit `943dad8` and reports
`CJS ⚡️ Build success in 74ms`. Recorded here as direct evidence on this commit,
not inherited from an earlier round.

**Mac RUNTIME verification is a different claim and remains NOT PERFORMED.** The
application has not been launched; nothing here says the tenant boundary behaves
correctly against a real two-organization install driven through the UI.

---

## H-1 — the process-mining cache

### A count is not an identity

The cache held the materialised records of **thirteen tenant-scoped module
stores** — leads, contacts, customers, quotes, orders, invoices, payments,
purchase requests and orders, goods receipts, stock movements, production orders,
schedules. Its inputs were already scoped, so a cache built while tenant A was
active held A's data, and it was then handed to whoever asked next.

The only thing between two tenants was a **cache-invalidation key mistaken for an
authorization check**: `signature()` joins each store's active record count with
colons, and a hit required all thirteen to match. Two tenants match that
trivially — identically on a fresh second organization, where every count is
zero. `getProcessCaseDetail` then resolved a payload `caseId` against whatever
cell was there, with no ownership check at all.

### What changed

- A `TenantMemo` replaces the `let cache`. Ownership and freshness are now two
  separate questions asked in that order; conflating them was the defect.
- `getProcessCaseDetail` checks the case is in the caller's own summaries. The
  keyed cell already makes a foreign id unfindable, but the check is written out,
  because "it cannot be in there" is a property of code somewhere else.
- A foreign case and an invented case both return `null`, so the refusal is not
  an existence oracle over another tenant's process ids.

### The documentation error

`migrationInventory.ts` said these caches had "a ~2.5s TTL". **Process mining
never had one.** That clause is why five successive sweeps read the entry,
concluded the exposure was bounded, and moved on.

The correction is in the inventory, and `migrationInventoryIntegrity.test.ts` now
asserts it. Notably it asserts on the **retraction**, not on the absence of the
phrase — a test that forced silence would let someone delete the history and pass,
losing the only durable record of how the finding stayed hidden.

---

## H-2 — memoised projections

### Two mitigations, both insufficient, for different reasons

Fourteen composed read models memoise a snapshot fanned out over dozens of
tenant-scoped stores. Two mitigations existed and neither is a boundary:

1. **TTL.** A 2.5–3 second window is not authorization. The renderer's reload
   after an organization switch lands inside it, which makes "switch org, open
   dashboard" — the most common multi-tenant action there is — the exploit.

2. **Switch invalidation.** This closes the interactive path and is worth
   keeping. It cannot see the background fan-out: `forEachTenant` runs a job once
   per tenant, back to back, under each tenant's own principal, **announcing
   nothing**. Tenant A's pass builds the memo; tenant B's pass reads it.

`backgroundFanOut.ts` runs those passes sequentially and its comment cites these
caches as the reason. That reasoning is wrong and is now corrected in place:
sequencing stops two tenants interleaving *inside* one build and does nothing
about a build surviving *between* two.

### What changed

`tenancy/tenantMemo.ts` — a tenant-keyed cell holding the snapshot **and its
projections**. The projections live inside the cell because they are derived from
it; keying the snapshot while leaving the derived values beside it would leak
exactly the composed, human-readable half.

Applied to **fourteen** caches: the eleven named services, plus `trustProvider`,
`relationshipProvider` and process mining. Each service's `scope` dep is
**required**, so a composition root that forgets it fails to COMPILE — stronger
than failing at startup.

Three deliberate non-choices, each recorded in the code:

- **No `onWorkspaceSwitch` listener inside `TenantMemo`.** After a switch the key
  differs and the cell recomposes on the next read, so the listener could not
  change an outcome — while permanently appending to a module-level array with no
  removal API. A no-op that leaks, added so the diff looks thorough, is the same
  species of mistake as the TTL.
- **The TTLs stay**, doing the job they can do: freshness.
- **`ttlMs` of 24h for process mining**, which has a better freshness signal of
  its own. A long TTL is now harmless, and that is the point.

---

## H-3 — developer, API keys, OAuth, billing, gateway audit

### One install was one customer

There is a single developer account per install (`dev-owner`, seeded to the
literal `ORG_ID`) and every key, application and usage row hung off its
`developerId`. Billing had one subscription, one seat pool, one licence ledger and
one purchase ledger, all stamped from the seed.

`License` and `MarketplacePurchase` both **carry** an `orgId`, written from
`this.seed.orgId` rather than the caller. That is the most dangerous shape a
tenancy defect takes: an auditor asking "do these rows have an organization?"
gets yes.

The consequences, worst first:

| | |
|---|---|
| `deleteApp(id)` | Bare payload id. Irreversible — the OAuth client secret existed exactly once. |
| `revokeKey(id)` / `rotateKey(id)` | Bare payload id. Cuts another tenant's live API access. |
| `releaseSeat(seatId)` | `seats.delete(id)`. Revokes another tenant's user's seat. |
| `setPlan(tier)` | Mutated the one shared subscription — downgrade another tenant's plan and seat cap. |
| `keysFor` / `appsFor` | Another organization's integration map: key names, prefixes, scopes, OAuth client ids, redirect URIs. |
| `usageFor` / `periodSpend` | One tenant's traffic counted against another's metered invoice. |
| `auditEntries` / `metrics` | Every tenant's gateway traffic, also exported as OTLP through `GET /observability/traces`. |

### What changed

- Keys, applications and usage rows carry `tenantId`; every listing and every
  id-taking mutation resolves ownership first.
- Subscriptions became one row **per organization**, created lazily on first
  read. A pre-Round-3 file upgrades by reading its single `subscription` under
  its own stamped `orgId` — no guess, no migration pass.
- Seats carry an owner; the seat cap counts the **caller's** seats (it counted the
  install, so one tenant filling its Free plan exhausted everyone's).
- Licences and purchases are stamped from and filtered on the authoritative
  tenant.
- Gateway audit entries carry an owner; the **output** is filtered and the array
  never is, because it backs an order-sensitive hash chain.

### The hash chain

`tenantId` is appended to the canonical hash form **only when present**. Adding a
field unconditionally would change the hash of every historical entry, so an
upgrading install would fail `verify()` on load and raise an integrity violation
**indistinguishable from real tampering** — the worst possible outcome for a
tamper-evidence mechanism. Pre-Round-3 rows now hash exactly as before; every new
entry covers its tenant.

`verifyAuditIntegrity` and `totalAudit` stay install-wide on purpose: they are
statements about the *chain*, and a per-tenant chain could not detect an entry
deleted from another tenant's section of the same file.

### Deliberately unscoped

`verifyKey`, `verifyAppCredentials`, `revokeToken`, `isTokenRevoked`. They resolve
a **presented credential**, which is what would establish a tenant, so a scoped
lookup there could only ever deny. Named for what they are; they answer no
listing.

---

## Phase 4 — universal tenant-store registration

### The gate covered five stores, not six

Round 2's report said six. **Five** was the true number, and
`executionStore.ts` — named in the design comment as one of the intended six —
has no seam at all. Correcting my own overclaim is part of this round.

### What changed

`registerTenantStore(name, () => this.hasScope())` — one line, for stores that
already own a working seam. Converting eighteen stores to hold a
`TenantOwnership` would have been a large refactor with a security change buried
inside it.

Placed on the **two abstract bases** (`PersistentStore`, `AppendOnlyJsonStore`),
so twelve concrete stores inherit registration and a thirteenth cannot be added
without one; plus the standalone seams; plus a single entry standing for all 106
enterprise module stores, whose predicate is `unscopedModules().length === 0`.

### The test that catches the next store

`tenantStoreRegistry.test.ts` scans the source tree for every class defining
`bindScope` and asserts each one's file registers, or appears in an allow-list
naming where its registration actually lives. It does not depend on the store ever
being constructed in a test.

**It immediately found one I had missed** — `ProvenanceStore`, which lives in
`dataPlane/importer.ts` and is therefore invisible to a `*Store.ts` sweep. That is
precisely the failure mode it exists for.

**Seams found: 23. Unregistered: 0.**

### What registration does NOT do

It proves a store **has** a boundary, not that the boundary is **correct**, and it
cannot see a store with no seam at all — which is what every finding in this
program has actually been. The inventory now says so.

---

## Fresh adversarial sweep — six new HIGH, five closed

Run independently after the planned work. It verified H-1, H-2 and H-3 closed
line by line, and then found the following. Two are in code written **this
session**.

### CLOSED in this session

| # | Severity | Finding |
|---|---|---|
| **S-1** | MEDIUM | **`TenantMemo.projection()` could return tenant A's projection to a caller that is not A.** `state()` returned early for an unresolved caller *without clearing the cell*, and `projection()` read `this.cell` directly. The snapshot was keyed and the values derived from it were not — the exact defect the class exists to remove, one level down. Fixed twice over: `state()` now drops the cell, and `projection()` re-checks the key rather than trusting the call-order convention. |
| **S-2** | HIGH | **Companion LAN gateway: the RPC pull path ignored the device's bound tenant.** The push path was correct (`:418` filters on `boundTenantId`); `handleRpc` invoked the op with no principal, so every read resolved through the desktop's ambient scope. A phone paired under org A, after the user switches to B, received **B's records over a socket bound to `0.0.0.0`** — external egress — and `approvals.act` made it a cross-tenant write. Ops now run under a principal built from `device.boundTenantId`; an unbound device is refused rather than run ambiently. |
| **S-3** | HIGH | **`enterpriseFederation` composed cache, keyless, no switch listener.** Seven sibling subsystems with the identical shape all register one; this was the eighth. Now keyed. |
| **S-4** | HIGH | **`enterpriseIntelligenceSubsystem` composed report, keyless.** Sharper than S-3: the switch handler already flushed this report's two *inputs* and never the composition over them — and `knowledgeFabric` recomposes from it, so the stale tenant propagated a layer further. Now keyed. |
| **S-5** | HIGH | **Marketplace catalog snapshot: keyless and with NO TTL.** Invalidated only on a store `'changed'` event, which a tenant switch does not fire. The first organization to open the marketplace fixed the snapshot for every organization afterwards, **indefinitely** — tenant B saw which applications tenant A had installed and whether each was disabled. Not a three-second race. Now keyed. |
| **S-6** | HIGH | **`feedback/` had no tenancy and sat on the PUBLIC channel allowlist.** No auth, no permission. `feedback:list` and `:export` returned every organization's free-text feedback; `:exportToFile` wrote it to an arbitrary path **outside userData**; `:clear` destroyed all of it. Entries now carry an owner, reads filter, and the five channels moved to `dashboard:read` / `org:manage`. |
| **S-7** | MEDIUM | **My own H-3 usage-retention fix was incomplete.** It pruned per tenant and then fell back to an install-wide `slice()`. With two tenants under the cap each, the prune is a no-op and the fallback deletes the other tenant's oldest **billing** rows. The fallback quietly restored the defect the prune removed. Fallback deleted. |
| **S-8** | MEDIUM | **Gateway quota keyed by `developerId`.** One developer per install means one shared counter, and `decideGateway` denies on it — so A burning the monthly quota returned 429 to B. The invoice half was fixed by scoping the usage ledger; this was the **enforcement** half, missed because the two live in different files. Now keyed by tenant. |
| **S-9** | LOW | `developerPlatformService.templates()` — one call site of 79 skipped `state()` before `projection()`. Harmless today (static catalogue) and exactly the habit that stops being harmless. Fixed, and the primitive no longer trusts the convention. |

A tenth issue surfaced while fixing these and is worth recording on its own:
`bindScope(undefined)` set `scopeSource` to `undefined`, which is not `null`, so
`hasScope()` reported **true**, the startup gate **passed**, and reads threw
later. Passing every check and failing elsewhere is the worst of the three
possible outcomes. `bindScope` now throws, naming the store.

### OPEN — 1 HIGH

| # | Finding |
|---|---|
| **S-10** | **`federation/` has no tenant boundary at all.** `fedStore` and `exchangeStore` contain zero occurrences of `tenantId`, `orgId`, `scope` or `bindScope`. `listOrgs`/`listInvitations`/`listTrust`/`listShared`/`listArtifacts` return the whole install; `revokeShare(id)`, `rollback(artifactId)`, `setVerification`, `publishVersion` and `install` all take a bare payload id. Reachable under `federation:read` / `federation:manage`. `federation/index.ts:254` also publishes with `publisherOrg: ORG_ID`, so every tenant's artifact claims the seeded org — the same "row has an org field so it looks owned" shape as billing. This is a subsystem-scale tenancy addition comparable to H-3, not a patch, and I am not going to claim it in the last hour of a session. |

### Also open

**MEDIUM (4):** `developerStore.setPlan` is install-wide, so A can set B's gateway
rate limit and quota (the shared developer *account* survived the H-3 fix);
gateway audit retention scales with tenant count but is still front-first, so a
sufficiently noisy tenant can eventually evict a quiet one's rows — a per-tenant
chain would be needed and that is a bigger claim to change; livesync `applyRemote`
does not compare `change.orgId` against the org that was pulled (requires a
malicious or buggy backend, so not reachable by tenant A alone); `decisions/holdStore`
is unscoped and `HoldResolve` is a cross-tenant write under `governance:manage`.

**MEDIUM (1), egress:** the AI provider/credential/`ollamaUrl` is install-wide and
settable from an **ungated** channel. The *payload* is correctly tenant-scoped;
the *destination* is not. The allowlist's own comment says "revisit if any becomes
multi-tenant" — it has.

**LOW (3):** webhook delivery-stats broadcast computed under the delivery's
principal (counters only); `backup:create` ungated; `insight` `lastTrendBand`
carries across tenants.

Plus the stores with tenant content and no seam that Phase 4 makes visible but
does not fix: `erp/approvalStore`, `federation/governance/globalGovStore`,
`federation/dr/drStore`, `federation/observability/observabilityStore`,
`enterprise/healthHistoryStore`, `unified/sync/syncStateStore`,
`workforce/install/installStore`, `executionStore`.

**HIGH: 1 · MEDIUM: 5 · LOW: 3**, plus the unseamed-store backlog.

---

## Regression tests

**+69 tests**, two tenants throughout.

| Suite | Tests | Covers |
|---|---|---|
| `tenancy/projectionCacheTenancy.test.ts` | 17 | H-1 + H-2. Includes a reproduction of the OLD count-signature shape proving the collision was real, then the new one proving the key closes it. Switch, background fan-out, projections, fail-closed, the "cannot poison the cache for the next resolved caller" case. |
| `tenancy/e2e/developerSurfaceTenancy.test.ts` | 26 | H-3. Revoke/rotate/delete/releaseSeat denied cross-tenant; seat cap per tenant; licences and purchases stamped from the caller; audit output scoped while the chain still verifies; an unowned legacy row visible to nobody. |
| `tenancy/tenantStoreRegistry.test.ts` | 8 | The gate mechanism, and the source scan that fails when a new `bindScope` class is unregistered. |
| `tenancy/migrationInventoryIntegrity.test.ts` | 8 | The inventory against the code. Asserts on the retraction of the false TTL claim, not its absence. |
| `tenancy/e2e/sweepRound3Tenancy.test.ts` | 10 | S-1, S-6, S-7, S-8 and the bad-bind throw. |

Existing tests changed only where the semantics genuinely changed — a store that
now requires a tenant boundary is given one. Every memoization and TTL assertion
in the eleven service suites was preserved: repeated reads under **one** tenant
must still be a single build, and they are.

---

## What this round establishes about method

**1. A new mechanism is not safer than the code it replaces until someone has
attacked it.** `TenantMemo` was written to close H-1 and H-2 and shipped with a
hole of exactly the same shape one level down. The sweep found it, not the plan.

**2. The failed first attempt is worth writing down.** For gateway audit retention
I tried the obvious per-tenant approach — drop from the front only while the
oldest row's owner is over cap — and it grows without bound when a quiet tenant
holds one ancient row. A memory leak is not an improvement on unfairness. The
shipped answer is a raised floor, which is a reduction in blast radius and **not**
a fix, and the code says so.

**3. Structural coverage beats another sweep, and it proved it immediately.** The
source-scanning registry test found `ProvenanceStore` on its first run — a store
in a file called `importer.ts`, which is why five sweeps of `*Store.ts` walked
past it.

**4. A documentation error is a security control that fails silently.** Five
sweeps stopped at one wrong clause. The inventory is now tested.

### Before the next certification attempt

1. **S-10** — give `federation/` a tenant dimension. Subsystem-scale.
2. The four open MEDIUMs, of which `setPlan` and the AI-egress destination are
   the two that are cross-tenant *writes*.
3. Triage the eight unseamed stores Phase 4 surfaced — each needs either a seam
   or a `declareSystemGlobalStore(reason)`.
4. Re-run the certification suites, then a fresh sweep.

Program 13C remains the tenant operating security gate. **It is not green, and
this session does not certify it.**
