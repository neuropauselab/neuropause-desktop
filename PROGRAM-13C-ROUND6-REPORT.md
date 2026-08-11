# Program 13C — Remediation Round 6

**Starting commit:** `7e853d3`
**Branch:** `feat/understanding-holds-motion-system`

---

## Verdict

**The dedupe class is defined, not enumerated.** `TenantDedupe` exists as a
primitive, the twelve known sets are migrated through it, and an exhaustive sweep
of the main process found **five more instances of the class** that the list of
twelve did not contain.

**The fresh red team then found nine defects in the fixes made hours earlier in
this same session,** including two HIGH. All are closed. One of them —
`listConnections()` returning every organization's SSO configuration under a
header I wrote in this round claiming it was scoped — was caught by the
three-tenant test and by nothing else.

| Target | Status |
|---|---|
| Define the dedupe class (`TenantDedupe`) | **DONE** — primitive + 14 behavioural tests |
| Twelve known dedupe sets | **MIGRATED** |
| Exhaustive dedupe/cache sweep | **DONE** — ~65 declarations triaged, **5 new TENANT-DERIVED found and fixed** |
| `homeTenant()` traced and classified | **DONE** — boot-only accessor; the two frozen stores now resolve the caller |
| SSO + API deployment binding | **DONE** — and the write keys were still frozen; see below |
| `syncStateStore.all()` | **DELETED** — zero callers, not even tests |
| M365 `accountId` path | **AUTHORIZED** — `ownsAccount` before every other gate |
| Governance empty-workspace semantics | **FIXED** — tenant-attributed rows, per-tenant chains, per-tenant retention |
| Executive Center −100% trend | **FIXED** |
| Test-the-tests audit | **DONE** — four suites were asserting the old model |
| Three-tenant adversarial suite | **ADDED** — 16 tests |
| Fresh red team | **DONE** — 13 findings, 2 HIGH, all closed |
| **HIGH = 0** | **YES for this sweep** |

| Gate | Result |
|---|---|
| Desktop main tests | **635 files / 6389 tests, exit 0** |
| Desktop renderer + shared tests | **87 files / 963 tests, exit 0** |
| Package workspaces (46) | **all pass** (~880 tests) |
| Typecheck | **green** — 0 `error TS` across all workspaces |
| Lint | **green** — `eslint . --max-warnings 0` |
| Desktop build | **green** — `✓ built in 4.54s` |
| Backend typecheck (`tsc --noEmit`) | **green** |
| **Backend bundle (`tsup`)** | **NOT VERIFIED HERE** — esbuild host 0.27.7 vs binary 0.21.5 skew in the Linux container. Same environment artifact as Round 5. **Run `npm run build` on the Mac.** |
| **Native Mac build / runtime** | **NOT PERFORMED** — this session has no macOS host |

---

## The point of this round: a class, not a list

The instruction was *"the goal is no longer 'fix the 12 known sets' — the goal is
DEFINE THE CLASS."* That was the right call, and the evidence is that the list was
wrong.

`apps/desktop/src/main/tenancy/tenantDedupe.ts` is the definition. Tenant-keyed
edge-trigger state with a per-tenant TTL and a per-tenant cap, a `claim()` that
collapses the two-call `has`-then-`add` shape where the bug lived, and an
unresolved caller that **re-delivers rather than claiming** — fail toward the
duplicate, never toward the silence.

Then the sweep over ~65 process-wide declarations found five the list of twelve
had missed:

| Where | What it was | Why it matters |
|---|---|---|
| `insight/index.ts` `verifiedLog` | a flat array of `{id, title}` returned by `dashboard()` | **disclosure, not suppression** — tenant A's recommendation ids and human-readable titles rendered in tenant B's Intelligence Center |
| `insight/index.ts` `lastTrendBand` | `let … : string \| null` | A settling on `at-risk` silenced B's "your health is deteriorating" alert |
| `automationPlatform` `planCache` | keyed on `playbookId`, a static constant | B's `ap:plan` returned A's approval chain and org **role names** inside the 3s TTL |
| `unified/sync/orchestrator` `offlineConnectors` | `Set<connectorId>` | the first workspace to see GitHub go offline claimed `'github'`; every other tenant's connector failure raised **no** inbox item |
| `ai/usageTracker` | four counters + two Maps on a singleton | one tenant's Commercial page showed the **install's** AI spend, and named other tenants' AI workers |

Three of those five live in files this program had already edited this round, two
to nine lines from the primitive that fixed their neighbour. **A file that was
touched is not a file that was finished.**

---

## The two HIGH findings the red team raised against this round's own work

### H-1 — `setPaused` took a bare `accountId` and never resolved it

`control()`'s `accountId` branch went straight to `controls.setPaused` with a
renderer-supplied id; the `null` branch went through the workspace-scoped
`listAccounts()`. Pausing is a **sync kill** — `isSuppressed` is consulted inside
the per-workspace fan-out — so a `connectors:manage` holder in one tenant could
silently and durably stop another tenant's data pipeline.

