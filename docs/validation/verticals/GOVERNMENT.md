# Government / Public-Sector Validation Pack — NeuroPause

**Version assessed:** `1.0.0-rc.1` · **Classification:** Release Candidate (see
[`ENTERPRISE-GA-REPORT.md`](../../../ENTERPRISE-GA-REPORT.md)) · **Grounding:**
[`docs/validation/_grounding.md`](../_grounding.md)

## Scope and authenticity statement

This document is a **reference deployment and validation protocol** for a
government or public-sector operator evaluating NeuroPause. It describes *how an
agency would deploy and validate* the platform against real, shipped assets —
not a record of a real government installation. There are no named customers, no
fabricated metrics, and no invented integrations in this pack.

> **This is NOT an authorization.** Nothing here is, implies, or substitutes for
> an Authority to Operate (ATO), a FedRAMP authorization, an agency security
> control assessment, or any other government certification. NeuroPause holds
> **no** FedRAMP status and makes **no** ATO claim. The NIST SP 800-53 material
> in §5 is a **self-assessment control mapping** intended to *feed* an agency's
> own assessment and authorization process, not to assert compliance.

Every measured number is reproduced from the grounding reference run (2-vCPU Xeon
@ 2.10 GHz, 8 GB RAM, Node 22.22.2, PostgreSQL 16.13, Redis 7.0.15; the load
client is co-located, so latency is conservative), and every control cites a real
file in the repository. Items that are **modeled**, **partial**, or **absent** are
labeled as such and collected in "Honest limitations & remaining risks" below.

---

## 1. Deployment architecture — self-hosted, on-prem, and air-gapped

NeuroPause is a **secure Electron desktop** application paired with a
**self-hostable Node/Express backend** (PostgreSQL + Redis; Qdrant configurable
for semantic search). The backend is the only network service an agency must
operate, and it is designed to run **entirely inside the agency boundary** with
no mandatory external SaaS dependency. Production configuration ships with
`SEED_STORE_ON_BOOT=false`, so a fresh install contains **no fabricated catalog
data** — the deployed system carries only the operator's own data.

The repository provides four real, validated deployment paths. Each deploys the
*actual* backend built from [`apps/backend/Dockerfile`](../../../apps/backend/Dockerfile),
using its real liveness (`/live`) and readiness (`/health`) probes and the real
Prometheus endpoint (`/metrics`).

| Path | Asset | Use | Validation |
|---|---|---|---|
| Single host / private cloud | `docker-compose.prod.yml` + `apps/backend/Dockerfile` | One-box or private-cloud install | Existing, real |
| Kubernetes (raw) | [`deploy/kubernetes/backend.yaml`](../../../deploy/kubernetes/backend.yaml), `optional.yaml`, `secret.example.yaml` | Cluster deploy via `kubectl` | Strict schema validation — kubeconform, k8s 1.29 (**PASS**) |
| Kubernetes (Helm) | [`deploy/helm/neuropause-backend/`](../../../deploy/helm/neuropause-backend/) (8 templates) | Parameterized cluster deploy | `helm lint` + `helm template` + kubeconform strict |
| Offline / air-gapped | [`scripts/build-offline-bundle.sh`](../../../scripts/build-offline-bundle.sh) | Disconnected `docker save`/`load` bundle | shellcheck **CLEAN**; end-to-end `docker save/load` requires a Docker daemon — **not executed** in the reference run (**PARTIAL**) |

The deploy-path validation runs in CI at
[`.github/workflows/deploy-validation.yml`](../../../.github/workflows/deploy-validation.yml):
yamllint on the raw manifests, `helm lint`, `helm template`, and **kubeconform
`-strict -kubernetes-version 1.29.0`** over both the raw manifests and the
rendered chart. Guidance for operators is in
[`deploy/README.md`](../../../deploy/README.md).

### 1.1 Air-gapped reference procedure

The offline bundle is the core public-sector story. On a build host with Docker
and internet access, `scripts/build-offline-bundle.sh` produces a single tarball
containing the backend image plus its pinned `postgres:16-alpine` and
`redis:7-alpine` datastore images, an offline Compose file that references them
by tag (**no build, no registry**), an `.env` template, and a loader script. The
procedure on the disconnected host is:

