# EOSP Grounding — REAL OPS FACTS + ANTI-FABRICATION RULES (authoring anchor)

> Shared source of truth for every Enterprise Operations & Scale Program (EOSP)
> document. EOSP is the **internal operating manual** for running NeuroPause as a
> software business at scale. It is **execution, not architecture, marketing, or
> research.** It **adds no runtime and no platform.** Every process must be
> **executable** (a runbook, cadence, checklist, workflow, or decision rule) and
> **grounded** in a real asset below or a prior program report.

## Hard anti-fabrication rules (non-negotiable)

1. **No fabricated customers, revenue, ARR, pipeline, NPS, CSAT, ticket volumes, or user counts.** KPIs are **definitions + how-to-measure**, never a claimed value. No "we have X customers / $Y MRR / Z% uptime achieved".
2. **No fabricated operational metrics or uptime.** There is **no production fleet**; therefore no achieved availability, MTTR, or incident counts exist. SLIs are **defined**; SLO/error-budget **targets are proposed objectives**, not measurements.
3. **No fabricated certifications.** SOC 2 / ISO 27001 / privacy content is **readiness-mapping and audit-preparation only** — explicitly "not certified; no audit has occurred."
4. **Capacity math uses MEASURED coefficients** (below), which are real; extrapolations to fleet size are labelled **projections from a 2-vCPU reference measurement**, not guarantees.
5. **Honest maturity:** the platform is a **Validated Release Candidate** (`ENTERPRISE-VALIDATION-REPORT.md`), operated by an **implied/target org** — EOSP defines roles and cadences; it does not claim a staffed team exists. Name **no** real individuals.
6. **Extend, do not duplicate.** Reference and build on the assets below; never restate a runbook or guide that already exists.
7. **No architectural expansion.** Operating processes only.

## MEASURED capacity / SLI coefficients (real — `bench/results/*.json`, EVP)

Reference environment: **2 vCPU (Intel Xeon @2.10 GHz), 8 GB, Node 22, PG 16, Redis 7**; single backend instance; **load client co-located** (so throughput is a conservative floor). All scenarios ran at **0 errors**.

| SLI (measured)                             | Value                         | Use                                                    |
| ------------------------------------------ | ----------------------------- | ------------------------------------------------------ |
| `/health` liveness                         | 1221 rps, p95 51 ms           | liveness capacity                                      |
| `/live` readiness                          | 2103 rps, p95 36 ms           | readiness capacity                                     |
| `/store/apps` (DB list)                    | **610 rps**, p95 69 ms        | **per-replica read capacity floor**                    |
| `/store/apps/:slug` (DB point read, joins) | **424 rps**, p95 104 ms       | heaviest read path                                     |
| `/store/categories` (DB agg)               | 1559 rps, p95 33 ms           | light read path                                        |
| DB point read                              | p50 0.23 ms, p95 0.46 ms      | DB not the bottleneck                                  |
| Argon2id verify                            | **p50 19.6 ms**               | **auth ≈ 50 verifies/s/core** (login throughput bound) |
| Cold start → healthy                       | 0.66 s (cold) / 0.62 s (warm) | scale-up latency                                       |
| Restart recovery                           | 0.46 s                        | rolling-restart budget                                 |
| RSS under 24k-req load                     | **≈ 213–223 MB**              | **per-replica memory sizing**                          |
| pg pool under load                         | **auto-scales 1 → 10**        | **DB connections per replica**                         |

**Derived capacity rules (label as projections from the 2-vCPU floor):**

- One 2-vCPU replica ≈ **400–600 rps** sustained on DB-backed reads at 0 errors, **~230 MB RSS**, **≤10 DB connections**.
- Fleet DB connections ≈ `replicas × 10` → size Postgres `max_connections`/pooler accordingly.
- Login-heavy load is bounded by Argon2 (~50/s/core), independent of read capacity — size separately.
- Horizontal scale is linear-ish for stateless reads; **HPA exists in the Helm chart but live scale-up under load is not yet measured** (proposed, per GA report).

## Real ops assets to EXTEND (never duplicate) — with the distinction

| Existing asset                                        | What it is                                                        | EOSP extends it into…                                                               |
| ----------------------------------------------------- | ----------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| `docs/guides/OPERATIONS-GUIDE.md`                     | day-2 ops reference                                               | operating **cadence** (daily/weekly/monthly/quarterly) + capacity planning          |
| `docs/validation/OPERATIONAL-RUNBOOKS.md`             | incident runbooks (Redis/PG down, restart, latency, backup drill) | SRE/SecOps **discipline** that invokes them (SLOs, error budgets, IR)               |
| `docs/guides/DISASTER-RECOVERY-GUIDE.md`              | backup/restore/DR (proven)                                        | rollback/maintenance-window **operating model**                                     |
| `docs/guides/RELEASE-CHECKLIST.md`                    | per-release gate                                                  | release **calendar + governance + hotfix** operating model                          |
| `docs/adoption/CUSTOMER-SUCCESS.md`                   | customer adoption lifecycle (GEAP)                                | internal **support org** (tickets, escalation tiers, SLA framework)                 |
| `docs/adoption/BUSINESS-EXPANSION.md`                 | pricing/segmentation (GEAP)                                       | **sales ops / renewal workflow / internal reporting** cadence                       |
| `CONTRIBUTING.md`, `CODEOWNERS`, `.github/` templates | contributor scaffolding (GEAP)                                    | engineering **workflow / branch strategy / code-review** operating model            |
| EVP vertical packs (`docs/validation/verticals/*`)    | compliance **self-assessment mappings** (SOC2/PCI/HIPAA/NIST)     | compliance **operations** (audit readiness, evidence cadence) — still not certified |

## Real risk register (for risk dashboard / secops / improvement backlog) — from `ENTERPRISE-GA-REPORT.md`

- **HIGH:** Apple `id_token` not JWKS-verified; marketplace app install accepts unsigned packages when trust store empty.
- **MEDIUM:** rate limiter fails open on Redis loss (deliberate); no per-PR desktop CI; no macOS release automation; update rollback advisory (data-side restore is the real path); federation DR modeled; no alerting/tracing/capacity-forecasting.
- **Dependency:** 0 production npm-audit vulns; 11 dev-only advisories.
- **Quality baseline:** typecheck 0, lint 0, **3,856 tests**, build 0.

## Real observability substrate (for SRE/monitoring/exec dashboards)

- Backend `GET /metrics` (Prometheus): `neuropause_backend_up|_uptime_seconds|_resident_memory_bytes|_heap_used_bytes`, `neuropause_pg_pool_connections{state}`, `neuropause_http_requests_total{method,status}`.
- `GET /health` (`status: ok|degraded`, `components.database|redis`), `GET /live`.
- `audit_log` table (append-only). **Absent (honest):** alert routing, distributed tracing, capacity forecasting — dashboards/alerts are **proposed wiring over the real substrate**, not existing.

## Authoring rules

1. Every process is executable and cites a real asset/report.
2. KPI/SLI = definition + measurement method; SLO/target = proposed objective; never a fabricated value.
3. Compliance = readiness/audit-prep mapping; never "certified".
4. Capacity = measured coefficients + labelled projections.
5. Extend prior assets; no duplication; no architecture; name no real people.
