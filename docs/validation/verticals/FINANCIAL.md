# NeuroPause — Financial Services Validation Pack

**Version assessed:** `1.0.0-rc.1` (Release Candidate — see `ENTERPRISE-GA-REPORT.md`)
**Document type:** Reference deployment + validation protocol
**Audience:** Financial-controls reviewers, second-line risk, internal audit, security architecture

> **What this document is.** A *reference deployment* and a *reproducible validation
> protocol* for a financial-services organization evaluating NeuroPause. It maps the
> platform's **real, tested controls** to the questions a financial-controls reviewer
> asks, and gives that reviewer a checklist to re-run the evidence themselves.
>
> **What this document is not.** It names **no real customer**, asserts **no
> production install** at any bank or fund, and fabricates **no metric**. Every number
> traces to `docs/validation/_grounding.md` and the benchmark artifacts in
> `bench/results/`. Every control cites a real file. The compliance section is a
> **self-assessment control mapping**, explicitly **not a certification or
> attestation** (see §4).

---

## 0. Scope and reference architecture

NeuroPause is a secure Electron desktop application (context isolation, sandbox,
`nodeIntegration` off, strict CSP, allow-listed + Zod-validated IPC with a
**fail-closed RBAC permission gate**) plus a Node/Express backend on Postgres and
Redis, with Qdrant configured for semantic search. For a financial-services tenant the
reference deployment is:

| Layer | Component | Real basis |
|---|---|---|
| Client | Electron desktop shell | `apps/desktop/src/main/*` — secure-by-default main/preload |
| API | Express backend | `apps/backend/src/*`; container `apps/backend/Dockerfile` |
| Orchestration | Kubernetes + Helm | `deploy/kubernetes/*.yaml` (kubernetes-validate strict PASS), `deploy/helm/neuropause-backend/*` (8 templates) |
| State | Postgres 16 + Redis 7 | 12 forward-only migrations, `apps/backend/src/db/migrations/` |
| Telemetry | Prometheus `/metrics`, `/health`, `/live` | `apps/backend` — real series, see §6 |

The reference environment for every measured number below is a **2-vCPU Xeon @2.10 GHz,
8 GB, Node 22.22.2, PG 16.13, Redis 7.0.15**, with the load client co-located (so
latency figures are conservative). Numbers are reproduced by the harnesses in §6 and
must not be altered when re-cited.

**Important scoping note for finance:** NeuroPause is a decision/knowledge platform, not
a payment processor or ledger of record. It is **not a cardholder data environment
(CDE)** and does not store primary account numbers. Where PCI-DSS is referenced (§4) it
is mapped only as a set of *supporting control areas* that apply if the platform is
deployed adjacent to a regulated environment — never as a claim of PCI scope or
compliance.

---

## 1. Governance

Financial governance requires that authority be explicit, least-privilege, and
enforced by the system rather than by convention. NeuroPause implements this with a
real, tested tenancy and RBAC surface.

### 1.1 Organizations, memberships, workspaces

The multi-tenant governance primitives are defined in
`apps/backend/src/db/migrations/0003_organizations.sql`:

- **`memberships`** binds a user to an organization with a `role` constrained by a
  `CHECK` to `owner | admin | member | viewer`, and a `status` of
  `active | invited | suspended`. Invitations are first-class rows keyed by
  `invited_email` with a SHA-256 `invite_token_hash` and an expiry — an invite is a
  membership in `invited` status until accepted, so the join is auditable end to end.
- A **partial unique index** enforces at most one membership per `(org_id, user_id)`
  and at most one pending invite per `(org, email)`.
- **`workspaces`** are org-owned isolation containers (`ON DELETE CASCADE` from the org).

The richer enterprise role model — the one that drives the desktop RBAC gate — is
defined in `packages/shared/src/types/enterprise.ts:72` (`EnterprisePermission`, a
least-privilege union of coarse `:read` / `:manage` / `:operate` / `:approve` scopes)
and seeded as built-in roles in `apps/desktop/src/main/enterprise/org/seed.ts:197-206`.