```sh
# On the connected build host:
scripts/build-offline-bundle.sh neuropause-backend:1.0.0
#   → dist/offline-bundle/neuropause-offline-*.tar.gz

# Transfer the tarball across the air gap (removable media / one-way transfer).
# On the air-gapped host:
tar -xzf neuropause-offline-*.tar.gz
cp .env.example .env      # set POSTGRES_PASSWORD and a >=32-char JWT_ACCESS_SECRET
./load-and-run.sh         # docker load images.tar; docker compose up -d
```

The generated stack binds the backend to **loopback only** (`127.0.0.1:4000`) by
default, keeping the API off the host's external interfaces until the operator
deliberately fronts it; the datastores carry health checks and named volumes for
durable state. This gives an agency a reproducible, dependency-pinned,
disconnected install without pulling from any public registry at deploy time.

### 1.2 Kubernetes hardening (as shipped)

The raw manifests are hardened by default — relevant when an agency's platform
team maps them to a hardened cluster baseline:

| Control | Setting in `deploy/kubernetes/backend.yaml` |
|---|---|
| Non-root execution | `runAsNonRoot: true`, `runAsUser/Group: 1001` (Deployment + migrate Job) |
| Kernel attack surface | `seccompProfile: RuntimeDefault` |
| Privilege escalation | `allowPrivilegeEscalation: false` |
| Immutable root FS | `readOnlyRootFilesystem: true` (writable `/tmp` `emptyDir` only) |
| Linux capabilities | `capabilities.drop: ["ALL"]` |
| Resource bounds | CPU/memory requests + limits on every container |
| Rollout safety | `RollingUpdate` with `maxUnavailable: 0` + readiness gate on `/health` |
| Data provenance | `SEED_STORE_ON_BOOT: "false"`, `RUN_MIGRATIONS_ON_BOOT: "false"` (migrations run as a one-off `Job`) |
| Metrics exposure | Pod annotations advertise `prometheus.io/scrape` on `/metrics`; keep network-restricted |

PostgreSQL and Redis are expected to be **managed / HA** services inside the
agency boundary, referenced only through `DATABASE_URL` / `REDIS_URL` in a
Secret; the manifests deliberately do not stand up a single-pod database and
call it HA. TLS is terminated at the ingress by design.

---

## 2. Identity model

NeuroPause authentication is **real and tested**. The desktop never holds
provider secrets: all OAuth is **backend-brokered using PKCE (RFC 8252)**, so
the confidential exchange happens server-side.

| Control | Mechanism | Source |
|---|---|---|
| OAuth authorization-code + PKCE | Backend-brokered; no provider secrets on the client (RFC 8252) | `apps/backend/src/auth/` |
| Refresh-token rotation | Every refresh issues a new pair and links old→new | [`apps/backend/src/auth/session.ts`](../../../apps/backend/src/auth/session.ts) (`rotateTokens`) |
| Reuse detection | Presenting an already-rotated/consumed token **revokes the entire chain** for that user (`refresh_reused`) | `session.ts:66-74` |
| Token at-rest (server) | Server stores **only SHA-256 hashes** of refresh tokens, never plaintext | `session.ts` (`hashToken`) |
| Password hashing | **Argon2id**, `memoryCost 19456` KiB, `timeCost 2`, `parallelism 1` | [`apps/backend/src/auth/passwords.ts`](../../../apps/backend/src/auth/passwords.ts) |
| Token at-rest (desktop) | Refresh tokens encrypted via Electron `safeStorage`, backed by the macOS **Keychain**; only ciphertext persisted to disk | [`apps/desktop/src/main/security/secureStore.ts`](../../../apps/desktop/src/main/security/secureStore.ts) |

The Argon2id cost is deliberate: measured hash p50 **19.7 ms** / verify p50
**19.6 ms**, bounding auth throughput as a brute-force mitigation, not a defect.

### 2.1 SSO / enterprise-IdP federation is MODELED

Public-sector buyers typically require federation to an agency IdP (SAML/OIDC,
PIV/CAC, agency SSO). **This is honestly a modeled surface, not a shipped
integration.** Per the Enterprise Readiness Matrix in
[`ENTERPRISE-GA-REPORT.md`](../../../ENTERPRISE-GA-REPORT.md) (§3), the
multi-tenant/cloud row and the **Federation** row are classified **Modeled** —
schema, surfaces, and sync core are tested, but live tenant provisioning and
disaster recovery are not wired to live external systems. An agency should treat
enterprise-IdP federation (including PIV/CAC and MFA enforcement at the IdP) as
an **integration project to be scoped**, not a delivered capability. Multi-factor
authentication is therefore an **IdP-side responsibility** in any federated
deployment; NeuroPause does not itself implement a second factor.

