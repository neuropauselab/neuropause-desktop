# NEMS Incident Management

How NEMS runs an incident: how one is declared, who does what, how we
communicate, and how we learn from it. This directory defines process and
provides blank templates. It records **no incidents** — a real incident is a
dated, filled copy of the templates below.

## Severity levels

Aligned with `../slo/SLO.md`. Severity is set by user/business impact, not by
which alert fired.

| Severity | Definition | Example signals | Response |
|----------|------------|-----------------|----------|
| **SEV1** | Full outage or data-loss risk | `EdgeDown`, `BackendNoHealthyReplicas`, `DatabaseUnavailable`, cluster loss | page immediately; all-hands; IC required |
| **SEV2** | Major degradation; SLO at risk | `HighErrorRateCritical`, `SLOAvailabilityFastBurn`, `RedisUnavailable`, OAuth outage | page; IC; active mitigation |
| **SEV3** | Minor degradation; budget not yet threatened | `HighErrorRate` (warning), `HighLatency`, `RedisFallbackEngaged` | ticket; handle in hours |
| **SEV4** | Cosmetic / no user impact | monitoring gap, single non-critical target down | backlog |

## Roles

| Role | Responsibility |
|------|----------------|
| **Incident Commander (IC)** | owns the incident; sets severity; makes the go/no-go on destructive actions (prod restore, cluster rebuild); is not usually the person typing commands |
| **Operator** | executes diagnosis/recovery from the runbooks |
| **Scribe** | keeps the timeline in the incident record (UTC, append-only) |
| **Comms** | posts status updates on cadence |

On a small team one person may wear several hats, but for SEV1/SEV2 the
**authorization** of a destructive action and its **execution** should be two
different people when possible.

## Lifecycle

1. **Detect** — an alert pages, or a human reports impact.
2. **Declare & triage** — open an incident record (`incident-template.md`),
   assign a severity and an IC, start the timeline.
3. **Mitigate** — work the matching runbook (`../runbooks/`); prefer the smallest
   action that restores service (roll back before you rebuild).
4. **Resolve** — service back within SLO; confirm with the runbook's Validation
   section; downgrade/close.
5. **Review** — for SEV1/SEV2, a blameless postmortem (`postmortem-template.md`)
   within 5 business days, with tracked corrective actions.

## Communication cadence

| Severity | Internal update | External (if user-facing) |
|----------|-----------------|---------------------------|
| SEV1 | every 30 min until mitigated | as policy dictates, prompt acknowledgement |
| SEV2 | every 60 min | if users are affected |
| SEV3 | at start and resolution | usually none |

Use `comms-templates.md` for the wording. Never state a cause or an ETA you have
not verified — "investigating" is an honest status.

## Declaring — quick checklist

- [ ] Impact stated in user terms (what is broken, for whom).
- [ ] Severity assigned; IC named.
- [ ] Incident record opened; timeline started (UTC).
- [ ] Matching runbook open.
- [ ] Comms started at the right cadence.

## Metrics we review afterward (from `../slo/SLO.md`)

MTTA, MTTR, alert-to-incident ratio, change-related incident rate, and error
budget consumed. These come from the incident records and the SLO queries — not
pre-filled here.

## Files

- `incident-template.md` — the live incident record (blank).
- `postmortem-template.md` — blameless postmortem (blank).
- `comms-templates.md` — status-update wording (blank fields).
