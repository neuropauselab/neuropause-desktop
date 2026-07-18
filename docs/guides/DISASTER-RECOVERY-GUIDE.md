# NeuroPause — Disaster Recovery Guide

**Audience:** operators, SREs, and support engineers responsible for backing up and
recovering a NeuroPause deployment.
**Status:** Enterprise GA.
**Scope of honesty:** Disaster recovery is safety-critical, so this guide draws a hard
line between mechanisms that are **REAL** (implemented, verifiable in source) and those
that are **MODELED** (present as a data model / UI, but not backed by physical
replication or a second cluster). Every capability below cites the source file and line
that implements it. Where a capability does not exist, that is stated plainly rather than
implied.

> Citations use repo-relative paths. Desktop main-process files live under
> `apps/desktop/src/main/` (referred to in code comments as `main/…`); backend files
> under `apps/backend/src/`.

---

## 1. Overview & DR Reality

NeuroPause is a **local-first desktop application** with an **optional backend service**
(Postgres + Redis + API). Its disaster-recovery story is therefore two independent
stories that must be handled separately:

| Tier | What holds the data | Real recovery mechanism |
|---|---|---|
| **Desktop (local stores)** | JSON stores under Electron `userData` | `BackupManager` sha256 snapshot / validate / restore (`apps/desktop/src/main/backup/backupManager.ts`) |
| **Backend (server of record)** | Postgres (containerized or managed) | `pg_dump` / `psql` scripts (`scripts/backup-db.sh`, `scripts/restore-db.sh`) |

### What is REAL

- Per-file **sha256 snapshot, integrity validation, and restore** of the desktop's local
  stores, with an automatic safety backup taken before any restore
  (`backupManager.ts:83`, `:135`, `:151`, `:161`).
- **Scheduled** desktop backups every 24h, retaining the 10 most recent
  (`apps/desktop/src/main/releaseOps/index.ts:57`, `:58`, `:212`).
- A **transactional, forward-only** backend migrator over 12 SQL migrations
  (`apps/backend/src/db/migrate.ts:39`).
- A desktop **migration engine** that takes a pre-migration backup and **auto-restores on
  failure** (`apps/desktop/src/main/migration/migrationEngine.ts:91`, `:106`–`:129`).
- A local **crash reporter** and a **Recovery Center** with 8 recovery actions including
  **Safe Mode** (`apps/desktop/src/main/services/crashReporter.ts`,
  `apps/desktop/src/main/recovery/recoveryService.ts`).
- **Interrupted-session recovery** on desktop relaunch
  (`apps/desktop/src/main/runtimeCore.ts:1344`).
- Real, deployable **Kubernetes/Helm** artifacts including a one-off **migrate Job**
  (`deploy/helm/neuropause-backend/templates/migrate-job.yaml`,
  `deploy/kubernetes/backend.yaml:44`).

### What is MODELED (do not treat as real DR)

- The **Federation "Disaster Recovery"** module (multi-region backups, cross-region
  replication, recovery validations) is a **data model only**. Its own source comment
  states: *"backups are metadata records … replication and validation are modeled"*
  (`apps/desktop/src/main/federation/dr/drStore.ts:6`–`:10`). There is **no second
  cluster and no physical cross-region replication**. See §7.
- **Application-binary rollback** after a bad update is **advisory only** — the app
  computes which version it *would* revert to but performs **no downgrade**
  (`apps/desktop/src/main/services/appUpdater.ts:88`, `:187`). Real recovery from a bad
  update is **data-side**, not binary-side. See §5.

The practical consequence: NeuroPause's built-in DR is **single-host / local-first**. It
protects against data corruption, bad migrations, and crashes on a given machine. It does
**not**, by itself, protect against loss of the host or disk, because desktop backups are
co-located with the data and the in-repo backend backup is a local dump. Production-grade
durability (off-host storage, PITR, replicas, tested drills) must be supplied by the
deployment — see §8.

