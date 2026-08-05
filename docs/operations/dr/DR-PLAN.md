# NEMS Disaster Recovery Plan

Scope: the production NEMS environment — DOKS cluster `nems-prod-cluster`
(nyc3, id `7750e61a-2636-4220-85ea-aec4120bae40`), the `nems-backend` workload in
`nems-prod`, the Cilium `nems-gateway` (LB `134.199.250.188`, `api.neuropause033.com`),
and the three data stores (managed PostgreSQL `nems-prod-pg`, managed Valkey
`nems-prod-cache`, in-cluster Qdrant).

This plan assumes the infrastructure built in Phases 1–4 is the running system
and does not redesign it. It uses the backups and manifests already in this repo.

## Declaring a disaster

A **disaster** is any event where normal operational runbooks
(`../runbooks/`) will not restore service within its SLO error budget — e.g.
data loss/corruption, loss of the cluster, or loss of a data store. The on-call
engineer raises it to a **SEV1** and notifies the incident owner. Two decisions
require an explicit human authorization and must never be automated:

1. **Restoring into production PostgreSQL** (overwrites live data).
2. **Rebuilding or replacing the cluster.**

Both are destructive; both are gated on the incident owner's go/no-go.

## Recovery roles

| Role | Responsibility |
|------|----------------|
| Incident Commander | declares SEV, authorizes destructive recovery, owns comms |
| Recovery Operator | executes the procedures below with `kubectl`/`doctl` |
| Scribe | fills `recovery-evidence-*.md` in real time (timeline, commands, results) |
| Comms | status updates to stakeholders per the incident comms plan |

For a small team one person may hold several roles, but the **authorization**
and the **execution** of a production restore should be two different people
when at all possible.

---

## Scenario 1 — Backend workload down (bad deploy or crashloop)

**Detection:** `BackendNoHealthyReplicas` / `BackendCrashLooping` / `EdgeDown`
alerts; `/health` probe failing.

**Recovery:** this is a rollback, not a rebuild — follow
[`../runbooks/deployment-rollback.md`](../runbooks/deployment-rollback.md)
(`kubectl -n nems-prod rollout undo deployment/nems-backend`, or pin the known-good
digest `sha256:997f8737…d00bbe6`). No data store is involved.

**Validation:** `kubectl -n nems-prod rollout status deploy/nems-backend`;
external `curl https://api.neuropause033.com/health` returns 200.

**RTO objective:** ≤ 30m *(unvalidated)*. **RPO:** n/a (stateless).

---

## Scenario 2 — PostgreSQL data loss or corruption

**Detection:** `DatabaseUnavailable` alert; application 5xx; data integrity
report. Distinguish *store unreachable* (network/instance) from *data corrupted*
(bad migration, accidental delete) — the recovery differs.

**Recovery — decide the smallest sufficient action, in order:**

1. **Instance unreachable, data intact** → recover the managed instance via DO
   (console/`doctl databases`), do **not** restore data. Repoint nothing.
2. **Recent logical error, PITR available** → use DigitalOcean managed
   point-in-time recovery to a timestamp just before the error (tightest RPO).
   This creates a new database; repoint the app's DB secret to it.
3. **Restore from repo-owned logical backup** (managed backups unavailable, or a
   portable restore is required):
   - Choose the backup key (`deploy/backup/verify-backup.sh` lists the freshest).
   - **First** restore into a **scratch** database and validate
     (`deploy/backup/pg-restore-job.yaml`) — never restore straight to prod.
   - On incident-owner authorization, restore into the production target and
     repoint the app.

**Validation:** restore-test Job prints `RESTORE-TEST PASSED` with a non-zero
table count; after prod repoint, `/health` returns 200 and a read path
(e.g. an authenticated `/organizations` request) returns expected data.

**RPO:** ≤ 24h (repo logical dump) or ~minutes (managed PITR).
**RTO objective:** ≤ 1h *(unvalidated — the monthly restore-test measures it)*.

---

## Scenario 3 — Qdrant (vector store) loss

**Detection:** vector/search functionality failing; Qdrant pod/PVC lost.

**Recovery:** restore the most recent snapshot from Spaces (`qdrant/` prefix)
into a Qdrant instance via the snapshot-recovery API, then validate collection
and point counts against expectations. If the vectors are derivable from a
system-of-record (e.g. re-embedding source content held in PostgreSQL), that
re-index is an alternative path — but only claim it after confirming the source
data and the re-embedding job actually exist; do not assume it.

