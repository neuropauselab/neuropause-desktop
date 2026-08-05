# NEMS Production Manual

The authoritative reference for **what production is**. Every other operations
document points here for inventory and invariants. Values are the measured,
running configuration from Phases 1–4 (which are complete and immutable). If
reality and this manual disagree, reality wins — fix the manual in the same PR.

## Environment

| Item | Value |
|------|-------|
| Cloud | DigitalOcean, region **nyc3** |
| Cluster | DOKS `nems-prod-cluster`, id `7750e61a-2636-4220-85ea-aec4120bae40`, k8s `1.36.0-do.3` |
| Node pool | `nems-prod-pool-1`, 3 nodes |
| App namespace | `nems-prod` |
| Monitoring namespace | `monitoring` (Phase 5) |
| Repo | `github.com/dishantdobariya91-debug/neuropause-desktop`, branch `phase-2` |

## Workload

| Item | Value |
|------|-------|
| Deployment | `nems-backend` (namespace `nems-prod`), 2 replicas |
| Strategy | RollingUpdate, maxUnavailable=0, maxSurge=1 |
| Container/port | `backend`, containerPort 4000 (Service port `http` 80→4000) |
| Image (pinned) | `registry.digitalocean.com/neuropause033/backend@sha256:997f8737…d00bbe6` (tag `backend-v0.1.0-rc.4`) |
| Resources | requests 100m CPU / 256Mi; limits 1 CPU / 512Mi |
| Probes | liveness `/live`, readiness `/health` |
| Pod label | `app.kubernetes.io/name=nems-backend` |
| Key config | `PUBLIC_BACKEND_URL=https://api.neuropause033.com`, `JWT_ACCESS_TTL=900`, `SEED_STORE_ON_BOOT=false`, `RUN_MIGRATIONS_ON_BOOT=false` |

`/health` returns 200 only when PostgreSQL **and** Valkey are reachable — it is a
composite dependency signal, which is why the edge health probe doubles as a
dependency-up check.

## Edge / networking

| Item | Value |
|------|-------|
| Gateway | `nems-gateway` (Cilium Gateway API), namespace `nems-prod` |
| Load balancer IP | `134.199.250.188` |
| Listener | `https`, HTTPS/443 |
| TLS secret | `api-neuropause033-tls` (Let's Encrypt, TLS 1.3) |
| DNS | `api.neuropause033.com` → `134.199.250.188` |
| HTTPRoute | `nems-backend`, 10 path prefixes: `/auth /billing /devices /health /license /live /memory/semantic /organizations /store /sync` (committed `ecfed7f8`) |

## Data stores

| Store | Value |
|-------|-------|
| PostgreSQL | managed `nems-prod-pg` (pg18), id `406985e0-bb6d-49b2-bcae-6d996acd5843`, private `10.20.0.6`, direct `:25060` / pooler `:25061` |
| Valkey | managed `nems-prod-cache` (valkey8), id `a5829ae2-293f-40ad-ba57-bfc1609241e9`, `:25061` |
| Qdrant | in-cluster (ClusterIP, `nems-prod`), storage on a PVC |

## Production invariants (must always hold)

1. **Databases are private.** PostgreSQL, Valkey, and Qdrant are never publicly
   exposed. Managed DB firewalls trust the cluster only — **no `0.0.0.0/0`**
   (verified in Phase 4.11).
2. **`/metrics` is not public.** The edge returns 404 for `/metrics`
   (Phase 4.9); scraping is in-cluster only.
3. **No secrets in Git.** All credentials live in Kubernetes Secrets / the DO
   platform, created out-of-band.
4. **The running image is pinned by digest**, not a floating tag.
5. **Migrations are not auto-run on boot** (`RUN_MIGRATIONS_ON_BOOT=false`);
   schema changes are deliberate.

Any change that would break an invariant is a security/operational regression
and must be caught in review.

## Observability (Phase 5)

kube-prometheus-stack in `monitoring`: Prometheus (30d / 40GB), Alertmanager,
Grafana, node-exporter, kube-state-metrics. NEMS ServiceMonitor scrapes
`nems-backend:/metrics`; blackbox probes the edge. Rules and dashboards live in
`deploy/observability/`. The 8 app metrics and known instrumentation gaps (no
per-route/latency-histogram/oauth/store/AI/queue labels) are documented in
`deploy/observability/README.md`.

## Backups (Phase 5)

Daily PostgreSQL logical dump and Qdrant snapshot to Spaces, plus DO managed
backups for PostgreSQL/Valkey. Automation and verified-restore procedure in
`deploy/backup/`.

## Access & tooling

- `kubectl` context on `nems-prod-cluster`; `doctl` authenticated; `helm` for the
  observability chart.
- Registry access via `doctl kubernetes cluster registry add` (never
  `doctl registry docker-config`).

## Validation status

Phases 1–4 are validated and evidenced (`deploy/PHASE4-EVIDENCE.md`). Phase 5
adds capability and documentation whose live validation (scraping, alert
delivery, backup/restore drills, DR game-day) is listed as required before
Phase 6 in the Phase 5 completion report and the respective READMEs.
