# SESSION 106 — FULL-SYSTEM CONVERGENCE & ADVANCED-AI INTEGRATION ARCHITECTURE AUDIT

**Class:** DISCOVERY + ARCHITECTURE AUDIT. **ZERO production change · NO build · NO refactor · NO deletion · NO package merge · NO release/notarize/sign/tag/publish.** Evidence = repository-wide import census + workspace inspection (actual imports traced, not filenames). Frozen surfaces untouched; `baseline.json` untouched; release-track paused. Baseline S105 GREEN, HEAD `70a0c2e`.

**Core question answered:** *After inspecting the ENTIRE repository — what is the canonical architecture of the ONE NeuroPause application; which packages integrate, stay infrastructure, consolidate, or retire; what is missing; and in what order to build?*

---

## THE ONE FINDING THAT ORGANIZES EVERYTHING

I traced every `@neuropause/*` import across `apps/desktop/src`, `apps/backend/src`, and `apps/cloud`. The result is decisive:

> **Of 46 packages in `packages/`, exactly 7 have any live-app source consumer. 39 (85%) have ZERO.** The shipped desktop app declares only **4** `@neuropause` dependencies: `shared` (1,142 desktop src imports), `cst` (vendored frozen kernel tarball), `companion-protocol` (3), `solution-packs` (1). The backend adds `cloud-core` (4), `runtime` (1), `shared-cloud` (2). **Every "Wave 1–14" enterprise package and every "NCEA 10–15" platform package is unwired.**

This means the "large ecosystem" is not one platform with many connected packages. It is **one real application** (`apps/desktop`, ~103 live main-process subsystems on `@neuropause/shared`) **plus a real account/sync backend** (`apps/backend`) **surrounded by ~39 parallel, self-contained preview packages that duplicate — in standalone form — subsystems the desktop already implements and runs.** The desktop built each concept *twice*: once live inside `src/main/`, once as a package. **The package copy is the dead one.**

Therefore the convergence answer is **not "merge the packages into the app."** It is: **the live `apps/desktop/src/main` subsystems ARE canonical; the parallel packages are a design/parts library to harvest from and mostly retire; convergence work is about wiring the *live* subsystems to each other and to the AI layer — not importing 39 packages.**

---

## DELIVERABLE 1 — FULL REPOSITORY CENSUS

**Apps (4):**
- `apps/desktop` — **THE product.** Electron main (103 subsystems) + renderer + preload. Local-first ERP + AI + governance. LIVE.
- `apps/backend` — Node/Express + Postgres + Redis + Razorpay. Auth/org/billing/license/device/sync/semantic. LIVE, wired to desktop via baked URL.
- `apps/cloud` — thin cloud app; minimal (`cloud-core`/`shared-cloud` consumer). Marginal.
- `apps/mobile` — companion mobile; pairs via `companion-protocol`. Peripheral.

**Packages (46):** enumerated below. Live-wired: `shared`, `cst`(vendored), `companion-protocol`, `solution-packs` (desktop); `cloud-core`, `runtime`, `shared-cloud` (backend). The other 39 have no app-source consumer.

**Live desktop main subsystems (103 dirs)** — the true functional map, grouped:
- *Experience/UI-main:* experience, onboarding, help, interaction, voice, feedback, nps, support
- *Application spine:* platform (command bus, workflow, eventBus, persistence, outbox), api, ipc, services, unified, registry
- *ERP domains:* enterprise (106 modules), erp, crossDomain, catalog, documents, dataPlane
- *AI:* ai, assistant, liveBrain, cst, capabilities, intent, founder
- *Intelligence:* intelligence, intelligenceNetwork, insight, recommendations, decisions, purposeEngine, capabilityGraph, environmentModel, environmentDiscovery, strategy, strategyPlatform, orchestration, opportunities, outcomes, analyticsPlatform
- *Knowledge/memory:* knowledge, knowledgeAssets, knowledgeFabric, memory, graph, search, backendsemantic, timeline
- *Governance:* auth, identity, permissions, tenancy, security, evidence, trace, verification, reconciliation
- *Connectivity:* connectors, integrations(main), webhooks, federation, enterpriseFederation, federationPlatform, marketplace, plugins, ecosystem
- *Ops/infra:* backup, recovery, storage, migration, observability, diagnostics, updater, devices, billing, license, commercial, release, releaseOps, notifications, automationPlatform, autonomousOps, operationsPlatform, digitalTwinPlatform, twin, workforce, workspaces, sandbox, industry, industryPacks, medicalDevice, pilot, platformOperator, organization

---

## DELIVERABLE 2 — PACKAGE-BY-PACKAGE STATUS MATRIX

Classification: **A** live-production · **B** production-ready-but-disconnected · **C** partial · **D** scaffolding · **E** experimental/preview · **F** duplicate/redundant · **G** retirement-candidate · **H** required-but-missing. Wiring column = live-app source consumers (traced).