### 2.2 Open item — Apple `id_token` not JWKS-verified

One authentication hardening item is open and is stated plainly. In
[`apps/backend/src/auth/providers/apple.ts`](../../../apps/backend/src/auth/providers/apple.ts)
the Apple Sign In `id_token` is **decoded (`jwt.decode`) but its signature is not
yet verified against Apple's JWKS** (`https://appleid.apple.com/auth/keys`). The
source carries an explicit `HARDENING TODO` (lines 14-16) and the unverified
decode is at line 77. This is tracked as **TD-1 / PR-1 (HIGH)** in the GA report.
The other providers use authenticated userinfo/Graph calls and are unaffected.
**Public-sector framing:** until this is closed, the Apple provider must be
treated as not meeting an identity-assurance bar and should be **disabled** in a
government deployment (it is env-gated: absent Apple credentials, the provider
reports itself disabled). Federation to a vetted agency IdP is the recommended
path regardless.

---

## 3. Governance — organizations, RBAC, and policy surfaces

NeuroPause enforces role-based access control at the desktop IPC boundary with a
**fail-closed permission gate**. The design is documented and tested in
[`apps/desktop/src/main/ipc/runtimeAuthz.ts`](../../../apps/desktop/src/main/ipc/runtimeAuthz.ts)
(with `runtimeAuthz.test.ts`), and it closes the class of privileged channels
that would otherwise ride on sender-trust alone.

The gate has four load-bearing parts:

1. **`RUNTIME_CHANNEL_PERMISSIONS`** — a single source of truth mapping every
   privileged runtime channel (execute, plugin lifecycle, permission grants,
   automation mutations, runtime control, memory writes, decision mutations,
   feature-flag overrides, migration/backup/recovery/support, billing, device
   registration, package rollback, and sensitive org-intelligence reads) to an
   **existing** enterprise permission — no new scopes are minted.
2. **`withRuntimeAuthz(defs)`** — stamps `requireAuth: true` + `permission` onto
   each handler and **throws at composition time** if handed any channel it
   cannot classify, so a privileged channel can never ship silently unguarded.
3. **`PUBLIC_CHANNELS`** — a vetted allowlist of genuinely-public / read-only /
   local-desktop channels that intentionally remain ungated.
4. **`assertAllChannelsClassified(...)`** — a startup invariant that returns any
   invokable channel that is **neither** gated **nor** allowlisted, letting the
   composition root **fail closed** rather than expose a channel by omission.

Enforcement reuses the secure bridge unchanged: the owner role holds every
permission, so single-user installs are unaffected; the gate bites for
multi-user enterprise RBAC. The permission scopes in play:

| Scope | Governs (examples) |
|---|---|
| `workforce:operate` | Execute-engine run/cancel (re-drives the runtime) |
| `marketplace:manage` | Plugin install/enable/update/remove + permission grant/revoke |
| `operations:manage` | Automation CRUD, runtime supervisor control, memory mutations, registry import/backup, package rollback, graph rebuild |
| `org:manage` | Data migration, backup restore/delete, recovery run, support bundles, billing checkout, device register/revoke, local capability grants |
| `governance:manage` | Feature-flag overrides (governed runtime behaviour) |
| `intelligence:read` | Sensitive org-intelligence reads (knowledge graph, timeline, unified search, founder ask, governance/context/relationship traces) |

Organization and RBAC data are backed by real migrations
(`apps/backend/src/db/migrations/0003_organizations.sql`), and the runtime RBAC
actor resolver is exercised by the desktop test suite. Policy surfaces
(feature-flag governance, decision/automation policy) sit behind the
`governance:manage` and `operations:manage` scopes above.

---

## 4. Audit trail

The backend maintains an **append-only `audit_log`** table. Its schema is defined
in the initial migration
[`apps/backend/src/db/migrations/0001_init.sql`](../../../apps/backend/src/db/migrations/0001_init.sql):

```sql
CREATE TABLE audit_log (
  id          BIGSERIAL PRIMARY KEY,
  user_id     UUID REFERENCES users (id) ON DELETE SET NULL,
  action      TEXT NOT NULL,
  detail      JSONB NOT NULL DEFAULT '{}'::jsonb,
  ip          INET,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX audit_log_user_id_idx ON audit_log (user_id);
CREATE INDEX audit_log_action_idx  ON audit_log (action);
```

