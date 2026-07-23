# NeuroPause Enterprise — Customer Success Framework (GEAP)

> **Program:** Global Ecosystem & Adoption Program (GEAP) — adoption enablement, not
> engineering. This document adds **no runtime, no architecture, no platform**; it
> assembles the **existing** guides, validation evidence, and code surfaces into an
> actionable Customer Success practice.
>
> **Platform maturity anchor:** **Validated Release Candidate** (`1.0.0-rc.1`,
> `ENTERPRISE-VALIDATION-REPORT.md`) — the backend is production-validated under load
> and fault injection on a reference environment, **not** GA and **not** "proven in
> production at scale." Every success motion here must respect that honesty.
>
> **Anti-fabrication:** no named customers (personas/segments only), no invented
> health scores, revenue, renewal rates, or seat counts. Where this framework needs a
> number, it defines a **method** the customer populates from their own telemetry.
>
> **Fills:** the four `Gap`/`Partial` rows of the Customer Success Matrix
> (`ADOPTION-MATRICES.md` §4): onboarding methodology, adopt/expand maturity model,
> health-scoring framework, support model + escalation + renewal framework.

---

## How to use this framework

Each lifecycle stage builds on a **real** asset — never duplicates it.

| Lifecycle stage    | This section | Built on (real asset)                                                       |
| ------------------ | ------------ | --------------------------------------------------------------------------- |
| Evaluate           | §2           | `ENTERPRISE-VALIDATION-REPORT.md`, `docs/validation/`, `SECURITY-GUIDE.md`  |
| Onboard            | §1           | `INSTALLATION.md`, `QUICK-START.md`, `DEPLOYMENT.md`, `deploy/README.md`    |
| Implement          | §2           | deployment kits (`deploy/*`), vertical packs (`docs/validation/verticals/`) |
| Migrate            | §4           | forward-only migrator, `BackupManager`, `backup-db.sh`/`restore-db.sh`      |
| Adopt / expand     | §5           | feature docs, `ADMINISTRATOR-GUIDE.md`, `OPERATIONS-GUIDE.md`               |
| Measure health     | §6           | `/metrics`, `/health`, `audit_log`, NeuroCore snapshot                      |
| Renew              | §7           | subscription tiers `free/starter/professional/enterprise` (billing code)    |
| Escalate / support | §8–§9        | `OPERATIONS-GUIDE.md`, `DISASTER-RECOVERY-GUIDE.md`, root `SECURITY.md`     |

---

## 1. Customer Onboarding

Onboarding runs on two independent planes (`OPERATIONS-GUIDE.md`): the **desktop
client** (local-first Electron app) and the **optional backend** (Express + Postgres

- Redis). A pilot can begin with the desktop alone; catalog/backend features are
  added when the customer is ready.

### 1.1 Prerequisites (verify before kickoff)

| Plane         | Prerequisite                                                                               | Source                                 |
| ------------- | ------------------------------------------------------------------------------------------ | -------------------------------------- |
| Desktop       | Apple Silicon (M1+), macOS 12+, ~300 MB free                                               | `INSTALLATION.md`                      |
| Desktop       | Signed & notarized DMG from pilot contact (reject "unidentified developer" builds)         | `INSTALLATION.md`                      |
| Desktop       | Identity: Google / GitHub / Microsoft / Apple / email sign-in                              | `QUICK-START.md`                       |
| Backend       | Docker Engine + Compose v2; ~1 GB RAM for the stack                                        | `DEPLOYMENT.md`                        |
| Backend       | `.env`: `POSTGRES_PASSWORD`, `JWT_ACCESS_SECRET` (≥32 chars, `openssl rand -hex 32`)       | `DEPLOYMENT.md`                        |
| Backend       | OAuth (`GOOGLE_*`/`GITHUB_*`/`MICROSOFT_*`/`APPLE_*`) optional — blank disables a provider | `DEPLOYMENT.md`                        |
| Backend       | Billing (`RAZORPAY_*`) optional — stays disabled until key id + secret set                 | `DEPLOYMENT.md`                        |
| Backend (dev) | Node ≥ 20.11 (`.nvmrc` pins 20.11.0), `npm@10`                                             | `DEPLOYMENT-PLAYBOOKS.md` (Playbook A) |
| Org           | Cloud tenancy owner/admin identified (only they invite members)                            | `ADMINISTRATOR-GUIDE.md` §2            |

