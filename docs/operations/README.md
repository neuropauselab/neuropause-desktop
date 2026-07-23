# NeuroPause — Enterprise Operations & Scale Program (EOSP)

The **internal operating manual** for running NeuroPause as a software business at
scale. Every document is **executable** (runbooks, cadences, checklists, decision
rules) and **grounded** in a real asset — none fabricates operational metrics,
uptime, customers, revenue, or certifications. Platform maturity: **Validated
Release Candidate**. There is **no production fleet**, so SLOs are proposed targets
and operational history does not yet exist.

Final synthesis: [`../../ENTERPRISE-OPERATIONS-REPORT.md`](../../ENTERPRISE-OPERATIONS-REPORT.md).

## By operational role

| You run…              | Read                                                                         |
| --------------------- | ---------------------------------------------------------------------------- |
| Day-to-day operations | [Enterprise Operations](ENTERPRISE-OPERATIONS.md)                            |
| Reliability / on-call | [SRE](SRE.md), [Operational Runbooks](../validation/OPERATIONAL-RUNBOOKS.md) |
| Customer support      | [Customer Support](CUSTOMER-SUPPORT.md)                                      |
| Security              | [Security Operations](SECURITY-OPERATIONS.md)                                |
| Releases              | [Release Operations](RELEASE-OPERATIONS.md)                                  |
| Sales / renewals      | [Business Operations](BUSINESS-OPERATIONS.md)                                |
| Engineering           | [Developer Operations](DEVELOPER-OPERATIONS.md)                              |
| Exec / strategy       | [Executive Operations](EXECUTIVE-OPERATIONS.md)                              |
| Global scale          | [Global Scaling](GLOBAL-SCALING.md)                                          |
| Compliance / audit    | [Compliance Operations](COMPLIANCE-OPERATIONS.md)                            |
| Improvement           | [Continuous Improvement](CONTINUOUS-IMPROVEMENT.md)                          |

## The program

| Area                                                | Document                                               |
| --------------------------------------------------- | ------------------------------------------------------ |
| Authoring anchor (real coefficients + rules)        | [_grounding.md](_grounding.md)                         |
| Enterprise operations (cadence + capacity + KPIs)   | [ENTERPRISE-OPERATIONS.md](ENTERPRISE-OPERATIONS.md)   |
| Customer support (org, tickets, SLA)                | [CUSTOMER-SUPPORT.md](CUSTOMER-SUPPORT.md)             |
| Site reliability (SLIs/SLOs/error budgets/capacity) | [SRE.md](SRE.md)                                       |
| Security operations (IR, vuln, patch)               | [SECURITY-OPERATIONS.md](SECURITY-OPERATIONS.md)       |
| Release operations (calendar, hotfix, rollback)     | [RELEASE-OPERATIONS.md](RELEASE-OPERATIONS.md)         |
| Business operations (sales/renewal/reporting)       | [BUSINESS-OPERATIONS.md](BUSINESS-OPERATIONS.md)       |
| Developer operations (workflow, gates, DORA)        | [DEVELOPER-OPERATIONS.md](DEVELOPER-OPERATIONS.md)     |
| Executive operations (dashboards, risk register)    | [EXECUTIVE-OPERATIONS.md](EXECUTIVE-OPERATIONS.md)     |
| Global scaling (regions, i18n, multi-region)        | [GLOBAL-SCALING.md](GLOBAL-SCALING.md)                 |
| Compliance operations (SOC 2 / ISO readiness)       | [COMPLIANCE-OPERATIONS.md](COMPLIANCE-OPERATIONS.md)   |
| Continuous improvement (maturity + backlog)         | [CONTINUOUS-IMPROVEMENT.md](CONTINUOUS-IMPROVEMENT.md) |

## The measured spine (real)

All capacity math derives from EVP measurements (2-vCPU reference, 0 errors): one
replica ≈ **400–600 rps** DB reads, **~230 MB** RSS, **≤10** DB connections; Argon2
verify **~20 ms** (auth ≈ 50/s/core); restart **0.46 s**. Fleet figures are
projections from this floor — see [`SRE.md`](SRE.md) §capacity and
[`../../bench/results/`](../../bench/results/).

## Honesty note

These frameworks define **how** NeuroPause is operated; they do not claim it **is**
being operated at scale. Where a system is absent (alerting, tracing, BI,
multi-region, i18n) or a metric has no data yet (SLOs, availability), the documents
say so plainly.
