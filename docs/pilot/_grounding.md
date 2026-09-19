# CDEP Grounding — REAL DEPLOYMENT/EVIDENCE TOOLING + ANTI-FABRICATION RULES

> Shared source of truth for every Customer Deployment & Evidence Program (CDEP)
> document. CDEP is the **reference manual for running real customer pilots and
> collecting operational evidence**. It is **execution, not engineering,
> marketing, or hypothetical planning.** It **adds no runtime and no platform.**
>
> **The single most important rule:** **no pilot has run yet.** Every CDEP
> deliverable is a **blank instrument** — a methodology, checklist, template,
> rubric, or interview guide **to be filled in during a real deployment**. It is
> never a record of a deployment that happened. A template with example rows must
> label them **"illustrative — not a real pilot."**

## Hard anti-fabrication rules (non-negotiable)

1. **No fabricated customers or deployments.** No named customer, logo, site, or "pilot #N ran and achieved…". Personas/segments only; deployment records are empty templates.
2. **No fabricated benchmarks.** The only real numbers are the EVP reference measurements (`bench/results/*.json`, 2-vCPU reference). A **customer's** numbers do not exist yet — the harnesses produce them at pilot time. Never present a projected/example number as measured customer data.
3. **No fabricated ROI.** ROI is a **methodology** (formula + input list + how to source each input). No dollar figure, payback period, or % improvement is claimed; worked examples are labelled hypothetical.
4. **No fabricated case studies.** Case-study deliverables are **templates** with placeholder fields; "do not publish until a real deployment fills them."
5. **No fabricated operational history, uptime, incidents, satisfaction, or adoption.** Dashboards/scorecards ship **empty** (definition + source + blank state). Interview outputs are instruments, never invented responses.
6. **No claimed published research.** Replication/publication content is preparation methodology; no paper, DOI, venue, or peer review exists.
7. **Extend, do not duplicate; no architecture.** Build on the assets below.

## Distinction from the prior programs (avoid duplication)

| Program                                   | What it produced                                                                                            | CDEP's different job                                                                        |
| ----------------------------------------- | ----------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| **EVP**                                   | **our own** validation evidence on a 2-vCPU reference (`bench/results`, reliability, deployment validation) | the **customer-side** loop to reproduce that evidence in **their** environment              |
| **GEAP** `DEPLOYMENT-PROGRAM` / playbooks | how to **deploy** (kits, K8s, air-gapped)                                                                   | the **pilot** that _wraps_ a deployment (entry/success/rollback/exit + evidence collection) |
| **EOSP** operations manual                | how **we** run ops internally                                                                               | how a **pilot** is run and its evidence fed back into product decisions                     |

## Real deployment / migration / evidence tooling (what a pilot USES)

- **Deploy:** `deploy/kubernetes/*`, `deploy/helm/neuropause-backend/*`, `apps/backend/Dockerfile`, `scripts/build-offline-bundle.sh` (air-gapped). Playbooks: `docs/validation/DEPLOYMENT-PLAYBOOKS.md`, GEAP `docs/adoption/DEPLOYMENT-PROGRAM.md`, `docs/validation/REFERENCE-ARCHITECTURES.md`.
- **Migration:** `npm run db:migrate` (**12** forward-only migrations, idempotency **proven**), `scripts/backup-db.sh` + `scripts/restore-db.sh` (backup/restore **proven** exact — EVP).
- **Validation / acceptance:** quality gates (`typecheck`/`lint`/`test` **3,856**/`build`), `kubernetes-validate` (strict PASS), `shellcheck` (clean).
- **Evidence generators (reproducible harnesses — the heart of CDEP):**
  - `bench/http-load.mjs` → API latency/throughput/error-rate (per-scenario p50/p95/p99).
  - `bench/db-latency.mjs` → DB query latency.
  - `bench/startup.sh` → cold-start + `/metrics` snapshot.
  - `apps/desktop/src/main/__bench__/performance.test.ts` → engine timings.
  - Reliability procedures (migration idempotency, backup/restore, restart, Redis-down fail-open, PG-down degrade+auto-recover) — `docs/validation/RELIABILITY-RESULTS.md`.
- **Monitoring substrate (customer collects from their own instance):** `GET /metrics` (`neuropause_backend_up|_uptime_seconds|_resident_memory_bytes|_heap_used_bytes`, `neuropause_pg_pool_connections{state}`, `neuropause_http_requests_total{method,status}`), `GET /health` (`status`, `components.database|redis`), `GET /live`, `audit_log` table. **Absent (honest):** alerting, tracing, capacity forecasting.
- **Onboarding / support:** GEAP `docs/adoption/CUSTOMER-SUCCESS.md`, EOSP `docs/operations/CUSTOMER-SUPPORT.md`, root `SECURITY.md`.

## EVP reference numbers (real — for methodology examples ONLY, labelled reference)

2-vCPU / 8 GB reference, 0 errors: `/store/apps` 610 rps p95 69 ms; point read 424 rps p95 104 ms; DB point read p50 0.23 ms; Argon2 verify ~20 ms; cold start 0.66 s; restart 0.46 s; RSS ~213–223 MB; pool 1→10; **3,856 tests**; 0 prod vulns. **These are OUR reference floor, not a customer result** — a pilot re-measures on the customer's hardware.

## Real risk / known-gaps (for failure-mode catalog, rollback, quality gates) — `ENTERPRISE-GA-REPORT.md`

- **HIGH:** Apple `id_token` not JWKS-verified; marketplace app install accepts unsigned packages when trust store empty.
- **MEDIUM:** rate-limit fails open on Redis loss; no per-PR desktop CI; no macOS release automation; rollback advisory (data-side restore is real); federation DR modeled; no alerting/tracing.
- Maturity: **Validated Release Candidate**, **no production fleet**, **no completed customer deployment**.

## Authoring rules

1. Every artifact is executable and cites a real asset/report.
2. Everything ships **blank/template**; example rows are labelled illustrative/hypothetical.
3. No customer, deployment, benchmark, ROI, case study, satisfaction, or research result is claimed.
4. Customer evidence is produced by the real harnesses at pilot time — reference the harness, don't fabricate the output.
5. Extend prior assets; no duplication; no architecture; name no real people or customers.
