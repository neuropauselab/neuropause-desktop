# SESSION 105 — FULL ENTERPRISE AI SUITE CENSUS, FULL-STACK AUDIT & ADVANCED-AI ARCHITECTURE STRATEGY

**Class:** DISCOVERY + ARCHITECTURE STRATEGY. **ZERO production change. NO build. NO release/notarize/sign/tag/publish.** Evidence = actual repo source read (not docs), three independent read-only census sweeps + prior-session ground truth. Frozen surfaces untouched; `certification/baseline.json` untouched; release-track files untouched (paused).

**The question this session answers:** *What is the complete AI system inside NeuroPause today, how far is it from a true enterprise agentic-AI platform, and what should we build next?* Plus the operator's added charge: *full-stack repo audit — what do the 10,300+ tests and the backend files actually show?*

**One-sentence verdict.** NeuroPause today is a **governed deterministic ERP control-plane with production-wired LLM plumbing bolted to its edge and a real governance kernel around exactly one consequential AI-adjacent capability (`mail.send`)** — the "brain" is real as a *drafting/advisory* surface and the *governance boundary* around it is the strongest part of the system, but the "agentic AI that decides and acts across the ERP" does not exist in the wired product yet; every consequential decision is made by deterministic TypeScript that a model is deliberately kept outside of. That is not a defect to hide — it is the **exact, honest platform to build the agentic layer on**, because the hard part (the governed execution boundary) is already done and proven.

---

## PART 1 — WHAT THE 10,300+ TESTS AND BACKEND FILES ACTUALLY SHOW (full-stack ground truth)

Before the AI census, the operator's full-stack question, answered bluntly from source.

### 1.1 The test corpus is real and load-bearing, but it certifies a *deterministic* system
- ~1,006 test files, ~10,498 passing tests in the desktop main suite (S104 baseline), +6–14 per certification session, always 7 skipped + 1 flaky environmental loopback (`auth/loopbackServer.test.ts`, a port-bind race, always 3/3 green in isolation).
- The overwhelming majority of these tests certify **deterministic governance**: RBAC gating, machine-owned status, economic-posting-inside-actions, tenant isolation, idempotency, crash/restart durability, and the composition-attack matrices (S98–S104). This is the strongest part of the codebase and it is genuinely enterprise-grade.
- **What the tests do NOT certify:** any trained model, any forecast, any anomaly detector, any live agent loop, any embedding/RAG retrieval quality bar. There is no ML eval harness because there is no ML. The AI provider layer has adapter/wire tests (`providerWireIntegration.test.ts`, `privateFirstRouting.test.ts`, `apiKeyLeakGuard.test.ts`) but they prove the *plumbing*, not model behavior.

### 1.2 The data architecture — the single most important full-stack fact
**ERP data lives in local flat JSON files on the user's machine, not in a database.** Every one of the 106+ enterprise modules persists through `EnterpriseRecordStore` → `DurableJsonStore` (atomic tmp+rename JSON under Electron `userData`). The store says so in its own header:
> *"This is 'the existing database' for the desktop main process … not SQL (the Postgres backend is a separate, gated service)."* — `apps/desktop/src/main/platform/persistence/durableJsonStore.ts:8-9`

This is a deliberate local-first architecture (S17). It is durable, serialized-per-store, crash-proven — but it is **single-user, single-machine, and not a queryable server database**.

### 1.3 The backend (`apps/backend`) is real — and scoped to account/sync, not ERP
Real Node/Express + Postgres (`pg`) + Redis (`ioredis`) + Razorpay + JWT. Live, tested routes: `/auth`, `/store`, `/organizations`, `/devices`, `/billing` (+webhook), `/license`, `/sync`, `/memory/semantic`. Desktop is genuinely wired to it (`config.ts` bakes `NEUROPAUSE_BACKEND_URL`, `backendReachabilityHub.ts` drives auth-restore on reconnect).
- `/sync` (S18) is the real server-side last-write-wins cross-device sync over Postgres, org/device-scoped. **A.**
- **The backend is NOT the ERP system of record.** It syncs the JSON-shaped data and handles account/billing/license. It does not replace `DurableJsonStore`.
- **Production compose reality:** `docker-compose.prod.yml` ships postgres + redis + backend. **Qdrant is absent from prod compose** — it exists only in dev compose and K8s descriptors. So production semantic search is not part of the shipped production stack until separately provisioned.

