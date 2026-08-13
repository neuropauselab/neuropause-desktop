#!/usr/bin/env bash
# ============================================================================
# NeuroPause — emergency production rebuild, api.neuropause033.com
# 13 Aug 2026 · derived from deploy/PHASE4-EVIDENCE.md + the committed manifests
#
# RUN THIS YOURSELF. I have no DigitalOcean token and will not ask you to paste
# a production credential into a chat transcript.
#
# Every value below was read from the repository or from PHASE4-EVIDENCE's
# measurements on the live cluster of 30 July. Nothing here is invented.
#
# FOUR TRAPS the obvious command order walks into. Each is marked TRAP N at the
# point it bites. Read them before you start; each costs ~10 minutes to debug
# blind and ~30 seconds to avoid.
# ============================================================================
set -euo pipefail

OLD_CLUSTER_ID=7750e61a-2636-4220-85ea-aec4120bae40   # destroyed; kept for the DB firewall diff
NS=nems-prod
HOST=api.neuropause033.com

# ============================================================================
# STEP 0 — WHAT SURVIVED.  Run this before creating anything.
# ============================================================================
# The cluster and the managed databases are SEPARATE DigitalOcean resources.
# If only the cluster was destroyed, your production data is intact and this is
# a much smaller job. This single command decides "NEW EMPTY" vs "PRESERVED".
doctl account get
doctl kubernetes cluster list
doctl databases list          # look for: nems-prod-pg (pg 18), nems-prod-cache (valkey 8)
doctl compute load-balancer list --format ID,Name,IP,Status   # look for: nems-prod-lb
doctl registry list           # look for: neuropause033  (the backend image lives here)
doctl registry repository list-tags backend || true   # is backend-v0.1.0-rc.4 still there?

# STOP AND READ THE OUTPUT.
#   databases present  -> data PRESERVED. Reuse them. Do NOT create new ones.
#   databases gone     -> data is NOT recoverable from this repository. Say so.
#   registry gone      -> the pinned image digest is gone; you must rebuild from
#                         apps/backend/Dockerfile before anything below works.
#
# Qdrant was an in-cluster ClusterIP, not a managed service. Its data died with
# the cluster regardless. Only /memory/semantic depends on it.

# ============================================================================
# STEP 1 — CLUSTER
# ============================================================================
doctl kubernetes cluster create nems-prod-cluster \
  --region nyc3 \
  --node-pool "name=nems-prod-pool-1;size=s-2vcpu-4gb;count=3" \
  --wait

NEW_CLUSTER_ID=$(doctl kubernetes cluster get nems-prod-cluster --format ID --no-header)
echo "NEW_CLUSTER_ID=$NEW_CLUSTER_ID"
doctl kubernetes cluster kubeconfig save "$NEW_CLUSTER_ID"
kubectl get nodes     # expect 3 Ready

# ============================================================================
# TRAP 1 — THE MANAGED-DATABASE FIREWALLS TRUST THE OLD CLUSTER, NOT THE NEW ONE
# ============================================================================
# PHASE4-EVIDENCE §"Managed-DB firewall trusted source":
#   k8s 7750e61a-2636-4220-85ea-aec4120bae40   (no 0.0.0.0/0 rule)
#
# That is the DESTROYED cluster's ID. Your new cluster has a new one, so every
# pod will fail to reach Postgres and Valkey with a CONNECTION TIMEOUT that
# looks exactly like a broken application. Fix it here, before deploying.
doctl databases firewalls append nems-prod-pg    --rule "k8s:$NEW_CLUSTER_ID"
doctl databases firewalls append nems-prod-cache --rule "k8s:$NEW_CLUSTER_ID"
doctl databases firewalls list nems-prod-pg    -o json
doctl databases firewalls list nems-prod-cache -o json
# Verify the new ID is present. Do NOT add 0.0.0.0/0 — the whole point of
# Task 4.11 was proving these services are unreachable from the internet.
# Remove the stale old-cluster rule afterwards, not now.

# ============================================================================
# STEP 2 — NAMESPACE (gateway.yaml creates it, but the secrets come first)
# ============================================================================
kubectl create namespace "$NS" --dry-run=client -o yaml | kubectl apply -f -

# ============================================================================
# TRAP 2 — TWO CONFIGMAPS THE DEPLOYMENT NEEDS DO NOT EXIST IN THIS REPOSITORY
# ============================================================================
# backend-production.yaml contains ONLY a Deployment and a Service. It reads:
#   configMapRef: nems-backend-config      <- defined nowhere in the repo
#   configMap:    nems-postgres-ca         <- mounted at NODE_EXTRA_CA_CERTS
# Without both, the pods CrashLoopBackOff and the logs blame the application.
#
# nems-backend-config carries the non-secret env (NODE_ENV, PORT,
# PUBLIC_BACKEND_URL, RUN_MIGRATIONS_ON_BOOT, SEED_STORE_ON_BOOT).
# SEED_STORE_ON_BOOT=false is deliberate: production starts with an empty
# catalog, per docker-compose.prod.yml.
kubectl -n "$NS" create configmap nems-backend-config \
  --from-literal=NODE_ENV=production \
  --from-literal=PORT=4000 \
  --from-literal=PUBLIC_BACKEND_URL="https://$HOST" \
  --from-literal=RUN_MIGRATIONS_ON_BOOT=false \
  --from-literal=SEED_STORE_ON_BOOT=false \
  --dry-run=client -o yaml | kubectl apply -f -