Writes go through the `audit()` middleware in
[`apps/backend/src/middleware/audit.ts`](../../../apps/backend/src/middleware/audit.ts),
which performs an **`INSERT` only** — there is no `UPDATE` or `DELETE` path in
the middleware, giving append-only semantics at the application layer. Each row
captures the acting `user_id` (nullable, set-null on user deletion so the record
survives), the `action` string, a structured `detail` JSONB payload, the source
`ip` (`INET`), and a server-side `created_at` timestamp. Audit writes are
deliberately **non-blocking**: a failed audit write is logged and swallowed so it
can never break the request it describes.

**What is captured:** privileged actions as they occur (the table is populated at
runtime as privileged actions happen — it is not pre-seeded). Combined with the
request-scoped structured logging that redacts secrets, this provides
accountability for the actions that matter.

**Retention and export guidance (agency-side).** The application provides the
capture surface; **retention, rotation, tamper-evidence beyond append-only, and
WORM/immutable archival are the operator's responsibility** and are configured at
the PostgreSQL / infrastructure layer. Recommended assessor-facing procedure:

```sql
-- Point-in-time export for an assessor window (CSV):
\copy (SELECT id, user_id, action, detail, host(ip) AS ip, created_at
         FROM audit_log
        WHERE created_at >= '2026-07-01' AND created_at < '2026-08-01'
        ORDER BY id) TO 'audit_export.csv' WITH CSV HEADER;
```

**Honest current state.** The audit trail is real and append-only at the app
layer, but there is **no built-in automated retention policy, no cryptographic
chaining/hash-linking of records, and no shipped SIEM forwarder**. An agency
requiring immutable, forwarded audit records must supply those at the platform
layer (restrictive DB grants that deny `UPDATE`/`DELETE` on `audit_log`,
append-only storage, and a log-forwarding agent scraping the DB or structured
logs). This is a documented boundary, not a claimed capability.

---

## 5. Security review

### 5.1 Verified, tested controls

| Control | Evidence | Source |
|---|---|---|
| Electron context isolation | `contextIsolation: true` | [`apps/desktop/src/main/window.ts`](../../../apps/desktop/src/main/window.ts) |
| Renderer sandbox | `sandbox: true`, `nodeIntegration: false`, `webSecurity: true` | `window.ts:31-38` |
| Navigation lockdown | New windows denied; navigation away from own content blocked (routed to OS browser) | `window.ts:50-64` |
| Strict CSP | `default-src 'self'`, packaged `script-src 'self'`, `object-src 'none'`, `frame-ancestors 'none'`, `form-action 'none'`, `base-uri 'self'` | [`apps/desktop/src/main/security/csp.ts`](../../../apps/desktop/src/main/security/csp.ts) |
| Allow-listed, Zod-validated IPC | Fail-closed RBAC gate over an allow-listed channel set | [`ipc/runtimeAuthz.ts`](../../../apps/desktop/src/main/ipc/runtimeAuthz.ts) |
| SSRF guard (webhook egress) | Only public HTTPS endpoints; rejects loopback / link-local (incl. `169.254.169.254`) / private / CGNAT / IPv4-mapped IPv6; re-checked at send time | [`apps/desktop/src/main/webhooks/urlGuard.ts`](../../../apps/desktop/src/main/webhooks/urlGuard.ts), enforced at [`webhookStore.ts`](../../../apps/desktop/src/main/webhooks/webhookStore.ts):105 |
| Supply-chain signing | **Ed25519** detached-signature verification against a trusted key store | [`apps/desktop/src/main/nps/signature.ts`](../../../apps/desktop/src/main/nps/signature.ts) |
| Dependency posture | **0 production vulnerabilities** (`npm audit --omit=dev`); the 11 advisories are entirely in dev/build tooling | GA report §2.3 |
| Data authenticity | `SEED_STORE_ON_BOOT=false` in prod configs — no fabricated catalog data | `deploy/kubernetes/backend.yaml`, GA report PR-8 |
| Quality gates | typecheck 0, lint 0, **3,856 tests pass**, build exit 0 | GA report §2.1 |

### 5.2 Open items and public-sector risk framing

