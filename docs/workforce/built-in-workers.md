# Built-in Workers

> Nine production workers, one per role — governed, evidence-grounded compositions of the intelligence layer.

Each built-in worker is created with the SDK (validated at construction),
registered on startup, and runs against a permission-scoped view of the UDM,
timeline, memory, and graph. Read skills analyse and cite; proposal skills emit
side-effecting actions that the Governance Runtime gates for human approval. When
there is no connected data for a skill, it returns an **honest empty result**
(`grounded: false`) rather than inventing one. New built-ins start at trust
`0.5`, so even their low-risk write proposals require approval until earned.

| Worker | Role | Skills | Proposes? |
| --- | --- | --- | --- |
| Founder AI | `founder` | `ask`, `briefing` | no (read-only) |
| Research AI | `research` | `scan`, `digest` | `propose:draft` |
| Engineering AI | `engineering` | `triage`, `standup` | no (read-only) |
| Marketing AI | `marketing` | `content-scan`, `draft-update` | `propose:draft` |
| Sales AI | `sales` | `pipeline`, `follow-up` | `propose:message` |
| Finance AI | `finance` | `spend-scan`, `summary` | no (read-only) |
| Legal AI | `legal` | `doc-review`, `stale-flag` | no (read-only) |
| Operations AI | `operations` | `briefing`, `recommend`, `remind`, `note` | `write:reminder`, `write:memory` |
| Support AI | `support` | `inbox`, `reply` | `propose:message` |

## How they compose the intelligence layer

- **Founder AI** and **Operations AI** wrap the deterministic Founder engine,
  briefing generator, and recommendation engine over the scoped snapshot.
- **Engineering AI** uses the recommendation engine to surface stale and blocked
  work.
- **Research / Marketing / Sales / Finance / Legal / Support** read the UDM
  directly (by entity kind and, for finance/legal, by title keywords) and, where
  relevant, the knowledge graph for context.

## Why some workers are deliberately read-only

Finance and Legal are read-only on purpose: acting on financial or legal matters
is high-stakes, and these workers will not fabricate transactions, figures, or
legal positions. They surface what exists and flag what may need a human's eyes —
no more. This is the same restraint the whole workforce applies, made explicit
where the stakes are highest.

## The proposal scopes, demonstrated

The built-ins exercise every side-effecting scope so the governance + approval
loop is observable out of the box: `propose:draft` (Research, Marketing),
`propose:message` (Sales, Support), `write:memory` and `write:reminder`
(Operations — the reminder is high-risk when a deadline is imminent, and always
requires approval). Every one of these parks for human approval before anything
is performed.