### 1.4 The `packages/*` reality — a parallel, mostly-unwired second architecture
This is the biggest source of "looks bigger than it is." Dozens of ambitiously-named packages (`persistence`, `runtime`, `security`, `workforce`, `automation`, `autonomous-ops`, `platform-automation`, `platform-operations`, `cloud-*`, `intelligence`, `ckdl`, `ai-runtime`) each ship extensive tests **and their own docstrings disclaiming production status** ("PREVIEW foundation", "INFRASTRUCTURE-PENDING", "no real LLM calls", "the HTTP transport is a stub").

**Dependency-graph truth (grepped, not assumed):** essentially none of these are imported by the live desktop main process or the live backend. They are parallel/duplicate concepts sitting beside the real wired systems — e.g. `packages/workforce` (agent registry) vs. the actually-running `apps/desktop/src/main/workforce/` (jobs/approvals). **Treat `packages/*` preview packages as a design library, not shipped product.** This matters enormously for the strategy: much of the "advanced AI platform" appears half-built, but the built halves are *not wired in*, so wiring is a real project, not a switch-flip.

---

## PART 2 — THE COMPLETE AI SYSTEM INSIDE NEUROPAUSE TODAY (census A–G)

Classification legend: **A** production-live · **B** implemented + runtime-wired · **C** implemented, not fully operational · **D** scaffolding-only · **E** test-only · **F** doc/concept · **G** missing.

### 2.1 LLM / provider layer — the genuinely production-wired part
| Capability | Class | Evidence | Honest limitation |
|---|---|---|---|
| Claude (Anthropic) client | A | `ai/claudeClient.ts:28-99` | Hand-rolled `fetch`, no official SDK; calls only when a key exists |
| OpenAI client | A | `ai/openaiClient.ts:34-105` | Hand-rolled fetch; opt-in via Settings |
| Ollama (local) client | A | `ai/ollamaClient.ts:36-95` | Local `/api/chat`; `stream:false` |
| Gemini / Mistral / Qwen | **G** | Zero code; named only in an `ai-runtime` doc comment | Not built anywhere in the desktop app |
| Deterministic no-model fallback | A | `ai/aiEngine.ts:93-105,180-210` | By design — app usable with zero model |
| `PrivateFirstClient` (local→private→external ordered routing, provenance-stamped) | A | `ai/privateFirstClient.ts:51-139`; installed `engineManager.ts:66-68` | Real, wire-tested |
| `ModelRouter` (tier→model) | A | `ai/modelRouter.ts:25-45` | Label map to the single active client, not true multi-model routing |
| Vault key storage (OS keychain via `safeStorage`) | A | `security/secureStore.ts:66-149` | Legacy plaintext-env fallback exists |
| API-key leak guard / redaction | A | `ai/apiKeyGuard.ts:1-40` | — |
| Token/cost accounting, tenant-scoped | A | `ai/pricing.ts:19-33`, `ai/usageTracker.ts`, `aiEngine.ts:170-173` | Manual price table; unknown model = $0 |
| Boot wiring + RBAC-gated IPC | A | `runtimeCore.ts:792-799`; `channels.ts:1369-1371`; `ai/aiAuthzGate.ts:57+` | Correctly gated (`cloud:operate`/`intelligence:read`) |
| **Structured output (JSON)** | B | `ai/responseParser.ts:18-42` | Prompt-engineered JSON-in-text parsing, **not** provider-native JSON mode/schema |
| **Function / tool calling** | **G** | `ai/modelClient.ts:14-37` has no tools/tool_choice fields | **No model in this app can call a tool** |
| **Streaming** | **G** | `modelClient.ts:36` returns one Promise; no SSE | Full-response only |
| AI audit log | C | `ai/auditLog.ts:1-33` | In-memory ring buffer, **not durable** — weaker than the CST/governance chain |
| Provider npm SDKs installed | G (by design) | No `openai`/`@anthropic-ai`/`ollama` in any package.json | All clients hand-rolled fetch |

