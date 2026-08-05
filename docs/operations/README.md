# NeuroPause / NEMS — Operations

This directory holds two complementary operations layers. Neither replaces the
other.

1. **Production Operations (Phase 5)** — concrete, deployable operations wired to
   the **live production environment** (the `nems-prod` DOKS cluster and
   `https://api.neuropause033.com`): monitoring, alerting, backups, disaster
   recovery, per-alert runbooks, and enterprise manuals. Go here to run the
   running service.
2. **Enterprise Operations & Scale Program (EOSP)** — the business-scale
   **operating frameworks** (how to run NeuroPause as a software business at
   scale): support, security, release, business, developer, executive, global
   scaling, compliance, and continuous improvement.

EOSP is the organizational/program layer; Phase 5 is the technical operations
layer bound to the real running system. Where they overlap (e.g. SRE/SLOs,
security, runbooks), EOSP defines the framework and Phase 5 provides the concrete,
wired implementation for `nems-prod`.

---

## Production Operations (Phase 5)

Start with the [Operations Guide](./manuals/OPERATIONS-GUIDE.md) for orientation,
or the [On-Call Guide](./manuals/ONCALL-GUIDE.md) if you're holding the pager.

| Area | Path | What's there |
|------|------|--------------|
| Enterprise manuals | [`manuals/`](./manuals/) | Operations Guide, Production Manual, On-Call Guide, Architecture-Ops, Business Continuity, Disaster Recovery |
| Runbooks (12, per-alert) | [`runbooks/`](./runbooks/) | one per failure scenario; Detection/Diagnosis/Recovery/Validation/Escalation; linked from live alert `runbook_url`s |
| SLO / error budget | [`slo/SLO.md`](./slo/SLO.md) | SLIs, SLOs, budget policy, severities |
| Incident management | [`incident/`](./incident/) | process, severities, blank incident/postmortem/comms templates |
| Disaster recovery | [`dr/`](./dr/) | DR plan, cluster rebuild, evidence template |
| Capacity | [`capacity/CAPACITY-PLAN.md`](./capacity/CAPACITY-PLAN.md) | provisioned resources, headroom queries, scaling triggers |
| Maintenance | [`maintenance/MAINTENANCE.md`](./maintenance/MAINTENANCE.md) | upgrades, rotation, routine care |
| Completion report | [`PHASE5-COMPLETION-REPORT.md`](./PHASE5-COMPLETION-REPORT.md) | components, capabilities, deferred items, pre-Phase-6 validation |

Companion deploy directories:

| Area | Path | What's there |
|------|------|--------------|
| Observability | [`../../deploy/observability/`](../../deploy/observability/) | kube-prometheus-stack values, ServiceMonitors, probes, alert + SLO rules, Grafana dashboards, Alertmanager routing |
| Backups | [`../../deploy/backup/`](../../deploy/backup/) | PostgreSQL/Qdrant backup automation, restore-test, verifier, retention |

The Phase 5 manuals:

| Manual | Read it for |
|--------|-------------|
| [Operations Guide](./manuals/OPERATIONS-GUIDE.md) | day-to-day orientation and routine duties |
| [Production Manual](./manuals/PRODUCTION-MANUAL.md) | the authoritative inventory + invariants |
| [On-Call Guide](./manuals/ONCALL-GUIDE.md) | what to do when paged |
| [Architecture Operations Manual](./manuals/ARCHITECTURE-OPS-MANUAL.md) | the request path, failure modes per hop |
| [Business Continuity Manual](./manuals/BUSINESS-CONTINUITY-MANUAL.md) | critical functions, SPOFs, continuity strategy |
| [Disaster Recovery Manual](./manuals/DISASTER-RECOVERY-MANUAL.md) | consolidated DR view + drill program |

---

## Enterprise Operations & Scale Program (EOSP)

The **internal operating manual** for running NeuroPause as a software business at
scale. Every document is **executable** (runbooks, cadences, checklists, decision
rules) and **grounded** in a real asset — none fabricates operational metrics,
uptime, customers, revenue, or certifications. These frameworks were authored as a
scale program and state plainly where a system is absent or a metric has no data
yet; Phase 5 above is where concrete operations bind to the real `nems-prod`
environment.

Final synthesis: [`../../ENTERPRISE-OPERATIONS-REPORT.md`](../../ENTERPRISE-OPERATIONS-REPORT.md).

### By operational role

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

### The program

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

> Runbook note: EOSP's framework-level runbooks are at
> [`../validation/OPERATIONAL-RUNBOOKS.md`](../validation/OPERATIONAL-RUNBOOKS.md);
> the Phase 5 per-alert runbooks wired to live alerts are in [`runbooks/`](./runbooks/).
> They are complementary — the former is the operating framework, the latter is the
> concrete incident response for the running cluster.

### The measured spine (real)

All capacity math derives from EVP measurements (2-vCPU reference, 0 errors): one
replica ≈ **400–600 rps** DB reads, **~230 MB** RSS, **≤10** DB connections; Argon2
verify **~20 ms** (auth ≈ 50/s/core); restart **0.46 s**. Fleet figures are
projections from this floor — see [`SRE.md`](SRE.md) §capacity and
[`../../bench/results/`](../../bench/results/).

---

## Honesty boundary (applies to everything here)

The Phase 5 documents and manifests create **capability** and **operational
documentation**. They do not assert that monitoring is scraping, that alerts have
delivered, that any backup or restore has run, or that any DR drill has happened;
every such live validation is listed as required before Phase 6 in the
[completion report](./PHASE5-COMPLETION-REPORT.md) and the relevant READMEs, and
targets (e.g. RTOs) are labelled as targets until a dated record measures them.
The EOSP frameworks likewise define **how** NeuroPause is operated at scale
without claiming it **is** operated at scale, and say so plainly where a system is
absent or a metric has no data yet.
