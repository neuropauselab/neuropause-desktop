# Traces — Architecture

> Phase 5 · Modules 8–10. Explainability over the intelligence layer: Governance, Context, and Relationship traces.

The three traces all answer the same kind of question — *"show me how this
connects"* — over the layers Phase 5 already builds (UDM, Knowledge Graph,
Timeline, Memory). Each builder is **pure**: its data (and, where the graph is
involved, lookups) are injected, so all three unit-test without Electron.

---

## Governance Trace™ (M8)

**What it is.** For a recorded **decision**, assemble the chain behind it: the
decision record, its actor, the entities it references (resolved to titles), and
the timeline events touching those entities.

**Source.** Decisions live in AI Memory (`kind: 'decision'`, explicit or
projected). `listGovernanceDecisions()` enumerates them; `buildGovernanceTrace()`
resolves one decision's `entityRefs` against the UDM and gathers the events that
touch those entities.

**Honest empty slots.** A full governance record also has **approvals** and
**policies**. There is no approval or policy source connected today, so those
fields are present in the type but **always empty** — the dashboard says plainly
*"Approvals & policies: none — no approval source is connected yet."* They are
reserved for a future connector, not faked.

---

## Context Trace™ (M9)

**What it is.** Everything known about a **subject** over time: its timeline
(events referencing it, newest first), its graph-related entities (neighbors),
and the memories about it.

**Source.** `buildContextTrace(entityId, …)` filters the timeline by entity
reference, maps the subject's graph neighbors to related entities, and recalls
memories whose `entityRefs` include the subject. `grounded` is true if any of
subject / timeline / related / memories is non-empty.

---

## Relationship Trace™ (M10)

**What it is.** A relationship-first view of the Knowledge Graph: an entity's
**typed relationships** (grouped and counted by edge type and direction), and the
**path** between two entities.

**Source.** This is a thin, relationship-shaped façade over the EKG.
`buildRelationshipTrace(nodeId, …)` uses the graph's neighbor lookup and groups
edges by type into `byType`; `buildRelationshipPath(from, to, …)` resolves the
graph's shortest path into ordered entity references. The EKG already computes
neighbors and paths — the trace just presents them.

---

## Where it lives

- Types — `packages/shared/src/types/trace.ts`
- Builders (pure) — `apps/desktop/src/main/trace/traceBuilders.ts`
- Composition root — `apps/desktop/src/main/trace/index.ts` (wires UDM, timeline, memory, graph)
- IPC — `governance:list`, `governance:trace`, `context:trace`, `relationship:trace`, `relationship:path`
- Renderer — `ipc.governance.{list,trace}`, `ipc.context.trace`, `ipc.relationship.{trace,path}`
- Dashboard — Operations → **Traces** (Governance decision chains + Relationship explorer)
