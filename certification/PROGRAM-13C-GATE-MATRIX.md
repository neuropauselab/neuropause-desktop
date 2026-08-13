# PROGRAM 13C — GATE MATRIX

One row per gate. `EVIDENCE` names what was executed. `NOT TESTED` means nothing
was executed and is never a synonym for "probably fine".

Baseline commit `927b7bf` · certification changes in `round18.patch` ·
12 August 2026 · execution environment: Linux container (desktop/backend suites),
`windows-latest` runner (packaged artifact), macOS arm64 (Round 17 runtime gates).

| # | Gate | STATUS | TEST COMMAND | ENVIRONMENT | EVIDENCE |
|---|---|---|---|---|---|
| 1 | Native launch, packaged artifact | **PARTIAL** | `gh workflow run windows-release.yml` | windows-latest | Run 31633030913 success; installer sha256 `693ae976…a587b`; payload `0x8664` PE32+; D-5/17g/17h strings present in `app.asar`. Never launched by a human. |
| 2 | Real A/B/C tenants | **PASS** | console harness `P13C.all()` | macOS, packaged-adjacent dev run | Round 17: seeded org 1/4/1, tenants A/B/C 0/0/0 on scoped projections. |
| 3 | Cross-tenant matrix | **PARTIAL** | `vitest run src/main/tenancy/crossTenant.test.ts` | Linux container | 52 tests incl. WRITE / DELETE / IDOR / SEARCH / COUNT. In-process against real stores; the running-application matrix was not run. |
| 4 | Runtime ownership | **NOT TESTED** | — | — | Requires the running application. |
| 5 | Retention | **NOT TESTED** | — | — | Requires the running application. |
| 6 | Background principal | **NOT TESTED** | — | — | Requires the running application. |
| 7 | Queue identity | **NOT TESTED** | — | — | Requires the running application. |
| 8 | Restart persistence | **PASS** | relaunch + `P13C` counts | macOS | Round 17: 115 users / 44 / 2 stable across restart. |
| 9 | Forced termination | **PASS** | `SIGKILL` + relaunch | macOS | Round 17: counts stable after forced kill. |
| 10 | Real tenant backup/restore | **FAIL** | census + `f22ProductionCoverage.test.ts` | Linux container | `createTenantArchive` / `restoreTenantArchive` / `registerTenantDomainSource` have **zero production call sites**. No tenant-scoped backup exists in the product. |
| — | D-5 AI policy intersection | **PASS** | `vitest run src/main/tenancy/round17TenantAiPreference.test.ts src/main/ai/tenantAiPreferenceCompose.test.ts` | Linux container | 9/9 exhaustive intersection + 7 composition tests + `NC-D5-ELEVATE` negative control. |
| — | F22 tenant-domain coverage | **PARTIAL** | `vitest run src/main/tenancy/f22ProductionCoverage.test.ts` | Linux container | Denominator 19 correct. Production registration **0/19 before this run, 6/19 after**; 13 uncovered and reported. |
| — | Channel → store | **PARTIAL** | `vitest run src/main/tenancy/channelStoreCoverageGate.test.ts` | Linux container | **2/194 = 1.0%**; 192 undeclared. Ratchet gate added. |
| — | D-6 authorization error contract | **NOT TESTED** | — | — | Not implemented. Denials cross IPC as English prose; 3 renderer sites classify by regex. |
| — | D-7 silent write paths | **PARTIAL** | `vitest run --config vitest.ui.config.ts` | Linux container | 4 of 10 closed (Round 17h) with negative controls NC-17h-A/B. Six remain. |
| — | Backend scope | **NOT TESTED** | `vitest run --config vitest.integration.config.ts` | Linux container + Postgres 16 + Redis 7 | Confirmed IN SCOPE (`orgClient.ts:43`, `backendClient.ts:40`). 2 files / 17 tests pass; that is a smoke test, not a certification. 0 commits since 10 Aug. |
| — | Fresh running-app red team | **NOT TESTED** | — | — | Requires the running application. |

## Automated baseline (all executed this run)

| Suite | Result |
|---|---|
| Desktop node | 768 files / 8031 tests / 0 failures |
| Desktop UI | 11 files / 116 tests / 0 failures |
| Backend unit | 37 files / 418 tests / 0 failures |
| Backend integration | 2 files / 17 tests / 0 failures |
| Typecheck node / web | clean / clean |
| Lint `--max-warnings 0` | clean |
| Working-copy integrity | 2416 files, digest identical to the committed tree |
| Benchmark | **FAIL on this hardware** — 128.1ms vs 100ms budget; 18.6ms on the reference Mac. D-9. |

## Decision

Required gates 1, 3, 4, 5, 6, 7, 10 are not all PASS. Channel→store is not
complete. D-6 is not implemented. The red team was not run.

```
PROGRAM 13C  =  NOT CERTIFIED
```
