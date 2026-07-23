# NeuroPause — Formal Ontology

> Part of the NeuroPause Scientific & Standards Program (NSSP). This is a
> **formalization** of the vocabulary the platform *already* exposes in code — not
> a design proposal and not new engineering. Every ontology term below is mapped to
> a real exported type in `packages/shared/src`. Terminology, evidence levels, and
> citations follow `../\_grounding.md` and `../SCIENTIFIC-MATRICES.md`; term
> definitions are authoritative in `../manuals/GLOSSARY.md`.

## 0. Status, scope, and method

**Evidence of the ontology itself: L2 (Implemented).** It is *derived*, not
invented: the class and relation vocabulary is read directly from the **1,925
exported types/interfaces** across 40+ domain files in `packages/shared/src`
(`_grounding.md` → "Ontology"). A term naming a type that exists and runs is **L2**;
a schema/model not wired to a live engine is **L1**; **any relation asserted here
that is not present in code is labelled L0 (Proposed)** and never stated as fact.

Method (Sub-Agent-9 discipline): **map** to existing systems, never duplicate them.
The ontology is a *read model* over the codebase — the platform's own posture (the
Enterprise Knowledge Graph is "projected deterministically from the Unified Data
Model", `types/graph.ts`). Evidence ladder: **L4** Validated · **L3** Measured ·
**L2** Implemented · **L1** Modeled · **L0** Proposed/Future.

---

## 1. Entities — core object classes

An **Entity** is an individually identified object class with a stable id envelope.
The platform has two complementary entity spines: the **Unified Data Model (UDM)**
for connector-sourced knowledge, and the **Enterprise families** for the org layer.

### 1.1 The unifying object: `UnifiedEntity`

`UnifiedEntity` (`types/unified.ts`) is the canonical record every connector maps
into — one flat shape shared across all kinds and sources. Its **identity envelope**
(`id`, `kind`, `connectorId`, `accountId`, `sourceId`, timestamps, `syncState`,
`metadata`), **display** (`title`, `url`), **relationship** fields (`parentId`,
`containerId`), and **semantic** fields (`body`, `status`, `author`, `timestamp`,
`labels`) are the atoms the rest of the ontology composes. Its kind space is the
runtime list `UNIFIED_ENTITY_KINDS` (16 kinds: account, workspace, organization,
project, task, conversation, message, document, file, event, calendar_event,
notification, contact, label, activity, attachment).

### 1.2 Entity class table

| Ontology class | Real type | File | Evidence |
|---|---|---|---|
| Unified entity (UDM record) | `UnifiedEntity`, `UnifiedEntityKind` | `types/unified.ts` | **L2** |
| Organization | `Organization` | `types/enterprise.ts` | **L2** |
| Org unit (business_unit→department→team) | `OrgUnit`, `OrgUnitKind` | `types/enterprise.ts` | **L2** |
| Org member (human \| ai_worker) | `OrgUser`, `OrgMemberKind` | `types/enterprise.ts` | **L2** |
| Workspace (isolated context) | `Workspace`, `WorkspaceSummary` | `types/enterprise.ts` | **L2** |
| Connector (integration definition) | `ConnectorManifest`, `ConnectorDto` | `types/connectors.ts` | **L2** |
| Connected account (identity) | `ConnectedAccount` | `types/connectors.ts` | **L2** |
| AI worker (governed agent) | `WorkerIdentity`, `WorkerSkill` | `types/worker.ts` | **L2** |
| Knowledge-graph node | `GraphNode`, `GraphNodeType` | `types/graph.ts` | **L2** |
| ERP relationship node | `RelationshipNode`, `RelationshipEntityKind` | `types/enterpriseRelationship.ts` | **L2** |
| Execution session (executable) | `ExecutionSession` | `types/executeEngine.ts` | **L2** |

The **enterprise families** (all L2, real wire shapes shared by main and renderer):
*organization runtime* (Organization → OrgUnit → OrgUser + AI workers), *governance*
(roles, approval chains, compliance rules), *workspace* (isolation),
*connector/integration*, and the *executive rollup* (`ExecutiveSnapshot`).

---

## 2. Relationships

A **Relationship** is a typed directed link between entities. Four families are
present in code; each is L2. Relations *not* enumerated by these types are L0.