| Package | Purpose (self-described) | Wired consumers | Class | Recommended destination |
|---|---|---|---|---|
| `shared` | Types/contracts/constants | **1142 desktop + 25 backend** | **A** | **CANONICAL shared library** (keep, the one true contract) |
| `cst` (vendored tgz) | Governed transition kernel | desktop (frozen) | **A** | **CANONICAL governance kernel** (keep, frozen) |
| `companion-protocol` | Sealed mobile pairing envelopes | 3 desktop | **A** | Keep — shared library (desktop↔mobile) |
| `solution-packs` | Industry integration layer | 1 desktop | **A/C** | Keep — shared library (thin) |
| `cloud-core` | Cloud primitives (event bus, etc.) | 4 backend | **B** | Keep — backend service library |
| `shared-cloud` | Cloud DTOs/constants | 2 backend | **B** | Keep — backend shared library |
| `runtime` | Composition root/DI/scheduler | 1 backend | **C** | Keep-minimal (backend) or fold |
| `ai-runtime` | "Governed AI execution" (FakeProvider only) | **0** | **D/F** | Design library — duplicates live `main/ai`+`liveBrain`; harvest agent-registry idea, retire package |
| `intelligence` | KG + reasoning + copilots | **0** | **D/F** | Duplicates live `main/intelligence`+`graph`; harvest, retire |
| `ckdl` | Constitutional Knowledge & Decision Layer (in-memory, no vectors) | **0** | **E/F** | Concept/design ref; retire package |
| `nems` | "Wave 1 Foundation Platform" | **0** | **D** | Retirement candidate (unwired foundation) |
| `workforce` | "AI Workforce Platform" (agent registry) | **0** | **F** | Duplicates live `main/workforce`; harvest registry design, retire |
| `automation` | "Enterprise Automation" | **0** | **F** | Duplicates live `main/automationPlatform`; retire |
| `autonomous-ops` | "Autonomous Operations" | **0** | **F** | Duplicates live `main/autonomousOps`; retire |
| `security` | "Identity/Security/Governance Platform" | **0** | **F** | Duplicates live in-tree RBAC/tenancy/governance; retire |
| `persistence` | "One durable persistence platform" (PGlite) | **0** | **D/F** | Duplicates `DurableJsonStore`; keep as design ref for a future DB track only |
| `connectors` | "Connector & Automation Platform" | **0** | **F** | Duplicates live `main/connectors`; retire |
| `integrations` | "Live Provider Platform" | **0** | **F** | Duplicates live `main/integrations`; retire |
| `business` | "Wave 8 Business Platform" | **0** | **D** | Retirement candidate |
| `execution` | "Wave 5 Execution Platform" | **0** | **D** | Retirement candidate |
| `federation` | "Wave 6 Federation" | **0** | **F** | Duplicates live `main/federation*`; retire |
| `industry` | "Wave 9 Industry Solutions" | **0** | **F** | Duplicates live `main/industry*`; retire |
| `workplace`/`workspace` | "Wave 10 / Workspace platform" | **0** | **F** | Duplicate live `main/workspaces`; retire |
| `operations`/`reliability`/`cloudops`/`production`/`commercial` | Ops/reliability/commercial waves | **0** | **D/E** | Retirement candidates |
| `platform-automation`/`platform-operations`/`environment-provisioning`/`deploy`/`deployment-orchestrator`/`operator-deployment`/`customer-deployment`/`infrastructure`/`release`/`reliability` | Infra/deploy descriptor packages ("INFRASTRUCTURE-PENDING", "descriptors only") | **0** | **D/E** | Infra-descriptor library; keep out of the app; retire or archive |
| `customer-experience`/`enterprise-connectivity`/`trust-platform`/`integration-platform`/`connectivity` | "Launch Workstream" packages | **0** | **D/E** | Retirement candidates |
| `cloud-sdk`/`sdk` | Typed API SDK ("HTTP transport is a stub") | 0 app / 1 desktop(`sdk`) | **C/E** | Keep `sdk` thin; `cloud-sdk` experimental |
| `cli` | CLI for the Enterprise API | 0 | **E** | Keep as dev tool, out of app |
| `certification` | Validation/certification harness | 0 | **E** | Dev/CI tooling; keep out of app |

**Rule honored:** nothing deleted or rewritten this session. Classifications are recommendations with import evidence, not actions.

---

## DELIVERABLE 3 — DEPENDENCY / CONVERGENCE GRAPH

