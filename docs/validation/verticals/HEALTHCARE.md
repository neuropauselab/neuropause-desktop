# NeuroPause — Healthcare Validation Pack

> **Reference deployment + validation protocol.** This document describes how a
> healthcare organization *would* deploy and validate NeuroPause, and maps
> NeuroPause's real technical controls to recognized safeguard frameworks. It is
> **not** a record of a production clinical install, and it is **not** a
> certification, attestation, or clearance of any kind.
>
> **NeuroPause is an AI operating layer for knowledge and administrative work. It
> is NOT a medical device, NOT an EHR, and it is NOT cleared, certified, or
> validated for clinical decision-making.** Every EHR / clinical-system
> integration discussed here is **MODELED**: the schema and connector surfaces
> exist in the codebase, but they are not wired to live clinical equipment or
> production patient-record systems in this program.

- **Product version:** `1.0.0-rc.1` (Release Candidate — see `ENTERPRISE-GA-REPORT.md`).
- **Source of truth for facts:** `docs/validation/_grounding.md`.
- **Reference benchmark environment:** 2-vCPU Xeon @ 2.10 GHz, 8 GB RAM, Node 22.22.2,
  PostgreSQL 16.13, Redis 7.0.15, load client co-located (so measured latency is
  conservative). All numbers below come from that single reference box; they are
  not SLA guarantees for a customer's hardware.

---

## 1. Clinical workflow mapping

NeuroPause sits *alongside* clinical systems, never inside the clinical decision
path. Its role is to help staff coordinate the **administrative and knowledge
work that surrounds care** — drafting, summarizing, routing, searching internal
policy, and coordinating tasks — while the system of record (EHR, PACS, LIS,
etc.) remains the authoritative clinical source.

The table maps NeuroPause's **real surfaces** to generic clinical-adjacent
administrative workflows. "Integration status" states honestly what is wired
versus modeled.

| NeuroPause surface (real) | Where it lives | Clinical-adjacent administrative use (generic) | Integration status |
|---|---|---|---|
| Secure desktop workspace (Electron: context isolation, sandbox, strict CSP, Zod-validated IPC) | `apps/desktop/src/main`, `apps/desktop/src/renderer/src/views/workspace` | Staff-facing surface for drafting correspondence, summarizing internal documents, task coordination | Real surface; runs locally on the workstation |
| Connectors | `apps/desktop/src/main/connectors/` (`connectorService.ts`, `connectorVault.ts`, `connectorRbac.test.ts`) | Bridge to internal systems (ticketing, document stores, scheduling) under RBAC | Framework real; **any EHR/clinical connector is MODELED** |
| Knowledge / knowledge fabric | `apps/desktop/src/main/knowledge`, `apps/desktop/src/main/knowledgeFabric`, `apps/desktop/src/renderer/src/knowledgeCenter` | Search and retrieval over *administrative* policy, SOPs, formularies, internal guidance | Real surface; content is customer-supplied non-clinical documents |
| Audit log | `apps/backend/src/middleware/audit.ts`, schema in `apps/backend/src/db/migrations/0001_init.sql` | Append-only record of privileged administrative actions for later review | Real, append-only; population grows as privileged actions occur |
| Intelligence engines (graph, memory, timeline, search, briefing, recommendations) | `apps/desktop/src/main/__bench__/performance.test.ts` exercises them | Summarize, relate, and surface *administrative* context to a human operator | Real engines; operate on customer's non-clinical data |

**Explicit boundary statements**

- NeuroPause outputs are **decision support for administrative work only**. A
  licensed professional remains fully responsible for any clinical judgment, and
  no NeuroPause output should be treated as diagnosis, treatment advice, or a
  clinical determination.
- NeuroPause does **not** ship a validated EHR adapter. Where this document
  refers to "EHR integration," it means the **connector framework** in
  `apps/desktop/src/main/connectors/` *could* host such an adapter — subject to
  the customer building, validating, and risk-assessing it themselves.
