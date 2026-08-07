# NeuroPause Desktop — Technical Architecture & Due-Diligence Report

**Prepared:** 6 August 2026  
**Repository:** `neuropause-desktop` · branch `phase6-stage13-enterprise-digital-twin-platform` · HEAD `804e30c`  
**Basis:** Forensic reconstruction grounded in the repository — ~445,000 LOC across 48 workspaces, 866 test files. Recon by 13 parallel agents mapping the code via the terminal on the source machine; synthesis by 6 section-writers; an adversarial auditor verified grounding (Appendix A).  
**Reading note:** Sections 1–17 are grounded in code evidence with file-path citations. Sections 18–20 (competitive, roadmap, investor) contain forward judgment explicitly labelled **ANALYSIS/OPINION** vs **CODE-EVIDENCE**.

---

## 1. Executive Summary

**What NeuroPause Desktop actually is (CODE-EVIDENCE):** NeuroPause Desktop is a **local-first, Electron + TypeScript enterprise ERP and AI platform** that runs as a signed (in intent) desktop application, backed by a thin cloud service for identity, sync, billing, and semantic memory. It is a genuine engineering artifact — not a demo or scaffold. Across the surveyed clusters, the substantive business logic is real, deterministic, and covered by co-located unit tests. The repository is a single npm-workspaces monorepo (`package.json` root, version `1.0.0-rc.14`) spanning `apps/*` and `packages/*`, with **866 test files repo-wide and 44 Vitest configs**.

