# ERP SESSION 36 — PRODUCTION BACKUP / RECOVERY INTEGRITY

**Baseline:** Session 35 (`56bf823`).
**Classification:** **A — PRODUCTION IMPLEMENTATION** — a real production change (registers the governed command spine into the authoritative backup registry) proving a real backup/recovery property (exact round-trip recovery of the S18/S31 durable state through the existing sha256-manifest BackupManager). Implemented WITHIN the established contract; no invented policy.
**Status:** 🟢 **GREEN** (real backup → integrity-validate → simulate loss → restore-into-isolated-env → reload → exact match, plus corruption injection + S33 concurrency). **No frozen surface touched. No new engine, store, or policy.**

## 1 · OBJECTIVE

Prove NeuroPause's durable operational state can be backed up, integrity-checked, and recovered without corrupting or bypassing the canonical persistence architecture — specifically closing the gap where the governed ERP command spine (S17–S31) was persisted but silently excluded from backup and pre-migration rollback.

## 2 · DISCOVERY

The repository already has a complete, production-grade local backup/recovery contract:
- `backup/backupManager.ts` — sha256-manifest backups under `<backupsDir>/<id>/`: per-file copy + `manifest.json` (sha256 per file, appVersion, dataVersion, F22 archive scope). `validate` recomputes hashes; `restore` refuses (in order) an escaping id, missing manifest, missing scope declaration, unacknowledged/mismatched restore boundary, failed integrity, and any manifest entry escaping the archive/data dir or not covered by the store-path registry — then snapshots a safety backup and writes atomically (tmp+rename) with `requiresRestart`.
- `storage/storePaths.ts` — the ONE registry (`DOMAIN_FILES`) that backup, pre-migration snapshot, and restore all consume; prefix entries (`enterprise-module-*`) auto-cover module stores.
- Retention (`MANUAL_BACKUP_KEEP=10`, pre-migration exempt), path containment (`resolveContained`: charset + realpath + prefix), and RBAC (`backup:restore` → `cloud:operate`, `backup:create/delete`, `recovery:run`) are all defined. The operator surface already exists (continuity planner → the "Business continuity" panel: local backup count + integrity).