# The Postgres CA — download it from the database's connection details:
doctl databases get nems-prod-pg --format ID --no-header   # note the id
# then: doctl databases connection <id> --format Host,Port,User,Database,Password
# and download the CA cert from the DO console (Databases -> nems-prod-pg ->
# Connection details -> Download CA certificate) into ca-certificate.crt
kubectl -n "$NS" create configmap nems-postgres-ca \
  --from-file=ca-certificate.crt \
  --dry-run=client -o yaml | kubectl apply -f -

# ============================================================================
# STEP 3 — SECRETS.  Seven, plus a registry pull secret.
# ============================================================================
# NOT in Git, correctly. deploy/kubernetes/secret.example.yaml gives the shape.
# The backend's own zod schema (apps/backend/src/config/env.ts) makes these
# HARD requirements — it refuses to boot without them:
#     DATABASE_URL        (url)      REDIS_URL          (url)
#     JWT_ACCESS_SECRET   (>=32 chars)
#
# DATABASE_URL must use the PgBouncer POOLER on 25061, not direct 25060 —
# that is what PHASE4-EVIDENCE measured serving production traffic.
#
# Registry pull secret — doctl generates it, no manual credentials:
doctl registry kubernetes-manifest --namespace "$NS" --name nems-docr-pull | kubectl apply -f -

# The other seven: create from values you hold. NOT from this file.
#   nems-postgres    DATABASE_URL=postgres://...@...:25061/...?sslmode=require
#   nems-valkey      REDIS_URL=rediss://default:...@nems-prod-cache-...:25061
#   nems-jwt         JWT_ACCESS_SECRET (>=32) [+ JWT_ACCESS_TTL, JWT_REFRESH_TTL]
#   nems-oauth       GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET (+ any other provider)
#   nems-qdrant      QDRANT_URL / QDRANT_API_KEY
#   nems-embedding   embedding provider key
#   nems-spaces-app  Spaces access key / secret
#
# If any is unrecoverable, STOP AT THAT SECRET AND SAY WHICH. Do not generate a
# replacement JWT_ACCESS_SECRET casually: changing it invalidates every existing
# session and refresh token in the product.
kubectl -n "$NS" get secret   # expect all eight before continuing

# ============================================================================
# TRAP 3 — GATEWAY API AND CERT-MANAGER ARE NOT ON A FRESH DOKS CLUSTER
# ============================================================================
# gateway.yaml is gateway.networking.k8s.io/v1 with gatewayClassName: cilium.
# issuer/certificate are cert-manager.io/v1. A new cluster has NEITHER, and
# `kubectl apply` fails with "no matches for kind Gateway" / "kind Certificate".
kubectl apply -f https://github.com/kubernetes-sigs/gateway-api/releases/download/v1.1.0/standard-install.yaml
kubectl -n kube-system rollout restart ds/cilium        # DOKS: pick up Gateway API
kubectl get gatewayclass                                 # expect: cilium

# TRAP 3b — cert-manager's Gateway API support is BEHIND A FEATURE GATE.
# issuer.yaml uses solvers[].http01.gatewayHTTPRoute. Install cert-manager
# WITHOUT enabling it and the Certificate sits Pending forever with no error
# that names the cause.
helm repo add jetstack https://charts.jetstack.io && helm repo update
helm install cert-manager jetstack/cert-manager \
  --namespace cert-manager --create-namespace \
  --set crds.enabled=true \
  --set config.enableGatewayAPI=true \
  --set "extraArgs={--feature-gates=ExperimentalGatewayAPISupport=true}"
kubectl -n cert-manager rollout status deploy/cert-manager

# ============================================================================
# STEP 4 — MIGRATIONS (only if the database is NEW or the schema is behind)
# ============================================================================
# nems-backend-config sets RUN_MIGRATIONS_ON_BOOT=false so two replicas do not
# race. The repo ships the one-off Job for exactly this:
kubectl apply -f deploy/kubernetes/migrate-job-production.yaml
kubectl -n "$NS" wait --for=condition=complete job/nems-backend-migrate --timeout=180s
kubectl -n "$NS" logs job/nems-backend-migrate