| ID | Item | Sev | Source | Public-sector framing |
|---|---|---|---|---|
| TD-1 / PR-1 | Apple `id_token` not JWKS-verified | HIGH | `auth/providers/apple.ts:14-16,77` | Disable the Apple provider in government deployments; federate to a vetted agency IdP. Identity-assurance blocker until closed. |
| TD-2 / PR-2 | Marketplace **app** install accepts unsigned packages when the trust store is empty | HIGH | `nps/packageService.ts:184`; seam in [`signature.ts`](../../../apps/desktop/src/main/nps/signature.ts) | Integrity hash is always checked and the worker path is fail-closed, but an empty trust store permits unsigned app installs. Restrict/ disable marketplace app installs, or require a non-empty publisher trust store, until signature enforcement is mandatory. |
| TD-3 / PR-3 | Rate limiter **fails open** if Redis is down | MED | `middleware/rateLimit.ts:37` | Deliberate availability-over-strictness choice; auth is still required. Make the fail-open state **alertable** in the agency's monitoring. |
| TD-4 | No per-PR desktop CI; no macOS release automation | MED | `.github/workflows/` | Supply-chain / release-integrity gap for the desktop artifact; agency should require signed, reproducible desktop builds before fielding. |
| TD-6 | No alerting / distributed tracing / capacity forecasting | MED | observability layer | Day-2 operational absence; `/metrics` + structured logs exist to scrape, but incident detection must be wired by the operator. |

### 5.3 NIST SP 800-53 control-family self-assessment mapping

> **This table is a self-assessment control mapping ONLY.** It exists to help an
> agency's own assessors locate NeuroPause's real controls against SP 800-53
> Rev. 5 control families as they run **their** Assessment & Authorization (A&A)
> process. **It is not an authorization, not an ATO, not a FedRAMP
> certification, and not a claim of compliance.** "State" reflects NeuroPause's
> honest self-view of the shipped code, not any external assessment. Control
> baselines, tailoring, and the authorization decision are the agency's.

| Family | Representative controls | NeuroPause control (real) | Self-assessed state |
|---|---|---|---|
| AC — Access Control | AC-3, AC-6 | Fail-closed IPC RBAC gate; least-privilege scopes; containers `drop ALL` caps + non-root | **Partial** — enforced desktop-side; owner role holds all scopes in single-user installs |
| AU — Audit & Accountability | AU-2, AU-3, AU-9 | Append-only `audit_log` (user/action/detail/ip/time); redacted structured logs | **Partial** — capture present; retention / immutability / forwarding are agency-side |
| IA — Identification & Authentication | IA-2, IA-5 | Backend-brokered PKCE OAuth; Argon2id; refresh rotation + reuse detection | **Partial** — MFA & SSO are IdP-side (modeled federation); Apple JWKS open (TD-1) |
| SC — System & Communications Protection | SC-7, SC-8, SC-13, SC-28 | SSRF egress guard; TLS at ingress; Keychain at-rest; strict CSP; sandboxed renderer | **Partial** — transport TLS is agency-provided at the ingress |
| SI — System & Information Integrity | SI-2, SI-7 | 0 production dependency vulns; Ed25519 manifest signing; package integrity hashing | **Partial** — unsigned-app-install gap open (TD-2) |
| CM — Configuration Management | CM-2, CM-6 | Versioned IaC (K8s/Helm), strict schema validation, `SEED_STORE_ON_BOOT=false` | **Supported** — reproducible, validated baseline |
| CP — Contingency Planning | CP-9, CP-10 | Validated `pg_dump`/`pg_restore`; restart recovery; DB-down auto-reconnect | **Partial** — automated rollback advisory; federation DR modeled |
| SR — Supply Chain Risk Management | SR-3, SR-4, SR-11 | Ed25519 signing seam; pinned offline bundle; 0 prod vulns | **Partial** — trust store empty until a signing pipeline is wired |
| SA — System & Services Acquisition | SA-11 | 3,856 automated tests; typecheck/lint gates; backend & deploy CI | **Partial** — no per-PR desktop CI / macOS release CI (TD-4) |
| RA — Risk Assessment | RA-5 | `npm audit` scanning; documented technical-debt & risk matrices | **Supported** — scanning present; risks documented in the GA report |

---

## 6. Evidence collection — reproducible assessor procedure

Everything below can be **re-run by an assessor** against a running instance; no
figure needs to be taken on trust. Harness usage and reference numbers trace to
the grounding reference run.

### 6.1 Live telemetry

```sh
# Prometheus metrics (aggregate, non-sensitive: uptime, memory, pg pool, HTTP counts)
curl -s http://127.0.0.1:4000/metrics
#   series: neuropause_backend_up, neuropause_backend_uptime_seconds,
#           neuropause_backend_resident_memory_bytes, neuropause_backend_heap_used_bytes,
#           neuropause_pg_pool_connections{state="total|idle|waiting"},
#           neuropause_http_requests_total{method,status}
curl -s http://127.0.0.1:4000/health   # {status: ok|degraded, components:{database,redis}, uptime}
curl -s http://127.0.0.1:4000/live     # liveness
```

