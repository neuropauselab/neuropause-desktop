# Full Cluster Rebuild

Rebuild the entire NEMS production environment from Git and backups after total
loss of `nems-prod-cluster`. This is Scenario 8 of [`DR-PLAN.md`](./DR-PLAN.md)
and the worst case. It is a **destructive/greenfield** procedure gated on the
Incident Commander's authorization.

> **Unvalidated.** These steps have not been executed as a drill. The first
> quarterly game-day that runs this end-to-end fills a
> `recovery-evidence-*.md` and measures the real RTO. Until then the `≤ 4h`
> objective is a target only. Treat every command as *to be confirmed against
> current DO/kubectl behaviour*.

## Key fact: managed stores are independent of the cluster

DOKS, the managed PostgreSQL (`nems-prod-pg`), and the managed Valkey
(`nems-prod-cache`) are **separate DigitalOcean products**. Losing the Kubernetes
cluster does **not** by itself lose the databases. In most cluster-rebuild cases
the databases survive and you only re-attach to them. Only restore database data
(DR-PLAN §2/§4) if the database itself is confirmed lost or corrupt. Qdrant,
by contrast, lives **inside** the cluster on a PVC — it is lost with the cluster
and must be restored from its snapshot.

## Prerequisites

- `doctl` authenticated to the DigitalOcean account; `kubectl`; `helm`.
- This repo checked out at the last known-good commit on `phase-2`.
- Access to the secret material (DB/cache/Qdrant connection URIs, TLS cert/key,
  registry, Grafana admin, Alertmanager destinations) — from your secret manager
  or the DO console. **None of these are in Git.**
- Spaces backup credentials and the freshest verified backup keys
  (`deploy/backup/verify-backup.sh`).
- Access to DNS for `neuropause033.com`.

## Step 1 — Recreate the cluster

Match the recorded shape: region `nyc3`, Kubernetes version `1.36.0-do.3` (or the
current supported patch ≥ that), node pool `nems-prod-pool-1`, 3 nodes at the
original node size.

```sh
doctl kubernetes cluster create nems-prod-cluster \
  --region nyc3 --version <CURRENT_SUPPORTED_1.36_PATCH> \
  --node-pool "name=nems-prod-pool-1;size=<NODE_SIZE>;count=3" --wait
doctl kubernetes cluster kubeconfig save nems-prod-cluster
kubectl get nodes    # expect 3 Ready
```

Record the **new cluster id** — it is different from the old
`7750e61a-…` and is needed in Step 2.

## Step 2 — Re-authorize the new cluster on the managed databases

The managed PostgreSQL/Valkey trust *specific* sources (Phase 4.11 confirmed the
trusted source was the old cluster id). The new cluster has a new id and will be
**refused** until added:

```sh
doctl databases firewalls append 406985e0-bb6d-49b2-bcae-6d996acd5843 \
  --rule k8s:<NEW_CLUSTER_ID>          # PostgreSQL nems-prod-pg
doctl databases firewalls append a5829ae2-293f-40ad-ba57-bfc1609241e9 \
  --rule k8s:<NEW_CLUSTER_ID>          # Valkey nems-prod-cache
```

Keep the databases **private** — do not add `0.0.0.0/0`. (Verify afterwards that
no public rule exists, per the Phase 4 security posture.)

## Step 3 — Attach the container registry (no credential emission)

Use the DOKS registry integration, which wires the pull secret without printing
credentials to the terminal:

```sh
doctl kubernetes cluster registry add nems-prod-cluster
```

Do **not** run `doctl registry docker-config` — emitting registry credentials to
stdout is prohibited by the project's operating rules.

## Step 4 — Namespaces and secrets

```sh
kubectl create namespace nems-prod
kubectl create namespace monitoring
```

Recreate the secrets the manifests reference (values from your secret manager):

- `nems-prod`: application DB/cache/Qdrant connection secrets (as the backend
  expects), the TLS secret `api-neuropause033-tls`, and the backup secrets
  `nems-pg-backup` / `nems-spaces-backup` (+ `nems-qdrant-backup` if used).
- `monitoring`: `grafana-admin`, `alertmanager-pagerduty`, `alertmanager-slack`.

## Step 5 — Reapply the platform from Git

Apply the committed manifests (paths are illustrative — apply what the repo
actually tracks for each):

```sh
# workload + edge
kubectl apply -f <deployment/service/configmap manifests for nems-backend>
kubectl apply -f <nems-gateway + HTTPRoute nems-backend>   # HTTPRoute committed at ecfed7f8
# observability (Phase 5)
helm upgrade --install kube-prometheus-stack prometheus-community/kube-prometheus-stack \
  -n monitoring -f deploy/observability/kube-prometheus-stack.values.yaml
kubectl apply -f deploy/observability/           # ServiceMonitors, Probes, PrometheusRules, dashboards, Alertmanager
# backups (Phase 5)
kubectl apply -f deploy/backup/pg-backup-cronjob.yaml
kubectl apply -f deploy/backup/qdrant-backup-cronjob.yaml   # after setting QDRANT_URL
```

## Step 6 — TLS and DNS

The rebuilt gateway gets a **new** LoadBalancer IP (the old `134.199.250.188` was
tied to the destroyed LB, unless a DO reserved IP was in use — if so, re-attach
it). Then:

```sh
kubectl -n nems-prod get svc      # find the new LoadBalancer external IP
# update DNS: api.neuropause033.com  A  -> <NEW_LB_IP>
```

Let the ACME issuer re-issue `api-neuropause033-tls` once DNS resolves and the
gateway is programmed (or restore the cert/key from your secret backup to shorten
the window).

## Step 7 — Restore data that lived in the cluster

- **Qdrant:** restore the freshest snapshot from Spaces (`qdrant/` prefix) into
  the new Qdrant, then validate collection/point counts (DR-PLAN §3).
- **PostgreSQL / Valkey:** restore **only if** the managed instance was itself
  lost (DR-PLAN §2/§4). If it survived, Step 2 already reconnected you.

## Step 8 — End-to-end validation (do not declare recovered until all pass)

```sh
kubectl -n nems-prod rollout status deploy/nems-backend
kubectl -n nems-prod get gateway nems-gateway          # Programmed=True
kubectl -n nems-prod get httproute nems-backend -o wide # Accepted + ResolvedRefs True
dig +short api.neuropause033.com                        # -> new LB IP
curl -sS -o /dev/null -w '%{http_code}\n' https://api.neuropause033.com/health   # 200
# a DB-backed path returns expected data (authenticated request)
# Prometheus targets for nems-backend are UP; Grafana dashboards populate
```

## Step 9 — Record evidence

Fill [`recovery-evidence-TEMPLATE.md`](./recovery-evidence-TEMPLATE.md): start/end
timestamps, measured RTO, actual data-loss window (RPO) per store, every command
run, and any step that was wrong or missing. Update
[`README.md`](./README.md)'s measured column and fix this document in the same PR.

## Post-rebuild hardening checklist

- [ ] Databases still private (no `0.0.0.0/0`); new cluster added as trusted source.
- [ ] `/metrics` not publicly reachable (Phase 4.9 posture) — external probe of
      `/metrics` returns 404.
- [ ] Backups running against the new environment (`verify-backup.sh --deep`).
- [ ] Alertmanager delivering (send a test alert; confirm it pages/tickets).
- [ ] TLS valid and auto-renewing; cert-expiry probe healthy.