---

## 2. Backups — What, Where, Schedule, Coverage Gaps

### 2.1 Desktop local stores (`BackupManager`)

**What a backup is.** A directory `<backupsDir>/<id>/` containing a copy of each protected
domain's files plus a `manifest.json` that records a **sha256 per file**
(`backupManager.ts:2`–`:9`, `:107`, `:121`). Integrity validation recomputes those hashes
(`backupManager.ts:135`–`:148`).

**Protected domains** (`backupManager.ts:29`–`:39`):

| Domain | Files backed up |
|---|---|
| `registry` | `registry.json` |
| `configuration` | `telemetry.json`, `crash-reporting.json`, `update-prefs.json`, `window-state.json`, `connectors.json` |
| `workspace` | `enterprise-workspaces.json`, `enterprise-org.json` |
| `knowledgeGraph` | `graph.json`, `unified-store.json` |
| `aiWorker` | `workforce-registry.json`, `workforce-jobs.json`, `workforce-audit.json` |
| `plugin` | `plugins.json`, `plugins/`, `plugin-data/` |
| `aiMemory` | `memory.json` |
| `timeline` | `timeline/` |
| `database` | **(empty — see coverage gap below)** |

**Where.** Under the Electron `userData` directory (the same profile that holds the live
stores). Backups are written to `<backupsDir>/<id>/`, `manifest.json` with mode `0600`
(`backupManager.ts:121`).

**Schedule & retention.**

- Automatic scheduled backup **every 24 hours**
  (`SCHEDULED_BACKUP_INTERVAL_MS = 24 * 60 * 60 * 1000`, `releaseOps/index.ts:57`),
  running the `LOCAL_DOMAINS` set (`releaseOps/index.ts:214`).
- Retention: the **10 most recent** scheduled backups are kept; older scheduled backups
  are pruned (`SCHEDULED_BACKUP_KEEP = 10`, `releaseOps/index.ts:58`, `:217`).
- Additional backups are created **on demand** (manual), **automatically before every
  migration** (§4), and **automatically before every restore** as a safety snapshot
  (`backupManager.ts:161`–`:162`). Only `scheduled`-trigger backups are auto-pruned, so
  manual, pre-migration, and safety backups persist until deleted.

**Coverage gap — the backend database is NOT in local backups.** The `database` domain is
deliberately empty (`backupManager.ts:30`) because the backend DB is server-side. The
source comment is explicit: *"The backend database is server-side and intentionally not a
local-backup domain"* (`backupManager.ts:26`–`:27`). `LOCAL_DOMAINS` is defined as every
domain **except** `database` (`backupManager.ts:44`). Backend data is covered only by §2.2.

**Coverage gap — backups are on the same host as the data.** Desktop backups live under
`userData`. They protect against accidental deletion, corruption, and failed migrations,
but a **disk/host loss destroys the backups along with the live data.** There is no
built-in off-host copy.

### 2.2 Backend Postgres (`scripts/backup-db.sh`)

**What.** A timestamped, gzip-compressed **`pg_dump`** of the production database
(`scripts/backup-db.sh:22`, `:27`–`:29`). `pg_dump` runs inside the Postgres container
using the container's own `POSTGRES_USER`/`POSTGRES_DB`, so the script needs no DB
credentials (`scripts/backup-db.sh:25`–`:28`).

**Where.** `./backups/neuropause-db-YYYYMMDD-HHMMSS.sql.gz` on the host running the script
(`BACKUP_DIR` default `backups`, `scripts/backup-db.sh:17`, `:22`).

**Retention.** Keeps the **14 most recent** dumps; older ones are pruned
(`BACKUP_RETENTION` default 14, `scripts/backup-db.sh:18`, `:33`–`:42`).