### 1.2 Phased onboarding checklist

**Phase 0 — Evaluate (pre-contract).**

- [ ] Review `ENTERPRISE-VALIDATION-REPORT.md` §2 matrix and §9 known limitations.
- [ ] Review `SECURITY-GUIDE.md` posture and the 2 HIGH open items (Apple JWKS, unsigned marketplace install).
- [ ] Select the matching vertical pack from `docs/validation/verticals/` as the evaluation protocol.

**Phase 1 — Provision.**

- [ ] Backend: `cp .env.example .env`, set required secrets, `docker compose -f docker-compose.prod.yml config` (validates) then `up -d --build` (`DEPLOYMENT.md`).
- [ ] Confirm `GET /live` = alive and `GET /health` = 200 (`components.database`/`.redis` up) (`OPERATIONS-GUIDE.md`).
- [ ] Desktop: install signed DMG, first launch initializes local store + stamps data version (`INSTALLATION.md`).
- [ ] Establish the Enterprise-OS org chart, built-in roles, and workspace Owner (`ADMINISTRATOR-GUIDE.md` §3, §5).

**Phase 2 — First value.**

- [ ] Sign in; connect the tools the user actually uses via **Connectors** (official OAuth only) (`QUICK-START.md` §3).
- [ ] Let AI Memory build a timeline/graph from a day or two of authorized activity (on-device, deterministic) (`QUICK-START.md` §4).
- [ ] Run one **AI Workforce** proposal end-to-end through the Human Approval Center (`QUICK-START.md` §5).

**Phase 3 — Operate-ready.**

- [ ] Open **Operations → Recovery** once; create a manual backup and exercise **restore** on a test profile (`QUICK-START.md` §6, `DISASTER-RECOVERY-GUIDE.md` §3.1).
- [ ] Generate a redacted **support bundle** from **Operations → Release** so the support path is proven (`OPERATIONS-GUIDE.md`).
- [ ] Configure identity policy (SSO/SCIM/MFA config surfaces) — treat SSO assertion validation as **modeled**, not a live IdP authority yet (`ADMINISTRATOR-GUIDE.md` §6.2).
- [ ] Point Prometheus at backend `/metrics`; add a `/health` probe (no native alerting ships — §6.3).

---

## 2. Implementation Methodology — Evaluate → Onboard → Implement → Adopt

A four-stage motion, each stage tied to real deployment kits and a defined exit gate.

| Stage         | Objective                         | Real kit / asset                                                                                          | Exit criteria                                                    |
| ------------- | --------------------------------- | --------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| **Evaluate**  | Prove fit against honest evidence | `ENTERPRISE-VALIDATION-REPORT.md`, `bench/results/*.json`, `docs/validation/verticals/*`                  | Vertical protocol run; §9 limitations accepted in writing        |
| **Onboard**   | Stand up a working pilot          | `INSTALLATION.md`, `QUICK-START.md`, `DEPLOYMENT-PLAYBOOKS.md` (Playbook A)                               | `/health` 200; first workforce approval completed                |
| **Implement** | Production-shape the deployment   | `DEPLOYMENT.md`, `deploy/README.md`, `deploy/kubernetes/*`, `deploy/helm/*`, `REFERENCE-ARCHITECTURES.md` | Chosen topology deployed; migrate-Job pattern; backups scheduled |
| **Adopt**     | Expand usage + operationalize     | `ADMINISTRATOR-GUIDE.md`, `OPERATIONS-GUIDE.md`, `OPERATIONAL-RUNBOOKS.md`, §5 maturity model             | Health scoring live (§6); renewal motion active (§7)             |