| Relationship family | Canonical relation terms | Real type | File | Evidence |
|---|---|---|---|---|
| **Containment** | `parentId`, `containerId`; org `contains` | `UnifiedEntity`, `OrgGraphEdgeKind` | `types/unified.ts`, `types/enterprise.ts` | **L2** |
| **Dependency** | `depends_on`, `references`, `linked_to` | `GraphEdgeType` | `types/graph.ts` | **L2** |
| **Authorship** | `created_by`, `authored`, `generated_by`; `author` field | `GraphEdgeType`, `OrgGraphEdgeKind`, `UnifiedEntity` | `types/graph.ts`, `types/enterprise.ts`, `types/unified.ts` | **L2** |
| **Assignment / membership** | `assigned_to`, `member_of`, `leads`, `reports_to`, `works_on`, `owns` | `GraphEdgeType`, `OrgGraphEdgeKind` | `types/graph.ts`, `types/enterprise.ts` | **L2** |
| **Lifecycle / provenance link** | `approved_by`, `participated_in`, `discussed_in`, `belongs_to` | `GraphEdgeType` | `types/graph.ts` | **L2** |
| **ERP business relations** | `places_order`, `order_to_invoice`, `runs_on_machine`, `executes_decision`, … | `RelationshipType` | `types/enterpriseRelationship.ts` | **L2** |

Every knowledge-graph edge carries **provenance** (`GraphEdge.evidence` → the UDM record that justifies it), making relationships *grounded* rather than asserted.

---

## 3. Capabilities

A **Capability** is a declared, typed ability of an entity — what it *can* do or
surface, independent of whether it is currently exercised.

| Capability class | Real type | File | Evidence |
|---|---|---|---|
| Connector data capability (projects, tasks, messages, …) | `ConnectorCapability` | `types/connectors.ts` | **L2** |
| Connector auth capability | `ConnectorAuthType` (`oauth2_pkce` \| `oauth2_confidential` \| `api_key`) | `types/connectors.ts` | **L2** |
| Worker skill | `WorkerSkill` (`requires: WorkerPermissionScope[]`, `sideEffects`) | `types/worker.ts` | **L2** |
| M365 write action | `ConnectorWriteActionInfo` | `types/connectors.ts` | **L2** |
| Executable kind | `ExecutionKind` (10 kinds) | `types/executeEngine.ts` | **L2** |

Capabilities are *declarations*: whether a real data adapter backs a declared
capability is a separate **lifecycle** fact (`ConnectorLifecycleState`, §10).

---

## 4. Events

An **Event** is a timestamped record that *something happened*; the platform unifies
platform events and UDM-derived activity into one stream.

| Event class | Real type | File | Evidence |
|---|---|---|---|
| Timeline entry (platform \| activity) | `EnterpriseTimelineEntry`, `TimelineEntrySource` | `types/enterpriseTimeline.ts` | **L2** |
| Timeline replay window | `TimelineReplay` | `types/enterpriseTimeline.ts` | **L2** |
| Connector lifecycle event | `ConnectorEvent`, `ConnectorLogEntry` | `types/connectors.ts` | **L2** |
| Graph edge change (relationship history) | `GraphEdgeEvent` (`added` \| `removed`) | `types/graph.ts` | **L2** |
| Trace event | `TraceEvent` | `types/trace.ts` | **L2** |
| Append-only audit entry | `EnterpriseAuditEntry`; `audit_log` table | `types/enterprise.ts`; `db/migrations/0001_init.sql:50` | **L2** |

The Enterprise Timeline owns no storage — it composes the platform timeline and the
UDM at read time; events are a projection (the read-model method).

---

## 5. Observations

An **Observation** is a sampled or composed statement about *current* state (vs. an
Event = past occurrence, a Measurement = a quantified value).

| Observation class | Real type | File | Evidence |
|---|---|---|---|
| System-health snapshot | `SystemHealthSnapshot`, `SubsystemHealth`, `SystemHealthLevel` | `types/systemHealth.ts` | **L2** |
| Runtime telemetry | `RuntimeTelemetry` (cpu, memory, uptime, backend latency) | `types/systemHealth.ts` | **L3** |
| Connector sync snapshot | `ConnectorSyncSnapshot`, `ConnectorModuleStat` | `types/connectors.ts` | **L2** |
| Prometheus / OTLP exposition | `PrometheusExposition`, `OtelSpan`, `OtelLogRecord` | `types/observability.ts` | **L3** |
| Perf snapshot (rAF fps, JS-heap, IPC) | `PerfSnapshot`, `PerfInput` | `types/perfMetrics.ts` | **L2/L3** |