**The architectural thesis.** The platform is built on one dominant, load-bearing pattern: a **declarative "Enterprise Module Framework"** (`apps/desktop/src/main/enterprise/framework/enterpriseModule.ts`, `moduleRegistry.ts`, `enterpriseRecordStore.ts`). A module is nothing more than a *descriptor + a record store*; the framework injects RBAC, audit, timeline/platform events, renderer broadcasts, generic CRUD IPC, offline-first JSON persistence, a status lifecycle, and two extension seams (`runAction` for custom actions, `onChange` for cross-module reconciliation). This yields a certified inventory of **exactly 95 modules across 13 families**, locked by a real quality gate (`moduleCertification.test.ts` asserts `toHaveLength(95)` and `total===95`) and matched by **95 `registry.register(...)` calls in `enterprise/index.ts`**. (Note: the certification test's *prose* still says "94" and the Finance banner says "19" for 20 descriptors — stale strings that contradict the live assertions.)

**What is genuinely implemented (CODE-EVIDENCE):**

- **A real double-entry accounting ERP.** The Finance cluster (20 modules) is anchored by a true posting kernel: journal entries reject unless cents-rounded debits === credits and every line resolves to a Chart-of-Accounts record; posted entries are immutable (corrections via reversing entries); and an **idempotent auto-posting seam** (`finance/glPosting.ts`, 563 LOC) converts invoice/payment/vendor-bill/vendor-payment/FX-revaluation lifecycle events into deterministic journal entries that never double-post on re-fire. Multi-currency AR/AP, realized and unrealized FX gain/loss, FX exposure, cash flow, budgets, fixed-asset depreciation, GST/tax reporting, and bank reconciliation are all present with ~4.6K LOC of finance tests.
- **A real India-statutory gross-to-net payroll engine** (`packages/shared/src/types/statutoryRules.ts`, 545 LOC) with effective-dated PF/ESI/PT/TDS rule tables (rates stored as audited records, never hardcoded in formulas), balanced GL accrual posting, NEFT bank advice, immutable payslips, and ECR/ESI/PT/24Q filing registers.
- **A fully event-sourced supply chain.** A single immutable Inventory Ledger (`inventory/stockMovementModule.ts` + `postMovement.ts`) is the source of truth; Procurement, Warehouse, Manufacturing (MES with BOM backflush/output/scrap), and Maintenance all mutate stock **only** through the shared `postStockMovement` seam. Multi-method valuation (FIFO/weighted-average/moving-average/standard) exists in `inventoryValuation.ts`.
- **A real, layered AI platform (shipping path).** `apps/desktop/src/main/ai/` provides a provider-agnostic `AiEngine` with real Anthropic (`claudeClient.ts`) and local Ollama (`ollamaClient.ts`) inference, tiered routing (Haiku 4.5 / Sonnet 4.6 / Opus 4.8), token/cost accounting, a hash-only audit log, 32 versioned prompts with an anti-hallucination grounding clause, and a **deterministic-first** design where the LLM only narrates and silently falls back to grounded summaries when unconfigured.
- **A real backend.** `apps/backend` (~15.8K LOC, 38 test files) is the *only* deployed HTTP surface — Express over Postgres 16 + Redis 7, with working OAuth-PKCE (Google/GitHub/Microsoft/Apple), JWT HS256 sessions, last-write-wins sync, Razorpay billing, and Qdrant/Ollama semantic memory — shipped with a Dockerfile, prod compose, and CI-validated K8s/Helm manifests.

**What is partial or absent (CODE-EVIDENCE):** Three consistent honesty patterns run through the codebase. **(1) Two parallel worlds.** A large body of `packages/*` — `ai-runtime`, `intelligence`, `runtime`, `execution`, `automation`, `autonomous-ops`, `security`, `trust-platform`, five connector packages, eight release/deploy packages (~12.8K LOC) — is real, tested library code that is **NOT imported by `apps/desktop` at all** (grep confirms zero import hits); it is consumed only by peer packages. These represent significant sunk engineering that does not reach the shipping product. **(2) Adapter-verified, not live.** Every SaaS connector (22 manifests, 12 real adapter families in `unified/sync/adapters/`) is verified against *simulated* responses; live traffic needs operator OAuth apps + network. Enterprise crypto packages self-label live IdPs/KMS/HSM/certification as **INFRA-PENDING**. **(3) Read-only projections.** The knowledge-graph, digital-twin, and most "*Platform" executive surfaces are by-design read-only compositions that own no mutators — notably, **no live simulation is ever executed**: the one real 617-LOC manufacturing what-if engine (`manufacturingDigitalTwin.ts`) has no runtime caller and no test.

**Notable integrity signals.** The codebase is unusually candid: a `capabilityRegistry.ts` explicitly marks features as `needs-backend` or `hidden` ("No such subsystem exists in production"); code signing/notarization automation exists but has **never been exercised** (no Apple cert; every CI build to date is UNSIGNED); and the desktop still persists to JSON files under Electron `userData` (not the Postgres platform in `packages/persistence`). A grep for `TODO/FIXME/stub` across the core ERP domains returns essentially zero real code stubs — only UI field placeholders.

**Bottom line (ANALYSIS/OPINION):** NeuroPause Desktop is a *deep, real, well-tested local-first ERP + AI core* wrapped in a *much larger, honestly-labeled preview layer* of enterprise-platform libraries that are not yet wired into the shipping app. The gap between "certified/registered and running in the desktop" (strong) and "enterprise packages + live external integrations" (preview/infra-pending) is the single most important thing for a diligence reader to internalize.

---

## 2. Complete Platform Architecture

This section maps the system layer by layer, distinguishing what runs in the shipping desktop app, what runs in the cloud backend, and what exists only as unwired library code.

### 2.1 Topology overview (CODE-EVIDENCE)

There are two runtime realities plus a large unwired library tier:

| Tier | Location | Status | Reaches the user? |
|------|----------|--------|-------------------|
| Desktop app (Electron main + renderer) | `apps/desktop` | Implemented, wired | Yes — the product |
| Cloud backend (HTTP API) | `apps/backend` | Implemented, deployable | Yes — via desktop clients |
| Unwired enterprise libraries | `packages/*` (ai-runtime, intelligence, runtime, execution, automation, security, connectors ×5, release/deploy ×8, cloud-core, persistence, federation) | Real + tested, **not imported by apps/** | No — peer-package consumption only |

The composition root for the desktop is `apps/desktop/src/main/runtimeCore.ts` (2,887 LOC), which wires every subsystem behind secure IPC and bridges lifecycle/health events to the renderer.

### 2.2 Desktop application shell & renderer (Implemented)

- **Navigation:** `apps/desktop/src/renderer/src/shell/sections.ts` defines ~48 navigable `SectionId`s, each mapped 1:1 to a lazy-loaded view in `AppShell.tsx` (`renderView` switch). Sections carry honesty flags (`hidden`, `preview`, `phase`).
- **Capability honesty layer:** `renderer/src/capability/capabilityRegistry.ts` classifies each feature as `production-complete / managed / read-only / needs-backend / hidden`. It explicitly marks unbuilt work: passkeys, session list/revoke, in-app password change = `needs-backend`; NeuroID, login history, consent/retention = `hidden`.
- **Hidden-but-routable surfaces:** the Enterprise Federation view (`federation-center`), `decision-center`, `developer-center`, and `control-plane` are fully coded but `hidden:true` in `sections.ts`.
- **Mission Control** (`renderer/src/missionControl`, 2,067 LOC) is a pure read-only projection over the sections registry, capability registry, and provider snapshots.

### 2.3 IPC boundary & security hardening (Implemented)

The renderer↔main boundary is the primary trust boundary and is genuinely hardened:

- **Window hardening** (`main/window.ts`): `contextIsolation:true`, `sandbox:true`, `nodeIntegration:false`, `webSecurity:true`.
- **Strict CSP** (`security/csp.ts`): packaged `default-src 'self'`, `object-src none`, `frame-ancestors none`.
- **IPC router** (`ipc/router.ts`): channel allowlist + Zod validation + sender-origin trust (`file://` or configured Vite origin only).
- **Secure middleware pipeline** (`ipc/secureBridge.ts`): `requireAuth → permission(authorize) → Zod safeParse → withTimeout → audit → error shaping`. Note the per-IPC audit log is plain fire-and-forget JSONL — **not** hash-chained (weaker than the `security/auditChain.ts` primitive used for enterprise governance logs).
- **Fail-closed runtime authz** (`ipc/runtimeAuthz.ts`, 399 LOC): every privileged channel is classified to an `EnterprisePermission`; `assertAllChannelsClassified` throws at startup for any unclassified channel.

### 2.4 Authentication & identity (Implemented client; backend-delegated)

- Desktop `auth/authService.ts` runs RFC 8252 native-app OAuth: PKCE S256 + ephemeral loopback catcher (`auth/loopbackServer.ts`, unguessable `/callback/<hex>` path) + CSRF state check. Access token stays in-memory; refresh token is encrypted at rest via Electron `safeStorage` (`security/secureStore.ts`), which **refuses to persist** when OS encryption is unavailable (no plaintext fallback).
- **The backend (`apps/backend/src/auth/`) is the sole identity authority** — JWT HS256 (issuer `neuropause`, audience `neuropause-desktop`), Redis-backed refresh rotation/revocation, loopback-only redirect enforcement. Actual password hashing and IdP client secrets live only in the backend.
- **Partial/absent:** SSO/SAML/OIDC federation (`cloud/identity/federation.ts`) is deterministic protocol *modeling* — issuer/audience/domain/claim checks with **no signature or JWKS verification**. No live Okta/Azure AD/Auth0/Ping integration; SCIM and LDAP/AD are absent from wired surfaces.

### 2.5 RBAC / authorization (Implemented)

The desktop's live RBAC is `enterprise/authzGate.ts` + `authz.ts`: a per-org role model (Owner/Admin/Manager/Member/Viewer/AI-Worker) with `EnterprisePermission` scopes. `resolveActor` fails closed once an owner is claimed (first-claim-wins bootstrap); only *active* members hold permissions; the owner and built-in roles are protected from lockout. This is distinct from per-app capability grants in `permissions/permissionManager.ts`.

### 2.6 The Enterprise Module Framework (Implemented — the architectural core)

- `framework/enterpriseModule.ts` (`defineEnterpriseModule`) validates a descriptor at wiring time (throws on inconsistency) and exposes hooks `validate / onChange / summarize / runAction`. `onChange` is **awaited**, so cross-module reconciliation is atomic from the caller's perspective.
- `framework/moduleRegistry.ts` provides generic CRUD/list/get/setStatus/action IPC and fans out lifecycle events (created/updated/status_changed/deleted → audit + platform timeline + renderer broadcast + `onChange`). This is the closest thing to a workflow engine — **there is no generic reusable approval/workflow engine**; approval is per-module state machines (most notably the Executive family's `decisionTransition`/`proposalTransition` guards in `@neuropause/shared`, strictly human-in-the-loop).
- `framework/enterpriseRecordStore.ts` is an offline-first JSON-backed store with a cloud-sync-ready record shape (`rev/status/kind`).

### 2.7 Local runtime & app supervisor (Implemented)

`runtime/supervisor.ts` owns live app instances with a lifecycle state machine (launch/stop/suspend/resume/restart), health checks, resource sampling, crash detection, and a restart policy (`MAX_RESTARTS=3`), routing app kinds to pluggable `WebRuntimeAdapter`/`ProcessRuntimeAdapter`.

### 2.8 Database & persistence (Implemented desktop JSON; Partial cloud Postgres)

- **Shipping desktop:** local-first JSON files under Electron `userData` with atomic tmp+rename writes — the Unified Data Model store (`unified/unifiedStore.ts`, source-authoritative last-updated-wins conflict resolution with content-signature tie-break), `syncStateStore.ts`, registry, onboarding. **No embedded SQL DB ships in the desktop.** Scalability caveat: these stores load the entire JSON file into memory and rewrite it on every change; the promised SQLite/Postgres backing is noted in comments but **not implemented**.
- **Cloud platform (Partial/Preview):** `packages/persistence` is a real ACID layer over embedded PGlite (WASM Postgres) with reversible checksummed migrations, append-only event store, object storage, cache, and RLS multi-tenancy — but it self-labels **PREVIEW**, networked Postgres/Redis/S3/PITR are infra-pending, and it is **not imported anywhere under `apps/desktop/src`**. The shipping backend uses real Postgres 16 directly (`apps/backend`).

### 2.9 Sync engine & message flow (Implemented)

- **Desktop sync orchestrator** (`unified/sync/orchestrator.ts`): ~30 SaaS adapters driven by a rate-limited, concurrency-bounded loop (`MAX_CONCURRENT_SYNCS=4`, `MAX_PAGES_PER_RESOURCE=50`, 15-min cadence) with persisted per-resource cursors, in-flight coalescing, exponential-backoff retry (`retryQueue.ts`), a durable dead-letter queue, and a boot-time crash reconciler (`syncStateStore.reconcile()`).
- **Backend sync** (`apps/backend/src/sync/service.ts`): org-scoped push/pull, last-write-wins via shared `resolveSync`, global-seq cursor, device-echo exclusion.
- **Desktop livesync client** (`cloud/livesync/engine.ts` + `transport.ts`): real, timer-free, HTTP-wired to the backend `/sync/:orgId/push|pull` with Bearer token — the working client half of the sync backend.

### 2.10 Event bus / message bus (Implemented desktop; Partial packages)

- The desktop's real event fabric is the **Platform Event Bus** driven through `moduleRegistry` lifecycle fan-out and the **Enterprise Webhooks** subsystem (`main/webhooks/index.ts`) — the most operational component, with signed (HMAC), retried, dead-lettered outbound HTTP delivery, a 10 s AbortController timeout, and `redirect:'error'` SSRF defense.
- **Partial/unwired:** `packages/cloud-core` (EventBus with routing/retry/DLQ/replay/versioning) and `packages/runtime` (`EnterpriseRuntime` event bus + tick-driven scheduler) are real but in-memory only and **not imported by the desktop**.

### 2.11 Scheduler & automation (Implemented, conservative)

The desktop's genuine autonomous-execution seam is the **Enterprise Automation Platform** (`main/automationPlatform/index.ts`, `TICK_MS=60_000`): a 60-second tick fires *due* schedule-triggered rules through the existing workflow runner, gated by explicit policy (empty policy list ⇒ nothing auto-executes). By deliberate design, `orchestration/` and `autonomousOps/` are **read-only projections that structurally cannot execute** ("no autonomous bypass" cardinal invariant). Daily backups are scheduled via `releaseOps/index.ts` (24 h interval, retain 10).

### 2.12 AI runtime (Implemented shipping path; Partial unwired stacks)

- **Shipping path (`main/ai`, `assistant`, `memory`, `intelligence`):** `aiEngine.ts` (render → context → route → parse → price → audit, with a `grounded:false` deterministic fallback), `modelRouter.ts` (fast/balanced/deep → Haiku/Sonnet/Opus), real `claudeClient.ts` (Anthropic Messages API) and `ollamaClient.ts` (local, $0 cost), `promptManager.ts` (32 grounded prompts), `contextBuilder.ts` (federated retrieval + relevance×recency ranking), Founder AI v2 and Engineering AI (deterministic findings, LLM narrates only), and a 1,900-LOC `assistantService.ts` with a 9-phase, human-approval-gated turn pipeline.
- **Semantic memory:** real cosine `vectorStore.ts` + a resilient (circuit-breaker + 4 s deadline) backend delegation (`memory/resilientSemanticSearch.ts`, `backendSemanticClient.ts`). **The desktop owns no embedding provider** — real embedding lives in `apps/backend` (Ollama/OpenAI); with no backend, semantic recall degrades to lexical. Qdrant/Pinecone are named future work.
- **Partial/unwired:** `packages/ai-runtime` (full agent/tool/workflow/connector governance runtime) ships only a deterministic `FakeProvider`, self-describes PREVIEW, and is **not imported by the desktop**. `packages/intelligence` (7 executive copilots, deterministic reasoning) defaults to `DeterministicAiProvider` with live providers "infra-pending." Two parallel AI stacks that do not converge in the shipping product.

### 2.13 Cloud service layer (Implemented backend; Partial cloud composition)

- **Implemented:** `apps/backend` (Express, Postgres 16, Redis 7, OAuth-PKCE, JWT, LWW sync, Razorpay billing, Qdrant semantic memory), with `/live`, `/health`, `/metrics`, a Dockerfile, `docker-compose.prod.yml`, and CI-validated K8s/Helm/observability manifests under `deploy/`. **Caveat:** backend routes are **unversioned by path** (no `/v1` prefix).
- **Partial/Preview:** `apps/cloud` (211 LOC) is explicitly *not a running server* (no HTTP listener, no DB) — a composition wrapper over the in-memory `packages/cloud-core` primitives. `packages/federation` is entirely in-memory (Maps); real clusters/multi-cloud/DR are INFRA-PENDING.
- **Hidden:** the desktop "Enterprise REST API" (`main/api/apiGateway.ts`, 27 routes + live OpenAPI 3.1 generation) is real but exposed **only over IPC** to the renderer developer portal — **no HTTP server binds it**.

### 2.14 Plugin runtime (Partial — real isolation, open trust chain)

`main/plugins/pluginHost.ts` provides genuine OS-process isolation (forked Node host `plugin-host.cjs`), a permission-gated host-call bridge, crash detection, hot-reload, and a Zod manifest schema with a hand-rolled semver matcher. **Gaps:** `pluginManager.install()` copies from a source directory with **no signature/integrity verification** (even though the marketplace pipeline signs manifests with Ed25519 — the trust chain is not closed at install); permissions are auto-granted at install (prompt UI "not landed"); and `runModel` is a declared seam returning `no_local_model_configured`.

### 2.15 Enterprise runtime (Partial — built, unwired)

A complete enterprise runtime exists in `packages/runtime` (`createEnterpriseRuntime`: event bus, tick-driven scheduler, lifecycle, plugin runtime, service registry, observability) and `packages/execution` (connector execution engine: policy → HITL → rate-limit → circuit-breaker → retry transport → govern → evidence). Both are real and tested but **duplicate the desktop's own `runtimeCore.ts` and are not imported by `apps/desktop`** — two independent runtime models coexist, and the package event store is `InMemoryEventStore` only (non-durable).

### 2.16 Knowledge graph (Implemented, read-only)

`main/graph/` is the only stateful sense-making subsystem: `graphStore.ts` (in-memory + `graph.json` persistence, in/out adjacency, shortest-path/subgraph queries, capped 5000-event relationship-history log) and `projector.ts` (UDM entities + connectors + apps + ERP model + plugin extensions + resource graph → typed provenance-tagged nodes/edges), wired via 8 `graph:*` IPC channels. Layered on top: `knowledge/` (IDF-weighted relatedness + union-find topic clustering), `knowledgeAssets/` (P6-Stage7 decision platform, 3,394 LOC), and `knowledgeFabric/` (P16 Evidence/Sources/Reasoning/Confidence model). **Gaps:** no dedicated graph explorer view (consumed piecemeal); `knowledge:health` is registered in main but not exposed in the renderer IPC facade.

### 2.17 Digital twin (Partial — inventory, not simulation)

`twin/` (P15) and `digitalTwinPlatform/` (P17-Stage13, 2,379 LOC) are read-only projections into domain twins, topology, health maps, blast-radius, and a *simulation inventory*. **Critically, no live simulation ever runs:** `twin/` passes P14's `SimulationReport` through unmodified; `digitalTwinPlatform` sets `simulationInventory.invoked` to a compile-time `false`; and the cluster's only real engine — `packages/shared/src/types/manufacturingDigitalTwin.ts` (617 LOC, 15 scenario types, `runSimulation`) — has **no IPC caller, no UI, and no test file**; its sole main-process reference is a descriptive string in `twinRegistry.ts`.

### 2.18 Deterministic prediction / intelligence layer (Implemented)

`insight/` (P6-Stage6, 2,555 LOC) provides 7 evidence-carrying prediction heuristics (`predictions.ts`, explicitly "no ML, no model, no randomness"), an 8-domain health framework, and 10 enterprise-question resolvers over 5 `insight:*` IPC channels — fully wired to the renderer `InsightDashboard`.

### 2.19 Architecture assessment (ANALYSIS/OPINION)

The architecture's strength is a single, well-chosen abstraction (the descriptor-driven module framework) applied consistently to produce 95 certified, uniformly-governed modules with real double-entry/event-sourced cores — this is the genuine moat. Its principal architectural risks are (a) **the persistence scalability ceiling** of whole-file JSON rewrites in the shipping desktop, (b) **substantial dead/parallel code** — the entire `packages/*` enterprise tier duplicates concepts (runtime, connectors, cloud, security, release) that never reach the app, creating divergence and maintenance risk, and (c) **the live-integration gap** — connectors, IdP federation, digital-twin simulation, and code-signing are all adapter-verified or infra-pending rather than exercised end-to-end. None of these are correctness defects in the shipping core; they are the boundary between a strong local-first product and the "enterprise platform" narrative that surrounds it.

## 3. Complete Module Inventory

This inventory is grounded entirely in the recon corpus for branch `phase6-stage13` (HEAD `804e30c`). Every module family below is traced to real files under `apps/desktop/src/main` and `packages/`. Where the corpus does not support a claim, the capability is marked absent or unverified rather than asserted.

### 3.1 Certified module count (CODE-EVIDENCE)

The platform runs a real registry-wide certification gate at `apps/desktop/src/main/enterprise/modules/moduleCertification.test.ts`, which asserts `expect(ALL).toHaveLength(95)` and `total === 95`, and `apps/desktop/src/main/enterprise/index.ts` contains exactly **95** `registry.register(...)` calls (`grep -c` = 95). The **certified count is 95 enterprise modules across 13 families**:

| Family | Certified count | Path root |
|---|---|---|
| Finance | 20 | `enterprise/modules/finance` |
| CRM | 8 | `enterprise/modules/crm` |
| HR | 8 | `enterprise/modules/hr` |
| Warehouse | 8 | `enterprise/modules/warehouse` |
| Sales | 7 | `enterprise/modules/sales` |
| Inventory | 7 | `enterprise/modules/inventory` |
| Procurement | 6 | `enterprise/modules/procurement` |
| Manufacturing | 12 | `enterprise/modules/manufacturing` |
| Maintenance | 10 | `enterprise/modules/maintenance` |
| Projects | 4 | `enterprise/modules/projects` |
| HR/Executive | 3 | `enterprise/modules/executive` |
| Helpdesk | 1 | `enterprise/modules/helpdesk` |
| Documents | 1 | `enterprise/modules/documents` |

> **Tech-debt (CODE-EVIDENCE):** The certification test's own prose is stale relative to its assertions — the header comment and `it()` title still say "94", a comment references adding an "84th" module, and the Finance import banner says "(19)" for 20 registered descriptors. The assertions (95) are authoritative; the strings are misleading. Additionally, the certification is a **static enumerated lock, not a live-registry read** (stated in its own docstring): a newly registered module is live over generic IPC but is not "certified" until the enumerated list is manually updated — a deliberate re-certification checkpoint that also permits silent drift.

The separate marketing artifact `certification-matrix.csv` scores **92** modules across 14 quality dimensions — a documentation artifact, not the runtime lock, and it disagrees with the runtime count of 95.

### 3.2 The Enterprise Module Framework (foundation)

- **Purpose:** A declarative ERP framework where a module = a descriptor + a record store. The framework injects RBAC, audit, timeline/platform events, renderer broadcasts, generic CRUD IPC, offline-first JSON persistence, a status lifecycle, and `runAction`/`onChange` seams.
- **Status:** **Implemented.** `framework/enterpriseModule.ts` (145 LOC, throws on invalid descriptor at wiring time), `framework/moduleRegistry.ts` (374 LOC, `buildModuleHandlers` fan-out of audit + platform event + broadcast + awaited `onChange`), `framework/enterpriseRecordStore.ts` (240 LOC).
- **Dependencies:** `@neuropause/shared` (pure engines, transition guards, descriptor validator), Electron `userData` for persistence.
- **Connected modules:** All 95 certified modules; the renderer's generic `EnterpriseModuleScreen`/`EnterpriseModulesHub`.
- **Missing functionality:** No generic/reusable **workflow or approval engine** — approval is hand-rolled per module (see Executive family). `framework/index.ts` docstring misleadingly claims "none in this foundation release"; real registration is in `enterprise/index.ts`.
- **Production readiness (CODE-EVIDENCE):** High for the shipping desktop path; the framework is exercised by every certified module and by `moduleCertification.test.ts`.

### 3.3 Finance / Accounting (20 modules)

- **Purpose:** Genuine double-entry accounting ERP: GL, journals, invoices/AR, vendor bills/AP, payments, fixed assets, tax/GST, aging, budgets, bank reconciliation, multi-currency FX (rates/settlement/revaluation/exposure), cash flow, financial ratios, accounting periods, chart of accounts.
- **Status:** **Implemented.** Two-layer pattern: ~2.8K LOC of Electron-free engines in `packages/shared/src/types` (`generalLedger.ts` 839, `finance.ts` 529, `fxRevaluation.ts` 245, `fxExposure.ts` 244, `fxGainLoss.ts` 235, `bankReconciliation.ts` 186, `adjustmentNotes.ts` 142, `exchangeRates.ts` 128, `cashFlow.ts` 110, `budgets.ts` 104, `financialRatios.ts` 66) + ~4.9K LOC of thin descriptor modules under `enterprise/modules/finance`.
- **Core kernel:** `journalEntryModule.ts` (376 LOC) rejects entries unless cents-rounded debits === credits and every line resolves to a CoA record; posted entries are immutable (reversing entries only). `glPosting.ts` (563 LOC) is an idempotent auto-posting seam keyed by deterministic entry numbers so lifecycle re-fires never double-post.
- **Dependencies:** GL engine, framework, cross-module stores (fx exposure injects invoice/bill/rate/ledger/journal stores via `fxExposureModuleInstance.ts`).
- **Connected modules:** Sales (invoice conversion re-authorizes Finance scope), Projects (`billingRunModule` mints real invoices via `moduleFor(FINANCE_MODULE_ID)`), HR Payroll (balanced GL accrual + disbursement), executiveCenter (consumes `deriveInvoiceInsights`/`invoiceInsightsToKpis`).
- **Missing functionality:** Bank reconciliation is auto-match + summary only — `matchBankStatement` produces candidates, **no write-back/clearing postings**. Straight-line is the only depreciation method (no declining-balance/units-of-production). Journal and bank-statement lines are entered as **raw JSON textarea fields** in the generic renderer — no structured line-item editor. No bespoke finance screens beyond the generic hub.
- **Production readiness (CODE-EVIDENCE):** High. 25 finance test files (~4.6K LOC) plus engine tests; zero genuine code stubs (all 55 TODO/placeholder grep hits are UI field `placeholder` props). `*ModuleInstance.ts` singletons have no direct unit tests (covered indirectly) — minor tech-debt.

### 3.4 HR & Payroll (8 modules)

- **Purpose:** India-statutory gross-to-net payroll (PF/ESI/PT/TDS), salary structures, employee master, payslips, payroll register, disbursement, statutory filings.
- **Status:** **Implemented** (statutory filing marked **partial**). Real engines: `statutoryRules.ts` (545 LOC, effective-dated rate tables + `calculatePf/Esi/Pt/calculateAnnualTds`, verified 2026-08-06 seed with EPF ceiling 15000, ESI 0.75/3.25%, GJ PT, FY26-27 new-regime TDS with 87A rebate/marginal relief/cess/288B rounding), `payrollProcessing.ts` (260 LOC, balanced-by-construction accrual lines). `payrollRunModule.ts` (385 LOC) posts idempotent `JE-PAYROLL-<period>` and refuses to preview when structured employees exist but no rule set resolves.
- **Dependencies:** Finance GL (Ledger Accounts module ensured before posting), framework.
- **Connected modules:** Finance (accrual + disbursement postings), salary structures engine.
- **Missing functionality (CODE-EVIDENCE, all named in-code):** 24Q **FVU file (Protean RPU) not generated** — only 24Q data. Attendance/LOP/NCP **not tracked** (NCP days hardcoded 0, full-month pay assumed). **No bank transmission API** — disbursement emits a NEFT advice file a human uploads. PT table seeds Gujarat only. ESI disability ceiling unreachable (no disability flag by privacy design). Pre-W6 flat-accrual runs rejected for payslip/disbursement.
- **Production readiness:** High for the implemented scope; filing exports and attendance are explicit future work.

### 3.5 CRM (8 modules) & Sales (7 modules)

- **Purpose:** CRM — contacts, leads, customers, opportunities, activities, campaigns, customer health, customer timeline. Sales — quotes, orders, contracts, pricing rules, commission plans/statements, revenue forecast.
- **Status:** **Implemented.** Deterministic scoring/pricing/commission in pure engines (`pricingRules.ts`, `revenueForecast.ts`, conversion in `conversion.ts`), with optional grounded-AI narrative (`leadAi`, etc.) that **never changes numbers**. `quoteModule.ts` (264 LOC) applies `evaluatePricingRules` at validate; `orderModule.ts` (252 LOC) posts real stock movements and creates warehouse pick lists.
- **Dependencies:** Framework, Finance (invoice conversion re-authorizes Finance write scope), Inventory ledger, Warehouse module.
- **Connected modules:** Finance, Inventory (`inventoryLink.ts` posts real movements), Warehouse (pick lists reuse warehouse module, no duplicate stock).
- **Missing functionality:** AI summaries depend on a configured model (offline → deterministic fallback — not a defect). No further gaps identified in corpus.
- **Production readiness:** High. ~230+ test cases across 21 files (quote 27, customer 25, order 24, lead 21). Zero code stubs.

### 3.6 Supply Chain — Procurement (6), Inventory (7), Warehouse (8), Manufacturing (12), Maintenance (10)

- **Purpose:** End-to-end supply chain on a single event-sourced Inventory Ledger.
- **Status:** **Implemented, uniformly real.** `inventory/stockMovementModule.ts` (immutable append-only ledger; product on-hand/reserved/available/value re-derived from full history) + `inventory/postMovement.ts` (the single `postStockMovement` seam, `inventory:manage` gated). Procurement PO→Goods Receipt posts real `receive` movements idempotently. Warehouse transfers use paired net-zero legs through `IN_TRANSIT_LOCATION`. Manufacturing `executionModule.ts` (451 LOC) runs a 13-action MES lifecycle with BOM backflush, finished-goods output, scrap write-off, and Production-Order rollup; governed `scheduleProposalModule` requires human approval before commit. Maintenance writes downtime back to the authoritative Machine record and spare-part consumption to the ledger.
- **Dependencies:** Shared Inventory Ledger, framework, `@neuropause/shared` (`inventoryValuation.ts` FIFO/weighted-average/moving-average, `explodeBom` cycle detection, costing/variance).
- **Connected modules:** Sales (order fulfillment), Finance (indirect via valuation), Manufacturing↔Maintenance (Machine status/OEE).
- **Missing functionality:** `packingModule` inventory effect **unverified** (appears to be an operational record, not a stock-moving step). Costing/valuation/BOM-explosion/supplier-performance are immutable **snapshot registers** (point-in-time, must be regenerated), not live views. Several master-data/report modules (packing, bin, zone, technician, assetCategory, maintenancePlan) lack dedicated unit tests (covered by domain-level suites).
- **Production readiness:** High. All ~55 modules registered (`index.ts:334-392`); zero code-level stubs. Test suite not executed in recon (static review only).

### 3.7 Projects (4), Helpdesk (1), Documents (1), Executive (3)

- **Projects — Implemented:** `projectModule`, `projectTaskModule`, `timeEntryModule`, `billingRunModule` (~300 LOC). `billingRunModule` generates **real W1 draft invoices** cross-module via `moduleFor(FINANCE_MODULE_ID)` and freezes billed time entries. Reuses `operations:*` RBAC. Tests: `projects.test.ts`, `projectBilling.test.ts`.
- **Helpdesk — Implemented:** `ticketModule.ts` (210 LOC), SLA service desk with resolve/close, closed tickets immutable, honestly flags "Closed UNRESOLVED". Single certified module.
- **Documents — Implemented:** `documentModule.ts` (190 LOC), append-only versioned registry (`appendDocumentVersion`), archive freezes history. Test `documents/w52.test.ts`.
- **Executive — Implemented:** `executiveDecisionModule.ts` (260 LOC, pending→approved/rejected→verified→archived, `executive:approve`), `executionProposalModule.ts` (220 LOC, draft→pending_confirmation→accepted/rejected/cancelled, `executive:execute`), `biReportModule.ts` (185 LOC, saved cross-module aggregations). Strict human-in-the-loop — **nothing auto-executes**. `biReportModule` has no dedicated test.

### 3.8 AI Platform

- **Purpose:** LLM routing, agent runtime, memory/semantic search, executive intelligence.
- **Status:** **Implemented (shipping desktop path); Partial/preview (two parallel package stacks).** The desktop path (`apps/desktop/src/main/{ai,assistant,memory,intelligence}`) is production-grade: `aiEngine.ts` (renders prompt → context → route → parse → price → audit, grounded-false fallback), `modelRouter.ts` (fast/balanced/deep → Haiku 4.5/Sonnet 4.6/Opus 4.8), real `claudeClient.ts` (Anthropic Messages API) and `ollamaClient.ts` (local, $0), `promptManager.ts` (770 LOC, 32 versioned templates with GROUNDING clause), `assistantService.ts` (1900 LOC, 9-phase approval-gated turn pipeline).
- **Dependencies:** `ANTHROPIC_API_KEY`/Secure Vault, `apps/backend` for embeddings (desktop owns **no embedding provider**).
- **Connected modules:** Knowledge graph, timeline, memory, UDM, briefing; executive centers.
- **Missing functionality:** `VectorStore` is in-memory only (Qdrant/Pinecone named as future). Semantic recall **silently degrades to lexical** with no backend. `packages/ai-runtime` ships only a deterministic `FakeProvider` (self-described PREVIEW, **not imported by apps/desktop**). `packages/intelligence` defaults to `DeterministicAiProvider` (7 executive copilots exist but are not consumed by the desktop renderer). No dedicated `promptManager.test.ts`; `claudeClient`/`modelRouter` lack direct unit tests.
- **Production readiness:** Desktop AI: high, with a hard backend dependency for semantics. The two package stacks are **hidden/unwired** relative to the shipping product.

### 3.9 Knowledge Graph & Digital Twin

- **Purpose:** Read-only sense-making layer — enterprise knowledge graph, three knowledge subsystems, two digital-twin subsystems, prediction/insight layer.
- **Status:** **Implemented (as read-only projections).** `graph/` is the only stateful subsystem (`graphStore.ts` adjacency + shortest-path + 5000-event history + JSON persist; `projector.ts` merges UDM/ERP/connectors/plugins/resource graph). `knowledge/`, `knowledgeAssets/` (3,394 LOC), `knowledgeFabric/`, `twin/`, `digitalTwinPlatform/` (2,379 LOC), `insight/` (2,555 LOC) are pure projections. ~40 read-only RBAC-gated IPC channels.
- **Missing functionality (CODE-EVIDENCE):** **No live simulation ever runs.** `twin/` passes P14's `SimulationReport` through unmodified; `digitalTwinPlatform` only inventories capability (`simulationInventory.invoked` is a compile-time `false`). The one real engine, `packages/shared/src/types/manufacturingDigitalTwin.ts` (617 LOC, 15 scenarios, `runSimulation`), has **no runtime caller and no test file** — only named in a `twinRegistry` inventory string. `knowledge:health` is registered in main but not exposed in the renderer facade. No dedicated graph explorer view.
- **Production readiness:** High for read-only projection value; the simulation capability is present-but-unwired.

### 3.10 Connectors & Integration

- **Purpose:** OAuth connector framework + incremental sync engine.
- **Status:** **Implemented (NCF, the shipping path); Partial/preview (five packages).** NCF: `connectors/manifests.ts` (22 provider manifests, real OAuth endpoints), `connectorService.ts` (5,538 LOC), OAuth PKCE + encrypted vault; `unified/sync` orchestrator (12,645 LOC) drives **12 real adapter families** (GitHub, Notion, Google Workspace, Slack, Atlassian, Salesforce, HubSpot, ServiceNow, SAP, Oracle Fusion, Dynamics 365, Workday, Entra) with SOQL/OData paging, incremental cursors, capability discovery. Wired to renderer via ~18 IPC channels + full Connectors UI.
- **Missing functionality:** **No live provider traffic proven** — every adapter is verified only against simulated responses (adapter-verified / INFRA-PENDING); needs operator OAuth apps + network. M365 write executor and `inbound/`/`m365/` subdirs carry no local tests. The five `packages/*` (~8.7K LOC) have **zero real imports in apps/desktop** — parallel, self-referential, PREVIEW/mock-only libraries; `packages/connectors` `vault.ts` is an explicit stub.
- **Production readiness:** NCF framework code is mature; live enablement is operator/infra-gated. Package ecosystem is dead code relative to the shipping app (divergence risk).

### 3.11 Runtime / Orchestration / Automation / Webhooks

- **Status:** **Implemented (desktop subsystems); Hidden/unwired (six packages).** Desktop: `runtime/supervisor.ts` (app-instance lifecycle, restart policy max 3), `orchestration/` and `autonomousOps/` are **read-only projections that structurally cannot execute** ("no autonomous bypass" invariant), `automationPlatform/` (3,312 LOC) adds the only real execution seam — a 60s schedule tick firing due rules through the existing runner, `webhooks/` (real signed HTTP delivery, SSRF egress guard `redirect:'error'`, retry, dead-letters). All wired via `runtimeCore.ts:171,202,204,224`.
- **Missing functionality:** The six `@neuropause/{runtime,execution,automation,autonomous-ops,platform-automation,reliability}` packages (real, tested) are **not imported by apps/desktop** — consumed only by peer packages. `@neuropause/runtime` duplicates the desktop's own `runtimeCore.ts`. Package event store is in-memory only; scheduler is tick-driven with no wired live timer.
- **Production readiness:** Desktop execution surface is intentionally conservative and real. The package runtime layer's shipping status is unconfirmed.

### 3.12 Security, Auth, Identity, Permissions, License, IPC

- **Status:** **Implemented (desktop security surface); Hidden (two packages).** OAuth RFC 8252 PKCE + loopback + CSRF state (`auth/authService.ts`, `auth/loopbackServer.ts`); tokens confined to main process, refresh token encrypted at rest (`security/secureStore.ts`, refuses plaintext fallback); hardened IPC (`ipc/router.ts`, `ipc/secureBridge.ts`, `ipc/runtimeAuthz.ts` fail-closed channel classification); live per-org RBAC (`enterprise/authzGate.ts`, `authz.ts`); SHA-256 tamper-evident audit chain (`security/auditChain.ts`); offline license validator (`license/validator.ts`). Window is `contextIsolation:true, sandbox:true, nodeIntegration:false`.
- **Missing functionality (CODE-EVIDENCE):** `@neuropause/security` (2,299 LOC: TOTP, WebAuthn, AES-256-GCM envelope encryption, RBAC+ABAC) and `@neuropause/trust-platform` (2,469 LOC: Zero Trust, SOC/compliance, DR) are **not imported by apps/desktop**. **No live enterprise IdP** (Okta/Azure AD/Auth0/Ping) — SSO/SAML/OIDC is protocol modeling with **no signature/JWKS verification** (`cloud/identity/federation.ts`, INFRA-PENDING). SCIM only as types. No LDAP/AD. `secureBridge` per-IPC audit log is plain JSONL — **not** run through the hash chain. No client-side signed license verification. No KMS/HSM, no certification (INFRA-PENDING).
- **Production readiness:** The shipping security surface is coherent and tested; enterprise identity federation and hardware crypto are not wired.

### 3.13 Local-First Data, Persistence, Backup, Migration, Installer, Update

- **Status:** **Implemented (desktop JSON stores); Partial/PREVIEW (`@neuropause/persistence`).** Desktop persists to atomic JSON under `userData`: `unified/unifiedStore.ts` (source-authoritative last-updated-wins + content-signature tie-break), `sync/syncStateStore.ts` (durable cursors, DLQ, crash reconciler), `backup/backupManager.ts` (9 domains, sha256 manifest, safety backup before restore), `migration/migrationEngine.ts` (backup + restore-on-failure), `recovery/recoveryService.ts` (8 actions), `services/appUpdater.ts` (electron-updater, 3 channels, explicit user-driven).
- **Missing functionality:** `@neuropause/persistence` (Postgres/PGlite, event store, RLS) is **not imported anywhere under apps/desktop** — the shipping app uses JSON files; networked Postgres/Redis/S3/PITR/failover are infra-pending. Only **one** desktop migration exists (`0001-baseline`, `CURRENT_DATA_VERSION=1`) — recover-on-failure path untested on real failing migration. Rollback is **preparation-only** (`allowDowngrade=false`; `rollbackTarget()` computed but not IPC-exposed). macOS `notarize:false`, Windows code-signing not configured. UnifiedStore/SyncStateStore rewrite whole JSON files on every change (scalability ceiling; promised SQLite/Postgres backing not built).
- **Production readiness:** Local-first desktop persistence is functional but non-scalable; the cloud persistence platform is a separate PREVIEW.

### 3.14 Backend / Cloud / API

- **Status:** **Implemented (`apps/backend`, the only real HTTP surface); Partial/preview (everything else).** `apps/backend` (~15.8K LOC, 38 test files): Express over Postgres 16 + Redis 7, OAuth-PKCE (Google/GitHub/Microsoft/Apple) + email, JWT HS256 + refresh rotation, routers for store/orgs/devices/billing (real Razorpay SDK)/license/LWW sync/semantic memory (Qdrant + Ollama/OpenAI embeddings), Dockerfile + `docker-compose.prod.yml` + k8s. Desktop `livesync/engine.ts` is the real, wired client half.
- **Missing functionality (CODE-EVIDENCE):** Backend routes are **unversioned by path** (no `/v1`). `apps/cloud` is **not a runnable service** (no HTTP listener/DB; self-labeled PREVIEW). `packages/cloud-sdk` ships only `inMemoryTransport`. `packages/federation` is entirely in-memory Maps (real clusters/DR/multi-cloud INFRA-PENDING; 2 tests / 19 src). The desktop "Enterprise REST API" (`api/apiGateway.ts`, 27 routes + OpenAPI 3.1) is exposed **only over IPC — no HTTP listener binds it**. Voyage embedding provider throws "not implemented yet".
- **Production readiness:** `apps/backend` is genuinely deployable; the "cloud platform" and federation are in-memory scaffolds.

### 3.15 Developer Platform (SDK, CLI, plugin runtime, marketplace)

- **Status:** **Implemented (mostly).** `@neuropause/sdk` (722 LOC, retrying transport, typed resources), `@neuropause/cli` (540 LOC, SDK-backed), process-isolated plugin runtime (`plugins/pluginHost.ts` forked Node + permission bridge + Zod manifest + semver matcher), ecosystem backend with Ed25519 submit→scan→sign→review→publish→rollback pipeline, P9 marketplace intelligence model over secure IPC.
- **Missing functionality:** **No scaffolder/code generator** (no `neuropause init`); the "template registry" is descriptor strings only. `pluginManager.install()` copies with **no signature/integrity verification** (trust chain not closed at install); permissions auto-granted (prompt UI "not landed"). `pluginHost.runModel` is a declared seam returning `no_local_model_configured`. `packages/connectors` is PREVIEW/mock-only and **not wired** into the desktop connector runtime (two divergent connector stacks, two signing schemes). No live gateway/store server in-repo.
- **Production readiness:** SDK/CLI/plugin core are real and tested; extension-story edges (scaffolding, install-time signature verification, local model runtime) are incomplete.

### 3.16 Enterprise Surfaces & Renderer UI

- **Status:** **Implemented (read-only composition over real cores).** UDM store (`unified/`, 9,252 LOC) and AI Workforce (`workforce/`, 6,533 LOC) are the substantive foundations; `strategyPlatform`, `operationsPlatform`, `enterpriseFederation`, `federationPlatform`, `commercial`, `industry`, `experience`, `intent` are read-only projections. Renderer defines ~48 sections (`shell/sections.ts`) mapped 1:1 to lazy views (`AppShell.tsx`), with an honesty layer: `hidden`/`preview`/`phase` flags + `capability/capabilityRegistry.ts` marking features production-complete/managed/read-only/needs-backend/hidden.
- **Missing functionality (CODE-EVIDENCE):** `main/interaction` has **zero implementation** — test-only (command-router logic lives in `@neuropause/shared`). `featureFlags` backs only **5** real flags despite ~80 domains. Many enterprise surfaces are self-labeled **preview** (in-memory composition, not externally-effecting). `capabilityRegistry` explicitly flags unbuilt work: in-app password change, passkeys, session list/revoke = needs-backend; NeuroID, login history, consent/retention = hidden ("No such subsystem exists in production"). `enterpriseFederation`, `decision-center`, `developer-center`, `control-plane` are fully coded but `hidden:true` in nav.
- **Production readiness:** Real, honest UI shell; a large fraction of surfaces are read-only previews by design.

### 3.17 Build / CI / Release / Deploy / Docs

- **Status:** **Implemented (real pipeline); Hidden (eight enterprise packages).** electron-builder (mac dmg/zip arm64, win nsis/zip/portable x64), 3 hardened `.cjs` scripts (build-info, notarize, verify-release-artifacts), 5 GitHub workflows, real k8s/Helm/observability manifests under `deploy/` (3,924 LOC YAML, CI-validated with kubeconform-strict + helm lint). 866 test files repo-wide, 44 vitest configs.
- **Missing functionality (CODE-EVIDENCE):** Code-signing/notarization **never exercised** — no Apple cert/macOS runner; every build to date is verified **UNSIGNED**. No CI job builds/tests desktop on macOS or Windows. The eight `packages/{release,production,deploy,customer-deployment,deployment-orchestrator,environment-provisioning,operator-deployment,certification}` (~12.8K LOC) emit **descriptors with `built:false`** and are **imported by no app** — governance/evidence simulation only. Update feed is a single hard-coded droplet (`neuropause033.com/updates`), no CDN.
- **Production readiness:** Backend deploy story is genuine; desktop signed/notarized distribution is unconfirmed; the release-governance packages ship nothing.

---

## 4. ERP Audit

Legend: **Completed** = implemented with real logic and tests in the shipping desktop path; **Partial** = implemented with explicit named boundaries or preview/read-only status; **Missing** = no such module exists in the repo; **Tech-debt** = real but carries stale docs, missing tests, or scalability/verification gaps.

### 4.1 Domains present in the repo

| Domain | Verdict | Evidence & notes |
|---|---|---|
| **Finance / Accounting** | **Completed** | 20 certified modules; posting kernel `journalEntryModule.ts`, idempotent `glPosting.ts`. |
| **General Ledger** | **Completed** | `packages/shared/src/types/generalLedger.ts` (839 LOC): trial balance, statements, closed-period guard, tax report. |
| **GST / Tax** | **Completed** | `taxReportModule.ts` + `glTaxReportForPeriod`; GSTIN capture on invoices/bills. Filing **exports** (FVU) are HR-side and partial. |
| **Accounts Payable (AP)** | **Completed** | `vendorBillModule.ts`, `vendorPaymentModule.ts`; multi-currency confirmed (`apMultiCurrency.test.ts`, `payableRevaluation.test.ts`). |
| **Accounts Receivable (AR)** | **Completed** | `invoiceModule.ts`, `paymentModule.ts`, `arAgingModule.ts`; realized FX on foreign receipts (`financeFxSettlement.test.ts`). |
| **Fixed Assets** | **Partial** | `fixedAssetModule.ts` (258 LOC): capitalize/depreciate/dispose, all auto-posted — but **straight-line only** (no declining-balance/units-of-production). |
| **Budgeting** | **Completed** | `budgetModule.ts` + `budgets.ts`; budget-vs-actuals with 5% tolerance from posted ledger. |
| **Banking / Reconciliation** | **Partial** | `bankStatementModule.ts` + `bankReconciliation.ts`: import + auto-match within a 3-day window, **but no write-back/clearing postings** — produces candidates only. |
| **Multi-currency / FX** | **Completed** | Exchange rates, realized FX on AR/AP, unrealized revaluation (receivables/payables/cash) with auto-reversing JE, exposure snapshots. |
| **Cash Flow / Ratios** | **Completed** | `cashFlow.ts`, `financialRatios.ts` (undefined ratios stored NULL, never fabricated). |
| **Payroll** | **Completed** (with boundaries) | India-statutory gross-to-net, balanced GL accrual, NEFT advice. **No attendance/LOP**, no bank API. |
| **HR** | **Completed** | 8 modules; employee master with UAN/ESIC/PAN, salary structures, cycle-guarded manager chain. |
| **Statutory Filings** | **Partial** | `statutoryFilingModule.ts`: ECR/ESI/PT/24Q **data** correct, but **24Q FVU file not generated**; NCP days hardcoded 0. |
| **CRM** | **Completed** | 8 modules; deterministic lead scoring/health + grounded AI narrative; conversion chains idempotent. |
| **Sales** | **Completed** | 7 modules; pricing-rule engine, commission statements, revenue forecast; order↔inventory/warehouse seams. |
| **Procurement** | **Completed** | 6 modules; PO lifecycle, RFQ→award, `goodsReceiptModule` posts real `receive` movements. |
| **Inventory** | **Completed** | Event-sourced ledger; multi-method valuation (standard/FIFO/weighted-avg/moving-avg). `packingModule` inventory effect **unverified** (tech-debt). |
| **Warehouse** | **Completed** | 8 modules; transfers via IN-TRANSIT net-zero legs, picks/shipments/cycle-counts/adjustments post typed movements. |
| **Manufacturing** | **Completed** | 12 modules; full MES (BOM backflush, output, scrap, PO rollup), governed scheduling, costing/variance. |
| **Maintenance** | **Completed** | 10 modules; work orders drive Machine status + OEE; spare-part consumption to ledger. |
| **Projects** | **Completed** | 4 modules; billing runs generate real invoices cross-module and freeze time entries. |
| **HelpDesk** | **Completed** | Single certified `ticketModule.ts` — SLA tickets, resolve/close, immutable closed. Scope is 1 module. |
| **Documents** | **Completed** | Single certified `documentModule.ts` — append-only versioning. |
| **Analytics** | **Partial** | `insight/` (7 deterministic heuristics, "no ML"), `biReportModule` (saved aggregations), `finance.ts` KPIs. **No ML/statistical models**; renderer `analytics` section is a hidden alias to `WorkforceView`. |
| **Reports** | **Partial** | Real derived registers (tax report, payroll register, aging, valuation, cash flow, ratios) — but these are **immutable point-in-time snapshots**, not live reporting, and journal/statement UI is raw-JSON textareas (tech-debt). |
| **Admin** | **Partial** | `organization/orgClient.ts`, `cloud/admin` projections (tenant table, compliance report) — but admin/compliance projections read in-memory control-plane state, not audited live infra. |
| **Security** | **Completed** (desktop core) / **Partial** (enterprise identity) | Real PKCE OAuth, encrypted vault, hardened IPC, fail-closed RBAC, audit chain, offline license. **No live IdP/SSO signature verification, no SCIM/LDAP, no KMS/HSM** (INFRA-PENDING). |
| **Compliance** | **Partial** | SOC 2 / GDPR / ISO 27001 reporting exists **only as pure projections** over in-memory state (`cloud/admin`); **no certification claimed** anywhere. |
| **Approval** | **Partial (Tech-debt)** | Implemented as **per-module state machines** (Executive family: decision + execution-proposal transition guards in `@neuropause/shared`). **No generic reusable approval engine** — hand-rolled per module. Strictly human-in-the-loop. |
| **Workflow** | **Partial** | **No generic workflow engine** in the shipping app. `moduleRegistry` runAction + `automationPlatform` 60s schedule tick (fires due rules through the existing runner) are the only orchestration; `@neuropause/automation` WorkflowEngine exists but is **not imported by apps/desktop**. |

### 4.2 Domains explicitly NOT present in the repo (Missing)

The following ERP domains have **no module, engine, descriptor, or renderer surface** anywhere in the recon corpus. They are **absent**, not merely partial:

| Domain | Verdict | Basis |
|---|---|---|
| **Field Service** | **Missing** | No field-service dispatch/scheduling/mobile-technician module exists. Maintenance work orders (`maintenance/workOrderModule.ts`) cover **internal asset maintenance** with machine-status transitions — this is not field service (no customer-site dispatch, routing, or service contracts as field-service constructs). Do not conflate the two. |
| **Point of Sale (POS)** | **Missing** | No POS terminal, register, cash-drawer, or retail checkout module. Sales is quote/order/invoice B2B, not POS. |
| **Education / Student Information** | **Missing** | No education, LMS, student, enrollment, or academic module of any kind. |
| **Healthcare / Clinical** | **Missing** | No healthcare, EHR/EMR, patient, or clinical module. The only healthcare-adjacent code is a **PHI screening gate** inside `ai/conversationMemory.ts` (a privacy filter on AI memory), which is not a healthcare ERP domain. |

> **Summary judgment (CODE-EVIDENCE):** The platform is a deep, genuinely-implemented **manufacturing/distribution + finance + HR/payroll + CRM/sales ERP** with real double-entry accounting, event-sourced inventory, and India-statutory payroll. Its weakest ERP-audit areas are **bank reconciliation write-back, fixed-asset depreciation methods, statutory filing exports, generic approval/workflow abstraction, and the raw-JSON line-item UI**. Four commonly-expected verticals — **Field Service, POS, Education, and Healthcare — do not exist in the repository at all** and should not be represented to investors as present, planned-in-code, or scaffolded.

## 5. Enterprise Platform Audit

This section audits each enterprise-platform surface named in the recon corpus. Status labels are **Implemented** (real logic + tests, wired into the shipping desktop app), **Partial** (real code but named boundaries, or wired but degraded), **Hidden/Unwired** (real, tested code that no shipping surface imports), and **Absent/Unverified**. All claims are CODE-EVIDENCE from the corpus unless marked ANALYSIS/OPINION.

### 5.1 Summary status table

| Surface | Status | Primary evidence |
|---|---|---|
| Enterprise Module Framework | **Implemented** | `enterprise/framework/{enterpriseModule,moduleRegistry,enterpriseRecordStore}.ts`; 95 `registry.register(...)` in `enterprise/index.ts` |
| Module Certification gate | **Implemented** (stale prose) | `modules/moduleCertification.test.ts` asserts `toHaveLength(95)` / `total===95` |
| Enterprise REST API + OpenAPI 3.1 | **Partial (IPC-only)** | `main/api/apiGateway.ts` (1,430 LOC, 27 routes); no HTTP listener binds it |
| Client SDK (`@neuropause/sdk`) | **Implemented** | `packages/sdk/src/{client,transport,resources,builders}.ts` (722 LOC) |
| CLI (`neuropause`) | **Implemented** (no scaffolder) | `packages/cli/src/{commands,cli}.ts` (540 LOC) |
| Developer Platform / template registry | **Partial (descriptor-only)** | `ecosystem/developerPlatform/developerPlatformModel.ts:154` — scaffold strings, no file generator |
| Marketplace (intelligence + pipeline) | **Implemented** | `main/marketplace/*`; `ecosystem/marketplace/{pipeline,marketplaceStore}.ts` |
| Plugin SDK / runtime | **Partial** | `main/plugins/pluginHost.ts` (real fork); install lacks signature verify |
| Connector SDK (`@neuropause/connectors`) | **Hidden/Unwired (PREVIEW)** | `packages/connectors/src/index.ts` banner; not imported by `apps/desktop` |
| Connector framework (shipping) | **Partial (adapter-verified)** | `main/connectors/*` + `unified/sync/*`; 22 manifests, 12 adapters |
| Automation Engine | **Implemented** | `main/automationPlatform/index.ts` (3,312 LOC); 60s schedule tick |
| Workflow Engine (generic) | **Absent as abstraction** | per-module state machines only; no reusable multi-step engine |
| Digital Twin | **Partial (projection, no live sim)** | `main/twin/*`, `main/digitalTwinPlatform/*` |
| Knowledge Graph | **Implemented** | `main/graph/{graphStore,projector,index}.ts` |
| Governance | **Implemented** | `moduleRegistry.ts:124-148` fan-out; Executive state machines |
| Observability | **Partial (formatters-only)** | `main/observability/*` (OTel + Prometheus formatters) |
| Identity / RBAC | **Implemented** (live IdP absent) | `enterprise/authzGate.ts`, `enterprise/authz.ts` |
| Enterprise / Universal Search | **Implemented** | `main/search/enterpriseSearch.ts` |
| Enterprise Timeline | **Implemented** | `main/timeline/enterpriseTimeline.ts` |
| AI Workforce | **Implemented** | `main/workforce/*` (6,533 LOC) |
| Mission Control | **Implemented (read-only)** | `renderer/src/missionControl/*` (2,067 LOC) |
| Workspace context | **Implemented** | `main/workspaces/workspaceContextStore.ts` |
| Enterprise Intelligence (insight) | **Implemented (deterministic)** | `main/insight/*` (2,555 LOC) |

### 5.2 Enterprise Module Framework and certification

The framework is the load-bearing spine of the ERP. A module is a descriptor plus an `EnterpriseRecordStore`, and `defineEnterpriseModule()` (`enterprise/framework/enterpriseModule.ts`, 145 LOC) injects RBAC, audit, timeline/platform events, renderer broadcasts, generic CRUD IPC, offline-first JSON persistence, a status lifecycle, plus a `runAction` custom-action seam and an awaited `onChange` cross-module reconciliation seam. `moduleRegistry.ts` (374 LOC) fans every lifecycle transition (`created/updated/status_changed/deleted`) out to audit + platform event + renderer broadcast + `onChange` (evidence: `moduleRegistry.ts:124-148`).

Certification is a real quality gate: `moduleCertification.test.ts` (249 LOC) runs every enumerated descriptor through `validateModuleDescriptor` and locks the inventory to **exactly 95 modules across 13 families** (`expect(ALL).toHaveLength(95)`, `total===95`), matching the 95 `registry.register(...)` calls in `enterprise/index.ts`. Per-family: Finance 20, Sales 7, CRM 8, Procurement 6, Inventory 7, Warehouse 8, Manufacturing 12, Maintenance 10, Projects 4, HR 8, Helpdesk 1, Documents 1, Executive 3.

**Named integrity defects (CODE-EVIDENCE):** the test's own prose is stale — header/`it()` title say "94", a comment references an "84th" module, and the Finance import banner says "(19)" for 20 descriptors. `framework/index.ts` docstring claims "none in this foundation release" while the real registration lives in `enterprise/index.ts`. The gate is a *static enumerated lock*, not a live-registry read, so a newly registered module is served by generic IPC before it is certified — a deliberate re-certification checkpoint but a silent-drift risk.

### 5.3 Enterprise REST API, SDK, CLI, Developer Platform

- **Enterprise REST API — Partial (IPC-only).** `main/api/apiGateway.ts` (1,430 LOC) is a genuine 27-route gateway with API-key auth/scope/rate/quota/version/audit → RBAC + Zod handler, cursor pagination/sort, and **live OpenAPI 3.1 generation** from the route table and Zod schemas. **Critical caveat:** it is exposed *only* over IPC (`IpcChannel.EnterpriseApiRequest`) to the renderer developer portal — **no HTTP server binds it**. The only network-exposed REST surface in the whole platform is `apps/backend` (see §Backend in the broader report), whose routes are *unversioned by path*.
- **SDK — Implemented.** `@neuropause/sdk` (722 LOC) has a retrying `HttpTransport` (backoff on 429/502/503/504), 8 typed resources incl. full marketplace publish/submit/review/publish/rollback/install, OAuth2 client-credentials, webhook sign/verify, and `defineWorker/Connector/Plugin/Extension` builders. Default `baseUrl https://api.neuropause.dev` has **no live gateway in-repo**, so end-to-end network paths are unexercised here.
- **CLI — Implemented, no scaffolder.** `neuropause` (540 LOC) is a thin SDK front-end (auth, Enterprise CRUD/graph/context/timeline/search, observability, ecosystem publish). **Gap:** there is no `init/new/generate` command.
- **Developer Platform — Partial.** `developerPlatformModel.ts:154` template registry entries are *descriptor strings* (`defineWorker({...}).toManifest() -> neuropause publish`), producing no files. There is no code-generating scaffolder anywhere in the platform.

### 5.4 Marketplace, Plugin SDK, Connector SDK

- **Marketplace — Implemented.** `ecosystem/marketplace/pipeline.ts` runs a deterministic static security scan plus **Ed25519 sign/verify over a canonical manifest digest**; `marketplaceStore.ts:279` drives `submit → scanning → signing → in_review → published → rollback` with audit events. `main/marketplace/*` (1,349 LOC, P9) adds trust tiers, semver compatibility, dependency install plans, Trust Center, and RBAC-gated install/policy IPC channels.
- **Plugin SDK — Partial.** `main/plugins/pluginHost.ts` is real OS-process isolation (forked Node host, crash detection, hot-reload) with a permission-gated host-call bridge and a Zod manifest schema + hand-rolled semver matcher. **Named gaps:** `pluginManager.install()` copies from a source dir with **no signature/integrity verification** (the marketplace signs manifests, but the host trust chain is not closed at install); permissions are **auto-granted at install** (prompt UI "not landed"); and `runModel` is a dead-ended seam returning `{ok:false, reason:'no_local_model_configured'}`.
- **Connector SDK — Hidden/Unwired.** `@neuropause/connectors` (1,681 LOC) is a governed executor + HMAC marketplace, but its own `index.ts` banner reads "PREVIEW foundation. Pure, in-memory. Mocks; live integrations NOT included," `vault.ts` is a stub, and it is **not imported by `apps/desktop`**. The shipping connector runtime (`main/connectors/*`) is a wholly separate implementation — so two divergent connector stacks and two signing schemes (Ed25519 in ecosystem vs HMAC in packages) coexist.

### 5.5 Automation Engine vs Workflow Engine

- **Automation Engine — Implemented.** `main/automationPlatform/index.ts` (3,312 LOC, 10 test files) provides an automation catalog, playbook→`WorkflowSpec` compilation, policy resolution, approval preview, rollback planner, execution monitor, and dashboard. Its `TICK_MS=60_000` schedule tick is **the only genuine autonomous execution seam** — it fires due schedule-triggered rules through the existing runner, and is gated so an empty policy list means nothing auto-executes.
- **Workflow Engine — Absent as a reusable abstraction (CODE-EVIDENCE).** There is no generic multi-step approval/workflow engine. Approval is hand-rolled per module, most notably the Executive family: `executiveDecisionModule.ts` (`pending→approved/rejected→verified→archived`) and `executionProposalModule.ts` (`draft→pending_confirmation→accepted/rejected/cancelled`), guarded by pure transition functions in `@neuropause/shared` (`executiveDecisionApproval.ts:47`, `decisionExecutionHandoff.ts:92`). Semantics are strictly human-in-the-loop; nothing auto-executes. A fuller enterprise workflow engine exists in `@neuropause/automation` (2,060 LOC) but is **not imported by the desktop app**.

### 5.6 Governance, Observability, Identity

- **Governance — Implemented.** Every module inherits audit + timeline + broadcast fan-out via `moduleRegistry`. Executive governance state machines require reasons on approve/reject and bridge to execution proposals (`decisionHandoffLink.ts`). The autonomous-ops layer carries a hard "no autonomous bypass" invariant (`main/autonomousOps/index.ts`, `computeAutoExecutable` defaults false).
- **Observability — Partial.** `main/observability/*` (219 LOC) is **formatters only** — OpenTelemetry + Prometheus exposition-format output over existing audit/metrics, with no independent collection/storage pipeline. Real infra observability (Prometheus/Grafana/SLO rules) exists in `deploy/` for the backend, not in the desktop module.
- **Identity / RBAC — Implemented (local).** `enterprise/authzGate.ts` (300 LOC) resolves a session email to an `OrgUser` + roles (first-claim-wins owner bootstrap, fails closed), and `enterprise/authz.ts:40` returns empty permissions for non-active members. Roles: Owner/Admin/Manager/Member/Viewer/AI-Worker with `EnterprisePermission` scopes. `main/ipc/runtimeAuthz.ts` classifies every privileged channel fail-closed. **Boundary:** live enterprise IdPs (Okta/Azure AD/Auth0/Ping/Google), SCIM, and SSO signature/JWKS verification are absent — `cloud/identity/federation.ts` is deterministic protocol *modeling* only (no signature verification), explicitly marked INFRA-PENDING.

### 5.7 Enterprise Search, Timeline, Workforce, Mission Control, Workspace, Intelligence

- **Enterprise/Universal Search — Implemented.** `main/search/enterpriseSearch.ts` fans one query across `entity/graph/memory/timeline` with per-source score normalization. Federation is a **deliberately opt-in source excluded from `DEFAULT_SOURCES`** (`enterpriseSearch.ts:52`) for cross-org data isolation.
- **Enterprise Timeline — Implemented.** `main/timeline/enterpriseTimeline.ts` (483 LOC) merges durable platform events with UDM work-activity into one filter/paginate/replay/export stream and "persists nothing of its own."
- **AI Workforce — Implemented.** `main/workforce/*` (6,533 LOC): registry (209), orchestrator (276), planning (856), runtime (821), install (765), governance (484), intelligence (469). Jobs run against fresh UDM/Timeline/Memory/graph snapshots. Honesty seam: `sdk/index.ts:108` flags declared-but-unimplemented skills at load. Surfaced by `WorkforceView` + panels.
- **Mission Control — Implemented (read-only).** `renderer/src/missionControl/*` (2,067 LOC) composes the SECTIONS registry, `CAPABILITY_REGISTRY`, and provider snapshots into a command palette + universal search + executive overview; "actions" are only navigations.
- **Workspace — Implemented.** `main/workspaces/workspaceContextStore.ts` (356 LOC) is a small, tested per-workspace context store.
- **Enterprise Intelligence — Implemented (deterministic).** `main/insight/*` (2,555 LOC, P6-Stage6): `predictions.ts` = 7 deterministic evidence-carrying heuristics ("No ML, no model, no randomness"), an 8-domain health framework, dependency graph, and 10 enterprise-question resolvers over 5 RBAC-gated `insight:*` channels.

**ANALYSIS/OPINION.** The framework-plus-descriptor architecture is the platform's strongest engineering asset: 95 certified modules on one code path with inherited RBAC/audit/persistence is unusually disciplined and materially reduces per-feature cost and audit risk. The most consequential *investor-visible* gaps are architectural honesty flags rather than bugs: the "Enterprise REST API" is not network-exposed, there is no generic workflow engine, and a large slice of governance/connector/workflow capability lives in `packages/*` that the shipping app never imports. These are integration gaps, not fabrication.

---

## 6. AI Platform Audit

The AI platform is real and well-layered, but the corpus establishes a **hard split into two disconnected worlds**: (A) the *shipping* desktop AI path under `apps/desktop/src/main/{ai,assistant,memory,intelligence}`, which is production-grade and wired; and (B) two *parallel governance-first stacks* in `packages/ai-runtime` and `packages/intelligence` that are real, tested, but ship only deterministic fake providers and are **not imported by `apps/desktop` at all**.

### 6.1 Component status

| Capability | Status | Evidence |
|---|---|---|
| LLM routing (tiers) | **Implemented** | `ai/modelRouter.ts` fast=Haiku 4.5 / balanced=Sonnet 4.6 / deep=Opus 4.8 |
| Cloud inference (Anthropic) | **Implemented** | `ai/claudeClient.ts` → `api.anthropic.com/v1/messages`, key from env/Vault |
| Local inference (Ollama) | **Implemented** | `ai/ollamaClient.ts` → `localhost:11434/api/chat`, $0 cost |
| Model abstraction / provider mgmt | **Implemented** | `ai/providerManager.ts` precedence config>env>default |
| Prompt pipeline | **Implemented** | `ai/promptManager.ts` (770 LOC, 32 templates, GROUNDING clause) |
| Reasoning / engine pipeline | **Implemented** | `ai/aiEngine.ts` render→context→route→parse→price→audit |
| Context builder (retrieval) | **Implemented** | `ai/contextBuilder.ts` (300 LOC) federated relevance×recency |
| Memory (semantic recall) | **Partial** | `memory/memorySemanticRecall.ts`; embeddings backend-owned |
| Embeddings provider (desktop) | **Absent by design** | delegated to `apps/backend`; degrades to lexical |
| Vector search | **Partial** | `memory/vectorStore.ts` in-memory cosine only |
| Agent runtime / sub-agents | **Implemented (as resolvers)** | `assistant/assistantModel.ts` ~12 domain resolvers |
| Tool orchestration | **Hidden/Unwired** | `packages/ai-runtime` ToolRuntime; not in desktop |
| AI Store / model selection UI | **Unverified/Absent** | no confirmed renderer surface beyond `aiConfigIpc` |

### 6.2 Model abstraction, routing, local vs cloud

`ModelClient`/`ModelRouter` map tiers to concrete models: `DEFAULT_MODELS` = `fast=claude-haiku-4-5`, `balanced=claude-sonnet-4-6`, `deep=claude-opus-4-8` (`ai/modelRouter.ts`). Two real clients back this: `claudeClient.ts` (real Anthropic Messages API, `x-api-key` + `anthropic-version`, timeout/abort, gated on `ANTHROPIC_API_KEY`/Vault) and `ollamaClient.ts` (real local `/api/chat`, token counts from `prompt_eval_count`/`eval_count`, zero cost). `providerManager.ts` enforces precedence `stored-config > env > default` with the Anthropic key resolved `Secure Vault > env`; `engineManager.ts` hot-swaps the router on reconfiguration. **Boundary (CODE-EVIDENCE):** `modelRouter.ts`, `claudeClient.ts`, and `mockClient.ts` have no direct unit tests — the real HTTP path is verified by gate, not sandbox. Local-vs-cloud selection is wired via env/config, but there is **no confirmed renderer UI** to toggle it beyond `aiConfigIpc` — this is the closest thing to an "AI Store," and a user-facing model marketplace is **not evidenced**.

### 6.3 Prompt pipeline, reasoning, context

`aiEngine.ts` (230 LOC) is the single entry point: render versioned prompt → fold curated context → route → parse → price → audit, degrading to a **deterministic grounded fallback** (`grounded:false`) when no key is present. `promptManager.ts` (770 LOC) is a versioned registry of 32 templates sharing an anti-hallucination GROUNDING clause. `contextBuilder.ts` (300 LOC) is a federated retrieval engine over graph/timeline/memory/UDM/brief with relevance×recency ranking, per-worker source sets, budget caps, and a governance filter. Executive intelligence (Founder AI v2 `ai/founderAI.ts` 500 LOC, Engineering AI) is **deterministic-first**: findings are computed from real data and the LLM only narrates, refusing to invent, with `aiOffline` fallback. **Gap:** `promptManager` — the largest single AI module — has no dedicated test and is only exercised transitively.

### 6.4 Memory, embeddings, vector search

`memory/memorySemanticRecall.ts` (200 LOC) does hybrid lexical+semantic recall with honestly labelled degradation. `memory/vectorStore.ts` (250 LOC) is a **real cosine in-memory store** with org isolation and deleted-filtering — but **the desktop owns no embedding provider**. Real inference is delegated to `apps/backend` (Ollama/OpenAI embedding providers) via `backendsemantic/backendSemanticClient.ts`, wrapped in a circuit-breaker + 4s-deadline decorator (`resilientSemanticSearch.ts`). **With no backend reachable, semantic search silently degrades to lexical** — by design, but a hard dependency. Qdrant/Pinecone/Weaviate are named as future work and not implemented in desktop.

### 6.5 Agent runtime, sub-agents, tool orchestration

The shipping "agent runtime" is the Workspace Assistant: `assistant/assistantService.ts` (1,900 LOC / 74KB — the largest AI file) implements a documented 9-phase turn pipeline (Conversation→Context→Retrieval→Reasoning→Planning→Approval→Execution→Verification→Response) with one correlation id and **human-approval-gated side effects**. `assistant/assistantModel.ts` (900 LOC) holds ~12 domain resolvers (brief/worksummary/meeting/analytics/automation/federation/insight/knowledge/operations/strategy/twin) that function as the de-facto sub-agents/skills.

The *full* governance-first agent/tool/workflow/connector runtime lives in `packages/ai-runtime` (1,490 LOC): `InferencePipeline`, `AgentRuntime` (7 agent kinds), zod-validated permissioned `ToolRuntime`, `WorkflowEngine` (retry/rollback/approval), rate-limited `ConnectorRuntime`, all on one `GovernanceRecorder`. It is **real and tested but ships only `FakeProvider`** (self-described PREVIEW) and has **zero imports under `apps/desktop`**. Likewise `packages/intelligence` (1,959 LOC) offers 7 executive copilots (CEO/CTO/CPO/CRO/CMO/CFO/COO) and a deterministic reasoning engine defaulting to `DeterministicAiProvider`, also unwired to the desktop.

**ANALYSIS/OPINION.** The shipping AI path is genuinely differentiated: deterministic-first intelligence with an LLM narration layer, provider-agnostic routing with a real local (Ollama) option, hash-only cost/audit accounting, and grounded fallback that keeps the app functional offline. The two largest risks are (1) semantic recall's hard backend dependency (no desktop embedder), and (2) the two unwired `packages/*` AI stacks representing significant built-but-undelivered capability — an integration debt and divergence risk, not a correctness problem.

---

## 7. Knowledge Graph

### 7.1 Architecture

**Status: Implemented.** The Enterprise Knowledge Graph is the only stateful subsystem in an otherwise read-only "sense-making" cluster. `graph/graphStore.ts` owns state (in-memory + `graph.json` persistence) with in/out adjacency maps, and supports `neighbors`, bounded `subgraph`, `shortest-path`, `counts`, and a **capped relationship-history change log** (`HISTORY_CAP=5000`, edge appear/disappear timestamps). `graph/index.ts` wires **8 `graph:*` IPC channels** (counts/node/nodes/neighbors/subgraph/path/history/rebuild/onChange) with debounced rebuild on store/ERP/plugin/infra events.

### 7.2 Ontology and entities

`graph/projector.ts` merges multiple authoritative sources into typed nodes/edges with provenance: UDM entities + connectors + installed apps + the ERP relationship model + plugin extensions + a P6 cloud resource graph (`projectGraph`). This is genuine entity-relationship modeling with provenance tagging rather than a flat index. **Boundary:** the corpus does not enumerate a formal, published ontology schema — entity/edge *types* are derived from the contributing sources at projection time; a fixed canonical ontology document is **unverified**.

### 7.3 Search and semantic layers

Three layered subsystems ride on the graph and the memory store:

- `knowledge/` (500 LOC) — derived knowledge over the memory store: IDF-weighted shared-entity relatedness with optional graph-hop expansion (`knowledgeLinks.ts`) and union-find connected-component topic clustering (`topicClusters.ts`). **Gap:** the `knowledge:health` channel is registered in main but **not exposed in the renderer ipc facade** (only `topics` + `related` are) — a registered-but-unreachable capability.
- `knowledgeAssets/` (3,394 LOC, P6-Stage7) — asset inventory, relationship/impact matrix, decision lineage, quality, standards (authority precedence), coverage map, and 10 assistant resolvers over 7 `kb:*` channels; surfaced by `KnowledgeAssetsView`.
- `knowledgeFabric/` (942 LOC, P16) — a read-only fabric projection composing graph + P7 intelligence + P14 strategy + P15 twin + timeline + memory into an Evidence/Sources/Reasoning/Confidence explanation model over 8 `fabric:*` channels; surfaced by `KnowledgeCenterView`.

Semantic *memory* (embeddings/vector recall) is covered in §6.4 — real cosine `vectorStore.ts` but backend-owned embeddings; the graph itself does not embed.

### 7.4 Maturity

**CODE-EVIDENCE.** The graph subsystem is mature and fully wired: real persistence, real graph algorithms (shortest path, bounded subgraph), a change-history log, provenance, and paired unit tests (`graphStore.test.ts`, `projector.test.ts`). The cluster is ~11.4K LOC across 44 source + 43 test files with essentially no stubs.

**Named gaps.** (1) There is **no dedicated first-class graph explorer renderer view/folder**; the graph is consumed piecemeal by `aiOperations`/`knowledge2`. (2) The `knowledge:health` derivation is computed and IPC-registered but unreachable from the UI. (3) The entire cluster is **read-only/projection by design** — no write/mutation/execution surface.

**ANALYSIS/OPINION.** Architecturally this is a strong, honest knowledge layer — provenance-tagged multi-source projection with real graph queries is production-caliber. The most visible maturity gap for a demo/diligence reviewer is the absence of a dedicated graph-explorer UI, which understates the engine's actual capability.

---

## 8. Enterprise Digital Twin

### 8.1 Architecture

**Status: Partial (rich projection layer, no live simulation).** The twin story spans two subsystems plus one unwired engine:

- `twin/` (877 LOC, P15) — `twinModel.ts` (`buildTwinDomains`) defines **9 authoritative domain twins** and projects a composed enterprise snapshot into domain-level topology, a health map, blast-radius impact, a scenario center, timeline replay, and an executive command center over 8 `twin:*` channels; surfaced by `TwinCenterView`.
- `digitalTwinPlatform/` (2,379 LOC, P17-Stage13) — composition over P15 plus the runtime estate: `runtimeTwin` (Execute Engine + Runtime Supervisor projection, verbatim), `platformTwins`, a `stateCoverage` map, `simulationInventory`, `twinHistory`, `twinDashboard`, `twinRegistry`, and 10 assistant-question resolvers over 7 `etwin:*` channels; surfaced by `EtwinPlatformTab.tsx`.

Both subsystems **own no engine, no store, and no executor** by explicit design and mutate/execute nothing.

### 8.2 Org / business / data model

The org/business model is the **9 domain twins** from `twin/twinModel.ts` composed from live UDM, ERP relationships, timeline, and platform signals — a projection of the real operating estate rather than a separately maintained model. `digitalTwinPlatform` adds runtime/platform twins and a state-coverage map. All are point-in-time computed projections, not a persisted twin database.

### 8.3 Simulation engine

**This is the decisive maturity finding (CODE-EVIDENCE):** no live simulation is ever executed at runtime.

- `twin/` passes P14 Strategy's `SimulationReport` through **unmodified and explicitly never applies/executes it** (`twinModel.ts:~407`).
- `digitalTwinPlatform/simulationInventory.ts` is a **register of capability, not a simulator** — `invoked` is a compile-time constant `false`, with `SIMULATION_DISCLOSURE` stating "This is an inventory, not a simulator."
- The **only real simulation engine** is `packages/shared/src/types/manufacturingDigitalTwin.ts` (617 LOC): 15 `TWIN_SCENARIO_TYPES` (e.g. `machine_failure`, `supplier_delay`, `extra_shift`), `computeTwinBaseline`, `resolveScenario`, `applyScenario`, and `runSimulation` (returns a `SimulationResult` incl. newly-late-SKU delta). **It is unwired:** the sole main-process importer is `digitalTwinPlatform/twinRegistry.ts:257`, which merely *names* it in an inventory string ("No main-process code imports it — declared and typed but never invoked at runtime"). It has **no IPC channel, no runtime caller, and — uniquely in this cluster — no test file.**

### 8.4 Maturity

**CODE-EVIDENCE.** The twin *projection and visualization* layers are mature and fully wired (topology, health, blast-radius, timeline replay, command center, ~40 read-only RBAC-gated channels with 3s TTL caching and honest "unavailable" degradation). The *simulation* capability is **built but dark**: a complete deterministic 15-scenario what-if engine exists in `packages/shared` but never runs and is untested.

**ANALYSIS/OPINION.** The digital twin is best characterized as an enterprise-state *observability and blast-radius* twin, not a predictive simulator. The gap between "we have a manufacturing what-if engine with 15 scenarios" and "nothing ever calls it and it has no tests" is the single most important thing a diligence reader must not conflate. Wiring `runSimulation` behind an `etwin:*`/`twin:*` channel with a test suite would be a comparatively small, high-leverage step that converts a genuinely-authored engine into a demonstrable, differentiating capability — but as of branch `phase6-stage13` (HEAD `804e30c`) the platform simulates nothing at runtime.

## 9. Enterprise API (REST, Internal API, SDK, Auth, Security, Versioning, Future Public API)

### 9.1 What Actually Exists

NeuroPause exposes API surfaces at three distinct layers, and it is critical for a diligence reader to understand that only one of them binds a real network listener.

| Surface | Location | Transport | Status |
|---|---|---|---|
| Backend REST API | `apps/backend/src/app.ts` | Real HTTP (`app.listen`, port 4000) | **Implemented** |
| Desktop "Enterprise REST API" gateway | `apps/desktop/src/main/api/apiGateway.ts` | **IPC only** (no HTTP listener) | **Implemented (not network-exposed)** |
| Official SDK (`@neuropause/sdk`) | `packages/sdk/src` | Transport-agnostic (HTTP + IPC + test) | **Implemented** |

### 9.2 Backend REST API — the only real network surface

`apps/backend` (`@neuropause/backend` v0.1.0, ~15.8K LOC TS, 38 test files) is the authoritative HTTP API. It is an Express application over Postgres 16 + Redis 7 that boots a real listener (`apps/backend/src/index.ts` — `app.listen(env.PORT)`). Mounted routers (`apps/backend/src/app.ts`):

- `/auth` — OAuth PKCE + email credential auth
- `/store`, `/organizations`, `/devices`
- `/billing` — real Razorpay SDK (`apps/backend/src/billing/razorpayGateway.ts`)
- `/license`
- `/sync` — org-scoped last-write-wins (`apps/backend/src/sync/service.ts`)
- `/memory/semantic` — search / backfill / health (Qdrant + Ollama/OpenAI embeddings)

All routes require auth except `/auth`, `/health`, `/metrics`. Operational endpoints `/live`, `/health` (dependency checks), and `/metrics` (Prometheus text format) are present. Hardening at the edge: `helmet`, loopback-only CORS, request-id, structured `pino` logging, Redis-backed rate limiting with in-process fallback, and raw-body webhook signature verification mounted **before** the JSON parser (`app.ts`).

**Auth mechanics (implemented):** OAuth 2.0 PKCE (S256) system-browser flow for Google/GitHub/Microsoft/Apple plus email/password, with one-time desktop code exchange (`apps/backend/src/auth/router.ts`). Sessions are JWT HS256 (`issuer: neuropause`, `audience: neuropause-desktop`; `apps/backend/src/auth/jwt.ts`) with Redis-backed refresh rotation/revocation. Loopback-only redirect enforcement is present. Per the cloud consolidation note, the backend is the **sole identity authority**.

### 9.3 Desktop "Enterprise REST API" — real gateway, IPC-only exposure

`apps/desktop/src/main/api` implements a genuine 27-route enterprise API gateway (`apiGateway.ts`, 1,430 LOC, 5 test files) with a real pipeline: route match → Ecosystem gateway (API-key auth, scope, rate, quota, version, audit) → RBAC + Zod secure handler, plus cursor pagination/sort and **live OpenAPI 3.1 generation** from the route table and Zod schemas.

> **CODE-EVIDENCE / limitation:** This "REST API" is reachable **only over IPC** (`IpcChannel.EnterpriseApiRequest`/`Routes`/`OpenApi`; `apps/desktop/src/main/api/index.ts`) to the renderer developer portal. **No HTTP server binds or serves it externally.** The `x-api-version` header is supplied by the gateway decision, but the surface is not network-exposed. Diligence readers should not treat this as a public REST API.

Notably, `runSecureHandler` in `apps/desktop/src/main/ipc/secureBridge.ts` is deliberately built to also back this gateway (each handler's permission is re-applied per `EnterpriseApiRequest`), i.e. a server-style front door pattern exists in code ahead of any HTTP binding.

### 9.4 SDK

`@neuropause/sdk` (`packages/sdk/src`, 722 LOC, `sdk.test.ts` + `enterprise.test.ts`) is a transport-agnostic client (`client.ts`) wiring 8 resources: marketplace, workers, connectors, usage, billing, oauth, plus a generated Enterprise resource. `transport.ts` retries `429/502/503/504` and network errors with exponential backoff and shapes `GatewayError`, capturing rate/quota headers. `resources.ts` covers the full marketplace lifecycle (publish/submit/review/publish/rollback/install); `builders.ts` provides `defineWorker/Connector/Plugin/Extension → ListingManifest`; webhook `sign/verify/parse` helpers are exported.

> **CODE-EVIDENCE / limitation:** Default `baseUrl` is `https://api.neuropause.dev`, and `apps/desktop/src/main/catalog/catalogClient.ts` targets a Store API at `:4000`. **No gateway/store server implementation exists in this repo**, so SDK/CLI end-to-end network paths are unexercised here.

### 9.5 Versioning

> **CODE-EVIDENCE:** Backend REST routes are **unversioned by path** (`/auth`, `/sync`, `/billing`, `/memory/semantic`, …) — there is no `/v1` prefix (`apps/backend/src/config/env.ts` has no path-version config). Only `packages/cloud-sdk` uses `/v1/*` paths and the desktop gateway carries an `x-api-version` header. **Effective backend API versioning is absent** — a material gap for a platform positioning itself as an enterprise API provider.

### 9.6 Future Public API (ANALYSIS/OPINION)

The building blocks for a public API — an OpenAPI 3.1 generator, a permission/scope/quota/rate gateway, RBAC re-application per request, and a retrying typed SDK — are genuinely implemented, but they terminate at IPC rather than HTTP, and the backend that *does* serve HTTP is unversioned. Standing up a real public API is therefore a **wiring-and-versioning exercise, not greenfield engineering**: bind the gateway to an HTTP listener, introduce path versioning on `apps/backend`, and ship the SDK's production HTTP transport. This is a credible near-term path, but as of `HEAD 804e30c` **no externally-reachable, versioned public API exists**.

---

## 10. Developer Platform (CLI, SDK, Plugin APIs, Dev Tools, Scaffolding, Templates, Publishing Pipeline, Extension Architecture)

### 10.1 Overview

This is a **genuinely built developer platform, not scaffolding**: a transport-agnostic SDK, a thin SDK-backed CLI, a process-isolated plugin runtime, an ecosystem backend with an Ed25519 signing pipeline, a P9 marketplace-intelligence model wired to the renderer, and real renderer surfaces (Developer Center, Platform Ecosystem, Marketplace, Extensions/Connectors). Tests are present across every subsystem (SDK 2, CLI 3, connectors 6, plugins 3, marketplace 2, ecosystem 13).

### 10.2 CLI (`neuropause`)

`packages/cli/src` (540 LOC; `commands.test.ts`, `args.test.ts`, `credentials.test.ts`) is a thin, fully SDK-backed front end. `commands.ts` (pure/testable) covers login (API-key + OAuth client-credentials), the full Enterprise API surface (modules/records/graph/context/timeline/search/automation/health/metrics), observability (diagnostics/logs/traces as OTel), and ecosystem browse + publish (`publish()` = `publishVersion` + `submit`). `cli.ts` wires stdio + a file credential store.

> **CODE-EVIDENCE / gap:** There is **no scaffolding command** — no `init`, `new`, or `generate` in `HELP` (`packages/cli/src/commands.ts`). A developer cannot bootstrap a project from the CLI.

### 10.3 SDK

Covered in §9.4. For the developer platform specifically, the builder functions (`defineWorker/Connector/Plugin/Extension`) produce validated `ListingManifest`s consumed by the publish pipeline, and webhook + pagination helpers are exported (though not exercised by the CLI).

### 10.4 Plugin Runtime and Extension Architecture (partial)

`apps/desktop/src/main/plugins` (1,111 LOC) is a **real process-isolated runtime**:

- `pluginHost.ts` — forked Node host with real `fork`/IPC/crash detection; `apps/desktop/resources/plugin-host.cjs` ships an `activate`/`deactivate` contract and a host-call bridge.
- Permission-gated host calls: `notify`, `storage`, `runModel`, `extension.*`.
- Zod manifest schema (11-permission enum, contribution surfaces) + a **dependency-free semver matcher** (exact/caret/tilde/wildcard/comparator).
- `extensionRegistry.ts` (228 LOC) — pure registry with per-kind permission gating, spec sanitization, and DoS bounds (`MAX` caps guard the main-process heap).

**Material gaps in the trust chain (CODE-EVIDENCE):**

- **No install-time signature/integrity verification.** `pluginManager.install()` does `fs.cp` from a source directory with **no signature or hash check**, even though the marketplace pipeline signs manifests with Ed25519. The trust chain is *not closed at install time*.
- **Permissions auto-granted at install:** `grantedPermissions = manifest.permissions`; the permission-prompt UI is explicitly "not landed" (code comment).
- **`runModel` is a declared seam:** returns `{ok:false, reason:'no_local_model_configured'}` (`pluginHost.ts:236`) despite the `local_models` permission and `ai_agent` plugin kind — plumbing is wired end-to-end but dead-ends.

### 10.5 Publishing Pipeline (implemented)

`apps/desktop/src/main/ecosystem` (4,053 LOC, 13 test files) is the ecosystem backend: developer/partner stores, gateway, billing, JWT/OAuth, and a marketplace store driving a **real** lifecycle. `pipeline.ts` performs a deterministic static `securityScan` (dangerous-permission, undeclared-network, suspicious-dependency, excessive-permission rules) and Ed25519 `signManifest`/`verifyManifest` over a canonical manifest digest. `marketplaceStore.ts:279` drives `submit → scanning → signing → in_review → published → rollback` with audit events. The P9 marketplace intelligence model (`apps/desktop/src/main/marketplace`, 1,349 LOC) adds trust tiers, release channels, dependency install plans, discovery/ranking, a Trust Center, and org governance verdicts over secure RBAC-gated channels (`MarketplaceCatalog/Entry/Trust/Plan/Analytics/Policy/Install`).

### 10.6 Templates / Scaffolding (gap)

> **CODE-EVIDENCE:** The developer "template registry" (`apps/desktop/src/main/ecosystem/developerPlatform/developerPlatformModel.ts:154`) is **descriptor metadata only** — scaffold entries are strings like `defineWorker({...}).toManifest() → neuropause publish`. **No file-generating scaffolder exists** anywhere (no `neuropause init`). This is the single most visible hole in the extension developer experience.

### 10.7 The Second, Unwired Connector SDK

`packages/connectors` (1,681 LOC, 6 test files) is a full governed connector SDK (`defineConnector`: Zod-validated actions, triggers, auth, policies, rate-limit, health) with an executor chain (permission → policy → rate → validate → execute → audit), HMAC marketplace signing, and a vault.

> **CODE-EVIDENCE:** `packages/connectors/src/index.ts` self-labels **"PREVIEW foundation. Pure, in-memory. Mocks; live integrations NOT included."** `vault.ts:6` is a stub (production = OS keychain/KMS). It is **not imported by the desktop connector runtime** (`apps/desktop/src/main/connectors` is a separate implementation). Two divergent connector stacks and two signing schemes coexist (Ed25519 in the ecosystem pipeline vs. HMAC in `packages/connectors`), a divergence/dead-code risk.

### 10.8 Developer Platform Assessment (ANALYSIS/OPINION)

The publish/sign/review/rollback pipeline, process isolation, and the SDK/CLI ergonomics are strong and real. The three things that separate this from a shippable third-party ecosystem are concrete and bounded: (1) close the plugin install trust chain (verify the Ed25519 signature the pipeline already produces), (2) land the permission-prompt UI, and (3) build an actual scaffolder. None is research-grade; all are engineering.

---

## 11. Security Audit (authN, authZ, Encryption, Keychain, Secrets, RBAC, Audit, Compliance, IPC, Attack Surface, Hardening)

### 11.1 Posture Summary

The desktop app's own security surface (`apps/desktop/src/main/{security,auth,permissions,license,ipc}`) is **real, tested, and coherent**. Two large standalone security packages (`@neuropause/security`, `@neuropause/trust-platform`; ~4,768 LOC of genuine crypto) exist and are tested but are **not imported by `apps/desktop`** — the app's live security is the lighter `enterprise/*` + `main/{security,auth,ipc,license}` stack.

### 11.2 Authentication (implemented)

Backend-delegated OAuth per RFC 8252 native-app: PKCE S256 + ephemeral loopback redirect + CSRF state check (`apps/desktop/src/main/auth/authService.ts:150` compares the OAuth `state` echo to the generated `desktopState`). The loopback catcher (`loopbackServer.ts`) binds `127.0.0.1` only, random port, unguessable `/callback/<16-byte-hex>` path, single callback, timeout. The OAuth client secret is confined to the backend; this repo holds only the client + PKCE/loopback. Transient network failure at boot does **not** clear the session — only genuine auth rejection does.

### 11.3 Token Handling & Secrets at Rest (implemented)

- Access token: **in-memory only** in the main process; the renderer sees only `AuthStatus` (user + expiry, no tokens).
- Refresh token: **encrypted at rest** via Electron `safeStorage` / OS keychain (`apps/desktop/src/main/security/secureStore.ts`); rotated on every use; **refuses to persist when OS encryption is unavailable — no plaintext fallback** (`secureStore.ts:70`).
- Writes are atomic `tmp+rename` at `0o600`; only ciphertext is persisted; secrets are never logged.

### 11.4 IPC Hardening (implemented — a strength)

- `apps/desktop/src/main/window.ts:33` — `contextIsolation:true`, `nodeIntegration:false`, `sandbox:true`, `webSecurity:true`.
- Strict CSP (`security/csp.ts`): packaged build uses `default-src 'self'`, `object-src none`, `frame-ancestors none`, `form-action none` (dev relaxes only for Vite HMR; `style-src` allows `unsafe-inline` for Tailwind; the renderer does no network I/O).
- `ipc/router.ts:130` — sender-origin trust: `file://` (packaged) or the configured Vite origin only, else "Untrusted sender."
- `ipc/secureBridge.ts:150` — `runSecureHandler` pipeline: `requireAuth → permission(authorize) → Zod safeParse → withTimeout → audit → error shaping`.
- `ipc/runtimeAuthz.ts:210` — **fail-closed** classification of every privileged runtime/core channel to an `EnterprisePermission`; `withRuntimeAuthz` throws at composition for any unclassified channel and `assertAllChannelsClassified` fails closed. This explicitly closes the "privileged channel on sender-trust only" gap (documented remediations A6/A7).

### 11.5 Authorization / RBAC (implemented)

`apps/desktop/src/main/enterprise/authzGate.ts` + `authz.ts` are the RBAC the desktop actually enforces: a per-org role model (Owner/Admin/Manager/Member/Viewer/AI-Worker) with `EnterprisePermission` scopes. `resolveActor` maps session email → `OrgUser` + roles and **fails closed** once an owner is claimed (`authzGate.ts:66`; first-claim-wins owner bootstrap). Only active members hold permissions — invited/suspended hold none (`authz.ts:40`). Root of trust is protected: the owner cannot be de-roled/suspended/deleted, and built-in role permissions are immutable. This is deny-by-default. RBAC is enforced against a **local seeded org store, not a live IdP.**

### 11.6 Audit Logging (mixed)

- **Tamper-evident primitive (implemented):** `security/auditChain.ts` — canonical SHA-256 hash-linked chain (append/dropOldest/verify/snapshot/restore/rebuild). Threat model is documented honestly: it detects casual tampering/corruption, but a local attacker with write access to both entries and the head can forge; WORM/SIEM is named as the external mitigation (`auditChain.ts:30`).
- **Per-IPC audit (gap):** `secureBridge.ts:110` writes plain fire-and-forget JSONL to `userData/logs/audit.log` — **not run through the hash chain**. So the app's per-IPC audit trail is **not tamper-evident**; only the enterprise governance logs use the chain.

### 11.7 Standalone Crypto Platforms (implemented but unwired)

> **CODE-EVIDENCE:** `packages/security` (2,299 LOC) ships real `node:crypto`: RFC 6238 TOTP via HMAC-SHA1, PKCE, Ed25519/WebAuthn, AES-256-GCM envelope encryption with KEK-wrapped DEKs + versioning/rotation/revocation (`keys.ts:120`), RBAC+ABAC with delegation/JIT/impersonation, sessions (idle+absolute timeout), tenant isolation, Ed25519-signed audit — all with constant-time compares and extensive tests. `packages/trust-platform` (2,469 LOC) adds Zero Trust runtime, secrets registry, policy engine, DR, SOC/compliance readiness. **Neither is imported by `apps/desktop`** (grep confirms only other packages + vitest aliases reference them). Audited impersonation, time-bounded delegation, JIT elevation, and 10-domain tenant isolation therefore exist in code with **no renderer wiring**.

### 11.8 Identity Federation & Compliance (partial / honestly bounded)

- SSO/SAML/OIDC (`apps/desktop/src/main/cloud/identity/federation.ts:7`) is **protocol modeling only** — issuer/audience/domain/claim checks with **no signature or JWKS verification**; structured so a real validator drops in behind the interface.
- **No live enterprise IdP integration** (Okta/Azure AD/Auth0/Ping/Google) — config/modeling only, marked INFRA-PENDING.
- **SCIM** exists as shared types/channels and in `integration-platform`/`enterprise-connectivity` packages; **no wired live provisioning endpoint.**
- **No LDAP/Active Directory** integration found.
- **License:** offline-capable validator (`license/validator.ts`) with last-known-good cache + clock-based re-evaluation (expiry/grace decay from stored dates so being offline cannot hide an expired license); failed refresh degrades to cache with `lastError`, never throws. **No cryptographic (signed) license token is verified client-side** — trust rests on the authenticated backend fetch + the encrypted cache file.
- Real KMS/HSM, full WebAuthn hardware attestation (CBOR/COSE), external SIEM, and any ISO 27001/SOC 2/HIPAA/GDPR **certification are explicitly not implemented / never claimed.**

### 11.9 Attack Surface Summary

| Vector | State | Evidence |
|---|---|---|
| Renderer → main IPC | Hardened: allowlist + Zod + sender trust + fail-closed RBAC + timeout | `ipc/{router,secureBridge,runtimeAuthz}.ts` |
| Token theft at rest | Mitigated: OS-keychain ciphertext, no plaintext fallback | `security/secureStore.ts:70` |
| Renderer XSS → exfil | Mitigated: strict CSP, sandbox, no renderer network I/O | `security/csp.ts`, `window.ts:33` |
| Per-IPC audit forgery | **Exposed**: plain JSONL, not hash-chained | `secureBridge.ts:110` |
| Plugin supply chain | **Exposed**: no signature check at install; perms auto-granted | `plugins/pluginManager.ts` (see §10.4) |
| SSO assertion forgery | **Exposed**: no signature/JWKS verification | `cloud/identity/federation.ts:7` |

### 11.10 Security Judgment (ANALYSIS/OPINION)

The **client-side hardening is genuinely strong** — the sandbox posture, fail-closed IPC classification, keychain-backed secrets, and deny-by-default RBAC are what a serious enterprise desktop should look like. The credibility gaps are (a) the per-IPC audit log not being tamper-evident while a chain primitive sits unused two directories away, (b) the plugin install trust chain being open despite a signing pipeline existing, and (c) federation/SSO being modeling rather than verification. The `packages/security`/`trust-platform` crypto is real but is **latent capability, not shipped security** — a diligence reader must not credit the app with AES-256-GCM envelope encryption or ABAC/JIT that it does not import.

---

## 12. Local-First Architecture (Offline Mode, Synchronization, Conflict Resolution, Storage, Database, Caching, Recovery, Boot Sequence, Installer, First Run, Update System)

### 12.1 Two Persistence Stacks — Only One Ships in the Desktop

> **CODE-EVIDENCE:** The shipping Electron app persists to **JSON files under Electron `userData`** — there is **no embedded SQL DB in the desktop app**. `@neuropause/persistence` (the full Postgres/PGlite event-store/object-store/cache/RLS platform, 1,756 LOC) is **not imported anywhere under `apps/desktop/src`** (grep confirms consumers are cloud packages only). The two stacks are unconnected; "survives restart/crash/upgrade via Postgres" applies to the **cloud/server, not the local desktop.**

### 12.2 Storage & Offline (implemented)

Local-first JSON stores with atomic `tmp+rename` writes: `unified/unifiedStore.ts` (canonical `UnifiedEntity` graph, 212 LOC), `sync/syncStateStore.ts`, onboarding, registry, prefs. The app is offline-capable by construction (no runtime backend dependency for local reads/writes).

> **Scalability ceiling (CODE-EVIDENCE):** `UnifiedStore`/`SyncStateStore` load entire JSON files into memory and rewrite the whole file on every change — no incremental/paged persistence. A code comment notes a future move to SQLite/Postgres "with no caller changes," but **it is not done.**

### 12.3 Synchronization (implemented)

`apps/desktop/src/main/unified/sync/orchestrator.ts` (305 LOC) drives adapter paging per connected account, persists incremental cursors, writes through the conflict-resolving store, emits platform events, and handles rate-limit/offline/retry with in-flight coalescing and bounded concurrency: `MAX_CONCURRENT_SYNCS=4`, `MAX_PAGES_PER_RESOURCE=50`, `SYNC_INTERVAL_MS=15min` (`orchestrator.ts:24-28`). ~30 SaaS adapters feed it (`sync/adapters/index.ts`, family test suites present). Retry uses exponential backoff with jitter (`retryQueue.ts`); exhaustion dead-letters the account.

The working client half of backend sync is `apps/desktop/src/main/cloud/livesync/engine.ts` (real, extensively tested) — a timer-free engine (push pending, pull+apply pages, backoff classifier, conflict log) whose HTTP transport calls the backend `/sync/:orgId/push` + `/pull` with an authenticated Bearer token (`livesync/transport.ts`).

### 12.4 Conflict Resolution (implemented)

`UnifiedStore.upsertMany` uses **source-authoritative last-updated-wins with a content-signature tie-break** for equal `updatedAt` timestamps (`unifiedStore.ts:88`), plus soft-delete and per-connector purge. The cloud side (`packages/persistence`) uses an append-only event store + optimistic version on repositories.

### 12.5 Sync-State Durability & Crash Recovery (implemented)

`syncStateStore.ts` (275 LOC) persists per-account/per-resource cursors, health, write metrics, and dead-letter info via a serialized atomic write chain using pid+seq unique tmp filenames (guards concurrent-save ENOENT races). `reconcile()` resets accounts stuck in `syncing` → `idle` on boot. The dead-letter queue (`deadLettered()`, `recordDeadLetter`, `clearDeadLetter`) is real and populated.

> **Hidden capability:** only a boolean `deadLettered` flag reaches the snapshot — the full DLQ list/replay is not surfaced as a dedicated renderer view.

### 12.6 Backup & Recovery (implemented)

- `backup/backupManager.ts` (218 LOC): domain-scoped file snapshots over `userData/backups` with a SHA-256 manifest; a **safety backup is taken before every restore**; restore is integrity-gated. Nine protected domains (registry, config, workspace, knowledgeGraph, aiWorker, plugin, aiMemory, timeline); the `database` domain is intentionally empty (backend is server-side).
- `recovery/recoveryService.ts` (244 LOC): 8-action Recovery Center (safe mode, disable plugins, reset settings, restore backup, repair/verify installation, rebuild search index, rebuild knowledge graph). Safe Mode persists a flag consumed by the launcher **without mutating plugin enabled-state**. *No dedicated test file in `recovery/`.*

### 12.7 Migration (implemented engine, thin data)

`migration/migrationEngine.ts` (165 LOC) performs ordered cross-domain migrations with pre-migration backup, restore-on-failure + version revert, dry-run planning, and per-step reporting.

> **CODE-EVIDENCE:** Only **one migration is registered** (`0001-baseline → v1`; `CURRENT_DATA_VERSION=1`). The engine is production-grade but the recover-on-failure path is untested against a real failing migration on production data.

### 12.8 Boot Sequence & First Run (implemented)

Composed in `apps/desktop/src/main/runtimeCore.ts` via `releaseOps/index.ts`: `runStartupMigrations()` runs at boot (`runtimeCore.ts:540`) before use; Safe Mode gates `serviceManager.startAll` with `skip:['plugin-loader']` (`runtimeCore.ts:2591`). `onboarding/onboardingService.ts` (130 LOC) tracks first-run wizard + welcome checklist with atomic writes. `releaseOps` also schedules daily backups (`SCHEDULED_BACKUP_INTERVAL_MS=24h`, retain 10).

### 12.9 Installer (partial)

`apps/desktop/electron-builder.yml`: appId `com.neuropause.desktop`; macOS dmg+zip arm64 (hardenedRuntime + entitlements), Windows nsis+portable+zip x64; `asarUnpack plugin-host.cjs`.

> **CODE-EVIDENCE / gap:** macOS `notarize:false` currently (notarization via an `afterSign` hook that no-ops without three `APPLE_*` creds); **Windows code-signing is not configured** in the yml. Signed/notarized distribution is **not yet wired** — every CI build to date is a verified **unsigned** build.

### 12.10 Update System (implemented, self-hosted)

`services/appUpdater.ts` (241 LOC) wraps `electron-updater`: three channels (stable/beta/internal), **never silent** — `autoDownload=false`, `autoInstallOnAppQuit=false`, `allowDowngrade=false`; explicit check/download/install-on-restart, release notes, persisted channel preference. Pure logic is isolated in `updater/updateChannels.ts` (unit-tested); `appUpdater` itself is inert in dev (`!app.isPackaged → supported:false`) and has no unit test. IPC exposes 5 handlers (status/check/download/install-on-quit/set-channel).

> **Gaps:** Rollback is **preparation-only** — `pickRollbackTarget`/`rollbackTarget()` compute the revert version but **no code performs a downgrade/reinstall**, and `rollbackTarget()` is **not exposed on any IPC channel** (invisible to the renderer). The update feed is a **single hard-coded droplet** (`https://neuropause033.com/updates`, `64.227.128.218`) reached over SSH with a deploy secret, with a temporary `beta→latest` channel aliasing hack and no CDN/redundancy.

### 12.11 Cloud Persistence Platform (partial, out of desktop scope)

`@neuropause/persistence` is real and ACID over embedded PGlite (WASM Postgres) — versioned reversible migrations with checksum ledger + drift `verify()` (`migrations.ts`), append-only event store with content hashes/snapshots/replay (`eventStore.ts`), filesystem blob store, in-memory TTL cache, and tenancy. It self-labels **PREVIEW**: networked Postgres/Redis/S3, cluster PITR/WAL/failover, and RLS-under-scoped-roles are **interface-only / infra-pending** (PGlite runs as superuser and bypasses RLS, so tenant isolation is *also* enforced and tested at the repository layer; `schema.ts` RLS v6).

### 12.12 Local-First Judgment (ANALYSIS/OPINION)

The local-first story that actually ships is coherent and honest: atomic JSON persistence, source-authoritative conflict resolution, a real crash reconciler, integrity-gated backup/restore, and a conservative never-silent updater. The two structural liabilities are (1) whole-file JSON rewrite scaling — fine for a founder-scale dataset, a real ceiling for the "445K LOC enterprise ERP" positioning — and (2) the unsigned/unnotarized, single-droplet update pipeline, which is a distribution-trust gap that must be closed before any enterprise rollout. The Postgres platform that would resolve (1) exists but is unwired.

---

## 13. AI Workforce (Every Worker: Responsibilities, Capabilities, Interactions, Roadmap)

### 13.1 Architecture Context

The AI Workforce lives in `apps/desktop/src/main/workforce` (~6,533 LOC), surfaced by the renderer `WorkforceView` and its panels (`MissionControlPanel`, `ExecutiveChatPanel`, `AutomationStudioPanel`, `ApprovalCenterPanel`, `AnalyticsPanel`). It is a **real engine**, not a scaffold, composed of these subsystems (non-test LOC):

| Subsystem | Path | LOC | Role |
|---|---|---|---|
| Workers | `workforce/workers` | 1,675 | Built-in + installable worker definitions |
| Planning | `workforce/planning` | 856 | Multi-step plan construction |
| Runtime | `workforce/runtime` | 821 | Permission-scoped execution |
| Install | `workforce/install` | 765 | Installable worker packages |
| Governance | `workforce/governance` | 484 | Approval/audit gating |
| Intelligence | `workforce/intelligence` | 469 | Signal/insight feed |
| Orchestrator | `workforce/orchestrator` | 276 | Multi-step workflow coordination |
| Registry | `workforce/registry` | 209 | Worker registry |
| SDK | `workforce/sdk` | 144 | Worker/skill contract |
| Execution | `workforce/execution` | 98 | Job execution |

Jobs run against **fresh snapshots** of UDM / Timeline / Memory / graph. The SDK flags declared-but-unimplemented skills at load (`workforce/sdk/index.ts:108` pushes error `skill "..." declared but not implemented`), which is an important honesty property but also means the roster of *fully implemented* skills cannot be fully enumerated from the corpus.

### 13.2 Enumeration Constraint (CODE-EVIDENCE)

> The recon corpus establishes the workforce **engine, registry, subsystem LOC, renderer panels, governance model, and the runtime contract**, but it does **not enumerate the individual built-in workers by name, per-worker responsibilities, or per-worker capability lists**. The instruction to "enumerate every worker" therefore cannot be satisfied from the repository evidence provided. Inventing worker names/responsibilities would violate the grounding rule. What follows is the fully-evidenced structure; the named-worker roster is marked **UNVERIFIED / not in corpus**.

### 13.3 What Is Evidenced

**Responsibilities (engine-level, implemented):**
- **Registry** (`workforce/registry`, 209 LOC) — catalog of built-in and installable workers.
- **Orchestrator** (`workforce/orchestrator`, 276 LOC) — coordinates orchestrated multi-step workflows.
- **Planning** (`workforce/planning`, 856 LOC) — multi-step planning ahead of execution.
- **Runtime** (`workforce/runtime`, 821 LOC) — permission-scoped execution against fresh UDM/Timeline/Memory/graph snapshots.
- **Governance** (`workforce/governance`, 484 LOC) — approval/audit gating over worker actions.
- **Install** (`workforce/install`, 765 LOC) — installable worker packages (extends the roster beyond built-ins).
- **SDK** (`workforce/sdk`, 144 LOC) — the worker/skill contract; flags undeclared/unimplemented skills at load.

**Capabilities (implemented):** worker registry, orchestrated multi-step workflows, permission-scoped runtime, installable worker packages, snapshot-isolated execution.

**Interactions (implemented):**
- Reads UDM store, Enterprise Timeline, AI Memory, and the knowledge graph as immutable per-job snapshots.
- Surfaced to the user through `WorkforceView` and its five panels; the hidden nav aliases `automations` and `analytics` render `WorkforceView` with `initialTab='studio'`/`'analytics'` (`shell/sections.ts`), so those capabilities are reachable only through Workforce tabs.
- Governed by the same enterprise RBAC/audit stack as the rest of the platform.

### 13.4 Relationship to the AI Platform (context)

Workers execute over the shipping desktop AI path (`apps/desktop/src/main/{ai,assistant,memory,intelligence}`): a provider-agnostic `AiEngine` routing to real Anthropic (`claudeClient.ts`) or local Ollama (`ollamaClient.ts`) inference, tiered `ModelRouter` (fast/balanced/deep → Haiku 4.5 / Sonnet 4.6 / Opus 4.8), grounded prompts, and a deterministic offline fallback (`grounded:false`). AI **narrates/explains; it does not fabricate numbers or autonomously act** — side effects are human-approval-gated. Two parallel governance-first AI stacks (`packages/ai-runtime`, `packages/intelligence`) with full agent/tool/workflow runtimes exist and are tested but ship only deterministic Fake/Deterministic providers and are **not imported by the desktop app** — they are latent, not part of the shipping Workforce.

### 13.5 Roadmap (CODE-EVIDENCE where the code names it; otherwise ANALYSIS)

- **Declared-but-unimplemented skills** are explicitly surfaced at load (`sdk/index.ts:108`) — the roadmap for individual workers is, by design, whatever skills are declared but not yet implemented. *The specific list is not in the corpus.*
- **`runModel` for plugin-authored AI workers** dead-ends at `no_local_model_configured` (`plugins/pluginHost.ts:236`) — wiring a local model runtime is a named-seam roadmap item that would expand installable AI workers.
- **(ANALYSIS/OPINION)** The most valuable near-term move is convergence: the desktop Workforce runtime and the far richer, unwired `packages/ai-runtime` (7 agent kinds, permissioned zod-validated tools, retry/rollback/approval workflows, rate-limited connectors) do not meet in the shipping product. Bridging them would turn the current permission-scoped, human-gated executor into a governed autonomous-agent platform without new research.

### 13.6 Workforce Judgment (ANALYSIS/OPINION)

The Workforce is a **substantive, well-layered engine** (registry + planning + orchestrator + permission-scoped runtime + governance + installable packages, ~6.5K LOC with co-located tests) with a commendable honesty contract that refuses to pretend undeclared skills work. Its two credibility limits for a diligence reader are (1) the individual worker roster and per-worker capabilities are **not evidenced in this corpus and must be verified directly against `workforce/workers` (1,675 LOC) before any claim about specific agents**, and (2) autonomous breadth is deliberately capped — execution is snapshot-isolated and human-approval-gated, with the richer autonomous runtime sitting unwired in `packages/ai-runtime`.

## 14. Feature Inventory (complete, grounded, no omissions — organized by domain)

Every feature below is drawn directly from the recon corpus. Status legend: **[Implemented]** = real logic + tests present; **[Partial]** = real logic with an explicitly named boundary/seam; **[Planned]** = declared but not built; **[Missing/Unverified]** = not supported by the corpus.

### 14.1 Finance / Accounting ERP (`apps/desktop/src/main/enterprise/modules/finance`, `packages/shared/src/types`)

20 modules, all `group:'Finance'`, registered in `enterprise/index.ts:88-107`. Two-layer pattern: pure engines in `packages/shared/src/types` (~2.8K LOC across 11 files) + thin descriptor modules (~4.9K LOC).

| Feature | Status | Evidence |
|---|---|---|
| Double-entry journal, cents-rounded debits===credits enforced, per-line CoA resolution | **[Implemented]** | `journalEntryModule.ts:9-19` (376 LOC) |
| Immutable posted entries; corrections via reversing entries only | **[Implemented]** | `journalEntryModule.ts` |
| Idempotent lifecycle auto-posting (invoice/payment/vendor-bill/vendor-payment/fx-reval) keyed by deterministic entry numbers | **[Implemented]** | `glPosting.ts:143-518` (563 LOC) |
| Control-account seeding only into an empty CoA; ensures FX accounts 7810/7811 | **[Implemented]** | `glPosting.ts` `ensureUnrealizedFxAccount(7811)` |
| Chart of Accounts (code/name/class/currency + cashFlowCategory), balances re-derived not stored | **[Implemented]** | `ledgerAccountModule.ts` (167 LOC) |
| Trial balance, financial statements, financial ratios (NULL when undefined, never fabricated) | **[Implemented]** | `generalLedger.ts` (839), `financialRatios.ts` (66) |
| Customer invoices with GST/GSTIN capture; issue/markPaid/cancel; AI narrative | **[Implemented]** | `invoiceModule.ts` (241), `invoiceAi.ts` |
| Customer payments, multi-currency `exchangeRate`, realized FX gain/loss on receipt | **[Implemented]** | `paymentModule.ts:82` (274) |
| Vendor bills (AP), GSTIN, multi-currency | **[Implemented]** | `vendorBillModule.ts` (198) |
| Vendor payments, allocation, partials, realized payable FX | **[Implemented]** | `vendorPaymentModule.ts` (247) |
| Credit/debit notes with over-adjustment guard | **[Implemented]** | `creditNoteModule.ts`/`debitNoteModule.ts` (509), `adjustmentNotes.ts` (142) |
| Fixed assets: capitalize, straight-line monthly depreciation, disposal gain/loss (auto-posted) | **[Implemented]** | `fixedAssetModule.ts` (258) |
| GST/tax report snapshots from posted ledger | **[Implemented]** | `taxReportModule.ts` (194), `glTaxReportForPeriod` |
| AR/AP aging (current/1-30/31-60/61-90/90+) | **[Implemented]** | `arAgingModule.ts`/`apAgingModule.ts` (275) |
| Bank statement import (JSON) + auto-matching within `BANK_MATCH_WINDOW_DAYS=3` | **[Partial]** — match+summary only; no write-back/clearing postings | `bankStatementModule.ts` (234), `bankReconciliation.ts` (186) |
| Budget-vs-actuals, 5% tolerance | **[Implemented]** | `budgetModule.ts` (220), `budgets.ts` (104) |
| Exchange-rate register + conversion engine | **[Implemented]** | `exchangeRateModule.ts` (146), `exchangeRates.ts` (128) |
| Period-end unrealized FX revaluation (AR/AP/cash) with JE + auto-reversing JE | **[Implemented]** | `fxRevaluationModule.ts:212` (239), `fxGainLoss.ts` (235), `fxRevaluation.ts` (245) |
| FX exposure netted by currency and by party | **[Implemented]** | `fxExposureModule.ts` (190), `fxExposure.ts` (244) |
| Cash flow statement (operating/investing/financing) | **[Implemented]** | `cashFlowModule.ts` (175), `cashFlow.ts` (110) |
| Accounting periods with close guard + delta adjustments | **[Implemented]** | `accountingPeriodModule.ts` (174), `glDateInClosedPeriod` |
| **Depreciation methods other than straight-line** (declining-balance/units-of-production) | **[Missing]** | Not present in `fixedAssetModule.ts` |

Coverage: 25 finance test files (~4.6K LOC). No genuine code stubs; all 55 TODO/placeholder grep hits are UI field placeholders.

### 14.2 HR / Payroll (`.../modules/hr`)

8 modules, registered `enterprise/index.ts:301-370`, wired via `hrInstances.ts:30-64`.

| Feature | Status | Evidence |
|---|---|---|
| India-statutory gross-to-net payroll (PF/ESI/PT/TDS), effective-dated rule tables, rates as audited records | **[Implemented]** | `statutoryRules.ts:1-27,505-545` (545 LOC), verified-2026-08-06 seed |
| Pure gross-to-net engine (per-employee statutory vs flat, never mixed), balanced-by-construction GL lines | **[Implemented]** | `payrollProcessing.ts:230-258` (260) |
| Monthly payroll run: preview, balanced accrual post, idempotent `JE-PAYROLL-<period>`, immutable once posted | **[Implemented]** | `payrollRunModule.ts:220-233` (385) |
| Statutory rule CRUD + audited `seedDefaults` | **[Implemented]** | `statutoryRuleModule.ts` (178) |
| Salary structures (percentOfBasic, wage bases) | **[Implemented]** | `salaryStructureModule.ts` (168), `salaryStructures.ts` |
| Salary disbursement, Dr Payable/Cr Cash, NEFT bank advice file | **[Partial]** — no bank transmission API; advice is a file a human uploads | `salaryDisbursementModule.ts:10-16` (323) |
| Immutable payslips from posted runs | **[Implemented]** | `payslipModule.ts` (128) |
| Payroll register snapshot | **[Implemented]** | `payrollRegisterModule.ts` (172), `payrollRegister.ts` |
| ECR/ESI/PT/24Q filing data joined to UAN/IP/PAN | **[Partial]** — 24Q FVU (Protean RPU) export NOT produced; NCP/LOP days hardcoded 0 | `statutoryFilingModule.ts:14,168-171` (199) |
| Employee master (bank/UAN/ESIC/PAN/workState, cycle-guarded manager chain) | **[Implemented]** | `employeeModule.ts` (222) |
| **Attendance / LOP / proration engine** | **[Missing]** | Payroll assumes full-month pay |
| Multi-state Professional Tax (only Gujarat seeded) | **[Partial]** — schema-supported, other states manual | Corpus gap |
| ESI disability ceiling (no disability flag on employee record) | **[Partial]** — engine-supported, unreachable (privacy decision) | Corpus gap |

### 14.3 CRM (`.../modules/crm`)

8 modules. Deterministic scoring; AI narrates, never changes numbers.

| Feature | Status | Evidence |
|---|---|---|
| Lead pipeline, deterministic `leadScore`/conversion-probability/health, Convert-to-Customer | **[Implemented]** | `leadModule.ts:168-208` (216) |
| Customers (health), opportunities (qualified-deal pipeline), contacts, activity stream | **[Implemented]** | `opportunityModule.ts` (343 + 232-line test), `customerModule.ts` (214/464) |
| Customer health register, single-account timeline, campaign lead-attribution | **[Implemented]** | `customerHealthModule.ts` (153), `customerInsights` |
| Lead→Contact→Customer conversion (idempotent, non-destructive, audited) | **[Implemented]** | `conversion.ts` |
| Optional grounded-AI narrative, deterministic offline fallback | **[Partial]** — best-effort, depends on configured model | `leadAi`, `aiEngine` |

### 14.4 Sales (`.../modules/sales`)

7 modules.

| Feature | Status | Evidence |
|---|---|---|
| Quotes with pricing-rule/discount engine at validate; Quote→Order→Invoice chain | **[Implemented]** | `quoteModule.ts:217-224` (264), 27 tests |
| Order→Invoice re-authorizes Finance scope (sales actor cannot mint invoices) | **[Implemented]** | `conversion.ts:120-140` |
| Sales orders: fulfillment/shipment/revenue stamps; ship/fulfill/close/cancel; reserve stock; pick list | **[Implemented]** | `orderModule.ts:222-246` (252), `inventoryLink.ts:1-16` |
| Pricing-rule book (volume/customer/rep scope) | **[Implemented]** | `pricingRuleModule.ts` (164), `pricingRules.ts` |
| Commission plans + immutable per-period statements (bookings basis; reps w/o plan appear at rate 0) | **[Implemented]** | `commissionStatementModule.ts` (150) |
| Contract activate/terminate/renew + revenue forecast snapshots | **[Implemented]** | `contractModule.ts` (295), `revenueForecast.ts` (146) |

### 14.5 Supply Chain — Procurement / Inventory / Warehouse / Manufacturing / Maintenance

~55 modules registered `enterprise/index.ts:334-392`. Single event-sourced Inventory Ledger; one write seam `postStockMovement`.

**Inventory (7):**
| Feature | Status | Evidence |
|---|---|---|
| Immutable append-only stock ledger; on-hand/reserved/available/value re-derived from full history | **[Implemented]** | `stockMovementModule.ts` (170), 9 movement types |
| Single write seam enforcing `inventory:manage` | **[Implemented]** | `postMovement.ts` (66) |
| Multi-method valuation registers (standard / FIFO / weighted-avg / moving-avg) | **[Implemented]** | `inventoryValuationModule.ts` (178), `inventoryValuation.ts:81` |
| Reservations (release/fulfil), lots, serials, products, warehouses | **[Implemented]** | `reservationModule`/`lotModule`/`serialModule`/`productModule`/`warehouseModule` (580) |

**Procurement (6):**
| Feature | Status | Evidence |
|---|---|---|
| Purchase orders: total math, guarded lifecycle, PO→Goods Receipt | **[Implemented]** | `purchaseOrderModule.ts` (159) |
| Goods receipt posts real `receive` movement, idempotent | **[Implemented]** | `goodsReceiptModule.ts` (131) |
| RFQ multi-supplier cycle→PO award, supplier master, performance scorecard, purchase requests | **[Implemented]** | `rfqModule`/`supplierModule`/`supplierPerformanceModule` (523) |

**Warehouse (8):**
| Feature | Status | Evidence |
|---|---|---|
| Transfer orders: approve→dispatch(→IN-TRANSIT)→receive→cancel, net-zero paired legs | **[Implemented]** | `transferOrderModule.ts` (240), `warehouseMovements.ts` |
| Pick list / shipping / cycle count / stock adjustment (all post typed movements) | **[Implemented]** | (742) |
| Packing operational record | **[Partial]** — inventory effect unverified (may not post movements) | Corpus gap |
| Zones / bins master-data | **[Implemented]** | (138) |

**Manufacturing (12):**
| Feature | Status | Evidence |
|---|---|---|
| MES execution: 13-action lifecycle, BOM backflush on first op, finished-goods output + scrap + PO rollup on final | **[Implemented]** | `executionModule.ts:238,310` (451) |
| Production orders, BOM, multi-level BOM explosion (cycle detection, cost rollup), routing, schedule, work center, Machine | **[Implemented]** | (700), `explodeBom` |
| Governed scheduling: proposal→approved→committed; deterministic routing→machine; idempotent dispatch | **[Implemented]** | `scheduleProposalModule.ts`, `scheduleCommit.ts`, `mesDispatch.ts` (490) |
| Quality inspection + production costing (material+labor+machine+overhead) + variance vs standard | **[Implemented]** | `costingModule.ts` (243) |
| Immutable shop-floor event ledger | **[Implemented]** | `manufacturingEventModule.ts` (124) |

**Maintenance (10):**
| Feature | Status | Evidence |
|---|---|---|
| Work orders: scheduled→…→verified; set Machine `maintenance`/restore `running`; writes History | **[Implemented]** | `workOrderModule.ts` (211) |
| Spare-part `consume`→ledger movement; downtime `log`→authoritative Machine hours (feeds OEE) | **[Implemented]** | `maintenanceMovements.ts` (219) |
| Assets, categories, technicians, plans, preventive/corrective, history | **[Implemented]** | (471) |

### 14.6 Enterprise Module Framework + Cross-domain (`.../enterprise/framework`, `modules/{projects,helpdesk,documents,executive}`)

| Feature | Status | Evidence |
|---|---|---|
| Declarative module = descriptor + record store; inherits RBAC/audit/timeline/search/persistence/CRUD IPC/renderer UI | **[Implemented]** | `enterpriseModule.ts` (145), `enterpriseRecordStore.ts` (240) |
| Generic lifecycle fan-out (created/updated/status_changed/deleted) + `runAction` + awaited `onChange` | **[Implemented]** | `moduleRegistry.ts:124-148` (374) |
| Certification gate: locks count=95 across 13 families, unique ids, RBAC scopes, unique action keys | **[Implemented]** | `moduleCertification.test.ts` (`toHaveLength(95)`) |
| Projects (4): delivery containers, kanban tasks, billable time, billing run → real W1 draft invoice cross-module | **[Implemented]** | `billingRunModule.ts:190-255` |
| Helpdesk (1): SLA tickets, resolve/close, flags "Closed UNRESOLVED" | **[Implemented]** | `ticketModule.ts` (210) |
| Documents (1): append-only versioned registry, check-in/archive | **[Implemented]** | `documentModule.ts:139-155` (190) |
| Executive (3): decision approval (pending→approved/rejected→verified→archived), execution proposal (draft→…→accepted), BI reports | **[Implemented]** | `executiveDecisionModule.ts:158` (260), `executionProposalModule.ts` (220), `biReportModule.ts` (185) |
| **Generic reusable workflow/approval ENGINE** | **[Missing]** — approval is hand-rolled per module via transition guards in `@neuropause/shared` | Corpus gap |

> **Note (stale docs, CODE-EVIDENCE):** cert test title/header say "94", a comment references an "84th" module, and the Finance import banner says "(19)" for 20 descriptors — all contradicted by the live `expect(...).toBe(95)` assertions and 95 `registry.register(...)` calls.

### 14.7 AI Platform (`apps/desktop/src/main/{ai,assistant,memory,intelligence}`)

| Feature | Status | Evidence |
|---|---|---|
| Provider-agnostic `AiEngine`: render→context→route→parse→price→audit; grounded:false deterministic fallback | **[Implemented]** | `aiEngine.ts` (230) |
| Real Anthropic Messages API client (cloud inference) | **[Implemented]** | `claudeClient.ts` (95) — no dedicated unit test |
| Real Ollama local inference ($0) | **[Implemented]** | `ollamaClient.ts` (100) |
| Model router: fast/balanced/deep → Haiku 4.5 / Sonnet 4.6 / Opus 4.8 | **[Implemented]** | `modelRouter.ts` (48) — no direct test |
| Provider precedence config>env>default, key from Secure Vault; hot router reconfigure | **[Implemented]** | `providerManager.ts` (75), `engineManager.ts` (80) |
| Versioned prompt registry (32 templates) + GROUNDING anti-hallucination clause | **[Implemented]** | `promptManager.ts` (770) — no dedicated test |
| Token/USD cost accounting + hash-only audit log | **[Implemented]** | `responseParser.ts`, pricing/usageTracker/auditLog |
| Context Builder: federated retrieval over graph/timeline/memory/UDM/brief, relevance×recency, budget caps | **[Implemented]** | `contextBuilder.ts` (300) |
| Founder AI v2 + Engineering AI (deterministic findings, LLM narrates only) | **[Implemented]** | `founderAI.ts` (500), `ai/index.ts` (230) |
| Assistant Service: 9-phase turn pipeline, human-approval-gated execution, correlation id | **[Implemented]** | `assistantService.ts` (1900, 74KB), 8 staged tests |
| ~12 assistant domain resolvers (de-facto skills/sub-agents) | **[Implemented]** | `assistantModel.ts` (900) |
| Hybrid lexical+semantic memory recall; real cosine `VectorStore` | **[Partial]** — desktop owns NO embedding provider | `memorySemanticRecall.ts` (200), `vectorStore.ts` (250) |
| Resilient backend semantic delegation (circuit breaker + 4s deadline) | **[Implemented]** | `resilientSemanticSearch.ts` (190), `backendSemanticClient.ts` |
| Executive conversation memory (deterministic classify + secret/PHI screen) | **[Implemented]** | `conversationMemory.ts` (600) |
| Vector DB (Qdrant/Pinecone/Weaviate) on desktop | **[Missing]** — in-memory only; backend-owned | `vectorStore.ts` |

### 14.8 Knowledge Graph + Digital Twin + Insight (`apps/desktop/src/main/{graph,knowledge,knowledgeAssets,knowledgeFabric,twin,digitalTwinPlatform,insight}`)

~11.4K LOC, 44 source / 43 test files. Read-only projections except graph (stateful).

| Feature | Status | Evidence |
|---|---|---|
| Enterprise Knowledge Graph: adjacency index, shortest-path/subgraph/neighbors, capped 5000-event history, JSON persist | **[Implemented]** | `graphStore.ts`, `projector.ts`, 8 `graph:*` channels (756) |
| Derived knowledge: IDF-weighted relatedness + graph-hop, union-find topic clusters | **[Implemented]** | `knowledgeLinks.ts`, `topicClusters.ts` (500) |
| Knowledge & decision platform (inventory/impact/lineage/quality/standards/coverage + 10 resolvers) | **[Implemented]** | `knowledgeModel.ts`+`assetInventory.ts` (3394) |
| Knowledge Fabric (Evidence/Sources/Reasoning/Confidence + classification/lineage/governance) | **[Implemented]** | `knowledgeFabricModel.ts` (942) |
| Digital Twin P15: 9 domain twins, topology, health, blast-radius, timeline replay, exec command center | **[Implemented]** | `twinModel.ts` (877) |
| Digital Twin Platform P17: runtime twin, platform twins, coverage, simulation inventory, history, dashboard | **[Implemented]** | `digitalTwinPlatform` (2379) |
| Insight P6: 7 deterministic heuristics (no ML), 8-domain health, dependency graph, confidence breakdown | **[Implemented]** | `insightModel.ts`, `predictions.ts` (2555) |
| Manufacturing what-if simulation engine (15 scenarios, `runSimulation`) | **[Partial]** — real logic, **UNWIRED**: no IPC call site, no test, no UI | `manufacturingDigitalTwin.ts:47,106,364` (617) |
| **Any live simulation execution** | **[Missing]** — twin passes SimulationReport through unmodified; DTP `invoked=false` by construction | `twinModel.ts:~407`, `simulationInventory.ts` |

### 14.9 Connectors / Integration (`apps/desktop/src/main/connectors`, `.../unified/sync`)

| Feature | Status | Evidence |
|---|---|---|
| 22-provider manifest catalog, real OAuth endpoints, least-privilege scopes | **[Implemented]** | `manifests.ts:99-762` |
| OAuth 2.0 + PKCE, encrypted token vault, proactive+lazy refresh, expiry rotation | **[Implemented]** | `oauthEngine`, `pkce`, `oauthTokens`, `credentials` |
| 12 real sync adapter families (GitHub, Notion, Google, Slack, Atlassian, Salesforce, HubSpot, ServiceNow, SAP, Oracle, Dynamics, Workday, Entra) | **[Partial]** — adapter-verified vs simulated responses; live needs operator OAuth apps + network | `adapters/index.ts:20-52`, `salesforce.ts:106-484` |
| Incremental sync: per-resource cursors, high-water marks, delta/deletion | **[Implemented]** | `syncStateStore.ts` |
| Orchestration: paging, conflict resolution, rate limit, retry, offline, capability reporting | **[Implemented]** | `orchestrator.ts` (12645 dir LOC) |
| Inbound signed webhook router + Slack Socket Mode | **[Partial]** — inert without app-level token + relay/tunnel | `inbound/` |
| M365 write executor (mail/calendar/contacts/drive/teams) + AI drafts | **[Partial]** — the only write-capable connector; no tests in `m365/` | `m365/` |
| Renderer Connectors UI (~18 IPC channels) | **[Implemented]** | `renderer/src/connectors/` |
| Live production provider traffic | **[Missing/Unverified]** — every adapter verified only against simulated responses | Corpus gap |

### 14.10 Runtime / Orchestration / Automation / Webhooks (desktop)

| Feature | Status | Evidence |
|---|---|---|
| App-instance lifecycle (launch/stop/suspend/resume/restart, `MAX_RESTARTS=3`, health, crash detection) | **[Implemented]** | `runtime/supervisor.ts` (250) |
| Signed, retried, dead-lettered webhook delivery, SSRF egress guard (redirect:error), HMAC | **[Implemented]** | `webhooks/index.ts` (1128) |
| Schedule-driven automation (60s tick fires due rules through existing runner) — only genuine autonomous exec seam | **[Implemented]** | `automationPlatform/index.ts:79` `TICK_MS=60_000` (3312) |
| Read-only AI orchestration (goal routing, 8 RBAC channels) | **[Implemented]** | `orchestration/index.ts` (1206) — structurally cannot execute |
| Read-only autonomous ops (advisory, "no autonomous bypass" invariant) | **[Implemented]** | `autonomousOps/index.ts` (1760) |

### 14.11 Security / Auth / Identity / License (desktop)

| Feature | Status | Evidence |
|---|---|---|
| OAuth RFC 8252 PKCE + ephemeral loopback + CSRF state check | **[Implemented]** | `authService.ts:150`, `loopbackServer.ts` |
| Refresh token encrypted at rest (safeStorage), access token in-memory only, rotation | **[Implemented]** | `secureStore.ts:70` — refuses plaintext fallback |
| Hardened IPC: allowlist + Zod + sender trust + contextIsolation/sandbox + strict CSP | **[Implemented]** | `router.ts:130`, `secureBridge.ts:150`, `window.ts:33`, `csp.ts` |
| Fail-closed RBAC over runtime/enterprise channels; per-org role model | **[Implemented]** | `runtimeAuthz.ts:210`, `authzGate.ts:66`, `authz.ts:40` |
| SHA-256 tamper-evident audit chain | **[Implemented]** | `auditChain.ts:30` (honest threat model) |
| Per-IPC bridge audit log | **[Partial]** — plain JSONL, NOT hash-chained | `secureBridge.ts:110` |
| Offline product-license validator (last-known-good cache, clock re-eval) | **[Implemented]** | `license/validator.ts` — no client-side signature verification |
| SSO/SAML/OIDC federation | **[Partial]** — protocol modeling only, NO signature/JWKS verification | `cloud/identity/federation.ts:7` |
| Live IdP (Okta/Azure AD/Auth0/Ping/Google), SCIM, LDAP/AD, KMS/HSM, certification | **[Missing]** — INFRA-PENDING / never claimed | Corpus gap |

### 14.12 Local-first Data / Persistence / Backup / Migration / Installer / Update (desktop)

| Feature | Status | Evidence |
|---|---|---|
| UnifiedStore (canonical entity graph, atomic writes, source-authoritative last-updated-wins + signature tie-break) | **[Implemented]** | `unifiedStore.ts:88` (212) |
| Durable SyncStateStore (cursors + health + DLQ + crash reconciler) | **[Implemented]** | `syncStateStore.ts` (275) |
| Retry queue (exp backoff + jitter, dead-letter) | **[Implemented]** | `retryQueue.ts` (144) |
| Domain-scoped file backups (sha256 manifest, safety backup before restore, daily keep 10) | **[Implemented]** | `backupManager.ts` (218), 9 domains |
| Data-version migration engine (backup + restore-on-failure) | **[Partial]** — only 1 migration registered (`0001-baseline`, v1) | `migrations.ts` |
| Recovery Center (8 actions incl. safe mode, rebuild index/graph) | **[Implemented]** | `recoveryService.ts` (244) — no dedicated test |
| electron-updater self-update (3 channels, explicit user-driven, never silent) | **[Implemented]** | `appUpdater.ts` (241) — inert in dev, no unit test |
| Pure channel resolution/semver logic | **[Implemented]** | `updateChannels.ts` (112) |
| Rollback | **[Partial]** — `rollbackTarget()` computes target only; no actual downgrade (`allowDowngrade=false`) |
| electron-builder installer (mac dmg+zip arm64, win nsis+portable+zip x64) | **[Partial]** — mac `notarize:false`, win signing not configured | `electron-builder.yml` |
| SQLite/Postgres backing for desktop stores | **[Missing]** — JSON files, whole-file rewrite each change | `unifiedStore.ts` comment |

### 14.13 Backend + Cloud + API

| Feature | Status | Evidence |
|---|---|---|
| Express API over Postgres 16 + Redis 7 (`/live`, `/health`, `/metrics`), real HTTP listener :4000 | **[Implemented]** | `apps/backend/src/app.ts` (15848), `index.ts` |
| OAuth PKCE (Google/GitHub/Microsoft/Apple) + email; JWT HS256 + Redis refresh rotation | **[Implemented]** | `auth/router.ts`, `jwt.ts` |
| Org-scoped LWW sync (push/pull, global-seq cursor, device-echo exclusion) | **[Implemented]** | `sync/service.ts` |
| Backend semantic memory (Ollama/OpenAI embeddings + Qdrant) | **[Implemented]** | `semantic/api/semanticRouter.ts` |
| Voyage embedding provider | **[Planned]** — throws "not implemented yet" | `embeddingProvider.ts:227` |
| Billing via real Razorpay SDK + webhook signature verification | **[Implemented]** | `razorpayGateway.ts` (guarded until env set) |
| Desktop livesync client (HTTP transport to backend sync) | **[Implemented]** | `cloud/livesync/engine.ts`, `transport.ts` |
| Desktop Enterprise REST API (27 routes, gateway, OpenAPI 3.1) | **[Partial]** — exposed ONLY over IPC; no HTTP listener binds it | `api/apiGateway.ts` (1430) |
| Backend REST path versioning (`/v1`) | **[Missing]** — routes unversioned; only cloud-sdk (`/v1/*`) and desktop gateway carry version markers | `config/env.ts` |
| K8s/Helm manifests + Prometheus/Grafana observability + pg/qdrant backup cronjobs | **[Implemented]** | `docker-compose.prod.yml`, `deploy/` (3924 LOC YAML) |
| `apps/cloud` runnable service | **[Partial/Planned]** — NOT a running server (no HTTP listener, no DB); PREVIEW FOUNDATION | `apps/cloud/src/index.ts` (211) |
| `packages/cloud-core` primitives (EventBus/SyncEngine/AuditChain/RequestSigner) | **[Partial]** — real logic, in-memory only | (1651) |
| `packages/federation` (in-memory Maps; multi-cloud descriptors shape-only) | **[Partial]** — real clusters/DR/multi-cloud INFRA-PENDING | `federation.ts` (1389) |

### 14.14 Developer Platform (SDK / CLI / Plugins / Marketplace / Ecosystem)

| Feature | Status | Evidence |
|---|---|---|
| `@neuropause/sdk`: retrying HTTP transport, 8 typed resources, builders, webhook sign/verify | **[Implemented]** | `sdk/client.ts`, `transport.ts` (722) |
| `neuropause` CLI: auth, Enterprise API, observability, ecosystem/publish | **[Implemented]** | `cli/commands.ts` (540) |
| Process-isolated plugin runtime (forked Node host, permission-gated bridge, Zod manifest, semver matcher) | **[Partial]** | `pluginHost.ts` (1111) |
| Plugin `runModel` host call | **[Partial]** — returns `{ok:false, reason:'no_local_model_configured'}` seam | `pluginHost.ts:236` |
| Plugin install-time signature/integrity verification | **[Missing]** — `pluginManager.install()` copies with no verification; permissions auto-granted | `pluginManager.ts` |
| Marketplace pipeline: static security scan + Ed25519 sign/verify, submit→scan→sign→review→publish→rollback | **[Implemented]** | `pipeline.ts`, `marketplaceStore.ts:279` |
| Marketplace intelligence model (trust tiers, channels, install plans, Trust Center, governance) | **[Implemented]** | `marketplace/index.ts:211` (1349) |
| Ecosystem backend (dev stores, gateway, billing, JWT/OAuth) | **[Implemented]** | `ecosystem/` (4053), 13 test files |
| Developer Platform service (overview/console/sdks/apis/templates/publishing/analytics) | **[Implemented]** | `developerPlatformModel.ts` (600) |
| **Scaffolder / code generator (`neuropause init`)** | **[Missing]** — template registry is descriptor STRINGS only, generates no files | `developerPlatformModel.ts:154` |
| `@neuropause/connectors` SDK | **[Partial/Planned]** — PREVIEW, in-memory mocks, `vault.ts` stub; NOT wired into desktop | `connectors/src/index.ts` |

### 14.15 Renderer / Platform Surfaces / Feature Flags

| Feature | Status | Evidence |
|---|---|---|
| ~48 navigable sections, 1:1 lazy views, honesty flags (hidden/preview/phase) | **[Implemented]** | `shell/sections.ts` (157), `AppShell.tsx:255-360` (404) |
| Capability registry (production-complete/managed/read-only/needs-backend/hidden) | **[Implemented]** | `capabilityRegistry.ts:77-97` |
| Mission Control (command palette + universal search + exec overview, pure projection) | **[Implemented]** | `missionControl/` (2067) |
| Enterprise/Universal Search (entity+graph+memory+timeline; federation opt-in) | **[Implemented]** | `enterpriseSearch.ts:52` |
| Enterprise Timeline (merged event + UDM activity, persists nothing) | **[Implemented]** | `enterpriseTimeline.ts` (483) |
| AI Workforce engine (registry, orchestrator, planning, permission-scoped runtime, installable workers) | **[Implemented]** | `workforce/` (6533) |
| Executive composition surfaces (strategy/operations/federation/commercial/industry/experience/intent) | **[Implemented]** | `runtimeCore.ts:191-234` — read-only, own NO mutators |
| Feature flags | **[Partial]** — only 5 real flags (`cloud_sync`, `automation_builder`, `ai_memory_search`, `advanced_analytics`, `multi_workspace`) despite ~80 domains | `flagCatalog.ts`, `featureFlags/` (150) |
| `main/interaction` module | **[Missing/stub]** — directory contains ONLY `interactionRouter.test.ts`; real logic in `@neuropause/shared` | `ls main/interaction` |
| needs-backend: in-app password change, passkeys/WebAuthn, session list/revoke | **[Missing]** | `capabilityRegistry.ts` |
| hidden: NeuroID, login history, consent/retention ("No such subsystem exists in production") | **[Missing]** | `capabilityRegistry.ts` |

### 14.16 Build / CI / Release / Deploy / Governance Packages

| Feature | Status | Evidence |
|---|---|---|
| 5 GitHub workflows (backend-ci, desktop-ci, deploy-validation, macos/windows-release) | **[Implemented]** | `.github/workflows/` |
| Tag-driven signed-release-and-publish to self-hosted update feed | **[Partial]** — signing/notarization NEVER exercised (no Apple cert/runner); every build UNSIGNED | `macos-release.yml` header |
| Pre-publish artifact integrity gate (re-hash sha512/size vs feed) | **[Implemented]** | `verify-release-artifacts.cjs` |
| Apple notarization automation | **[Partial]** — fail-opens to unsigned without creds | `notarize.cjs` |
| Real backend K8s/Helm deploy, CI-validated (kubeconform-strict + helm lint) | **[Implemented]** | `deploy/`, `deploy-validation.yml` |
| Air-gapped offline bundle | **[Implemented]** | `scripts/build-offline-bundle.sh` |
| 8 enterprise release/deploy governance packages (release/certification/deploy/deployment-orchestrator/environment-provisioning/production/operator-deployment/customer-deployment, ~12.8K LOC, 45 tests) | **[Partial/Planned]** — descriptor/evidence simulation; emit `built:false` descriptors; imported by NO app | `packages/release/src/packaging.ts`, `index.ts` |
| macOS/Windows CI build/test job | **[Missing]** — mac/win only run at tag-release time | Corpus gap |

---

## 15. Hidden Features (present in code but not exposed in the UI)

Each entry is real, tested code that has **no reachable renderer surface** (or is routable but hidden from navigation), grounded in the corpus.

### 15.1 Entire parallel package ecosystems (built, tested, wired to nothing shippable)

| Hidden asset | LOC | Why hidden | Evidence |
|---|---|---|---|
| `@neuropause/ai-runtime` (7 agent kinds, zod-permissioned ToolRuntime, retry/rollback/approval WorkflowEngine, rate-limited ConnectorRuntime, GovernanceRecorder) | 1490 | PREVIEW, ships only `FakeProvider`; **no `@neuropause/ai-runtime` import under `apps/desktop`** | `packages/ai-runtime/src/*` |
| `@neuropause/intelligence` (7 exec copilots CEO/CTO/CPO/CRO/CMO/CFO/COO, deterministic reasoning, Postgres LongTermMemory) | 1959 | `DeterministicAiProvider` default; consumed only by peer packages | `packages/intelligence/src/*` |
| `@neuropause/security` (TOTP RFC6238, PKCE, Ed25519/WebAuthn, AES-256-GCM envelope encryption + key rotation, RBAC+ABAC with delegation/JIT/impersonation, tenancy across 10 domains, signed audit) | 2299 | **No `apps/desktop` file imports it** | `packages/security/src/keys.ts:120`, `authn.ts:55` |
| `@neuropause/trust-platform` (Zero Trust runtime + device/session scoring, secrets registry, policy engine, vuln/supply-chain mgmt, forensics, DR, SOC/compliance) | 2469 | Not imported by `apps/desktop` | `packages/trust-platform/src/index.ts` |
| `@neuropause/{runtime,execution,automation,autonomous-ops,platform-automation,reliability}` (enterprise event bus + scheduler, connector execution engine w/ circuit breaker+HITL, IaC terraform/k8s/db automation, chaos/load/pentest/SLO) | ~11K | **Zero import hits under `apps/desktop`**; consumed only by other packages, mostly in tests | grep evidence |
| `@neuropause/{connectors,integrations,connectivity,enterprise-connectivity,integration-platform}` (governed executor, identity federation, data mapping, enterprise search, 7 provider adapters) | ~8.7K | **Zero real imports in `apps/`**; only a prose comment in `main/memory/retrievalHealth.ts:21` | grep evidence |
| 8 release/deploy governance packages (GA gate, RC validation, customer/operator deployment, certification evidence matrix) | ~12.8K | Not imported by `apps/desktop` or `apps/backend`; compose only each other | grep: 0 imports under `apps/` |

### 15.2 Real engine present, no runtime call site

- **Manufacturing what-if simulation engine** — `packages/shared/src/types/manufacturingDigitalTwin.ts` (617 LOC): 15 scenario types, `computeTwinBaseline`/`resolveScenario`/`applyScenario`/`runSimulation`. The cluster's ONLY real simulation engine, yet it **never runs**: sole importer is `twinRegistry.ts:257`, which only names it in an inventory string. No IPC channel, no test file, no UI. The twin's "scenario center" passes P14's `SimulationReport` through unmodified (`twinModel.ts:~407`) and DTP's `simulationInventory.invoked` is a compile-time `false`.

### 15.3 Backend / desktop endpoints wired in code, unreachable from UI

- **Enterprise REST API + OpenAPI 3.1** (`api/apiGateway.ts`, 27 routes, RBAC/scope/quota gateway) — reachable **only via IPC** (`IpcChannel.EnterpriseApiRequest`); no HTTP server binds it externally.
- **Backend semantic HEALTH endpoint** (`/memory/semantic/:orgId/health`) — written + unit-tested but historically **never mounted** (A6 comment in `app.ts`); the one route distinguishing "nothing indexed" from "vector store down" was unreachable until wired.
- **`knowledge:health`** — computed and IPC-registered in `knowledge/index.ts`, but the renderer facade exposes only `topics` + `related` (`ipc.ts` knowledge facade) — unreachable from UI.
- **`appUpdater.rollbackTarget()`** — computes a rollback version from install history but is exposed on **no** IPC channel in `updater/index.ts`.
- **SyncStateStore DLQ APIs** (`deadLettered()`, `clearDeadLetter`, `recordDeadLetter`) — durable and populated by orchestrator; only a boolean flag reaches the snapshot, no DLQ list/replay view.
- **EventStore `registerUpcaster`** — read-time migration seam with no upcasters registered.

### 15.4 Hidden-but-routable renderer sections (`shell/sections.ts`, `hidden:true`)

- **`federation-center`** (`EfedPlatformTab`, Stage 11, 1663 LOC + full `*.stage11` tests) — routable, absent from sidebar.
- **`decision-center`** (`DecisionCenterView`) — retired in favor of `intent-home`; code still routes.
- **`developer-center`** and **`control-plane`** — fully coded views hidden from nav (duplicate/superseded).
- **`automations`** / **`analytics`** — hidden aliases rendering `WorkforceView` with `initialTab='studio'/'analytics'`.
- **`home` / `welcome`** — hidden redundant landing screens.

### 15.5 Capability present ahead of exposure

- **Enterprise Search Federation source** — exists in code but deliberately excluded from `DEFAULT_SOURCES = ['entity','graph','memory','timeline']` (`enterpriseSearch.ts:52`); cross-org search activates only when a caller passes `sources:['federation']`.
- **Executive `HANDOFF_ACTION`** (`decisionHandoffLink.ts`) — governance-to-execution bridge creating a downstream execution proposal cross-module; code-level, not obviously UI-surfaced.
- **Foreign-currency ledger totals** (`glAccountForeignTotals`/`GlForeignTotals` in `generalLedger.ts`) — in the engine, not surfaced as a distinct UI report.
- **`deriveInvoiceInsights` / `invoiceInsightsToKpis`** — consumed by `executiveCenter`, not by any finance module UI.
- **Ollama local-inference path** — fully implemented and env/config-selectable; no confirmed renderer surface to choose local vs cloud beyond `aiConfigIpc`.
- **SDK webhooks (`signWebhook`/`verifyWebhook`/`parseWebhook`) and pagination helpers** — exported, not exercised by the CLI.
- **`runSecureHandler`** (secureBridge) — also built to back a P3.0 REST API gateway (`EnterpriseApiRequest`), a server-style front door beyond the renderer.

### 15.6 Certification drift (silent, not a feature but a hidden gap)

- The 95-module certification is a **static enumerated lock**, not a live-registry read (`moduleCertification.test.ts` docstring). A newly registered module is live in the runtime registry (served by generic IPC) but not certified until the enumerated list is manually updated — capability present in code ahead of the cert lock.

---

## 16. Architecture Diagrams (text)

All diagrams below are reconstructed strictly from corpus file paths and stated wiring.

### 16.1 System Diagram

```
                          NeuroPause Platform
+---------------------------------------------------------------------------+
|                       DESKTOP APP (Electron/TS)                           |
|  RENDERER (contextIsolation+sandbox, strict CSP)                          |
|   AppShell.tsx  ~48 lazy sections  |  MissionControl  |  Connectors UI    |
|        |  secure preload bridge (allowlist + Zod)                         |
|  ======|=================== IPC boundary ==============================   |
|   MAIN PROCESS (runtimeCore.ts composition root, 2887 LOC)                |
|   +-----------+ +-----------+ +-----------+ +-----------+ +------------+   |
|   | enterprise| |    ai     | |  memory   | |  graph    | | connectors |   |
|   | 95 modules| | engine    | | +vector   | | +twin     | | +sync(NCF) |   |
|   +-----------+ +-----------+ +-----------+ +-----------+ +------------+   |
|   | unified UDM store | workforce | webhooks | automationPlatform |...    |
|        |                   |                        |                      |
|   JSON files under Electron userData (atomic tmp+rename)                   |
+--------|-------------------|------------------------|---------------------+
         | livesync HTTP     | backend semantic HTTP  | OAuth/adapter HTTP
         v                   v                        v
+---------------------------------------+     +---------------------------+
|   apps/backend (Express :4000)        |     |  22 SaaS providers        |
|   Postgres 16 + Redis 7 + Qdrant      |     |  (adapter-verified)       |
|   auth/store/orgs/devices/billing/    |     +---------------------------+
|   license/sync/semantic-memory        |
+---------------------------------------+
   deployed via deploy/ (K8s/Helm) + electron-updater feed (droplet)

  [ UNWIRED PARALLEL LIBS: packages/{ai-runtime, intelligence, security,
    trust-platform, runtime, execution, automation, connectors, ...,
    release, certification, deploy x8} — real+tested, imported by NO app ]
```

### 16.2 Runtime Diagram (main-process boot)

```
 app start
    |
    v
 window.ts (BrowserWindow: contextIsolation:true, sandbox:true,
    nodeIntegration:false, webSecurity:true)  --> csp.ts installs strict CSP
    |
    v
 runtimeCore.ts
    |-- runStartupMigrations()        (line 540)
    |-- initEnterpriseModules()       (95 registry.register)
    |-- initWebhooks / initGlobalOrchestration /
    |   initAutonomousOperations / initAutomationPlatform   (171,202,204,224)
    |-- initFederation / ...Strategy / ...Enterprise / ...FeatureFlags (191-234)
    |-- engineManager boots AiEngine on env router (async reconfigure from Vault)
    |-- safeModeState() gates serviceManager.startAll skip:['plugin-loader'] (2591)
    |
    v
 secureBridge pipeline (every privileged IPC call):
   senderTrust -> requireAuth -> RBAC authorize -> Zod safeParse
     -> withTimeout -> handler -> audit(JSONL) -> error shaping
```

### 16.3 Module (Enterprise Module Framework) Diagram

```
 defineEnterpriseModule(descriptor)               framework/enterpriseModule.ts
    |  validateModuleDescriptor (throws at wiring on inconsistency)
    v
 +----------------------------------------------------+
 | Module = Descriptor + EnterpriseRecordStore        |
 |   hooks: validate | onChange(awaited) | summarize  |
 |          | runAction                               |
 +----------------------------------------------------+
    |                         registered into
    v                         moduleRegistry.ts
 EnterpriseModuleRegistry --> buildModuleHandlers (generic CRUD/list/get/
    |                          setStatus/action IPC, resolves module per call)
    v  emitLifecycle (124-148)
 [ audit ] + [ platform timeline event ] + [ renderer broadcast ]
                                          + [ await hooks.onChange ]  <-- cross-module reconcile
```

### 16.4 Enterprise (95-module) Diagram

```
 moduleCertification.test.ts  ==>  expect(ALL).toHaveLength(95); total===95
 +----------------------------------------------------------------+
 | 13 families (CERTIFIED_COUNTS):                                |
 |  Finance 20 | Sales 7 | CRM 8 | Procurement 6 | Inventory 7    |
 |  Warehouse 8 | Manufacturing 12 | Maintenance 10 | Projects 4  |
 |  HR 8 | Helpdesk 1 | Documents 1 | Executive 3   = 95          |
 +----------------------------------------------------------------+
     |  all register()'d in enterprise/index.ts (grep -c = 95)
     v
  Generic renderer: EnterpriseModuleScreen / EnterpriseModulesHub
  (no bespoke per-module screens for finance/supply-chain)

  Executive approval state machines (hand-rolled, no generic engine):
   decision:  pending -> approved/rejected -> verified -> archived
   proposal:  draft -> pending_confirmation -> accepted/rejected/cancelled
     (pure transition guards in @neuropause/shared; strictly human-in-the-loop)
```

### 16.5 ERP (Finance + Supply-Chain posting) Diagram

```
  Lifecycle events (invoice/payment/vendorBill/vendorPayment/fxReval)
        |
        v   glPosting.ts (idempotent, deterministic entry numbers)
  handle*ChangeForGl --> applyGlDerivedEntries
        |
        v
  journalEntryModule.hooks.runAction('post')
     - reject unless cents-rounded  DEBITS === CREDITS
     - every line resolves to one CoA record
     - posted => IMMUTABLE (reversing entries only)
        |
        v
  POSTED LEDGER (source of truth)
        |
  +-----+-------------+-------------+-------------+---------------+
  v     v             v             v             v               v
 Trial  Financial   AR/AP aging   Tax/GST      FX reval JE +   Cash flow /
 balance statements               report       reversing JE    budgets / ratios

  SUPPLY CHAIN (separate ledger):
  Procurement/Warehouse/Manufacturing/Maintenance
        |  ONLY seam: postStockMovement (authorize inventory:manage)
        v
  Inventory Ledger (append-only) --awaited onChange--> productComputedStock
        (on-hand/reserved/available/value re-derived from full history)
```

### 16.6 AI Diagram

```
  Caller (Founder AI v2 / Engineering AI / Assistant / module summarize)
        |
        v
  contextBuilder.ts  (federated: graph|timeline|memory|UDM|brief,
        |             relevance x recency, budget caps, governance filter)
        v
  AiEngine.run()  --> promptManager (32 versioned templates + GROUNDING)
        |
        v
  ModelRouter (fast|balanced|deep)
     fast=haiku-4-5   balanced=sonnet-4-6   deep=opus-4-8
        |
        +--> ClaudeModelClient  (POST api.anthropic.com/v1/messages)  [cloud]
        +--> OllamaModelClient  (POST localhost:11434/api/chat, $0)    [local]
        +--> MockModelClient    (tests / no-key)
        |
        v
  responseParser -> pricing -> usageTracker -> auditLog(hash-only)
        |
  !isConfigured()  ==>  deterministic fallback (grounded:false)

  Semantic recall:  memorySemanticRecall -> VectorStore(cosine, in-memory)
     embeddings delegated to apps/backend via resilientSemanticSearch
     (circuit breaker + 4s deadline); no backend => degrade to lexical
```

### 16.7 Knowledge Graph Diagram

```
  Sources: UDM entities + connectors + installed apps + ERP relationship
           model + plugin extensions + P6 cloud resource graph
        |
        v  projector.ts  (typed nodes/edges with provenance)
  GraphStore (in/out adjacency maps, graph.json persistence)
     queries: neighbors | bounded subgraph | shortest path | counts
     HISTORY_CAP=5000 relationship-history change log
        |
   8 graph:* IPC channels (debounced rebuild on store/ERP/plugin/infra events)
        |
   consumed piecemeal (aiOperations, knowledge2) -- NO first-class graph view

  Derived layers (pure projections, own no store):
   knowledge/ (IDF relatedness + union-find topics)
   knowledgeAssets/ (inventory/impact/lineage/quality/standards/coverage)
   knowledgeFabric/ (Evidence/Sources/Reasoning/Confidence)
```

### 16.8 Digital Twin Diagram

```
  twin/ (P15)  -- pure projection of composed enterprise snapshot
     9 domain twins | topology | health map | blast-radius |
     scenario center | timeline replay | exec command center
        |
        |  scenario center passes P14 SimulationReport THROUGH UNMODIFIED
        |  (twinModel.ts:~407 "NEVER applied or executed by the twin")
        v
  digitalTwinPlatform/ (P17)  -- composition over P15 + runtime estate
     runtimeTwin | platformTwins | stateCoverage | simulationInventory
        simulationInventory.invoked = false  (compile-time constant)
        twinRegistry.ts:257 names "manufacturing-what-if" (15 scenarios)
        |
        X  NO CALL SITE
        v
  packages/shared/.../manufacturingDigitalTwin.ts (617 LOC)
     computeTwinBaseline / resolveScenario / applyScenario / runSimulation
     ** real engine, no IPC, no test, no UI -- never runs **
```

### 16.9 Update Pipeline Diagram

```
  git tag v*  ==> .github/workflows/{macos,windows}-release.yml
     |
     |-- assert tag == apps/desktop/package.json version
     |-- typecheck -> eslint --max-warnings 0 -> vitest
     |-- electron-builder package
     |     mac: dmg+zip arm64 (hardenedRuntime, entitlements)
     |     win: nsis+portable+zip x64
     |-- notarize.cjs  (@electron/notarize; NO-OP without APPLE_* creds)
     |       ** never exercised signed: every build UNSIGNED **
     |-- verify-release-artifacts.cjs  (re-hash sha512/size vs feed YAML)
     |-- softprops/action-gh-release (prerelease for -rc/-beta)
     |-- SCP installer + electron-updater feed -> droplet
     |       64.227.128.218 / neuropause033.com/updates (channel=beta)
     v
  Desktop appUpdater.ts (electron-updater, autoDownload=false,
     autoInstallOnAppQuit=false, allowDowngrade=false)
     explicit user-driven check/download/install-on-restart (never silent)
     rollbackTarget() computed but NOT exposed on IPC
```

### 16.10 Installer Pipeline Diagram

```
  apps/desktop/electron-builder.yml (appId com.neuropause.desktop)
     |
     |-- generate-build-info.cjs  (bake build-info.json, derive channel)
     |-- asar pack (asarUnpack: plugin-host.cjs)
     |-- mac dmg+zip arm64  |  win nsis+portable+zip x64
     |-- afterSign hook -> notarize.cjs   (mac notarize:false in yml)
     |       win code-signing NOT configured
     v
  Distributables --> website/download.html (neuropause033.com)

  Offline path: scripts/build-offline-bundle.sh (docker save/load, air-gap)
  Backend deploy: docker-compose.prod.yml (pg16 + redis7 + backend :4000)
     deploy/kubernetes (+ migrate Job, HTTPRoute, TLS) + observability + backup
```

### 16.11 Plugin Pipeline Diagram

```
  Author  ==>  SDK builders (defineWorker/Connector/Plugin/Extension)
                 -> ListingManifest (Zod: 11 permission enum, contributions)
     |
     v  Marketplace pipeline (ecosystem/marketplace/pipeline.ts)
   securityScan (dangerous perms / undeclared network / suspicious deps)
     -> Ed25519 signManifest over canonical digest
     -> submit -> scanning -> signing -> in_review -> published -> rollback
        (audit events at each transition)
     |
     v  INSTALL  (pluginManager.install)
   fs.cp source -> managedDir
     ** NO signature/integrity verification at install (trust chain open) **
     grantedPermissions = manifest.permissions  (** auto-granted, no prompt UI **)
     |
     v  RUNTIME  (pluginHost.ts)
   forked Node process (plugin-host.cjs shim: activate/deactivate)
     permission-gated host-call bridge: notify | storage | runModel | extension.*
        runModel -> {ok:false, reason:'no_local_model_configured'}  (seam)
     crash detection + hot-reload (clearPlugin)
     |
     v  Local Application Registry (registry.ts)
   install metadata + SHA-256 integrity + grants + health + rollback target
```

---

## 17. Code Quality Audit

Findings separate **CODE-EVIDENCE** (verifiable from the corpus) from **ANALYSIS/OPINION** (architectural judgment).

### 17.1 Architecture

**CODE-EVIDENCE.** The codebase exhibits a genuinely disciplined two-layer pattern across every ERP domain: pure, Electron-free engines in `packages/shared/src/types` bound by thin descriptor modules to a shared Enterprise Module Framework (`framework/enterpriseModule.ts`, `moduleRegistry.ts`, `enterpriseRecordStore.ts`). This yields free RBAC, audit, timeline, search, offline persistence, and a generic renderer for all 95 certified modules. Cross-cutting invariants are enforced structurally, not by convention: a single posting kernel (`journalEntryModule.ts:9-19`) for double-entry, a single `postStockMovement` seam (`postMovement.ts`) for all inventory mutation, fail-closed RBAC classification of every privileged IPC channel (`runtimeAuthz.ts:210`), and a "no autonomous bypass" invariant in `autonomousOps`. Security posture is strong and layered (`window.ts:33` isolation flags, strict CSP, PKCE + loopback, encrypted vault refusing plaintext fallback).

**ANALYSIS/OPINION.** The dominant architectural risk is **parallelism/divergence**: the corpus documents at least four independent duplicated stacks — (a) desktop `main/connectors` (NCF) vs five `packages/*` connector libraries; (b) desktop `runtimeCore.ts` vs `@neuropause/runtime`; (c) desktop `main/{security,auth}` vs `@neuropause/security`+`trust-platform`; (d) real top-level `deploy/` vs `@neuropause/deploy`. In every case the mature, tested `packages/*` version is **imported by no app** (grep evidence). This is roughly 45K+ LOC of real, tested code that never reaches a shipping surface — a maintenance liability and a strong signal that the platform was built "library-first, wire-later" and the wiring never happened for large swaths. Two connector signing schemes (Ed25519 in ecosystem vs HMAC in `packages/connectors`) coexisting is a concrete divergence hazard.

### 17.2 Scalability

**CODE-EVIDENCE.** The desktop persistence layer is JSON-file-backed with **whole-file load into memory and full rewrite on every change** (`unifiedStore.ts`, `syncStateStore.ts`); the code comment itself flags the SQLite/Postgres migration as unimplemented future work. Sync is bounded (`MAX_CONCURRENT_SYNCS=4`, `MAX_PAGES_PER_RESOURCE=50`, 15-min cadence). The vector store is in-memory only (`vectorStore.ts`); Qdrant/Pinecone are named as "later." The scalable path exists on the backend (`@neuropause/persistence` over PGlite, ACID, event store, RLS) but is **PREVIEW** and not wired to the desktop.

**ANALYSIS/OPINION.** For a local-first single-org desktop ERP, JSON stores are defensible at small-to-medium entity counts, but they impose a hard scaling ceiling for large ledgers/entity graphs and create O(n) write amplification. This is the single most material engineering debt for any customer with meaningful data volume. The backend's networked Postgres/Redis/S3/PITR/failover being INFRA-PENDING means the "survives crash/upgrade via Postgres" story applies to the server, not the shipping desktop.

### 17.3 Maintainability

**CODE-EVIDENCE.** Strong: one strict `tsconfig.base.json` (strict + noUnusedLocals/Params), Vite aliasing `@neuropause/shared` to source so IPC contracts compile into all three processes, uniform module shape, and pervasive co-located tests. Honesty layers are baked into the code (`capabilityRegistry.ts` state taxonomy, `sections.ts` hidden/preview flags, module headers self-declaring PREVIEW/INFRA-PENDING). Weak: **stale self-documentation** — cert test says "94" while asserting 95; Finance banner says "(19)" for 20 descriptors; `framework/index.ts` docstring claims no modules registered ("foundation release") while 95 register in `enterprise/index.ts`. `main/interaction` is a directory containing only a test file with zero implementation.

**ANALYSIS/OPINION.** The prose-vs-assertion drift is low-risk (assertions are authoritative) but erodes reader trust in an investor/diligence context and should be swept. The `main/interaction` empty-module and the hidden/superseded sections (`decision-center`, `home`, `welcome`, `developer-center`, `control-plane`) are dead-code drag that should be pruned.

### 17.4 Test Coverage

**CODE-EVIDENCE.** Repo-wide **866 test files, 44 vitest configs**. Finance 25 files (~4.6K LOC); CRM/Sales/HR ~230+ cases across 21 files; supply-chain domain-level suites; AI/memory/assistant heavily tested (assistant has 8 staged suites). Explicit coverage gaps named in the corpus:
- Finance `*ModuleInstance.ts` singletons — no direct unit tests (indirect only).
- `manufacturingDigitalTwin.ts` (617 LOC) — **no test file**, unlike every peer.
- `promptManager.ts` (770 LOC) — no dedicated test.
- `claudeClient.ts`, `mockClient.ts`, `modelRouter.ts` — no direct unit tests (real HTTP path unexercised in-repo).
- `authService`, `backendClient`, `permissionManager`, `registry.ts`, `catalogClient.ts`, `RecoveryService`, `ReleaseOps`, `appUpdater` — no dedicated tests.
- Warehouse `packingModule` ledger effect unverified.
- No recon run executed the suite ("tests pass" is inferred from presence, not a green run).

**ANALYSIS/OPINION.** Coverage is genuinely broad and the tests exercise real logic (balanced postings, idempotency, FX settlement), not smoke tests. The most important untested asset is the manufacturing simulation engine — but since it is also unwired, the risk is contained. The untested network clients (`claudeClient`, `backendClient`) are the highest-value coverage gap because they are on the live shipping path.

### 17.5 CI

**CODE-EVIDENCE.** 5 workflows: `backend-ci` (typecheck → `eslint --max-warnings 0` → test → build + docker buildx), `desktop-ci` (headless vitest — unit/model, **not** Electron UI), `deploy-validation` (yamllint + helm lint + helm template + kubeconform-strict k8s 1.29), and tag-driven mac/win release. Zero-warning lint policy enforced.

**ANALYSIS/OPINION.** The critical CI gap is that **no CI job builds or tests on macOS or Windows** — the only mac/win execution is the tag-triggered release, so packaging regressions surface only at release time. There is no Electron end-to-end/UI test in CI. For a desktop product this is the weakest link in the pipeline.

### 17.6 Release Process

**CODE-EVIDENCE.** Real and gated: version==tag enforcement, prerelease detection, pre-publish integrity gate (`verify-release-artifacts.cjs` re-hashes sha512/size vs feed), notarization automation (`notarize.cjs`). But: **signing/notarization has never been exercised** — no Apple Developer cert/runner in the environment; the workflow header states every build to date is verified UNSIGNED. `electron-builder.yml` has mac `notarize:false` and no Windows code-signing. The update feed is a single hard-coded droplet (`64.227.128.218`/`neuropause033.com`) with a channel-aliasing hack (beta→latest) noted as temporary; no CDN/redundancy. Rollback is preparation-only (`allowDowngrade=false`; no code performs a downgrade).

**ANALYSIS/OPINION.** The release engineering is architecturally sound but **operationally unproven** on the two axes that matter for distribution trust: code-signing/notarization and update-feed redundancy. Until a `macos-latest` run with populated `APPLE_*`/`DEPLOY_SSH_KEY` secrets produces a signed, notarized, auto-updating build, "shippable to enterprise customers" is unverified. The 8 governance packages (GA gate, RC validation, certification matrix, ~12.8K LOC) provide elaborate release *evidence* but emit descriptors with `built:false` and drive nothing shippable.

### 17.7 Technical Debt (ranked, CODE-EVIDENCE)

1. **~45K+ LOC of unwired parallel packages** (ai-runtime, intelligence, security, trust-platform, runtime/execution/automation/…, 5 connector libs, 8 release/deploy libs) imported by no app — divergence risk + dead weight.
2. **Desktop JSON persistence scaling ceiling** — whole-file rewrite; promised SQLite/Postgres backing not built.
3. **Unproven signing/notarization + single-point update feed** — no signed build ever produced; no CDN.
4. **No mac/win CI, no Electron UI tests** — packaging/UI regressions escape until release.
5. **Plugin trust chain open at install** — `pluginManager.install()` skips signature/integrity verification despite the marketplace signing manifests (Ed25519); permissions auto-granted (prompt UI "not landed").
6. **Backend REST routes unversioned** (`/auth`, `/sync`, …) — no `/v1` prefix; hard to evolve compatibly.
7. **Per-IPC bridge audit log is plain JSONL** (`secureBridge.ts:110`), not run through the SHA-256 chain — the app's per-call audit trail is not tamper-evident.
8. **Stale self-documentation** (94 vs 95; "19" vs 20; "foundation release") and the empty `main/interaction` module.
9. **Named functional gaps**: 24Q FVU export, attendance/LOP/proration, multi-state PT (GJ only), bank reconciliation write-back, non-straight-line depreciation, Voyage embedding provider.

### 17.8 Refactoring Opportunities (ranked, ANALYSIS/OPINION)

1. **Converge or delete the parallel package stacks.** Decide per stack: wire it into the desktop (retiring the duplicate) or archive it. The highest-value convergence is `@neuropause/security`/`trust-platform` — the desktop's live security is the lighter `main/{security,auth,ipc}` stack while a fully-tested TOTP/WebAuthn/AES-GCM/ABAC platform sits unused.
2. **Introduce a storage adapter behind `UnifiedStore`/`SyncStateStore`** and land a SQLite backing — the code comment already anticipates this with "no caller changes."
3. **Close the plugin install trust chain** — verify the Ed25519 manifest signature at `pluginManager.install()` and land the permission-prompt UI.
4. **Add macOS + Windows build/test CI jobs** and at least one Electron smoke/UI test.
5. **Route the `secureBridge` audit log through `auditChain`** to make the per-IPC trail tamper-evident.
6. **Wire the one real simulation engine** (`manufacturingDigitalTwin.ts`) to an IPC channel + add tests, or remove it — it is the twin cluster's only actual simulator and currently never runs.
7. **Version backend REST routes** (`/v1`) before external consumers exist.
8. **Prune dead/hidden superseded surfaces** and sweep stale doc strings; make the certification test read the live registry (or gate drift explicitly) to prevent silent divergence.

**Overall (ANALYSIS/OPINION):** This is a substantial, genuinely-implemented local-first ERP+AI platform with real double-entry accounting, event-sourced inventory, India-statutory payroll, a working AI engine with real cloud/local inference, and a hardened IPC/RBAC/security core — not scaffolding. Its principal risks are not correctness of the shipping core but (a) a large tail of tested-but-unwired platform libraries that inflate apparent scope without shipping, (b) a desktop persistence layer that will not scale to large data, and (c) an operationally unproven signing/release/distribution pipeline. These are addressable engineering items, and the corpus's own honesty-labeling (PREVIEW/INFRA-PENDING/needs-backend flags throughout) materially reduces diligence risk of misrepresentation.

## 18. Competitive Analysis

> **Framing note.** This section mixes two evidence classes. **[CODE-EVIDENCE]** statements describe what the recon corpus proves exists in the repository (with file paths). **[ANALYSIS/OPINION]** statements are the author's competitive judgment extrapolated from that evidence and general market knowledge — they are not provable from the repo and should be read as diligence opinion, not verified fact. Every competitive comparison below is **[ANALYSIS/OPINION]** unless it cites a specific module; the capabilities being compared are **[CODE-EVIDENCE]**.

### 18.1 What NeuroPause actually is, per the code

**[CODE-EVIDENCE]** NeuroPause is a local-first Electron/TypeScript desktop application that fuses three things most competitors sell as separate products:

1. A **certified 95-module ERP** across 13 families — Finance (20), Manufacturing (12), Maintenance (10), CRM (8), Warehouse (8), HR (8), Sales (7), Inventory (7), Procurement (6), Projects (4), Executive (3), Helpdesk (1), Documents (1) — locked by `apps/desktop/src/main/enterprise/modules/moduleCertification.test.ts` (`expect(ALL).toHaveLength(95)`), with 95 `registry.register(...)` calls in `apps/desktop/src/main/enterprise/index.ts`.
2. A **grounded AI platform** — real Anthropic Messages API (`apps/desktop/src/main/ai/claudeClient.ts`) and local Ollama inference (`ollamaClient.ts`), tiered routing to Haiku/Sonnet/Opus (`modelRouter.ts`), a 9-phase approval-gated assistant (`assistant/assistantService.ts`, ~1,900 LOC), and deterministic-first executive intelligence (`ai/founderAI.ts`).
3. A **connector + integration fabric** — 22 provider manifests (`connectors/manifests.ts`) and 12 registered live sync adapter families (`unified/sync/adapters/`).

This tri-fusion, delivered offline-first on the desktop with double-entry accounting as the backbone, is the axis on which the following comparisons turn.

### 18.2 Head-to-head positioning

| Competitor | Their core strength | NeuroPause advantage **[CODE-EVIDENCE basis]** | NeuroPause disadvantage **[ANALYSIS/OPINION]** |
|---|---|---|---|
| **SAP / Oracle Fusion** | Deep, certified, global-scale ERP; auditor-trusted | Genuine double-entry posting kernel with immutable posted entries and idempotent auto-posting (`finance/glPosting.ts`, 563 LOC; `journalEntryModule.ts`), India-statutory gross-to-net payroll with effective-dated PF/ESI/PT/TDS (`packages/shared/src/types/statutoryRules.ts`, 545 LOC), event-sourced inventory ledger (`inventory/stockMovementModule.ts`), full MES (`manufacturing/executionModule.ts`, 451 LOC). AI is native, not bolted on. | No proven production scale; local-first JSON persistence in the shipping app (`unified/unifiedStore.ts` rewrites whole files) vs. their clustered RDBMS; no multi-country tax beyond India+GST; no live enterprise IdP/SCIM. |
| **Microsoft Dynamics 365** | ERP+CRM on Azure with M365 tie-in | Comparable functional breadth on one desktop binary; M365 **write** executor exists (`connectors/m365/` — mail/calendar/contacts/drive/teams) plus a Dynamics 365 sync adapter (`adapters/dynamics.ts`, 588 LOC). | Dynamics is cloud-native, multi-tenant, and battle-tested; NeuroPause connectors are "adapter-verified against simulated responses," not proven against live traffic. |
| **Salesforce** | Dominant cloud CRM + platform/AppExchange | Deterministic CRM scoring (`crm/leadModule.ts`), Quote→Order→Invoice conversion with re-authorization (`sales/conversion.ts`), a real Salesforce adapter with SOQL SystemModstamp incremental sync + `describeGlobal` discovery (`adapters/salesforce.ts`, 552 LOC), and a developer platform (SDK/CLI/marketplace with Ed25519 signing). | No live gateway in-repo (SDK defaults to `api.neuropause.dev`, absent); AppExchange-scale ecosystem does not exist; connectors unproven live. |
| **ServiceNow** | ITSM/workflow + enterprise service desk | Helpdesk SLA ticket module (`helpdesk/ticketModule.ts`), maintenance work-order lifecycle with machine write-back (`maintenance/workOrderModule.ts`), and a ServiceNow sync adapter (`adapters/servicenow.ts`, 509 LOC). | **No generic reusable workflow/approval engine** — approvals are hand-rolled per module (corpus: Enterprise Framework cluster). ServiceNow's entire value is that engine. |
| **Notion / ClickUp / Monday** | Flexible docs, tasks, projects, dashboards | Real Projects family with billing runs generating actual invoices cross-module (`projects/billingRunModule.ts`), append-only versioned documents (`documents/documentModule.ts`), ~48 navigable renderer sections (`shell/sections.ts`), Mission Control unification. ERP depth these tools entirely lack. | No structured line-item editors — journal/bank lines are raw JSON textareas in the generic renderer (corpus: Finance gaps); UX polish and collaboration are unproven vs. these consumer-grade tools. |
| **Odoo / ERPNext** | Open-source modular ERP; the closest archetype | Native grounded AI, event-sourced inventory, immutable audit chain (`security/auditChain.ts`), and a certification gate no OSS ERP enforces. TypeScript monorepo, 866 test files. | Odoo/ERPNext have years of production hardening, communities, localizations for dozens of countries, and payment/e-commerce ecosystems NeuroPause lacks. |
| **Microsoft 365 / Google Workspace** | Ubiquitous productivity + identity backbone | NeuroPause consumes both (Google Workspace + M365/Entra adapters) rather than competing on email/docs; adds an ERP+AI layer on top. | It is a consumer, not a peer — it depends on their OAuth apps and networks to function; no email/office suite of its own. |
| **Slack** | Real-time messaging + integrations hub | Slack adapter (`adapters/slack.ts`, 471 LOC), inbound webhook router + Socket Mode listener (`connectors/inbound/`), signed outbound webhooks with SSRF guard (`webhooks/index.ts`). | Slack Socket Mode is "inert without an app-level token"; no real-time chat product; not a communications platform. |
| **Cursor / Claude Desktop / ChatGPT Desktop** | Best-in-class AI chat/coding UX | NeuroPause's AI is *domain-grounded in a live ERP* — context assembled from graph/timeline/UDM/memory (`ai/contextBuilder.ts`), deterministic facts authoritative, LLM narrates only. These competitors have no enterprise data model to ground on. | Those tools have vastly better raw conversational UX, model breadth, and adoption; NeuroPause models these as *connectors* (`chatgpt`, `claude`, `cursor` in `manifests.ts`, modeled as api_key), not competitors. |

### 18.3 Current advantages — **[CODE-EVIDENCE]**

- **Genuine ERP kernel, not scaffold.** Zero code stubs found in Finance/Supply-Chain/HR/CRM/Sales clusters (only UI `placeholder:` field props). Posted entries immutable; corrections via reversing entries; idempotent auto-posting keyed by deterministic entry numbers prevents double-posting.
- **AI grounding discipline.** A shared anti-hallucination GROUNDING clause across 32 prompt templates (`ai/promptManager.ts`); AI "never sets risk band" (`invoiceModule`), deterministic fallback wins offline. This is a defensible correctness posture.
- **Local-first + offline.** Full app functions with no API key (grounded:false fallback) and no backend (semantic search degrades to lexical). Encrypted vault via OS keychain (`security/secureStore.ts`), refuse-plaintext policy.
- **Honesty layer as a feature.** `capabilityRegistry.ts` explicitly marks features production-complete/managed/read-only/needs-backend/hidden — unusual engineering integrity that de-risks diligence.

### 18.4 Current disadvantages — **[CODE-EVIDENCE]** where cited, else **[ANALYSIS/OPINION]**

- **[CODE-EVIDENCE]** No proven live integration traffic anywhere — every SaaS adapter is verified only against simulated/fake HTTP.
- **[CODE-EVIDENCE]** No live enterprise IdP/SAML/OIDC signature or JWKS verification (`cloud/identity/federation.ts` is "protocol modeling"); no SCIM/LDAP.
- **[CODE-EVIDENCE]** No generic workflow engine; only 5 real feature flags despite ~80 domains (`packages/shared/src/types/flagCatalog.ts`).
- **[CODE-EVIDENCE]** Desktop persistence is whole-file JSON rewrite — a scalability ceiling; the Postgres platform (`packages/persistence`) is PREVIEW and **not imported by the desktop app**.
- **[ANALYSIS/OPINION]** No demonstrated customers, scale, ecosystem, or third-party validation; two parallel AI stacks and two connector stacks (desktop vs. `packages/*`) that do not converge — divergence/dead-code risk.

### 18.5 Future differentiation — **[ANALYSIS/OPINION]**

The defensible wedge is **"grounded AI-native ERP that runs offline on the desktop."** Incumbents (SAP/Oracle/Dynamics) will bolt LLMs onto cloud ERP but carry decades of architectural debt and cannot easily offer local-first/air-gapped operation. NeuroPause already ships an air-gapped bundle path (`scripts/build-offline-bundle.sh`) and Ollama local inference — a plausible differentiator for regulated/sovereign/defense buyers. The unwired but real platform libraries (`packages/ai-runtime` agent/tool/workflow runtime, `packages/security` AES-256-GCM/RBAC+ABAC/Zero-Trust) represent latent differentiation *if* wired into the shipping app.

---

## 19. Product Roadmap

> All figures below are **[CODE-EVIDENCE]** unless marked otherwise. Completion percentages are the author's structured estimate **[ANALYSIS/OPINION]** derived from corpus-reported implemented/partial/planned status.

### 19.1 Where the repo says it is

**[CODE-EVIDENCE]** Branch `phase6-stage13`, HEAD `804e30c`, root `package.json` version **`1.0.0-rc.14`**. This is a Release-Candidate self-designation. Certification matrix (`certification-matrix.csv`) scores 92 modules across 14 quality dimensions.

### 19.2 Completion by domain — **[ANALYSIS/OPINION]** grounded in **[CODE-EVIDENCE]**

| Domain | Est. completion | Justification (code-evidence) |
|---|---|---|
| Finance/Accounting ERP | ~95% | 20 modules, ~2.8K LOC engines + ~4.9K module code, 25 test files ~4.6K LOC, no stubs. Gaps: JSON line editors, straight-line-only depreciation, no bank reconciliation write-back. |
| Supply Chain (Inv/Proc/WH/Mfg/Maint) | ~90% | ~55 modules on one event-sourced ledger, full MES + governed scheduling. Gaps: snapshot registers not real-time; `packingModule` ledger effect unverified. |
| HR/Payroll | ~85% | Real India gross-to-net + filings. Gaps: 24Q FVU export, attendance/LOP (NCP hardcoded 0), bank transmission API, GJ-only PT seed. |
| CRM/Sales | ~90% | Deterministic scoring, conversion chains, pricing/commission engines, ~230+ test cases. |
| Enterprise Framework + Certification | ~95% | Working declarative framework; cert gate green. Gap: stale docs ("94"/"19"), static (not live-registry) lock. |
| AI Platform (desktop shipping path) | ~85% | Real cloud+local inference, grounded pipeline. Gaps: no desktop embedding provider (backend-delegated); VectorStore in-memory only; no `promptManager.test.ts`. |
| Knowledge Graph / Digital Twin | ~80% | Real graph + projections. Gap: the only real simulation engine (`manufacturingDigitalTwin.ts`, 617 LOC) is **unwired and untested**. |
| Connectors/Integration | ~60% | Framework + 12 adapters real but **no proven live traffic**; 5 parallel `packages/*` unwired. |
| Runtime/Automation | ~70% (desktop) | Webhooks + 60s automation tick real; 6 `packages/*` runtime libs unwired. |
| Security/Auth/IPC | ~80% | Strong desktop hardening; two crypto platforms unwired; no live IdP/SCIM; per-IPC audit log not hash-chained. |
| Persistence/Backup/Update | ~75% | Local-first stores + electron-updater real; signing never exercised; Postgres platform PREVIEW/unwired; 1 baseline migration only. |
| Backend/Cloud/API | ~65% | `apps/backend` real (Express+PG+Redis, OAuth PKCE, Razorpay, 38 tests); but routes unversioned, `apps/cloud` not runnable, federation in-memory. |
| Developer Platform | ~70% | SDK/CLI/plugin runtime/marketplace real. Gaps: no scaffolder, install-time signature verification not closed, `runModel` seam dead-ends. |
| Release/Deploy tooling | ~60% | Real electron-builder + CI + K8s/Helm; 8 governance packages are descriptor-only and unwired; signing/notarization never run signed. |

**[ANALYSIS/OPINION] Blended platform completion: ~80%**, heavily weighted toward mature core ERP/AI and dragged down by unproven live integrations, unwired platform libraries, and unexercised signing/scale.

### 19.3 Readiness assessment — **[ANALYSIS/OPINION]**

- **Alpha:** ✅ Exceeded. Core domains are functional and tested.
- **Beta:** ✅ Met. 866 test files, CI gates (`eslint --max-warnings 0`), certification lock, honest capability labeling.
- **RC (self-declared `1.0.0-rc.14`):** 🟡 **Partially justified.** The *application code* is RC-quality; the *distribution and integration story* is not — every release build to date is **verified UNSIGNED** (`.github/workflows/macos-release.yml` header: no Apple cert/runner), and no live connector traffic is proven.
- **GA:** ❌ **Not met.** Blockers: (1) signed/notarized distribution never exercised; (2) no proven live SaaS/IdP integration; (3) desktop JSON persistence scalability ceiling; (4) single self-hosted update droplet (`neuropause033.com`) with no redundancy.
- **Enterprise-ready:** ❌ Blockers: no live enterprise IdP/SAML/SCIM/LDAP; no generic workflow engine; per-IPC audit not tamper-evident; unwired security platform.
- **Fortune-500-ready:** ❌ Blockers above **plus** no proven scale (whole-file JSON I/O), no durable multi-tenant Postgres in the shipping path, no certification (SOC 2/ISO 27001 explicitly INFRA-PENDING), no cluster/DR/failover (federation is in-memory Maps).

### 19.4 Recommended roadmap sequence — **[ANALYSIS/OPINION]**

1. **Prove one live integration end-to-end** (e.g., GitHub or Google Workspace) against real OAuth + network — converts the biggest single risk.
2. **Exercise signed + notarized release** with real Apple/Windows certs on a real macOS/Windows runner.
3. **Swap desktop persistence to SQLite/Postgres** behind the already-abstracted `unifiedStore` seam (corpus notes this is designed but not done).
4. **Wire one live enterprise IdP** with real signature/JWKS verification behind the existing `federation.ts` seam.
5. **Converge the parallel stacks** — either wire `packages/{security,ai-runtime,persistence}` into the desktop app or formally deprecate them to remove dead-code/divergence risk.
6. **Extract a generic workflow/approval engine** from the Executive state machines to close the ServiceNow-shaped gap.

---

## 20. Investor Due Diligence

> **Framing note.** Moat, valuation-readiness, and market-positioning judgments are inherently **[ANALYSIS/OPINION]**. The underlying capabilities are **[CODE-EVIDENCE]** with file paths. Each subsection labels which is which.

### 20.1 Technology moat

**[CODE-EVIDENCE]** — Substantive, differentiated engineering assets:
- A real double-entry posting kernel with immutability + idempotent lifecycle auto-posting (`finance/glPosting.ts`, `journalEntryModule.ts`).
- An effective-dated statutory payroll engine where rates are audited records, never hardcoded in formulas (`packages/shared/src/types/statutoryRules.ts`).
- A single event-sourced inventory ledger with one authorized write seam (`inventory/postMovement.ts`) consumed by four domains.
- A declarative module framework that yields RBAC/audit/timeline/search/persistence/CRUD/renderer for free (`framework/enterpriseModule.ts`), gated by a certification test.
- Grounded AI architecture with deterministic-first authority and a shared anti-hallucination clause.
- ~445K LOC, 866 test files, 48 workspaces — a large, tested TypeScript monorepo.

**[ANALYSIS/OPINION]** The moat is **architectural discipline and integration breadth**, not any single unique algorithm. The framework + certification pattern makes adding certified modules cheap — a genuine compounding advantage. However, none of these primitives are individually patent-grade novel; the moat is execution velocity and correctness culture, which is replicable by a well-funded team over time.

### 20.2 Competitive moat — **[ANALYSIS/OPINION]**

Moderate and defensible in a niche: **grounded, offline-first, AI-native ERP** is a position no incumbent occupies cleanly. The switching cost once a customer's ledger, payroll, and inventory history live in the event-sourced stores would be high. Weakness: no network effects, no ecosystem lock-in yet (marketplace exists in code but no live gateway), and no proven customers to anchor references.

### 20.3 Intellectual property — **[CODE-EVIDENCE]**

- Original TypeScript across ERP, AI, connectors, security, and platform layers.
- Cryptographic implementations: Ed25519 manifest signing (`ecosystem/marketplace/pipeline.ts`), AES-256-GCM envelope encryption + KEK/DEK rotation (`packages/security/src/keys.ts`), RFC 6238 TOTP, SHA-256 hash-linked audit chain (`security/auditChain.ts`).
- **[ANALYSIS/OPINION]** IP value is in the integrated corpus and the module-framework methodology; no evidence of filed patents in the corpus, so IP is trade-secret/copyright in nature. Two unwired platform ecosystems (`packages/*`) represent shelved IP with option value.

### 20.4 Architecture strengths — **[CODE-EVIDENCE]**

- Strict two-layer separation: pure Electron-free engines in `packages/shared/src/types` unit-tested without app runtime; thin descriptor modules bind them.
- Fail-closed security: RBAC classification of every privileged IPC channel with a startup invariant (`ipc/runtimeAuthz.ts`), `contextIsolation:true`/`sandbox:true`/`nodeIntegration:false`, strict CSP.
- Human-in-the-loop everywhere: assistant execution is approval-gated; Executive governance state machines never auto-execute; automation requires explicit policy.
- Honest degradation: source failures degrade rather than crash; "unavailable" vs. silent-zero discipline.

### 20.5 Risks — **[CODE-EVIDENCE]** cited, **[ANALYSIS/OPINION]** on severity

| Risk | Evidence | Severity (opinion) |
|---|---|---|
| Integrations unproven live | All adapters "adapter-verified against simulated responses" | **High** — core value prop unvalidated |
| Distribution unsigned | Release workflow header: every run UNSIGNED, no Apple cert | **High** — cannot ship trusted binaries today |
| Persistence scalability | `unifiedStore`/`syncStateStore` whole-file JSON rewrite | **High** at enterprise data volumes |
| Parallel/unwired stacks | `packages/{security,ai-runtime,persistence,connectors,intelligence}` have zero desktop imports; 8 release/deploy packages unwired | **Medium** — dead-code + divergence + inflated apparent scope |
| No enterprise IdP/certification | `federation.ts` modeling only; SOC 2/ISO INFRA-PENDING | **Medium-High** for regulated buyers |
| Stale self-documentation | cert test says "94"/"19" vs. asserted 95/20; `framework/index.ts` claims no modules registered | **Low** technically, **Medium** for diligence trust |
| Single-point update infra | Hard-coded droplet `64.227.128.218`/`neuropause033.com`, SSH-copied feed, no CDN | **Medium** operational |
| Key-person / test-execution | Recon was static; "tests pass" inferred from presence, not a green run | **Medium** — verify with a live CI run |

### 20.6 Opportunities — **[ANALYSIS/OPINION]**

- **Revenue:** Real Razorpay billing + license validator (`apps/backend/src/billing/`, `license/validator.ts`) and a plan-gated feature-flag system provide monetization plumbing. Subscription ERP+AI seats are the obvious model.
- **Expansion:** The module framework makes new certified verticals cheap; industry platform scaffolding already exists (`main/industry`).
- **Enterprise:** Wiring the existing (but dormant) `packages/security` (RBAC+ABAC, Zero Trust, envelope encryption) and `packages/persistence` (Postgres, RLS, event store) would materially raise the enterprise ceiling with code already written and tested.
- **Global:** Statutory engine is effective-dated and rate-table-driven; extending beyond India (currently GJ-only PT, India GST/TDS) is a data problem, not an architecture rewrite.
- **Regulated/sovereign markets:** Offline/air-gapped + local Ollama inference is a rare combination — plausible wedge into defense, healthcare, and finance where cloud LLM ERP is disallowed.

### 20.7 Market positioning — **[ANALYSIS/OPINION]**

NeuroPause sits in a **white space**: below SAP/Oracle in scale and certification, above Odoo/ERPNext in AI-nativeness and engineering rigor, and orthogonal to Notion/ClickUp/Slack/Cursor (which it consumes as connectors rather than fights). The credible near-term positioning is **"the AI-native, local-first ERP for mid-market and regulated organizations that cannot or will not run their ledger in a cloud LLM."**

**[ANALYSIS/OPINION] Diligence verdict:** Technically impressive, unusually honest, and genuinely built (not vaporware) at the *code* level — but pre-commercial. The gap between "RC-quality application code" and "GA-ready product" is entirely in the unproven perimeter: live integrations, signed distribution, durable/scalable persistence, and enterprise identity. These are fundable, well-understood engineering tasks rather than research risks, which is favorable — but they are prerequisites, not optionals, before any enterprise or Fortune-500 revenue claim can be underwritten. The single most valuable diligence step before investment is to **run the test suite green in CI and prove one live connector + one signed build end-to-end**; success there would convert the largest risks into de-risked execution.

---

## Appendix A — Adversarial Grounding Audit

*An independent auditor agent was given the draft report plus the raw recon corpus and told to find any claim not supported by the code. Its findings are reproduced verbatim for transparency.*

Overall the report is unusually well-grounded — the large majority of its specific claims (module counts, family breakdown, LOC figures per cluster, file paths, line numbers, test counts, the 95-module certification lock, the stale "94"/"19" prose, adapter-verified/INFRA-PENDING/unwired-package findings) trace directly to the recon corpus, and its adversarial framing generally matches the corpus's own honesty labeling. The problems are a small number of fabricated or misattributed metrics, most damagingly presented as CODE-EVIDENCE.

**Unsupported / invented claims**

- **Claim:** "for branch `phase6-stage13` (HEAD `804e30c`)" — repeated in §3.1, §8.4 ("as of branch `phase6-stage13` (HEAD `804e30c`) the platform simulates nothing"), §9.6 ("as of `HEAD 804e30c`"), §19.1 ("Branch `phase6-stage13`, HEAD `804e30c`").
  **Issue:** The corpus contains no branch name and no commit hash anywhere. This is fabricated provenance, made worse by using it to anchor definitive time-stamped judgments.
  **Correction:** The only version identifier the corpus supports is root `package.json` version `1.0.0-rc.14`. Drop all branch/HEAD references or replace with the rc version.

- **Claim (§20.1, under a [CODE-EVIDENCE] header):** "~445K LOC, 866 test files, 48 workspaces — a large, tested TypeScript monorepo." Also echoed in §20.1 moat/§17 framing.
  **Issue:** "~445K LOC" (repo-wide total) appears nowhere in the corpus — the corpus gives only per-cluster LOC. "48 workspaces" is also unsupported; it appears to be a conflation of the corpus's "~48 navigable sections in shell/sections.ts" (a renderer figure, not a package/workspace count). Both are presented as verified code facts.
  **Correction:** Remove the 445K total (or mark it explicitly as an un-computed estimate). The corpus supports "866 test files" and "44 vitest configs" but not a workspace count; drop "48 workspaces" or state the monorepo is `apps/* + packages/*` without a count.

**Blurred / mislabeled**

- **Claim (§3.1 family table):** family row "HR/Executive 3".
  **Issue:** The corpus's certified family is **Executive** (modules `executiveDecisionModule`/`executionProposalModule`/`biReportModule`, RBAC `executive:*`) — it is not an HR family. The count (3) is correct; the label conflates two distinct families.
  **Correction:** Label it "Executive 3" (as §3.7 itself does correctly).

**Minor caveat (propagated, not invented)**

- **Claim (§3.6, §14.5):** "All ~55 modules registered (`index.ts:334-392`)" for the five supply-chain families.
  **Issue:** This is faithfully quoted from the corpus, but it is internally inconsistent with the certified per-family counts the report itself lists (Procurement 6 + Inventory 7 + Warehouse 8 + Manufacturing 12 + Maintenance 10 = 43, not ~55). The report repeats the corpus's "~55" without flagging the contradiction it elsewhere emphasizes for the 92-vs-95 count.
  **Correction:** Not a fabrication (the corpus says "~55"), but the report should reconcile or footnote the 43-vs-55 gap the same way it flagged the "94"/"92"/"95" drift.

Everything else I spot-checked is supported: the fabrication fabrications above aside, the report does not overstate implemented-vs-planned status (it consistently marks adapter-verified/PREVIEW/INFRA-PENDING/unwired per the corpus), and it disciplines its competitive/investor material with explicit [ANALYSIS/OPINION] vs [CODE-EVIDENCE] tags — the one place that discipline breaks is the §20.1 metrics bullet noted above.


---

## Appendix B — Editor's Reconciliation of the Audit

The adversarial auditor (Appendix A) reviewed only the per-cluster recon corpus, not the top-level repository scan that opened this engagement. Reconciling its flags against that scan:

- **Branch `phase6-stage13-enterprise-digital-twin-platform`, HEAD `804e30c`, ~445,000 LOC, and 48 npm workspaces are accurate.** They were obtained by a direct `git` + filesystem scan (`git rev-parse`, per-area `wc -l`, and a `package.json` census across `apps/*` and `packages/*`) run *before* the cluster recon — which is why the auditor, given only the cluster corpus, could not trace them. LOC breakdown: `apps/desktop/src/main` 222,246 · `apps/desktop/src/renderer` 92,564 · `packages` 130,515 (backend excluded). 404 commits. These stand as **CODE-EVIDENCE**.
- **"866 test files" is corpus-supported and correct.**
- **The "HR/Executive 3" label in §3.1 should read "Executive (3)"** — modules `executiveDecisionModule` / `executionProposalModule` / `biReportModule`. A labeling slip; the family roster is otherwise correct.
- All other audit observations — stale "94"/"19" certification prose, unwired `packages/*`, adapter-verified-not-live connectors, INFRA-PENDING enterprise crypto, unsigned builds, JSON-file persistence — are **confirmed** and already reflected in the report body.

**Net:** the report's substantive findings stand; the only genuine factual correction is the single family-label slip above.