**Deployment topologies** (pick one at Implement; all are real assets in `deploy/`):
single-host Compose (`docker-compose.prod.yml`), Kubernetes raw
(`deploy/kubernetes/backend.yaml`, strict `kubernetes-validate` PASS), Helm
(`deploy/helm/neuropause-backend/`), or air-gapped bundle
(`scripts/build-offline-bundle.sh`). Topology detail lives in
`REFERENCE-ARCHITECTURES.md` — reference it, do not re-derive it.

**Vertical implementation packs** — each is a **reference deployment + validation
protocol + compliance self-mapping**, never a customer record and never a
certification (`ENTERPRISE-VALIDATION-REPORT.md` §7):

| Segment       | Pack                         | What the pack anchors                                                        |
| ------------- | ---------------------------- | ---------------------------------------------------------------------------- |
| Manufacturing | `verticals/MANUFACTURING.md` | On-prem/air-gapped near plant; recommended SLOs; PLC integration **modeled** |
| Healthcare    | `verticals/HEALTHCARE.md`    | HIPAA/SOC 2 **self-assessment mapping** (not a certification)                |
| Agriculture   | `verticals/AGRICULTURE.md`   | Offline-first + automation validation; sensor model                          |
| Financial     | `verticals/FINANCIAL.md`     | Governance/audit + SOC 2 / PCI **self-mapping**                              |
| Government    | `verticals/GOVERNMENT.md`    | Air-gapped + NIST 800-53 **self-mapping** (no ATO)                           |

---

## 3. Success Playbooks (per persona / segment)

No named customers — success is defined per **persona** and **segment overlay**.

### 3.1 Persona playbooks

| Persona                         | Primary goal                              | First-value milestone                              | Key assets                                                        | Success signal (measured, §6)                           |
| ------------------------------- | ----------------------------------------- | -------------------------------------------------- | ----------------------------------------------------------------- | ------------------------------------------------------- |
| **Executive Sponsor / Buyer**   | Justify the investment on honest evidence | Signed acceptance of validated-RC status + §9 gaps | `ENTERPRISE-VALIDATION-REPORT.md`, vertical pack                  | Adoption stage advances (§5); renewal engaged (§7)      |
| **Platform Operator / SRE**     | Reliable day-2 backend                    | `/health` green under real traffic                 | `DEPLOYMENT.md`, `OPERATIONS-GUIDE.md`, `OPERATIONAL-RUNBOOKS.md` | Error-ratio + pool-saturation alerts live on `/metrics` |
| **Enterprise Administrator**    | Governed org, RBAC, identity              | Custom role created + MFA policy set               | `ADMINISTRATOR-GUIDE.md` §5–§7                                    | Audit trail populating on privileged actions            |
| **End User / Knowledge Worker** | Daily productivity                        | One workforce proposal approved end-to-end         | `QUICK-START.md`                                                  | Recurring weekly active sessions                        |
| **Developer / Integrator**      | Extend via SDK/CLI/connectors             | First connector authorized + first API call        | SDK/CLI (see `DEVELOPER-ECOSYSTEM.md`)                            | Connector health `production` (real adapter)            |

### 3.2 Segment overlays

| Segment                                                 | Deployment path                  | Vertical pack                       | Watch-items to manage proactively                                                        |
| ------------------------------------------------------- | -------------------------------- | ----------------------------------- | ---------------------------------------------------------------------------------------- |
| **Regulated / air-gapped** (Gov, Healthcare, Financial) | Air-gapped bundle or private K8s | GOVERNMENT / HEALTHCARE / FINANCIAL | Compliance scorecards are **self-mapping, not certification**; SSO assertion **modeled** |
| **Operational / edge** (Manufacturing, Agriculture)     | On-prem Compose or K8s near site | MANUFACTURING / AGRICULTURE         | Device/PLC/IoT integrations are **modeled**, not wired to live equipment                 |
| **Cloud-SaaS mid-market**                               | Managed K8s/Helm, cloud tenancy  | closest-fit pack                    | Managed Postgres w/ PITR + off-host backups (single-host is default gap)                 |

