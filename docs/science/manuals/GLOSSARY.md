# NeuroPause Scientific Glossary (NSSP)

> The terminology authority for the NeuroPause Scientific & Standards Program; every
> other NSSP document reuses these definitions. Each entry gives a precise
> definition, an **evidence level** (`L0` Proposed · `L1` Modeled · `L2` Implemented
> · `L3` Measured · `L4` Validated — see `../\_grounding.md`), and an **anchor** to a
> real file for any term at **L2+**. Program-introduced terms (e.g. the evidence
> ladder) are **L0** conventions with no code anchor. Paths are relative to
> `packages/shared/src` unless noted; the formal type mapping is `../frameworks/ONTOLOGY.md`.

---

**Anchor** — The real file/artifact substantiating a term; required for every L2+ entry, absent for L0 program terms. *L0 (convention).*

**Approval chain** — An ordered sequence of role-gated steps that must clear before a triggering action proceeds (`appliesTo: ApprovalTrigger`). *L2.* `types/enterprise.ts` (`ApprovalChain`).

**Assurance** — The class of properties establishing safe, as-claimed behavior: RBAC fail-closed gating, crypto primitives (Ed25519/Argon2id/SHA-256), SSRF guard, honest degradation, 0 production vulnerabilities. *L2/L4.* `_grounding.md`; `ENTERPRISE-GA-REPORT.md`.

**Audit log** — Append-only, indexed record of `user_id`/`action` events; the durable event-evidence store. *L2.* `apps/backend/src/db/migrations/0001_init.sql:50`; wire shape `EnterpriseAuditEntry` (`types/enterprise.ts`).

**Authorization relation** — The ontological relation `(principal) may (scope)` that governance enforces; holding a scope authorizes the guarded action. Realized by three scope vocabularies (IPC, enterprise, worker). *L2.* `ipc/channels.ts`, `types/enterprise.ts`, `types/worker.ts`.

**Cadence** — A validation schedule policy: `manual | nightly | weekly | interval`. *L2.* `types/continuousValidation.ts` (`ScheduleCadence`, `CadenceKind`).

**Capability** — A declared, typed ability of an entity, independent of whether it is exercised (connector data domains; worker skills). *L2.* `types/connectors.ts` (`ConnectorCapability`), `types/worker.ts` (`WorkerSkill`).

**Certification report** — The pass/warning/fail rollup a certifying pipeline emits from stage results, regression, and security. *L2.* `types/continuousValidation.ts` (`CertificationReport`, `certifyLevel()`).

**Compliance rule / finding** — A deterministic policy check (`ComplianceCheckKind`, 6 checks) and its evaluated result (`pass | warn | fail`) with evidence ids. *L2.* `types/enterprise.ts` (`ComplianceRule`, `ComplianceFinding`).

**Connected account** — One authenticated identity for a connector; carries live state but never token material. *L2.* `types/connectors.ts` (`ConnectedAccount`).

**Connector** — A typed integration definition mapping a provider's objects into the UDM; static shape `ConnectorManifest`, renderer view `ConnectorDto`. *L2.* `types/connectors.ts`.

**Connector lifecycle state** — Whether a connector is backed by a real data adapter: `production` (connectable) vs `preview` (not yet) — keeps the catalog honest. *L2.* `types/connectors.ts` (`ConnectorLifecycleState`).

**Containment** — The relationship family placing an entity inside a scope: UDM `parentId`/`containerId` and org `contains`. *L2.* `types/unified.ts`, `types/enterprise.ts` (`OrgGraphEdgeKind`).

**Dependency graph** — The knowledge-graph sub-graph induced by directional-need edges (`depends_on`, `references`, `belongs_to`, `linked_to`), with `from→to` path queries. *L2.* `types/graph.ts` (`GraphEdgeType`, `GraphPathResult`).

**DurationSummary** — The canonical measurement primitive: a duration distribution as `{ count, avgMs, p50Ms, p95Ms, maxMs }`, computed by pure `summarizeDurations()`. *L2/L3.* `types/perfMetrics.ts`.

**Enterprise family** — The organizational operating-layer entity classes: organization runtime (Organization → OrgUnit → OrgUser + AI workers), governance, workspace, connector/integration, and executive rollup. *L2.* `types/enterprise.ts`.

**Enterprise Knowledge Graph (EKG)** — The typed, directed graph projected deterministically from the UDM; nodes are entities, edges are relationships each carrying `evidence` provenance. *L2* (projection **L3**, `graph.project` 92.8 ms). `types/graph.ts`; `apps/desktop/src/main/__bench__/performance.test.ts`.

**Enterprise Timeline** — The unified "what happened" event stream composing platform events and UDM-derived activity at read time; owns no storage. *L2.* `types/enterpriseTimeline.ts` (`EnterpriseTimelineEntry`).