| Built-in role | Scope summary | Financial-controls reading |
|---|---|---|
| **Owner** | `ALL_ENTERPRISE_PERMISSIONS` (`seed.ts:198`) | Root of trust; hold to a named accountable individual |
| **Admin** | Manager scopes + `org:manage`, `governance:manage`, `workspace:manage`, `marketplace:manage` (`seed.ts:115-126`) | Structure/policy administration; separated from day-to-day operation |
| **Manager** | Member scopes + `workforce:approve`, `operations:manage`, and domain `:manage` (`seed.ts:99-113`) | Holds the **approve** authority |
| **Member** | Read scopes + `workforce:operate` (`seed.ts:97`) | Holds the **operate** authority — cannot self-approve |
| **Viewer** | `:read` scopes only (`seed.ts:63-96`) | Read-only oversight / observer access for audit |
| **AI Worker** | `workforce:read`, `intelligence:read` only (`seed.ts:128`) | Governed automation is **read-constrained**; cannot operate, approve, or spend |

### 1.2 The fail-closed RBAC IPC gate

Every privileged renderer→main call passes through one pipeline in
`apps/desktop/src/main/ipc/secureBridge.ts`. `runSecureHandler` (lines 93-117) enforces,
in order: authentication (line 98), **permission (RBAC)** (lines 101-106), Zod payload
validation (lines 107-111), and a bounded timeout (line 112). The gate is **fail-closed
by construction**: a channel that declares a `permission` but whose `authorize`
dependency is absent throws `Authorization is not available.` (lines 102-104) rather
than defaulting to allow.

Coverage is enforced at composition and boot time by
`apps/desktop/src/main/ipc/runtimeAuthz.ts`:

- `RUNTIME_CHANNEL_PERMISSIONS` (line 47) is the single source of truth mapping each
  privileged channel to an existing enterprise permission. Financially relevant
  mappings include `BillingCheckout → org:manage` (line 108), and
  `BackupRestore` / `BackupDelete` / `MigrationRun` / `RecoveryRun` → `org:manage`
  (lines 80-84).
- `withRuntimeAuthz` **throws at composition time** for any channel with no
  classification (lines 182-187) — a privileged channel cannot ship unguarded by
  omission.
- `assertAllChannelsClassified` (lines 347-355) is the **startup invariant**: it returns
  every invokable channel that is neither gated nor on the vetted `PUBLIC_CHANNELS`
  allowlist, letting the composition root fail closed at boot.

The owner role holds every permission, so single-user installs are unaffected; **the
gate bites only for multi-user enterprise RBAC** (`runtimeAuthz.ts:33-35`). Owner-role
integrity is separately protected: `guardOwnerUserPatch` in
`apps/desktop/src/main/enterprise/authzGate.ts:195` prevents the built-in Owner role
from being stripped of permissions or de-roled.

### 1.3 Segregation of duties (SoD)

SoD is expressed directly in the permission taxonomy, not bolted on:

- **Maker/checker on the workforce:** `workforce:operate` (Member) is a *different scope*
  from `workforce:approve` (Manager). An operator who runs an AI worker cannot approve
  its actions unless separately granted the approve scope
  (`seed.ts:97,101`).
- **Executive controls** split further into `executive:approve`, `executive:verify`,
  and `executive:execute` (`enterprise.ts:105-107`) — four-eyes and verify/execute
  separation are representable.
- **Spend authority is elevated:** initiating billing checkout requires `org:manage`
  (`runtimeAuthz.ts:108`), i.e. Admin/Owner, keeping financial commitment out of
  operator hands.
- **Governed AI cannot self-authorize:** the AI Worker role carries only two read scopes
  (`seed.ts:128`), so automation cannot operate, approve, or transact.

Honest current state: NeuroPause provides the *scopes and enforcement* for SoD; it does
not ship an out-of-the-box SoD conflict-matrix report. Defining which role combinations
are prohibited for a given financial process is a customer configuration and review
task.

---

## 2. Audit

### 2.1 The append-only backend audit trail

The backend maintains a dedicated append-only audit table, defined in
`apps/backend/src/db/migrations/0001_init.sql:50-60`:

```
audit_log(id BIGSERIAL PK, user_id UUID → users(id) ON DELETE SET NULL,
          action TEXT NOT NULL, detail JSONB NOT NULL DEFAULT '{}',
          ip INET, created_at TIMESTAMPTZ NOT NULL DEFAULT now())
```

with indexes on `user_id` and `action` (lines 59-60). The writer is
`apps/backend/src/middleware/audit.ts`: it performs an **INSERT only** — there is no
update or delete path in the writer — and deliberately **swallows write failures**
(logs and continues) so that an audit write can never break the request it describes
(lines 15-25). The `ON DELETE SET NULL` on `user_id` preserves the audit row when a user
is removed, keeping history intact.