`deps.getAccount` is `connectorStore.get`, the scoped resolver, and it was already
on the object and already used twice in the same file. The identical shape was
fixed in `m365/executor.ts` *in this round*; the control path was missed because a
key that looks specific (`connectorId::accountId`) reads like a boundary.

**A KEY IS NOT AN AUTHORIZATION CHECK.** My own comment in
`connectorControlStore` said `paused` "was already keyed … so it was per account
and therefore per workspace." Keying is not checking.

### H-2 — the governance audit retention cap was install-wide

```ts
while (this.audit.length > this.auditCap) { this.auditChain.dropOldest(this.audit[0]); this.audit.shift(); }
```

One shared array, walked oldest-first. A tenant writing 2000 entries **deleted**
every other tenant's audit history — and deleted it from the hash chain via
`dropOldest`, so the rows are gone rather than hidden. The destroyed rows are the
compliance evidence `verifyAuditIntegrity()` exists to protect.

This is the **third** install-wide cap this program has found sitting behind a
correct read filter (`executionStore.save`, then `executionStore.replaceAll`, now
this). A retention cap is a write, and it destroys what a filter merely conceals.

Fixing it forced a real design change. A hash chain is order-linear: `dropOldest`
folds an entry into the base and `verify` recomputes forward, which is sound only
when entries leave from the **front in append order**. Per-tenant retention removes
from the middle. So a single chain and per-tenant caps are mutually exclusive —
and the single chain is *why* the cap was install-wide.

The store now holds **one chain per tenant**. Each tenant's rows are their own
append-ordered sequence, so evicting that tenant's oldest is a front removal
within its own chain. Both properties hold at once; neither was traded away. The
migration **verifies the old single chain first and only then splits it**, because
if rows were removed before the upgrade that is the last moment it is detectable,
and a migration that silently re-anchors the chain launders the tampering the
chain exists to catch.

---

## The rest of the red team's findings

| # | Finding | Resolution |
|---|---|---|
| 3 | `tenancyStore.summary()` — `projects`/`teams`/`workers` read `.size` off raw Maps while the three listings are `ownsTenant`-gated | summed over the caller's own tenants |
| 4 | `apiPlatformStore.summary()` — `webhooks: this.webhooks.size` beside a scoped `listWebhooks()` | `listWebhooks().length` |
| 5 | `federationStore.summary()` — `?? ''` used as a real Map key, where the neighbouring readers deny on it | routes through `scimConfig()`/`mfaPolicy()` |
| 6 | `setPolicyEnabled` — any `cloud:manage` holder disables a rate limit protecting everyone | **declared** with its cost stated, like `installStore`/`drStore`; genuinely shared infrastructure |
| 7 | `usageTracker` defined `bindScope` and registered with nothing | registered as `ai-usage`; the fail-open `add()` is now stated as a deliberate deviation with its cost, not as a feature |
| 8 | The **entire connector subsystem** was invisible to the startup gate — its seam is named `bindWorkspace`, and the scan matched only `bindScope` | scan matches both; the three stores are listed with the address of their binding |
| 9 | `applySeed` still contained the literal `?? this.homeTenantId` the comment 95 lines below said was removed | seed states the boot value directly |
| 10 | `record()` could still take a caller-supplied `tenantId` through the `Omit<…>` spread when unresolved | cleared explicitly — "no call site does this today" is a fact about today |
| 11 | `totalAudit()` unfiltered beside a scoped `auditCount` | classified: chain bookkeeping, no production caller, and the note says what to return if one is ever added |
| 12 | `setDisabled` returned silently on an unresolved workspace, so IPC read it as success | throws |

**Three summaries-beside-a-scoped-listing in one review.** The pattern is now
written down explicitly: **when a listing is scoped, every aggregate over the same
collection must be scoped in the same commit.** Reviewers check the listing because
it returns the records; the count reads as harmless and is the same query with the
rows dropped.

---

## The four remaining traces

**`homeTenant()` — classified, not scoped.** At composition there is no caller
whose scope could be consulted, so reading `isHome` is the only thing that *can*
work. The defect was never the accessor: it was that its result was frozen into
two stores that used it as their only notion of tenant forever. Both now resolve
the caller per operation — and closing that exposed a second layer, because
`setScim`, `recordScimSync` and `setMfa` had been given caller-resolved *reads* and
`this.scim.set(this.homeTenantId, …)` **writes**. The stamp was fixed and the map
key was not.

**`syncStateStore.all()` — deleted.** Zero callers, not even tests. Round 5 called
it "latent, no caller" and left it; that is the wrong resolution twice over. It is
an unfiltered install-wide accessor in a store whose other accessors are
deliberately narrow, so the next person wanting "all the accounts" finds a method
that already exists and looks sanctioned. Dead code is the same risk with nobody
watching it.

**M365 `accountId`.** The only thing standing between a foreign account id and a
write against that account's mailbox was `grantedScopes` returning `[]` — which
denies **only because every shipped action happens to declare a scope**. That is
authorization as a side effect of a least-privilege check. `ownsAccount` now runs
first, before the confirmation gate, returning the same message an unknown account
gets so a caller probing ids learns nothing.