- Real AI-model execution latency and real connector execution are **not
  measured** in this program (they need live model credentials and live
  networks); see `docs/validation/_grounding.md` "What CANNOT be measured."

---

## 2. Operational validation

Operational health is observed through two real backend endpoints. KPIs below
name their telemetry source; none are invented.

**Endpoints (real):**

- `GET /health` → `{ status: ok|degraded, components:{database, redis}, uptime }`
  (`apps/backend/src/app.ts`).
- `GET /live` → liveness only, independent of DB/Redis (`apps/backend/src/app.ts`).
- `GET /metrics` → Prometheus text (`apps/backend/src/observability/metrics.ts`),
  exposing: `neuropause_backend_up`, `neuropause_backend_uptime_seconds`,
  `neuropause_backend_resident_memory_bytes`, `neuropause_backend_heap_used_bytes`,
  `neuropause_pg_pool_connections{state="total|idle|waiting"}`,
  `neuropause_http_requests_total{method,status}`.

**Measured operational numbers (reference 2-vCPU box, cite verbatim):**

| KPI | Measured value | Source |
|---|---|---|
| Cold start → healthy | **0.66 s** (DB + Redis connected) | reliability run, `docs/validation/_grounding.md` |
| `/health` throughput / latency | 1221 rps, p50 **22 ms** | `bench/http-load.mjs` → `bench/results/http-load.json` |
| `/live` throughput / latency | 2103 rps, p50 **11 ms** | `bench/http-load.mjs` |
| `/metrics` throughput / latency | 1789 rps, p50 **16 ms** | `bench/http-load.mjs` |
| `/store/apps` (DB list, 20 rows) | 610 rps, p50 52 ms, p99 **80 ms** | `bench/http-load.mjs` |
| `/store/apps/:slug` point read | 424 rps, p50 72 ms, p99 **118 ms** | `bench/http-load.mjs` |
| HTTP load error rate | **0 errors** over 24,000 requests (concurrency 32) | `bench/results/http-load.json` |
| DB point read (direct pg) | p50 **0.23 ms**, p95 0.46 ms | `bench/db-latency.mjs` → `bench/results/db-latency.json` |
| Memory under 24k-request load | RSS 117 MB idle → **213 MB** loaded; heap 20 → 70 MB | reliability run |
| PG pool auto-scale | **1 → 10** connections under load | `neuropause_pg_pool_connections` |

The DB layer is sub-millisecond; observed HTTP latency is dominated by the
application layer plus 2-vCPU contention with a co-located load client. On
customer-grade multi-core hardware these figures should be treated as a
**conservative floor**, re-measured on the target box before any SLA is set.

**Recommended operational monitors for a healthcare deployment**

1. Scrape `/metrics` on a fixed interval; alert on `neuropause_backend_up` absent
   and on `neuropause_pg_pool_connections{state="waiting"}` sustained > 0.
2. Poll `/health`; page on `status="degraded"` and record which component
   (`database` / `redis`) is `down`.
3. Track `neuropause_http_requests_total{status=~"5.."}` rate as an error-budget signal.

---

## 3. Reliability criteria