# ============================================================================
# STEP 5 — BACKEND
# ============================================================================
kubectl apply -f deploy/kubernetes/backend-production.yaml
kubectl -n "$NS" rollout status deploy/nems-backend --timeout=180s
kubectl -n "$NS" get pods -o wide     # expect 2/2 Running, 0 restarts

# On failure, read these in order — the cause is almost always Trap 1 or Trap 2:
#   kubectl -n $NS describe pod <pod>   | sed -n '/Events/,$p'
#   kubectl -n $NS logs <pod> --tail=200

# ============================================================================
# STEP 6 — INTERNAL HEALTH.  Do not touch DNS until this returns 200.
# ============================================================================
kubectl -n "$NS" port-forward deploy/nems-backend 8080:4000 &
sleep 3
curl -sS http://127.0.0.1:8080/health; echo
# expect: {"status":"ok","components":{"database":"up","redis":"up"},...}
# database:down -> Trap 1 (firewall) or a wrong DATABASE_URL. Not the app.
kill %1

# ============================================================================
# TRAP 4 — ORDER.  Gateway -> CERTIFICATE -> HTTPRoute.  Not Gateway -> Route -> TLS.
# ============================================================================
# The https listener references Secret api-neuropause033-tls, which cert-manager
# has not created yet. Apply the HTTPRoute before the certificate exists and the
# listener is unprogrammed, attachedRoutes stays 0, and you will debug the route
# when the problem is the certificate. cert-manager's http01 challenge attaches
# its own temporary HTTPRoute to the :80 listener, which is why gateway.yaml has
# one and why it is deliberately left unrouted otherwise.
kubectl apply -f deploy/networking/gateway.yaml
kubectl -n "$NS" wait --for=condition=Programmed gateway/nems-gateway --timeout=300s || \
  kubectl -n "$NS" describe gateway nems-gateway | sed -n '/Status/,$p'

kubectl apply -f deploy/networking/issuer.yaml
kubectl apply -f deploy/networking/certificate.yaml

# ============================================================================
# STEP 7 — DNS MUST MOVE BEFORE THE CERTIFICATE CAN ISSUE
# ============================================================================
# http01 proves domain control by serving a challenge at
# http://api.neuropause033.com/.well-known/acme-challenge/... — which Let's
# Encrypt resolves through public DNS. While DNS still points at the dead IP,
# the challenge cannot be reached and the Certificate stays Pending.
NEW_IP=$(kubectl -n "$NS" get svc -l io.cilium.gateway/owning-gateway=nems-gateway \
  -o jsonpath='{.items[0].status.loadBalancer.ingress[0].ip}')
echo "NEW_IP=$NEW_IP"
doctl compute load-balancer list --format ID,Name,IP,Status   # cross-check: nems-prod-lb

# Now, in Cloudflare: edit the A record for api.neuropause033.com -> $NEW_IP.
# Keep it DNS-ONLY (grey cloud). Proxying it breaks the http01 challenge and
# terminates TLS somewhere the Gateway does not control. Change NOTHING else —
# the apex neuropause033.com is a separate problem (it has no A record at all,
# which is why the desktop auto-updater fails at DNS on every installed copy).
dig +short "$HOST"    # must return $NEW_IP before continuing

kubectl -n "$NS" wait --for=condition=Ready certificate/api-neuropause033-tls --timeout=600s || \
  kubectl -n "$NS" describe certificate api-neuropause033-tls | sed -n '/Status/,$p'

# ============================================================================
# STEP 8 — ROUTE, then the public proof
# ============================================================================
kubectl apply -f deploy/kubernetes/httproute-production.yaml
kubectl -n "$NS" describe httproute nems-backend | grep -A5 "Parents\|Conditions"
kubectl -n "$NS" describe gateway nems-gateway | grep -i attachedroutes   # expect 1

curl -sS -o /dev/null \
  -w 'api %{http_code} connect=%{time_connect}s tls=%{time_appconnect}s total=%{time_total}s\n' \
  --max-time 10 "https://$HOST/health"
curl -sS --max-time 10 "https://$HOST/health"; echo

# DONE means HTTP 200 with {"status":"ok","components":{"database":"up","redis":"up"}}.
# Nothing less. A 404 from `server: envoy` means the route did not attach.

# ============================================================================
# STEP 9 — SO THIS IS NEVER FOUND BY A CUSTOMER AGAIN
# ============================================================================
# The last outage ran up to two weeks and was discovered by a founder failing to
# log in. The repository already contains the monitoring that would have caught
# it in minutes; it was simply never deployed.
#   deploy/observability/README.md — kube-prometheus-stack + blackbox exporter
#   deploy/observability/probe-nems-endpoints.yaml — probes THIS endpoint
#
# If the 20 minutes are gone, the two-minute version is an external check that
# does not depend on the cluster being alive — UptimeRobot / Better Stack /
# Cloudflare health check on https://api.neuropause033.com/health, alerting to a
# phone. An in-cluster probe cannot page you about the cluster being gone.
