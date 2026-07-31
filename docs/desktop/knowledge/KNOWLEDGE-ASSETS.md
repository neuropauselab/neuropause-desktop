# Knowledge Asset Inventory — the Stage 7 class registry

This document is the human-readable mirror of `apps/desktop/src/main/knowledgeAssets/assetRegistry.ts`
(the single source of truth as typed data). A registry test locks every class id, authority rank,
and standard domain listed here against the code — editing one side without the other fails CI.

Assets are **classifications of existing records, never copies**: every `KnowledgeAsset` carries the
real record id + source system, is computed per read (3 s TTL), and is stored nowhere. A class with
zero backing records renders as a **documentation gap** — never a fabricated asset.

## Authority precedence (enhancement #4 — deterministic)

Whenever conflicting assets exist, precedence is exactly:

| Rank | Key | Meaning |
|---|---|---|
| 1 | `governed-decision` | Governed Decision (decision store, 8-state lifecycle) |
| 2 | `governance-policy` | Governance Policy (approval chains + compliance rules) |
| 3 | `organization-standard` | Organization Standard (org-defined records) |
| 4 | `approved-document` | Approved Document (document with an explicit approval marker) |
| 5 | `versioned-prompt` | Versioned Prompt (code-shipped, version-pinned) |
| 6 | `provider-document` | Provider Document (synced content, org authority unknown) |
| 7 | `explicit-memory` | Explicit Memory (authored) |
| 8 | `derived-knowledge` | Derived Knowledge (computed) |

Ties resolve by freshness (newer `updatedAt` wins; missing timestamps lose), then stable id order.
The method string `authority-precedence → freshness → stable-id` is part of every resolution result.

## Standard domains (7.6)

`engineering` · `deployment` · `security` · `data-handling` · `ai-usage` · `communication` ·
`operations` · `compliance`

## Lifecycle (7.4 — derivation only)

States: `draft → review → approved → deprecated/superseded → archived`. The declared legal
transitions ship as data (`KNOWLEDGE_LIFECYCLE_TRANSITIONS`); **Stage 7 adds no transition
executor** — state only changes through the existing governed writes (decision `setStatus` under
`operations:manage`, governance toggles under `governance:manage`, memory updates under the memory
governance path). An asset whose backing record carries no lifecycle marker reports `null`
("unclassified") with its basis — honesty over invention.

## The classes

| Class id | Backing (existing store) | Authority tier | Rank key | Base criticality | Staleness | Retention | Access scope |
|---|---|---|---|---|---|---|---|
| `executive-decision` | enterprise/decisionStore (persisted, cap 500) | governed | `governed-decision` | high | 180 d | store-capped (oldest archived drop first) | operations:manage writes · snapshot reads |
| `governance-policy` | governance approval chains | org-defined | `governance-policy` | critical | 365 d | governed + hash-chained audit | governance:manage |
| `compliance-rule` | governance compliance rules | org-defined | `governance-policy` | critical | 365 d | governed + hash-chained audit | governance:manage |
| `ai-prompt` | ai/promptManager DEFAULT_PROMPTS (32 versioned) | versioned-library | `versioned-prompt` | medium | n/a | version-permanent (audited reproduction) | in-process, audited per call |
| `governed-document` | UDM document/file entities, classified by real markers | provider-authoritative | `provider-document` (→ `approved-document` when an approval marker exists) | medium | 180 d | provider-managed | intelligence:read (UnifiedQuery) |
| `explicit-memory` | memoryStore explicit items (decision/document/note/context) | authored | `explicit-memory` | medium | 365 d | governed (memory audit; org-sync versions) | memory:* scopes |
| `workflow-definition` | per-run specs observed via workforce jobs — **no persisted library exists (honest gap)** | derived | `derived-knowledge` | low | 90 d | store-capped (derived from job history) | workforce:* |
| `connector-doc` | connector manifests (description/docsUrl/capabilities/scopes) | provider-authoritative | `provider-document` | medium | n/a | version-permanent (manifest version) | connectors:read |
| `org-structure` | enterprise org store (units/roles/users/leads) | org-defined | `organization-standard` | high | 365 d | governed | org:manage writes |
| `capability-standard` | renderer capability registry — **declared main-process boundary (not readable here)** | versioned-library | `organization-standard` | medium | n/a | version-permanent (source control) | renderer public |
| `derived-intelligence` | insight + knowledge-fabric generators (stateless) | derived | `derived-knowledge` | low | n/a | computed per read | intelligence:read / knowledge:read |

## Enhancement #1 — the per-asset envelope

Every asset carries: **owner** + **review owner** (the owner's unit lead resolved through the real
org chart, else the owner; never guessed), **business criticality** (class base, +1 when referenced
by ≥3 records, +1 when governed/org-defined and approved — reasons recorded), **retention policy**
(describes the actual backing-store behavior), and a **provenance chain** over
`created → reviewed → approved → referenced → superseded → archived` where every stage is backed by
a real record (decision history events, governance audit-recorded toggles, provider markers with a
"provider does not record when" note, the computed reference index, derived supersession) or is
absent.

## The relationship matrix (foundational artifact #2)

Computed at runtime from mechanisms that already exist — graph edges (`references`, `approved_by`,
`discussed_in`, …) between asset-backed nodes, decision `evidence[]`, memory `entityRefs`/evidence,
timeline `approval.granted` correlation joins, insight recommendation evidence, connector sync
provenance, and org-chart ownership joins. Every cell names its edge source; the matrix is
**persisted nowhere** (`computedOnly: true` is structural).