### 2.2 The governed AI-action surface — the strongest architectural asset
| Capability | Class | Evidence | Truth |
|---|---|---|---|
| CST kernel `mail.send` (the ONE certified consequential capability) | A | `cst/sendTransition.ts:1-70` | `VERIFIED_SUCCESS` structurally unreachable in Profile A; 202 → `ACKNOWLEDGED`, lost → `UNKNOWN`, never blind-retried |
| L6 execution-time gate wired before send | A | `liveBrain/executionGate.ts:90-223`; wired `connectors/index.ts:606` | Re-derives tenant/authority/oracle from live substrate; mismatch → REFUSED |
| L6 execution boundary — **structural ASK-only** | A | `liveBrain/proposalExecutionBoundary.ts:9-18,41-94` | *No ALLOW branch exists in the code* — human confirm is structural, not configurable |
| L6 brain-propose lane (mandate→certified Proposal, zero authority) | B | `liveBrain/brainProposeLane.ts:23-25,76-168` | Model can only produce inert data |
| Deterministic recipient/action extraction | A | `capabilities/assistantMailIntent.ts:79-135` | Regex decides `to`/action, **not** the LLM |
| Hostile-adapter CI gate | E (permanent) | `capabilities/assistantMailIntent.hostileAdapter.test.ts` | Proves a compromised drafter can't inject a recipient |
| Read-back / verification oracle | C | `executionGate.ts:66-70` — `productionWired:false` | Declared, not production-wired even for mail.send |
| BRAIN-1 mail-draft gateway | B (machinery) / D (live lane) | `ai/brain/mailDraftGateway.ts:113-126` | Live lane serves the **zero-model deterministic drafter** by operator policy until an eval clears the bar |
| Assistant → `mailIntent` → governed panel (FG-3) | A | `assistant/assistantService.ts:362-376` | The real AI→economic-adjacent path; fully human-gated |

### 2.3 Agent runtime — does not exist in the wired product
| Capability | Class | Evidence | Truth |
|---|---|---|---|
| `packages/ai-runtime` (agents, InferencePipeline, tool connectors, governance) | **D** | `package.json:5` "PREVIEW foundation; no real LLM calls"; `providers.ts` ships only `FakeProvider` | **Never imported by `apps/desktop`** (grep-confirmed) |
| Agent registry (identity/kind/capabilities/tools) | D | `ai-runtime/src/agents.ts:11-81` | Real class, exercised only by its own tests; no production caller |
| Multi-step plan/observe/act loop | **G** | No `AgentRuntime.execute()` call site in `apps/desktop` | No agent loop runs in the product |

