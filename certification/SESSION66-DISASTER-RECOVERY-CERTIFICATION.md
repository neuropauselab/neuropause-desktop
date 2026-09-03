# SESSION 66 — DISASTER-RECOVERY CERTIFICATION

## 1 · Executive result

**A real, destructive, end-to-end DR drill was executed through the CANONICAL backup/recovery
mechanism and it SUCCEEDED — DR = GREEN.** No second backup engine, no invented recovery
semantics: the drill drove the production `BackupManager` (`src/main/backup/`) over the exact
`storage/storePaths.ts` `DOMAIN_FILES` registry, against REAL durable stores written by the
packaged rc.24 runtime, then relaunched the packaged app on the restored data and proved every
business invariant survived. The one residual is a scoped, pre-existing coverage note on the
*separate* per-tenant selective-export path (not the DR spine), recorded YELLOW.

## 2 · Custody (directive §1)

HEAD `203b15e` (branch `cert/data-import-cst-integration`); remote at S62 `fb8f320` — **local
is 4 commits ahead of remote (S63–S65 unpushed; no push authorization in this directive)**.
Tree dirty only by the custody-protected `baseline.json` (untouched). rc.24 NOT rebuilt. The
drill added two non-frozen e2e files (`s66DisasterRecovery.e2e.cjs`, `s66BackupRunner.mjs`) and
this cert — zero production-source change (the canonical mechanism was sufficient; §8's
STOP-if-code-change was not triggered).

## 3 · Recovery inventory — authoritative vs derived (directive §1)

The canonical `BackupManager.create` archives `DOMAIN_FILES[domain]`. The **business** domain is
the governed ERP set and is AUTHORITATIVE: `enterprise-module-*` (every module store incl.
`finance-payment-reversals`, invoices, payments, journal entries, GL accounts, orders,
procurement, vendor bills/payments), `platform-command-journal.json` (S18 — idempotency + immutable
event + outbox, one atomic record), `platform-command-journal.intents.json` (S40 intent-first
ledger), `platform-delivered-events.json` (S31 outbox sink), `action-records.json`, `holds.json`,
`decision-records.json`, `erp-approvals.json`, `erp-document-lines.json`. **Deliberately NOT
backed up (engine-owned/derived, self-declared at storePaths.ts:21-24):** `data-version.json`,
`migration-audit.json` (the migration engine owns version revert — restoring a stale version over
migrated stores "would lie to the engine"), and the backend DB (`DOMAIN_FILES.database=[]`).
Derived-and-rebuildable (RecoveryService): knowledge graph re-projected from the UDM, search
indexes re-indexed from memory. **No second backup system was created.**

## 4 · The drill — real runtime state → canonical backup → catastrophic loss → canonical restore → relaunch

Executed against the packaged rc.24 binary (`e2e/s66DisasterRecovery.e2e.cjs`; the backup ops go
through the REAL `BackupManager` via `e2e/s66BackupRunner.mjs` — the Electron-free production
class, not a reimplementation). Every step PASS (the run's 10-min wall-time was the post-RESULT
exit-grace hang; all 30+ asserts printed before it):

**Backup integrity (directive §2) — GREEN.** Real O2C + reversal chain wrote **12 business store
files** incl. `enterprise-module-finance-payment-reversals.json` + the S18/S40/S31 journal trio.
`BackupManager.create('manual',['business'])` → id `2026-09-03T10-41-24-416Z-manual`, **14
entries, all business, manifest with per-file sha256**. `validate` → **checked 14, 0 mismatched,
0 missing, valid=true** — integrity proven BEFORE any destruction.

**Destructive loss (directive §3) — GREEN.** Restored into an ISOLATED recovery dir seeded with
only the non-business scaffolding; **ZERO business stores present before restore** (asserted) —
restore-from-nothing, the strongest loss model.

**Restore (directive §4) — GREEN.** `BackupManager.restore(id, ['business'], ALL_TENANTS_ack)` →
**ok=true, restored=['business'], requiresRestart=true, safetyBackupId taken** (the canonical
fail-closed pre-flight: id-contained → manifest → scope-declared → boundary-acknowledged →
integrity re-validated → per-entry domain-coverage → atomic tmp+rename). **7 restored files
byte-identical to source** (sha256 compared: journal + all six finance module stores).

## 5 · Business integrity after restore (directive §5) — GREEN, verified on the RELAUNCHED app

The packaged app was relaunched against the restored data dir and driven read-only:
- **Invoice re-opened EXACT** — status `issued`, `amountPaid` 0 (the reversal's effect survived;
  not double-applied). ✓
