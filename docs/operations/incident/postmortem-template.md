# Postmortem — TEMPLATE

Blameless. Copy to `postmortem-YYYY-MM-DD-<slug>.md` after a SEV1/SEV2 and fill
within 5 business days. Focus on systems and contributing factors, not
individuals. `____` = to be filled.

## Header

- Incident id / link: `____`
- Severity: `____`
- Authors: `____`   Reviewers: `____`
- Date of incident: `____`   Postmortem date: `____`

## Impact

- What users experienced and for how long: `____`
- Measured RTO / data-loss window (RPO), if applicable: `____`
- SLO/error-budget consumed: `____`

## Timeline (condensed, UTC)

| Time | Event |
|------|-------|
| `____` | `____` |

## Root cause and contributing factors

- Trigger: `____`
- Root cause: `____`
- Contributing factors (what made it worse / slower to detect or fix): `____`

## What went well / what went poorly

- Well: `____`
- Poorly: `____`
- Where we got lucky: `____`

## Detection & response analysis

- Did an alert catch it? If not, why not (a monitoring gap to close)? `____`
- Was the runbook accurate and sufficient? `____`
- Time to acknowledge / mitigate / resolve: `____`

## Corrective actions (each an owned, tracked ticket)

| # | Action | Type (prevent / detect / mitigate) | Owner | Ticket | Due |
|---|--------|-------------------------------------|-------|--------|-----|
| 1 | `____` | `____` | `____` | `____` | `____` |

## Lessons for the docs

- Runbook/DR/plan updates required (PR link): `____`
- README measured-column updates (if a drill/recovery happened): `____`
