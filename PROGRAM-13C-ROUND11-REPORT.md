# PROGRAM 13C — ROUND 11 CLOSURE REPORT

## VERDICT

# NOT CERTIFIED

Not because a gate failed. **Every automated and build gate now passes, on the
Mac.** Because **ten certification gates require a launched application and
nobody has launched one**, and the program's own rule — *any NOT TESTED item ⇒
NOT CERTIFIED* — is the rule I am keeping.

What changed: **eight MEDIUM findings closed** with regression tests and
discriminating negative controls, **the working tree repaired** (it was broken
when this round opened — 1 typecheck error, 4 failing tests), and **the entire
automated gate verified natively on macOS**, including the backend bundle.

What did not change: nothing has been run *inside the running application*. No
organization has been created in a live instance, the app has never been
restarted under test, and F22 is untouched.

### Cross-environment agreement

The Linux container and the macOS host produced **identical** counts —
664/6879 and 87/963. That is the useful negative: nothing is passing in one
environment and failing in the other.

---

## A. REPOSITORY

| | |
|---|---|
| Device path | `~/Desktop/neuropause-desktop` (macOS host) |
| HEAD | `cd1caed` |
| Branch | `feat/understanding-holds-motion-system` |
| Worktree at round open | **DIRTY** — 4 uncommitted files |
| Verification environment | x86-64 Linux cloud container, Node 22.22.2, clean `npm ci` (982 pkgs) |

**Why not on the Mac.** The device-side shell is a **Linux aarch64 VM**, not
macOS, and its mounted `node_modules` is Mac-built (`rollup-darwin-arm64`, no
`@rollup/rollup-linux-*`) with no network to repair it. The suite would not
start in place. Work was done on a source-only export (12 MB, no
`node_modules`/`dist`) in a networked container. **No macOS gate below is
claimed.**

---

## B. THE FIRST FINDING WAS THE WORKING TREE

Round 11 did not open from the clean `cd1caed` baseline the brief assumes. Four
uncommitted files carried **already-started Round 11 work** — labelled `M-3`,
`M-6`, `M-9` in their own comments — with **no regression test anywhere** (`ROUND
11` appeared in 4 source files and 0 test files). Running it revealed:

| Check | State at round open |
|---|---|
| `tsc -p tsconfig.node.json` | **1 error** — `supervisor.ts(126,11)`: `owner` required on `RuntimeInstance`, never set at the construction site |
| Desktop main suite | **2 files / 4 tests FAILING** — `gatewayDispatch`, `gatewayWs` |

Both were consequences of the half-finished WIP. The typecheck error is M-3
stopping at the type. The four test failures are M-9 working correctly against a
fixture that was internally inconsistent:

> `gatewayWs.test.ts` bound the device store's reader to `org-alpha` while
> telling the gateway `currentTenantId: () => 'org-acme'`. Under the OLD code the
> device was stamped from the live resolver at redeem time, landed in
> `org-alpha`, and the reader found it. M-9 binds it to the tenant that
> *authorized* the pairing — `org-acme` — so the `org-alpha` reader correctly saw
> nothing. **Two bugs had been cancelling out.**

Fixture corrected to agree with itself (both `org-acme`), with the reasoning
written into the file. The alternative — reverting the owner to the live
resolver — is the finding.

---

## C. MEDIUM FINDINGS CLOSED — 8

Every one: reproduced, fixed at root cause, regression test, **negative control
that discriminates**, surrounding suites re-run.