### 2.2 What it captures today (honest current state)

Grep of the call sites shows the backend `audit_log` is currently written for
**authentication events only**:

| Event | `action` | Source |
|---|---|---|
| OAuth register/login | `auth.oauth.register` / `auth.oauth.login` | `apps/backend/src/auth/router.ts:133` |
| Email register | `auth.email.register` | `apps/backend/src/auth/router.ts:177` |
| Email login | `auth.email.login` | `apps/backend/src/auth/router.ts:191` |
| Logout | `auth.logout` (records only a 12-char token-hash prefix) | `apps/backend/src/auth/router.ts:208` |

**This is the honest gap.** For a financial deployment the reviewer will expect the
`audit_log` to also capture: membership and role changes, permission grant/revoke,
billing/checkout and subscription changes, backup restore/delete, migration and recovery
runs, and connector authorization. The **schema and writer already support these** (the
`action`/`detail` shape is generic); wiring those call sites is a bounded configuration
task, not a schema change. A reviewer should treat "extend `audit()` coverage to the
financial-relevant mutations above" as a pre-production requirement.

### 2.3 The desktop-side IPC audit

Independently, the secure bridge writes a structured per-call audit line to
`userData/logs/audit.log` for any handler def marked `audit: true`
(`apps/desktop/src/main/ipc/secureBridge.ts:53-60, 129-142`). Each line records the
channel, success/failure, duration, and error message, timestamped in ISO-8601. This is
fire-and-forget and never blocks the IPC response. It is a local operational trail, not
a centralized tamper-evident store — a finance deployment should ship these lines to the
organization's SIEM.

### 2.4 Segregation-of-duties evidence via RBAC

Because every privileged action is gated by a named permission (§1.2), the pairing of
the RBAC classification map (`runtimeAuthz.ts`) with the audit trail gives a reviewer the
two halves of an SoD evidence chain: *who was authorized to do what* (the permission
map + role assignment) and *who did what* (the audit records). Closing §2.2 is what makes
that chain complete for financial mutations.

---

## 3. Security

### 3.1 Verified, tested controls

| Control | Implementation | Real basis |
|---|---|---|
| OAuth PKCE / RFC 8252, backend-brokered | No provider secrets on the client | `apps/backend/src/auth/pkce.ts`, `apps/backend/src/auth/router.ts` |
| Password hashing **Argon2id** (m=19456 KiB, t=2, p=1) | Deliberately CPU-bound | `apps/backend/src/auth/passwords.ts:4` |
| Refresh-token **rotation + reuse detection** | Reuse of a rotated token is detected | `apps/backend/src/auth/session.ts` |
| Server stores **SHA-256 hashes only** of refresh tokens | No plaintext token at rest server-side | `apps/backend/src/auth/tokens.ts` |
| Refresh tokens **encrypted at rest via Keychain** (`safeStorage`) | OS-backed at-rest protection on the desktop | `apps/desktop/src/main/security/secureStore.ts`, `connectors/connectorVault.ts` |
| **SSRF guard** on outbound webhooks | Blocks internal-target exfiltration | `apps/desktop/src/main/webhooks/webhookStore.ts` (tested) |
| **Ed25519** supply-chain signing | Manifest/package signature verification | `apps/desktop/src/main/nps/signature.ts`, `federation/exchange/signing.ts` |
| Fail-closed RBAC IPC gate | See §1.2 | `apps/desktop/src/main/ipc/secureBridge.ts` |
| `SEED_STORE_ON_BOOT=false` in prod | No fabricated catalog/demo data ships | prod configs (verified in `ENTERPRISE-GA-REPORT.md` §5, PR-8) |

Measured auth cost (grounding): Argon2id **hash p50 19.7 ms, verify p50 19.6 ms** — this
deliberately bounds authentication throughput and is a feature, not a bottleneck, for a
finance threat model.

### 3.2 Open items and their financial risk framing

These are the honest, source-tracked open items from the GA gap catalog. A financial
reviewer must treat the two HIGH items as pre-production blockers.

