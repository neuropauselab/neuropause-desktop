# PROGRAM 13C — FINAL ENGINEERING CERTIFICATION

**12 August 2026**, amended 13 August · branch `feat/understanding-holds-motion-system`
Certification commit **`018f1f9`** — `round18.patch` is applied and committed; the
earlier `927b7bf` baseline reference is superseded.

---

# VERDICT

```
PROGRAM 13C  =  NOT CERTIFIED
```

**Gate 1 is FAIL.** A human installed the Windows artifact and could not reach the
product: the application opens on a sign-in screen that requires a backend, and
onboarding lives behind it. That is F-4 below, and it refutes a row this document
previously marked PASS.

Five runtime gates have no evidence, Gate 10 is FAIL, channel→store coverage is
**1.0%**, and the backend — confirmed inside the product's security boundary —
has never been examined.

The verdict does not turn on judgement. It turns on the certification policy
stated in the brief: any required item that is `PARTIAL`, `NOT TESTED`,
`BLOCKED` or `FAIL` means NOT CERTIFIED.

---

## 1 · WHAT THIS RUN FOUND

Five findings. F-1 to F-3 were verified by execution in the container; F-4 was
found by a human installing the artifact, which is why nothing in this repository
could have produced it.

### F-1 · The F22 tenant archive registry ships EMPTY — **HIGH**

`registerTenantDomainSource()` had **zero production call sites**. Six adapter
factories written across Rounds 15–17 were called exclusively from tests; two of
them (`healthHistorySource`, `tenantAiPreferenceSource`) had no call site
anywhere at all.

```
executiveDecisionsSource     production call sites: 0   test call sites: 1
automationRulesSource        production call sites: 0   test call sites: 1
healthHistorySource          production call sites: 0   test call sites: 0
workforceJobsSource          production call sites: 0   test call sites: 1
companionDevicesSource       production call sites: 0   test call sites: 1
tenantAiPreferenceSource     production call sites: 0   test call sites: 0
```

`createTenantArchive` and `restoreTenantArchive` are likewise called only from
`round16Adapters.test.ts`. In the running application `registeredTenantDomains()`
returned `[]`, `tenantArchiveCoverageGaps()` returned all 19, and a tenant
archive would have contained **nothing**.

Reports said "F22 5/19", then "6/19". Those numbers counted adapters that had
been **written**. Production coverage was **0/19**.

**Consequence for Gate 10.** There is no tenant backup/restore feature reachable
from the product. The shipping backup is `BackupManager`, which copies whole
files named in `storage/storePaths.ts` — install-wide, not tenant-scoped. Gate 10
is therefore **FAIL**, not NOT TESTED: the thing to be tested is not wired in.

**Fixed and gated in this run.** `backup/tenantDomainRegistration.ts` registers
all six adapters; `runtimeCore.ts` calls it immediately after the stores those
adapters read are bound, and logs `Tenant archive sources registered { domains,
uncovered }`. `tenancy/f22ProductionCoverage.test.ts` (6 tests) locks the set,
proves the pre-fix state was 0/19, and asserts the remaining gap is exactly 13.

### F-2 · Channel→store coverage is 1.0%, not "PARTIAL — 2 declarations"

Measured against its real denominator:

```
authority-gated (sensitive) channels : 194
declared to the channel→store registry:   2   (ai:preference.get, ai:preference.set)
UNDECLARED                            : 192
coverage                              : 1.0%
```

Five reports described this as "PARTIAL — 2 declarations", which reads like a
small remainder. It is a registry that has been empty or near-empty since it
shipped in Round 13.

**Not closed, and deliberately not faked.** The honest fix is 192 declarations,
each naming the store its handler actually reaches. `channelResource.ts`'s own
header explains why that cannot be derived mechanically — handlers close over
injected ports and reach stores several frames deep, so "a regex would produce
confident wrong answers, which is worse than no answer." Generating them from a
scan would manufacture exactly that.

**Gated in this run.** `tenancy/channelStoreCoverageGate.test.ts` (4 tests)
computes the denominator from the authority tables, prints the real ratio on
every run, fails when a new authority-gated channel appears without a
declaration, fails when coverage regresses, and fails when a declaration names a
channel that is not actually gated. Channel→store remains **PARTIAL**.

