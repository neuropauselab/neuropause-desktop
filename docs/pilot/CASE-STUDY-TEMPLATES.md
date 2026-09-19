# NeuroPause CDEP — Case-Study & ROI Templates

> ## TEMPLATES ONLY — DO NOT PUBLISH UNTIL A REAL DEPLOYMENT FILLS THEM WITH MEASURED EVIDENCE
>
> **Every field in this document is a blank placeholder.** Nothing here records a
> real customer, deployment, benchmark, quote, logo, satisfaction score, or ROI.
> **No pilot has run.** Do not publish, quote, or circulate any section until a real
> deployment has filled its placeholders with evidence produced by the harnesses
> named below. Any example row is labelled _illustrative — not a real pilot_; the
> single ROI worked example is labelled _hypothetical, illustrative inputs — not a
> real customer_. Inventing any value here — a customer name, a metric, a quote, a
> dollar figure, a payback period — violates the CDEP anti-fabrication rules
> (`docs/pilots/_grounding.md`, "Hard anti-fabrication rules").

This is the CDEP case-study instrument: blank technical and business case-study
templates, an ROI **methodology** (formula + inputs + sourcing — no dollar figures),
and a one-page architecture-summary template. It is **execution, not engineering** —
it adds no runtime and cites only assets that already exist in the repository.

---

## How to use this document

1. Copy a template into `docs/pilots/cases/<segment>-<yyyy-mm>.md` for a specific
   pilot. Never edit the master templates in place.
2. Fill placeholders **only** from real sources: evidence artifacts the pilot's
   harness run produced, or data the customer supplied. Leave a field blank rather
   than guess.
3. Keep the "DO NOT PUBLISH" banner on the copy until the publication gate at the
   end of this file is satisfied and the customer has approved attribution.

### Placeholder conventions

