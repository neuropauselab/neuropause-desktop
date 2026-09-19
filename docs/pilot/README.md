# NeuroPause — Customer Deployment & Evidence Program (CDEP)

The **reference manual for running real customer pilots and collecting operational
evidence**. Every document is **executable** and ships **blank** — a methodology,
checklist, template, or rubric that a real deployment fills with measured evidence.

> **No pilot has run.** No customer, deployment, benchmark result, ROI, case study,
> satisfaction score, or published paper exists or is claimed anywhere here. The
> evidence-_generation_ tools are real and proven; the customer's _evidence_ is
> produced by running them at pilot time. Platform maturity: **Validated Release
> Candidate**.

Final synthesis: [`../../CUSTOMER-DEPLOYMENT-REPORT.md`](../../CUSTOMER-DEPLOYMENT-REPORT.md).

## Run a pilot in this order

| Step                        | Document                                                                                        |
| --------------------------- | ----------------------------------------------------------------------------------------------- |
| 0. Check readiness          | [Pilot & Evidence Matrices](PILOT-MATRICES.md)                                                  |
| 1. Frame the pilot          | [Pilot Framework](PILOT-FRAMEWORK.md) — entry/success/rollback/exit                             |
| 2. Deploy                   | [Deployment Automation](DEPLOYMENT-AUTOMATION.md) — real-command checklists                     |
| 3. Collect evidence         | [Evidence Collection](EVIDENCE-COLLECTION.md) — run the harnesses                               |
| 4. Gather feedback          | [Customer Feedback](CUSTOMER-FEEDBACK.md) — interview instruments                               |
| 5. Score the deployment     | [Deployment Quality](DEPLOYMENT-QUALITY.md) — blank scorecards                                  |
| 6. Review & learn           | [Operational Learning](OPERATIONAL-LEARNING.md) — post-deploy + RCA                             |
| 7. Report to execs          | [Executive Evidence](EXECUTIVE-EVIDENCE.md) — blank dashboards                                  |
| 8. Feed the product         | [Product Evolution](PRODUCT-EVOLUTION.md) — evidence-based roadmap                              |
| 9. (Optional) write it up   | [Case Study Templates](CASE-STUDY-TEMPLATES.md) · [Research Validation](RESEARCH-VALIDATION.md) |
| 10. Grow the knowledge base | [Product Intelligence](PRODUCT-INTELLIGENCE.md)                                                 |

## The program

| Area                                    | Document                                             |
| --------------------------------------- | ---------------------------------------------------- |
| Authoring anchor (real tooling + rules) | [_grounding.md](_grounding.md)                       |
| Readiness matrices                      | [PILOT-MATRICES.md](PILOT-MATRICES.md)               |
| Pilot methodology                       | [PILOT-FRAMEWORK.md](PILOT-FRAMEWORK.md)             |
| Evidence collection                     | [EVIDENCE-COLLECTION.md](EVIDENCE-COLLECTION.md)     |
| Customer feedback                       | [CUSTOMER-FEEDBACK.md](CUSTOMER-FEEDBACK.md)         |
| Deployment automation                   | [DEPLOYMENT-AUTOMATION.md](DEPLOYMENT-AUTOMATION.md) |
| Operational learning                    | [OPERATIONAL-LEARNING.md](OPERATIONAL-LEARNING.md)   |
| Case study templates                    | [CASE-STUDY-TEMPLATES.md](CASE-STUDY-TEMPLATES.md)   |
| Executive evidence                      | [EXECUTIVE-EVIDENCE.md](EXECUTIVE-EVIDENCE.md)       |
| Product evolution                       | [PRODUCT-EVOLUTION.md](PRODUCT-EVOLUTION.md)         |
| Research validation                     | [RESEARCH-VALIDATION.md](RESEARCH-VALIDATION.md)     |
| Deployment quality                      | [DEPLOYMENT-QUALITY.md](DEPLOYMENT-QUALITY.md)       |
| Product intelligence (KB)               | [PRODUCT-INTELLIGENCE.md](PRODUCT-INTELLIGENCE.md)   |

## The evidence toolchain (real, proven)

A pilot generates its own evidence by running these against the customer instance:
`bench/http-load.mjs`, `bench/db-latency.mjs`, `bench/startup.sh` (performance);
the reliability procedures in [`../validation/RELIABILITY-RESULTS.md`](../validation/RELIABILITY-RESULTS.md);
`scripts/backup-db.sh` + `scripts/restore-db.sh` (data integrity); and the
`/metrics` + `/health` + `audit_log` substrate. Our own reference results are in
[`../../bench/results/`](../../bench/results/) — the floor a pilot re-measures
against, never a customer number.

## Honesty note

This program makes a real pilot **possible, repeatable, and measurable**. It does
not claim a pilot has happened. Every blank is a blank on purpose.
