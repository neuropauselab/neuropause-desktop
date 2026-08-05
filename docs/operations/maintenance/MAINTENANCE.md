# NEMS Production Maintenance

Planned, routine changes that keep production healthy: version upgrades, node
recycling, certificate and secret rotation, dependency updates, and backup
verification. This is policy and procedure; it records no completed maintenance.

## Change classes

| Class | Definition | Approval | Window |
|-------|------------|----------|--------|
| **Standard** | pre-approved, low-risk, reversible (e.g. node recycle, backup verify) | on-call | any, prefer low-traffic |
| **Normal** | planned change with review (e.g. k8s minor upgrade, DB resize) | reviewer + owner | scheduled window |
| **Emergency** | required now to prevent/stop an incident | IC | immediate, documented after |

Every change states: what, why, blast radius, the rollback, and how it will be
validated. If it changes the running spec, it goes through the same Git flow as
any deploy (branch `phase-2`, reviewed).

## Maintenance windows & communication

- Prefer a **low-traffic window** (confirm from the traffic pattern once the
  stack has data). Announce Normal changes ahead per the incident comms cadence.
- During an SLO **error-budget freeze** (`../slo/SLO.md`, budget < 10%), defer
  non-reliability maintenance.

## Kubernetes upgrades (DOKS)

Recorded running version: `1.36.0-do.3`.

1. Read DO release notes; confirm CRDs in use (Gateway API, Prometheus-operator)
   are compatible with the target version.
2. Upgrade the control plane via the DO console/`doctl`, then the node pool with
   **surge upgrade** so replacement nodes join before old ones drain (the
   backend's maxUnavailable=0 keeps it available).
3. Validate: 3 nodes Ready on the new version; `nems-backend` 2/2; gateway
   `Programmed=True`; `/health` 200; observability targets UP.
4. Rollback stance: node pools roll forward — do not attempt a downgrade; if a
   node is bad, recycle it (`../runbooks/node-failure.md`).

## Node pool recycling

Routine hygiene or to clear a degraded node: `cordon` → `drain
--ignore-daemonsets --delete-emptydir-data` → replace, one node at a time,
verifying pods reschedule (and the Qdrant PVC reattaches) between nodes.

## Managed database maintenance (PostgreSQL 18, Valkey 8)

- DigitalOcean applies patches in the configured **maintenance window** — set it
  to a low-traffic time in the console and record it here: `____`.
- **Major version upgrades** are deliberate: snapshot/verify a fresh backup
  first (`../../deploy/backup/`), take the window, upgrade, then run the read-path
  validation. Keep the databases **private** throughout (no `0.0.0.0/0`).
- After any DB maintenance, run `verify-backup.sh --deep` and confirm `/health`.

## Certificate rotation

The edge cert (`api-neuropause033-tls`, Let's Encrypt) should auto-renew. Verify
the renewal path quarterly using the cert-expiry probe; manual re-issue procedure
is in `../runbooks/certificate-expiry.md`. Target: never let
`probe_ssl_earliest_cert_expiry` drop under 21 days.

## Secret rotation

Rotate on a schedule and on suspicion of exposure. For each, update the
Kubernetes Secret and `rollout restart` the consumer; verify after.

| Secret | Consumer | Rotation note |
|--------|----------|---------------|
| DB / cache connection secrets | backend | rotate DB creds in DO console, update secret, restart backend, verify `/health` |
| `nems-spaces-backup` | backup jobs | rotate Spaces keys, update secret, run a manual backup to confirm |
| `nems-pg-backup` (PG URI) | backup job | update if DB creds rotate |
| OAuth client secret | backend | rotate in Google console + secret together; verify a live login (`../runbooks/oauth-outage.md`) |
| `grafana-admin` | Grafana | update secret, restart Grafana |
| `alertmanager-pagerduty` / `alertmanager-slack` | Alertmanager | rotate destination keys; send a test alert to confirm delivery |
| registry pull | cluster | re-attach via `doctl kubernetes cluster registry add` (never `doctl registry docker-config`) |

No secret value is ever committed to Git.

## Dependency & image updates

Application image changes (base-image patching, dependency bumps) go through the
existing Phase 1–3 build/push/deploy pipeline and land as a new digest, rolled
out and validated like any release (`../runbooks/deployment-rollback.md` is the
backout). The backend application code is out of scope to change in this phase.

## Observability stack upgrades

Upgrade kube-prometheus-stack with `helm upgrade` using the pinned values
(`deploy/observability/kube-prometheus-stack.values.yaml`); review CRD changes in
the chart notes first. Validate that targets remain UP and dashboards still load
after the upgrade.

## Routine verification cadence

| Task | Frequency | Reference |
|------|-----------|-----------|
| `verify-backup.sh --deep` | daily (CI/cron) | `../../deploy/backup/README.md` |
| PostgreSQL restore-test into scratch | monthly | `../../deploy/backup/pg-restore-job.yaml` |
| Cert renewal path check | quarterly | `../runbooks/certificate-expiry.md` |
| Full DR game-day | quarterly | `../dr/cluster-rebuild.md` |
| Alertmanager delivery test | quarterly | send a synthetic alert |
| Capacity review | monthly | `../capacity/CAPACITY-PLAN.md` |

## Pre / post change checklist

**Before:** change class agreed; rollback known; fresh verified backup if data is
at risk; window/comms done; validation steps written.

**After:** run the change's validation; confirm SLIs green (edge probe, error
ratio, dependency signals); record what was done and any deviation; if anything
regressed, execute the rollback and open an incident.