---

## 4. Migration Guides

NeuroPause migrations are **forward-only** and backed by **proven backup/restore**
(`ENTERPRISE-VALIDATION-REPORT.md` items 8–9: 12 migrations applied, re-run applies
0; pg_dump→restore with exact row match). Nothing here invents a downgrade path — the
app has none (`DISASTER-RECOVERY-GUIDE.md` §5.1).

### 4.1 Backend schema migration runbook

- [ ] Migrations are **transactional, forward-only**, applied once in filename order (`0001_init.sql` … `0012_embedding_state.sql`), recorded in `schema_migrations`; a failure triggers `ROLLBACK` and re-raise (`DISASTER-RECOVERY-GUIDE.md` §4.2).
- [ ] For multi-replica/production, set `RUN_MIGRATIONS_ON_BOOT=false` and run migrations as a **gated Job** _before_ pods serve — `deploy/helm/neuropause-backend/templates/migrate-job.yaml` or `deploy/kubernetes/backend.yaml`. A failed Job **blocks the rollout** instead of serving a bad schema.
- [ ] Take a fresh `scripts/backup-db.sh` dump **immediately before** applying.
- [ ] Verify post-migration `GET /health` = 200 and re-run migrator to confirm idempotency (applies 0).

### 4.2 Desktop data migration

- [ ] The desktop migration engine takes a **pre-migration backup** and **auto-restores on failure**, reverting the data version (`DISASTER-RECOVERY-GUIDE.md` §4.1).
- [ ] Drive from `MigrationStatus` / `MigrationRun` IPC; use the **`dryRun`** plan to preview pending steps.
- [ ] **Honest note:** only the no-op baseline (`0001-baseline`, `CURRENT_DATA_VERSION = 1`) is registered today — the recovery machinery is implemented and unit-tested, **not yet exercised by a real cross-version migration**.

### 4.3 Backup & restore drill (do before, and periodically after, any migration)

| Plane            | Backup                                                             | Restore                                                                                              | Retention                                            |
| ---------------- | ------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| Backend Postgres | `scripts/backup-db.sh` (gzip `pg_dump`)                            | `scripts/restore-db.sh <dump>` (destructive `--clean --if-exists`, prompts `yes`, `ON_ERROR_STOP=1`) | keeps 14; **no scheduler ships** — wire cron/systemd |
| Desktop stores   | `BackupManager` sha256 snapshot (auto every 24h, manual on demand) | Recovery Center → Restore Backup (validates hashes; takes a **safety snapshot** first)               | keeps 10 scheduled                                   |

**Honest migration/DR gaps to set expectations on** (`DISASTER-RECOVERY-GUIDE.md`
§6–§7): whole-dump only (**no PITR**); backups are **single-host by default**
(co-located with data); Federation multi-region DR is **modeled**, not real infra. A
backup you have never restored is a hypothesis — drill it into a scratch environment.

---

## 5. Adoption Roadmap / Maturity Model (Crawl → Walk → Run)

A maturity ladder the customer advances through; each rung cites what makes it real.

| Dimension                 | Crawl                                       | Walk                                                            | Run                                                                             |
| ------------------------- | ------------------------------------------- | --------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| **Deployment**            | Single-host Compose pilot (`DEPLOYMENT.md`) | K8s/Helm, migrate-Job gated (`deploy/*`)                        | HA managed Postgres + PITR + off-host backups (`DISASTER-RECOVERY-GUIDE.md` §8) |
| **Identity & governance** | Built-in roles, workspace Owner             | Custom roles, MFA policy, SSO config (`ADMINISTRATOR-GUIDE.md`) | SSO **signature verification** implemented behind the modeled seam              |
| **Observability**         | Manual `/health` checks                     | Prometheus scrape of `/metrics` + `/health` probe               | Alertmanager routing + OTel Collector (external — §6.3)                         |
| **Resilience**            | Manual desktop backups                      | Scheduled backend dumps + restore drills                        | Tested failover, off-host versioned storage                                     |
| **Usage**                 | 1 pilot workflow approved                   | Multiple personas active                                        | Vertical protocol → executed pilot                                              |
| **Health management**     | Read snapshots ad hoc                       | Health scoring method live (§6)                                 | Trend-driven, proactive success reviews                                         |

