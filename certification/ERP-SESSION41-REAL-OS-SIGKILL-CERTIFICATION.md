# ERP SESSION 41 — REAL OS SIGKILL CRASH-RECOVERY CERTIFICATION

**Baseline:** S40 (`16ef358`).
**Type:** ACCEPTANCE / CERTIFICATION (no new architecture). **No production defect found → no production source changed** (a real defect appeared only in the *test harness* and was fixed there). Commit class `test`.
**Status:** 🟢 **GREEN for the platform-command core** — a REAL OS `SIGKILL` of a REAL separate process running the REAL production journal/intent/outbox code, across all three crash windows + the S38 PROCESSING window, 5 clean repetitions each, plus active-PROCESSING, two-tenant and repeated-restart. 🟡 **YELLOW residual** — the packaged Electron GUI kill (macOS-only; harness provided, operator-executed).

## 1 · EXACT ARTIFACT TESTED

- **In-session (executed):** the REAL production platform-command core — `src/main/platform/command/durableCommandJournal.ts` (S40 intent-first + S38 stale-PROCESSING recovery), `platform/persistence/durableJsonStore.ts`, `platform/command/outboxDispatcher.ts`, `platform/command/deliveredEventLog.ts` — run in a real child process via `node --import tsx e2e/sigkillCrashChild.ts` against real durable files. This is the Electron-FREE platform core proven independent by S19/S21.
- **Mac operator step (harness provided, NOT executed here):** the packaged/production Electron main bundle (`out/main/index.js` or an alternate `--outDir`), driven via `e2e/sigkillPackaged.e2e.cjs`.

## 2 · OS / RUNTIME VERSION