`SystemHealthSnapshot` is **composed**, not re-measured; live `neuropause_*` series at `/metrics` are **L3 Measured**.

---

## 6. Measurements

A **Measurement** is a quantified value with a unit and a defined aggregation; the
platform's canonical primitive is `DurationSummary`.

| Measurement class | Real type / shape | File | Evidence |
|---|---|---|---|
| Duration distribution primitive | `DurationSummary` (`count, avgMs, p50Ms, p95Ms, maxMs`) | `types/perfMetrics.ts` | **L2/L3** |
| IPC channel latency | `IpcChannelStat` | `types/perfMetrics.ts` | **L2** |
| Render component cost | `RenderComponentStat`, `RenderSample` | `types/perfMetrics.ts` | **L2** |
| Percentile / summarize (pure) | `percentile()`, `summarizeDurations()` | `types/perfMetrics.ts` | **L2** |
| Validation run metrics | `StageResult.metrics`, `VALIDATION_METRIC_KEYS` | `types/continuousValidation.ts` | **L2** |
| Executive/workforce KPIs | `enterpriseKpi.ts`, `workforcePerformanceKpi.ts` | `enterprise/…`, `workforce/…` | **L2** |

`perfMetrics.ts` "owns NO measurement itself" — it summarizes **real** renderer samples; recorded artifacts: `bench/results/*.json` (**L3**).

---

## 7. Policies

A **Policy** is a declarative rule that constrains or gates behavior, evaluated
deterministically to a Finding.

| Policy class | Real type | File | Evidence |
|---|---|---|---|
| Compliance rule + check | `ComplianceRule`, `ComplianceCheckKind` (6 checks) | `types/enterprise.ts` | **L2** |
| Compliance finding | `ComplianceFinding`, `ComplianceStatus` (`pass\|warn\|fail`) | `types/enterprise.ts` | **L2** |
| Approval chain + trigger | `ApprovalChain`, `ApprovalChainStep`, `ApprovalTrigger` | `types/enterprise.ts` | **L2** |
| Governance policy (trace) | `GovernancePolicy` | `types/trace.ts` | **L2** |
| Schedule cadence (validation policy) | `ScheduleCadence`, `CadenceKind` | `types/continuousValidation.ts` | **L2** |

**Honest boundary:** `GovernanceApproval` slots in the Governance Trace are "reserved
for a future approval source; empty until one is connected" (`types/trace.ts`) — the
ontology records the slot as **present but unpopulated**, claiming no unwired engine.

---

## 8. Governance — RBAC scopes as authorization relations

**Governance** is modeled as **authorization relations** `(principal) --may-->
(scope)` — a scope is a permission atom whose holding authorizes the guarded action.
Three distinct, real, least-privilege scope vocabularies coexist:

| Authorization vocabulary | Principal → scope | Real type | File | Evidence |
|---|---|---|---|---|
| **IPC channel scopes** (fail-closed gate) | renderer call → channel scope | ~85 scope literals across registries; 57 canonical `EnterprisePermission` scopes (e.g. `backup:create`, `automation:read`, `cloud:manage`) | `enterprise.ts`, `ipc/channels.ts` | **L2** |
| **Enterprise (org) permissions** | `OrgRole` → permission | `EnterprisePermission`, `ALL_ENTERPRISE_PERMISSIONS` | `types/enterprise.ts` | **L2** |
| **Worker permissions** (AI least-privilege) | `WorkerSkill` → scope | `WorkerPermissionScope` (`read:*`, `write:*`, `propose:*`, `execute:action`) | `types/worker.ts` | **L2** |

The IPC layer is **fail-closed**: a channel is RBAC-gated through the
`SecureHandlerDef`, so a call without the required scope is denied by default
(`_grounding.md` → Assurance) — authorization is an *ontological relation the runtime
enforces*. Side-effecting worker scopes (`write:*`, `propose:*`, `execute:action`)
are approval-gated, conditioned on an approval Event.

---

## 9. Execution

