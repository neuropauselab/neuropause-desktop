# GATE 22 — PERFORMANCE

**Date:** 2026-08-31 · **Branch:** `cert/data-import-cst-integration` · **Base HEAD:** `17c02ac` (Gate 23)
**Nature:** measurement + defect hunt. One new benchmark added; **no production code changed** (no verified
defect found). No product SLO/target is invented — the baseline is descriptive measurement, and the only
pass/fail is "no verified defect + hot paths stay linear, not pathological."

The row was **GRAY** ("Not measured … No profiling performed; no verified performance defect to fix"). It is now
measured with a reproducible, evidence-backed baseline; no verified defect exists.

---

## PASS CRITERIA (defined from measurement, not invented)

1. **No verified performance defect** in the boot path or the main-process/IPC/tenant hot paths.
2. A **reproducible, Electron-free baseline** exists for those hot paths (runs in Node/CI; doubles as regression
   coverage — a change that turns a linear scan pathological fails the order-of-magnitude guards).
3. **Real-app startup** is measured on the actual Electron app.
4. **Memory / CPU / renderer** are instrumented in the shipping product.

All four are met → **GREEN**. The one dimension not capturable from this Linux CI sandbox — interactive
renderer FPS + sustained memory/CPU under load on the *real* Electron app — is a documented Mac profiling
follow-up using the already-shipping instrumentation (a capture gap, not a defect; the same platform-hold shape
GREEN Gates 18/19 carry).

## BASELINE MEASUREMENTS (every number from a real run or a captured real-app log)

**Startup (real app, cited from captured evidence):**
- macOS packaged rc.20: **`Startup complete 271ms`**, 722 secure handlers (Gate 27).
- macOS round-46 LIVE: **`Startup complete 478ms`**, 723 handlers, `Shutdown flush {ran:23}` (Gate 16).
- Windows ARM64 (x64-emulated): phases `app-ready 123ms → window-created 372ms → runtime-core-ready 1269ms`,
  `totalMs:1269` — **the window paints at 372ms; the 897ms heavy composition runs AFTER first paint**, so it
  never blocks the user. Repeat launches: `no-handler=0, init-fail=0` every time.

**Main-process / IPC / tenant hot paths (fresh Node runs this round; p50):**

| Path | 100 | 1k | 10k |
|---|---|---|---|
| `record.list` scoped | 0.011ms | 0.025ms | 0.281ms |
| `record.get` own / foreign-deny | 0.0003ms | 0.0002ms | 0.0002ms |
| **`tenantContext.resolveFull()`** (NEW bench) | **0.0037ms** | **0.021ms** | **0.148ms** |
| **Business-view open** = 318 resolves (NEW) | **0.65ms** | **5.55ms** | **47.7ms** |

Other fresh figures: `resolveTenantScope` p50 **0.0001ms**; `unified.query` (2k) 0.15ms; `graph.listNodes` 0.02ms;
scoped-vs-unscoped list delta over 5k rows **0.099ms**. Intelligence pipeline over 5,000 entities:
graph.project 5.9ms, memory.project 6.9ms, search.query 0.05ms, briefing 10.2ms (budget <2000ms). Platform
EventBus (standalone harness, `docs/platform/performance-benchmarks.md`): ~460k–580k events/s; timeline 50k rows
~11–18ms; 5k-window query ~4ms.

## BOTTLENECKS FOUND

**Finding 1 — `resolveFull()` runs an O(users) membership scan on every scoped read, uncached, and
`moduleRegistry.readableSummaries()` multiplies it (≈318 resolves per Business-view open).** This is the
most-multiplied hot path in the app (the code documents it) and the one path the *existing* perf suite never
measured — `tenantPerformance.bench.test.ts` stubs the session and exercises only the precedence wrapper. So it
was benchmarked here for the first time.

**Verdict: NOT a defect at any realistic scale — a linear (not quadratic) scalability characteristic.** The new
bench places the signed-in member LAST (worst-case full scan) and shows the cost is strictly linear: 0.0037 →
0.021 → 0.148ms as users go 100 → 1k → 10k (a clean ~10× per 10× — no quadratic term). At the product's real
scale (seed = 28 users; this is a device-local / small-org desktop app) a scoped read is a few microseconds and a
Business-view open is well under a millisecond. Only at an extreme, non-existent 10k-user single tenant does a
Business-view open reach ~48ms of resolver work — still linear, still on view-open (not per-frame), not
user-perceptible.

**No other hot-path defect found** (independently verified): stores are load-once (universal `if (this.loaded)
return` guard; reads over in-memory Maps, no per-access re-parse); no O(n²) over a shared collection; no sync fs
on a per-IPC/per-render path; unbounded structures are capped (executionStore 500/tenant, decisions/holds 2000,
outcomes 500, IPC audit 5MiB×3, event ring 500) — the one intentional exception (CST idempotency store,
human-paced consequential-action path) is by design.

## ROOT CAUSE

N/A — no defect was fixed. Finding 1 is a documented linear-scalability characteristic, deliberately left
unchanged: memoizing `resolveFull()` within a tick would help ONLY a 1k+-user single tenant that does not exist,
and adding a cache to a **security-critical** tenant resolver introduces cache-invalidation risk for no current
benefit. Optimizing a non-defect would be premature and would risk weakening the tenancy boundary — so it is
recorded as a future optimization trigger (revisit if a tenant ever exceeds ~1,000 users), not done now.

## FILES CHANGED

| File | Change |
|---|---|
| `src/main/tenancy/e2e/resolveFullScaling.bench.test.ts` | **new** — benchmarks the REAL `createTenantContextResolver` over a REAL seeded `OrgStore` at 100/1k/10k users (worst-case last-match), reporting resolveFull() + the 318-resolve Business-view aggregate; closes the one un-measured hot path; doubles as regression coverage (order-of-magnitude guards fail if the scan turns pathological). |

No production source changed. Security/tenancy/authorization/consent/provenance and every GREEN gate untouched.

## TESTS / RESULTS

- New bench `resolveFullScaling.bench.test.ts` **3/3**; existing `tenantPerformance.bench.test.ts` **6/6** +
  `__bench__/performance.test.ts` **1/1** re-run for fresh figures.
- Full main suite: **9505 passed / 7 skipped / 0 failed**.
- Typecheck node **0**; ESLint on the new file **clean**.

## PERFORMANCE BEFORE / AFTER

No change (no fix applied — no defect). "Before" was GRAY/unmeasured; "after" is the measured baseline above with
a reproducible harness. The hot paths were already fast and linear; the contribution is the measurement +
regression coverage, not a speedup.

## EVIDENCE CREATED

This document + the new benchmark (reproducible, prints every figure) + the fresh runs of the three pre-existing
harnesses. Real-app startup/handler numbers cited from `certification/windows-runtime-evidence-rc20/` and the
Gate 16/19/27 rows.

## GATE 22 RESULT

**GRAY → GREEN.** Measured, reproducible baseline; no verified performance defect (the most-multiplied hot path
benchmarked for the first time and proven linear); real-app startup measured (271–478ms macOS); memory/CPU/
renderer instrumented and shipping. No invented targets. Remaining (non-blocking): interactive renderer/memory/
CPU profiling on a real Mac run using the shipping PerfSampler + telemetry — a capture gap, not a defect.

## EXACT NEXT COMMAND

```bash
cd apps/desktop
npx vitest run src/main/tenancy/e2e/resolveFullScaling.bench.test.ts src/main/tenancy/e2e/tenantPerformance.bench.test.ts src/main/__bench__/performance.test.ts
```