| Item | Location | Severity | Financial risk framing | Mitigation in place |
|---|---|---|---|---|
| Apple `id_token` decoded, **not JWKS-verified** | `apps/backend/src/auth/providers/apple.ts:14-16,77` (`jwt.decode`, not `jwt.verify`) | **HIGH** | Identity-spoof vector on the Apple sign-in path — unacceptable for privileged financial access if that IdP is enabled | Flow is backend-brokered and requires a crafted token; **recommended control: disable Apple sign-in until JWKS verification lands**, or restrict it to non-privileged roles |
| Marketplace **app** install accepts **unsigned** packages when the trust store is empty | `apps/desktop/src/main/nps/packageService.ts:184` (signature enforced only when `artifact.signature` is present) | **HIGH** | Supply-chain: an unsigned package could execute in-tenant | Integrity SHA-256 is *always* checked (line 179-182); worker-package path is fail-closed; **recommended control: provision a non-empty publisher trust store and disable third-party app install** in finance builds |
| Rate limiter **fails open** when Redis is down | `apps/backend/src/middleware/rateLimit.ts:37` | **MEDIUM** | Brute-force/abuse window during a Redis outage | Deliberate availability choice; auth is still required. **Recommended control: alert on limiter fail-open** (there is no alert routing yet — see §7) |

Neither HIGH item is a core-correctness failure; both are finishing controls with an
existing seam (`apple.ts` carries the `HARDENING TODO`; the signature check exists and
merely needs to be made unconditional). A finance deployment should gate go-live on both.

---

## 4. Compliance mapping (self-assessment only)

> **This section is a control mapping to guide the customer's own audit. It is NOT a
> certification, NOT an attestation, and claims NO financial compliance of any kind.**
> NeuroPause has not been assessed by a third-party auditor. No SOC 2 report, no PCI-DSS
> Attestation of Compliance, and no ISO certificate is asserted or implied. The tables
> below map *real, tested platform controls* to framework requirement areas so that a
> customer's own auditor can scope their assessment — the responsibility for
> certification, and for the surrounding organizational controls the platform cannot
> provide, remains entirely with the customer.

### 4.1 SOC 2 Trust Services Criteria — control mapping

| TSC area | Relevant NeuroPause control (real) | Evidence | Reviewer note |
|---|---|---|---|
| CC6.1 Logical access — authentication | PKCE/RFC 8252; Argon2id; refresh rotation + reuse detection | `auth/pkce.ts`, `auth/passwords.ts:4`, `auth/session.ts` | Apple JWKS gap (§3.2) is in-scope |
| CC6.1 Logical access — authorization | Fail-closed RBAC IPC gate + classification invariant | `ipc/secureBridge.ts:101-106`, `ipc/runtimeAuthz.ts:347-355` | Strong; least-privilege by design |
| CC6.6 Boundary protection | Context isolation, sandbox, strict CSP, allow-listed Zod IPC; SSRF guard | `apps/desktop/src/main/*`, `webhooks/webhookStore.ts` | Tested |
| CC6.7 Data in transit / at rest | Keychain (`safeStorage`) at rest; SHA-256-only token storage server-side | `security/secureStore.ts`, `auth/tokens.ts` | TLS termination is a deployment responsibility |
| CC7.2 Monitoring | Prometheus `/metrics`, `/health`, `/live`; structured logs w/ redaction | `apps/backend` `/metrics` | **No alerting/tracing yet** (honest gap, §7) |
| CC7.x Change management — integrity | Ed25519 supply-chain signing; forward-only idempotent migrations | `nps/signature.ts`; migrations PASS (§5) | Marketplace unsigned-install gap (§3.2) in-scope |
| CC8.1 Audit logging | Append-only `audit_log` | `db/migrations/0001_init.sql:50-60`, `middleware/audit.ts` | **Coverage currently auth-only (§2.2)** |
| A1.1–A1.2 Availability | Backup/restore, DB-down auto-recovery, restart 0.46 s, Redis fail-open | `bench/results/reliability.json` (§5) | Proven |
| C1.x Confidentiality | RBAC scoping; secret redaction in logs; no fabricated data (`SEED_STORE_ON_BOOT=false`) | as above | — |
| PI1.x Processing integrity | Zod validation on every IPC/API payload; typed shared contracts | `ipc/secureBridge.ts:107-111` | 3,856 tests green |

### 4.2 PCI-DSS-relevant control areas — supporting mapping only

NeuroPause is **not a CDE** and stores no PAN; billing is delegated to a provider
(`apps/backend/src/db/migrations/0008_billing_provider.sql`). The following maps only the
*supporting* control areas that would apply if the platform is operated adjacent to a
regulated environment. **This is not a PCI assessment and claims no PCI scope.**