**Schedule.** **None is shipped.** `backup-db.sh` is **operator-run**; the production
compose stack contains no scheduled backup service (`docker-compose.prod.yml` defines only
`postgres`, `redis`, `backend`). You must invoke it manually or wire it to an external
scheduler (cron / systemd timer / CI). Backup frequency — and therefore your backend RPO
(§6) — is entirely a function of how often you run it.

**Redis.** Redis is configured append-only (`--appendonly yes`,
`docker-compose.prod.yml:33`) persisting an AOF to the `redisdata` volume. It holds
cache/session state and has **no dedicated backup script**; treat it as reconstructible,
not as a system of record.

---

## 3. Restore Procedures

### 3.1 Restore desktop local stores (Recovery Center or IPC)

The restore path is integrity-checked and self-protecting (`backupManager.ts:151`–`:187`):

1. **Validate first.** Restore reads the manifest and runs `validate()`; if any file is
   missing or its sha256 does not match, **the restore aborts** with
   `"integrity check failed; restore aborted"` and touches nothing
   (`backupManager.ts:156`–`:159`).
2. **Safety snapshot.** Before overwriting, it snapshots the **current** state as a new
   manual backup and returns its id as `safetyBackupId`
   (`backupManager.ts:161`–`:162`, `:184`). If a restore turns out to be wrong, you can
   restore that safety backup to get back.
3. **Selective restore.** You may restore all domains or a subset; files for unwanted
   domains are skipped (`backupManager.ts:163`–`:177`).

Operator entry points:

- **Recovery Center → Restore Backup.** Invoked via the `RecoveryRun` IPC action
  `restoreBackup` (`recoveryService.ts:76`, `:164`–`:174`), which delegates to
  `BackupManager.restore`. This action is authorization-gated (`org:manage`,
  `apps/desktop/src/main/ipc/runtimeAuthz.ts:83`) and reports the safety-backup id back to
  the user (`recoveryService.ts:172`).
- **Direct IPC:** `BackupList` → `BackupValidate` → `BackupRestore`
  (`releaseOps/index.ts:234`, `:247`, `:252`). Validate a backup before trusting it.

A restore reports `requiresRestart: true` (`recoveryService.ts:170`); relaunch the app so
stores reload from the restored files.

### 3.2 Restore the backend Postgres database (`scripts/restore-db.sh`)

```sh
# List available dumps, then restore a chosen one:
scripts/restore-db.sh backups/neuropause-db-YYYYMMDD-HHMMSS.sql.gz
```

Behavior (`scripts/restore-db.sh`):

- Requires an existing dump file; with no/invalid argument it lists available backups and
  exits non-zero (`restore-db.sh:13`–`:20`).
- **Destructive + confirmed.** The dump is created with `--clean --if-exists`, so it
  **drops and recreates** objects — it **overwrites the current database**. The script
  prints a warning and requires you to type `yes` to proceed
  (`restore-db.sh:7`–`:8`, `:22`–`:29`).
- Restores via `gunzip -c … | psql -v ON_ERROR_STOP=1` inside the Postgres container
  (`restore-db.sh:31`–`:33`). `ON_ERROR_STOP=1` aborts on the first SQL error rather than
  applying a partial restore.

After restore, restart the backend so pooled connections are re-established.

> **No point-in-time recovery (PITR).** Restore replays a **whole dump**. There is no WAL
> archiving or PITR in-repo, so you can only recover to the state captured by a specific
> dump — never to an arbitrary moment between dumps. Closing that gap requires managed
> Postgres or a WAL-archiving setup (§8).

---

## 4. Migration-Failure Recovery

### 4.1 Desktop data migrations (auto-recovering)

The desktop migration engine is built to guarantee that **a failed migration never leaves
a half-upgraded store** (`migrationEngine.ts:6`–`:11`):