**Stage-exit gates.** _Crawl→Walk:_ `/health` green under real traffic; backups
scheduled; ≥1 custom role. _Walk→Run:_ migrations run as gated Jobs; Prometheus
alerting on shipped series; restore drilled in a scratch env. Every rung stays inside
the honest maturity envelope — the platform is a **Validated RC**, so "Run" targets
production-grade _deployment practice_, not a claim of "Enterprise Proven."

---

## 6. Health Scoring Framework (a method — no fabricated scores)

This defines **how to compute** a customer health score from **real** signals. It
publishes **no example score** — every value is populated from the customer's own
telemetry. The method mirrors two conventions already in the codebase: the EVP's
evidence-tier scoring with a simple-mean composite (`ENTERPRISE-VALIDATION-REPORT.md`
§8) and the admin compliance scorecard's pass=100 / warn=60 / fail=0 banding
(`ADMINISTRATOR-GUIDE.md` §7.5).

### 6.1 Inputs (real telemetry only)

| Health dimension            | Real source                              | Signal                                                                                        |
| --------------------------- | ---------------------------------------- | --------------------------------------------------------------------------------------------- |
| Backend availability        | `GET /health` (`app.ts:88`)              | `status: ok\|degraded`; `components.database`/`.redis`                                        |
| Backend liveness/throughput | `GET /metrics`                           | `neuropause_backend_up`, `neuropause_http_requests_total{method,status}`                      |
| Resource pressure           | `GET /metrics`                           | `neuropause_backend_resident_memory_bytes`, `neuropause_pg_pool_connections{state="waiting"}` |
| Desktop health              | NeuroCore `neurocore:systemHealth` IPC   | `SystemHealthSnapshot` scored level; `neuropause_health_score`                                |
| Diagnostics                 | `diagnostics:get` IPC                    | `report().overall` = worst-of-checks                                                          |
| Governance activity         | `audit_log` table (append-only)          | privileged-action entries present/absent                                                      |
| Trend                       | `HealthHistoryStore` (`MAX_POINTS = 90`) | `windowStats()` moving avg/high/low/stddev; `valueAround()` WoW                               |
| Adoption                    | §5 stage + persona milestones (§3.1)     | stage attained; personas active                                                               |

> **Deliberately excluded (do not fabricate):** there is **no latency histogram** on
> `/metrics` (counts by method+status only), **no native alerting**, and **no capacity
> forecast** (`OPERATIONS-GUIDE.md` gaps 1–3). Do not synthesize an SLO the platform
> cannot emit.

### 6.2 Scoring method

1. **Band each input** to {100 healthy, 60 at-risk, 0 failing} using the customer's
   thresholds (e.g. `/health`=ok→100, degraded→0; pool `waiting`>0 sustained→60).
2. **Weight** dimensions (customer-set; default = equal, matching the EVP simple-mean
   convention). Availability and governance should carry the most weight for regulated
   segments.
3. **Composite** = weighted mean of banded inputs → a single 0–100 health index
   **per customer, per period**. Publish the _method and the weights_, never a number
   as a benchmark.
4. **Segment the roster** by index band (Healthy / Watch / At-Risk) to prioritize
   success motions — bands are operational triggers, not scores to advertise.

### 6.3 Operationalizing (external, because no native alerting ships)

