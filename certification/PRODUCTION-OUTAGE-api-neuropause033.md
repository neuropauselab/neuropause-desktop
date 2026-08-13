# INCIDENT — `api.neuropause033.com` is not accepting connections

**Opened 13 August 2026** · Program 13C · severity: the product is unusable on
every platform for every user.

Tags: `[Certain]` measured · `[Likely]` strong inference · `[Guessing]` gap-filling.

---

## 1 · The measurement

From the operator's Mac, real network, 13 Aug:

```
curl --max-time 10 https://api.neuropause033.com/health
curl: (28) Connection timed out after 10006 milliseconds
api 000 connect=0.000000s total=10.006644s
```

**`connect=0.000000s` is the whole finding.** `time_connect` is the moment the
TCP handshake completes; zero means it never completed. Nothing was negotiated —
not TLS, not HTTP. `[Certain]`

It **timed out** rather than being **refused**. A host that is up with nothing
listening answers a SYN with RST and curl reports `Connection refused` in
milliseconds. A ten-second silence means the SYN was dropped: a firewall, a
load balancer that no longer exists, or a host that is not there. `[Likely]`

DNS is fine — `api.neuropause033.com → 134.199.250.188`, which is the address
Phase 4 recorded for the load balancer. The name is not stale. `[Certain]`

---

## 2 · Correction — I sent you to the wrong machine

My previous message said the fix was
`docker compose -f docker-compose.prod.yml up -d` on the droplet. **That is
wrong and would not have helped.** I inferred the deployment target from the
existence of `docker-compose.prod.yml` without reading `deploy/`.

Production is **DigitalOcean Kubernetes**, and the repository records it
precisely. `deploy/PHASE4-EVIDENCE.md` §"Record date: 2026-07-30" measured every
value below on the live cluster:

| | |
|---|---|
| DOKS cluster | `nems-prod-cluster`, nyc3, k8s `1.36.0-do.3`, ID `7750e61a-2636-4220-85ea-aec4120bae40` |
| Node pool | `nems-prod-pool-1`, 3 nodes |
| Namespace | `nems-prod` |
| Deployment | `nems-backend`, replicas 2 |
| Image | `registry.digitalocean.com/neuropause033/backend@sha256:997f8737…` (tag `backend-v0.1.0-rc.4`) |
| Service | `nems-backend` ClusterIP :80 → container :4000 |
| Gateway | `nems-gateway` (Cilium), LB **134.199.250.188**, listener `https` HTTPS/443 |
| Route | HTTPRoute `nems-backend`, 10 enumerated prefixes |
| DNS | Cloudflare, **DNS-only** (no proxy in front) |
| Data | Managed Postgres :25060/:25061 and Valkey, firewalled to the cluster only |

`docker-compose.prod.yml` is the single-host alternative documented in
`deploy/README.md`. It is not what serves this hostname.

**One thing this rules out immediately:** `/health` *is* one of the ten
enumerated HTTPRoute prefixes, so the desktop probe is hitting a path the
Gateway is configured to route. The route is not the defect. `[Certain]`

---

## 3 · What changed between 30 July and 13 August

On **30 July** `/health` and `/live` returned **200, answered by the
application**, over TLS 1.3 with a valid Let's Encrypt certificate, measured on
the live cluster. `[Certain]` — recorded in `deploy/PHASE4-EVIDENCE.md`.

On **13 August** the same address does not complete a TCP handshake.

Something that was demonstrably working two weeks ago stopped, and nothing and
no one noticed until a founder could not sign in.

---

## 4 · The diagnostic ladder — five commands, each eliminating one layer

Run in order and stop at the first failure; that is the layer.

**1. Does the cluster still exist?**
```sh
doctl kubernetes cluster list
doctl kubernetes cluster get 7750e61a-2636-4220-85ea-aec4120bae40
```
Gone, or `status: degraded` → that is the answer. Skip to §5.

**2. Does the load balancer still exist and still own the IP?**
```sh
doctl compute load-balancer list --format ID,Name,IP,Status,Created
```
No LB, or an LB with a **different** IP → DNS points at an address nobody owns.
Cloudflare is DNS-only, so nothing masks that.

**3. Can you reach the cluster at all?**
```sh
doctl kubernetes cluster kubeconfig save 7750e61a-2636-4220-85ea-aec4120bae40
kubectl get nodes
```