### 2.4 Memory / knowledge / search — real (structured), no shipped vector/RAG
| Capability | Class | Evidence | Truth |
|---|---|---|---|
| Durable conversation/explicit memory (tenant-scoped, owner-stamped, audited, tombstone-versioned) | A | `memory/memoryStore.ts:1-150,76-93`; IPC `memory/index.ts:343-473` | Real file persistence, per-tenant ownership on every read/write |
| ERP→memory projection | A | `memory/memoryProjector.ts`, `businessMemoryProjector.ts` | Structured/keyword, off the live unified store |
| Knowledge graph (structured entity/relationship over live ERP FK links) | A | `graph/graphStore.ts:1-764`; `enterprise/relationshipProvider.ts:1-150` | Customer→Quote/Order→Invoice→Payment→Supplier→PO→GR→Inventory→Mfg/BOM/MES/Quality→Maintenance/Assets — real, tenant-isolated hop-by-hop; **search inside it is substring match** |
| Enterprise Search (federated: entity/graph/memory/timeline/federation) | A | `search/enterpriseSearch.ts:1-217` | Keyword/substring; tenant-gated memory leg fails closed |
| AI Context Builder (ranked, budgeted, evidence-tagged context to the LLM) | A/B | `ai/contextBuilder.ts:1-315` | Real RAG-*shaped* pipeline, but retrieval is graph/keyword/lexical |
| Embedding abstraction (desktop) | **D** | `memory/embedding.ts:1-88` | Interfaces only; **no concrete provider in `apps/desktop`** |
| Vector store (desktop) | **D/E** | `memory/vectorStore.ts:1-103` | Only impl is in-memory test-double, wiped on restart |
| Semantic recall orchestration (hybrid, degrade-safe) | B | `memory/memorySemanticRecall.ts`; `memoryStore.ts:864-880` | **Silently degrades to lexical** unless the backend leg is live |
| Backend semantic RAG stack (Ollama/OpenAI embeddings + Qdrant, org-scoped, idempotent pipeline) | B (in backend, not desktop) | `apps/backend/src/semantic/*`; boot `app.ts:159-198` | Real, but a separate service; opt-in per-org backfill; Qdrant absent from prod compose; degrades silently |
| `packages/intelligence` (unified KG + deterministic reasoning + copilots) | **C/D** | `intelligence/src/graph.ts`, `reasoning.ts` ("No LLM used or needed") | Well-built, **not imported by `apps/desktop` or `apps/backend`** |
| `packages/ckdl` (Constitutional Knowledge & Decision Layer) | **D/F** | `package.json`: "PREVIEW; in-memory, no vector/embedding backend" | Not runtime-wired anywhere in shipped app |

**Definitive answer on RAG:** *No real embedding/vector/RAG stack exists inside the shipped desktop binary today.* A real one exists in the separate backend service, opt-in and silently-degrading, with Qdrant not in the production compose.

### 2.5 ERP-domain "intelligence" — 100% deterministic, and honest about it
Every predictive/scoring/recommendation surface is **rule-engine or deterministic formula**, self-labeled in its own source. There is **no regression, no time-series forecast, no anomaly detector, no trained model anywhere** in `intelligence/insight/recommendations/decisions/purposeEngine/capabilityGraph/environmentModel/environmentDiscovery/strategy/orchestration` or the S81–S88 modules.
- Predictions (7 risk heuristics): `insight/predictions.ts:2-13` — *"No ML, no model, no randomness."*
- Recommendations: `recommendations/recommendationEngine.ts:1-11` — *"Deterministic rules … grounded in cited evidence."*
- Demand-trend (S84): `sales/demandTrendModel.ts:9-15` — *"no forecast, no smoothing … deliberately NOT invented."*
- Inventory aging/ATP, production variance, reorder point: pure formulas (FIFO buckets, on-hand−reserved, Σconsumption−Σoutput, reorder-point math).
- Strategy/simulation "engine": `strategy/strategyModel.ts:590-654` — *"Deterministic scenario transforms — fixed formulas, no randomness."*

This is a **feature, not a gap**: the analytics are trustworthy and auditable. But it must not be sold or reasoned about as "AI/ML." It is deterministic analytics with honest labels.

---

## PART 3 — THE AI AUTONOMY LADDER (where we are, where the architecture can already go)

The directive is explicit: *do NOT downgrade AI to advisory-only if the architecture supports higher; where autonomous execution needs a business-authority policy, identify the exact policy boundary rather than disabling.* Here is the ladder, with the honest current rung and the exact thing that gates the next.