1. Migrations run in **ascending `toVersion` order** (`migrationEngine.ts:49`–`:50`).
2. A **pre-migration backup** is taken before the first step (`migrationEngine.ts:91`).
3. If a step throws, the engine **restores that backup and reverts the data version** to
   the starting value, marks remaining steps `rolledBack`, and stops
   (`migrationEngine.ts:106`–`:129`). The report carries `recovered: true` and the
   `backupId` used (`migrationEngine.ts:132`).
4. If the recovery restore itself fails, that failure is logged rather than swallowed
   silently (`migrationEngine.ts:116`–`:120`).

**Current registered migrations — honest note.** As of this release only a **single,
no-op baseline migration** is registered (`0001-baseline`, `toVersion: 1`), whose `up()`
merely logs and stamps data version 1 (`apps/desktop/src/main/migration/migrations.ts:18`–
`:30`; `CURRENT_DATA_VERSION = 1`, `migrations.ts:16`). The recovery machinery is
production-grade and fully wired, but it has **not yet been exercised by a real
cross-version data migration** — there is nothing beyond the baseline to migrate through
today. Treat the auto-restore-on-failure guarantee as *implemented and unit-tested*, not
as *battle-tested against a real schema change*.

Operator entry points: `MigrationStatus` and `MigrationRun` IPC channels
(`releaseOps/index.ts:226`, `:228`); `MigrationRun` supports a `dryRun` plan that reports
pending steps without executing (`migrationEngine.ts:78`–`:88`).

### 4.2 Backend database migrations

The backend migrator is **transactional and forward-only** (`migrate.ts:7`–`:11`). Each
`.sql` file in `apps/backend/src/db/migrations/` is applied once, in filename order,
inside its own transaction, and recorded in `schema_migrations`; a failure triggers
`ROLLBACK` and re-raises (`migrate.ts:39`–`:55`). Re-running applies only new files
(idempotent, `migrate.ts:30`–`:37`). There are **12 migrations** today
(`0001_init.sql` … `0012_embedding_state.sql`).

**Boot-failure behavior — non-fatal (important).** When the backend applies migrations on
boot, a migration failure is **caught and logged, and the API still starts**
(`apps/backend/src/index.ts:22`–`:32`, `:40`–`:41` — `app.listen` runs regardless).
A failed boot migration therefore does **not** crash the service; it can leave the API
running against an out-of-date or partially-migrated schema, which surfaces later as
request errors rather than a clean startup failure.

**Recommended pattern — run migrations as a discrete step.** For any multi-replica or
production deployment, set `RUN_MIGRATIONS_ON_BOOT=false` (default is `true`,
`apps/backend/src/config/env.ts:15`–`:18`) and run migrations as a **one-off Job before
pods serve**. This is exactly the shipped Kubernetes pattern:

- Helm: `deploy/helm/neuropause-backend/templates/migrate-job.yaml` — a `batch/v1` Job
  running `node dist/db/migrate.js` with `restartPolicy: Never`, `backoffLimit: 3`.
- Raw manifests: `deploy/kubernetes/backend.yaml:44` (migrate Job) with
  `RUN_MIGRATIONS_ON_BOOT: "false"` set for the Deployment (`backend.yaml:39`).

Running migrations as a gated Job means a failed migration **blocks the rollout** (the Job
fails) instead of letting pods come up on a bad schema.

---

## 5. Update & Crash Recovery

### 5.1 Recovering from a bad application update — advisory rollback only

**Be clear about what the updater does and does not do.** The self-updater
(`apps/desktop/src/main/services/appUpdater.ts`) never downloads or installs silently and
requires a user action to install (`appUpdater.ts:1`–`:5`). It maintains a version history
and can compute a **rollback target** — the highest previously-run version older than the
current one (`appUpdater.ts:186`–`:189`; `pickRollbackTarget`,
`apps/desktop/src/main/services/updater/updateChannels.ts:99`–`:112`).

