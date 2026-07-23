# NSSP Manual — Assurance Operations

> **Companion to** [`../frameworks/ASSURANCE.md`](../frameworks/ASSURANCE.md).
> This is the *operational* half: the checklists that confirm each assurance
> property still holds, how to **evidence** each control from a running system,
> the degradation signals to watch, and the honest open-items register with live
> status. Everything here is traceable to real files, executed runs, or shipping
> endpoints; nothing asserts a protection the platform lacks.
> **Also see:** [`../../../SECURITY.md`](../../../SECURITY.md) ·
> [`../../guides/SECURITY-GUIDE.md`](../../guides/SECURITY-GUIDE.md) ·
> [`../../../ENTERPRISE-GA-REPORT.md`](../../../ENTERPRISE-GA-REPORT.md) ·
> [`../../validation/RELIABILITY-RESULTS.md`](../../validation/RELIABILITY-RESULTS.md).

**How to use.** Run the relevant checklist before a release, an audit, or after
an incident. Each item names its evidence source so a reviewer can reproduce the
check rather than take it on trust. A failed item is either a regression (fix
before ship) or a known open item (§5) — never something to quietly pass.

---

## 1. Assurance checklists

Legend: **[E]** evidence source · **L#** evidence level of the underlying control.

### 1.1 Security checklist

- [ ] Electron hardening set: `contextIsolation`/`sandbox` on, `nodeIntegration` off, strict CSP — **[E]** `main/window.ts:31-64`, `security/csp.ts:12-49` · L2
- [ ] Preload exposes only guarded `invoke`/`subscribe` on the channel allowlist — **[E]** `preload/index.ts:15-34` · L2
- [ ] Boot invariant green: every invokable channel gated or allow-listed — **[E]** `runtimeCore.ts:1647-1659`; `runtimeAuthz.ts:347-355` · L2
- [ ] RBAC gate active: 57 `EnterprisePermission` scopes, active-members-only — **[E]** `shared/.../enterprise.ts:72-142`; `enterprise/authz.ts:36-86` · L2
- [ ] OAuth PKCE pinned to `S256`; loopback-only redirect — **[E]** `backend/auth/router.ts:54-59,83-85` · L2
- [ ] JWT verify algorithm-pinned `HS256` + iss/aud — **[E]** `backend/auth/jwt.ts:25-33` · L2
- [ ] Refresh rotation + reuse detection revokes chain; tokens SHA-256 hash-only — **[E]** `backend/auth/session.ts:28,50-102` · L2
- [ ] Argon2id params 19456/2/1 — **[E]** `backend/auth/passwords.ts:1-16`; `bench/results/argon2.json` · L3
- [ ] SSRF guard rejects internal/metadata targets, re-checked at dispatch — **[E]** `webhooks/urlGuard.ts:57-89` · L2 (tested)
- [ ] Secrets `safeStorage`-encrypted; refuses plaintext fallback — **[E]** `security/secureStore.ts:37-68` · L2
- [ ] Ed25519 verify pins algorithm + recomputes digest; workers fail-closed — **[E]** `marketplace/pipeline.ts:96-105`; `workforce/install/packaging.ts:56-62` · L2
- [ ] **0 production dependency vulns** — **[E]** `npm audit --omit=dev` (GA §2.3) · L4
- [ ] Open security items acknowledged, not masked (Apple JWKS, unsigned catalog install, rate-limit fail-open) — **[E]** §5 below · L-real

### 1.2 Operational checklist