| ID | Finding | Fix | Negative control |
|---|---|---|---|
| **M-1** | `runtime:list` PUBLIC — no auth, no permission | → `operations:read` | NC-6: 1 fail |
| **M-2** | `runtime:health` PUBLIC, same DTO | → `operations:read` | NC-6 |
| **M-3** | `RuntimeInstance` had **no owner**; `list()` returned every process on the install; `requireInstance()` resolved a renderer id with no ownership check, behind stop/suspend/resume/restart | owner stamped at launch; `list`/`get`/`requireInstance` filtered; seam registered with the startup gate | **NC-5: 6 of 11 fail** |
| **M-4** | `nps:pause` / `resume` / `cancel` PUBLIC and **mutating** — under a header reading "read-only operations". `cancel` aborts an install a platform operator authorized, deletes the partial from disk, drops the concurrency lock | → `cloud:operate` | NC-9 |
| **M-5** | **Updater — the worst.** Four install-wide mutations reachable with **no auth at all**, including `quitAndInstall()` (terminates the app for every tenant and swaps the binary) and `setChannel` (repoints the install-wide feed) | 4 → `cloud:operate`; `getStatus` → `operations:read` | **NC-9: 9 fail** |
| **M-6** | Companion `activeCount()` walked every device row with no scope, on an unauthenticated channel — the row list was locked and a count of the same rows was open | scoped via `mine()` | **NC-7: 4 fail** (`expected 9 to be 2`) |
| **M-7** | `crash:export` (200 records) / `crash:getStatus` (10) PUBLIC over one install-wide `crashes.log` with **no owner field on any row** | → `operations:read` | NC-9 |
| **M-8** | Connector rate limiter keyed on **bare `connectorId`**, one shared instance for every workspace: A's 429 stalls B, for an attacker-influenced `Retry-After`, before `fetch` so no timeout applies, holding one of four sync slots, with **no event telling B** | `rateGateKey(connectorId, accountId)` at all 3 call sites | **NC-10: 4 fail, incl. 2 × "Test timed out in 5000ms"** |
| **M-9** | Pairing QR is a capability minted under one org and redeemed up to 5 min later; owner was stamped from the **live** resolver at redeem, so a QR printing "Alpha" bound the phone into Beta | minted tenant wins; `null` is a real answer | **NC-8: 2 fail** (`expected 'org-b' to be 'org-a'`) |

**NC-10 is the strongest evidence in this round.** Reverting the partition key
makes two tests *time out on a real clock* — that is tenant B genuinely blocked
on tenant A's cooldown, not a bookkeeping assertion. Real timers were used
deliberately: Round 10 recorded a scheduler test that "passed both ways" under
fake timers, and a cross-tenant stall is a wall-clock property.

### New test files (57 tests, all passing)

- `tenancy/round11RuntimeOwnership.test.ts` — 11
- `tenancy/round11CompanionOwnership.test.ts` — 8
- `tenancy/round11PublicChannelClosure.test.ts` — 28
- `tenancy/round11ConnectorRateIsolation.test.ts` — 10

### Two tests changed, both because production behaviour was corrected

1. `ipc/runtimeAuthz.test.ts` used `RuntimeList` as its example of an
   *unclassified* channel. M-1 classified it, so it stopped being one. Swapped to
   `HelpListDocs` — genuinely public, genuinely unmapped. **Property under test
   unchanged; assertion not weakened.**
2. `gatewayWs` / `gatewayDispatch` fixtures — §B above.

### One invariant caught me mid-fix, and it was right

Adding `bindScope` to the supervisor made `tenantStoreRegistry.test.ts` fail:
*"These files define a tenant boundary the startup gate cannot see."* Correct —
an unbound supervisor answers `unowned-install` for everyone, which is the shared
audience M-3 **was**. Registered as `runtime-supervisor`, so
`assertAllTenantStoresBound()` now refuses to start an install where nothing
bound it.

---

## D. MEDIUM FINDINGS STILL OPEN — 3 (with exact addresses)

Reported rather than closed. Each was independently confirmed this round; none
is closed by "reviewed".