```
                 ┌───────────────────────── @neuropause/shared ──────────────────────────┐
                 │ (1142 desktop src imports — THE contract/type spine)                   │
                 ▼                                                                          ▼
        apps/desktop/src/main (103 subsystems)  ── vendored ──►  @neuropause/cst (frozen kernel)
                 │  ├─ companion-protocol (3)                                              
                 │  └─ solution-packs (1)                                                  
                 ▼
        apps/desktop/src/{renderer,preload}
                 │  (baked NEUROPAUSE_BACKEND_URL, backendReachabilityHub)
                 ▼
        apps/backend/src ── cloud-core(4), shared-cloud(2), runtime(1) ──► Postgres/Redis/(Qdrant dev-only)

   ─────────────────────────────────────────────────────────────────────────────────────
   39 packages (ai-runtime, intelligence, ckdl, nems, workforce, automation, autonomous-ops,
   security, persistence, connectors, integrations, business, execution, federation, industry,
   workplace, workspace, operations, reliability, cloudops, production, commercial, platform-*,
   *-deployment, environment-provisioning, deploy, infrastructure, release, customer-*,
   enterprise-connectivity, trust-platform, integration-platform, connectivity, cli, certification)
        └── ISOLATED ISLAND: import each other and their own tests; ZERO edge into any app. ──┘
```

**Findings:**
- **No circular dependency into the app** — the islands are cleanly severed.
- **No duplicate command bus in the live app** — exactly one: `platform/command/commandBus.ts:514 dispatchCommand`.
- **No duplicate workflow engine in the live app** — one runtime: `platform/workflow/workflowRuntime.ts`.
- **One store framework** — `enterprise/framework/{enterpriseRecordStore,moduleRegistry}.ts`.
- **The duplication is package-vs-live-subsystem, not live-vs-live.** Every `F` above duplicates a *running* main subsystem.
- **Dead packages with no production consumer:** all 39 islands.
- **Packages that should become shared platform services:** only `shared` (already is), `cst` (already is), `companion-protocol`, `solution-packs`, and the two backend cloud libs. Nothing else.

---

## DELIVERABLE 4 — DUPLICATION MATRIX

| Concept | Live canonical (in `apps/desktop/src/main`) | Parallel package (dead) | Verdict |
|---|---|---|---|
| AI gateway / runtime | `ai/` (aiEngine, PrivateFirstClient, modelRouter) + `liveBrain/` | `ai-runtime` | Live is canonical; harvest agent-registry shape from package, retire it |
| Agent system | `liveBrain/` + `capabilities/` (proposal→govern→execute) | `ai-runtime` agents, `workforce` | Live is canonical; do NOT add a second agent runtime |
| Memory | `memory/` (durable, tenant-scoped) | `ckdl`, `intelligence` memory | Live canonical |
| Search | `search/enterpriseSearch.ts` | `intelligence` searchv2 | Live canonical |
| Graph | `graph/graphStore.ts` + `enterprise/relationshipProvider.ts` | `intelligence` graph, `ckdl` | Live canonical |
| Workflow engine | `platform/workflow/workflowRuntime.ts` | `automation`, `execution` | Live canonical (rule 7) |
| Authorization/policy | in-tree RBAC (`runtimeAuthz`, `permissions`, `tenancy`) + `erp/approvalEngine` | `security` | Live canonical (rule 6) |
| Notifications | `notifications/` (eventNotifications, inboxStore) | `cloud-core` bus (backend) | Live canonical for desktop |
| Events/outbox | `platform/eventBus.ts`, `platform/command/{domainEventLog,outboxDispatcher}.ts` | `cloud-core` | Live canonical for desktop |
| Persistence | `platform/persistence/durableJsonStore.ts` + `EnterpriseRecordStore` | `persistence` (PGlite) | Live canonical now; `persistence` is a *future DB-track* design ref only |
| Analytics/intelligence | `intelligence/`, `insight/`, `recommendations/`, S81–S88 modules | `intelligence` pkg, `business` | Live canonical |
| Automation | `automationPlatform/`, `autonomousOps/` | `automation`, `autonomous-ops` | Live canonical |
| Workforce | `workforce/` | `workforce` pkg | Live canonical |

**No canonicalization requires deleting a live subsystem.** Every canonical choice is already the running one; every "loser" is an unwired package. That is the safest possible convergence posture: *converge by wiring live subsystems together and retiring dead packages — never by ripping out running code.*

---

## DELIVERABLE 5 — LIVE vs SCAFFOLDING MATRIX (one glance)

| Category | LIVE (runs in the product) | SCAFFOLDING (unwired packages) |
|---|---|---|
| Contracts | `@neuropause/shared` | — |
| Governance kernel | `@neuropause/cst` (vendored, frozen) | `security` pkg |
| App spine | command bus, workflow runtime, eventBus, outbox, store framework | `runtime`, `execution`, `nems` |
| ERP | 106 enterprise modules over `DurableJsonStore` | `business`, `industry` |
| AI | `ai/`+`liveBrain/`+`cst` mail.send | `ai-runtime`, `ckdl`, `workforce` |
| Intelligence | deterministic `intelligence/insight/recommendations` + S81–S88 | `intelligence` pkg |
| Knowledge/memory | `memory/graph/search/knowledge*` | `ckdl`, `intelligence` |
| Backend | `apps/backend` (auth/sync/billing) + `cloud-core` | `cloud-sdk`(stub), `cloudops` |
| Infra/deploy | dev/prod compose + Caddy | all `platform-*`, `*-deployment`, `environment-provisioning` (descriptors) |

