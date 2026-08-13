# PROGRAM 13C — TEST EVIDENCE

Every line below was produced by executing the command shown, during the final
certification run, on the tree whose digest is recorded in §0. No result is
carried forward from an earlier report.

## 0 · Environment and integrity

```
timestamp   2026-08-12T20:17:19Z
branch      feat/understanding-holds-motion-system
HEAD        927b7bf8288d1b25245b8df69b6db7ec51dc0180
working tree  clean except untracked *.patch files
reference machine   macOS arm64, Node v22.22.3, npm 10.9.8
execution machine   Linux x86_64 container, Postgres 16.13, Redis 7
Electron    42.8.1     Node (pinned, .nvmrc)  20
```

Working-copy integrity — the container's tree against the committed tree:

```
apps/desktop/src + packages/shared/src
2416 files
sha256  58d857a7063bf7dd06c0ce4f4ad0f909e07bebcc8373f4129731e90ceec4d313
IDENTICAL on both sides
```

## 1 · Suites

| Suite | Command | Result |
|---|---|---|
| Desktop node | `vitest run` | 768 files / 8031 tests / 0 failures |
| Desktop UI | `vitest run --config vitest.ui.config.ts` | 11 files / 116 tests / 0 failures |
| Backend unit | `vitest run` (apps/backend) | 37 files / 418 tests / 0 failures |
| Backend integration | `TEST_DATABASE_URL=… vitest run --config vitest.integration.config.ts` | 2 files / 17 tests / 0 failures |

Backend integration detail — a real database, 12 migrations applied, database
dropped beforehand so `waitForDb` had to create it:

```
✓ src/__integration__/organizations.test.ts  (11 tests) 4520ms
✓ src/__integration__/auth.test.ts           ( 6 tests)  900ms
```

## 2 · Static gates

```
tsc --noEmit -p apps/desktop/tsconfig.node.json     clean
tsc --noEmit -p apps/desktop/tsconfig.web.json      clean
eslint apps/desktop --max-warnings 0                clean
```

## 3 · Benchmark — FAILS on this hardware

```
uncontended:  compose=128.1ms  matrix=43.7ms  lineage=4.3ms  dashboard=1.8ms
under load :  compose=104.3ms  (a faster number under contention — noise, not signal)
budget     :  compose ≤ 100ms
reference machine (Mac, same day): compose=18.6ms
```

The budget is absolute wall-clock, calibrated on one machine, and asserted only
under `NP_BENCH=1` — which no workflow sets. Recorded as **D-9**.

## 4 · F22 production coverage — the finding, as executed

Call-site census (`grep`, production files only, tests excluded):

```
executiveDecisionsSource     production 0   test 1
automationRulesSource        production 0   test 1
healthHistorySource          production 0   test 0
workforceJobsSource          production 0   test 1
companionDevicesSource       production 0   test 1
tenantAiPreferenceSource     production 0   test 0
registerTenantDomainSource(  production 0   (only its own definition)
createTenantArchive          production 0   (only round16Adapters.test.ts)
restoreTenantArchive         production 0   (only round16Adapters.test.ts)
```

After `round18.patch`:

```
✓ src/main/tenancy/f22ProductionCoverage.test.ts  (6 tests)
  · registers exactly the six domains that have a working adapter
  · every registered domain is a real member of the denominator
  · reports the REMAINING gap honestly — 13 of 19 still uncovered
  · is 0/19 before registration — the state the application actually shipped in
  · is idempotent
  · builds one source per registered domain
```

## 5 · Channel → store coverage — measured

```
[channel-store] 2/194 authority-gated channels declared (1.0%). 192 UNDECLARED.

✓ src/main/tenancy/channelStoreCoverageGate.test.ts  (4 tests)
  · reports the real coverage rather than a count of declarations
  · fails when a new authority-gated channel arrives without a declaration
  · never goes backwards — a declaration cannot be quietly deleted
  · every declaration names a channel that is actually authority-gated
```

## 6 · Cross-tenant, in-process

`src/main/tenancy/crossTenant.test.ts` — 52 tests. Mutations ARE covered at this
level: READ, WRITE (patch), DELETE, IDOR by direct id, indistinguishable
miss-vs-foreign, SEARCH, COUNT, cold start, unbound-store denial, tenant switch,
same-tenant cross-workspace, unowned legacy rows.

This is in-process against real stores. It is **not** the running-application
matrix Gate 3 asks for, and is recorded as PARTIAL for that reason.

## 7 · Packaged artifact

```
run          31633030913 (windows-release, workflow_dispatch, success, 24m18s)
commit       aec87bd
artifact     neuropause-windows, 357 MB
installer    NeuroPause-Setup.exe  110,820,498 bytes
sha256       693ae976fa5d07eab47d0c877e8379a735c4817be900015d1abe21b0b97a587b
portable     110,517,409 bytes
             sha256 3a6a6da7715ef9e38510c4f6b9a5231a16b34d1905b38f40521e1558c5cd39ac
payload      NeuroPause.exe  machine 0x8664  PE32+
signing      Authenticode certificate table EMPTY → NOT CONFIGURED
provenance   commit aec87bd · branch feat/understanding-holds-motion-system · dirty false
```

Packaged-payload inspection (`grep -a` inside `app.asar`) — the fixes are in the
shipped bundle, not merely in source:

```
ai:preference.set                        5
ai:preference.get                        5
has not enabled external processing      1   (the D-5 restriction notice)
That choice could not be saved           2   (Round 17h error copy)
composeAiPreferenceView                  2
budgets MEASURED BUT NOT ASSERTED        0   (test-only code correctly absent)
```

## 8 · What was NOT executed

- Gates 4, 5, 6, 7 runtime procedures — require the running application.
- Gate 10 end-to-end tenant backup/restore — the feature is not wired (F-1).
- Fresh running-app red team — requires the running application.
- Packaged runtime verification — requires a Windows machine.
- Backend A/B/C tenant isolation suite — scope confirmed, suite not written.

None of these is recorded as PASS.
