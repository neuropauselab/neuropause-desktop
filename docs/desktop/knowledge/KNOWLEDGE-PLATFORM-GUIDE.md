# Enterprise Knowledge & Decision Platform — architecture guide (Phase 6 Stage 7)

Stage 7 turns NEMS into the organization's institutional memory **without building any new
knowledge machinery**: no second knowledge graph, document repository, memory system, search
engine, or governance framework — and no knowledge-asset store. One additive subsystem
(`apps/desktop/src/main/knowledgeAssets/`) classifies and composes records the platform already
holds.

## What exists vs. what Stage 7 adds

Reused unchanged: the Enterprise Knowledge Graph (typed nodes/edges with UDM evidence +
relationship history), AI Memory (evidence-carrying items, governed writes), the P16 Knowledge
Fabric (`knowledge:read` — the RBAC scope Stage 7 reuses), the Decision Store (8-state governed
lifecycle + append-only history), Governance (approval chains, compliance rules, hash-chained
audit), the versioned Prompt Manager, Enterprise Search (entity/graph/memory/timeline/federation),
the delivery engine and its gates, the Workspace Assistant, and the Stage 6 Enterprise
Intelligence Layer.

Added (all composition, all read-only):

```
main/knowledgeAssets/
  assetRegistry.ts       the 11-class registry as typed data (doc-locked to KNOWLEDGE-ASSETS.md)
  assetInventory.ts      classify existing records → KnowledgeAsset envelopes (enhancement #1:
                         criticality / retention / review owner / provenance chain)
  authorityResolution.ts enhancement #4: Governed Decision → Governance Policy → Organization
                         Standard → Approved Document → Versioned Prompt → Provider Document →
                         Explicit Memory → Derived Knowledge, then freshness, then stable id
  relationshipMatrix.ts  foundational artifact #2 (computed, never persisted) + enhancement #3:
                         impact analysis over decisions/workflows/policies/connectors/intelligence
  decisionLineage.ts     origin → discussion → evidence → approval → implementation →
                         verification → status, every stage backed by a real record or absent
  coverageMap.ts         enhancement #2: documentation coverage across the 8 organizational
                         domains + org-unit ownership coverage, no new storage
  quality.ts             9 dimensions + 8 deterministic finding rules, all evidence-cited
  standards.ts           per-domain current standard via the authority resolution; "no standard
                         defined" is a first-class honest answer
  knowledgeModel.ts      the ten question resolvers · hygiene recommendations · dashboard ·
                         search lens (a pure JOIN over the existing federated search)
  index.ts               composition root: injected reads, 3 s TTL, six read-only kb:* channels
                         (knowledge:read), the assistant knowledgeAnswer port, one daily
                         knowledge-hygiene delivery source
```

Renderer: one **Knowledge Platform** tab inside the existing Knowledge workspace
(`renderer/src/knowledgeAssets/` — pure model + host + view), a `kb` namespace in `lib/ipc.ts`, a
mute row for the hygiene source, a `knowledge` deep-link, and one capability-registry entry.

## Surfaces

- **IPC (6 channels, all `requireAuth` + `knowledge:read`, zero mutations):** `kb:inventory`
  (filters + the search-lens text join), `kb:matrix` (no arg → the matrix; `assetId` → impact
  analysis), `kb:lineage` (`decisionId` optional), `kb:quality`, `kb:standards`, `kb:dashboard`.
  The `kb:` prefix is registered in the runtime-authz completeness lock's self-gated list (the
  `insight:` precedent); `index.stage7.test.ts` locks every handler's gating.
- **Assistant (7.11):** `knowledgeAnswer` in-process port (the Stage 6 `intelligenceAnswer`
  precedent). Answers ride the existing `'intelligence'` structured-report kind (approved D-8),
  cite evidence ids, state the authority tier, declare classification uncertainty, and list
  related assets from the matrix. Questions the records cannot answer get an honest
  "not documented". Anything that would change knowledge remains an approval-gated plan step.
- **Monitoring:** one delivery-engine source (`knowledge-hygiene`, daily 09:00) producing governed
  recommendation items only — evidence, source systems, confidence, reasoning, recommended action.
- **Events:** none added — knowledge writes already emit through their own stores.

## Honesty rules (enforced by tests)

Classification confidence + matched signals are declared per asset; unowned stays unowned;
lifecycle without a marker is `null` ("unclassified") with its basis; empty classes are gaps;
`capability-standard` is a declared main-process boundary; the workflow-definition library is a
documented non-existence (assets derive from observed runs); conflicts require cited overlapping
evidence and name their precedence winner; broken-reference detection declares its id-shape
heuristic; per-source read failures isolate into `unavailable` entries. **No transition executor
exists anywhere in the subsystem** — the declared transition table documents governance, and the
only mutation paths remain the pre-existing governed writes.

## Performance (7.12)

All composition is O(records) over already-loaded reads; matrix traversal reuses the existing
GraphStore adjacency queries; one 3 s TTL cache bounds repeated loads. The Stage 7 bench
(`knowledgeBench.test.ts`) locks: knowledge compose ≤ 100 ms, matrix (graph-fed) ≤ 100 ms,
decision lineage ≤ 100 ms, dashboard ≤ 500 ms — at 5 000 entities / 1 000 memories / 500
decisions of synthetic-but-shaped data.