Metrics are emitted by
[`apps/backend/src/observability/metrics.ts`](../../../apps/backend/src/observability/metrics.ts).

### 6.2 Audit export

Use the `\copy` procedure in §4 to export the `audit_log` for an assessment
window, then diff exported actions against expected privileged operations.

### 6.3 Performance & reliability harnesses

| Harness | Command | Measures |
|---|---|---|
| HTTP load | `node bench/http-load.mjs --base http://127.0.0.1:4000 --conc 32 --reqs 3000` | Per-endpoint rps + p50/p90/p95/p99 latency |
| DB latency | `DATABASE_URL=... node bench/db-latency.mjs --iters 2000` | Per-query-shape p50/p95/p99 (read-only, safe to re-run) |
| Intelligence engines | `apps/desktop/src/main/__bench__/performance.test.ts` | Deterministic engine timings over 5,000 entities |

Reliability procedures re-runnable per the grounding record: migration idempotency
(12 forward-only migrations; re-run applies 0 new), backup/restore (`pg_dump -Fc` →
fresh DB → `pg_restore`, row counts match), restart recovery (SIGTERM → healthy),
Redis-down fail-open, and DB-down degradation with pool auto-reconnect.

### 6.4 Reference measured results (grounding run — do not alter)

| Measure | Result |
|---|---|
| Cold start → healthy | **0.66 s** (DB + Redis connected) |
| Restart recovery (SIGTERM → healthy) | **0.46 s** |
| HTTP load total | 24,000 requests, concurrency 32, **0 errors** |
| `/health` | 1221 rps, p50 22 ms |
| `/live` | 2103 rps, p50 11 ms |
| `/metrics` | 1789 rps, p50 16 ms |
| `/store/apps` (DB list, 20 rows) | 610 rps, p50 52 ms, p99 80 ms |
| `/store/apps/:slug` (point read) | 424 rps, p50 72 ms, p99 118 ms |
| DB point read (direct pg, 2000 iters, 0 errors) | p50 0.23 ms / p95 0.46 ms |
| Argon2id | hash p50 19.7 ms / verify p50 19.6 ms |
| Memory | RSS 117 MB idle → 213 MB under load; heap 20 → 70 MB; pg pool 1 → 10 |
| Quality gates | typecheck 0, lint 0, **3,856 tests pass**, build exit 0, **0 prod npm-audit vulns** |
| Reliability | idempotency / backup-restore / restart / Redis-fail-open / DB-auto-recovery **PASS**; offline bundle **PARTIAL** |

---

## Honest limitations & remaining risks

- **No authorization of any kind.** NeuroPause has **no ATO and no FedRAMP
  authorization**, and this pack asserts none. The §5.3 mapping is a
  self-assessment to feed an agency's own A&A process — not a certification.
- **SSO / enterprise-IdP federation is MODELED**, not shipped. PIV/CAC, SAML/OIDC
  agency SSO, and IdP-enforced MFA are integration work to be scoped; the
  cloud/multi-tenant and Federation subsystems are labeled Modeled in the GA
  report, and disaster recovery is modeled, not live.
- **Apple `id_token` JWKS verification is OPEN** (TD-1/PR-1, HIGH). Disable the
  Apple provider in government deployments until signature verification lands.
- **Marketplace unsigned-app install** is permitted when the trust store is empty
  (TD-2/PR-2, HIGH); restrict marketplace app installs until signature
  enforcement is mandatory. The rate limiter **fails open** if Redis is down
  (TD-3) — make it alertable.
- **Desktop runtime is macOS-only** for measured performance (Keychain at-rest,
  vibrancy, target hardware); Electron startup/render/IPC/renderer-memory figures
  are **harness-only / pending target hardware** and are not fabricated here.
  There is **no per-PR desktop CI and no macOS release automation** (TD-4).
- **Air-gapped bundle is PARTIAL**: the script is shellcheck-clean and the
  procedure documented, but an end-to-end `docker save`/`load` was **not
  executed** in the reference run (requires a Docker daemon).
- **Audit retention/immutability/forwarding and day-2 observability** (alerting,
  tracing, capacity) are **agency-side responsibilities**, not shipped
  capabilities. **AI model execution, real connector execution, and cross-device
  sync** are not measured here, and vertical device/sensor integrations are
  **modeled** surfaces rather than live wiring.
