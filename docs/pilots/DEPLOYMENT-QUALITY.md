# NeuroPause CDEP — Deployment Quality & Scoring

> **What this is.** The CDEP **scoring instruments** for a real customer
> deployment: a weighted deployment scorecard, a deployment-level application of
> the EOSP operational-maturity model, a pass/fail acceptance gate matrix, and an
> evidence-completeness tracker. It adds **no runtime and no platform** — it is
> rubrics and blank templates scored over the **real** assets and reports in
> `_grounding.md`.
>
> **Honesty banner (non-negotiable).** **No pilot has run.** Every scorecard here
> ships **blank**. The single filled table in this document is labelled
> **"illustrative — not a real deployment"** and its numbers are invented to show
> the arithmetic only. **No score, deployment, customer, or benchmark result is
> claimed.** Every scoring criterion resolves to a **real** evidence source — a
> quality gate, a `bench/results/*.json` artifact, a reliability scenario, a
> `/health` response, or a proven backup/restore — never to an opinion.
>
> **Builds on, does not restate.** The five-level maturity model and its
> production-data ceiling are defined in EOSP
> `docs/operations/CONTINUOUS-IMPROVEMENT.md §1`; this document **re-applies** them
> to a single deployment. The evidence itself lives in EVP
> `docs/validation/{PERFORMANCE-BENCHMARKS,DEPLOYMENT-VALIDATION,RELIABILITY-RESULTS}.md`
> and `bench/results/*`; this document **references** it. Sibling CDEP instruments:
> `PILOT-FRAMEWORK.md` (entry/success/exit, roles), `DEPLOYMENT-AUTOMATION.md` (the
> executable acceptance suite scored in §3), `PILOT-MATRICES.md §3` (the Evidence
> Collection taxonomy scored in §4).

## How to use this document

1. Score **per deployment**, at cutover, from captured artifacts — never from
   memory or intent. A criterion with no artifact scores **0**.
2. Copy a blank scorecard, fill the **Score** / **Result** / **Present?** columns
   against the cited evidence, and attach the artifact path in the evidence column.
3. Archive the completed scorecard into the deployment's evidence pack
   (`PILOT-FRAMEWORK.md` exit gate). An unarchived score does not count.

---

## 1. Deployment scorecard (weighted rubric + blank template)

### 1.1 The attainment scale (0–4) — one scale, every criterion

Each criterion is scored on the same anchored scale. A level is only claimable
when its **evidence bar** is met; the bar is a real, checkable artifact.

| Score | Name           | Evidence bar (what must exist to claim it)                                                                                              |
| ----- | -------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| **0** | Absent         | Step not attempted at this deployment; no artifact.                                                                                     |
| **1** | Declared       | The asset/procedure exists in-repo and is referenced, but was **not executed** in the customer environment.                             |
| **2** | Executed       | Ran in the customer environment; output captured but **failing or partial**.                                                            |
| **3** | Verified green | Ran in the customer environment and **passed**; artifact captured (gate log, `bench/results/*.json`, `/health` body, reliability PASS). |
| **4** | Signed         | Verified green **and** countersigned at acceptance (§3) **and** archived to the evidence pack.                                          |

**Roll-up rule (weakest-link).** A criterion group's score is the **lowest**
sub-criterion score within it: a deployment is only as green as its weakest gate.

### 1.2 Weighted rubric — criteria → evidence source → scale

Overall % = Σ(weight × group score) ÷ Σ(weight × 4) × 100. Weights sum to 100.

| #     | Criterion (weight)            | Sub-criteria scored 0–4                                                                                                                                                                                                     | Real evidence source                                                                    |
| ----- | ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| **A** | **Prerequisites met** (15)    | image builds (`docker build` exit 0); migrations applied (`db:migrate`, `schema_migrations`=12, re-run applies 0); config/secrets valid (`config/env.ts`, `SEED_STORE_ON_BOOT=false`); backup taken & **proven restorable** | `PILOT-MATRICES.md §1`; `RELIABILITY-RESULTS.md` §1–2; `bench/results/reliability.json` |
| **B** | **Quality gates green** (25)  | `typecheck` 0; `lint` 0 (`--max-warnings 0`); `test` = **3,856** pass (desktop 3,548 / backend 263 / sdk 15 / cli 30); `build` exit 0; `npm audit --omit=dev` 0 prod vulns                                                  | `PERFORMANCE-BENCHMARKS.md §7`                                                          |
| **C** | **Deployment validated** (25) | `kubernetes-validate` strict **PASS** (`backend.yaml`, `optional.yaml`); `shellcheck` **CLEAN**; `yamllint` clean-except-cosmetic; Helm chart renders (8 templates, CI)                                                     | `DEPLOYMENT-VALIDATION.md`; `bench/results/deployment.json`                             |
| **D** | **Acceptance signed** (35)    | every mandatory §3 gate **PASS**; acceptance countersigned by sponsor + deployment-lead roles                                                                                                                               | §3 of this document; `DEPLOYMENT-AUTOMATION.md`; `PILOT-FRAMEWORK.md` exit gate         |