In-session run: **node v22.23.2 on Linux aarch64.** (The repo's Electron binary is the macOS build, so the packaged-GUI kill cannot run off-macOS — hence the Mac operator step.)

## 3 · COMMIT BASELINE

`16ef358 feat(erp-s40): close command dual-write window`.

## 4 · EXACT LAUNCH PROCEDURE

In-session harness (from `apps/desktop`):
```
NODE_PATH="$(git rev-parse --show-toplevel)/node_modules" node e2e/sigkillCrashRecovery.e2e.cjs
```
Each scenario spawns a real child (`node --import tsx e2e/sigkillCrashChild.ts <dir> <phase> <key> <tenant> <order>`) that runs the real journal against a fresh temp profile dir, prints `READY` at the crash boundary, then blocks forever until killed.

## 5 · EXACT SIGKILL PROCEDURE

The parent waits for the child's `READY` line, records the child PID, and calls **`process.kill(pid, 'SIGKILL')`** — an ACTUAL OS `kill -9` across the process boundary. The parent then confirms the child exited with **signal `SIGKILL`** before spawning a fresh recovery process. No graceful shutdown API is ever called. (See the `[killed pid N at <phase> with real OS SIGKILL]` lines in the run output.)

## 6 · S38 CRASH SCENARIO (stale PROCESSING)

Child commits a governed command (durable committed record + PENDING outbox), marks the outbox `PROCESSING` (persisted, this process's `bootEpoch`), prints `READY`, and blocks. Parent SIGKILLs. A fresh process (new `bootEpoch`) runs `reconcileStaleProcessing` → the orphaned `PROCESSING` (prior epoch) is reclaimed to `RETRYABLE`, then the EXISTING `dispatchOutbox` delivers it. **5/5 reps:** reclaimed=1, delivered=1, outbox→DELIVERED, orders=1 (no duplicate).

## 7 · S40 CRASH SCENARIO (dual-write window)

Child runs `journal.run` whose `execute` durably writes the order (the domain effect) then blocks BEFORE the journal commit — the exact S39 window — with the intent already reserved IN_FLIGHT. Parent SIGKILLs. State after kill: order durable, intent IN_FLIGHT (prior epoch), NO committed record. A fresh process reconciles the orphaned intent → HOLD; a same-key retry returns `RECONCILIATION_REQUIRED` and does **not** re-execute. **5/5 reps (Window B):** orders=1 (durable effect), records=0, intent HELD, retry HOLD, orders still 1 (no second effect).

## 8 · BEFORE/AFTER DURABLE-STATE EVIDENCE

Verified through governed reads only (`journal.records`, `journal.heldIntents`, `reconcileStaleProcessing`, `deliveredLog.count`, the order store). After each kill: JSON stores parse cleanly (no torn writes — S33 atomic tmp+rename), no stale `.tmp` corrupts a store, `tenantId` preserved, outbox state correct. The three windows:
- **Window A (before domain effect, 5/5):** no domain effect (orders=0); orphaned intent → HELD; retry HOLD, still no effect.
- **Window B (after effect, before commit, 5/5):** the dual-write window — order durable, no committed command, intent HELD → retry HOLD, no second effect.
- **Window C (after commit, before delivery, 5/5):** committed command survives; existing relay delivers exactly once; outbox→DELIVERED; orders=1; a second recovery pass does not duplicate delivery.

## 9 · DUPLICATE-EFFECT EVIDENCE

Across every window and all repetitions: **exactly one durable order, one committed command (where applicable), one event, one delivered-event row** — no duplicate business effect, no duplicate committed command, no duplicate delivery. Consumer idempotency (DeliveredEventLog by `eventId`) is proven by the second-recovery pass (Window C) staying at delivered=1.

## 10 · OUTBOX / DELIVERY EVIDENCE

Window C + S38: after the kill, `dispatchOutbox` (the S31 relay, unchanged) drains the recovered PENDING/RETRYABLE outbox and delivers once; a repeated recovery does not re-deliver. **At-least-once + idempotent consumer — NOT exactly-once.**

## 11 · TENANT ISOLATION

Two tenants share an idempotency key. Tenant A crashes in the dual-write window → HELD. Tenant B's same-key command commits normally (isolated), and B's read shows no held intent (A's HOLD never leaks to B). Tenant A's same key remains HELD with no second A effect. Intent identity is `${tenantId}::${idempotencyKey}`, so cross-tenant resolution/mutation is impossible.

## 12 · SECURITY EVIDENCE

Renderer/AI cannot write intent or journal files or invoke filesystem recovery directly: the intent/journal/outbox stores live behind `DurableCommandJournal` inside the main process; the only writer is `journal.run`/`reconcile*` on the governed path, and the renderer reaches them ONLY through `platform:command.dispatch` (`requireAuth`) — proven at unit level in S40 (unauthorized command fails before any durable effect, no lingering intent). The packaged renderer-isolation assertion (`window.neuropause.invoke` cannot touch the FS directly) is included in the Mac harness (`sigkillPackaged.e2e.cjs`, operator step).

## 13 · REPEATED-RUN RESULTS

The in-session harness was run to completion **5 consecutive times → 92/92 passed each time** (real OS SIGKILL, real process boundary). Per scenario: Window A ×5, Window B ×5, Window C ×5, S38 PROCESSING ×5, plus active-PROCESSING, two-tenant, and repeated-restart (recovery stable + idempotent across 3 successive restarts). Total real OS SIGKILLs per run: 22.

## 14 · PRODUCTION DEFECT DISCOVERED

**None.** The only defect found was in the TEST HARNESS: the initial `readyAndHang` returned instead of truly blocking, so `execute` occasionally continued and *released* the intent before the SIGKILL landed (a 2/92 flake). Fixed in the harness by making the boundary block on a never-resolving promise + keep-alive timer; 5 subsequent full runs were 92/92 with zero flakes. No production code was touched (per §12 of the mission — the defect did not trace to the canonical architecture).

## 15 · TESTS / REGRESSION COUNTS

New: `e2e/sigkillCrashChild.ts` + `e2e/sigkillCrashRecovery.e2e.cjs` (in-session, 22 real SIGKILLs / 92 assertions per run) + `e2e/sigkillPackaged.e2e.cjs` (Mac operator step). Regression: S18 · S31 · S32 · S33 · S34 · S35 · S36 · S37 · S38 · S39 · S40 = **129/129** unchanged. Full main (sharded 4×): **960 files · 10056 passed · 7 skipped · 0 failed** — IDENTICAL to S40 (no production change). UI: **73 files · 414 passed** (unchanged).

## 16 · FROZEN-SURFACE STATUS

**None touched.** Only new `e2e/*` harness files + this evidence were added; no `src/` production source changed. `certification/baseline.json` pre-modified at session start (preserved, NOT staged).

## 17 · ARCHITECTURE SINGULARITY AUDIT

Confirmed unchanged and singular: ONE Electron application, ONE secure preload bridge, ONE `platform:command.dispatch` channel, ONE Application Boundary, ONE Command Bus, ONE `DurableCommandJournal`, ONE intent/idempotency mechanism, ONE outbox, ONE `DeliveredEventLog`, ONE `DurableJsonStore` primitive, ONE S38 boot reconciliation path, ONE S40 intent recovery path, ONE audit path. No new database / WAL / queue / lock framework / transaction engine / recovery engine / shadow store / microservice — this session added only test harnesses.

## 18 · FINAL GREEN / YELLOW / GRAY STATUS

- 🟢 **GREEN** — the platform-command core (journal + intent + outbox + delivered sink) survives a REAL OS `SIGKILL` at every crash window with the expected S38/S40 semantics: no duplicate business effect, no duplicate committed command, no duplicate delivery, durable intent, preserved tenant, valid JSON, exactly-once *domain effect* per idempotency key, at-least-once delivery with an idempotent consumer, explicit HOLD/RECONCILIATION_REQUIRED for the ambiguous dual-write case. Stable across 5 repetitions.
- 🟡 **YELLOW (residual, operator step)** — the REAL PACKAGED ELECTRON GUI process kill on macOS. Cannot run off-macOS (the Electron binary is macOS); `e2e/sigkillPackaged.e2e.cjs` is provided and syntax-valid, to be executed on the Mac (commands in §Mac handoff). This closes the "real kill" concern for the production persistence/recovery CODE now; the packaged-GUI wrapper is the remaining acceptance step.
- ⚪ **GRAY** — none.
- 🔴 **RED** — none.

**Honest guarantee (unchanged):** durable intent + crash-safe recovery + at-least-once delivery + idempotent consumer + explicit reconciliation for ambiguous domain state. **NOT exactly-once execution.**

## 19 · COMMIT

`test(erp-s41): certify packaged crash recovery` — SHA at commit time.

## 20 · PUSH STATUS

The Linux sandbox has no git credentials — **push cannot be performed here**. Reported honestly.

## MAC HANDOFF

```
# In-session real-OS-SIGKILL certification (also runs on the Mac; pure node, no build needed):
cd apps/desktop
NODE_PATH="$(git rev-parse --show-toplevel)/node_modules" node e2e/sigkillCrashRecovery.e2e.cjs   # expect: 92 passed, 0 failed

# Packaged Electron real-OS-SIGKILL (macOS only — closes the YELLOW):
env -u NP_E2E_BUILD npx electron-vite build --outDir "$PWD/out-seam-s41"
NODE_PATH="$(git rev-parse --show-toplevel)/node_modules" node e2e/sigkillPackaged.e2e.cjs --phase=1 --main="$PWD/out-seam-s41/main/index.js"
# then relaunch the SAME profile printed by phase 1:
NODE_PATH="$(git rev-parse --show-toplevel)/node_modules" node e2e/sigkillPackaged.e2e.cjs --phase=2 --profile=<dir> --main="$PWD/out-seam-s41/main/index.js"

# push:
git push origin cert/data-import-cst-integration
```

## Status: 🟢 GREEN (core) — the real production journal/intent/outbox/recovery code survives real OS SIGKILL at every crash window, 5× stable, with the honest S38/S40 semantics and no duplicate effects. The packaged Electron GUI kill remains the single YELLOW operator step on macOS, with a provided harness.