### F-3 · The backend IS inside the security boundary, and is unexamined

Phase 13 asked for a determination rather than an ambiguity. The evidence:

```
apps/desktop/src/main/organization/orgClient.ts:43   ${config.backendUrl}/organizations…
apps/desktop/src/main/auth/backendClient.ts:40       ${config.backendUrl}${path}
apps/desktop/src/main/license/transport.ts:33        baseUrl ?? config.backendUrl
apps/desktop/src/main/runtimeTelemetry.ts:67         ${config.backendUrl}/health
```

The desktop resolves **organizations** and **authentication** through the
backend. Those are the tenant boundary itself, not an adjunct. The backend is
**IN SCOPE**.

Commits touching `apps/backend` since 10 August: **0**, against 716 file-touches
in `apps/desktop`. Its integration suite (`auth.test.ts`, `organizations.test.ts`
— 17 tests) passes against a real Postgres 16 + Redis 7, but 17 tests is not a
tenant-isolation certification.

**Backend tenant certification: NOT TESTED.** Program 13C does not certify the
backend, and this document says so rather than leaving it implied.

### F-4 · The packaged application cannot be opened without a server — **BLOCKER**

The first human runtime evidence on Windows in seventeen rounds, and it refuted a
gate marked PASS.

`App.tsx` has one decision and no third branch:

```ts
if (status.state === 'authenticated') return <AppShell session={status.session} />;
return <LoginScreen />;
```

`AppShell` is typed `{ session: Session }` — it cannot render without one.
`FirstRunExperience` is rendered at `AppShell.tsx:575`, **inside** the authenticated
shell. `LoginScreen` offers OAuth buttons and a credentials form and nothing else: no
guest, no local account, no skip. The main process has no offline auth path.

No backend → no session → `LoginScreen` → **"Try Free Locally" is unreachable.**

Platform-independent: the same two branches govern macOS and Linux. A product
described as local-first cannot currently be opened without a network round trip.
Neither `FOUNDER-INSTALL-WINDOWS.md` nor the acceptance checklist mentions a backend;
the build was handed over as self-contained and is not.

The remedy is a product decision, not a defect fix — offline account, cached-session
grace, or repositioning "local-first" to mean where inference runs. Recorded, not
resolved.

### F-5 · Infrastructure, and a wrong inference this document made

The deploy host `64.227.128.218` did not answer SSH. **This document previously called
that "an unrelated live-infrastructure question." That was wrong** — it is what
surfaced F-4 — and the inference behind it was also wrong: a refused port on one host
says nothing about a service on another. DNS resolution shows three distinct hosts:

```
neuropause033.com          no A record        ← the update feed baked into every artifact
api.neuropause033.com      134.199.250.188    ← what the application calls
64.227.128.218             website/downloads  ← the box whose SSH timed out
```

If the apex genuinely carries no address record, every installed copy fails its update
check at DNS before HTTP is attempted. Resolution is not reachability; both need
checking from a second network before either is concluded.

---

## 2 · WHAT COUNTED AS EVIDENCE, AND WHERE IT DID NOT

Three times in this programme a status was assigned by counting the wrong noun. The
fixes are individually small; the pattern is the finding.

| Claim made | What was counted | What was true |
|---|---|---|
| "F22 6/19" | adapters **written** | adapters **registered in production**: 0/19 |
| "Channel→store PARTIAL — 2 declarations" | **declarations** | **coverage**: 2/194 = 1.0% |
| "Fresh install can complete onboarding — PASS" | a mounted component **completing** | whether the application **reaches** that component: it cannot |

Each was produced by someone applying this programme's own rule to everything except
their own evidence. The rule reads *"a unit test existing is not evidence."* A
mounted-component test is closer to the product than a unit test — it renders real
React, drives real clicks, asserts on real DOM — and it is still not the product.
Proximity to the real thing is a gradient, and every point on it that is not the real
thing can be cited as though it were. The third row is the sharpest case: the test
renders `FirstRunExperience` **directly**, so it could never have observed that
`App.tsx` refuses to render it without a session.