| Rung | Name | What it means | Status in NeuroPause today | The exact boundary to the next rung |
|---|---|---|---|---|
| **L0** | Observe | AI reads/ summarizes state | **LIVE** — assistant Q&A, briefings, context builder | — |
| **L1** | Suggest | AI proposes, human reads | **LIVE** — recommendations, reorder suggestions, mailIntent | — |
| **L2** | Prepare | AI drafts a *validated, governed* proposal object | **LIVE for mail.send** (`brainProposeLane` → certified `Proposal`); **deterministic, not model, drafts it** | The draft *content* lane is model-capable but serves the zero-model drafter by operator policy (`mailDraftGateway.ts:124-126`). Boundary = an eval bar + operator flip, not new architecture. |
| **L3** | Human-confirmed execution | Human confirms; governed path executes once; verified | **LIVE for mail.send ONLY** (CST kernel + structural ASK-only + L6 gate) | The boundary is **capability certification**: every new consequential capability needs the S23 Certification Kit's 14 fields proven. `mail.send` is the only one done. |
| **L4** | Policy-bounded execution | AI executes within a *compiled, hashed policy* (limits on recipient/account/amount/frequency), no per-action human confirm | **ARCHITECTURE PRESENT, NOT ENABLED** — the Policy DSL is roadmap (S28), and `proposalExecutionBoundary.ts` has *no ALLOW branch by construction* | **This is the exact policy boundary the directive asks for.** L4 requires: (1) a compiled+hashed Policy DSL (S28); (2) an ALLOW disposition added to the execution boundary *guarded by a policy-hash + verified-oracle precondition*; (3) a read-back oracle that is actually `productionWired:true` (today `false`). Until a **business-authority policy** defines "ALLOW mail.send WHEN recipient ∈ approved_domain MAX 1/day REQUIRE verification," there is nothing to authorize against — so L4 is *undefined business policy*, fail-closed, not a missing feature. |
| **L5** | Controlled autonomy | Multi-step, AI-selected actions within policy + kill switch + digest | **NOT REACHABLE** — needs L4 + a real agent loop + tool-calling (all absent) | Needs the agent runtime (`ai-runtime` wired), function-calling on the model layer, and per-step governance. |
| **L6+** | Cross-domain agentic ops | AI orchestrates across ERP domains toward a goal | **NOT REACHABLE** — needs L5 + durable agent state + multi-capability certification | Long-horizon; do not scope yet. |

**The single most important strategic truth on the ladder:** NeuroPause is at a genuine, well-built **L3-for-one-capability**, and the *governance boundary that most products never build* is already done and adversarially proven (S104). The gap to L4 is **not** "the architecture can't do it" — it is **three concrete, buildable pieces (Policy DSL, a policy-guarded ALLOW branch, a production-wired oracle) plus a business-policy decision that only the operator/business can define.** That is exactly the boundary to identify, per directive — not a reason to disable.

---

## PART 4 — ERP-DOMAIN × AI-CAPABILITY MATRIX (where AI could add value, and what's there now)

| ERP domain | AI value today | Realistic near-term AI (with current architecture) | Needs new infra |
|---|---|---|---|
| Finance / GL / AR / AP | Deterministic aging, variance, KPIs (A) | Draft narratives on variances; NL query over the graph; anomaly *flagging* via threshold rules | ML anomaly detection needs a model + labeled data (not present) |
| Procurement / P2P | Reorder recommendation → draft PR through governed bus (A, drafts only) | Draft PO/vendor emails (governed mail.send); supplier-risk summarization | Spend-optimization ML needs history + model |
| Inventory / Warehouse | Aging/ATP formulas (A) | NL "what's short for next week's orders" over the graph; reorder narratives | Demand forecast needs a real time-series model |
| Manufacturing / MES | Variance register/settlement (A, deterministic) | Downtime-cause summarization; schedule-conflict narration | Predictive maintenance needs sensor data + model |
| Sales / CRM / O2C | Demand-trend analytics (A, not forecast) | Draft customer comms (governed); lead/quote summarization | Lead scoring ML needs training data |
| Projects / Maintenance | Economic control-plane certified (S99); cost→GL policy-open | Status/risk narratives; NL project Q&A | — |
| Cross-domain | Relationship graph + federated search (A) | **The highest-leverage AI surface**: NL question-answering over the tenant-isolated enterprise graph ("show me every overdue invoice for customers with an open manufacturing order") | Semantic recall would improve recall quality (backend/Qdrant) |

