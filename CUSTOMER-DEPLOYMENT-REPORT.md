# NeuroPause — Customer Deployment & Evidence Program (CDEP) Report

**Version:** 1.0 · **Date:** 2026-07-18 · **Platform:** `1.0.0-rc.1` (Validated
Release Candidate)

**Nature of this program:** the **reference manual for running real customer
pilots and building an evidence base from operational use.** It is **execution,
not engineering, marketing, or hypothetical planning** — it adds no runtime and no
platform. Every deliverable is a **blank instrument** (methodology, checklist,
template, rubric, interview guide) that a real deployment fills with measured
evidence.

> **Honesty charter (enforced and independently reviewed).** **No pilot has run,
> no customer exists, no deployment has occurred.** Therefore no CDEP document
> claims a customer, a deployment, a benchmark result, an ROI figure, a case
> study, a satisfaction score, an adoption number, or a published paper. The
> evidence-_generation_ tools are real and proven (the EVP harnesses, the proven
> backup/restore, `/metrics`); the customer's _evidence_ is produced by running
> those tools at pilot time. Every reference number is our **2-vCPU EVP floor**,
> labelled as such — never a customer result.

---

## 1. Executive summary

Six prior programs took NeuroPause from a Release Candidate to an operationally
ready, adoptable platform with a real validation-evidence base. CDEP supplies the
missing loop: **how a real customer deployment is run and how it produces its own
operational evidence** — closing the gap between "we validated it on our reference
hardware" and "a customer proved it on theirs."

The insight that makes this honest and useful at once: the **evidence-generation
machinery already exists and is proven** — `bench/http-load.mjs`,
`bench/db-latency.mjs`, `bench/startup.sh`, the reliability procedures, the
`scripts/backup-db.sh`/`restore-db.sh` pair, and the `/metrics`+`/health`+`audit_log`
substrate. CDEP turns that machinery into a **repeatable customer-side pilot and
evidence-collection loop**: eleven frameworks (~3,200 lines) spanning pilot
methodology, evidence collection, customer feedback, deployment automation,
operational learning, case-study templates, executive evidence, product evolution,
research validation, deployment quality, and long-term product intelligence.

Every one of them ships **blank**. That is the point: the program is ready to
_produce_ evidence, and it fabricates none.

---

## 2. Deployment readiness

[`docs/pilots/PILOT-MATRICES.md`](docs/pilots/PILOT-MATRICES.md) §1. The platform is
**deployable today** on the paths the EVP validated: Docker, Kubernetes
(kubernetes-schema strict PASS — the CI gate is real `kubeconform -strict`), Helm,
and offline/air-gapped (`scripts/build-offline-bundle.sh`). Migrations are
forward-only and idempotent (proven); backup/restore is exact (proven). The honest
"not ready" rows are the carried GA items: macOS desktop signing is env-gated,
app-level rollback is advisory (data-side restore is the real path), and HA
multi-region is proposed, not measured.

---

## 3–10. The eleven deployment & evidence frameworks

Each is a standalone, executable document under `docs/pilots/`.

| #   | Framework             | Document                                                           | Honesty posture                                                                                                          |
| --- | --------------------- | ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------ |
| 3   | Pilot Framework       | [`PILOT-FRAMEWORK.md`](docs/pilots/PILOT-FRAMEWORK.md)             | Entry/success/rollback/exit criteria tied to real gates/`/health`/bench; thresholds "illustrative — ratify per customer" |
| 4   | Evidence Collection   | [`EVIDENCE-COLLECTION.md`](docs/pilots/EVIDENCE-COLLECTION.md)     | Blank result schemas matching the real `bench/results` JSON; chain-of-custody; EVP numbers labelled reference floor      |
| —   | Customer Feedback     | [`CUSTOMER-FEEDBACK.md`](docs/pilots/CUSTOMER-FEEDBACK.md)         | Interview guides/forms only; **no fabricated responses/scores/adoption**                                                 |
| 5   | Deployment Automation | [`DEPLOYMENT-AUTOMATION.md`](docs/pilots/DEPLOYMENT-AUTOMATION.md) | Every checklist item is a **real repo command** + expected result                                                        |
| 6   | Operational Learning  | [`OPERATIONAL-LEARNING.md`](docs/pilots/OPERATIONAL-LEARNING.md)   | Lessons/RCA templates; the one worked RCA is labelled illustrative; no real incidents                                    |
| 7   | Case Study Templates  | [`CASE-STUDY-TEMPLATES.md`](docs/pilots/CASE-STUDY-TEMPLATES.md)   | **Templates only**, publish-gate banner; ROI is methodology, example labelled hypothetical, no currency                  |
| 8   | Executive Evidence    | [`EXECUTIVE-EVIDENCE.md`](docs/pilots/EXECUTIVE-EVIDENCE.md)       | Dashboards are blank specs (definition+source+blank value); **pilots = 0** stated                                        |
| 9   | Product Evolution     | [`PRODUCT-EVOLUTION.md`](docs/pilots/PRODUCT-EVOLUTION.md)         | Roadmap seeded **only** with the 7 real open items; customer slots blank; ADR-001 grounded                               |
| —   | Research Validation   | [`RESEARCH-VALIDATION.md`](docs/pilots/RESEARCH-VALIDATION.md)     | Replication over the real harnesses; **no paper/DOI/peer review**; field tables blank                                    |
| 10  | Deployment Quality    | [`DEPLOYMENT-QUALITY.md`](docs/pilots/DEPLOYMENT-QUALITY.md)       | Blank scorecards/rubrics tied to real evidence; pre-production maturity ceiling honoured                                 |
| 11  | Product Intelligence  | [`PRODUCT-INTELLIGENCE.md`](docs/pilots/PRODUCT-INTELLIGENCE.md)   | KB seeded **only** with real proven patterns + real failure modes; growth entries blank                                  |

