# NEMS Version 2.0 — Program 2 — Phase 4 Production Evidence Record

**Scope:** Application Platform & Runtime — go-live of the NEMS backend on DigitalOcean Kubernetes, and validation of routing, the database-backed request path, connectivity, authentication, monitoring exposure, operational health, and security posture on the live production cluster.

**Status:** Tasks 4.5, 4.5d, 4.7, 4.8, 4.9, 4.10, 4.11 — **validated on the live cluster.** Open items are enumerated explicitly under *What this does not prove*; none are implied to be complete.

**Record date:** 2026-07-30 · **Cluster:** `do-nyc3-nems-prod-cluster` · **Running revision:** git `ecfed7f8821574df672725503b869e36796ad717`

---

## 1. Executive summary

The backend is serving live production traffic over HTTPS. A real external request traverses **Gateway → HTTPRoute → Backend → PgBouncer pooler → PostgreSQL** (and Backend → Valkey) and returns the correct application response. The public surface is default-deny — only ten enumerated API prefixes reach the application; everything else, `/metrics` included, is answered by the Gateway proxy with 404. Authentication is wired correctly on the backend side (Google OAuth PKCE flow, correct redirect URI). The managed data services (PostgreSQL, Valkey) and Qdrant are not reachable from the public internet. The rollout is complete and stable (2/2 replicas, 0 restarts).

Every verdict in this record is backed by a measured value captured on the live cluster, not asserted. Where a claim could not be established headlessly (for example, a real Google sign-in requiring a credential step), it is listed as unproven rather than implied.

| Task | What it validated | Verdict |
|------|-------------------|---------|
| 4.5 | Gateway routing — HTTPRoute applied and attached | PASS |
| 4.5d | DB-backed request path (Gateway→…→PostgreSQL + Valkey) | PASS |
| 4.7 | CORS / connectivity posture | PASS |
| 4.8 | OAuth redirect URI + auth enforcement (backend side) | PASS |
| 4.9 | `/metrics` exposure + external route surface | PASS (public); in-cluster NetworkPolicy deferred |
| 4.10 | Operational validation (rollout, health, resources) | PASS |
| 4.11 | Security validation (denied operations refused) | PASS |

---

## 2. Production infrastructure inventory (measured)

| Component | Identity |
|-----------|----------|
| DOKS cluster | `nems-prod-cluster`, nyc3, k8s 1.36.0-do.3, ID `7750e61a-2636-4220-85ea-aec4120bae40`, pool `nems-prod-pool-1` (3 nodes) |
| Backend image | `registry.digitalocean.com/neuropause033/backend@sha256:997f87373f557655728a8be64d84a299de7b2f0952f2e2c090a20d231d00bbe6` (tag `backend-v0.1.0-rc.4`) |
| Deployment | `nems-backend` (nems-prod), replicas 2, RollingUpdate maxUnavailable 0 / maxSurge 1 |
| Service | `nems-backend` ClusterIP, port 80 → containerPort 4000 |
| Gateway | `nems-gateway` (cilium), LB `134.199.250.188`, listener `https` HTTPS/443, `allowedRoutes.namespaces.from: Same` |
| HTTPRoute | `nems-backend` (nems-prod), 10 PathPrefix matches, committed `ecfed7f8`, manifest sha256 `b6890ac2284e82451f7dcc402677f965cc6d12d7eb196e2e59f5852a8912de90` (2581 bytes / 79 lines) |
| TLS | Secret `api-neuropause033-tls`, Let's Encrypt (issuer CN=YR2), TLSv1.3 |
| DNS | `api.neuropause033.com` → `134.199.250.188` (Cloudflare DNS-only) |
| PostgreSQL | `nems-prod-pg` (pg 18), private `10.20.0.6`, public `134.122.13.254`, direct 25060 / pooler 25061; app uses the pooler via `DATABASE_URL` |
| Valkey | `nems-prod-cache` (valkey 8), public host `nems-prod-cache-do-user-39664195-0.a.db.ondigitalocean.com:25061` |
| Qdrant | in-cluster Service (nems-prod), type ClusterIP |

---

## 3. Evidence by task

### 4.5 — Gateway routing

**Method.** The validated HTTPRoute manifest was committed as `ecfed7f8` (byte-identical to the server-dry-run-validated bytes, sha256 `b6890ac2…`), then applied to the cluster from that committed file, and the controller reconcile and external routing were observed.

**Evidence.** From a zero baseline (0 HTTPRoutes cluster-wide, gateway `https` attachedRoutes 0), `kubectl apply` created the route; the Cilium controller reported `Accepted=True` and `ResolvedRefs=True`, and the gateway `https` listener went to `attachedRoutes=1`. External probes: `/health` and `/live` returned **200 answered by the application** (12 helmet headers), while `/metrics` and `/` returned **404 from `server: envoy`**. TLS 1.3 with a valid Let's Encrypt certificate; DNS resolves to the load balancer. The applied object was traced to commit `ecfed7f8`.

**Verdict: PASS.**

