# NEMS Production Backups

Backup automation and verified-restore procedures for the three NEMS data
stores. This directory **creates capability**; it makes no claim that any backup
has run. The runs listed under [Validation required before Phase 6](#validation-required-before-phase-6)
are the operator's to execute and record.

## What backs up what

| Store | Mechanism | Owned by | Automated here |
|-------|-----------|----------|----------------|
| PostgreSQL (`nems-prod-pg`, managed) | `pg_dump -Fc` → Spaces, daily 02:15 UTC | this repo (`pg-backup-cronjob.yaml`) + DO daily managed backups | yes |
| Valkey (`nems-prod-cache`, managed) | DigitalOcean managed daily backups | DigitalOcean platform | documented (no CronJob needed) |
| Qdrant (in-cluster) | full-snapshot API → Spaces, daily 02:45 UTC | this repo (`qdrant-backup-cronjob.yaml`) | template — confirm service URL first |

Two independent layers protect PostgreSQL: DigitalOcean's own managed backups
(point-in-time recovery within the retention window, restore via console/`doctl`)
**and** these portable logical dumps in your own Spaces bucket (survive the
managed instance entirely, restorable to any PostgreSQL). The logical dump is
the one this repo owns and verifies.

## Integrity design (why a broken backup cannot pass quietly)

Every job proves its own work and fails loudly on any error (`set -euo pipefail`):

- **Dump** is validated with `pg_restore --list` before upload — a truncated or
  corrupt archive fails the table-of-contents read and the Job fails.
- **Upload** re-reads the object with `head-object` and asserts remote bytes ==
  local bytes — a partial upload fails.
- **Job failure is observable**: kube-state-metrics exposes it and
  kube-prometheus-stack's default `KubeJobFailed` alert fires, so a silently
  broken backup pages instead of rotting.
- **`verify-backup.sh`** returns three distinct outcomes — `0 PASS`, `1 FAIL`
  (missing/stale/empty/corrupt), `2 UNREADABLE` (couldn't check). A tool error
  is never reported as "0 backups = fine". Its `--selftest` proves the checks
  can actually fail.

## One-time setup

Order matters: the PostgreSQL manifest defines the shared `nems-backup-config`
ConfigMap and both jobs read the `nems-spaces-backup` secret.

1. **Create the Spaces bucket** (once), then enable versioning and retention:

   ```sh
   # versioning (so an overwrite/delete is recoverable; pairs with the lifecycle rule)
   aws s3api put-bucket-versioning --bucket <BACKUP_BUCKET> \
     --endpoint-url https://nyc3.digitaloceanspaces.com \
     --versioning-configuration Status=Enabled
   # retention (30d objects, 14d noncurrent versions, abort stale multipart)
   aws s3api put-bucket-lifecycle-configuration --bucket <BACKUP_BUCKET> \
     --endpoint-url https://nyc3.digitaloceanspaces.com \
     --lifecycle-configuration file://spaces-lifecycle.json
   ```

2. **Create the secrets** (values never enter Git):

   ```sh
   # PostgreSQL: use the PRIVATE connection URI from the DO console so backup
   # traffic stays on the VPC and the database is never publicly exposed.
   kubectl -n nems-prod create secret generic nems-pg-backup \
     --from-literal=uri='postgresql://USER:PASS@private-nems-prod-pg-...:25060/DBNAME?sslmode=require'

   # Spaces (S3-compatible) keys for the backup bucket.
   kubectl -n nems-prod create secret generic nems-spaces-backup \
     --from-literal=access_key_id='...' --from-literal=secret_access_key='...'
   ```

3. **Set the bucket name** in `pg-backup-cronjob.yaml` (`nems-backup-config.BUCKET`,
   replacing `REPLACE_WITH_BACKUP_BUCKET`), then apply:

   ```sh
   kubectl apply -f pg-backup-cronjob.yaml
   ```

4. **(Optional) Qdrant**: set the real service URL in `qdrant-backup-cronjob.yaml`
   (`nems-qdrant-backup-config.QDRANT_URL`, replacing `REPLACE_WITH_QDRANT_SERVICE`),
   create the `nems-qdrant-backup` secret with `api_key` only if Qdrant requires
   one, then `kubectl apply -f qdrant-backup-cronjob.yaml`.

> **NetworkPolicy note:** these jobs run in `nems-prod` and egress to the DB
> private host (`:25060`), the Qdrant service, and the Spaces endpoint (`:443`).
> If a default-deny **egress** policy is later introduced in `nems-prod`, add
> egress allowances for those destinations or the jobs will hang and time out.

## Run an on-demand backup (before validating)

```sh
kubectl -n nems-prod create job --from=cronjob/nems-pg-backup pg-backup-manual
kubectl -n nems-prod logs -f job/pg-backup-manual        # expect "[upload] VERIFIED ..."
```

## Verify

```sh
BUCKET=<BACKUP_BUCKET> AWS_ACCESS_KEY_ID=... AWS_SECRET_ACCESS_KEY=... \
  ./verify-backup.sh --deep     # existence + freshness + non-empty + archive parses
./verify-backup.sh --selftest   # run in CI: proves the checks can fail
```

## Restore-test (turns a backup into a *proven* backup)

Restore-testing uses a **scratch database**, never production — see the safety
banner in `pg-restore-job.yaml`. Provision a throwaway database, point a secret
at it, choose a backup key, and run:

```sh
kubectl -n nems-prod create secret generic nems-pg-restore-target \
  --from-literal=uri='postgresql://USER:PASS@HOST:PORT/scratchdb?sslmode=require'
sed 's#REPLACE_WITH_BACKUP_KEY#pg/nems-prod-pg/2026/07/08/T021500Z.dump#' \
  pg-restore-job.yaml | kubectl apply -f -
kubectl -n nems-prod logs -f job/nems-pg-restore   # expect "RESTORE-TEST PASSED"
```

Record the restored table count and wall-clock time in the DR recovery log
(`docs/operations/dr/`). That measured time is the input to the RTO.

## Valkey (managed) — how recovery works

DigitalOcean takes automated daily backups of the managed Valkey cluster; there
is nothing to schedule here. To recover, create a new database **from a backup**
of `nems-prod-cache` (DO console → *Backups*, or `doctl databases backup`/
restore), then repoint the app's cache connection secret. Valkey holds only
rate-limit counters and ephemeral cache state for NEMS — a cold cache
self-heals — so its RPO is intentionally looser than PostgreSQL's. Confirm the
managed backup retention window in the console and record it in the DR manual.

## Qdrant — how recovery works

Restore a snapshot from Spaces into a Qdrant instance via the snapshot-recovery
API (upload the `.snapshot` and call the recover endpoint), then validate
collection counts. The exact commands live in
`docs/operations/runbooks/` once the drill is executed; the snapshot **capture**
side is automated by `qdrant-backup-cronjob.yaml`.

## Files

- `pg-backup-cronjob.yaml` — daily PostgreSQL logical backup + self-verifying upload; shared config/secrets.
- `pg-restore-job.yaml` — manual restore-test into a scratch DB, with post-restore validation.
- `qdrant-backup-cronjob.yaml` — daily Qdrant full-snapshot capture (template).
- `spaces-lifecycle.json` — object-store retention (primary retention mechanism).
- `verify-backup.sh` — honest freshness/size/parse checker with a positive-control self-test.

## Validation required before Phase 6

None of the following has been executed by this delivery. Each must be run
against the live environment and its **real** output recorded:

1. Create the bucket + secrets; apply `pg-backup-cronjob.yaml`.
2. Trigger one manual PostgreSQL backup; confirm `[upload] VERIFIED` and the
   object in Spaces.
3. Run `verify-backup.sh --deep`; record `OVERALL: PASS`.
4. Run one restore-test (`pg-restore-job.yaml`) into a scratch DB; record the
   table count and restore time.
5. Confirm the Valkey managed-backup retention window in the DO console.
6. If Qdrant is enabled: run one snapshot + one snapshot-restore into a scratch
   Qdrant; record collection/point counts.
7. Confirm the Spaces lifecycle rule is active (`get-bucket-lifecycle-configuration`).
