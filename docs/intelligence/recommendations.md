# Recommendation Engine — Architecture

> Phase 5 · Module 6. What to do next, derived from the UDM and timeline — with evidence.

## What it is

The Recommendation Engine surfaces **next actions**: continue/stale tasks,
stalled projects, unread items, and upcoming deadlines. Each recommendation is
produced by a deterministic rule and **cites the records that triggered it**.

```
UDM + Enterprise Timeline → generateRecommendations(query?) → Recommendation[]
```

The engine is pure — entities and timeline events are injected — so it unit-tests
from synthetic data and has no Electron dependency.

## The rules

| Kind | Trigger | Priority |
| --- | --- | --- |
| `next_task` | an open task touched recently | normal |
| `stale_task` | an open task with no update in **> 14 days** | high |
| `blocked_project` | an active project with open child tasks **and** no recorded timeline activity in > 14 days | high |
| `unanswered` | an unread notification | normal |
| `upcoming_deadline` | a calendar event within the next **3 days** | high if < 24h |

A task is classified as `stale_task` **or** `next_task`, never both. "Recorded
activity" for the stalled-project rule comes from the Enterprise Timeline: the
engine indexes the latest event per entity and treats a project with no recent
events as idle.

## Scoring and evidence

Each recommendation gets a `score` in `0..1` (base-by-kind, adjusted by age), and
results are ranked descending and capped by the optional `limit`. Every one
carries `entityRefs` and `evidence: { kind, id }[]`, so the UI can show — and a
human can verify — *why* it surfaced.

## The honesty contract

No language model is involved; recommendations are computed, so they cannot be
invented. With no connected data the `RecommendationSet` reports `grounded:
false` and an empty list. A recommendation is explicitly a **suggestion** — when
Founder AI consumes these, it keeps them out of its "facts" and presents them
only as suggestions (see `founder-ai.md`).

## Where it lives

- Types — `packages/shared/src/types/recommendations.ts`
- Engine (pure) — `apps/desktop/src/main/recommendations/recommendationEngine.ts`
- Composition root — `apps/desktop/src/main/recommendations/index.ts`
- IPC — `recommendations:generate`; renderer `ipc.recommendations.generate(query?)`
- Dashboard — Operations → **Intelligence** (Recommendations section)