### 4.5d — DB-backed request path

**Method.** Two premises were verified live before scoring: the ConfigMap sets `SEED_STORE_ON_BOOT=false` (empty catalog is intended), and `store/service.ts` + `store/repository.ts` contain zero catch blocks (so a 200 can only mean the query executed). The path was then exercised end to end and correlated to backend logs by `x-request-id`.

**Evidence.** `GET /store/featured` returned **200** on the no-catch path — proving the `SELECT` executed through the **PgBouncer pooler (25061)** against PostgreSQL and returned; `/health` reported `database: up` and `redis: up` (Valkey reachable). The request was found in the serving pod's own logs (`nems-backend-5944d9fbfb-24p66`) as `GET /store/featured → 200` in **5 ms** of server handler time. The response body was `{items: []}` — the correct response for an intentionally-empty production catalog. Latency was network-bound (India↔NYC3; server 5 ms).

**Verdict: PASS** (scored on query execution; the empty catalog is by design, see §4).

### 4.7 — CORS / connectivity

**Method.** The CORS policy was read from committed `app.ts` (`origin: http://(127.0.0.1|localhost)(:port)?`, `credentials: false`) and the live behavior was compared against it.

**Evidence.** `http://localhost:5173` and `http://127.0.0.1:8080` were **allowed** (allow-origin echoed); `https://evil.example`, `http://cdn.evil.example`, and `https://localhost` were **denied** (no allow-origin); `Access-Control-Allow-Credentials` was never `true`. `/health` and `/live` reachable and answered by the app; PostgreSQL and Valkey up; both pods Ready with 0 restarts; `/metrics` still proxy-404.

**Verdict: PASS.**

### 4.8 — OAuth redirect URI + auth enforcement (backend side)

**Method.** The redirect URI the backend sends Google was read from the real `GET /auth/google/start` 302; enforcement was checked by attempting denied operations.

**Evidence.** The authorize redirect targets `accounts.google.com` with `redirect_uri = https://api.neuropause033.com/auth/google/callback` — matching both the committed construction (`${PUBLIC_BACKEND_URL}/auth/${provider}/callback`) and the live ConfigMap (`PUBLIC_BACKEND_URL=https://api.neuropause033.com`). `response_type=code`, `scope=openid email profile`, state present, `client_id` length 73 (a genuine Google client ID). The desktop redirect target is restricted to http-loopback (a foreign target is rejected 4xx); the callback, token-exchange, and refresh endpoints all reject bogus input (4xx); all eight protected endpoints return **401** without a valid token and with a forged token.

**Verdict: PASS** (backend side; the real login round-trip and Console registration are user-side, see §4).

### 4.9 — `/metrics` exposure + external route surface

**Method.** The applied HTTPRoute was read and the external surface probed; the in-cluster posture was characterized honestly.

**Evidence.** The applied route enumerates exactly the 10 intended prefixes with `/metrics` **absent**. All 10 prefixes are answered by the application; `/metrics`, `/`, `/admin`, `/actuator`, `/internal`, `/server-status`, `/.env`, `/debug/vars` are all answered by the proxy (404). `/metrics` is therefore **not publicly reachable**. In-cluster: **0 NetworkPolicies** in nems-prod — the metrics endpoint is reachable in-cluster on port 4000, and the content is non-sensitive by design (uptime, memory, pool counts, request counts; no PII/paths/secrets).

**Verdict: PASS (public surface).** The in-cluster NetworkPolicy restriction is recorded as a deferred defense-in-depth item (see §4).

### 4.10 — Operational validation

**Method.** Deployment, rollout, pods, probes, health, resources, autoscaling, and nodes were read.

**Evidence.** Deployment `nems-backend`: **2/2/2** desired/ready/available, `updatedReplicas=2`, generation 3 **observed** (3), `Available=True`, `kubectl rollout status` "successfully rolled out". Strategy RollingUpdate `maxUnavailable=0` (zero-downtime). Both pods Running/Ready on the rc.4 image with **0 restarts**. Probes: liveness `/live`, readiness `/health`. Live health 200 with database and redis up. Resources: requests 100m/256Mi, limits 1/512Mi (`kubectl top` unavailable — no metrics-server, reported not passed). HPA: **not applied** (fixed 2 replicas). Nodes 3/3 Ready.

**Verdict: PASS.**

### 4.11 — Security validation (denied operations refused)

**Method.** Denied operations were attempted and confirmed refused; data-service exposure was probed directly (TCP connect only, no payload) with firewall reads as corroboration.

**Evidence.** API access controls: four protected endpoints and a forged token returned **401**; a foreign CORS origin got no allow-origin header; `/metrics`, `/admin`, `/.env`, `/actuator` were proxy-404; plaintext HTTP served no API route; TLS 1.3 with a valid Let's Encrypt certificate. Data services **not publicly exposed**: PostgreSQL `:25060` and `:25061`, and Valkey `:25061`, all returned `BLOCKED:TimeoutError` from the public internet; Qdrant is a ClusterIP. Corroboration: the PG and Valkey managed-database firewalls admit only trusted source `k8s 7750e61a-2636-4220-85ea-aec4120bae40` (the DOKS cluster), with no `0.0.0.0/0` rule.

