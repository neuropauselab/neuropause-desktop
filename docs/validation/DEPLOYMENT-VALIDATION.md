# NeuroPause — Deployment Validation (executed)

Validation of the real deployment assets with real tools, run 2026-07-18. Where a
tool is unavailable in this environment, that is stated plainly rather than
skipped silently.

## Assets under validation

| Asset | Path |
|---|---|
| Backend container | `apps/backend/Dockerfile` |
| Kubernetes manifests | `deploy/kubernetes/backend.yaml`, `deploy/kubernetes/optional.yaml`, `deploy/kubernetes/secret.example.yaml` |
| Helm chart (8 templates) | `deploy/helm/neuropause-backend/` |
| Offline/air-gapped bundler | `scripts/build-offline-bundle.sh` |
| CI workflows | `.github/workflows/{backend-ci,deploy-validation,windows-release}.yml` |

## Results

| Check | Tool | Result |
|---|---|---|
| Kubernetes schema (strict) — `backend.yaml` | `kubernetes-validate` | **PASS** |
| Kubernetes schema (strict) — `optional.yaml` | `kubernetes-validate` | **PASS** |
| Shell scripts (all, incl. offline bundler) | `shellcheck` | **CLEAN** |
| Deploy YAML syntax | `yamllint` | Clean except cosmetic line-length (>80 col) warnings |
| Helm template render | `helm` | Not run locally — `helm` CLI unavailable in this env; rendered in CI (`deploy-validation.yml`) |

### Kubernetes

Both manifests pass `kubernetes-validate` in **strict** mode (no unknown or
malformed fields against the Kubernetes schema). `optional.yaml` carries the
autoscaling/ingress extras; `backend.yaml` is the core Deployment + Service +
ConfigMap, including the production-safe `RUN_MIGRATIONS_ON_BOOT=false` and
`SEED_STORE_ON_BOOT=false` (no fabricated catalog in production).

### Shell / offline bundle

`shellcheck` reports **no issues** across every script, including
`scripts/build-offline-bundle.sh` (the `docker save`/`load` air-gapped bundler). The
script and its documented transfer procedure (`deploy/README.md`) are the real
air-gapped install path; a full `docker save` execution requires a Docker daemon,
which is not available in this harness (noted in the reliability report as PARTIAL).

### YAML

`yamllint -d relaxed` is clean apart from **line-length warnings** (a handful of
lines exceed 80 columns in `backend.yaml`). These are cosmetic and do not affect
parsing or apply; recorded here honestly rather than suppressed.

### Helm

The chart is present and complete (Chart.yaml, values.yaml, and 8 templates:
configmap, deployment, hpa, ingress, migrate-job, secret, service). The `helm` CLI
is not installable in this environment (registry egress is restricted), so local
`helm template` rendering was not run; it is exercised in the `deploy-validation`
CI workflow.

## CI coverage (honest)

| Pipeline | Exists | Gap |
|---|---|---|
| `backend-ci.yml` | ✅ | — |
| `deploy-validation.yml` | ✅ | — |
| `windows-release.yml` | ✅ | — |
| Desktop test CI (per-PR) | ❌ | 3,548 desktop tests not gated per PR |
| macOS release automation | ❌ | mac packaging/signing is manual |

The two CI gaps are carried forward from the GA report as pre-GA release-engineering
items — stated here so deployment readiness is not over-claimed.

## Reproduce

```
kubernetes-validate deploy/kubernetes/backend.yaml deploy/kubernetes/optional.yaml
shellcheck scripts/*.sh
yamllint -d relaxed deploy/kubernetes/*.yaml deploy/helm/neuropause-backend/*.yaml
```