**But it performs no downgrade.** `autoUpdater.allowDowngrade = false`
(`appUpdater.ts:88`), and `pickRollbackTarget` is explicitly a preparation primitive that
identifies the revert target *"without performing any side effect"*
(`updateChannels.ts:100`–`:103`). There is no code path that installs an older binary.
The "rollback" surface is **advisory** — it tells you what you could revert to, not a
button that reverts.

**So how do you actually recover from a bad update?** Recovery is **data-side**, using the
mechanisms above:

1. If the bad update ran a data migration that failed, the desktop engine has **already
   auto-restored** the pre-migration backup and reverted the data version (§4.1).
2. If the app is unstable, launch **Safe Mode** (§5.2) to get in with plugins disabled.
3. If data is wrong, **restore a backup** from the Recovery Center (§3.1); restore
   validates integrity and takes a safety snapshot first.
4. To move the **binary** itself back, an operator must reinstall the desired version
   out-of-band (using the advisory rollback target as the version to fetch). This is a
   manual, deployment-level action — not something the app does for you.

### 5.2 Crash recovery and Safe Mode

**Crash reporter** (`apps/desktop/src/main/services/crashReporter.ts`). Faults across the
app (categories: `main`, `renderer`, `worker`, `plugin`, `connector`,
`crashReporter.ts:8`) are recorded to a **local, on-device archive** at
`userData/logs/crashes.log` (`crashReporter.ts:38`–`:39`, `:80`–`:88`). Native minidump
capture is **strictly opt-in and off by default** (`crashReporter.ts:2`–`:3`, `:62`), and
even when enabled, `uploadToServer: false` keeps minidumps on the device — *"nothing is
ever uploaded (there is no crash-ingest endpoint)"* (`crashReporter.ts:3`–`:5`, `:71`–
`:72`).

> **Limitation — no fleet crash telemetry.** Crash archives are **local only**. There is
> no centralized/aggregated crash reporting; to investigate a crash you (or the user) must
> retrieve the local archive, e.g. via a **support bundle**, which includes exported
> crashes (`releaseOps/index.ts:207`).

**Recovery Center — 8 actions.** The `RecoveryService`
(`apps/desktop/src/main/recovery/recoveryService.ts:5`–`:12`, `:67`–`:88`) exposes:

| Action | Effect | Cite |
|---|---|---|
| `safeMode` | Persist a flag the launcher reads to skip plugins | `recoveryService.ts:94` |
| `disablePlugins` | Disable every enabled plugin | `recoveryService.ts:124` |
| `resetSettings` | Clear app settings files (never user data) | `recoveryService.ts:145` |
| `restoreBackup` | Delegate to `BackupManager` (§3.1) | `recoveryService.ts:164` |
| `repairInstallation` | Repair each installed app | `recoveryService.ts:176` |
| `verifyIntegrity` | Verify each installed app's package integrity | `recoveryService.ts:198` |
| `rebuildSearchIndexes` | Re-index organizational memory | `recoveryService.ts:218` |
| `rebuildKnowledgeGraph` | Re-project the knowledge graph from the UDM | `recoveryService.ts:229` |

**Safe Mode** persists `safe-mode.json`, which the launcher consumes at startup to boot
with plugins disabled **without mutating plugin enabled/disabled state** — leaving Safe
Mode restores the prior plugin set (`recoveryService.ts:14`–`:15`, `:94`–`:116`). The
crash reporter also turns repeated crashes into **recommendations** (e.g. suggest Safe
Mode after ≥3 renderer crashes, disable plugins after ≥2 plugin-host crashes)
(`crashReporter.ts:118`–`:161`).

**Interrupted-session recovery.** On relaunch, the desktop loads persisted execution
sessions and marks any that were in-flight as **`interrupted` — recovered, not re-run** —
persisting the correction and seeding durable history
(`runtimeCore.ts:1341`–`:1354`). This prevents a crash mid-execution from silently
re-running side-effecting work on the next launch.

---

## 6. RPO / RTO — Honest Statement