**Governance audit.** `visibleAudit` compared `workspaceId` alone, and the stamp
comes from `activeWorkspaceIdForDisplay()` — one install-wide variable that never
consults the principal, whose unswitched value is the shared constant
`workspace-default`. Rows now carry `tenantId`, resolved at write time, canonicalised
**only when present** so historical rows hash unchanged. Legacy unattributed rows
are visible only while exactly one organization exists — an observation about the
install, not an attribution — and are counted by `unattributedAudit()` so they are
visibly withheld rather than silently gone.

---

## The Executive Center −100%

`monthlyTrends` is invoked **by** `composeExecutiveSnapshot`, and `composed = snap`
ran after that call returned. So `composed` was null on every pass, `cur?.overall ?? 0`
was 0, and the headline metric reported a fall from last month's score to zero,
forever.

**The `?? 0` is what made it silent.** A fallback that produces a plausible number
turns an ordering bug into a wrong answer nobody can see. The correct value was
already in hand — `curInputs` is collected at the top of the same function and
`computeOrgHealth` is pure — so the trend and the snapshot now score the same
inputs through the same function, and there is no ordering left to get wrong.

Not a tenancy defect. Reported because this program made the health store
per-tenant, so the wrong number was being computed independently for each tenant.

---

## Auditing the tests themselves

Four suites failed after the governance change, and all four were **asserting the
old model**: they wrote audit rows through an unbound store with a caller-supplied
`workspaceId` and read them back by workspace. Each was corrected by binding the
store the way production binds it and having the writer *act as* the tenant — not
by relaxing an assertion.

The three-tenant suite (`round6Tenancy.test.ts`, 16 tests) is written against the
two failure modes this program keeps hitting:

- **Three tenants, not two.** Two cannot distinguish "A leaks to B" from "the pair
  share one slot"; the frozen `homeTenantId` and the calendar-day health row both
  looked like working isolation to a two-tenant test because the second tenant
  overwrote the first and read back what it wrote.
- **Presence before absence.** Every test establishes that each tenant *has*
  something and *receives* its own before asserting that none can see another's.
  Round 5 shipped a test asserting an organization had zero approval chains and I
  read that emptiness as isolation. It was the breakage. **Empty is not isolation.**

---

## Claims in my own code this round's review found untrue

Recorded because a confident comment is read as evidence — which is how federation
went five sweeps unexamined, and how three of the five new dedupe findings sat
next to their fixed neighbours.

- `federationStore.listConnections()` — header claimed scoped; body returned
  `[...this.connections.values()]`. Written **in this round**. Caught by the
  three-tenant test and nothing else.
- `connectorControlStore` — "keyed `connectorId::accountId`, so it was per account
  and therefore per workspace." A key is not a check.
- `apiPlatformStore` — "NO `?? this.homeTenantId` FALLBACK" while the literal
  expression remained 95 lines above.
- `governanceStore.record()` — "the owner is resolved here, not accepted from the
  caller"; the `Omit<…>` spread still permitted one.
- `usageTracker` — the fail-open `''` partition described as a feature.
- `tenantOwnedStore` — "a store that is never bound cannot reach a user: the
  application refuses to start." False for three connector stores the gate could
  not see.

All six corrected in place.

---

## Still open

**MEDIUM (1):** `setPolicyEnabled` is a shared control surface — declared with its
cost, not scoped, because per-tenant limits over a shared runtime are not limits.
It needs a platform-operator role above `cloud:manage` before NeuroPause hosts
unrelated organizations on one control plane.

**LOW (2):** `orchestrator.offlineConnectors` has no eviction and grows with
removed accounts (memory only, correctly keyed). `installStore`,
`drStore` and the rate policies remain declared system-global with their costs
stated.

**Not verified in this environment:** the backend `tsup` bundle (esbuild version
skew in the container — `tsc --noEmit` is green) and any macOS build or runtime.

---

## What this round establishes about method

1. **A list of instances is not a definition of a class.** Round 3 fixed eleven
   caches by name, Round 4 found a twelfth, Round 5 found seven more and one dedupe
   set, and the sweep then found twelve. This round built the primitive first — and
   the sweep still found five the list of twelve had missed.

2. **A key is not an authorization check.** Two of this round's findings were
   composite keys that read like boundaries.

3. **A retention cap is a write.** Third occurrence. A filter hides; a cap deletes.

4. **Every aggregate over a scoped collection must be scoped in the same commit.**
   Three found in one review, in three different files.

5. **A gate that recognises boundaries by naming convention only sees the ones that
   followed it.** The connector subsystem was invisible for the length of this
   program because its seam is called `bindWorkspace`.

### Before the next certification attempt

1. Run `npm run build` and the app on the Mac — neither is verifiable here.
2. Decide the platform-operator role for `setPolicyEnabled`.
3. Re-run the sweep after any new subsystem lands; the class is defined now, so
   the test is whether new code reaches for the primitive.

Program 13C remains the tenant operating security gate. **It is not green, and
this session does not certify it.**