Two of the three now have a gate that measures the right noun.
`f22ProductionCoverage.test.ts` asserts registration rather than authorship, and proves
the pre-fix state was 0/19. `channelStoreCoverageGate.test.ts` computes the denominator
from the authority tables and prints the ratio on every run.

**The third has no automated remedy, and that is the point.** Only a person installing
the artifact could have found F-4. That is the same reason gates 4, 5, 6, 7, 10's
runtime half and the red team cannot be discharged by any suite in this repository,
however green it is — and this document should be read as evidence of what 8,031
passing tests do not cover.

---

## 3 · AUTOMATED RESULTS — all executed this run

| Suite | Command | Result |
|---|---|---|
| Desktop node | `vitest run` | **768 files / 8031 tests, 0 failures** |
| Desktop UI (mounted components, jsdom) | `vitest run --config vitest.ui.config.ts` | **11 files / 116 tests, 0 failures** |
| Backend unit | `vitest run` (apps/backend) | **37 files / 418 tests, 0 failures** |
| Backend integration | real Postgres 16 + Redis 7 | **2 files / 17 tests, 0 failures** |
| Typecheck node | `tsc -p tsconfig.node.json` | clean |
| Typecheck web | `tsc -p tsconfig.web.json` | clean |
| Lint | `eslint apps/desktop --max-warnings 0` | clean |
| Working-copy integrity | digest vs committed tree | **2416 files, `58d857a7…d313`, identical** |
| Benchmark | `npm run bench` | **FAILS in this container** — see below |

768/8031 includes the two gate files added by this run (766/8021 at `927b7bf`).

**Benchmark, stated honestly.** `compose` measured **128.1ms uncontended** in
this Linux container against the 100ms budget. The same test measured **18.6ms**
on the reference Mac earlier today. The budget is an absolute wall-clock number
calibrated on one machine, so it is **not hardware-portable**, and it is not
enforced by CI at all (`npm test` runs without `NP_BENCH=1`). Recorded as **D-9**;
not "fixed" by moving the number, because the number is not the problem.

---

## 4 · GATE MATRIX

| Gate | Status | Basis |
|---|---|---|
| **1 · Native launch, packaged artifact** | **FAIL** | Windows x64 installer built and verified on a `windows-latest` runner (run 31633030913, commit `aec87bd`, sha256 `693ae976…a587b`); payload inspected — machine `0x8664`, PE32+, D-5/17g/17h strings present in `app.asar`. **Installed and launched by a human on 13 August: it opens on a sign-in screen and cannot reach the product (F-4).** |
| **2 · Real A/B/C tenants** | **PASS** | Runtime evidence, Round 17: seeded org non-zero, A/B/C zero on scoped projections. |
| **3 · Cross-tenant matrix** | **PARTIAL** | `crossTenant.test.ts` — 52 tests covering READ, WRITE, DELETE, IDOR, SEARCH, COUNT, cold start, tenant switch, workspace isolation, unowned rows. **In-process against real stores, not against a running application.** The runtime mutation matrix was not run. |
| **4 · Runtime ownership** | **NOT TESTED** | Requires a running application. |
| **5 · Retention** | **NOT TESTED** | Requires a running application. |
| **6 · Background principal** | **NOT TESTED** | Requires a running application. |
| **7 · Queue identity** | **NOT TESTED** | Requires a running application. |
| **8 · Restart persistence** | **PASS** | Round 17 runtime evidence: 115 users / 44 / 2 stable across restart. |
| **9 · Forced termination** | **PASS** | Round 17 runtime evidence: SIGKILL, counts stable. |
| **10 · Real tenant backup/restore** | **FAIL** | F-1. The feature is not wired into the product; the archive registry was empty and `createTenantArchive` has no production caller. Registration is fixed by `round18.patch`; an end-to-end tenant backup/restore path still does not exist. |
| **D-5 · AI policy intersection** | **PASS** | 9/9 exhaustive + 7 composition tests + `NC-D5-ELEVATE`. Re-run this session. |
| **F22 · tenant-domain coverage** | **PARTIAL** | Denominator 19 correct. Production registration 0/19 before this run, **6/19 after**, 13 uncovered and reported as such. |
| **Channel → store** | **PARTIAL** | **2/194 = 1.0%.** Ratchet gate added. |
| **D-6 · authorization error contract** | **NOT TESTED** | Not implemented this run. Denials still cross the IPC boundary as English prose; three renderer sites classify by copy-pasted regex. |
| **D-7 · silent write paths** | **PARTIAL** | 4 of 10 closed in Round 17h with negative controls. Six remain: `OperationsProvider:371`, `SandboxProvider:271/280/289`, `WorkspaceContextProvider:90`, `WelcomeView:75`. |
| **Backend scope** | **NOT TESTED** | F-3. Confirmed in scope; never examined. |
| **Fresh running-app red team** | **NOT TESTED** | Requires a running application. |