| PCI-DSS area | Supporting NeuroPause control | Evidence |
|---|---|---|
| Req 6 — Secure software | Signed supply chain (Ed25519), 0 production npm-audit vulns, idempotent migrations | `nps/signature.ts`; grounding quality gates |
| Req 7 — Restrict access by need-to-know | Least-privilege RBAC scopes + fail-closed gate | `enterprise.ts:72`, `secureBridge.ts:101-106` |
| Req 8 — Identify & authenticate | Argon2id, PKCE, refresh rotation + reuse detection | `auth/passwords.ts:4`, `auth/session.ts` |
| Req 10 — Log & monitor | Append-only `audit_log` (+ desktop IPC audit), `/metrics` | `db/migrations/0001_init.sql:50-60` — *coverage gap §2.2 applies* |
| Req 10 — Time-stamped records | `created_at TIMESTAMPTZ DEFAULT now()` on every audit row | `0001_init.sql:56` |

Explicit non-claims: NeuroPause does not implement network segmentation, key-management
lifecycle, or the organizational/physical controls PCI requires — those are the
customer's environment, outside the platform's boundary.

---

## 5. Business continuity

Grounded entirely in the reliability results executed for this program
(`bench/results/reliability.json`; summarized in `docs/validation/_grounding.md`).

| Scenario | Result | Proven evidence |
|---|---|---|
| Backup → restore | **PASS** | `pg_dump -Fc` (136 KB) → fresh DB → `pg_restore`; row counts match exactly (applications 20, versions 40, categories 14) |
| Backend restart recovery | **PASS** | SIGTERM → down → restart → healthy in **0.46 s** |
| DB-down degradation + auto-recovery | **PASS** | Postgres stopped → process survived; `/health` `degraded/database:down`; DB reads → clean 500; on PG restart the pool **auto-reconnected without a backend restart** |
| Redis-down fail-open | **PASS** | Redis stopped → `/store/apps` served 200×5; `/health` `degraded/redis:down`; no crash |
| Migration idempotency | **PASS** | 12 forward-only migrations; re-run applied 0 new |
| Offline/air-gapped bundle | **PARTIAL** | `scripts/build-offline-bundle.sh` shellcheck-CLEAN + documented procedure; full `docker save/load` needs a Docker daemon (not exercised here) |

### 5.1 Recommended RTO / RPO

These are **recommendations tied to the proven `pg_dump`/`pg_restore` path**, not
guarantees; actual figures depend on data volume and the customer's snapshot cadence.

| Objective | Recommended target | Basis |
|---|---|---|
| **RPO** | ≤ the backup interval (e.g. ≤ 15 min with 15-min `pg_dump -Fc` snapshots or continuous WAL archiving) | Restore fidelity proven exact at reference scale |
| **RTO (backend process)** | seconds — restart proven at **0.46 s**; pool auto-recovers on DB return without a restart | reliability PASS rows |
| **RTO (full data restore)** | dominated by `pg_restore` time for the customer's data size; validate at target volume | restore path proven, size-dependent |

### 5.2 Honest DR caveats

- **Update rollback is advisory.** The real, proven recovery path is **data-side restore**
  (`pg_dump`/`pg_restore` above), not an automated application-version rollback. Promoting
  update rollback from advisory to automated is a named GA task (`ENTERPRISE-GA-REPORT.md`
  TD-5).
- **Federation DR is modeled, not live.** `docs/federation/disaster-recovery.md` describes
  cross-org DR at the design/surface level; it is **not exercised against live
  infrastructure** here. Do not represent federation DR as tested.
- **Air-gapped bundle is PARTIAL** (above): the script is validated; the full offline
  image round-trip was not run in this environment.

---

## 6. Validation protocol (reproducible)

A financial-controls reviewer can regenerate every performance and reliability claim.
All harnesses are real, dependency-light, and land JSON artifacts under `bench/results/`.

### 6.1 Performance harnesses

| Harness | Command | What it proves |
|---|---|---|
| HTTP load | `node bench/http-load.mjs --base http://127.0.0.1:4000 --conc 32 --reqs 3000 --json bench/results/http-load.json` | Real route latency/throughput; **24,000 requests, 0 errors** at reference |
| DB latency | `DATABASE_URL=... node bench/db-latency.mjs --iters 2000 --json bench/results/db-latency.json` | Direct pg round-trip: point read p50 **0.23 ms** / p95 **0.46 ms** |
| Engine bench | `apps/desktop/src/main/__bench__/performance.test.ts` | Intelligence engines over 5000 entities within 2000 ms budget |

