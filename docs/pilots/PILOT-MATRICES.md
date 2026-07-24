# NeuroPause — Pilot & Evidence Matrices

The CDEP reconnaissance deliverable. Four matrices assessing readiness to run a
**real** customer pilot and collect operational evidence, against the **real**
repository. State scale: **Ready** (a real tool/asset exists and is usable at a
pilot) · **Template** (CDEP authors the instrument; it is filled during a real
pilot) · **Gap** (missing prerequisite).

Anchors: platform is a **Validated Release Candidate**; **no pilot has run**, so
every customer-specific value is a blank to be filled — never a claimed result.

---

## 1. Deployment Readiness Matrix

Can the platform be deployed at a customer today? (prerequisite check before a pilot)

| Prerequisite          | Real basis                                              | State                | Note                                 |
| --------------------- | ------------------------------------------------------- | -------------------- | ------------------------------------ |
| Container image       | `apps/backend/Dockerfile`                               | **Ready**            | build needs a Docker daemon          |
| Kubernetes manifests  | `deploy/kubernetes/*` (kubernetes-validate PASS)        | **Ready**            | strict-validated                     |
| Helm chart            | `deploy/helm/neuropause-backend/*` (8 templates)        | **Ready**            | render in CI                         |
| Air-gapped install    | `scripts/build-offline-bundle.sh` (shellcheck clean)    | **Ready**            | documented procedure                 |
| Migrations            | `db:migrate` — 12 forward-only, idempotency proven      | **Ready**            | safe to re-run                       |
| Backup / restore      | `scripts/backup-db.sh` + `restore-db.sh` (proven exact) | **Ready**            | the real recovery path               |
| Config / secrets      | env schema (`config/env.ts`), `secret.example.yaml`     | **Ready**            | `SEED_STORE_ON_BOOT=false` in prod   |
| macOS desktop signing | configured, env-gated                                   | **Template**         | unsigned if secrets absent (GA item) |
| Rollback (app-level)  | advisory; data-side restore is real                     | **Gap (documented)** | promote to automated (backlog)       |
| HA / multi-region     | HPA in chart; not measured                              | **Gap (proposed)**   | single-region validated only         |

---

## 2. Pilot Readiness Matrix

Is the pilot _process_ ready to execute? (methodology + roles + tooling)

| Capability                                      | Real basis                  | State        | CDEP artifact              |
| ----------------------------------------------- | --------------------------- | ------------ | -------------------------- |
| Pilot methodology (entry/success/rollback/exit) | —                           | **Template** | `PILOT-FRAMEWORK.md`       |
| Deployment checklists                           | deploy playbooks (EVP/GEAP) | **Template** | `DEPLOYMENT-AUTOMATION.md` |
| Acceptance testing                              | quality gates + smoke       | **Template** | `DEPLOYMENT-AUTOMATION.md` |
| Onboarding                                      | GEAP `CUSTOMER-SUCCESS.md`  | **Ready**    | referenced                 |
| Support during pilot                            | EOSP `CUSTOMER-SUPPORT.md`  | **Ready**    | referenced                 |
| Success criteria (measurable)                   | tied to real SLIs / gates   | **Template** | `PILOT-FRAMEWORK.md`       |
| Rollback criteria                               | reliability results + DR    | **Template** | `PILOT-FRAMEWORK.md`       |
| Scorecards                                      | —                           | **Template** | `DEPLOYMENT-QUALITY.md`    |
| Roles (deployment lead, SRE, sponsor)           | roles not people            | **Template** | `PILOT-FRAMEWORK.md`       |

---

## 3. Evidence Collection Matrix

What evidence, from which real generator, in what state?

| Evidence class           | Real generator (tool)                                    | Output                               | State                                      |
| ------------------------ | -------------------------------------------------------- | ------------------------------------ | ------------------------------------------ |
| Performance              | `bench/http-load.mjs`, `db-latency.mjs`, `startup.sh`    | latency/throughput/error-rate JSON   | **Ready** tool · **Template** result       |
| Reliability              | reliability procedures (`RELIABILITY-RESULTS.md`)        | pass/fail per scenario               | **Ready** tool · **Template** result       |
| Availability / health    | `GET /health`, `/live`, blackbox probe                   | uptime series (needs external probe) | **Template** (probe proposed)              |
| Resource / capacity      | `GET /metrics` gauges                                    | RSS/heap/pool over time              | **Ready** substrate · **Template** capture |
| Security                 | control inventory + `npm audit --omit=dev` + `audit_log` | posture report                       | **Ready** tool · **Template** result       |
| Migration/data integrity | `db:migrate` + backup/restore row-count check            | integrity proof                      | **Ready** tool · **Template** result       |
| Business                 | ROI methodology inputs (customer-sourced)                | value model                          | **Template** (no numbers)                  |
| Acceptance               | scorecards + gates                                       | signed acceptance                    | **Template**                               |

_Every "Template result" is produced by running the "Ready tool" against the
customer's instance at pilot time. No customer result exists yet._

---

## 4. Operational Feedback Matrix

How pilot signal flows back into the product (the improvement loop).

| Feedback source         | Instrument (CDEP)                          | Routes to                     | State                                |
| ----------------------- | ------------------------------------------ | ----------------------------- | ------------------------------------ |
| Structured interviews   | `CUSTOMER-FEEDBACK.md` guides              | product evolution intake      | **Template**                         |
| Issues / defects        | issue categorization + `.github` templates | dev workflow (EOSP)           | **Ready** intake · **Template** log  |
| Feature requests        | request workflow                           | evidence-based roadmap        | **Template**                         |
| Incidents / RCA         | `OPERATIONAL-LEARNING.md` + EVP runbooks   | continuous improvement (EOSP) | **Template**                         |
| Satisfaction / adoption | methodology (no fabricated scores)         | exec dashboards               | **Template**                         |
| Deployment lessons      | lessons-learned framework                  | knowledge base                | **Template**                         |
| Operational patterns    | pattern catalog                            | reference architectures       | **Ready** seed · **Template** growth |

---

## Reading note

Every **Template** row is an executable instrument that a real pilot fills;
every **Ready** row is a real tool/asset built upon, never duplicated. The
matrices are the backbone of the CDEP frameworks and the final
`CUSTOMER-DEPLOYMENT-REPORT.md`. Nothing here asserts a pilot, a customer, a
benchmark result, or an ROI — only the readiness to produce them honestly.