**RPO:** ≤ 24h (daily snapshot). **RTO objective:** ≤ 1h *(unvalidated)*.

---

## Scenario 4 — Valkey (cache / rate-limit) loss

**Detection:** `RedisUnavailable` / `RedisFallbackEngaged` alerts.

**Recovery:** the backend already **degrades safely** when Valkey is down — it
falls back to per-instance rate limiting (surfaced by
`neuropause_ratelimit_fallback_total`), so this is usually a *degradation*, not an
outage. Recreate the managed Valkey from a DO backup (or a new instance) and
repoint the cache secret. A cold cache is expected and self-heals.

**RPO:** loss tolerated (ephemeral state). **RTO objective:** ≤ 30m *(unvalidated)*.

---

## Scenario 5 — Gateway / edge networking failure

**Detection:** `EdgeDown` while backend pods are healthy; external HTTPS fails
but in-cluster `Service` works.

**Recovery:** check, in order, the Cilium `nems-gateway` (`kubectl get gateway -n
nems-prod nems-gateway`, expect `Programmed=True`), the LoadBalancer service and
its external IP (must remain `134.199.250.188`), the DNS `A` record
(`api.neuropause033.com` → `134.199.250.188`), and the `HTTPRoute nems-backend`
attachment (`Accepted`/`ResolvedRefs` True). Re-apply the committed manifests if
any are missing — the HTTPRoute is committed at `ecfed7f8`. See
[`../runbooks/gateway-failure.md`](../runbooks/gateway-failure.md).

**RTO objective:** ≤ 30m *(unvalidated)*. **RPO:** n/a.

---

## Scenario 6 — TLS certificate failure / expiry

**Detection:** `CertificateExpiringSoon` (warning <21d / critical <7d) from the
edge probe on `probe_ssl_earliest_cert_expiry`, or TLS handshake failures.

**Recovery:** follow [`../runbooks/certificate-expiry.md`](../runbooks/certificate-expiry.md)
— confirm the issuer is renewing, or re-issue and update the `api-neuropause033-tls`
Secret. **RPO:** n/a. **RTO objective:** ≤ 1h *(unvalidated)*.

---

## Scenario 7 — Node failure

**Detection:** `NodeNotReady`; pods pending. DOKS reschedules pods off a dead
node automatically. Recovery is usually to let the node pool `nems-prod-pool-1`
self-heal (DO recycles the node), or recycle it manually via `doctl`. See
[`../runbooks/node-failure.md`](../runbooks/node-failure.md).
**RTO objective:** ≤ 30m *(unvalidated)*. **RPO:** n/a (stateful data is on
managed services / PVCs, not node-local).

---

## Scenario 8 — Full cluster loss

**Detection:** the cluster/API is gone or unrecoverable.

**Recovery:** rebuild from Git + backups following
[`cluster-rebuild.md`](./cluster-rebuild.md). This is the worst case and the
`≤ 4h` objective is entirely unvalidated until a game-day proves it.

**RPO:** per store (§2–§4). **RTO objective:** ≤ 4h *(unvalidated)*.

---

## Scenario 9 — Container image / registry unavailable

The running image is pinned by digest
(`registry.digitalocean.com/neuropause033/backend@sha256:997f8737…d00bbe6`), so a
tag being moved or deleted does not affect running pods. If the image must be
rebuilt, use the Phase-1–3 build/push chain (tag `backend-v0.1.0-rc.4`) — that
process is unchanged and out of scope for this plan. Do not rebuild from an
unpinned or unverified source.

---

## Post-recovery (every scenario)

1. Confirm SLIs are green (edge probes, error ratio, dependency signals).
2. Finish the `recovery-evidence-*.md`: timeline, exact commands, measured RTO,
   data-loss window (actual RPO), and any deviation from this plan.
3. Open a postmortem (`../incident/`) for any SEV1/SEV2.
4. Feed measured RTO/RPO back into [`README.md`](./README.md) — replacing a
   *(target — unvalidated)* with a dated measured value.
5. File corrective actions (e.g. tighten a backup schedule, fix a runbook step).

## What this plan does not claim

No recovery has been performed. Every RTO here is an objective, not a measured
result. The plan is only proven to the extent that dated drills
(`recovery-evidence-*.md`) exist — see the drill cadence in
[`README.md`](./README.md).