Scrape backend `/metrics` with **Prometheus**; run **Alertmanager** for routing
(`OPERATIONS-GUIDE.md` gap 1). Seed alert rules on shipped series:
`neuropause_backend_up == 0`; 5xx error-ratio from
`neuropause_http_requests_total{status=~"5.."}`; pool saturation from
`neuropause_pg_pool_connections{state="waiting"}`. Add a blackbox probe on `/health`.
Forecast **externally** (e.g. `predict_linear()`), since the app ships none.

---

## 7. Renewal Framework (grounded in real subscription tiers)

Renewal is framed over the **real** plan tiers in code —
`free / starter / professional / enterprise` (billing `plans.ts`, `schemas.ts`
`z.enum(['trial','starter','professional','enterprise'])`, `RAZORPAY_PLAN_*`). No
revenue, renewal rate, or seat count is asserted; this is a **motion**, not a metric.

| Tier             | Real basis                                   | Renewal focus                                     |
| ---------------- | -------------------------------------------- | ------------------------------------------------- |
| `free` / `trial` | `planTier: 'free'`; trial = future `startAt` | Convert on first-value milestone (§3.1)           |
| `starter`        | `RAZORPAY_PLAN_STARTER`                      | Deepen persona usage; advance Crawl→Walk (§5)     |
| `professional`   | `RAZORPAY_PLAN_PROFESSIONAL`                 | Governance + observability adoption; expand seats |
| `enterprise`     | `RAZORPAY_PLAN_ENTERPRISE`                   | Vertical protocol → pilot; Run-stage practices    |

**Lifecycle signals** (real Razorpay subscription shape, `billing/types.ts`): renewal
window from `currentEnd` (end of billing cycle) and `chargeAt` (next charge); risk
from raw `status` (`active` vs `pending/halted/cancelled/expired`); `endedAt` marks
termination. **Checkout/cancel is real** (Razorpay gateway); billing stays disabled
until `RAZORPAY_*` is configured.

**Renewal motion checklist.**

- [ ] T-90 to cycle `currentEnd`: run a success review using the §6 health index band.
- [ ] Confirm subscription `status = active` and a `chargeAt` is scheduled.
- [ ] Map expansion to a tier step (starter→professional→enterprise) against §5 stage.
- [ ] **Honest guardrail:** seats are **displayed, not enforced** — there is no seat-cap gate (`ADMINISTRATOR-GUIDE.md` §9). Treat seat counts as advisory in expansion talks.

---

## 8. Escalation Workflow (severity → routing → SLA framework)

A framework to adopt in the enterprise agreement — the platform ships **no native
paging/on-call** (`OPERATIONS-GUIDE.md` gap 1), so routing is an operational contract,
not a product feature. Response targets below are a **template to populate**, not a
guarantee NeuroPause currently makes.

| Sev     | Definition (tie to real signals) | Example trigger                                                       | Routing                                                             | Response target (set in agreement)                       |
| ------- | -------------------------------- | --------------------------------------------------------------------- | ------------------------------------------------------------------- | -------------------------------------------------------- |
| **S1**  | Backend down / data-loss risk    | `/health` sustained 503; `neuropause_backend_up == 0`; failed restore | On-call SRE + vendor security if data-integrity                     | Fastest tier                                             |
| **S2**  | Major degradation                | `components.redis` or `.database` degraded; error-ratio spike         | Operator + admin                                                    | Same business day                                        |
| **S3**  | Localized/desktop issue          | Repeated renderer/plugin crashes (crash recommendations)              | Support (support bundle)                                            | Next business day                                        |
| **S4**  | Question / cosmetic              | How-to, doc gap                                                       | Support queue                                                       | Best-effort                                              |
| **Sec** | Suspected vulnerability          | any                                                                   | **Private** report per root `SECURITY.md` — never a public issue/PR | "acknowledge within a few business days" (`SECURITY.md`) |

**Incident flow** (from `OPERATIONS-GUIDE.md`, "Typical incident flow"):
**Detect** (`/health` non-200, NeuroCore level transitions) → **Triage** (`diagnostics:get`,
`neurocore:systemHealth`, backend logs by `x-request-id`) → **Contain** (Safe Mode /
disable plugin via `RecoveryRun`; drain unhealthy replica via readiness probe) →
**Collect** (redacted support bundle, `CrashExport`) → **Recover** (restore backup;
re-run migrations). Security reports follow `SECURITY.md`'s responsible-disclosure path
exclusively.