> Weighting rationale: acceptance (D) is heaviest because a deployment is not
> "done" until the customer signs; gates (B) and deployment-validation (C) are the
> technical backbone; prerequisites (A) gate entry but are table-stakes.

### 1.3 Blank deployment scorecard (copy per deployment)

| Deployment ID | Date   | Deployment lead (role) |
| ------------- | ------ | ---------------------- |
| ______        | ______ | ______                 |

| #   | Criterion            |  Weight | Group score (0–4) | Weighted (w×score) | Evidence artifact path |
| --- | -------------------- | ------: | :---------------: | -----------------: | ---------------------- |
| A   | Prerequisites met    |      15 |       ____        |               ____ | ______                 |
| B   | Quality gates green  |      25 |       ____        |               ____ | ______                 |
| C   | Deployment validated |      25 |       ____        |               ____ | ______                 |
| D   | Acceptance signed    |      35 |       ____        |               ____ | ______                 |
| —   | **Total**            | **100** |         —         |    **\____ / 400** | —                      |

**Overall deployment quality %** = (Σ weighted ÷ 400) × 100 = **\____ %**.
Suggested reading bands (not a pass line — the §3 gate is the pass line): **<50**
incomplete; **50–74** validated-but-unsigned; **75–99** signed with gaps;
**100** fully signed & archived.

### 1.4 Illustrative fill — _illustrative — not a real deployment_

> **The numbers below are invented to demonstrate the arithmetic only.** They are
> **not** measured, **not** a customer, and **not** a claimed result. Delete before
> using this file for a real deployment.

| #   | Criterion            |  Weight | Group score |      Weighted | Note (illustrative)                                       |
| --- | -------------------- | ------: | :---------: | ------------: | --------------------------------------------------------- |
| A   | Prerequisites met    |      15 |      3      |            45 | all four sub-criteria verified green                      |
| B   | Quality gates green  |      25 |      3      |            75 | gates pass in customer CI; not yet signed                 |
| C   | Deployment validated |      25 |      3      |            75 | k8s-validate/shellcheck green in customer env             |
| D   | Acceptance signed    |      35 |      2      |            70 | one §3 gate still failing → weakest-link caps group at 2  |
| —   | **Total**            | **100** |      —      | **265 / 400** | Overall = 265 ÷ 400 = **66 %** → "validated-but-unsigned" |

This shows the mechanics: group D's weakest-link (a single failing acceptance
gate) holds the whole deployment below the signed band even though A–C are green.

---

## 2. Operational maturity scoring (EOSP model applied to a deployment)

The five-level model — **Initial → Managed → Defined → Measured → Optimizing** —
and the **production-data ceiling** are defined in EOSP
`CONTINUOUS-IMPROVEMENT.md §1`; they are **not restated here**. Below they are
re-anchored to the evidence a _single deployment_ can produce.

### 2.1 Deployment-maturity rubric (evidence bar per level)

| Lvl   | EOSP name  | Meaning for **one deployment**                                                                                                                 | Deployment-level evidence bar                                                                                            | Reachable at cutover?         |
| ----- | ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ | ----------------------------- |
| **1** | Initial    | Deployed by hand; steps improvised; nothing captured.                                                                                          | A running `/health` 200, no artifacts.                                                                                   | Yes                           |
| **2** | Managed    | Reproducible on the known path: a playbook was followed once and a backup taken.                                                               | `DEPLOYMENT-PLAYBOOKS.md` followed; smoke passed once; verified-restorable backup (`reliability.json` `backup-restore`). | Yes                           |
| **3** | Defined    | Standardized & role-owned: full gate + deployment-validation + reliability evidence pack captured, acceptance signed, roles/runbooks assigned. | §1 scorecard complete + §3 all-PASS + §4 core artifacts present; roles per `PILOT-FRAMEWORK.md`.                         | **Yes — this is the ceiling** |
| **4** | Measured   | Controlled by the customer's **own** production telemetry against ratified SLOs.                                                               | The customer's `/metrics` scraped **over time** + SLOs ratified on their traffic.                                        | **No**                        |
| **5** | Optimizing | Closed loop drives automated optimization over that telemetry.                                                                                 | Level 4 baselines + acting-on-them.                                                                                      | **No**                        |

### 2.2 The production-data ceiling for a deployment (honest note)