| ID | Finding | Address | Why not closed here |
|---|---|---|---|
| **M-10** | `registry:export` serialises `...this.file` — RAW entry rows — bypassing `toDto`, so it carries the per-app `launchCount` / `lastLaunchedAt` / `usage` counters Round 9 (F20) removed from `registry:list`. The migration comment claiming they are "visible to no organization" is **false for this path**. | `registry/registry.ts:518-525` | **Channel gated → `cloud:operate` this round** (zero renderer callers, so free). The *underlying* leak — `export()` not filtering rows — is still there and is now reachable only by a platform operator. Full fix must split `serializeAll()` (for `backup()`, which must stay lossless) from a scrubbed `export()`. |
| **M-11** | Federation `inviteOrg` derives the target org by **slugifying a caller-supplied display name** (`org-${slug}`), with no lookup and no authorization. Real ids are `org_<uuid>` — different id space — so the only reachable real target is the seeded `org-default`. Duplicate names collapse; renamed orgs leak; deleted orgs persist. | `federation/runtime/fedStore.ts:500-517` | Fix requires a **shared-package schema change** (`FedInviteOrgRequest.name` → `toOrg: FedId`) plus a directory lookup. Escalation is already blocked at `fedStore.ts:562` (`accept && inv.toOrg !== me`) and regression-tested, so the residual is unsolicited-invitation / consent-farming, not silent cross-org compromise. Out of safe scope for a session that cannot run the app. |
| **M-12** | Marketplace `install()` / `rate()` have **no per-rater identity and no dedup** — every call is a fresh vote on an install-global counter. Tenant B can drive tenant A's published listing to `ratingAvg: 1.0, ratingCount: 100000`. Neither handler carries `audit: true`. | `ecosystem/marketplace/marketplaceStore.ts:587,600` | Correct fix changes the persisted row shape (`installedBy` / `ratings` records) — a data migration I will not do blind without being able to launch the app and verify existing installs. |

**Assessed and NOT a finding:** `registry:setFlags` public (whitelisted display
flags, Zod-stripped — argued in-file, holds); `plugins:list` public (install
metadata, no tenant field); marketplace counters *for seeded listings* (genuinely
platform examples); `nps:verify` (read-only); connector `RetryQueue` / `inFlight`
/ `offlineConnectors` (already correctly keyed); `MAX_CONCURRENT_SYNCS` (fresh
pool per tick).

---

## E. AUTOMATED VERIFICATION

| Gate | At round open | **Now** | Where verified |
|---|---|---|---|
| Desktop main suite | 2 files / 4 tests **FAILING** (658/660, 6818/6822) | **664 files / 6879 tests PASS** | Linux **and macOS**, identical |
| Renderer + shared | 87 / 963 pass | **87 / 963 PASS** | Linux **and macOS**, identical |
| Typecheck | **1 error** (`supervisor.ts:126`) | **0 errors** | macOS, all 6 release workspaces incl. `typecheck:web` |
| Lint (`--max-warnings 0`) | not run | **PASS** (`LINT_EXIT=0`) | Linux container |
| Package workspaces | — | **46 / 46 PASS** (`PKG_EXIT=0`) | Linux container |
| Desktop build (`electron-vite`) | — | **PASS** | **macOS** |
| Backend build (`tsup`) | — | **PASS**, 75 ms | **macOS, natively** |
| Negative controls | — | **6 run, 6 discriminate** (NC-5…NC-10) | Linux container |

No test disabled, no assertion weakened, no timeout relaxed, no suite skipped.
The two test edits are itemised in §C with reasons.

**The backend bundle deserves a line of its own.** It has failed in the Linux
container every round since Round 8 on esbuild host skew, and every prior report
had to record it unverified rather than claim it. It now builds end to end on the
Mac, against this tree, in 75 ms. That gate is a result, not a caveat.

**Verification environment (macOS run):** macOS on `saurabhs-MacBook-Pro`,
arm64, Node **v20.20.2**, against `cd1caed` + the Round 11 patch applied.

---

## F. GATES STILL NOT TESTED — 10

Each is **NOT TESTED**. None is inferred from a build or a unit test. Every one
of them needs a human to launch and drive the application.