**Entity** — An individually identified object class with a stable id envelope; the platform's unifying entity is `UnifiedEntity`. *L2.* `types/unified.ts`.

**Entity kind** — The canonical type tag of a unified entity; 16 values in `UNIFIED_ENTITY_KINDS`. *L2.* `types/unified.ts` (`UnifiedEntityKind`).

**Event** — A timestamped record that something happened (timeline entry, graph-edge change, connector event, trace event, audit entry). Distinct from an Observation and a Measurement. *L2.* `types/enterpriseTimeline.ts`, `types/graph.ts` (`GraphEdgeEvent`).

**Evidence level / Evidence ladder** — The five-rung scale every NSSP concept carries: **L0** Proposed (framework-defined, not in code, no anchor) · **L1** Modeled (types exist, no live engine; anchor = type file) · **L2** Implemented (runs; anchor = source) · **L3** Measured (recorded telemetry/`bench/results/*.json`) · **L4** Validated (verified by executed tests/gates, e.g. 3,856 tests, gates at 0). An NSSP internal convention. *L0.* `_grounding.md`.

**Execution** — The uniform model by which any executable entity runs: one `ExecutionRequest` → one `ExecutionSession` through one pure planner + state machine. *L2.* `types/executeEngine.ts`.

**Execution kind** — What the engine can execute: `task, worker, automation, decision, workflow, memory, connector, voice, runtime, executive`. *L2.* `types/executeEngine.ts` (`ExecutionKind`).

**Execution state** — The session/step FSM: `queued → running → waiting → paused → (completed | failed | cancelled | interrupted)`. *L2.* `types/executeEngine.ts` (`ExecutionState`).

**Executive snapshot** — The live rollup composing org health, workforce, activity, risk, approvals, intelligence, and operations into one view. *L2.* `types/enterprise.ts` (`ExecutiveSnapshot`).

**Fail-closed** — Default-deny posture: an IPC call lacking its required scope is rejected rather than allowed; the security default of the permission gate. *L2.* `ipc/channels.ts` (`SecureHandlerDef`); `_grounding.md` → Assurance.

**Governance** — The authorization and policy layer, modeled ontologically as authorization relations plus policies (roles, permissions, approval chains, compliance). *L2.* `types/enterprise.ts`, `ipc/channels.ts`.

**Grounded / grounding** — The property that a claim or edge traces to a real artifact; ungrounded claims are labelled L0, and knowledge-graph edges are grounded via `GraphEvidence`. *L2.* `types/graph.ts`; `_grounding.md`.

**IPC scope** — A permission atom guarding an inter-process channel. The canonical enterprise RBAC vocabulary is **57** `EnterprisePermission` scopes (plus 18 developer `ApiScope`); ~85 total scope literals exist across all authorization registries (e.g. `backup:create`, `automation:read`, `cloud:manage`). *L2.* `enterprise.ts`, `ecosystem.ts`.

**Knowledge graph** — See **Enterprise Knowledge Graph (EKG)**.

**KPI** — A derived indicator computed deterministically from entity/telemetry inputs (executive, workforce, capacity KPIs). *L2.* `enterprise/intelligence/enterpriseKpi.ts`, `workforce/intelligence/workforcePerformanceKpi.ts`.

**Lifecycle** — A finite state machine over an entity; each `status`/`state` union is a state set and each guarded write a transition. *L2.* `types/executeEngine.ts`, `types/connectors.ts`, `types/continuousValidation.ts`.

**Measurement** — A quantified value with a unit and a defined aggregation; the platform's primitive is `DurationSummary`. Distinct from a raw metric series. *L2/L3.* `types/perfMetrics.ts`; `bench/results/*.json`.

**Metric** — A single named quantity (a `neuropause_*` Prometheus series, or a keyed value in `StageResult.metrics`). *L3* (live) / *L2* (validation). `apps/backend/src/observability/metrics.ts`; `types/continuousValidation.ts`.

**NSSP** — The NeuroPause Scientific & Standards Program: a *formalization* effort describing the science over the existing platform, bound by the evidence ladder and the no-fabrication rules. *L0* (program). `_grounding.md`.

**Observation** — A sampled or composed statement about current system state (health snapshot, telemetry, sync snapshot, perf snapshot). Distinct from an Event (past) and a Measurement (a value). *L2/L3.* `types/systemHealth.ts`, `types/perfMetrics.ts`.

**Ontology** — The formal vocabulary of entity classes and relations, *derived* (not invented) from the 1,925 exported types; a read model over the codebase. *L2.* `frameworks/ONTOLOGY.md`; `packages/shared/src`.

**Organization / OrgUnit / OrgUser** — The organization runtime: an org contains units (`business_unit → department → team`) containing members (`human | ai_worker`). *L2.* `types/enterprise.ts`.

