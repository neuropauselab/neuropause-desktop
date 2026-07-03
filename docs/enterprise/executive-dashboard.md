# Executive Dashboard

> The live executive snapshot. Source:
> `apps/desktop/src/main/enterprise/dashboard/executiveDashboard.ts`.
> **Pure aggregation.**

`computeExecutiveSnapshot(input)` rolls every layer into one `ExecutiveSnapshot`:

| Section | What it reports | Derived from |
| --- | --- | --- |
| `organization` | member counts, leadership coverage, health score | org runtime |
| `workforce` | idle/running, health states, avg trust, jobs, success rate | registry + jobs |
| `activity` | projects, tasks, documents, customers, events, recent | unified + timeline |
| `risk` | level, open + critical findings, top items | compliance findings |
| `approvals` | pending, decided, oldest pending age | jobs/proposals |
| `intelligence` | briefing headline, top recommendations, grounded | intelligence engines |
| `operations` | connectors, accounts, installed apps, audit entries | connectors + registry |

## The one composite: org health score

Everything is a direct count except the org health score, which is explicit:

```
healthScore = 0.4 · workerHealthShare
            + 0.3 · compliancePassRate
            + 0.3 · leadershipCoverage
```

- `workerHealthShare = (workers − degraded − unhealthy) / workers`
- `compliancePassRate = passing findings / evaluated findings`
- `leadershipCoverage = units with a lead / units`

Each term is `1` when its denominator is zero (nothing to flag). The label is
`Healthy ≥ 0.85`, `Watch ≥ 0.6`, else `At risk`.

## Honest empty state

With no connected data, activity counts are zero, the briefing is `grounded:
false`, risk is `low`, and approvals are empty — the snapshot reports the truth,
it does not invent numbers.

## Channel

- `enterprise:dashboard` → `ExecutiveSnapshot`
