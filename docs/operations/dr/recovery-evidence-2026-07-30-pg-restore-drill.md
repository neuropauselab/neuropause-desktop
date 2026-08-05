# Recovery Evidence — 2026-07-30 — PostgreSQL restore drill (scheduled)

Filled from live execution during Phase 5 validation (LV6b). Scope: the
**restore-path subset** of DR-PLAN §2 — backup fetched from Spaces and restored
into a scratch database with content validation. This is not a full §2
production-recovery exercise; it measures the restore mechanics that feed the
RTO.

## Header

- Type: ☑ scheduled drill ☐ real incident
- Scenario (DR-PLAN §): §2 (PostgreSQL), restore-path subset
- Date / time zone: 2026-07-30, UTC
- Incident Commander: n/a (drill; single operator)
- Recovery Operator: Saurabh Patel (paste-in validated blocks)
- Scribe: Claude (Phase 5 live-validation session)
- Related record: docs/operations/PHASE5-LIVE-VALIDATION.md (TASK 6)

## Objectives vs. measured

| Metric | Objective | Measured | Met? |
|--------|-----------|----------|------|
| Restore-path duration (subset of RTO) | ≤ 1h (full-scenario target) | **12 s** (fetch + restore + validate, 108,783-byte archive) | ☑ (subset) |
| RPO (backup age at restore) | ≤ 24h | **26 s** (backup 16:43:04Z, restore start 16:43:30Z) | ☑ |

- Backup created (UTC): 2026-07-30T16:43:04Z (`pg/nems-prod-pg/2026/07/30T164304Z.dump`)
- Restore job start: 2026-07-30T16:43:30Z
- Restore job completion: 2026-07-30T16:43:42Z
- **Measured restore-test duration: 12 seconds**

## Backup / snapshot used

- Store: PostgreSQL `nems-prod-pg`, database `nems` (via `DATABASE_URL_DIRECT`,
  private VPC host, port 25060)
- Backup key: `pg/nems-prod-pg/2026/07/30T164304Z.dump`
- Size: 108,783 bytes; pg_restore TOC entries: 288
- Upload verification at capture: remote bytes == local bytes (108,783)
- Fetch verification at restore: remote bytes == local bytes (108,783)

## Timeline (UTC)

| Time | Actor | Action | Result |
|------|-------|--------|--------|
| 16:23:27 | operator | backup #1 (defaultdb — misconfigured URI) | VERIFIED upload of 1,048-byte EMPTY dump |
| 16:37:04 | operator | restore test #1 of backup #1 | `user_tables_after_restore=0` → job FAILED LOUDLY (by design) |
| 16:39:58 | operator | backup #2 attempt (pool alias `nems-pool`) | pg_dump FATAL: database does not exist (loud) |
| 16:42:53 | operator | backup URI rebuilt from `DATABASE_URL_DIRECT` (db `nems`, private host) | secret recreated |
| 16:43:04 | job | backup #3 of database `nems` | 108,783 B / 288 TOC / upload VERIFIED |
| 16:43:30 | job | restore test #3 into `nems_restore_scratch` | fetch byte-verified |
| 16:43:42 | job | restore + validation complete | **user_tables_after_restore=36; RESTORE-TEST PASSED** |

## Validation results

- ☑ Archive TOC validated before restore (`pg_restore --list`)
- ☑ Fetch byte equality (remote == local == 108,783)
- ☑ Restore with `--clean --if-exists --exit-on-error` into scratch DB
- ☑ **36 user tables** present after restore
- ☑ Production untouched (target was `nems_restore_scratch` on the same instance)

## Deviations from the plan

The drill's first two attempts exposed **D7**: the operator-supplied backup URI
targeted `defaultdb` (console default) and then the PgBouncer pool alias
(`nems-pool`); both failed — the first only at the restore-test stage (every
checksum on the empty backup passed). Corrective: the backup URI is now derived
from the application's own `DATABASE_URL_DIRECT` (real database, private host).
This is the strongest possible demonstration of why the monthly restore-test
cadence exists.

## Corrective actions

| Action | Owner | Status |
|--------|-------|--------|
| Backup URI derived from `DATABASE_URL_DIRECT` (db `nems`, VPC host) | operator | DONE 2026-07-30 |
| Deferred: backup job to log the database name it dumps (visible wrong-target) | backlog | OPEN |
| Monthly restore-drill cadence begins (scratch DB `nems_restore_scratch` retained) | operator | SCHEDULED |

## Sign-off

- Operator: Saurabh Patel — drill executed 2026-07-30 via validated blocks
- dr/README.md measured column updated in the same commit as this record