**Highest-leverage AI opportunity by far:** a **governed natural-language query + narrative layer over the existing tenant-isolated relationship graph.** It rides entirely on assets that already exist and are proven (graph, search, context builder, LLM plumbing, RBAC), needs zero new consequential-execution authority, and is the demo that makes the whole ERP feel "alive." It is L0/L1 — advisory — so it ships without touching the governance kernel.

---

## PART 5 — PRODUCTION vs SCAFFOLDING MATRIX (the one-glance truth)

| Layer | Production-live | Scaffolding / preview / unwired |
|---|---|---|
| LLM provider plumbing | Claude/OpenAI/Ollama clients, PrivateFirstClient, routing, Vault keys, cost/redaction, boot wiring | Gemini/Mistral/Qwen (missing); provider SDKs (hand-rolled) |
| Agentic execution | CST `mail.send` + L6 structural ASK-only gate | `packages/ai-runtime` agent registry (never imported); tool-calling (missing); streaming (missing); agent loop (missing) |
| Memory/knowledge | Durable tenant-scoped memory; structured relationship graph; federated keyword search; context builder | Desktop embeddings/vector (interfaces + test-double); `packages/intelligence` & `packages/ckdl` (unwired) |
| RAG / semantic | — | Real backend Qdrant RAG stack exists but is a separate opt-in service, silently degrades, absent from prod compose |
| ERP intelligence | 100% deterministic analytics (aging/variance/reorder/KPIs), honestly labeled | Nothing predictive/ML |
| Data / backend | Local `DurableJsonStore` ERP; Postgres/Redis backend for auth/org/billing/license/sync | `packages/{persistence,runtime,security,workforce,automation,autonomous-ops,platform-*,cloud-*}` (parallel, unwired PREVIEW) |
| Governance | RBAC, tenancy, machine-owned status, idempotency, durability, adversarially proven (S98–S104) | — |

---

## PART 6 — GAP MATRIX (to be a "true enterprise agentic AI platform")