Reliability targets are anchored to **procedures that were actually executed in
this program** (results in `docs/validation/_grounding.md`, "Real RELIABILITY
results"). RTO/RPO recommendations are framed *around the proven backup/restore
path*, not aspirational numbers.

| Scenario | Executed result | Status | Implication for healthcare deployment |
|---|---|---|---|
| Migration idempotency | 12 forward-only migrations; re-run applied 0 new | **PASS** | Repeatable, non-destructive schema upgrades during maintenance windows |
| Backup / restore | `pg_dump -Fc` (136 KB) → fresh DB → `pg_restore` → **row counts match exactly** | **PASS** | Proven recovery path underpins the RPO/RTO below |
| Restart recovery | SIGTERM → down → restart → healthy in **0.46 s** | **PASS** | Fast recovery from process bounce / node reschedule |
| Redis-down (fail-open) | Redis stopped → `/store/apps` served 200×5; `/health` `degraded/redis:down`; no crash | **PASS** | Cache outage degrades gracefully, does not take the service down |
| DB-down degradation + auto-recovery | Postgres stopped → process survives, `/health` `degraded/database:down`, DB reads → clean 500; on PG restart the pool **auto-reconnected with no backend restart** | **PASS** | Survives DB blips without operator intervention |
| Offline / air-gapped bundle | `scripts/build-offline-bundle.sh` shellcheck-CLEAN + documented; full `docker save/load` needs a Docker daemon (not run here) | **PARTIAL** | Air-gap path documented; execute on target infrastructure before relying on it |

**Recommended RTO / RPO (framed around the proven procedure)**

- **RPO — target ≤ 24 h, tunable to minutes.** `scripts/backup-db.sh` produces
  timestamped compressed dumps with retention (default 14). RPO equals the backup
  interval; the customer sets the schedule. The restore side is proven
  (`scripts/restore-db.sh`, exact row-count match), so shortening the interval is
  a scheduling decision, not an unproven capability.
- **RTO — target ≤ 15 min for a single-node restore.** Restart-to-healthy is
  measured at **0.46 s**; the dominant RTO cost is `pg_restore` of the latest
  dump plus service restart. On the 136 KB reference dataset restore is
  effectively instantaneous; the customer must re-measure RTO against their own
  data volume.
- **Degraded-mode tolerance.** Because Redis fails open and the DB pool
  auto-reconnects, transient dependency outages should not consume RTO at all —
  the service degrades and self-heals. Alert on `degraded` so staff know the
  system is in reduced-function mode.

> A healthcare customer should re-run the backup/restore and restart procedures
> against their **own** data volume and infrastructure and record the observed
> RTO/RPO; the numbers above are a validated *starting point*, not a guarantee.

---

## 4. Security checklist

Concrete, control-by-control checklist built from **real controls** in the
codebase. Each row cites where the control lives. Open items are listed honestly
in their own subsection — they are not hidden.

| # | Control (real) | Evidence / location | Status |
|---|---|---|---|
| S-1 | Backend-brokered OAuth **PKCE / RFC 8252**; no provider secrets on the client | `apps/backend/src/auth/providers/` | Implemented |
| S-2 | Refresh-token **rotation + reuse detection**; server stores only SHA-256 hashes | `apps/backend/src/auth/session.ts`, `apps/backend/src/auth/router.ts` | Implemented |
| S-3 | **Argon2id** password hashing (memoryCost 19456 KiB, timeCost 2, parallelism 1) | auth path; cost measured hash p50 19.7 ms / verify 19.6 ms | Implemented |
| S-4 | Refresh tokens **encrypted at rest via Keychain (`safeStorage`)** | `apps/desktop/src/main/security/secureStore.ts`, `apps/desktop/src/main/connectors/connectorVault.ts` | Implemented |
| S-5 | **SSRF guard** on outbound webhooks | `apps/desktop/src/main/webhooks/webhookStore.ts`, `.../webhooks/urlGuard.ts` (tested) | Implemented + tested |
| S-6 | **RBAC fail-closed** IPC permission gate in the secure bridge | `apps/desktop/src/main/ipc/secureBridge.ts`, `apps/desktop/src/main/enterprise/authzGate.ts`, `apps/desktop/src/main/permissions/permissionManager.ts` | Implemented (fails closed if authorizer absent) |
| S-7 | **Ed25519** supply-chain signing (`verifyManifest` / `verifySignature`) | `apps/desktop/src/main/nps/signature.ts`, `.../nps/packageService.ts` | Implemented |
| S-8 | Renderer hardening: context isolation, sandbox, strict CSP, allow-listed + Zod-validated IPC | `apps/desktop/src/main`, `apps/desktop/src/main/ipc/secureBridge.ts` | Implemented |
| S-9 | No fabricated catalog data in prod (`SEED_STORE_ON_BOOT=false`) | production configs | Implemented |
| S-10 | Supply-chain hygiene: **0 production npm-audit vulnerabilities**; 3,856 tests pass; typecheck/lint 0 | quality gates, `docs/validation/_grounding.md` | Verified this program |

**Open items — stated honestly (must be tracked before a healthcare go-live)**

| # | Open item | Location | Risk / disposition |
|---|---|---|---|
| O-1 | Apple `id_token` **not yet JWKS-verified** (signature check is a HARDENING TODO) | `apps/backend/src/auth/providers/apple.ts` (see HARDENING TODO comment) | Only affects Sign-in-with-Apple. Recommend disabling the Apple provider until JWKS verification lands, or not enabling it for healthcare tenants |
| O-2 | Marketplace **app** install accepts **unsigned packages when the trust store is empty** (the worker path itself is fail-closed) | `apps/desktop/src/main/nps/` | Provision a non-empty Ed25519 trust store before deployment so only signed packages install |
| O-3 | Rate limiter **fails open** if Redis is down (deliberate availability choice) | `apps/backend/src/middleware/rateLimit.ts` | Availability-over-throttling tradeoff. Compensate with upstream (WAF / gateway) rate limiting for regulated tenants |

---

## 5. Audit requirements

NeuroPause provides a **real, append-only audit trail**. The writer is
`apps/backend/src/middleware/audit.ts`; the schema is defined in
`apps/backend/src/db/migrations/0001_init.sql`:

```
audit_log (
  id          BIGSERIAL PRIMARY KEY,
  user_id     UUID REFERENCES users(id) ON DELETE SET NULL,
  action      TEXT NOT NULL,
  detail      JSONB NOT NULL DEFAULT '{}'::jsonb,
  ip          INET,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
)
-- indexed on (user_id) and (action)
```

Design properties (real): writes are **append-only** and are deliberately
**non-blocking** — an audit failure is logged and swallowed so it can never break
the request it describes. This favors availability, and it means audit
completeness must itself be monitored (see below).

**Events the trail should capture for a healthcare deployment**

- Authentication and session lifecycle: sign-in, refresh rotation, refresh
  **reuse detection** events, sign-out.
- Authorization decisions at the RBAC gate: privileged action attempts, and
  **denials** from the fail-closed IPC gate (`secureBridge.ts`).
- Connector lifecycle and access: connector enable/disable, credential
  vault access (`connectorVault.ts`), connector RBAC decisions.
- Administrative data actions: knowledge document import/export, configuration
  changes, marketplace/package install (with signature-verification outcome).

**Current state — honest**

- The `audit_log` table and writer exist and are wired; the trail is **populated
  as privileged actions occur** (`docs/validation/_grounding.md`). The *set of
  action strings emitted today* has not been enumerated in this program — a
  customer should confirm, per workflow, that the `action` values they need are
  actually written, and add `audit(...)` calls where a required event is missing.
- Because audit writes are non-blocking, add an operational check that the trail
  is growing as expected (e.g., alert if privileged endpoints see traffic but
  `audit_log` row counts are flat).

**Retention guidance**

- Retain `audit_log` per the customer's regulatory obligation. Many U.S.
  healthcare programs align on a **6-year** retention posture for
  security/audit documentation; the customer's compliance office sets the actual
  number. NeuroPause does not enforce a retention period — it stores rows and
  the customer manages lifecycle (archival, WORM storage, legal hold) in their
  own database/backup tier.
- Include `audit_log` in the backup scope (`scripts/backup-db.sh`) so the trail
  is recoverable alongside the rest of the database.

---

## 6. Evidence collection

A reproducible procedure an internal auditor can run to collect validation
evidence. Every step uses a **real** endpoint, harness, or script.

**A. Operational telemetry snapshot**

```bash
# Health + liveness
curl -s http://<backend-host>/health | tee evidence/health.json
curl -s http://<backend-host>/live   | tee evidence/live.txt

# Full Prometheus scrape (all neuropause_* series)
curl -s http://<backend-host>/metrics | tee evidence/metrics.txt
```

**B. Performance evidence (re-run the real harnesses on target hardware)**

```bash
# HTTP load: concurrency 32, 3000 req/scenario (24,000 total on the reference run)
node bench/http-load.mjs   | tee evidence/http-load.json     # cf. bench/results/http-load.json

# Direct DB latency: 2000 iterations/query
node bench/db-latency.mjs  | tee evidence/db-latency.json    # cf. bench/results/db-latency.json

# Deterministic engine + Argon2id cost benchmarks
#   apps/desktop/src/main/__bench__/performance.test.ts
#   reference outputs: bench/results/intelligence-engines.json, bench/results/argon2.json
```

**C. Reliability evidence (re-run the executed procedures)**

```bash
# Backup → restore round trip (expect exact row-count match)
scripts/backup-db.sh
scripts/restore-db.sh   # into a fresh DB; diff row counts

# Restart recovery: SIGTERM the backend, restart, time /health → ok (reference: 0.46 s)
# Redis-down: stop Redis, confirm /store/apps still 200 and /health => degraded/redis:down
# DB-down:    stop Postgres, confirm process survives + clean 500s; restart PG, confirm pool auto-reconnects
```

**D. Audit trail export**

```sql
-- Export the append-only trail for the review window
COPY (SELECT id, user_id, action, detail, ip, created_at
      FROM audit_log
      WHERE created_at >= :window_start
      ORDER BY id) TO STDOUT WITH CSV HEADER;
```

**E. Deployment-validation evidence**

- Kubernetes manifests (`deploy/kubernetes/*.yaml`) — re-run **kubernetes-validate
  strict** (reference: PASS).
- Helm chart (8 templates) — `helm template` / `helm lint`.
- Offline bundle — `scripts/build-offline-bundle.sh` (shellcheck-CLEAN); execute
  `docker save/load` on infrastructure with a Docker daemon to complete the
  PARTIAL air-gap item.
- CI references: `.github/workflows/backend-ci.yml`, `deploy-validation.yml`,
  `windows-release.yml` (note: **no macOS/desktop CI yet** — desktop perf is
  harness-only pending target hardware).

Collect A–E into a dated evidence folder; each artifact traces back to a named
source in `docs/validation/_grounding.md`.

---

## 7. Compliance MAPPING (self-assessment only)

> **This section is a control-mapping to help a healthcare customer scope and
> guide their OWN compliance work. It is NOT a certification, NOT an attestation,
> and NOT a HIPAA/SOC 2 audit result. NeuroPause has not been assessed or
> certified against HIPAA or SOC 2 in this program. Actual HIPAA compliance
> depends on the customer's complete environment — administrative policies,
> physical facility controls, workforce training, Business Associate Agreements
> (BAAs) with every relevant party, and the customer's own risk analysis — most
> of which is outside the NeuroPause software boundary.**

### 7.1 HIPAA Security Rule safeguard mapping

Maps real controls to the *category* of safeguard they support. "Customer-owned"
means the safeguard is primarily the customer's responsibility; NeuroPause can
support but not satisfy it.

| HIPAA safeguard category | Representative requirement (paraphrased) | Supporting NeuroPause control (real) | Notes |
|---|---|---|---|
| **Administrative** | Access management / workforce authorization | RBAC fail-closed IPC gate (`secureBridge.ts`, `authzGate.ts`); connector RBAC (`connectorRbac.test.ts`) | NeuroPause enforces *technical* authorization; policy, workforce training, and sanction process are **customer-owned** |
| **Administrative** | Information system activity review | Append-only `audit_log` (`middleware/audit.ts`) + `/metrics` | Provides the *record*; review cadence and procedures are **customer-owned** |
| **Administrative** | Contingency plan (data backup, disaster recovery) | Proven `pg_dump`/`pg_restore` path (`scripts/backup-db.sh`, `restore-db.sh`); restart recovery 0.46 s | Backup *capability* is real; the contingency *plan* is **customer-owned** |
| **Physical** | Facility access, workstation & device security | Runs as a sandboxed local Electron app; secrets in OS Keychain (`secureStore.ts`) | Physical facility, device, and media controls are **customer-owned**; NeuroPause has no facility footprint |
| **Technical** | Access control / unique user identification | OAuth PKCE (RFC 8252), per-user sessions, RBAC gate | Provider config and identity source are customer-owned |
| **Technical** | Authentication | Argon2id passwords; refresh rotation + reuse detection | See **open item O-1**: Apple `id_token` JWKS verification pending |
| **Technical** | Transmission / integrity | SSRF guard on outbound webhooks; Ed25519 package signing | Network-layer TLS/encryption in transit is deployment-owned |
| **Technical** | Audit controls | `audit_log` append-only trail + indexes | See §5 on completeness monitoring and retention |

**PHI boundary note:** NeuroPause is not designed to be a primary store of
Protected Health Information, and this program did **not** test it with PHI. If a
customer chooses to route any PHI through connectors or knowledge surfaces, that
is the customer's decision and pulls those data flows into their HIPAA scope —
requiring a BAA with NeuroPause's operator and the customer's own risk analysis.

### 7.2 SOC 2 Trust Services Criteria mapping

| TSC | Supporting NeuroPause control (real) | Evidence |
|---|---|---|
| **Security (Common Criteria)** | RBAC fail-closed gate, PKCE OAuth, Argon2id, Ed25519 signing, SSRF guard, 0 prod npm-audit vulns | §4 checklist |
| **Availability** | Redis fail-open, DB pool auto-reconnect, restart 0.46 s, `/health` + `/metrics` | §2, §3 |
| **Processing Integrity** | Zod-validated IPC, migration idempotency (12 forward-only, 0 re-applied), 3,856 tests pass | §3, quality gates |
| **Confidentiality** | Keychain at-rest encryption, SHA-256 refresh-token storage, no client-side provider secrets | §4 checklist |
| **Privacy** | `SEED_STORE_ON_BOOT=false`; append-only audit trail | §5 |

**This SOC 2 mapping is a self-assessment aid only.** A SOC 2 report can be
issued exclusively by a licensed CPA firm after an independent examination.
Nothing here constitutes such an examination or its result.

---

## Honest limitations

- **Not a medical device and not an EHR.** NeuroPause is an AI operating layer
  for administrative and knowledge work. It is **not cleared, certified, or
  validated for clinical decision-making**, diagnosis, or treatment, and no
  output should be used as a clinical determination. A licensed professional is
  responsible for all clinical judgment.
- **Clinical / EHR integrations are MODELED.** The connector framework and
  schema surfaces exist (`apps/desktop/src/main/connectors/`), but no live
  clinical-system or EHR integration was wired or tested in this program. Real
  connector execution, real AI-model latency, and cross-device sync under real
  networks are **not measured** here (`docs/validation/_grounding.md`).
- **No certification or attestation.** This document contains **no** HIPAA
  certification, **no** SOC 2 report, and **no** regulatory clearance. The
  compliance sections are **control-mappings and self-assessment guidance only**;
  real compliance depends on the customer's full environment, policies, BAAs, and
  independent audit.
- **Open security items remain.** Apple `id_token` JWKS verification is pending
  (`apps/backend/src/auth/providers/apple.ts`); marketplace app install accepts
  unsigned packages when the trust store is empty; the rate limiter fails open
  when Redis is down. These must be tracked and mitigated before any regulated
  go-live.
- **Benchmarks are from one conservative reference box.** All numbers come from a
  2-vCPU reference environment with a co-located load client. They are a
  conservative floor to be **re-measured on the customer's own hardware**, not
  SLA guarantees.
- **Classification:** `1.0.0-rc.1`, Release Candidate. Treat this as a validation
  protocol to execute, not a completed production clinical validation.