**Execution** is the uniform model by which any executable entity runs. One
`ExecutionRequest` becomes one `ExecutionSession` through one pipeline.

| Execution class | Real type | File | Evidence |
|---|---|---|---|
| Execution request | `ExecutionRequest`, `ExecutionKind` (task, worker, automation, decision, workflow, memory, connector, voice, runtime, executive) | `types/executeEngine.ts` | **L2** |
| Execution plan (pure planner) | `ExecutionPlan`, `ExecutionStep`, `planExecution()` | `types/executeEngine.ts` | **L2** |
| Execution session | `ExecutionSession`, `ExecutionState` | `types/executeEngine.ts` | **L2** |
| Execution stats | `ExecutionStats`, `computeExecutionStats()` | `types/executeEngine.ts` | **L2** |
| Autonomous operational plan | `OperationalPlan`, `AutoOpsExecution` | `types/autonomousOperations.ts` | **L2** |
| Continuous-validation run | `ValidationRun`, `PipelineStage`, `StageKind` | `types/continuousValidation.ts` | **L2/L1** |

The Execute Engine core is **pure and unit-tested** (planner + state machine);
`recoverInterrupted()` marks non-terminal sessions `interrupted` — *recorded, not rerun*.

---

## 10. Lifecycle — states and transitions

A **Lifecycle** is a finite state machine over an entity. The ontology treats each
`status`/`state` union as a state set and each guarded write as a transition.

| Lifecycle | State set | Real type | File | Evidence |
|---|---|---|---|---|
| Execution session | queued→running→waiting→paused→(completed\|failed\|cancelled\|interrupted) | `ExecutionState` | `types/executeEngine.ts` | **L2** |
| Connector account status | disconnected→connecting→connected→reauth_required→error→unavailable | `ConnectorStatus` | `types/connectors.ts` | **L2** |
| Connector sync | idle→syncing→(success\|error\|never) | `SyncState` | `types/connectors.ts` | **L2** |
| Connector capability lifecycle | production \| preview | `ConnectorLifecycleState` | `types/connectors.ts` | **L2** |
| UDM record | active \| deleted | `EntitySyncState` | `types/unified.ts` | **L2** |
| Validation stage / run | pass\|fail\|warn\|error\|skipped ; running→(passed\|failed\|warning\|error) | `StageStatus`, `ValidationRunStatus` | `types/continuousValidation.ts` | **L2** |
| Worker health | healthy\|degraded\|unhealthy\|unknown | `WorkerHealthState` | `types/worker.ts` | **L2** |
| Org member status | active\|invited\|suspended | `OrgUserStatus` | `types/enterprise.ts` | **L2** |
| System health | healthy\|degraded\|critical\|offline\|unknown | `SystemHealthLevel` | `types/systemHealth.ts` | **L2** |

Transition *rules* existing as pure functions are L2 (`isTerminalState()`,
`runStatusFrom()`, `certifyLevel()`); transition semantics *proposed* beyond them
would be **L0**.

---

## 11. Knowledge graph and dependency graph

The **Enterprise Knowledge Graph (EKG)** is the top-level relational structure: a
typed, directed graph **projected deterministically from the UDM** — entities become
nodes, relationships and semantic fields become edges (`types/graph.ts`, **L2**).

- **Nodes:** `GraphNode` over `GraphNodeType` (collaboration + P2.5 ERP + P6
  `cloud_resource` kinds). **Edges:** `GraphEdge` over `GraphEdgeType`, each with
  `evidence` provenance. **History:** `GraphEdgeEvent`. **Neighborhood:**
  `GraphNeighbors`, `GraphSubgraph`. Sibling L2 projections: `OrgGraph`,
  `RelationshipGraphInput`.
- **Measured:** projection is timed at **L3** — `graph.project` 92.8 ms
  (`apps/desktop/src/main/__bench__/performance.test.ts`; `SCIENTIFIC-MATRICES.md` C2).

The **dependency graph** is the EKG sub-graph induced by directional-need edges
(`depends_on`, `references`, `belongs_to`, `linked_to`), with `from → to` path
queries (`GraphPathQuery`/`GraphPathResult`) — **L2**. MRP BOM/release-date
dependency feeds the **wired deterministic** capacity scheduler
(`computeCapacitySchedule`, `types/capacityScheduler.ts`; invoked in
`executiveCenterSubsystem.ts`/`runtimeCore.ts`, **L2**); any *statistical* predictor
beyond the present deterministic helpers is **L0**.