---

## 5 · WHY FIVE GATES REMAIN UNTESTED

Gates 4, 5, 6, 7 and 10's runtime half, the red team, and packaged-runtime
verification all require **the packaged application, running, driven by a
human**. This certification ran in a Linux container. It cannot launch the
Electron application, cannot click a wizard, and cannot observe a screen.

The brief's own rule settles what to do about that: *"Do not convert NOT TESTED
→ PASS without actual evidence."* They are recorded as NOT TESTED.

What was NOT done, and why it was not done, matters as much as what was:

- **192 channel→store declarations were not generated.** A scan cannot determine
  which store a handler reaches; the registry's own design note says so.
- **A backend A/B/C isolation suite was not fabricated.** The determination that
  the backend is in scope is evidence; a suite written and run in the same hour
  it was scoped would not be.
- **The benchmark budget was not adjusted to make it pass.** The number is not
  the defect.

---

## 6 · REMAINING RISK, RANKED

1. **Gate 10 FAIL** — no tenant-scoped backup or restore exists in the product.
   A customer cannot export or recover their own organization's data.
2. **Channel→store 1.0%** — 192 authority-gated channels have never been checked
   for correspondence between the authority they declare and the data they reach.
   Round 12 found fourteen public channels carrying tenant data with this class
   of gap.
3. **Backend unexamined** — organizations and authentication resolve through a
   service this programme has never inspected.
4. **Five runtime gates untested** — ownership, retention, background principal,
   queue identity, and real backup/restore have no runtime evidence.
5. **D-6 open** — authorization outcomes are distinguishable only by matching
   English prose. Rewording a message silently changes renderer behaviour.
6. **Six silent write paths** — a click is refused and the screen says nothing.
7. **D-9 benchmark portability** — a wall-clock budget calibrated on one laptop,
   enforced by no CI.

---

## 7 · FOUNDER / RELEASE STATUS

The Windows Founder Test Build (`aec87bd`, sha256 `693ae976…a587b`) was handed over
and **is now known not to work**: it installs correctly and cannot pass its first
screen (F-4). The founder should be told to hold rather than left to discover it.
Sections A and B of the acceptance checklist are the only parts that produced valid
evidence; C through I describe a product nobody can currently reach. It was always labelled a test build accompanied by `KNOWN-LIMITATIONS.md`
and an engineering status stating NOT CERTIFIED.

Windows signing is **NOT CONFIGURED** — a release and distribution concern,
reported separately, and not counted as a Program 13C security failure.

Windows human runtime verification is **TESTED — FAILED**. Installation succeeds;
the application cannot be used.

---

## 8 · EXACT NEXT ACTION

1. Apply `round18.patch`, run the desktop suite, commit. That converts F22
   production coverage from 0/19 to 6/19 and puts a ratchet under channel→store.
2. Launch the packaged application and close gates 4, 5, 6, 7 with the A/B/C
   procedure. These need a person at a machine and nothing else.
3. Decide Gate 10: either wire an end-to-end tenant backup/restore path onto the
   now-registered archive, or state that tenant-scoped backup is out of scope for
   this release and stop listing Gate 10 as a gate.
4. Rule on D-6 and D-7, and on whether `apps/backend` enters Program 13C's scope.

**PROGRAM 13C — NOT CERTIFIED.**