---

## DELIVERABLE 6 — CURRENT NEUROPAUSE ARCHITECTURE (as-is)

```
USER
 └─► Renderer (React) ─ preload (static allowlist) ─ IPC secure bridge (auth→authorize→zod.strict)
       ├─► Enterprise module handlers (RBAC inline before every store write)
       │      └─► EnterpriseRecordStore / DurableJsonStore (LOCAL JSON, tenant-scoped)
       ├─► platform:command.dispatch ─► dispatchCommand (resolveScope tenancy + RBAC)
       │      └─► DurableCommandJournal (intent-first, idempotent) ─► module runAction ─► GL/inventory posting INSIDE the RBAC-gated action
       │      └─► domainEventLog / outboxDispatcher ─► notifications/inbox
       ├─► AI: assistant/ai/liveBrain ─► (deterministic proposal) ─► M365WritePanel ─► CST kernel mail.send (structural ASK-only)
       └─► Read side: intelligence/insight/recommendations/graph/search/memory (deterministic, keyword)
 └─► backendReachabilityHub ─► apps/backend (auth/org/billing/license/device/sync/semantic over Postgres/Redis)

39 packages: disconnected island, no edge into the above.
```
**Truth:** this is a coherent *governed deterministic ERP* with an AI edge — internally consistent and singular in its spine (one bus, one workflow, one store, one kernel). It is **not** "multiple partially connected systems" *inside the running app*; the fragmentation is entirely the unwired package island beside it.

---

## DELIVERABLE 7 — TARGET ONE-APPLICATION ARCHITECTURE (to-be)

The 9 layers, mapped to **existing live subsystems** wherever possible (convergence = wiring, not new packages):

- **L1 Experience** — `experience/`, renderer shell, global `search/`, `notifications/`, + **NEW: AI Copilot surface** and **NEW: Agent Center** (thin renderer panels over existing services).
- **L2 Application** — `platform/command` bus (canonical), `platform/workflow` runtime, query/read via `unified/` + `services/`, `api/`.
- **L3 Enterprise Domains** — `enterprise/` 106 modules (CRM/Sales/P2P/Inventory/Warehouse/Mfg/Maintenance/Projects/Finance/HR/Expenses). Canonical, unchanged.
- **L4 Intelligence** — `intelligence/insight/recommendations/decisions` (deterministic today). Future ML is a *parallel track*, not a rewrite.
- **L5 Agentic AI** — `liveBrain/` + `capabilities/` + `cst`. Registry/tools/planning/multi-step to be **built on the live spine**, never a second runtime.
- **L6 Knowledge** — `graph/` + `enterprise/relationshipProvider` + `search/` + `memory/`; semantic/RAG optional via `apps/backend` (Qdrant) — bundle a local embedding option later.
- **L7 Governance** — RBAC (`runtimeAuthz`/`permissions`/`tenancy`) + `cst` kernel + `erp/approvalEngine` + `evidence/trace/verification`. Canonical, the moat.
- **L8 Data** — canonical ERP truth in `DurableJsonStore` (local-first, deliberate); transaction journal `DurableCommandJournal`; event/outbox; backend Postgres for account/sync; Qdrant (optional) for vectors.
- **L9 Infrastructure** — `backup/recovery/storage/migration/observability` + compose/Caddy. Descriptor packages stay OUT of the binary.

**Design principle honored (rule 10):** one process, modular. No microservices/Kafka/K8s/mesh added to "look advanced." The desktop main process remains the single runtime; the backend remains the single companion service.

---

## DELIVERABLE 8 — ERP ↔ AI INTEGRATION MATRIX

For every domain: what AI may **read / retrieve / recommend / prepare / execute**, and the required **approval / verification / audit**. Today, **execute = mail.send only**; everything else is read→recommend→prepare(proposal)→human→governed command.

| Domain | AI reads | AI retrieves | AI recommends | AI prepares (proposal) | AI executes today | Approval | Verification | Audit |
|---|---|---|---|---|---|---|---|---|
| CRM | leads/opps/contacts | relationship graph | next action, stale follow-up | draft email (governed) | mail.send only | human confirm | read-back (oracle C) | ActionRecord |
| Sales/O2C | orders/quotes/invoices | customer→invoice→payment chain | demand-trend narrative | draft SO/quote comms | — (governed cmd via human) | RBAC + confirm | — | command journal |
| Procurement/P2P | PO/GR/bills | supplier chain | reorder (S85) → draft PR | draft PR/PO email | draft PR via governed bus | approval engine | 3-way match | journal+events |
| Inventory | stock/ATP/aging | graph | reorder point | — | — | RBAC | posting immutability | movement ledger |
| Warehouse | movements | — | slotting narrative | — | — | RBAC | — | ledger |
| Manufacturing | orders/BOM/variance | graph | variance narrative | — | — | RBAC | variance settlement | journal |
| Maintenance | assets/WO | graph | PM-due narrative | — | — | RBAC | — | records |
| Projects | tasks/billing | graph | risk narrative | — | — | RBAC | — | records |
| Finance/GL/AR/AP | ledger/aging | graph | aging/anomaly (threshold) | draft dunning email | mail.send only | confirm | reconciliation | GL journal |
| HR/Expenses | payroll/claims | — | SoD-anomaly narrative | — | — | SoD | — | records |