**4. Is the application running?**
```sh
kubectl -n nems-prod get deploy,pods,svc
kubectl -n nems-prod get gateway,httproute
kubectl -n nems-prod describe gateway nems-gateway | sed -n '/Status/,$p'
```
Look for `attachedRoutes: 1` on the `https` listener and 2 `Running` pods.

**5. Is it the app, or the path to it?**
```sh
kubectl -n nems-prod port-forward deploy/nems-backend 8080:4000 &
curl -sS http://127.0.0.1:8080/health
```
`{"status":"ok",…}` here while the public address times out ⇒ the application is
healthy and the failure is Gateway/LB/network. Nothing here ⇒ the pods are the
problem, most likely the managed Postgres or Valkey they depend on.

**Check first, before any of it:** the DigitalOcean **billing page**. `[Guessing]`
— but a 3-node DOKS cluster plus managed Postgres plus managed Valkey plus a
load balancer plus a container registry is a real monthly bill, DigitalOcean
powers resources off when payment fails, and "worked on 30 July, silently gone
by 13 August" fits that shape better than any technical failure. It costs thirty
seconds to eliminate.

---

## 5 · If the cluster is gone

Everything needed to rebuild is committed, and the image is pinned by digest —
so the rebuild is reproducible rather than a fresh guess:

```sh
kubectl apply -f deploy/kubernetes/backend-production.yaml
kubectl apply -f deploy/networking/issuer.yaml
kubectl apply -f deploy/networking/certificate.yaml
kubectl apply -f deploy/networking/gateway.yaml
kubectl apply -f deploy/kubernetes/httproute-production.yaml
kubectl -n nems-prod rollout status deploy/nems-backend
```

**What is NOT in the repository, and will block you:** the Secrets. The
Deployment reads seven — `nems-postgres`, `nems-valkey`, `nems-jwt`,
`nems-oauth`, `nems-qdrant`, `nems-embedding`, `nems-spaces-app` — plus the
`nems-docr-pull` registry pull secret and the `nems-postgres-ca` ConfigMap.
`deploy/kubernetes/secret.example.yaml` gives the shape, never the values.
Correctly so; it also means a rebuild needs whoever holds those credentials.

A new cluster gets a **new load balancer IP**, so the Cloudflare `A` record for
`api.neuropause033.com` has to be repointed, and every installed desktop copy
starts working again the moment it is.

---

## 6 · The two findings behind the outage

### P-4 · Nothing in CI deploys the backend `[Certain]`

Five workflows exist. `deploy-validation.yml` runs `yamllint`, `helm lint`,
`helm template` and `kubeconform -strict` — it **validates manifests and never
applies them**. The only `ssh`/`scp` in CI copies desktop installers to the
*website* droplet, gated behind `vars.PUBLISH_TO_SITE`.

So production was applied by hand on 30 July and there is no automation, no
record of drift, and no way to redeploy it from a green pipeline. The repository
has excellent deployment *material* and no deployment *mechanism*.

### P-5 · Nothing was watching, so the outage was found by a customer `[Certain]`

`deploy/observability/` contains a full kube-prometheus-stack values file, a
blackbox exporter that probes exactly this endpoint, SLO alert rules, and an
Alertmanager routing config. `deploy/observability/README.md` documents how to
install it. `deploy/PHASE4-EVIDENCE.md` never records it being deployed, and the
evidence for it is the outage itself: **the entire production API was down for
up to two weeks and the team learned about it from a founder failing to log in.**

Both were invisible because Program 13C scoped `apps/backend` out. Availability
is not a gate anyone was checking, so nobody failed it.

---

## 7 · What this does to the rest of the program

- **F-4** (sign-in wall) and **this outage** compound into the same user-visible
  result: nobody can open the product. They are separate defects and both are
  open. Fixing hosting does not fix F-4; fixing F-4 would have made this outage
  survivable for anyone already onboarded.
- **F-7** is now shipped (`round20.patch`) and would have changed the founder's
  experience today: instead of "invalid email or password" he would have read
  *"NeuroPause cannot reach its AI service right now — the service did not
  respond in time. Nothing is wrong with this computer."* It does not fix the
  outage. It stops the outage from reading as the user's fault.
- **Program 13C = NOT CERTIFIED.** Add **Backend availability = FAIL**, measured,
  with an incident behind it.

---

## 8 · Verdict

The desktop application is not defective in this respect. It called its API, the
API did not answer, and the supervisor said so every twenty seconds for two
weeks into a log file nobody reads.

The repair is infrastructure, the credentials are not in the repository, and the
first command to run is a billing page.
