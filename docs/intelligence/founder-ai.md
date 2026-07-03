# Founder AI — Architecture

> Phase 5 · Module 7. Evidence-grounded answers that separate facts from suggestions — no LLM.

## What it is

Founder AI answers natural-language questions about the business **only from
connected data**. It is built around one hard rule: a **fact** (read directly
from the UDM / graph / timeline, with evidence) and a **suggestion** (a derived
recommendation) are never mixed. They are returned in separate arrays so neither
the UI nor the reader can mistake one for the other.

```
question → classifyIntent → compute facts + suggestions (+ references) → FounderAnswer
```

## Why there is no language model

A generative model asked "what's the status of Apollo?" can produce fluent,
plausible, and **wrong** answers — it can invent a deadline or a blocker that
isn't in your data. Founder AI instead routes the question to a rule and computes
the answer, so:

- every fact has an `evidence: { kind, id }[]` back-pointer;
- nothing is asserted that isn't in the connected data;
- when nothing matches, it says so (`grounded: false`, empty arrays, an honest
  summary) rather than guessing.

## Intent routing

`classifyIntent(text)` matches the question to one of seven intents by keyword:

| Intent | Example | What it computes |
| --- | --- | --- |
| `overview` | "give me an overview" | counts of projects/tasks/docs/meetings + recent records; suggestions from the recommendation engine |
| `status` | "status of Apollo?" | resolves the subject, reports its status, open/total child tasks, last activity |
| `blocked` | "what's blocked?" | stalled-project / stale-task **observations as facts**, the action **as a suggestion** |
| `activity` | "what happened this week?" | timeline events (optionally scoped to a subject), grouped by category |
| `count` | "how many open tasks?" | the count for the requested kind, with sample evidence |
| `find` | "find the billing spec" | entities whose title matches the query terms |
| `who` | "who works on Apollo?" | people linked to the subject in the knowledge graph |

### Subject resolution

For `status` / `who` / `activity`, `resolveSubject()` finds the entity whose
title best overlaps the question's words (token-overlap ≥ 0.5). Because
entity-derived graph nodes use the entity id as the node id, a resolved subject
maps straight to its graph neighbors for the `who` answer.

### Facts vs suggestions, concretely

For `blocked`, the engine reuses the Recommendation Engine. The **observation**
("Zephyr has 3 open tasks and no activity in 21 days") becomes a **fact**; the
**action** ("Project may be stalled: Zephyr") becomes a **suggestion**. This is
the clearest illustration of the separation the whole module is built around.

## Where it lives

- Types — `packages/shared/src/types/founder.ts`
- Engine (pure) — `apps/desktop/src/main/founder/founderEngine.ts`
- Composition root — `apps/desktop/src/main/founder/index.ts` (wires UDM, timeline, graph neighbors)
- IPC — `founder:ask`; renderer `ipc.founderAI.ask(text)`
- Dashboard — Operations → **Founder AI** (Facts in solid green, Suggestions in dashed orange)