**The connected-enterprise requirement is already satisfiable read-side:** `enterprise/relationshipProvider` gives AI a real, tenant-isolated Customer→…→Financial-outcome graph. The gap is *not* connectivity of data — it is that no AI surface yet *queries* that graph in natural language and *narrates* across domains.

---

## DELIVERABLE 9 — AGENT ARCHITECTURE AUDIT

| Component | Exists live? | Where / gap |
|---|---|---|
| Model gateway | **Yes** | `ai/aiEngine`+`privateFirstClient` (Claude/OpenAI/Ollama) |
| Model routing | Yes (label-map) | `ai/modelRouter` |
| Structured outputs | Partial | prompt-JSON parse, not native schema (`responseParser`) |
| Function/tool calling | **Missing** | `modelClient` has no tool fields |
| Streaming | **Missing** | full-response only |
| Context management | Yes | `ai/contextBuilder` (ranked/budgeted) |
| Planning / reasoning | **Missing (as agent)** | deterministic `purposeEngine`/`strategy` only |
| Tool execution | Governed, 1 tool | `cst` mail.send via `liveBrain` |
| Agent state / durable tasks | **Missing** | `packages/ai-runtime` has a registry but is unwired |
| Memory / RAG / retrieval | Memory yes; RAG backend-only | `memory/` live; Qdrant in `apps/backend`, opt-in |
| Event triggers / scheduled agents | Partial | eventBus + scheduled-tasks exist; not agent-wired |
| Human approval / policy / authz | **Yes, strong** | structural ASK-only, RBAC, approval engine |
| Execution verification / read-back oracle | Partial | machinery exists, `productionWired:false` |
| Compensation / retry / idempotency | **Yes** | command journal (S40/S41), reversals |
| Observability / evaluation / model governance | Partial | audit log (non-durable); no eval harness |

**Verdict (Phase 7 — one brain / many specialists):** the correct architecture is **ONE orchestrator + specialist domain agents as configuration, not as separate runtimes.** Do NOT wire `packages/ai-runtime` as a second agent runtime (rule 8). Build the orchestrator on `liveBrain` + the command bus: `USER → orchestrator (intent+context) → specialist prompt/policy per domain → knowledge/memory (graph+search+memory) → tools = governed command proposal-builders → governance (RBAC+cst+approval) → command bus → execution → verification (oracle) → USER`. Specialists (CRM/Sales/Procurement/…) are prompt+policy+tool-set bundles over the *same* runtime and the *same* governed bus.

---

## DELIVERABLE 10 — MEMORY / KNOWLEDGE / RAG AUDIT

- **Durable memory:** `memory/memoryStore` — tenant-scoped, owner-stamped, audited, tombstoned. **A.**
- **Knowledge graph:** `graph/graphStore` + `enterprise/relationshipProvider` — real entity/relationship over live FK links, tenant-isolated hop-by-hop. **A.** Search inside = substring.
- **Enterprise search:** `search/enterpriseSearch` — federated keyword. **A.**
- **Context builder:** `ai/contextBuilder` — real RAG-*shaped* assembly, keyword/graph-based. **A/B.**
- **Embeddings/vector/RAG in desktop:** interfaces + in-memory test-double only. **D.**
- **Real RAG stack:** `apps/backend/src/semantic` (Ollama/OpenAI embeddings + Qdrant, org-scoped, idempotent) — **B, but separate service, opt-in backfill, Qdrant absent from prod compose, silently degrades to lexical.**
- **`packages/{intelligence,ckdl}`:** unwired. **D/F.**

**Biggest knowledge gap:** no always-on semantic layer bundled with the product, and degradation is invisible to user and agent. **Decision (Phase 9):** keep semantic degrade-safe; add a **local (Ollama) embedding option in the desktop** so RAG works with no server dependency, and **surface the semantic on/off/degraded state** honestly (S19 truth rule).

---

## DELIVERABLE 11 — REAL-TIME / LIVELINESS AUDIT

| Signal | Live? | Where |
|---|---|---|
| Domain events / event bus | **Yes** | `platform/eventBus`, `domainEventLog` |
| Outbox / delivery relay | **Yes** | `outboxDispatcher` (S31) |
| Notifications / inbox | **Yes** | `notifications/{eventNotifications,inboxStore}` |
| Activity/timeline | Yes | `timeline/` |
| Runtime telemetry | Yes | `runtimeTelemetry.ts` |
| Background intelligence services | Partial | `serviceManager` background services (reconciler, projections) |
| Streaming AI responses | **Missing** | no SSE in model clients |
| Live dashboard push | Partial | IPC push exists; not everywhere |
| Agent task status | **Missing** | no agent loop to report |