| # | Gap | Severity | Why it matters | Buildable on current arch? |
|---|---|---|---|---|
| G1 | No model **tool/function-calling** | High | Without it, a model can never *invoke* a governed capability; all "agentic" behavior is deterministic code | Yes — extend `ModelRequest`/`ModelResult`; providers already support it |
| G2 | No **agent loop** wired (plan/observe/act, durable state) | High | No multi-step autonomy possible | Yes — wire `packages/ai-runtime` OR build a minimal loop; must route every act through the governed bus |
| G3 | **Policy DSL absent** (S28) | High | L4 policy-bounded execution has nothing to authorize against | Yes — compiled+hashed policy; the kernel already logs decisions |
| G4 | Execution boundary has **no ALLOW branch** | Medium (by design) | Correct today; blocks L4 | Yes — add a *policy-hash + verified-oracle-gated* ALLOW; never a bare ALLOW |
| G5 | **Read-back oracle** `productionWired:false` | High | Universal verification (§2 #14) is declared, not live even for mail.send | Yes — the machinery exists; wire the Sent-Items corroboration for real |
| G6 | **No shipped semantic/RAG** in desktop; silent degrade | Medium | Recall limited to keyword/FK; agent context misses paraphrase | Yes — either bundle a local embedding provider or make the backend leg first-class + surface degradation |
| G7 | Only **one certified consequential capability** | High | L3 breadth is 1; every new action needs the S23 kit | Yes — the kit exists; certify calendar/Slack/etc. one at a time |
| G8 | **AI audit log not durable** | Medium | AI actions aren't in a tamper-evident chain like governance | Yes — persist to the evidence store pattern |
| G9 | Advanced packages **unwired** | Medium | "Platform" appears built but isn't in the product | Wiring is real project work, not a switch |
| G10 | No **ML** (forecast/anomaly/scoring) | Low-Med | Deterministic analytics is fine; ML is a later differentiator, needs data + models | Separate track; do not conflate with agentic AI |

---

## PART 7 — TIERED ADVANCED-AI ROADMAP (Tier 0–5)

Each tier is a coherent, shippable step. **No tier weakens the governance kernel; every consequential act stays on the proven governed path.**

- **Tier 0 — Truth & hygiene (no new capability).** Persist the AI audit log to the evidence-store pattern (G8). Surface semantic-degradation honestly to user and agent (G6, partial). Document the L3/L4 boundary as the official product statement. *Zero risk, high trust value.*
- **Tier 1 — Governed NL query + narrative layer (advisory, L0/L1).** Natural-language question-answering and narrative summaries over the existing tenant-isolated relationship graph + federated search + context builder, through the LLM plumbing. **This is the flagship near-term build.** No consequential authority; ships fast; makes the ERP feel alive.
- **Tier 2 — Production-wire the verification oracle (G5) + certify capability #2 (G7).** Make read-back real for mail.send, then run one more capability (e.g. calendar.create) through the S23 kit. This is the L3-breadth story.
- **Tier 3 — Model tool-calling on the governed bus (G1).** Give the model function-calling whose *only* callable targets are proposal-builders (never executors) — the model proposes a governed action object; the human still confirms. This is agentic *proposal*, not agentic execution.
- **Tier 4 — Policy DSL + policy-guarded ALLOW (G3, G4) → L4.** Compile+hash a business-authority policy; add an ALLOW branch to the execution boundary gated on (policy-hash valid ∧ oracle verified ∧ within limits). **Requires an operator/business policy decision** — identify it, don't invent it. This is the first true unattended execution, bounded and reversible.
- **Tier 5 — Minimal governed agent loop (G2) → L5.** A durable, single-domain agent that plans → proposes → (policy or human) → governed execute → verify → record, one step at a time, with a visible kill switch and daily digest. Only after Tiers 3–4 are proven.

**ML track (parallel, independent):** forecast/anomaly/scoring is a *separate* investment requiring data pipelines and models. Do not sequence it into the agentic ladder; it is a differentiator, not a prerequisite.

---

## PART 8 — DO-NOT-BUILD-YET LIST (explicit)

1. **Unattended autonomous execution (L4+) without a defined business-authority policy** — there is nothing to authorize against; building an ALLOW branch first would be a governance regression.
2. **A bare ALLOW branch** in the execution boundary — only ever policy-hash + oracle-gated.
3. **Wiring `packages/ai-runtime` agent loop to real execution** before tool-calling routes exclusively through proposal-builders.
4. **ML forecasting/anomaly detection** sold as shipping — no data pipeline or model exists; deterministic analytics must not be relabeled "AI."
5. **Making the backend RAG stack a hard dependency** — keep degrade-safe; don't gate core UX on Qdrant.
6. **Wiring the parallel PREVIEW packages** (`security`, `workforce`, `automation`, `autonomous-ops`, `persistence`, `runtime`) wholesale — evaluate per-capability; they duplicate live systems.
7. **Migrating ERP off `DurableJsonStore` to a server DB** as an AI prerequisite — it is not one; local-first is a deliberate, proven choice.
8. **Gemini/Mistral/Qwen providers** until a customer needs them — the two-cloud-plus-local set covers the field.

---

## PART 9 — TOP-10 BUILDS (ranked by leverage ÷ risk)

1. **Governed NL query + narrative over the relationship graph** (Tier 1) — highest leverage, lowest risk, advisory-only.
2. **Persist + chain the AI audit log** (Tier 0) — trust foundation.
3. **Production-wire the mail.send read-back oracle** (Tier 2, G5) — closes the §2 #14 gap on the one live capability.
4. **Surface semantic-degradation state** to user + agent (G6) — kills the silent-quality-loss trap.
5. **Certify capability #2 via the S23 kit** (Tier 2, G7) — proves L3 breadth is repeatable.
6. **Model tool-calling limited to proposal-builders** (Tier 3, G1) — agentic proposal without execution risk.
7. **Draft the Policy DSL spec + get the operator's first business-authority policy** (Tier 4 prep, G3) — unblocks L4 by defining the boundary.
8. **Policy-guarded ALLOW branch** behind the DSL + oracle (Tier 4, G4) — first bounded unattended execution.
9. **Bundle a local embedding provider (Ollama) for optional on-device semantic recall** (G6) — RAG without a server dependency.
10. **Minimal single-domain governed agent loop** (Tier 5, G2) — the real "agentic" milestone, last.

---

## PART 10 — EXACT DEPENDENCY ORDER

```
Tier0: [2 audit-log] ──┐
                       ├─► Tier1: [1 NL query]  (independent, ship first for value)
[4 degrade-surface]────┘
Tier2: [3 oracle] ──► [5 capability #2]
Tier3: [6 tool-calling→proposal-builders]  (needs governed proposal path, already exists)
Tier4: [7 Policy DSL spec + business policy] ──► [8 policy-guarded ALLOW]  (needs [3 oracle] live)
Tier5: [10 agent loop]  (needs [6] + [8])
[9 local embeddings]  parallel, optional, anytime
ML track  parallel, independent, later
```
Critical path to true agentic (L5): **3 → 6 → 7 → 8 → 10.** Value-first path: **1 (ships immediately, advisory).**

---

## PART 11 — FOUNDER RECOMMENDATION

**What you have is rarer than what you're missing.** Almost every "AI ERP" ships an ungoverned LLM wired straight to mutations and hopes prompt-injection never bites. NeuroPause did the opposite and the expensive-first thing: it built a *governed execution boundary* — RBAC-on-server-resolved-actor, machine-owned status, tenant isolation, idempotency, crash durability, structural ASK-only, and adversarial proof (S98–S104) — around the one consequential AI-adjacent capability. That boundary is the moat. It is done, wired, and red-teamed.

**What to build next, in order:**
1. **Ship the advisory NL/narrative layer over the relationship graph (Tier 1) now.** It is the "our ERP is alive" demo, it rides only on proven assets, and it carries zero execution risk. This is your fastest path to a visible AI product.
2. **In parallel, close the three L4-boundary pieces** (production oracle, Policy DSL, policy-guarded ALLOW) — and get from the business the *one* thing only the business can supply: a written authority policy ("mail.send is ALLOWed to approved domains, max N/day, verification required"). That single policy decision, not any code, is what unlocks the first bounded unattended action. Identify it; don't invent it.
3. **Only then** add tool-calling-to-proposals and a minimal single-domain agent loop.

**Do not** relabel the deterministic analytics as ML, do not wire the parallel preview packages wholesale, and do not add a bare ALLOW branch. The honest positioning — "governed AI ERP: the AI proposes, policy and the human decide, the governed path executes once, and every effect is verified" — is both true and a stronger sell than "autonomous AI" would be.

**Bottom line:** you are not far from a true enterprise agentic-AI platform in *architecture* — the hard governance layer is built. You are one advisory-layer ship and three well-defined engineering pieces (plus one business-policy decision) away from L4 bounded autonomy. Build the advisory layer first for value; build the L4 boundary deliberately for the moat.

---

## PART 12 — S105 STATUS

- **Class:** discovery + strategy. **Production code changed: NONE. Build: NONE. Frozen surfaces: untouched. `baseline.json`: untouched. Release-track: untouched (paused).**
- **Findings classification:** no A/B/C/D/STOP defect findings — this is a census, not a certification. All "gaps" are roadmap items or *undefined business policy* (fail-closed today), not defects. The one honesty item worth flagging loudly: **semantic recall silently degrades to keyword** with no signal to user or agent (G6) — not a security defect, but a truth-in-surfaces item consistent with S19, recommended for Tier 0.
- **Per directive:** S105 ends here with the roadmap and the recommended next build. **Do NOT auto-proceed to S106.** The recommended next build is **Tier 1 — the governed NL query + narrative layer over the relationship graph** (advisory, ships on proven assets, zero execution risk), with the L4-boundary pieces defined in parallel and gated on an operator business-authority policy decision.