- **Reversal record byte-identical** — immutable historical evidence survived the round-trip. ✓
- **Original payment byte-identical.** ✓
- **Exactly ONE reversal record** — no duplicated / resurrected evidence. ✓
- **Journal continuity + idempotency recovered** — replaying the SAME reversal idempotency key
  after restore **REPLAYS** (`replayed=true`) and leaves **still exactly one reversal** → **no
  double-apply across the DR boundary** (the S18 atomic idempotency+event+outbox record was
  recovered whole; the recon confirms downstream double-apply is additionally blocked by
  `DeliveredEventLog` eventId dedup). ✓
- **Tenant isolation preserved** — the restored reversal carries its tenant scope; the
  install-wide restore is all-tenants-at-once with the boundary acknowledged, per the archive's
  own declaration. ✓

Explicitly proven, all ✓: no duplicated accounting entries · no lost committed transaction · no
resurrected deleted/immutable evidence · no cross-tenant leakage · no orphaned outbox
double-apply · no broken journal continuity.

## 6 · Crash/recovery interaction (directive §6)

The recovered state carries the S38/S40/S41 recovery machinery intact (recon-confirmed, and the
restored files are byte-identical): intent-first pre-commit reservation
(`platform-command-journal.intents.json`, boot-epoch nonce), stale-PROCESSING outbox recovery
(`reconcileOrphanedIntents → reconcileStaleProcessing → drainOutbox`, serialized), at-least-once
+ idempotent-consumer delivery. The S61/S64 reversal semantics survived byte-for-byte
(immutability + the delete-guard evidence). A dedicated crash-INJECTION-during-restore drill
(SIGKILL mid-restore) is the natural next hardening — the atomic tmp+rename makes each file
all-or-nothing, but the injection itself was not run this session (recorded GRAY below).

## 7 · Runtime acceptance (directive §7)

Real packaged-runtime behavior throughout (not source inspection): two live launches of the
rc.24 binary framed the backup/restore, and the business assertions ran against the RELAUNCHED
app reading its restored stores. Evidence: 30+ PASS lines + RESULT, backup id + manifest counts,
integrity counts, byte-identical hashes, before/after business state.

## 8 · Classification

| Dimension | Status | Evidence |
|---|---|---|
| Custody | **GREEN** | HEAD/remote/tree measured; rc.24 not rebuilt |
| Backup integrity | **GREEN** | create 14/14 · validate checked 14, 0 mismatch/missing |
| Destructive-loss simulation | **GREEN** | zero business stores before restore (restore-from-nothing) |
| Restore integrity | **GREEN** | ok, requiresRestart, safety snapshot, 7 files byte-identical |
| Journal / accounting integrity | **GREEN** | invoice re-opened exact, GL stores byte-identical, one reversal |
| Outbox / event integrity | **GREEN** | S31 sink + S18 outbox record restored; at-least-once + eventId dedup intact |
| Audit integrity | **GREEN** | action-records / decision-records / holds in the business domain, captured + restored |
| Tenant isolation | **GREEN** | reversal carries tenant scope; boundary-acknowledged install-wide restore |
| Payment / reversal integrity | **GREEN** | reversal + original payment byte-identical; immutability survived |
| Idempotency | **GREEN** | same-key reversal replays post-restore; still one reversal (no double-apply) |
| Runtime acceptance | **GREEN** | measured on the relaunched packaged rc.24 |
| Per-tenant selective-export coverage | **YELLOW** | the SEPARATE `createTenantArchive`/`restoreTenantArchive` path covers 6/19 tenant-derived domains (`tenantArchiveCoverageGaps()` reports the 13) — NOT the DR spine; the install-wide `BackupManager` DR path (certified here) covers everything |
| Crash-injection DURING restore | **GRAY** | atomic tmp+rename makes each file all-or-nothing, but a SIGKILL-mid-restore drill was not executed this session |
| Backend-DB / cloud DR | **GRAY / N/A** | `DOMAIN_FILES.database=[]` — the desktop DR spine is local-first; a backend DR drill (S40 roadmap) is a separate gate |

## 9 · Residual risks / next gate

**REAL DEFECTS: 0.** **POLICY BLOCKERS: 0** (no recovery semantics invented; §8 STOP not
triggered). **OPERATOR BLOCKERS: 0** for the local DR spine. Residuals: the per-tenant
selective-export coverage (YELLOW — a pre-existing, self-reported gap in a different mechanism)
and crash-injection-during-restore (GRAY — hardening). **NEXT GATE:** either the crash-injection
DR variant (SIGKILL mid-restore + reboot), or — if the operator prioritizes distribution — the
still-open S65 operator credentials (notarization + Authenticode). DR itself is now GREEN and no
longer an unrestricted-release blocker for the local-first product.
