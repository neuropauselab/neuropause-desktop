# NeuroPause — Deployment (Phase 4)

Real, verifiable infrastructure for deploying the **backend** (`apps/backend`). Everything
here deploys the *actual* service built from `apps/backend/Dockerfile`, using its real
liveness (`/live`) and readiness (`/health`) probes and the real Prometheus endpoint
(`/metrics`). Nothing here fabricates a cluster, region, or failover it doesn't have.

## What deploys what

| Path | Use | Validation |
|---|---|---|
| `apps/backend/Dockerfile` + `docker-compose.prod.yml` | Single-host / private-cloud (Postgres + Redis + API) | existing, real |
| `deploy/kubernetes/` | Raw K8s manifests (kubectl) | schema-validated (kubeconform, k8s 1.29, strict) |
| `deploy/helm/neuropause-backend/` | Helm chart (parameterized) | CI: `helm lint` + `helm template` + kubeconform (`.github/workflows/deploy-validation.yml`) |
| `scripts/build-offline-bundle.sh` | Air-gapped `docker save`/`load` bundle | shellcheck |

Postgres and Redis are expected to be **managed / HA** services in production; the K8s
manifests reference them only through `DATABASE_URL` / `REDIS_URL` in a Secret. TLS is
terminated at the ingress — the backend speaks plain HTTP by design.

## Build the image

```sh
docker build -f apps/backend/Dockerfile -t <registry>/neuropause-backend:<tag> .
```

## Docker Compose (single host / private cloud)

```sh
cp .env.example .env    # set POSTGRES_PASSWORD, JWT_ACCESS_SECRET (>=32 chars), OAuth, etc.
docker compose -f docker-compose.prod.yml up -d --build
```

## Kubernetes (raw manifests)

```sh
kubectl apply -f deploy/kubernetes/secret.example.yaml   # edit real values first (or create out-of-band)
kubectl apply -f deploy/kubernetes/backend.yaml          # namespace, config, migrate Job, Deployment, Service
kubectl apply -f deploy/kubernetes/optional.yaml         # HPA (needs metrics-server) + Ingress (needs a controller)
kubectl -n neuropause rollout status deploy/neuropause-backend
```

Migrations run as a one-off `Job` (`node dist/db/migrate.js`) — the pattern the Dockerfile
itself recommends for multi-replica deploys — and the Deployment pods then serve only.
The RollingUpdate strategy (`maxUnavailable: 0`) plus the readiness probe give zero-downtime
rollouts on a real cluster.

## Helm

```sh
helm lint deploy/helm/neuropause-backend
helm install np deploy/helm/neuropause-backend \
  --namespace neuropause --create-namespace \
  --set image.repository=<registry>/neuropause-backend --set image.tag=<tag> \
  --set existingSecret=neuropause-backend-secrets \
  --set autoscaling.enabled=true --set ingress.enabled=true
```

Create the referenced Secret out-of-band (recommended), e.g.:

```sh
kubectl -n neuropause create secret generic neuropause-backend-secrets \
  --from-literal=DATABASE_URL='postgresql://user:pass@managed-pg:5432/neuropause' \
  --from-literal=REDIS_URL='redis://managed-redis:6379' \
  --from-literal=JWT_ACCESS_SECRET="$(openssl rand -hex 32)"
```

## Offline / air-gapped

```sh
scripts/build-offline-bundle.sh neuropause-backend:1.0.0
# → dist/offline-bundle/neuropause-offline-*.tar.gz
# Transfer to the air-gapped host, extract, create .env, then: ./load-and-run.sh
```

## Observability

The backend exposes Prometheus text metrics at `GET /metrics` (aggregate, non-sensitive:
process uptime/memory, Postgres pool counts, HTTP request counts). Keep it network-restricted
(loopback bind in compose; a scrape-only path / NetworkPolicy in K8s). Pod annotations advertise
`prometheus.io/scrape`.

## Honest scope

These manifests and the chart are **real, deployable artifacts** — but this repo does not contain,
and does not claim, a running cluster, live multi-region/failover, blue-green/canary controllers,
or edge runtime. Those require external infrastructure and are documented as roadmap items,
not shipped as working infrastructure. The single-host Compose path and the desktop auto-updater remain the fully-operational
production deployment today; the K8s/Helm artifacts make a real cluster deployment a
schema-valid `kubectl apply` / `helm install` away.