**Target real-time design (no new infra):** reuse the existing event bus + outbox + notifications + IPC push. "Liveness" = wire domain events → background intelligence (already have `serviceManager`) → notification/inbox + renderer push, plus **streaming AI responses** (the one genuinely missing primitive) once tool-calling lands. No Kafka/websockets-server needed for a local-first desktop.

---

## DELIVERABLE 12 — AI AUTONOMY LADDER (L1–L8, architecture-capable)

Per directive: define the architecture to *reach* advanced levels even where business policy isn't yet enabled.

| Level | Current capability | Missing components | Governance req | ERP integration | Risk | Business-policy dependency |
|---|---|---|---|---|---|---|
| L1 Read | LIVE | — | RBAC read | all domains | none | none |
| L2 Analyze | LIVE (deterministic) | — | RBAC read | all | none | none |
| L3 Recommend | LIVE | — | RBAC read | all | none | none |
| L4 Plan | Partial | agent planning, durable task state | proposal-only | all (read) | low | none |
| L5 Human-confirmed execution | **LIVE for mail.send** | capability certification per action (S23 kit) | structural ASK-only + cst | 1 capability | low | none |
| L6 Policy-bounded autonomous execution | **Architecture-ready, not enabled** | Policy DSL (compiled+hashed), policy-guarded ALLOW branch, production oracle | policy-hash ∧ oracle ∧ limits | per certified capability | medium | **YES — the one thing only the business defines** |
| L7 Long-running agents | Not reachable | durable agent loop, scheduled triggers, compensation-per-step | per-step governance + kill switch | multi-step single domain | medium-high | inherits L6 |
| L8 Multi-agent orchestration | Not reachable | orchestrator + specialist agents + cross-domain state | full governance per act | cross-domain | high | inherits L6/L7 |

**The exact policy boundary (identified, not disabled):** L6 needs three buildable pieces — (1) compiled/hashed **Policy DSL** (S28), (2) an **ALLOW branch** in `proposalExecutionBoundary` gated on `policy-hash valid ∧ oracle verified ∧ within limits`, (3) a **production-wired read-back oracle** — plus one **written business-authority policy** the operator supplies (e.g. "ALLOW mail.send to approved domains, max N/day, verification required"). Architecture reaches L6+; enablement waits on that policy. **Do not encode advisory-only as permanent.**

---

## DELIVERABLE 13 — GOVERNANCE ARCHITECTURE

Already the strongest layer, adversarially proven (S98–S104): server-resolved actor (never payload), RBAC on the command bus + inline before every store write, tenant isolation (`resolveScope`, cross-tenant refused), machine-owned status, economic posting inside RBAC-gated actions, idempotency + crash durability, `cst` structural ASK-only, `INTERNAL_ACTION_ORIGIN` legacy-door fence, fail-closed channel classification at boot. **AI holds zero authority; its only external effect path is proposal → governance → execution → verification.** This layer is the moat and needs no convergence — the agentic build plugs *into* it.

---

## DELIVERABLE 14 — MERGE / RETAIN / RETIRE MATRIX

- **MERGE INTO MAIN PLATFORM:** nothing wholesale. Convergence = wiring live subsystems + building the AI orchestrator on the live spine. (Harvest *ideas* — e.g. the agent-registry shape — from `ai-runtime`/`workforce`, re-implemented on the live runtime, not imported.)
- **KEEP AS SHARED LIBRARY:** `shared`, `cst` (frozen), `companion-protocol`, `solution-packs`.
- **KEEP AS BACKEND SERVICE:** `apps/backend` + `cloud-core`, `shared-cloud`, (`runtime` minimal).
- **KEEP AS AI SERVICE:** none separate — AI stays in-process in the desktop; the backend hosts optional semantic/RAG.
- **KEEP AS DATA/KNOWLEDGE SERVICE:** `apps/backend/src/semantic` (Qdrant) as an optional companion; local embedding option to be added in-app.
- **KEEP AS EXPERIMENTAL:** `cli`, `certification`, `cloud-sdk`, `sdk`, `persistence` (as future-DB design ref), `ckdl` (concept).
- **RETIRE / DEPRECATE (candidates, no action this session):** the ~30 unwired "Wave N" / "NCEA" / "Launch Workstream" / deployment-descriptor packages (`ai-runtime`, `intelligence`, `nems`, `workforce`, `automation`, `autonomous-ops`, `security`, `connectors`, `integrations`, `business`, `execution`, `federation`, `industry`, `workplace`, `workspace`, `operations`, `reliability`, `cloudops`, `production`, `commercial`, `platform-automation`, `platform-operations`, `environment-provisioning`, `deploy`, `deployment-orchestrator`, `operator-deployment`, `customer-deployment`, `infrastructure`, `release`, `customer-experience`, `enterprise-connectivity`, `trust-platform`, `integration-platform`, `connectivity`). **Evidence:** zero live-app source consumers. **Retirement = archive/exclude from build later, after a per-package harvest review — never a blind delete.**
- **BUILD NEW:** AI orchestrator + specialist agents (on live spine), tool-calling→proposal-builders, Policy DSL, production oracle, streaming, local embeddings, NL-query/narrative surface, durable AI audit chain.
- **DO NOT BUILD:** second command bus/approval/workflow/agent runtime; AI direct DB/GL/inventory/payment; microservice sprawl; ML sold as shipped.