These figures describe the **real** in-product/in-repo tooling. They are **operational
characteristics, not contractual guarantees**, and they assume the deployment has **not**
added the off-host durability recommended in §8.

### Desktop local stores

| Metric | Value | Basis |
|---|---|---|
| **RPO** | Up to **24h** of change in the worst case | Scheduled backups run every 24h (`releaseOps/index.ts:57`). Less if a manual or pre-migration backup ran more recently. |
| **RTO** | Seconds to ~1 minute + app restart | Restore is a local file copy with a sha256 pre-check and a safety snapshot (`backupManager.ts:151`–`:187`). |
| **Durability caveat** | **No protection against host/disk loss** | Backups are co-located under `userData`; they share the fate of the live data. |

### Backend Postgres

| Metric | Value | Basis |
|---|---|---|
| **RPO** | = **age of the last operator-run dump** (unbounded if not scheduled) | `backup-db.sh` is manual; no scheduler ships with the stack. No PITR/WAL archiving in-repo. |
| **RTO** | Time to `gunzip \| psql` a full dump + backend restart | `restore-db.sh` replays a whole dump (`restore-db.sh:31`–`:33`). Scales with database size. |
| **Granularity** | Whole-dump only | Cannot recover to a point between dumps without PITR (§8). |

### Federation DR module (MODELED — not a real guarantee)

The Federation DR model carries **target** goals of **RPO 300s / RTO 900s**
(`drStore.ts:40`–`:47`), and its recovery validations return modeled rpo/rto values within
those targets (`drStore.ts:210`–`:220`). **These numbers are computed from a model, not
measured from a real backup or replica.** Do not report them as achieved RPO/RTO. See §7.

---

## 7. Limitations — Modeled vs Real

This section exists so no one mistakes a demo surface for an operational capability.

### 7.1 Federation "Disaster Recovery" is MODELED

`apps/desktop/src/main/federation/dr/drStore.ts` presents multi-region backups, replica
lag, recovery validations, and a continuity score. **It is a data model, not infra.** The
file says so directly:

> *"Honest seam: backups are metadata records (id, scope, size, region, status), not
> physical data dumps; replication and validation are modeled."*
> — `drStore.ts:6`–`:10`

Specifics:

- **No physical data.** `createBackup()` fabricates a record with a random size/duration;
  it copies no bytes (`drStore.ts:187`–`:204`).
- **No real replication.** `checkReplication()` is annotated *"modeled — converges lagging
  replicas toward in-sync"* and simply decrements a lag counter
  (`drStore.ts:229`–`:243`). There is **no second cluster** and **no cross-region
  replication**.
- **Sandbox validation.** `runValidation()` returns a passing result with modeled
  rpo/rto; it *"never touches production"* and is not a real restore
  (`drStore.ts:206`–`:227`).
- **Seed data is fabricated and gated.** The multi-region backups/replicas/validation seen
  in the UI are demo fixtures behind the demo-seed flag; *"A production install has no
  backups, replicas, or validations until it actually runs them"*
  (`drStore.ts:81`–`:89`). A fresh production install defaults HA and multi-region **off**
  so the continuity score is not inflated (`drStore.ts:37`–`:47`).

**Do not present the Federation DR screen as your disaster-recovery plan.** Your real DR is
§§2–4 plus §8.

### 7.2 App-binary rollback is advisory, not automatic

Covered in §5.1: `allowDowngrade = false` (`appUpdater.ts:88`); the rollback target is
computed with *"no side effect"* (`updateChannels.ts:99`–`:112`). Recovery from a bad
update is data-side, and binary downgrade is a manual operator action.

### 7.3 Backend migration boot-failure is non-fatal

Covered in §4.2: a failed boot migration is logged, not fatal — the API starts anyway
(`apps/backend/src/index.ts:22`–`:41`). Use the gated migrate-Job pattern so a bad
migration blocks the rollout instead.

### 7.4 No fleet crash telemetry