**The gap (reproduced):** the S18 durable command journal `platform-command-journal.json` and the S31 delivered-event sink `platform-delivered-events.json` — both real production `DurableJsonStore` files under userData, each with exactly one production creator (`ipc/handlers/platformCommandIpc.ts` `buildPlatformCommandHandlers`) — were **absent from `DOMAIN_FILES`**. So the entire governed command spine (every committed command's idempotency result + immutable domain event + outbox delivery state, and its delivered confirmation) was outside backup AND pre-migration rollback — exactly the bug-class the registry docstring says it exists to close.

## 3 · AUTHORITATIVE STORES

`platform-command-journal.json` (authoritative: idempotency + domain event + outbox `status/attempts/lastError/deliveredAt`) and `platform-delivered-events.json` (the downstream at-least-once delivery confirmation). `erp-approvals.json` (ERP approval trail) is already registered. The platform/workflow `ApprovalInstanceStore` has NO production userData-file wiring (type-only reference in `workflowRuntime.ts`), so there is no separate approval-instance file to back up — "approval state where applicable" resolves to the already-covered `erp-approvals.json`.

## 4 · CONSISTENCY BOUNDARY

Both platform stores are registered in the **same domain (`business`)**, so a `create('manual', ['business'])` captures them in ONE coherent snapshot pass and `restore` is all-or-nothing across the domain — they can never be restored one-without-the-other into an impossible state. The **journal outbox is authoritative**; the **delivered-event sink is a derived, idempotent, at-least-once confirmation** of it. Any snapshot-time skew (journal marked DELIVERED slightly ahead of a sink row, or a sink row ahead of the journal) is self-healing: the S31 relay's consumer is idempotent (`record` is a no-op when the row exists) and re-drives PENDING/RETRYABLE on the next pass, so neither skew is corrupting. This is documented in the registry comment and proven by the cross-store test.

## 5 · EXISTING POLICY FOUND

Fully defined — retention (keep-10, pre-migration exempt), location (userData `<backupsDir>/<id>/`), restore authorization (`backup:restore` = `cloud:operate`), overwrite (safety snapshot first + atomic tmp+rename + `requiresRestart`), version (manifest `appVersion`/`dataVersion`), integrity (sha256 manifest), encryption (vaults are OS-keychain ciphertext; the platform stores are non-secret business/event data, same class as `erp-approvals.json`/`action-records.json` already backed up). **No decision memo required — implemented within the contract.**

## 6 · CAPABILITY IMPLEMENTED

Registered the two platform durable stores into `DOMAIN_FILES.business`. This single additive change makes the governed command spine automatically covered by every existing data-safety mechanism at once: backup capture, sha256 integrity validation, refuse-closed restore, and pre-migration rollback. The registry entry is **load-bearing for both capture AND restore** — restore's `isCoveredByDomain` check refuses any manifest path not registered for its domain, so without this entry a restore would reject these files.

## 7 · BACKUP INTEGRITY DESIGN

No new snapshot mechanism invented. Internal consistency rests on the EXISTING guarantee: `DurableJsonStore` writes atomically (unique-tmp + rename, S33), so any file on disk is always a complete, coherent JSON snapshot — never a torn/partial write. `copyFile` during a concurrent write therefore captures either the complete pre-write or complete post-write file, never partial JSON. `validate` recomputes sha256 per file; a truncated/modified/missing file → mismatch/missing → invalid → restore aborts. Proven by the §10 concurrency test (archived file always parses; no records lost).

## 8 · RECOVERY DESIGN

The existing `restore`: pre-flight refuses on containment/manifest/scope/boundary/integrity/coverage BEFORE the first byte moves (so a refusal never half-restores), snapshots a safety backup of the current state, then writes each file atomically (tmp+rename) and returns `requiresRestart:true` (the restored files sit under stores holding pre-restore memory; the relaunch re-reads them). S36 recovers into a **separate, isolated recovery data dir** in tests — never the real production data.

## 9 · FAILURE-INJECTION EVIDENCE (13 tests, `backup/session36BackupRecovery.test.ts`)

Driven through the REAL BackupManager + REAL DurableCommandJournal + REAL DeliveredEventLog + REAL S31 relay against isolated temp dirs. Representative state = one DELIVERED, one RETRYABLE (real throwing-consumer failure, attempts≥1 + lastError), one PENDING command.

- Registry coverage: both stores registered under `business`; a backup CAPTURES both (manifest entries present) and validates.
- **§5/§7J round-trip:** capture → validate valid → restore into a fresh isolated recovery dir → reload → journal records (incl. outbox status/attempts/lastError), pendingOutbox count, and delivered-sink count EXACTLY match the pre-backup authoritative state; the DELIVERED/RETRYABLE/PENDING mix survives byte-for-byte.
- **A** valid → valid. **B** truncated archived store → sha256 mismatch → rejected. **C/D** modified content → integrity fail → restore REFUSES (`detail` matches /integrity/). **E** missing required store → `missing` → rejected. **F** missing manifest → restore aborts. **G** a refused restore leaves canonical data byte-identical (pre-flight refuses before any write) and the canonical store still reloads to its real state. **H** after a backup, canonical file is byte-identical and reload yields the original state (backup is read-only). **§7I** concurrent journal reads during backup never corrupt/block; archive valid. **§10** concurrent writes during backup: archived journal always parses (no torn write captured) and no committed record is lost (S33 no-loss: all 6 records present).

## 10 · CROSS-STORE CONSISTENCY EVIDENCE

Test: every journal-DELIVERED event's id has its downstream confirmation row in the recovered delivered sink, and the recovered sink count equals the pre-backup count — the pair is coherent after recovery. Both captured in one domain snapshot; all-or-nothing restore.

## 11 · SECURITY / RBAC

No new permission. Restore/create/delete are already governed (`backup:restore` = `cloud:operate`, etc.). The renderer never chooses arbitrary filesystem paths: backup ids are validated (`resolveContained`: charset + realpath + prefix containment) and manifest paths are re-resolved on both read and write sides and checked against the registry. The platform stores hold non-secret business/event data (no credentials/tokens); backup status exposes no secrets. Secret vaults remain OS-keychain ciphertext (already in the registry, unchanged).

## 12 · TENANT IMPLICATIONS

The archive is a MULTI_TENANT_INSTALL scope (F22, declared) — restore is install-wide, all tenants at once (the existing, declared boundary; the manager refuses construction without the acknowledgement). The journal/sink rows carry `tenantId` on every record; recovery restores the exact per-tenant rows byte-for-byte, so tenant attribution is preserved and no cross-tenant mixing is introduced. No tenant-isolation regression.

## 13 · UI EVIDENCE

The operator surface already exists: the "Business continuity" panel in the Operations Platform tab (via `continuityPlanner` ← `releaseOps.listBackups()`) shows local backup count, latest timestamp, and integrity status (ok / INTEGRITY FAILED). Because the platform spine is now covered by the same BackupManager, its integrity is reflected there automatically. **No new panel was added — a second Backup & Recovery dashboard would duplicate the existing continuity surface (no-duplicate rule; production truth over feature count).** No destructive restore control was added to the UI.

## 14 · S31–S35 REGRESSION

`session31OutboxDelivery` 7/7 · `session32OperationalRead` 12/12 · `session33ConcurrentCommands` 6/6 · `durableJsonStore` 6/6 · `session34PlatformHealth` 12/12 · `session35DeliveryOperations` 13/13 — all pass unchanged. Backup regression: `backupManager` 13/13 · `round10BackupPluginAuthority` 34/34 · `storePaths` 6/6 — all pass (the registry change is additive; `storePaths.test.ts` asserts with `toContain`, not an exact list).

## 15 · FULL TEST COUNTS

Full main (sharded 4×): **956 files · 10012 passed · 7 skipped · 0 failed** (S35 was 955 / 9999 / 7 — delta exactly +1 file / +13 tests, the new backup suite). UI: **73 files · 414 passed** (unchanged — no renderer change). No existing test weakened, skipped, or rewritten.

## 16 · TYPECHECK / LINT / BUILD

typecheck node + web clean; eslint clean on changed/new files; `npm run build` (electron-vite) ✓.

## 17 · PERFORMANCE MEASUREMENTS

The full 13-test S36 suite (each test runs a real backup and most a real restore, over the real BackupManager + real journal state) completes in ~97 ms (13 tests). Backup is bounded — one `copyFile` + one sha256 per registered file, no full-store scan, no rebuild, no write-to-measure. Writes are NOT quiesced/blocked (correct: per-file atomic-rename gives internal consistency without a global lock; inventing a quiesce was explicitly avoided per §4). Recovery is one atomic tmp+rename per file after a full pre-flight. Data volume in tests is small (representative journal + sink); production volume scales linearly with the two files' sizes. No new architecture required.

## 18 · FILES CHANGED

Production source — **MODIFIED** `src/main/storage/storePaths.ts` (register `platform-command-journal.json` + `platform-delivered-events.json` in `DOMAIN_FILES.business`). Tests — **NEW** `src/main/backup/session36BackupRecovery.test.ts` (13). Evidence — this file. (No renderer, no IPC, no new module.)

## 19 · FROZEN SURFACES

**None.** `storePaths.ts` is non-frozen main source; the change is additive to an existing domain array. `MaintenanceDomain` (frozen `packages/shared`) is UNCHANGED — `business` already existed. `certification/baseline.json` was already modified in the working tree at session start (pre-existing, preserved, NOT staged).

## 20 · ARCHITECTURE AUDIT

One canonical persistence layer (`DurableJsonStore`); one canonical command journal (`DurableCommandJournal`); one canonical outbox (the journal record's `outbox`); one canonical delivery sink (`DeliveredEventLog`); one backup engine (`BackupManager`) and one recovery path (its `restore`) — **no shadow database, no second backup/recovery engine, no new store, no cloud/S3/Kafka/Redis/microservice**. No renderer or AI filesystem authority (backup ids validated, paths registry-checked). No frozen shared IPC surface changed. No tenant-isolation regression (per-tenant rows restored byte-for-byte).

## 21 · GREEN / YELLOW / RED / GRAY STATUS

- 🟢 **GREEN** — the governed command spine is now backed up, integrity-checked, and recovered exactly, within the existing contract.
- 🟡 **YELLOW** — packaged-macOS runtime acceptance of a real backup+restore cycle (operator step; standing).
- ⚪ **GRAY (adjacent, out of scope)** — `journal-post-transitions.json` (the CST/FG-11 governed journal-post durable ledger, SEAM-B.8) is also absent from the registry but is owned by the frozen CST kernel path, outside the S31–S35 ERP spine this session addresses; recorded as a candidate for a future, separately-scoped session rather than silently included.
- 🔴 **RED** — none.

## 22 · COMMIT HASH

`feat(erp-s36): production backup recovery integrity` — SHA recorded at commit time (see §23/§24).

## 23 · PUSH STATUS

The Linux sandbox has no git credentials — **push cannot be performed here**. Do NOT assume it was pushed.

## 24 · MAC HANDOFF

From the repo root on the Mac:

```
git log -1 --oneline          # expect the erp-s36 commit at HEAD
git push origin cert/data-import-cst-integration
```

## Status: 🟢 GREEN — the governed ERP command spine (durable journal + outbox + delivered sink) is now provably backed up, integrity-validated, and recovered byte-for-byte into an isolated environment, through the existing sha256-manifest backup contract — no new engine, no invented policy, no frozen change.
