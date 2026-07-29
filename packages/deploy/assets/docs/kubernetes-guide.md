# NEMS Kubernetes Guide

Manifests under `k8s/` describe intended cluster state. They are **manifests only** — applying them
requires a real cluster and context.

| File | Resources |
|---|---|
| `00-namespaces.yaml` | Namespaces (dev/staging/production) |
| `10-config.yaml` | ConfigMap + Secret template (no real values) |
| `20-workloads.yaml` | Deployment (API), StatefulSet (Postgres), Deployment (Redis), DaemonSet (node-exporter) |
| `30-services.yaml` | Services |
| `40-ingress.yaml` | Ingress + TLS |
| `50-storage.yaml` | PersistentVolume + PersistentVolumeClaim |
| `60-scaling.yaml` | HorizontalPodAutoscaler + PodDisruptionBudget |
| `70-policies.yaml` | NetworkPolicy (default-deny + API allow) |
| `80-jobs.yaml` | Job (migration) + CronJob (backup) |

Apply order follows the numeric prefixes. No cluster is claimed to exist; secrets are injected from
Vault at apply time.