---

## DELIVERABLE 15 — ARCHITECTURAL GAP MATRIX

| # | Gap | Severity | Buildable on live spine? |
|---|---|---|---|
| G1 | No model tool/function-calling | High | Yes (extend `modelClient`) |
| G2 | No wired agent loop / durable task state | High | Yes (build on `liveBrain`+bus; don't import `ai-runtime`) |
| G3 | No Policy DSL (blocks L6) | High | Yes |
| G4 | No policy-guarded ALLOW branch | Med (by design) | Yes (policy-hash+oracle gated) |
| G5 | Read-back oracle `productionWired:false` | High | Yes (machinery exists) |
| G6 | No shipped semantic/RAG; silent degrade | Med | Yes (local embeddings + surface state) |
| G7 | Only 1 certified consequential capability | High | Yes (S23 kit repeatable) |
| G8 | AI audit log not durable/chained | Med | Yes (evidence-store pattern) |
| G9 | No NL-query/narrative over the graph | High (value) | Yes (all assets exist) |
| G10 | No streaming AI | Med | Yes (SSE in clients) |
| G11 | 39 unwired packages = maintenance/confusion drag | Med | Retire/archive per review |
| G12 | No ML (forecast/anomaly) | Low-Med | Separate track, needs data+models |

---

## DELIVERABLE 16 — TIER 0–5 IMPLEMENTATION ROADMAP

- **Tier 0 — Architectural foundation.** (a) Publish the convergence decision (this doc) as the canonical architecture statement; (b) mark the 39 packages as archive-candidates in a tracking doc (no deletion); (c) persist + chain the AI audit log (G8); (d) surface semantic-degradation state (G6). *Why:* truth + hygiene, zero capability risk. *Autonomy: L1–L3 unchanged.*
- **Tier 1 — AI platform foundation.** Governed **NL-query + narrative surface** over the relationship graph + search + memory + context builder + LLM plumbing (G9). Add **streaming** (G10). *Reuse:* everything exists. *Build:* one renderer copilot panel + query orchestration. *Value: high; risk: low (advisory). Autonomy: L1–L3, delivered as product.*
- **Tier 2 — Enterprise intelligence.** Production-wire the **read-back oracle** for mail.send (G5); certify **capability #2** via the S23 kit (G7). *Autonomy: solidifies L5 breadth.*
- **Tier 3 — Agentic ERP (governed proposal).** **Tool-calling limited to proposal-builders** (G1) — the model may *propose* a governed action object; human still confirms; every act on the existing bus. Minimal **durable task state** (G2). *Autonomy: L4→L5 across domains.*
- **Tier 4 — Policy-bounded autonomy.** **Policy DSL** (G3) + **policy-guarded ALLOW** (G4), gated on the operator's written business-authority policy + a live oracle. *Autonomy: first true L6, bounded + reversible.*
- **Tier 5 — Advanced multi-agent autonomy.** **Orchestrator + specialist agents** on the live spine; long-running single-domain agent with kill switch + digest, then cross-domain (G2). *Autonomy: L7→L8.*
- **Parallel ML track (independent):** forecast/anomaly/optimization — needs data pipelines + models; do not sequence into the agentic ladder.

---

## DELIVERABLE 17 — TOP 10 ADVANCED-AI CAPABILITIES TO BUILD

1. **Governed NL-query + cross-domain narrative** over the relationship graph (Tier 1) — flagship, advisory, ships on proven assets.
2. **Streaming AI responses** (Tier 1) — makes the copilot feel alive.
3. **Durable, chained AI audit log** (Tier 0) — trust foundation.
4. **Production-wire the mail.send read-back oracle** (Tier 2) — closes §2 #14 on the live capability.
5. **Surface semantic on/off/degraded state + local (Ollama) embeddings** (Tier 0/1) — real RAG without a server dependency.
6. **Certify capability #2 via the S23 kit** (Tier 2) — proves L5 breadth is repeatable.
7. **Tool-calling limited to proposal-builders** (Tier 3) — agentic proposal, zero execution risk.
8. **Policy DSL + operator's first business-authority policy** (Tier 4 prep) — unblocks L6 by *defining* the boundary.
9. **Policy-guarded ALLOW branch** behind DSL + oracle (Tier 4) — first bounded unattended execution.
10. **Orchestrator + one specialist domain agent** on the live spine (Tier 5) — the real agentic milestone, last.

---

## DELIVERABLE 18 — "DO NOT BUILD YET" LIST

1. A **second agent runtime** (do not wire `packages/ai-runtime`/`workforce`) — the live spine is capable (rule 8).
2. A **bare ALLOW branch** — only policy-hash + oracle gated.
3. **L6 unattended execution** without a written business-authority policy — nothing to authorize against (rule 14).
4. **Mass package merge or deletion** — retire only after per-package harvest review (rules 2–4).
5. **AI direct DB/GL/inventory/payment access** (rules 11–13).
6. **Microservices/Kafka/K8s/mesh** for the desktop (rule 10).
7. **ML forecasting** sold as shipped — no data pipeline/model exists (G12).
8. **DB migration off DurableJsonStore** as an AI prerequisite — it is not one; local-first is deliberate.
9. **Gemini/Mistral/Qwen** providers until a customer needs them.
10. **Duplicate command bus / approval / workflow / notification / event systems** (rules 5–9).

---

## DELIVERABLE 19 — EXACT RECOMMENDED FIRST BUILD

**Tier 1 — the Governed Natural-Language Query + Cross-Domain Narrative surface ("NeuroPause Copilot"), advisory (L1–L3 only), streaming.**

- **Why:** highest leverage ÷ risk. It is the "our ERP is alive and understands itself as one connected system" product moment, and it directly answers the Phase-5 requirement that AI understand the enterprise as a connected system rather than isolated modules.
- **What exists already:** the tenant-isolated relationship graph (`enterprise/relationshipProvider` + `graph/graphStore`), federated search (`search/enterpriseSearch`), durable memory (`memory/`), the ranked/budgeted context builder (`ai/contextBuilder`), and the production-wired LLM gateway (`ai/aiEngine`+`privateFirstClient`). RBAC/tenancy gate every read.
- **What must be reused (not rebuilt):** all of the above — no new store, graph, search, or memory (rule 9).
- **What must be built:** (1) a query-orchestration service that turns a user question into graph/search/memory retrievals + a context bundle, (2) streaming completion through the existing gateway, (3) one renderer Copilot panel, (4) the durable AI audit-log write (Tier 0 folded in).
- **Dependencies:** none blocking — rides entirely on live, proven subsystems.
- **Risk:** low — advisory only; touches no economic authority, no frozen surface, no governance kernel; no FG token required.
- **Expected user value:** high and immediate.
- **Expected AI autonomy level:** L1–L3 (read/analyze/recommend). It deliberately does **not** cross into execution — that waits for Tiers 2–4 and the operator's policy decision.

---

## FINAL FOUNDER VERDICT

**Do we have one coherent enterprise platform or multiple partially connected systems?** — **Both, cleanly separated.** The *running product* (`apps/desktop` + `apps/backend`) is **one coherent, singular platform**: one command bus, one workflow runtime, one store framework, one governance kernel, one AI gateway, one relationship graph — internally consistent and adversarially proven. Beside it sits an **island of ~39 unwired packages** that duplicate, in standalone form, subsystems the app already runs. The fragmentation is *not inside the app* — it is the dead island next to it.

**What must be converged to create ONE advanced, live, intelligent, agentic NeuroPause?** — **Wire the live subsystems together and to the AI layer; retire the dead island after harvest review.** Concretely: (1) build the AI orchestrator/specialists **on the live spine** (never a second runtime); (2) give the model **tool-calling into proposal-builders** and **streaming**; (3) add a **Policy DSL + policy-guarded ALLOW + production oracle** to reach bounded autonomy (L6), gated on one operator business-policy decision; (4) surface **semantic/RAG** honestly with a **local embedding** option; (5) archive the 39 packages per review. **No mass merge, no deletion, no duplicate spine — convergence is wiring, not importing.**

**Single highest-leverage build next?** — **The Governed NL-Query + Cross-Domain Narrative Copilot (Tier 1, advisory, streaming).** It ships on proven assets, makes the enterprise legible to the user as one connected system, carries zero execution/governance risk, and lays the context/streaming groundwork every higher tier reuses.

---

## S106 STATUS

- **Class:** discovery + architecture audit. **Production code changed: NONE. Build: NONE. Deletions: NONE. Package merges: NONE. Frozen surfaces: untouched. `baseline.json`: untouched. Release-track: untouched (paused).**
- **Rules honored:** no mass refactor/merge/delete; no duplicate spine proposed; no AI-DB/authz/GL bypass; no microservice sprawl; no business-policy invention; no release work; roadmap not implemented; no feature built to show progress.
- **Per directive:** STOP after architecture + roadmap. **Do NOT auto-proceed to the next build.** Recommended first build = **Tier 1 NL-Query/Narrative Copilot (advisory)** — awaiting operator go before any implementation session.