- [ ] `/health` → `{status:"ok", components:{database:"up", redis:"up"}}` — **[E]** `backend/app.ts:84-96`; `bench/results/startup.json` · L4
- [ ] `/live` responds without touching dependencies — **[E]** `backend/app.ts:84-96` · L2
- [ ] Cold start → healthy within budget (~0.66 s cold / 0.624 s warm) — **[E]** `bench/results/startup.json` · L3
- [ ] Restart recovery sub-second (~0.46 s) — **[E]** `RELIABILITY-RESULTS.md §3` · L4
- [ ] Migrations idempotent: re-run applies **0** new — **[E]** `RELIABILITY-RESULTS.md §1` (12→0) · L4
- [ ] Backup/restore row-exact (`pg_dump`→`pg_restore`) — **[E]** `RELIABILITY-RESULTS.md §2` · L4
- [ ] Redis down → serves through + `/health` reports `redis:"down"` — **[E]** `RELIABILITY-RESULTS.md §4` · L4
- [ ] Postgres down → survives, fail-fast 500, auto-reconnect on return — **[E]** `RELIABILITY-RESULTS.md §5` · L4
- [ ] `/metrics` gauges present (up, uptime, memory, pool, http totals) — **[E]** `observability/metrics.ts`; `metrics-under-load.json` · L3
- [ ] Air-gapped bundle script shellcheck-clean; k8s manifests validate — **[E]** `bench/results/deployment.json` · L4 (bundle exec PARTIAL)

### 1.3 Governance checklist

- [ ] No privileged channel ships unclassified (composition-time throw) — **[E]** `runtimeAuthz.ts:177-190` · L2
- [ ] Permissions resolve only for `active` members; `invited`/`suspended` hold none — **[E]** `enterprise/authz.ts:36-48` · L2
- [ ] `audit_log` present, append-only, indexed on `user_id`/`action` — **[E]** `backend/db/migrations/0001_init.sql` · L2
- [ ] Auth/org/devices/billing/license/sync/semantic routes behind `requireAuth` — **[E]** `backend/app.ts:122-169` · L2
- [ ] Audit failures logged-and-swallowed (never break the request) — **[E]** `backend/middleware/audit.ts:9-26` · L2
- [ ] `/metrics` network-restricted in production (unauth by design) — **[E]** `backend/app.ts:98-103` · deployment control

---

## 2. How to evidence each control

Reproduce the evidence rather than trust the claim. Commands run from the repo root.

| Control | How to evidence | Expected result |
|---|---|---|
| Quality gates | `npm run typecheck && npm run lint && npm run build` | 0 errors / 0 warnings / exit 0 |
| Test suite | `npm run test` | 3,856 tests / 442 files pass |
| Prod dependency posture | `npm audit --omit=dev` | 0 vulnerabilities |
| Argon2id cost | inspect `backend/auth/passwords.ts:1-16`; run argon bench | 19456/2/1; hash ~21 ms (`argon2.json`) |
| Health/degradation | `curl localhost:4000/health` (and with Redis/PG stopped) | `ok`, then `degraded` with the down component |
| Restart recovery | SIGTERM backend → restart → poll `/health` | healthy in ~0.46 s |
| Migration idempotency | `npm run db:migrate` twice | 2nd run: "Migrations complete", 0 applied |
| Backup/restore | `pg_dump -Fc` → fresh DB → `pg_restore`; compare counts | row-for-row identical |
| SSRF guard | unit tests over `urlGuard.classifyWebhookUrl` | internal/metadata URLs rejected |
| Signature verify | unit tests over `verifyManifest`/`verifySignature` | tamper/untrusted-key ⇒ non-verifying |
| RBAC gate | unit tests over `enterprise/authz.ts` + boot invariant | unauthorized scope throws; app boots only fully-classified |
| Deployment validity | `kubernetes-validate` strict; `shellcheck scripts/*` | PASS / CLEAN (`deployment.json`) |

---

## 3. Incident & degradation signals to watch

The system reports its own health honestly (`ASSURANCE.md §7`). Watch these
signals; each row gives the source and the assurance response.