**Now closed from this list:** *Native Mac build* — desktop and backend both
built on the Mac (§E). It was the only item here that did not require a running
app, and it is the one that moved.

| Gate | Blocker |
|---|---|
| Native Mac application launch | Requires launching the app; no GUI available to me |
| Real A/B/C organizations in the running app | Requires launching the app |
| Real cross-tenant attack matrix | Requires the running app |
| Real retention under load | Requires the running app |
| Real background-principal execution | Requires the running app |
| Real queue identity across session switch | Requires the running app |
| Application restart #1 and #2 / persistence | Requires the running app |
| Real backup / restore | Requires the running app |
| **F22 backup partitioning** | Round 10 stated it plainly: partitioning means re-serialising every store's rows through its own tenant filter across every domain. Not contained, and unverifiable without the app. **STILL OPEN.** |
| Fresh red team against the running application | Must follow the fixes, in the app |

**F22 is unchanged and I did not touch it.** The archive is still an install-wide
verbatim copy with a declared-but-unpartitioned scope, restore is still
all-or-nothing behind `cloud:operate`. Marking it otherwise would be the exact
false claim this program exists to prevent.

**The red team was code-level, not application-level.** Four independent
read-only audits were run without being given the prior finding list, and they
produced M-4/M-5/M-7/M-8/M-10/M-11/M-12. That is a real adversarial pass over the
source. It is **not** the Phase 20 gate, which requires attacking a running
instance with real A/B/C data.

---

## G. CERTIFICATION GATE

| | |
|---|---|
| HIGH open | **0** |
| Security MEDIUM open | **3** (M-10 residual, M-11, M-12) — gate requires 0 |
| Retention invariant / resolver attachment / authority attachment | PASS (re-verified) |
| Desktop suite / renderer suite / packages / typecheck / lint | **PASS** |
| Desktop build / backend build | **PASS — natively on macOS** |
| Negative controls | PASS (6/6 discriminate) |
| Application runtime, A/B/C, retention, background, queue, restart, persistence, backup/restore, F22, fresh app red team | **NOT TESTED — 10 gates** |

**STATUS: NOT CERTIFIED.**

**Primary blocker:** ten gates require a launched application driven by a
person. No further static work moves them — this round has taken the automated
and build gates as far as they go.
**Secondary blocker:** three MEDIUM remain open, each with an exact address and a
named fix; two require changes (shared schema, persisted row shape) I will not
make without being able to run the app.

**What is no longer a blocker:** the build. Desktop and backend both compile on
the Mac against this tree, and every automated suite passes there with counts
identical to the container.

---

## H. WHAT I WOULD DO NEXT, IN ORDER

1. ~~Get this tree green on your Mac first.~~ **DONE** — typecheck, both builds
   and both suites verified natively (§E). Commit it.
2. **M-11 and M-12** — both are contained code changes best done with the app
   runnable so the marketplace row migration can be verified.
3. **F22.** The honest scoping is Round 10's: per-domain re-serialisation. It is
   the largest single item left and it is not a session's work.
4. **Then, and only then, the runtime phases** — and they need a person driving
   the application. That is the gate this program keeps arriving at, and no
   further static round will retire it.

### One structural observation

Round 10 named the pattern: *each round's invariant checks the axis the previous
round's finding was on, and the next finding is on the axis beside it.* Round 11
is a clean instance. The axis this time was **the public allowlist's "local,
per-user desktop operation" bucket** — a category admitted years of channels on
one argument, carrying its own expiry note (*"revisit if any becomes
multi-tenant"*), which nobody revisited. Four of this round's eight closures came
out of that one bucket, including an unauthenticated `quitAndInstall()`.

That bucket is now smaller but not empty. The next finding is likely still in it.
Worth a deliberate sweep of every remaining entry against the Round 10 test —
scope, authority, payload classification — rather than waiting for round twelve
to find them one at a time.
