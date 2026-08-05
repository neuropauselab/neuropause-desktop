# NEMS Deployment Guide

This guide packages, builds, and deploys NEMS into a **staging** environment using the assets in
`packages/deploy/assets`. It provisions no infrastructure of its own — it targets a cluster you have
already configured.

## Prerequisites
- A Kubernetes cluster (managed or on-prem) and `kubectl` context.
- Helm 3, Docker with Buildx, and a container registry you can push to.
- A secrets manager (Vault) populated from `secrets/secrets.example.env`.

## Build
```
docker build -f packages/deploy/assets/docker/Dockerfile --target production -t ghcr.io/neuropause/nems:rc .
docker push ghcr.io/neuropause/nems:rc
```

## Deploy (staging)
```
kubectl apply -f packages/deploy/assets/k8s/00-namespaces.yaml
helm upgrade --install nems packages/deploy/assets/helm/nems \
  -f packages/deploy/assets/helm/nems/values-staging.yaml \
  --namespace nems-staging
```

## Validate
- `helm template nems packages/deploy/assets/helm/nems` renders cleanly.
- `/health/ready`, `/health/live`, `/health/startup` return 200 once pods are up.

Real DNS, TLS, and load balancers are **infrastructure-pending** until your cluster provides them.
