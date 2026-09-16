# ERP SESSION 33 — DURABLE PERSISTENCE CONCURRENCY HARDENING

**Baseline:** Session 32 (`fc551a1`).
**Classification:** **PRODUCTION IMPLEMENTATION** — the shared production persistence primitive `DurableJsonStore` was actually corrected. Not certification-only.
**Status:** 🟢 **GREEN** — the S32 RED gate is closed (reproduced → fixed at the primitive → attacked → regressed → recovery proven). No frozen surface touched.

## 1 · S33 OBJECTIVE

Fix the real RED reliability defect S32 found: `DurableJsonStore` concurrent writes collide on a shared temp filename; `journal.run` can throw ENOENT (records may still persist) under concurrent commands. Fix the canonical primitive itself — not the callers, not the command bus, not the UI.

## 2 · ORIGINAL RED DEFECT

"DurableJsonStore concurrent-write race: temporary-file collision causes `journal.run` failure under concurrent writes." S32 observed ~7/8 failures on 8 concurrent different-key `CreateSalesOrder`.

## 3 · REPRODUCTION EVIDENCE (BEFORE)

New `durableJsonStore.test.ts` driving the primitive directly: **6/6 tests FAILED** against the vulnerable implementation, with the exact mechanism — `Error: ENOENT: no such file or directory, rename '<file>.tmp' -> '<file>'` — plus lost-write assertions (`expected false to be true`). The ERP-path harness reproduced the same ~1/8 success rate on concurrent governed commands.

## 4 · ROOT CAUSE

`persist()` wrote to a FIXED `${filePath}.tmp` then renamed it over the canonical file. Two concurrent persists shared that one temp path: (a) the second `rename` throws ENOENT because the first already renamed the shared tmp away; (b) each persist snapshots the in-memory map at entry, so a persist holding a stale snapshot could rename LAST and clobber a newer committed record (lost update). Records sometimes landed on disk while `journal.run` still reported failure — a false-negative on the commit.

## 5 · EXACT FIX

Inside `DurableJsonStore` only (the canonical primitive):
1. **Per-store write serialization** — a per-INSTANCE chained-promise latch (the established S24/S28/S31 pattern) runs all mutating persists strictly one-at-a-time. Concurrent puts to the SAME store therefore never race the write→rename; each persist snapshots the map AFTER the previous commit, so the final file equals the final map (no lost write). Unrelated stores each have their own queue and are never serialized against one another. The queue tail is normalized so one persist failure never poisons later writes, and because each persist re-snapshots at run time, a failed-then-retried write is self-healing.
2. **Unique per-persist temp filename** (`${filePath}.<uuid>.tmp`) with cleanup on error — defense-in-depth that removes the temp-collision vector at the filesystem level even for any hypothetical un-serialized persist, and guarantees a failed write leaves no stale temp file to become authoritative state.
`destroy` was routed through the same chain so a reset can't race a pending write. No new database, service, global lock, or storage abstraction.

## 6 · PRODUCTION FILES CHANGED

- **MODIFIED** `platform/persistence/durableJsonStore.ts` — the two-part fix above.
- **NEW** tests: `platform/persistence/durableJsonStore.test.ts` (6, primitive) + `ipc/handlers/session33ConcurrentCommands.test.ts` (6, real governed path).

## 7 · CONCURRENCY MODEL

Per-store single-flight write chain: writes to one `DurableJsonStore` instance are serialized and commit in enqueue order (a NEW, documented per-store ordering guarantee); different instances proceed concurrently. Per-record atomicity (one `rename`) is preserved; reads (`get`/`all`) are unchanged pure in-memory snapshots. This is the same chained-promise pattern S24 (receipt posting), S28 (invoice conversion) and S31 (outbox drain) already use.

## 8 · BEFORE / AFTER STRESS RESULTS

- **Before:** 6/6 primitive tests fail (ENOENT + lost writes); concurrent governed commands ~1/8 succeed.
- **After:** primitive tests **6/6 pass, stable 8/8 runs**; concurrent governed commands **6/6 pass, stable 6/6 runs** — 2, 8, and 12 concurrent different-key writes/commands all resolve, all persist, none lost, canonical file always valid JSON, no stale temp file left.