---

## 11. Knowledge base

[`PRODUCT-INTELLIGENCE.md`](docs/pilots/PRODUCT-INTELLIGENCE.md). The one framework
that ships with real _content_ rather than only structure — because there are real
proven operational patterns to seed it with: the pg pool auto-scaling 1→10,
Redis-down fail-open, Postgres-down degrade-and-auto-reconnect, 0.46 s restart,
forward-only idempotent migrations, and exact backup/restore — each cited to its
reliability evidence. The failure-mode catalog is seeded with the _real_ known
items (the two HIGH security items, the fail-open alert gap, advisory rollback),
each with a real detection signal and a runbook mitigation. Every
customer-specific or deployment-specific entry is a blank template awaiting a
pilot.

---

## 12. Known limitations

- **No pilot has been executed.** Every customer-specific value — performance,
  reliability, availability, ROI, satisfaction, adoption — is a blank awaiting a
  real deployment. The program produces evidence; it does not contain any yet.
- **The only real numbers are our EVP 2-vCPU reference floor**, used to calibrate
  and label — never a customer result.
- **Availability evidence needs an external probe** (`/health` is a real signal but
  `neuropause_backend_up` is a static `1`); the probe is proposed, not shipped.
- **The carried GA items bound deployment quality** — Apple JWKS, unsigned
  marketplace install, advisory rollback, no macOS/desktop CI — and are disclosed
  in the pilot's own risk and failure-mode content.
- **Case studies, dashboards, scorecards, and feedback outputs are empty** by
  design; publishing any of them requires a real deployment to fill them.
- **CDEP defines how to run a pilot; it does not run one.** No customer, no
  deployment, no operational history is implied.

---

## 13. Future improvements

Sequenced honestly (no dates, no invented demand):

1. **Run the first real pilot** using this framework — the single step that
   converts every blank template into evidence and moves the platform from
   Validated RC toward deployment-proven.
2. **Wire the availability probe + alerting** so the operational dashboard's
   availability tile can be populated from a real signal.
3. **Close the two HIGH security items** before any production-bound pilot — they
   are the top of the pilot risk register and the product-evolution roadmap.
4. **Feed the first pilot's evidence back** through Operational Learning → Product
   Evolution → Knowledge Base, exercising the loop end to end.
5. **Only then** consider a case study or a research write-up — filled from
   measured evidence, never before.

---

## 14. Conclusion

CDEP completes the reference manual for every future NeuroPause customer
deployment: an executable pilot methodology, a proven evidence-generation toolchain
wrapped in blank collection templates, a feedback-to-product loop, and a
knowledge base seeded only with what is real. It is the framework for turning
operational use into evidence — **without inventing a customer, a deployment, a
benchmark, an ROI, a case study, or a single operational fact.** The next move is
not more documentation; it is the first real pilot, which this program exists to
make repeatable, measurable, and honest.

---

_Backbone: [`docs/pilots/`](docs/pilots/README.md). Evidence tools: `bench/`,
`scripts/`, `/metrics`. Grounded in the prior programs: `ENTERPRISE-VALIDATION-REPORT.md`
(the reference evidence), `GLOBAL-ADOPTION-REPORT.md`, `ENTERPRISE-OPERATIONS-REPORT.md`.
The platform itself is unchanged — CDEP is deployment-and-evidence enablement, not
engineering._