---

## 9. Enterprise Support Model (framework)

A tiered support **framework** the customer and vendor agree on. NeuroPause publishes
one real commitment today — the security-disclosure acknowledgment in root
`SECURITY.md`; all other targets are a template to negotiate, not achieved SLAs.

| Support tier               | Audience                         | Channels                                                     | Response-target framework                                 |
| -------------------------- | -------------------------------- | ------------------------------------------------------------ | --------------------------------------------------------- |
| **Community / self-serve** | Evaluators, `free`/`starter`     | Docs (`docs/guides/*`, `TROUBLESHOOTING.md`), support bundle | Self-serve; best-effort                                   |
| **Standard**               | `professional`                   | Ticketed support + support bundle                            | Business-hours targets (define per S1–S4, §8)             |
| **Enterprise**             | `enterprise`, regulated segments | Named contact + escalation path (§8)                         | Priority targets + incident reviews (define in agreement) |
| **Security**               | All                              | **Private** disclosure per `SECURITY.md`                     | Acknowledge within a few business days (real, published)  |

**Support inputs that already exist** (route customers to these, don't reinvent):
redacted **support bundle** (`SupportBundleGenerator`, all secrets/PII redacted),
**release diagnostics** (`ReleaseDiagnosticsExport`), **crash export**
(`CrashExport`), and **90-day health history** for trend context.

**Honest open items to carry into every support/renewal conversation**
(`ENTERPRISE-VALIDATION-REPORT.md` §9): Apple `id_token` not JWKS-verified; marketplace
**app** install accepts unsigned packages when the trust store is empty; rate limiter
fails open on Redis outage (pair with an alert on `redis:"down"`); no per-PR
desktop/macOS CI; vertical packs are **protocols/mappings, not executed pilots**;
compliance scorecards are **self-assessment, never a certification**.

---

### Appendix — source map (every claim traces to a real asset)

| Concern                       | Real asset                                                                                 |
| ----------------------------- | ------------------------------------------------------------------------------------------ |
| Install / first value         | `docs/guides/INSTALLATION.md`, `QUICK-START.md`, `TROUBLESHOOTING.md`                      |
| Backend deploy                | `docs/DEPLOYMENT.md`, `deploy/README.md`, `deploy/kubernetes/*`, `deploy/helm/*`           |
| Deploy playbooks / topologies | `docs/validation/DEPLOYMENT-PLAYBOOKS.md`, `REFERENCE-ARCHITECTURES.md`                    |
| Day-2 ops / signals           | `docs/guides/OPERATIONS-GUIDE.md`, `docs/validation/OPERATIONAL-RUNBOOKS.md`               |
| Admin / RBAC / identity       | `docs/guides/ADMINISTRATOR-GUIDE.md`                                                       |
| Migration / backup / restore  | `docs/guides/DISASTER-RECOVERY-GUIDE.md`                                                   |
| Evidence / maturity           | `ENTERPRISE-VALIDATION-REPORT.md`, `bench/results/*.json`                                  |
| Vertical protocols            | `docs/validation/verticals/{MANUFACTURING,HEALTHCARE,AGRICULTURE,FINANCIAL,GOVERNMENT}.md` |
| Subscription tiers            | `apps/backend/src/billing/{plans,schemas,types}.ts`                                        |
| Security disclosure           | root `SECURITY.md`, `docs/guides/SECURITY-GUIDE.md`                                        |
| Matrix this fills             | `docs/adoption/ADOPTION-MATRICES.md` §4                                                    |

_Status honesty: NeuroPause is a **Validated Release Candidate**. This framework
enables adoption of the platform as it truly is — measured, honestly-limited, and
reproducible — and never overstates its maturity._
</content>
</invoke>