**Verdict: PASS.**

---

## 4. What this does not prove (open and unverified items)

These are stated explicitly rather than implied. None are claimed complete.

- **Real Google login round-trip (4.8).** A successful sign-in issues a real one-time code that `/auth/token` exchanges (with the PKCE verifier) for real access/refresh tokens. That requires a real Google account and consent — a credential step — and is performed from the desktop app, not in this validation. A 401 proves the guard rejects missing/invalid tokens; it does not test that a valid token is accepted.
- **Google Cloud Console registration (4.8).** Whether `https://api.neuropause033.com/auth/google/callback` is registered as an authorized redirect URI is on the Google side and must be confirmed there. If it is not registered, Google returns `redirect_uri_mismatch` after consent.
- **Qdrant end-to-end (4.5d).** The vector path is only reachable through the authenticated `/memory/semantic` route; it was not exercised. Qdrant's *exposure* was confirmed (ClusterIP), but its request path was not.
- **Write / transaction path (4.5d).** Only read paths were exercised. No INSERT/UPDATE was performed, so the commit/rollback path is not covered.
- **Store catalog is intentionally empty.** Production sets `SEED_STORE_ON_BOOT=false` specifically so the catalog starts empty "with no fabricated apps / ratings / download counts." `{items: []}` with 200 is the correct response; seeding would inject fabricated demo data and was deliberately not done.
- **In-cluster `/metrics` NetworkPolicy (4.9).** The public exposure is closed. The in-cluster restriction that `metrics.ts` calls for (a NetworkPolicy or a separate metrics port) is **not deployed**; it is deferred as a defense-in-depth enhancement (metrics content is non-sensitive), to be revisited alongside a monitoring scraper.
- **Unpushed branch.** Branch `phase-2` is 13 commits ahead of `origin/phase-2`, including the HTTPRoute commit `ecfed7f8`. The work is committed locally but not yet pushed to the remote.
- **HTTP→HTTPS redirect.** The Gateway's HTTP/80 listener is unrouted (plaintext HTTP serves no API route); there is no HTTP-to-HTTPS redirect. Deferred.
- **ALPN / HTTP-2.** The edge negotiates no `h2`; traffic is HTTP/1.1.
- **Deferred `pingDatabase()` fix.** `apps/backend/src/db/pool.ts`'s `pingDatabase()` swallows its error; a corrective change was deferred to a separate rc.5 cycle.
- **Point-in-time readings.** All checks are point-in-time; they are not claims about availability, behavior under sustained load, or failure injection.
- **`kubectl top` unavailable (4.10).** Live CPU/memory usage was not read because metrics-server is not installed; this is reported, not passed.

---

## 5. Process integrity

The evidence-based discipline is only credible if its own tooling is held to the same standard. Two notes:

- **A false-pass was caught and fixed in 4.11.** The first security run corroborated the data-service firewalls with `doctl databases firewalls list --format …`, which the installed doctl rejected ("unknown flag"). The check scored the error text as "no public rule present" because the string `0.0.0.0/0` did not appear in an error message — a command failure converted into a passing result. It was caught by reading the output, the firewall read was rewritten to parse `-o json` and check the exit code (reporting UNREADABLE/OPEN on failure), and the check was demoted to informational corroboration behind the direct TCP probe. On re-run, the firewall read succeeded and genuinely corroborated the probe (trusted source = the DOKS cluster).
- **Routing derivation was cross-checked, not trusted.** The public prefix set was derived by parsing `app.ts`, and independently checked against a whole-file literal scan and the Task 4.5a cluster dump; all three agreed. A prior line-oriented parser had silently dropped half the prefixes, and that regression was only caught by an independent prediction control — which is why the derivation carries three methods rather than one.

---

## 6. Traceability appendix

| Artifact | Value |
|----------|-------|
| Running route commit | `ecfed7f8821574df672725503b869e36796ad717` |
| HTTPRoute manifest sha256 | `b6890ac2284e82451f7dcc402677f965cc6d12d7eb196e2e59f5852a8912de90` (2581 bytes) |
| Backend image digest | `sha256:997f87373f557655728a8be64d84a299de7b2f0952f2e2c090a20d231d00bbe6` |
| `HEAD:apps/backend/src/app.ts` sha256 | `991cc53666cf71611064036c191e70444432fe414dbba1d989f6fdfad512e482` |
| DOKS cluster ID | `7750e61a-2636-4220-85ea-aec4120bae40` |
| Managed-DB firewall trusted source | `k8s 7750e61a-2636-4220-85ea-aec4120bae40` (no `0.0.0.0/0`) |
| TLS issuer | Let's Encrypt (CN=YR2), TLSv1.3 |

*Every value in this record was measured on the live cluster or read from committed source during Phase 4 validation. Items that could not be established are listed in §4, not implied here.*