A deployment scored **at cutover tops out at Defined (3)**. Levels 4–5 consume
production telemetry that, **by definition, does not exist at go-live** — the
customer's instance has served no real traffic yet, so there is no achieved
uptime, MTTR, burn, or forecast to measure (mirrors EOSP §1 "production-data
ceiling" and `_grounding.md` rule 5). Placing a fresh deployment at Measured or
Optimizing would be fabrication. The ceiling lifts **only** after the customer's
instance accumulates its own production telemetry and its SLOs are ratified on
that data — a **post-pilot** event, tracked by EOSP, never claimed here.

### 2.3 Blank maturity placement (copy per deployment)

| Deployment ID | Level claimed (1–3) | Evidence cited (artifact paths) | Blocker to next level |      Ceiling reaffirmed?       |
| ------------- | :-----------------: | ------------------------------- | --------------------- | :----------------------------: |
| ______        |        ____         | ______                          | ______                | ☐ Defined-cap (pre-production) |

> A level is claimable **only** on cited evidence, and rises **only** when the
> named blocker closes — identical discipline to EOSP §1. Do not enter 4 or 5.

---

## 3. Acceptance scoring (pass/fail gate matrix)

Binary gates, tied to the acceptance tests defined in the sibling
`DEPLOYMENT-AUTOMATION.md`. **Acceptance = every _mandatory_ gate PASS.** Any
mandatory FAIL → not accepted, and caps criterion **D** in §1 (weakest-link). This
matrix is the executable pass line; §1 is the graded quality read.

### 3.1 Gate rubric → blank result matrix

| #   | Gate                  | Real check (command / endpoint)                                      | Pass criterion                                                | Evidence source                            | Mand. | Result | Evidence path |
| --- | --------------------- | -------------------------------------------------------------------- | ------------------------------------------------------------- | ------------------------------------------ | :---: | :----: | ------------- |
| G1  | Build gates           | `npm run typecheck && lint && test && build`; `npm audit --omit=dev` | 0 / 0 / **3,856** pass / exit 0 / 0 prod vulns                | `PERFORMANCE-BENCHMARKS.md §7`             |  ✅   |   ☐    | ____          |
| G2  | K8s schema            | `kubernetes-validate` strict                                         | **PASS** (`backend.yaml`,`optional.yaml`)                     | `DEPLOYMENT-VALIDATION.md`                 |  ✅   |   ☐    | ____          |
| G3  | Shell scripts         | `shellcheck scripts/*.sh`                                            | **CLEAN**                                                     | `deployment.json`                          |  ✅   |   ☐    | ____          |
| G4  | Migrations            | `db:migrate`; re-run                                                 | `schema_migrations`=12; re-run applies **0**                  | `reliability.json` `migration-idempotency` |  ✅   |   ☐    | ____          |
| G5  | Backup restorable     | `backup-db.sh` + restore drill                                       | row counts match **exactly**                                  | `reliability.json` `backup-restore`        |  ✅   |   ☐    | ____          |
| G6  | Liveness              | `GET /live`                                                          | `{"status":"alive",...}`                                      | `apps/backend/src/app.ts`                  |  ✅   |   ☐    | ____          |
| G7  | Health green          | `GET /health`                                                        | `{"status":"ok","components":{"database":"up","redis":"up"}}` | `app.ts`; playbook verify                  |  ✅   |   ☐    | ____          |
| G8  | Metrics up            | `GET /metrics`                                                       | `neuropause_backend_up 1`                                     | `app.ts`                                   |  ✅   |   ☐    | ____          |
| G9  | Rollout healthy       | `kubectl rollout status`; migrate Job                                | Deployment available; Job **Completed**                       | `DEPLOYMENT-PLAYBOOKS.md §B`               |  ✅   |   ☐    | ____          |
| G10 | Smoke sign-in         | end-to-end sign-in + log scan                                        | succeeds; no errors in first-traffic logs                     | `RELEASE-CHECKLIST.md §7`                  |  ✅   |   ☐    | ____          |
| G11 | Resilience spot-check | restart + Redis-down fail-open (where safe)                          | restart→healthy; served through cache outage                  | `RELIABILITY-RESULTS.md` §3–4              |   ☐   |   ☐    | ____          |
| G12 | Acceptance sign-off   | sponsor + deployment-lead countersign                                | both roles sign                                               | `PILOT-FRAMEWORK.md` exit                  |  ✅   |   ☐    | ____          |

**Verdict:** ______ (ACCEPTED only if every ✅ gate = PASS). Signed (role): ______.

> G11 is marked optional because production-safe chaos may not be permitted in
> every customer window; when it is run, it uses the **real** reliability
> procedures, not a description. No gate here fabricates a result — each is a live
> check whose output is pasted into the evidence column.

---

## 4. Evidence completeness scoring (Evidence Collection taxonomy)

Scores **which artifacts a deployment actually captured**, across the eight
evidence classes of `PILOT-MATRICES.md §3`. Each class names the **real
generator** and the artifact to capture in the customer environment. Every
"Ready tool" produces the artifact at pilot time — reference the reference
artifact, never copy its numbers as customer data (`_grounding.md` rule 2).

### 4.1 Completeness rubric → blank tracker (copy per deployment)

`Present?` = **Y** (captured in customer env) / **N** (missing, in scope) /
**N-A** (out of scope this window — excluded from denominator with a reason).

| Class (weight)                | Real generator                                           | Required artifact @ customer                                       | Reference artifact                  | Present? | Artifact path |
| ----------------------------- | -------------------------------------------------------- | ------------------------------------------------------------------ | ----------------------------------- | :------: | ------------- |
| Performance (15)              | `bench/http-load.mjs`, `db-latency.mjs`, `startup.sh`    | `http-load.json`, `db-latency.json`, `startup.json` (customer env) | `bench/results/*`                   |    ☐     | ____          |
| Reliability (20)              | reliability procedures                                   | `reliability.json` (scenarios pass/fail)                           | `RELIABILITY-RESULTS.md`            |    ☐     | ____          |
| Availability/health (10)      | `GET /health` `/live` + external probe                   | uptime series                                                      | `app.ts` (probe proposed)           |    ☐     | ____          |
| Resource/capacity (10)        | `GET /metrics` gauges                                    | metrics capture over time                                          | `metrics-under-load.json`           |    ☐     | ____          |
| Security (15)                 | control inventory + `npm audit --omit=dev` + `audit_log` | posture report + audit output                                      | 0 prod-vuln baseline                |    ☐     | ____          |
| Migration/data-integrity (20) | `db:migrate` + backup/restore row-count                  | integrity proof (`schema_migrations`=12; counts match)             | `reliability.json`                  |    ☐     | ____          |
| Business (5)                  | ROI methodology inputs (customer-sourced)                | value model — **no numbers**                                       | `CUSTOMER-FEEDBACK.md` / ROI method |    ☐     | ____          |
| Acceptance (5)                | §1 scorecard + §3 matrix                                 | signed acceptance                                                  | this document                       |    ☐     | ____          |

### 4.2 Completeness math

- **Unweighted %** = (# `Y`) ÷ (# `Y` + # `N`) × 100 — `N-A` rows excluded.
- **Weighted %** = Σ(weight of `Y` classes) ÷ Σ(weight of in-scope classes) × 100.
  Weights favor Reliability + Migration/data-integrity (20 each) — the
  proven-resilience core; Business is 5 (methodology only, no numbers).

| Metric                           | Value                |
| -------------------------------- | -------------------- |
| Classes captured (`Y`)           | ____ / ____ in scope |
| Unweighted completeness %        | ____ %               |
| Weighted completeness %          | ____ %               |
| Missing (`N`) classes → gap list | ______               |

> Completeness scores **coverage**, not quality: a class is `Y` when its artifact
> exists, regardless of the values inside. Whether the captured numbers are good
> is graded in §1; whether they pass is gated in §3. Availability/health may
> honestly be `N-A` until an external blackbox probe is deployed (proposed in
> `PILOT-MATRICES.md §3`) — record the reason rather than inflating the denominator.

---

## Provenance & scope

- **Real (measured / shipped) — what criteria tie to:** quality-gate baseline
  (`PERFORMANCE-BENCHMARKS.md §7`), deployment validation
  (`DEPLOYMENT-VALIDATION.md`, `bench/results/deployment.json`), reliability
  scenarios (`RELIABILITY-RESULTS.md`, `bench/results/reliability.json`), health
  substrate (`apps/backend/src/app.ts` `/health`,`/live`,`/metrics`), proven
  backup/restore (`scripts/backup-db.sh` + `restore-db.sh`).
- **Defined (this document):** the attainment scale, weighted rubrics, gate
  matrix, and completeness tracker — scoring **process** over the real substrate;
  no runtime added. The maturity levels are EOSP's (`CONTINUOUS-IMPROVEMENT.md
§1`), re-applied to a deployment.
- **Proposed / absent (honest):** every filled score in a real deployment (none
  exist yet), the external availability probe, and **all** maturity above
  Defined (3) — those await the customer's own production telemetry. **No score,
  customer, deployment, benchmark, or maturity level above Defined is claimed
  anywhere in this document.** The one filled table is labelled _illustrative —
  not a real deployment_. The platform remains a **Validated Release Candidate**.