| Notation                          | Meaning                                                                                                              |
| --------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `<...>`                           | Fill at pilot time; blank until then.                                                                                |
| `[customer-provided]`             | Value comes from the customer's own data/finance, not from us.                                                       |
| `[from <artifact>]`               | Value comes from a real evidence artifact the pilot produced (e.g. the customer's own run of `bench/http-load.mjs`). |
| _illustrative — not a real pilot_ | An example row showing shape only; never a claimed result.                                                           |

**Companion instruments** (produce the fill data): `PILOT-MATRICES.md` (readiness),
`PILOT-FRAMEWORK.md` (entry/success/rollback/exit criteria), `DEPLOYMENT-QUALITY.md`
(acceptance scorecards), `CUSTOMER-FEEDBACK.md` (interview guides for quotes/adoption).

---

## 1. Technical case-study template

> Copy the block below. Every value is a placeholder. Status stays **DRAFT — UNFILLED**
> until real evidence is attached and the publication gate passes.

**Title:** `<technical case-study title>`
**Customer segment / persona:** `<customer segment>` _(persona/segment only — never a named customer or logo)_
**Deployment window:** `<start date>` – `<end date>`
**Reference architecture:** `<1 · Single-node | 2 · Kubernetes + managed data | 3 · On-prem / air-gapped>` (`docs/validation/REFERENCE-ARCHITECTURES.md`)
**Status:** DRAFT — UNFILLED · **Author (role):** `<deployment lead role>`

### 1.1 Context

- **Environment & constraints:** `<cloud | on-prem | air-gapped; compliance/network constraints>` [customer-provided]
- **Scale:** `<users>`, `<entities/workspace size>`, `<request volume>` [customer-provided]
- **Prior state / status quo:** `<incumbent tooling or manual process>` [customer-provided]
- **Evaluation goal:** `<what the pilot must prove to pass entry criteria — see PILOT-FRAMEWORK.md>`

### 1.2 Architecture (cite the real reference architecture)

State which of the three shipped topologies was deployed and record the concrete
choices; do not describe anything the repo does not contain.

| Decision         | As deployed                                                | Real basis                                                 |
| ---------------- | ---------------------------------------------------------- | ---------------------------------------------------------- |
| Topology         | `<Architecture 1 / 2 / 3>`                                 | `REFERENCE-ARCHITECTURES.md`                               |
| Backend image    | `<tag>`                                                    | `apps/backend/Dockerfile` (multi-stage, non-root uid 1001) |
| Datastores       | `<containers on host                                       | managed HA Postgres/Redis>`                                | Arch 1/3 = containers; Arch 2 = managed via Secret |
| Backend replicas | `<1                                                        | 2→6 HPA>`                                                  | `deploy/kubernetes/optional.yaml` (HPA cpu 70%)    |
| TLS termination  | `<reverse proxy                                            | nginx Ingress>`                                            | `deploy/kubernetes/optional.yaml`                  |
| Telemetry scrape | `<loopback                                                 | Prometheus scrape of pod :4000/metrics>`                   | `/metrics` is the only scrape target               |
| Config flags     | `RUN_MIGRATIONS_ON_BOOT=false`, `SEED_STORE_ON_BOOT=false` | production-safe defaults (fixed, not a placeholder)        |

### 1.3 Deployment approach

Record the executed steps against the real deployment assets. Each row is a checkbox
the pilot ticks; the _result_ column is a placeholder until run.

| Step                            | Real asset used                                                                   | Result                      |
| ------------------------------- | --------------------------------------------------------------------------------- | --------------------------- |
| Manifest / chart validation     | `kubernetes-validate` strict, Helm render in CI (`bench/results/deployment.json`) | `<PASS/FAIL>`               |
| Schema migration                | `npm run db:migrate` — 12 forward-only, idempotent                                | `<applied N, re-run 0 new>` |
| Backup/restore rehearsal        | `scripts/backup-db.sh` + `restore-db.sh` (proven exact)                           | `<row-count match?>`        |
| Air-gapped bundle (Arch 3 only) | `scripts/build-offline-bundle.sh` (shellcheck CLEAN)                              | `<built/loaded on target?>` |
| Quality gates                   | `typecheck` / `lint` / `test` (3,856) / `build`                                   | `<gate results>`            |
| Onboarding                      | GEAP `docs/adoption/CUSTOMER-SUCCESS.md`                                          | `<onboarding milestones>`   |
| Support channel                 | EOSP `docs/operations/CUSTOMER-SUPPORT.md`                                        | `<channel established?>`    |

Playbooks followed: `docs/validation/DEPLOYMENT-PLAYBOOKS.md`, GEAP
`docs/adoption/DEPLOYMENT-PROGRAM.md`.

### 1.4 Evidence collected (the heart of the case study)

Every "Customer measured value" is produced by running the **real harness** against
the **customer's** instance at pilot time — cite the artifact path, never a number
we made up. The final column is the **EVP 2-vCPU reference floor** — _OUR reference
measurement, not a customer result_ — shown only so the reader knows the shape of a
good outcome (`docs/validation/PERFORMANCE-BENCHMARKS.md`, `_grounding.md`).

| Evidence class             | Real harness / procedure                                 | Customer artifact (pilot output) | Customer measured value                            | EVP reference floor _(ours, not a customer result)_                                           |
| -------------------------- | -------------------------------------------------------- | -------------------------------- | -------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| API latency / throughput   | `bench/http-load.mjs`                                    | `<path>/http-load.json`          | `<p50/p95/p99, rps, errors>` [from artifact]       | `/store/apps` 610 rps, p95 68.5 ms; point-read 424 rps, p95 104 ms; 0 errors                  |
| DB query latency           | `bench/db-latency.mjs`                                   | `<path>/db-latency.json`         | `<p50/p95 per shape>` [from artifact]              | point read p50 0.23 ms; all shapes sub-ms                                                     |
| Cold start / footprint     | `bench/startup.sh`                                       | `<path>/startup.json`            | `<cold-start s; RSS; pool>` [from artifact]        | 0.66 s cold; RSS 117 MB idle / ~213 MB load; pool 1→10                                        |
| Auth cost (capacity input) | Argon2id hasher bench                                    | `<path>/argon2.json`             | `<verify ms>` [from artifact]                      | verify ~20 ms (~50 verify/s/core)                                                             |
| Reliability scenarios      | procedures in `RELIABILITY-RESULTS.md`                   | `<path>/reliability.json`        | `<pass/fail per scenario>` [from artifact]         | restart 0.46 s; Redis fail-open; PG auto-recover; migration idempotency; backup/restore exact |
| Resource under load        | `GET /metrics` gauges                                    | `<path>/metrics-under-load.json` | `<RSS/heap/pool over time>` [from artifact]        | RSS ~213 MB, heap ~70 MB, pool 10, 0 waiting                                                  |
| Security posture           | control inventory + `npm audit --omit=dev` + `audit_log` | `<path>/security-report.md`      | `<controls verified; vulns; gaps>` [from artifact] | 0 production vulnerabilities; controls per `SECURITY-GUIDE.md`                                |

### 1.5 Outcomes

- **Acceptance decision:** `<accepted / conditional / rejected — per DEPLOYMENT-QUALITY.md scorecard>`
- **Measured vs. success criteria:** `<criterion → measured value → met?>` [from artifacts above]
- **Issues found / defects filed:** `<issue IDs>` (routed via `.github` templates → EOSP workflow)
- **Known gaps encountered:** `<e.g. rate-limit fail-open on Redis loss; app-rollback advisory>` (`ENTERPRISE-GA-REPORT.md`)
- **Rollback exercised?** `<yes/no; data-side restore is the real recovery path>`

---

## 2. Business case-study template

> Copy the block below. All value/adoption figures are placeholders sourced from
> measured evidence plus customer-provided data. **No fabricated quotes or logos.**

**Title:** `<business case-study title>` · **Segment:** `<customer segment>` · **Status:** DRAFT — UNFILLED

### 2.1 Problem

- **Business problem:** `<the operational/financial pain the customer needs solved>` [customer-provided]
- **Baseline pain metric:** `<current cost / downtime / effort — the "before" number>` [customer-provided]
- **Why now:** `<trigger / deadline / risk>` [customer-provided]

### 2.2 Solution

- **What was deployed:** `<Reference Architecture N + components>` (`REFERENCE-ARCHITECTURES.md`)
- **Integration points:** `<auth providers, data sources, clients>` [customer-provided]
- **Onboarding path:** GEAP `docs/adoption/CUSTOMER-SUCCESS.md`

### 2.3 Value realized

Fill each cell from the technical evidence (§1.4) and/or the ROI methodology (§3).
Leave blank until measured — no projected number may appear here.

| Value area                 | How it is evidenced                                  | Realized value                                      |
| -------------------------- | ---------------------------------------------------- | --------------------------------------------------- |
| Reliability / availability | `reliability.json` outcomes vs. baseline             | `<placeholder>` [from evidence + customer baseline] |
| Performance headroom       | `http-load.json` / `db-latency.json` vs. requirement | `<placeholder>` [from evidence]                     |
| Operations effort          | deployment automation vs. prior manual effort        | `<placeholder>` [customer-provided]                 |
| Financial (ROI outputs)    | §3 methodology fed real inputs                       | `<placeholder>` [do not fill with a projection]     |

### 2.4 Adoption

- **Adoption metric:** `<active users / workspaces / requests over time>` `<placeholder>` [from customer telemetry / `GET /metrics`]
- **Note:** adoption and satisfaction **dashboards ship empty** — definition + source + blank state only. No score is invented (`_grounding.md`, anti-fabrication rule 5).

### 2.5 Customer voice (placeholder — never fabricate)

> `"<verbatim quote captured via CUSTOMER-FEEDBACK.md interview>"`
> — `<role, not a name, until the customer approves attribution>`

Leave this block empty until a real, approved quote exists. Do not paraphrase,
compose, or attribute a quote that was not given.

---

## 3. ROI methodology (formula + inputs + sourcing — NO dollar figures)

ROI here is a **model you run with the customer**, not a claim we make. It defines
benefit categories, cost categories, the payback/NPV formulas, and — critically —
**where each input comes from**: some from real evidence artifacts, some from
customer finance. No dollar figure, payback period, or percentage is asserted by
NeuroPause; outputs exist only after the customer supplies their own inputs.

### 3.1 Benefit categories and how each input is sourced

| Symbol    | Benefit                                          | Evidence-sourced input (real)                                                                                                           | Customer-provided input                            |
| --------- | ------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| `B_infra` | Infrastructure right-sizing / consolidation      | sized footprint from `metrics-under-load.json` (RSS ~213 MB, pool 1→10), `startup.json`, Argon2 ~50 verify/s/core (`argon2.json`)       | current infra spend / server count, unit prices    |
| `B_avail` | Avoided downtime                                 | reliability evidence (restart 0.46 s, Redis fail-open, PG auto-recover) `RELIABILITY-RESULTS.md`                                        | cost per hour of downtime; incident frequency      |
| `B_ops`   | Operations labor saved                           | deployment automation (`kubernetes-validate` PASS, shellcheck CLEAN, 12 idempotent migrations, proven backup/restore) `deployment.json` | current manual ops hours; loaded labor rate        |
| `B_risk`  | Data-integrity / migration risk reduction        | backup/restore exact + migration idempotency (`reliability.json`)                                                                       | valuation of avoided data-loss / rollback risk     |
| `B_perf`  | Avoided over-provisioning (performance headroom) | `http-load.json`, `db-latency.json` (sub-ms DB, 0 errors)                                                                               | throughput requirement; headroom target            |
| `B_ttv`   | Faster time-to-value                             | GEAP `CUSTOMER-SUCCESS.md` onboarding path                                                                                              | baseline time-to-onboard; value of earlier go-live |

### 3.2 Cost categories and how each input is sourced

| Symbol     | Cost                              | Sizing basis (real)                                                                                                                                                                  | Customer/commercial input                    |
| ---------- | --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------- |
| `C_lic`    | Software / licensing              | —                                                                                                                                                                                    | commercial terms [customer-provided]         |
| `C_infra`  | Infrastructure runtime            | footprint from bench artifacts + chosen reference architecture                                                                                                                       | compute + managed Postgres/Redis unit prices |
| `C_deploy` | One-time deployment & integration | scope from `DEPLOYMENT-PLAYBOOKS.md` / `DEPLOYMENT-AUTOMATION.md` checklists                                                                                                         | integration effort; labor rate               |
| `C_ops`    | Ongoing operations                | day-2 tasks (`OPERATIONS-GUIDE.md`)                                                                                                                                                  | ongoing ops hours; labor rate                |
| `C_train`  | Training / change management      | onboarding scope (`CUSTOMER-SUCCESS.md`)                                                                                                                                             | training effort [customer-provided]          |
| `C_gap`    | Known-gap mitigation (honest)     | external tooling NeuroPause does **not** ship — alerting, tracing, capacity forecasting, off-host backup, app-rollback discipline (`OPERATIONS-GUIDE.md`, `ENTERPRISE-GA-REPORT.md`) | cost of chosen external tools                |

`C_gap` is mandatory: an honest ROI must include the cost of covering the platform's
documented gaps, not just its strengths.

### 3.3 Formulas

Let recurring benefits `B = B_infra + B_avail + B_ops + B_risk + B_perf + B_ttv` and
recurring costs `C_run = C_lic + C_infra + C_ops + C_train + C_gap`, per period.

```
Per-period net benefit    N   = B − C_run
Upfront (one-time) cost   C0  = C_deploy + <one-time C_train / C_gap setup>
Simple payback (periods)      = C0 / N                       (only if N > 0)
NPV over horizon H,           = −C0 + Σ (t=1..H)  N_t / (1 + r)^t
  discount rate r [customer-provided]
ROI %                         = (Σ discounted benefits − Σ discounted costs)
                                 / (Σ discounted costs)
```

Report `payback`, `NPV`, and `ROI %` **only** after every input is filled from §3.1–§3.2.
Until then they are undefined. NeuroPause never publishes a value for them.

### 3.4 Worked example — HYPOTHETICAL, ILLUSTRATIVE INPUTS — NOT A REAL CUSTOMER

> **This is arithmetic demonstration only.** All inputs are invented placeholders in
> abstract **cost-units (CU)** — CU is _not a currency, not dollars_, and none of
> these numbers describe NeuroPause or any customer. The example exists solely to
> show how the formulas combine, per the instruction to include one clearly-labelled
> hypothetical. **Do not cite any output below as a result.**

Illustrative per-period inputs (CU):

| Input     | Illustrative value (CU) | Input                      | Illustrative value (CU) |
| --------- | ----------------------: | -------------------------- | ----------------------: |
| `B_infra` |                      30 | `C_lic`                    |                      20 |
| `B_avail` |                      25 | `C_infra`                  |                      15 |
| `B_ops`   |                      20 | `C_ops`                    |                      10 |
| `B_risk`  |                      10 | `C_train`                  |                       5 |
| `B_perf`  |                       8 | `C_gap`                    |                       8 |
| `B_ttv`   |                       7 | `C_deploy` (one-time `C0`) |                      60 |

Illustrative arithmetic (`r = 0.10`, `H = 3` periods):

```
B      = 30+25+20+10+8+7 = 100 CU
C_run  = 20+15+10+5+8     =  58 CU
N      = 100 − 58         =  42 CU / period
payback= 60 / 42          ≈ 1.43 periods
NPV    = −60 + 42/1.1 + 42/1.21 + 42/1.331 ≈ 44.5 CU
ROI %  = (Σ disc. B − Σ disc. C) / Σ disc. C  ≈ (249 − 204) / 204 ≈ 22%
```

_(Again: illustrative CU arithmetic, not a real customer, not a NeuroPause claim.)_

---

## 4. Architecture summary template (one-pager)

> One page an account team fills per pilot. Components and security posture are the
> **real** stack; customer-specific choices are placeholders.

**Deployment:** `<segment>` · **Reference architecture:** `<1 | 2 | 3>` · **Date:** `<date>` · **Status:** DRAFT — UNFILLED

### 4.1 Components (from the real stack)

| Component      | Role                                         | As deployed             | Source                    |
| -------------- | -------------------------------------------- | ----------------------- | ------------------------- |
| Backend API    | Node 20 + Express, stateless, `:4000`        | `<image tag; replicas>` | `apps/backend/Dockerfile` |
| Postgres       | System of record (12 migrations)             | `<containers            | managed>`                 | `postgres:16-alpine` or managed |
| Redis          | OAuth state + rate-limit backing (fail-open) | `<containers            | managed>`                 | `redis:7-alpine` or managed     |
| Desktop client | Electron (macOS), IPC-only telemetry         | `<version; signed?>`    | `apps/desktop`            |

### 4.2 Topology

State the reference-architecture diagram used and the deltas:
`<Architecture N per REFERENCE-ARCHITECTURES.md; datastore mode; replicas; TLS at <proxy/Ingress>; /metrics reach = <loopback | Prometheus scrape>>`.
Modeled/absent (state plainly, do not imply otherwise): SAML/SCIM SSO, federation
multi-region DR/failover, blue-green/canary, native alerting/tracing.

### 4.3 Security posture

- **Verified controls:** Electron hardening, fail-closed IPC + RBAC, OAuth PKCE
  (RFC 8252) + token rotation, Argon2id (~20 ms) password hashing, keychain secret
  vaults, SSRF guard, Ed25519 supply-chain signing (`SECURITY.md`, `docs/guides/SECURITY-GUIDE.md`).
- **Manifest hardening:** `runAsNonRoot` uid 1001, `readOnlyRootFilesystem`, `drop:
["ALL"]`, `seccompProfile: RuntimeDefault`, `/metrics` unauthenticated → network-restricted (`deploy/kubernetes/backend.yaml`).
- **Known gaps (honest, tracked):** Apple `id_token` not JWKS-verified (HIGH);
  unsigned marketplace packages accepted when trust store empty (HIGH); rate-limit
  fails open on Redis loss (MEDIUM); no alerting/tracing/capacity forecasting;
  app-binary rollback advisory only (`ENTERPRISE-GA-REPORT.md`, `_grounding.md`).
- **As-deployed specifics:** `<auth providers enabled; network policy; secret store>` [customer-provided]

### 4.4 Evidence links

| Evidence            | Customer artifact                                                                     |
| ------------------- | ------------------------------------------------------------------------------------- |
| Performance         | `<path>/http-load.json`, `<path>/db-latency.json`, `<path>/startup.json`              |
| Reliability         | `<path>/reliability.json`                                                             |
| Resource under load | `<path>/metrics-under-load.json`                                                      |
| Security            | `<path>/security-report.md` (controls + `npm audit --omit=dev` + `audit_log` extract) |
| Acceptance          | `<path>/acceptance-scorecard.md` (`DEPLOYMENT-QUALITY.md`)                            |

---

## Publication gate — do not publish until ALL are true

- [ ] Every `<...>` placeholder is filled from a real artifact or customer-provided datum (none left blank or guessed).
- [ ] Every metric traces to an evidence artifact the pilot's own harness run produced — no EVP reference-floor value is presented as the customer's result.
- [ ] The ROI section, if used, was run with the customer's real inputs; the CU worked example was removed or kept clearly labelled hypothetical.
- [ ] No customer name, logo, or quote appears without written customer approval; role-only attribution until then.
- [ ] Known gaps encountered are disclosed, not omitted.
- [ ] The "TEMPLATES ONLY" banner is removed **only** after the above are signed off; example rows marked _illustrative_ are deleted from the published copy.

_Until this gate passes, this document and any copy of it remain templates — not a
case study, not a benchmark, not an ROI claim._
