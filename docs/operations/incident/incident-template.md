# Incident — TEMPLATE

Copy to `incident-YYYY-MM-DD-<slug>.md` and fill live. `____` = not yet known;
do not guess. This blank template is not an incident record.

## Summary

- Incident id: `____`
- Severity: ☐ SEV1 ☐ SEV2 ☐ SEV3 ☐ SEV4
- Status: ☐ investigating ☐ identified ☐ mitigating ☐ monitoring ☐ resolved
- Incident Commander: `____`   Operator: `____`   Scribe: `____`   Comms: `____`
- User-facing impact (in plain terms): `____`
- Started (UTC): `____`   Detected (UTC): `____`   Resolved (UTC): `____`

## Detection

- How detected: ☐ alert (`____`) ☐ user report ☐ synthetic check ☐ other: `____`

## Timeline (append-only, UTC)

| Time | Who | What happened / action taken | Result |
|------|-----|------------------------------|--------|
| `____` | `____` | `____` | `____` |

## Impact

- Services/endpoints affected: `____`
- SLO/error-budget impact: `____`
- Data loss? ☐ no ☐ yes → window: `____`

## Diagnosis

- Runbook(s) used: `____`
- Leading hypothesis and evidence: `____`

## Mitigation & resolution

- Action that restored service: `____`
- Validation (runbook Validation section results): `____`

## Follow-ups

Link the postmortem (`postmortem-YYYY-MM-DD-<slug>.md`) for SEV1/SEV2. List
immediate corrective actions as tickets:

| Action | Owner | Ticket | Due |
|--------|-------|--------|-----|
| `____` | `____` | `____` | `____` |

## Metrics (fill at close)

- Time to acknowledge (MTTA): `____`
- Time to resolve (MTTR): `____`
- Change-related? ☐ yes ☐ no