Covered in §5.2: crash archives are local-only; there is no crash-ingest endpoint
(`crashReporter.ts:3`–`:5`). Fleet-wide crash visibility requires external tooling.

### 7.5 Backups are single-host by default

Desktop backups sit under `userData`; the backend dump lands in `./backups` on the host
that ran the script. Neither is copied off-host by any shipped mechanism. Off-host
durability is your responsibility (§8).

---

## 8. Recommended Production DR

The in-app DR is single-host / local-first and, for the backend, dump-based. For an
Enterprise GA deployment, layer the following **external** capabilities on top. (The
project's own deploy notes already state that Postgres/Redis are *"expected to be managed /
HA services in production"* and that the repo *"does not contain, and does not claim, a
running cluster, live multi-region/failover"* — `deploy/README.md:17`–`:19`, `:83`–`:90`.)

1. **Managed Postgres with PITR and replicas.** Run the database on a managed service (or a
   self-managed HA cluster) that provides **continuous WAL archiving / point-in-time
   recovery** and **read replicas / automated failover**. This closes the whole-dump-only
   and single-host gaps in §3.2 and §6. Point the backend at it via `DATABASE_URL`
   (`deploy/README.md:59`–`:66`); the app needs no change.
2. **Off-host, versioned backup storage.** Ship both `backup-db.sh` dumps **and** desktop
   backups (where fleet policy allows) to durable, access-controlled object storage in a
   separate failure domain, with lifecycle/retention. Do not rely on the co-located
   `./backups` and `userData/backups` directories as your only copy (§7.5).
3. **Schedule the backend backup.** `backup-db.sh` ships without a scheduler; wire it to
   cron / a systemd timer / a CI job so RPO is bounded and predictable rather than
   "whenever someone remembered" (§2.2, §6).
4. **Run migrations as a gated Job, not on boot.** Set `RUN_MIGRATIONS_ON_BOOT=false` and
   use the shipped migrate Job (`deploy/helm/neuropause-backend/templates/migrate-job.yaml`,
   `deploy/kubernetes/backend.yaml:44`) so a failed migration blocks the rollout instead of
   letting pods serve a bad schema (§4.2).
5. **Tested restore drills.** Periodically **restore into a scratch environment** and
   verify application health — for the backend via `restore-db.sh` against a throwaway DB,
   for desktop via `BackupValidate` + `BackupRestore` on a test profile. The in-app
   `validate()` checks hashes (`backupManager.ts:135`), but only an end-to-end restore
   proves recoverability. A backup you have never restored is a hypothesis, not a backup.
6. **Real DR posture if you need multi-region.** The Federation DR module is a model
   (§7.1). If you require genuine cross-region continuity, implement it in infrastructure
   (replicated managed Postgres across regions, tested failover) — the model's RPO/RTO
   targets (300s / 900s, `drStore.ts:40`–`:47`) are reasonable **goals** to design toward,
   not something the app delivers on its own.

---

### Quick reference — operator commands

```sh
# Backend: create a compressed dump (operator-run; keeps 14)
scripts/backup-db.sh

# Backend: list + restore a dump (destructive; prompts for 'yes')
scripts/restore-db.sh backups/neuropause-db-YYYYMMDD-HHMMSS.sql.gz

# Backend (k8s): run migrations as a gated step, not on boot
#   set RUN_MIGRATIONS_ON_BOOT=false, then apply the migrate Job
kubectl apply -f deploy/kubernetes/backend.yaml

# Desktop: backup / validate / restore are driven from the in-app
# Recovery Center (Restore Backup) and Backup IPC channels — validate
# a backup before you trust a restore.
```

**Golden rule:** the Federation DR screen is a model; your real recovery levers are the
desktop `BackupManager`, the `pg_dump`/`psql` scripts, the migration engines, and the
Recovery Center — hardened by the off-host, PITR, and drill practices in §8.
