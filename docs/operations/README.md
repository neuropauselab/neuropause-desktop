# NEMS Operations

Everything needed to run NEMS in production as an enterprise service. Added in
Phase 5 (Enterprise Operations). Phases 1–4 (build, deploy, networking, OAuth)
are complete and immutable; this tree operates what they built and does not
change it.

Start with the [Operations Guide](./manuals/OPERATIONS-GUIDE.md) for orientation,
or the [On-Call Guide](./manuals/ONCALL-GUIDE.md) if you're holding the pager
right now.

## Map

| Area | Path | What's there |
|------|------|--------------|
| Enterprise manuals | [`manuals/`](./manuals/) | Operations Guide, Production Manual, On-Call Guide, Architecture-Ops, Business Continuity, Disaster Recovery |
| Runbooks (12) | [`runbooks/`](./runbooks/) | one per failure scenario; Detection/Diagnosis/Recovery/Validation/Escalation |
| SLO / error budget | [`slo/SLO.md`](./slo/SLO.md) | SLIs, SLOs, budget policy, severities |
| Incident management | [`incident/`](./incident/) | process, severities, and blank incident/postmortem/comms templates |
| Disaster recovery | [`dr/`](./dr/) | DR plan, cluster rebuild, evidence template |
| Capacity | [`capacity/CAPACITY-PLAN.md`](./capacity/CAPACITY-PLAN.md) | provisioned resources, headroom queries, scaling triggers |
| Maintenance | [`maintenance/MAINTENANCE.md`](./maintenance/MAINTENANCE.md) | upgrades, rotation, routine care |

Companion directories under `deploy/`:

| Area | Path | What's there |
|------|------|--------------|
| Observability | [`deploy/observability/`](../../deploy/observability/) | kube-prometheus-stack values, ServiceMonitors, probes, alert rules, SLO rules, Grafana dashboards, Alertmanager routing |
| Backups | [`deploy/backup/`](../../deploy/backup/) | PostgreSQL/Qdrant backup automation, restore-test, verifier, retention |

## The manuals

| Manual | Read it for |
|--------|-------------|
| [Operations Guide](./manuals/OPERATIONS-GUIDE.md) | day-to-day orientation and routine duties |
| [Production Manual](./manuals/PRODUCTION-MANUAL.md) | the authoritative inventory + invariants |
| [On-Call Guide](./manuals/ONCALL-GUIDE.md) | what to do when paged |
| [Architecture Operations Manual](./manuals/ARCHITECTURE-OPS-MANUAL.md) | the request path, failure modes per hop |
| [Business Continuity Manual](./manuals/BUSINESS-CONTINUITY-MANUAL.md) | critical functions, SPOFs, continuity strategy |
| [Disaster Recovery Manual](./manuals/DISASTER-RECOVERY-MANUAL.md) | consolidated DR view + drill program |

## Honesty boundary (applies to everything here)

These documents and manifests create **capability** and **operational
documentation**. They do not assert that monitoring is scraping, that alerts have
delivered, that any backup or restore has run, or that any DR drill has happened.
Every such live validation is listed as required before Phase 6 in the Phase 5
completion report and the relevant READMEs. Targets (e.g. RTOs) are labelled as
targets until a dated record measures them.
