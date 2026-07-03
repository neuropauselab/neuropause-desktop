# Daily Intelligence — Architecture

> Phase 5 · Module 5. Evidence-grounded briefings, computed from the UDM and timeline.

## What it is

Daily Intelligence turns your connected work into a **briefing** for a period —
`morning`, `evening`, `weekly`, `monthly`, or `quarterly`. A briefing is a set
of sections (completed, in-progress, upcoming, meetings, documents, activity,
needs-attention), and **every line cites the exact records it came from**.

It is a **pure projection**, like everything else in Phase 5: it reads only the
Unified Data Model and the Enterprise Timeline, never a connector.

```
UDM + Enterprise Timeline → generateBriefing(period) → Briefing
```

## The honesty contract

There is **no language model** in the briefing path. Each section is built by a
deterministic filter over real entities/events, so the output can be traced back
to its source and **cannot be fabricated**. Two consequences:

- Every `BriefingItem` carries an `evidence: { kind, id }[]` back-pointer, and
  the briefing reports a total `evidenceCount`.
- When there is no connected data, the briefing returns `grounded: false`, all
  sections `empty`, and a plain headline — *"No connected data yet — connect an
  account to receive grounded briefings."* It never invents a "productive day".

## How a period is built

`rangeFor(period, now)` produces an inclusive window: morning/evening cover
**today** (since local midnight), weekly/monthly/quarterly cover the trailing
7 / 30 / 90 days. Sections are then computed:

| Section | Source | Rule |
| --- | --- | --- |
| Completed | UDM | entities whose status classifies as completed, updated in range |
| In progress | UDM | open tasks |
| Upcoming | UDM | calendar events/meetings with a **future** timestamp |
| Meetings | UDM | past meetings/events in range |
| Documents | UDM | documents updated in range |
| Activity | Timeline | events in range, grouped by category with sample ids |
| Needs attention | UDM | open tasks idle > 7 days, plus unread notifications |

Status is heterogeneous across connectors (`open`/`closed`, `active`/`archived`,
`unread`/`read`, `confirmed`), so `classifyStatus()` normalizes it into coarse
classes (`completed` / `open` / `archived` / `unread` / `other`). The normalizer
is deliberately conservative and falls back to `other`.

The `headline` is a deterministic one-liner assembled from the section counts —
e.g. *"This week: 4 completed, 7 in progress, 2 meetings."*

## Where it lives

- Types — `packages/shared/src/types/intelligence.ts`
- Generator (pure) — `apps/desktop/src/main/intelligence/briefingGenerator.ts`
- Shared classifiers — `apps/desktop/src/main/intelligence/classify.ts`
- Composition root — `apps/desktop/src/main/intelligence/index.ts`
- IPC — `intelligence:briefing`; renderer `ipc.intelligence.briefing(period)`
- Dashboard — Operations → **Intelligence**

## Retrieval seam

Briefings rank by recency and status today. The same lexical/semantic seam used
by AI Memory and Enterprise Search is available here for future scoring (e.g.
salience ranking via embeddings) without changing the briefing contract.