---

## 12. Entity–relationship sketch (ASCII)

```
   Organization ──contains──► OrgUnit(bu→dept→team) ──member_of/leads──► OrgUser
        │ engages                                          │ {human | ai_worker}
        ▼                                   authored/owns/works_on │ operates
   Customer/Vendor (RelationshipNode)                             ▼
                                     Connector ──sync──► UnifiedEntity (UDM, 16 kinds)
                                    (Manifest+Account)    │ parentId/containerId
                                        │ capability      │ author/status/labels
                                        │                 ├──project──► Enterprise
                                        │                 │   Knowledge Graph:
                                        ▼                 │   GraphNode ─edge─► GraphNode
                                 ExecutionSession         │   (edge.evidence ─► UDM record;
                                 (ExecutionKind/State)    │    depends_on / created_by)
                                        │ emits           ▼
                                        │        EnterpriseTimelineEntry (event)
                                        ▼        (platform | activity)
        governed by ──► RBAC scope (IpcChannel · Enterprise · WorkerPermission) [fail-closed]
        Policy: ComplianceRule ─► ComplianceFinding · ApprovalChain
        Observation (SystemHealthSnapshot) + Measurement (DurationSummary)
```

Every box and labelled edge corresponds to a real type cited in §§1–11 (L2); no
relation is drawn that a real type does not enumerate.

---

## 13. Formal terminology (ontology term → real type → evidence)

Consolidated index of the ontology primitives (per-section anchors above; full
definitions in `../manuals/GLOSSARY.md`).

| Ontology term | Real anchor | File | Evidence |
|---|---|---|---|
| Entity | `UnifiedEntity`, `UnifiedEntityKind` | `types/unified.ts` | **L2** |
| Enterprise family | `Organization`/`OrgUnit`/`OrgUser`/`Workspace` | `types/enterprise.ts` | **L2** |
| Relationship + provenance | `GraphEdgeType`, `RelationshipType`, `GraphEvidence` | `types/graph.ts`, `types/enterpriseRelationship.ts` | **L2** |
| Capability | `ConnectorCapability`, `WorkerSkill` | `types/connectors.ts`, `types/worker.ts` | **L2** |
| Event | `EnterpriseTimelineEntry`, `GraphEdgeEvent` | `types/enterpriseTimeline.ts`, `types/graph.ts` | **L2** |
| Observation | `SystemHealthSnapshot`, `PerfSnapshot` | `types/systemHealth.ts`, `types/perfMetrics.ts` | **L2/L3** |
| Measurement | `DurationSummary` | `types/perfMetrics.ts` | **L2/L3** |
| Policy | `ComplianceRule`, `ApprovalChain` | `types/enterprise.ts` | **L2** |
| Authorization relation (RBAC) | `IpcChannel` scopes, `EnterprisePermission`, `WorkerPermissionScope` | `ipc/channels.ts`, `types/enterprise.ts`, `types/worker.ts` | **L2** |
| Execution + lifecycle | `ExecutionSession`, `ExecutionState`, `StageStatus` | `types/executeEngine.ts`, `types/continuousValidation.ts` | **L2** |
| Knowledge / dependency graph | `GraphNode`/`GraphEdge`, `GraphPathResult` | `types/graph.ts` | **L2** |
| Capacity/decision projection (deterministic, wired) | `computeCapacitySchedule`, `assessDecisionEngine` | `types/capacityScheduler.ts`, `types/enterpriseDecisionEngine.ts` (wired in `executiveCenterSubsystem.ts`, `runtimeCore.ts`) | **L2** |
| Forecasting relation (statistical) | *no engine* | — | **L0** |

---

## 14. Honesty note

This ontology asserts only what the cited types support: it **may propose freely**
(L0), but every non-L0 row names a real exported type in `packages/shared/src`. The
platform has **no statistical forecasting/prediction engine**, so predictive
relations are **L0 Proposed**, grounded only on the scenario/simulation/AI surfaces
that exist (`_grounding.md` → Prediction). No proofs, certifications, peer review, or
standards-conformance are claimed. Term definitions are authoritative in
`../manuals/GLOSSARY.md`.