| Signal | Source | Means | Response |
|---|---|---|---|
| `status: "degraded"` | `/health` | One dependency is down | Identify component below; app stays up |
| `components.database: "down"` | `/health` | Postgres unreachable | DB reads 500 fast; pool auto-reconnects on return (no restart) |
| `components.redis: "down"` | `/health` | Redis unreachable | Serves through, **but rate limiting is off** (Open #3) — alert |
| `pg_pool_connections{state="waiting"}` > 0 | `/metrics` | Pool saturation | Investigate load/slow queries |
| `resident_memory_bytes` climbing | `/metrics` | Memory pressure (idle ~117 MB → load ~213 MB) | Compare to `metrics-under-load.json` baseline |
| `http_requests_total{status="5xx"}` rising | `/metrics` | Server-side failures | Correlate with `/health` + logs |
| IPC audit `ok:false` records | `main/ipc/secureBridge.ts:53-60` | Rejected/failed privileged calls | Review channel + actor; possible authz probing |
| Auth events in `audit_log` | `audit_log.action` | Login/rotation/reuse-detection events | Reuse-detection ⇒ session chain revoked (possible token theft) |

> **Note on log integrity:** `audit_log` and the IPC audit trail are append-only
> but **not hash-chained** (Open #5) and have no rotation (Open #6). Treat them as
> tamper-*evident-by-absence-of-controls*: ship to append-only/WORM external
> storage where non-repudiation matters. Do not rely on them alone as forensic
> proof against a writer with store access.

---

## 4. Confidence read-out (quick reference)

From `ASSURANCE.md §3` — the band you may claim, given the evidence in hand.

| Band | From | Claimable statement |
|---|---|---|
| **Demonstrated** | L4 gate/run | "Observed to hold under executed conditions" |
| **Measured** | L3 telemetry/bench | "Holds at the recorded operating point" |
| **Implemented** | L2 source | "Present and runs; not independently validated as a scientific claim" |
| **Modeled** | L1 typed surface | "Designed surface exists; not exercised end-to-end" |
| **Asserted** | L0 framework | "Named concept; no operational claim" |

Reliability, quality, and integrity checks reach **Demonstrated**; security and
governance controls are **Implemented** and carry the residuals in §5.

---

## 5. Open-items register (honest, with status)

Verified in source, disclosed in the Security Guide backlog and the GA report.
**None is presented anywhere as a protection the platform provides.** Severities
are the GA report's, unaltered; status reflects the RC (`1.0.0-rc.1`).

| # | Item | Severity | Status | Next action | Reference |
|---|---|---|---|---|---|
| 1 | Apple `id_token` decoded, not JWKS-verified | **HIGH** | **OPEN — GA blocker** | Verify vs Apple JWKS (ES256/iss/aud) before trusting claims | `apple.ts:77`; TD-1/PR-1; GA §8.1 |
| 2 | Unsigned catalog-app install (empty trust store) | **HIGH** | **OPEN — GA blocker** | Require verified signature / non-empty trust store, matching worker path | `packageService.ts:184`; TD-2/PR-2; GA §8.2 |
| 3 | Rate limiter fails open on Redis loss | **MED** | **OPEN — accepted, make alertable** | Local fallback limiter + alert on `redis:"down"`; consider fail-closed for reset | `rateLimit.ts:37`; TD-3/PR-3 |
| 4 | AI-memory chain uses FNV-1a (non-crypto) | **LOW** | **OPEN — tracked** | Swap to SHA-256 if chain is relied on for tamper-evidence | `memorySync.ts:84`; TD-10 |
| 5 | Audit logs append-only, not hash-chained | **LOW–MED** | **OPEN — tracked** | Per-record hash chain and/or WORM/SIEM shipping | `audit.ts:9-26`; `secureBridge.ts:53-60` |
| 6 | No on-disk audit-log rotation | **LOW** | **OPEN — tracked** | Size/time-based rotation + retention | `secureBridge.ts:49-60`; `logger.ts` |

**Verification note.** The enforced RBAC model is **57** `EnterprisePermission`
scopes (`enterprise.ts:72-142`), with a separate **18** developer `ApiScope`
(`ecosystem.ts`) layered above it — matching the committed ADMINISTRATOR-GUIDE. An
early "~85" reconnaissance figure (a broad grep over all registries) was corrected
to these source-verified counts, which the grounding and matrices now cite.

---

## 6. Sign-off

An assurance review passes when: §1 checklists are green or every red maps to a §5
open item with a status; §2 evidence reproduces; §3 signals are quiet or explained.
Record the commit, the gate outputs, and any degradation observed. Assurance is
proportioned to evidence — sign off on what was reproduced, not on what was hoped.
