# NeuroPause — Performance Pilot Baseline

> **NeuroPause Global Product RC** · Documentation v1.0 · Product build `1.0.0-rc.15` (`0a040e2`) · Last updated 2026-08-08 · Audience: pilot leads, QA, IT
>
> A **pilot-scale** performance baseline and the exact method to capture it. This is **not** load/stress testing (a future dedicated phase). Honesty rule: numbers are only recorded where they were actually measured. User-facing latencies require the running desktop GUI on the target hardware and are marked **PENDING GUI CAPTURE** with the procedure to fill them in — no latency figure is invented.

## What "baseline" means here

A small set of representative interactions timed on the evaluator's own machine and backend, recorded once at the start of the pilot, so regressions are visible later. Capture p50 and p95 over ~10 samples each, on otherwise-idle hardware, and record the machine + build.

## Measured now (build environment — code/build health, NOT user latency)

These are real measurements from the release gate in the cloud build environment. They indicate code health and test cost, **not** user-perceived latency:

| Signal | Value | Source |
|---|---|---|
| Backend test suite | 37 files / **418 tests in ~28.4s** | `npm run test -w @neuropause/backend` (integration excluded) |
| companion-protocol suite | 23 tests in ~0.23s | vitest |
| cloud-core suite | 44 tests in ~0.17s | vitest |
| Docs site generation | 26 docs + 4 extras + 7 data files | `npm run docs:build` |

Treat these as build-health context; the user-facing table below is what a pilot actually measures.

## User-facing baseline (capture on the target Mac)

| ID | Interaction | Metric | p50 | p95 | Status |
|---|---|---|---|---|---|
| PERF-1 | App cold start → shell interactive | ms | — | — | PENDING GUI CAPTURE |
| PERF-2 | Sign-in round-trip | ms | — | — | PENDING GUI CAPTURE (+ backend) |
| PERF-3 | Open Today / Work Hub | ms | — | — | PENDING GUI CAPTURE |
| PERF-4 | ERP record read (open a record) | ms | — | — | PENDING GUI CAPTURE |
| PERF-5 | ERP record write (save) | ms | — | — | PENDING GUI CAPTURE |
| PERF-6 | Knowledge lexical search | ms | — | — | PENDING GUI CAPTURE |
| PERF-7 | Operations dashboard load | ms | — | — | PENDING GUI CAPTURE |
| PERF-8 | AI Workforce invocation | ms | — | — | PENDING GUI CAPTURE · EXTERNAL DEP (AI provider) |
| PERF-9 | Marketplace catalog load | ms | — | — | PENDING GUI CAPTURE (+ backend) |
| PERF-10 | Industry Center open | ms | — | — | PENDING GUI CAPTURE (Preview) |

Also record, once, at idle and under light use: **memory (RSS)** and **CPU%** of the desktop process, and backend process where hosted.

## Capture method

**Desktop UI latency (PERF-1,3,4,5,6,7,9,10):** use the app's own performance overlay / marks where available, or the DevTools Performance panel; time from user action to interactive/painted. Take 10 samples, drop the first (warm-up), record p50/p95.

**Backend latency (PERF-2 and the backend portion of others):** with the backend up, time the relevant endpoints, e.g.:

```bash
# 10 samples of /health latency (seconds)
for i in $(seq 10); do curl -s -o /dev/null -w "%{time_total}\n" http://localhost:4000/health; done
```

Use the desktop network inspector for authenticated calls (don't put tokens on a shell command line).

**Resource use:** Activity Monitor (macOS) for the desktop process RSS/CPU; `GET /metrics` (Prometheus text) for backend counters.

## Honest interpretation

- Local-first ERP read/write is on-device (atomic JSON) — expect low latency independent of the network; capture it to confirm on the target hardware.
- Backend-dependent interactions (sign-in, AI Store, sync) include network + backend time — record the backend location.
- AI invocation latency is dominated by the **external provider** and is not a NeuroPause-controlled number; record it separately.

## Related
[Enterprise Pilot Guide](ENTERPRISE-PILOT-GUIDE.md) · [Pilot Acceptance Criteria](PILOT-ACCEPTANCE-CRITERIA.md) · [Operations Guide](../guides/OPERATIONS-GUIDE.md)