## 9 · JOURNAL VERIFICATION

Direct `DurableCommandJournal.run` × 8 concurrent different-key transactions: all commit, 8 durable records, 8 after `reload()`. Governed `CreateSalesOrder` × {2,8,12} concurrent: all `ok`, journal holds exactly N records.

## 10 · OUTBOX VERIFICATION

Every concurrently-committed event is delivered by the S31 relay: `deliveredLog.count(tenant) === N` for N concurrent commands; `pendingOutbox` drains to 0; delivery survives restart.

## 11 · S31 REGRESSION

`session31OutboxDelivery.test.ts` — all pass (part of the 60/60 platform-command run). The S31 relay behavior is unchanged; it now sits on a concurrent-safe store.

## 12 · S32 REGRESSION

`session32OperationalRead.test.ts` — all pass. The governed read is unaffected; concurrent reads during writes remain safe (the read never mutates).

## 13 · RESTART / RECOVERY VERIFICATION

After concurrent writes: `reload()` recovers the exact committed set and values; the canonical file is always valid JSON (no torn write); a failed persist removes its own temp and never corrupts the canonical file; no stale temp file becomes authoritative; retry does not duplicate durable records (idempotent journal keys unchanged).

## 14 · TENANT / SECURITY VERIFICATION

The fix is an implementation detail of the storage primitive — it changes no tenant field, no scope resolver, no authorization, no journal ownership, no audit, no outbox/delivered-event attribution (each record still carries its own `tenantId`, stamped and filtered by the consumer). Full tenant/security regression (org-store, tenancy, IPC-authz suites) passes within the full run.

## 15 · FULL REGRESSION

Full main (sharded 4×): **953 files · 9974 passed · 7 skipped · 0 failed** (S32 951/9962; delta +2 files/+12 tests). UI: **71 files · 408 passed**. No existing test weakened, skipped, or rewritten.

## 16 · TYPECHECK / LINT / BUILD

typecheck node+web clean; eslint clean (changed files); `npm run build` (electron-vite) ✓.

## 17 · RED → GREEN DECISION

**RED → GREEN.** The original failure (concurrent-write temp-file collision → `journal.run` ENOENT / lost write) is genuinely eliminated in the canonical primitive (6/6 reproduction now passes, stable across repeated runs), and the surrounding production paths — journal, outbox, S31 relay, S32 read, idempotent replay, restart — remain correct and are now concurrency-safe. The gate is closed by a real primitive fix, not by changing tests.

## 18 · ARCHITECTURE AUDIT

`DurableJsonStore` remains the single canonical persistence primitive (fixed in place). No second storage system, journal, outbox, event store, or locking framework; the latch is a per-instance chained promise, not a global lock. No command-bus change was required. S31 relay + S32 read model remain canonical. No renderer→DB, no AI→DB, no tenant boundary weakened. Only the primitive + two test files changed; no frozen surface.

## 19 · REMAINING YELLOW / RED / GRAY

- 🟢 The S32 RED gate is now closed.
- 🟡 Packaged-macOS runtime acceptance of concurrent-command reliability (operator step; cannot run from Linux).
- ⚪ GRAY: write throughput under extreme per-store contention — the per-store chain serializes only same-store writes and each write is a full file rewrite (O(n)); fine for realistic desktop volumes. A future coalescing/batched-persist optimization is possible if a genuine bottleneck is ever measured (not observed; not speculatively added).

## 20 · NEXT RECOMMENDED SESSION

Optional persist-coalescing for high-contention stores (collapse a burst of queued persists into one write) — a pure performance optimization, only if a measured bottleneck justifies it; otherwise resume the production-readiness track (health/readiness probe for the platform, the next MISSING capability from the S31 census).

## Status: 🟢 GREEN — canonical persistence primitive corrected for concurrent production usage

`DurableJsonStore` is now safe under its supported concurrent-write usage: concurrent governed commands all commit and deliver, restart recovers the exact set, and no false failure or lost write occurs — fixed at the real primitive, with no parallel architecture, no frozen change, and the defect reproduced-first and proven eliminated.
