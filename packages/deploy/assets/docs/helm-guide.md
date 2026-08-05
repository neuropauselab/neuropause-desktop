# NEMS Helm Guide

The chart lives at `helm/nems` (`Chart.yaml`, `values.yaml`, per-environment overrides, `templates/`).

## Install / upgrade
```
helm upgrade --install nems packages/deploy/assets/helm/nems \
  -f packages/deploy/assets/helm/nems/values-production.yaml \
  --namespace nems-production
```

## Environments
- `values-development.yaml` — 1 replica, no ingress/autoscaling.
- `values-staging.yaml` — 2 replicas, staging host.
- `values-production.yaml` — 3+ replicas, autoscaling to 20, production host.

## Upgrade & rollback
```
helm diff upgrade nems packages/deploy/assets/helm/nems -f <values>
helm rollback nems <REVISION>
```

Secrets are referenced via `existingSecret` (Vault / sealed-secrets); the chart stores none.