**OTLP exposition** — OpenTelemetry/JSON trace + log export shapes exposed over the public API from existing gateway telemetry. *L3.* `types/observability.ts`.

**Percentile** — Nearest-rank percentile over a sorted sample; the pure basis of `DurationSummary` (`p50Ms`, `p95Ms`). *L2.* `types/perfMetrics.ts` (`percentile()`).

**Perf snapshot** — The render-ready aggregation of real renderer samples (rAF fps, `performance.memory` JS-heap, IPC round-trips) into fps/memory/ipc/render summaries. *L2/L3.* `types/perfMetrics.ts` (`PerfSnapshot`, `buildPerfSnapshot()`).

**Policy** — A declarative rule constraining or gating behavior, evaluated to a Finding (compliance rules, approval chains, validation cadences). *L2.* `types/enterprise.ts`, `types/continuousValidation.ts`.

**Prometheus exposition** — The plain-text metrics format the backend serves at `/metrics` (`neuropause_*` gauges/counters). *L3.* `types/observability.ts`; `apps/backend/src/observability/metrics.ts`.

**Provenance** — The back-reference from a derived node/edge to the UDM record that justifies it, making relations grounded rather than asserted. *L2.* `types/graph.ts` (`GraphEvidence`).

**RBAC scope** — A least-privilege permission atom; see **Authorization relation** and **IPC scope**. Enterprise scopes: `EnterprisePermission` (`types/enterprise.ts`); worker scopes: `WorkerPermissionScope` (`types/worker.ts`). *L2.*

**Read model** — A structure computed at read time by composing existing sources (timeline, EKG, health snapshot) rather than owning new storage — the platform's prevailing pattern and the ontology's method. *L2.* `types/enterpriseTimeline.ts`, `types/graph.ts`.

**Relationship** — A typed directed link between entities (containment, dependency, authorship, assignment, lifecycle/provenance, ERP business relations). *L2.* `types/graph.ts` (`GraphEdgeType`), `types/enterpriseRelationship.ts` (`RelationshipType`).

**Reliability** — Executed fault-tolerance/recovery properties (migration idempotency, backup/restore, 0.46 s restart, Redis fail-open, Postgres degrade+reconnect). *L4.* `docs/validation/RELIABILITY-RESULTS.md`; `bench/results/reliability.json`.

**Runtime telemetry** — Real process signals (cpu %, memory MB, uptime, backend latency/state) feeding the health snapshot. *L3.* `types/systemHealth.ts` (`RuntimeTelemetry`).

**Scenario simulation** — Real, runnable what-if/sandbox modeling over the platform; part of the (otherwise L0) prediction surface that *does* exist. *L2.* `sandbox/scenarioStore.ts`, `sandbox/agent/scenarioTemplates.ts`.

**Stage / StageKind** — One step of a validation pipeline dispatching to exactly one existing executor: `scenario | ai-qa | lab`. *L2.* `types/continuousValidation.ts` (`PipelineStage`, `StageKind`).

**Sync state** — The lifecycle of a connector account's synchronization (`idle | syncing | success | error | never`). *L2.* `types/connectors.ts` (`SyncState`, `ConnectorSyncSnapshot`).

**System health snapshot** — The 0–100 scored, composed view of subsystem health (worst-subsystem rollup); NeuroCore composes, it does not re-measure. *L2.* `types/systemHealth.ts` (`SystemHealthSnapshot`, `composeSystemHealth()`).

**Unified Data Model (UDM)** — NeuroPause's universal knowledge layer: every connector maps provider objects into canonical `UnifiedEntity` records the rest of the product reads instead of provider APIs. *L2.* `types/unified.ts`.

**UnifiedEntity** — The single canonical record shape (identity envelope + display + relationship fields + semantic fields) shared across all kinds and connectors. *L2.* `types/unified.ts`.

**Validation pipeline** — A named, ordered set of stages continuously executing the existing sandbox against the real platform; the S6 orchestration layer, reusing existing executors rather than adding a test framework. *L2/L1.* `types/continuousValidation.ts` (`ValidationPipeline`).

**Worker (AI worker)** — A governed non-human org member with declared skills and least-privilege scopes; side-effecting scopes are approval-gated. *L2.* `types/worker.ts` (`WorkerIdentity`, `WorkerSkill`, `WorkerPermissionScope`).

**Workspace** — An isolated operating context bound to exactly one organization; data is scoped to the workspace. *L2.* `types/enterprise.ts` (`Workspace`).

---

*Honesty note:* No entry claims a proof, certification, peer review, published paper,
benchmark number beyond `bench/results/`/GA reports, or international-standard
conformance. There is **no statistical forecasting/prediction engine**; predictive
terms are **L0**, grounded only on the scenario/simulation/AI surfaces that exist
(`_grounding.md`). This glossary is the shared terminology authority for all NSSP docs.