Reference HTTP results to re-verify (do not alter): `/health` 1221 rps p50 22 ms;
`/live` 2103 rps p50 11 ms; `/metrics` 1789 rps p50 16 ms; `/store/apps` (20-row DB list)
610 rps p50 52 ms p99 80 ms; `/store/apps/:slug` point read 424 rps p50 72 ms p99 118 ms.
Backend cold start → healthy **0.66 s**; RSS 117 MB idle → 213 MB under the 24k-request
load; pg pool auto-scaled 1 → 10.

### 6.2 Reliability procedures to re-run

1. **Backup/restore fidelity:** `pg_dump -Fc` the running DB → restore into a fresh DB →
   compare row counts. Expect exact match.
2. **Restart recovery:** send SIGTERM, restart, poll `/health` until `ok`; expect ~sub-second.
3. **DB-down:** stop Postgres → confirm `/health` `degraded/database:down` and clean 500s
   on DB reads → restart Postgres → confirm pool auto-reconnects with no backend restart.
4. **Redis-down:** stop Redis → confirm `/store/apps` still serves 200 and `/health`
   reports `degraded/redis:down`.
5. **Migration idempotency:** re-run migrations; expect 0 newly applied.

### 6.3 Telemetry to collect as evidence

- `GET /metrics` (Prometheus): `neuropause_backend_up`, `neuropause_backend_uptime_seconds`,
  `neuropause_http_requests_total{method,status}`, `neuropause_pg_pool_connections{state}`.
- `GET /health` → `{status, components:{database, redis}, uptime}`; `GET /live` liveness.
- Backend `audit_log` table (query the auth events of §2.2; verify coverage extension
  before go-live).
- Desktop IPC audit at `userData/logs/audit.log` (ship to SIEM).

### 6.4 Quality-gate evidence (grounding)

Re-runnable via the repo toolchain: typecheck **0 errors**, lint **0 warnings**,
**3,856 tests pass**, build exit **0**, **0 production npm-audit vulnerabilities**. K8s
manifests pass kubernetes-validate strict.

---

## 7. Honest limitations and remaining risks

A financial-controls reviewer should weigh the following before any production decision.
None is hidden; all are sourced.

1. **Classification is Release Candidate, not GA.** `1.0.0-rc.1`. Two HIGH security
   finishes remain (below). Do not represent this build as GA.
2. **Apple `id_token` is not JWKS-verified** (`auth/providers/apple.ts:14-16,77`, HIGH).
   Treat as a pre-production blocker; disable or role-restrict Apple sign-in until fixed.
3. **Marketplace app install accepts unsigned packages with an empty trust store**
   (`nps/packageService.ts:184`, HIGH). Provision a publisher trust store and disable
   third-party app install for finance builds until enforcement is unconditional.
4. **Audit coverage is currently auth-only** (`middleware/audit.ts` call sites). The
   schema supports financial mutations (billing, role/permission change, backup/restore),
   but those call sites are not yet wired. Extending them is a pre-production requirement
   for a complete SoD/audit evidence chain.
5. **Rate limiter fails open on Redis outage** (`middleware/rateLimit.ts:37`, MEDIUM),
   and there is **no alert routing, tracing, or capacity forecasting yet**
   (`ENTERPRISE-GA-REPORT.md` TD-6). Day-2 monitoring must be added and the fail-open made
   alertable.
6. **Update rollback is advisory; the real recovery path is data-side restore.**
   Federation DR is **modeled, not live**. The offline bundle is **PARTIAL**. Do not
   represent any of these as tested beyond what §5 states.
7. **No macOS/desktop release CI; desktop tests not gated per PR** (TD-4). Release
   integrity for the desktop client depends on manual process today.
8. **All numbers are reference-environment measurements** on a co-located 2-vCPU host —
   conservative, but not the customer's hardware. Re-run §6 on target infrastructure
   before relying on any figure.
9. **Compliance content is a self-assessment mapping only (§4).** No third-party audit,
   SOC 2 report, PCI AoC, or ISO certificate exists or is claimed. NeuroPause is not a
   CDE and stores no PAN. Certification remains the customer's responsibility.
