# Repository-Wide Architectural Recon & Dependency Graph

**Mandate (item 21):** after A6, do *not* begin AI Copilot. Instead map the repository across ten dimensions, produce a dependency graph, and recommend an implementation order **from repository evidence only**.

Every claim below carries a `file:line` citation and was re-verified directly against the working tree, not taken from a prior summary.

---

## The headline finding

**Four of the ten workstreams on the roadmap are already built, and a fifth does not need building at all.**

`apps/desktop/src/main/enterprise/index.ts` registers **45 enterprise modules** across **9 families**, and `apps/desktop/src/main/enterprise/modules/moduleCertification.test.ts:115` locks that number as an assertion — *"certifies exactly 45 modules across the 9 production families"*.

| Family | Modules | Roadmap item | Actual state |
|---|---:|---|---|
| Manufacturing | 11 | #9 Manufacturing | **Built** |
| Maintenance | 10 | — | **Built** (not on the roadmap at all) |
| Warehouse | 8 | — | **Built** |
| Procurement | 4 | #7 Procurement | **Built** |
| Inventory | 3 | #8 Inventory | **Built** |
| CRM | 3 | #6 CRM | **Built** |
| Sales | 2 | — | **Built** |
| Finance | 2 | #5 Finance GL | **Partial** — Invoices + Payments only; no General Ledger |
| Executive | 2 | — | **Built** |
| **Total** | **45** | | |

And the "Enterprise Module SDK / Foundation (if needed)" item is **not needed**. It exists, at `apps/desktop/src/main/enterprise/framework/`, as `defineEnterpriseModule({descriptor, store, hooks})`. All 45 modules are built on it. Building a second one would be exactly the "parallel system" the engagement forbids.

What is genuinely absent is narrower than the roadmap implies: **HR**, **Projects**, and **Finance General Ledger**. The renderer already says so — `apps/desktop/src/renderer/src/capability/capabilityRegistry.ts:178-180` carries three `state: 'future-release'` rows for `business.quality`, `business.hr`, and `business.projects`, each noting *"No HR modules are registered yet"* / *"No Projects modules are registered yet"*.

---

## The second finding: two repositories are living in one tree

`packages/` holds **44 packages**. `apps/` really imports **three of them**.

Counting only genuine `import ... from` / `export ... from` statements (not string mentions in comments or docs):

```
221  @neuropause/shared          — apps/desktop + apps/backend
  1  @neuropause/cloud-core      — apps/backend/src/platform/secretGuard.ts:13
  1  @neuropause/shared-cloud    — apps/backend/src/platform/audit.ts:10
```

`apps/desktop` imports **only** `@neuropause/shared`, path-aliased at `electron.vite.config.ts:6-8`.

The other 41 packages — including `packages/business` (which contains `hr.ts` and `projects.ts`), `packages/ai-runtime`, `packages/intelligence`, `packages/security`, `packages/execution`, `packages/workforce` — form a self-consistent island that imports only from each other. `packages/business` is imported by `packages/workplace` and `packages/industry` and by nothing in `apps/`.

**This matters for planning in a specific way.** The approved roadmap says to *port* `packages/business/src/projects.ts` and `hr.ts` — and *port* is exactly the right word, so long as it keeps its precise meaning. Those files are a different architecture: plain composed platforms, not `EnterpriseModule` descriptors with stores, RBAC scopes, lifecycle hooks, and registry entries. Their **domain logic is valuable prior art** — read it, take the rules (the double-entry validation in `erp.ts` especially), reimplement them behind `defineEnterpriseModule`.

What must not happen is *wiring* rather than porting. Adding `@neuropause/business` to `apps/desktop`'s dependencies would import a second module model beside the one all 45 modules already use — a parallel system, which the engagement forbids. I flag it because "we already have HR in `packages/business`, just connect it" is the single most plausible wrong turn available here, and it looks like a shortcut right up until there are two module frameworks to maintain.

---

## Dependency graph — the ten mandated dimensions

```
                          ┌──────────────────────────────┐
                          │   packages/shared (types,    │
                          │   674 IPC channel constants) │
                          └───────────────┬──────────────┘
                                          │ the ONLY package apps/desktop imports
                                          ▼
   ┌──────────────────────────────────────────────────────────────────────┐
   │  SECURE IPC  —  secureBridge → sender-trust → auth → RBAC → Zod      │
   │                 → timeout → audit    (requests validated;            │
   │                                       responses NOT validated)       │
   └───────────────┬──────────────────────────────────────┬───────────────┘
                   │                                      │
                   ▼                                      ▼
   ┌───────────────────────────────┐      ┌──────────────────────────────────┐
   │  6 · PERMISSIONS              │      │  7 · AUDIT                       │
   │  57 EnterprisePermission vals │      │  ctx.audit() called inside       │
   │  16 withXAuthz gates          │◄─────┤  emitLifecycle — automatic,      │
   │  fail-closed startup check    │      │  not per-module opt-in           │
   └───────────────┬───────────────┘      └──────────────▲───────────────────┘
                   │                                     │
                   ▼                                     │
   ┌───────────────────────────────────────────────────────────────────────┐
   │  2 · ENTERPRISE MODULE FRAMEWORK          ★ READY — THE CRITICAL PATH │
   │  framework/{enterpriseModule, enterpriseRecordStore, moduleRegistry}  │
   │  defineEnterpriseModule({descriptor, store, hooks})                   │
   │  9 generic enterprise:module.* channels serve ALL 45 modules          │
   │  emitLifecycle() → audit + publish + broadcast + onChange   [1 seam]  │
   └───────────────┬───────────────────────────────────────┬───────────────┘
                   │ publish()                             │ broadcast()
                   ▼                                       ▼
   ┌───────────────────────────────┐      ┌──────────────────────────────────┐
   │  5 · EVENT BUS                │      │        renderer (React)          │
   │  platform/eventBus.ts         │      │  Business Workspace, Enterprise  │
   │  + PlatformEventApi           │      │  view, command palette           │
   └───────────────┬───────────────┘      └──────────────────────────────────┘
                   │ subscribers.ts:172 — 'timeline' subscriber
                   ▼   persists every non-EPHEMERAL event
   ┌───────────────────────────────────────────────────────────────────────┐
   │  4 · TIMELINE      ★ PUBLISHING TO THE BUS *IS* WRITING THE TIMELINE  │
   │  platform/timelineService.ts  (durable, JSONL)                        │
   │  timeline/enterpriseTimeline.ts — read-model merging platform events  │
   │                                   with UDM entities; persists nothing │
   └───────────────────────────────────────────────────────────────────────┘

   ┌───────────────────────────────────────────────────────────────────────┐
   │  1 · AI COPILOT — FOUR live implementations, one mature               │
   │                                                                       │
   │   ai/founderAI.ts .............. Founder AI v1   (founder:ask)        │
   │   founder/founderEngine.ts ..... Founder AI v2   (founder:ask-v2)     │
   │   ai/engineeringAI.ts .......... Engineering AI  (ai:engineering-…)   │
   │   assistant/assistantService.ts  Workspace Assistant (assistant:* ×9) │
   │                                     ▲                                 │
   │        ┌────────────────────────────┴─────────────────────────┐       │
   │        │  THE ASSISTANT PORT SEAM — runtimeCore.ts:1504-1526  │       │
   │        │  8 modules each export                              │       │
   │        │    answerQuestion(text, nowIso) → Report | null      │       │
   │        │  late-bound through forward-ref closures            │       │
   │        │  intelligence · knowledge · automation · operations │       │
   │        │  strategy · federation · analytics · twin           │       │
   │        └─────────────────────────────────────────────────────┘       │
   └───────────────────────────────────────────────────────────────────────┘

   ┌──────────────────────┐ ┌──────────────────────┐ ┌────────────────────┐
   │ 3 · RETRIEVAL        │ │ 8 · CONNECTORS       │ │ 9 · LIVE SYNC      │
   │ ★ HARDENED IN A6     │ │ 13 real adapters     │ │ cloud/livesync/    │
   │ hybrid lexical+      │ │ 9 preview (no        │ │ unified/sync/      │
   │ semantic; classified │ │ adapter yet)         │ │ memory/memoryLive  │
   │ failures; circuit    │ │ OAuth engine + PKCE  │ │ SyncBridge.ts      │
   │ breaker; honest UI   │ │ + connectorVault     │ │                    │
   └──────────────────────┘ └──────────────────────┘ └────────────────────┘

   ┌───────────────────────────────────────────────────────────────────────┐
   │ 10 · ENTERPRISE INTELLIGENCE — 8 read-only composition platforms      │
   │  insight · knowledgeAssets · automationPlatform · operationsPlatform  │
   │  strategyPlatform · enterpriseFederation · analyticsPlatform ·        │
   │  digitalTwinPlatform        ALL compose; NONE mutate; all 8 supply    │
   │                             an answerQuestion port to the Assistant   │
   └───────────────────────────────────────────────────────────────────────┘
```

### Dimension-by-dimension readiness

**1 · AI Copilot dependencies — READY, but fragmented.** Four implementations coexist. `assistant/assistantService.ts` is the mature one: 9 IPC channels (`assistant:ask`, `conversations`, `conversation`, `conversation.save`, `.delete`, `.branch`, `plan.decide`, `cancel`, `event`), a conversation store, a plan-approval gate, and eight domain ports. The other three are narrower: `founder:ask` (v1, rule-based), `founder:ask-v2`, and `ai:engineering-analyze`. **Unification means retiring three surfaces into the Assistant's port model, not writing a fifth engine.** The seam is proven — eight modules already plug into it at `runtimeCore.ts:1504-1526` with the identical `answerQuestion(text, nowIso) => AssistantStructuredReport | null` signature.

**2 · Enterprise Module Framework — READY. This is the critical path for every remaining business module.** The recipe is fixed and repeated 45 times, and it requires **zero new IPC channels**: the nine generic `enterprise:module.*` channels (`channels.ts:416-428`) serve every module. Steps: shared types file → `<x>Module.ts` calling `defineEnterpriseModule` → optional `<x>Ai.ts` hook → `<x>ModuleInstance.ts` → test → register in `enterprise/index.ts` → update `CERTIFIED` / `CERTIFIED_COUNTS` in `moduleCertification.test.ts:101-103` → add `EnterprisePermission` scopes + role seeding in `enterprise/org/seed.ts` → add a `BUSINESS_FAMILIES` row in `businessModel.ts` → flip the `capabilityRegistry.ts` row off `future-release`.

**3 · Retrieval — READY as of A6.** Failures are classified at the observation site, the circuit breaker bounds a down dependency, the diagnostics envelope is optional so pre-A6 producers stay valid, and both consumers report degradation honestly.

**4 · Timeline — READY, and cheaper than it looks.** `subscribers.ts:172` registers a `timeline` subscriber that persists **every** non-`EPHEMERAL` bus event. Because `emitLifecycle` (`moduleRegistry.ts:120-149`) calls `ctx.publish(...)` on every module record change, **a new module gets timeline coverage for free**. `enterpriseTimeline.ts` is a read-model that persists nothing of its own and merges platform events with UDM entities.

**5 · Event Bus — READY, with one documentation defect.** `platform/eventBus.ts` publishes into a ring buffer, fans out to subscribers, and supports replay. **Defect:** the comment above the fan-out loop claims *"Higher-priority events are dispatched first within this call"* — no such ordering exists. The loop iterates `this.subs.values()` in insertion order, and a single `publish()` carries exactly one event, so the sentence describes a mechanism that cannot exist as written. Comment-level, not behavioural, but it will eventually license a wrong change.

**6 · Permissions — READY, fail-closed.** Exactly **57** `EnterprisePermission` values (`packages/shared/src/types/enterprise.ts:72+`). Sixteen `withXAuthz` gates throw on an unclassified channel, and a startup invariant at `runtimeCore.ts:2565-2576` refuses to boot if any invokable channel is unclassified. `executive:*` is Owner-only and Admin can never obtain it (`guardBuiltInRolePatch`, `authzGate.ts:256-264`). **HR and Projects have no scopes yet** — those must be minted.

**7 · Audit — READY and automatic.** Audit is not a per-module responsibility. `emitLifecycle` calls `ctx.audit({action: 'module.<id>.<action>', ...})` inside the framework, so every module inherits it. Additional audit chains exist for AI (`ai/auditLog.ts`), workforce governance, memory, and a hash chain at `security/auditChain.ts`.

**8 · Connectors — PARTIAL, and honestly labelled.** `capabilityRegistry.ts:142-144`: 13 production adapters with real OAuth (`oauthEngine.ts`, `pkce.ts`, `connectorVault.ts`, `oauthTokens.ts`), and **9 connectors shown as Preview because they have no data adapter** — ChatGPT, Claude, Gemini, Perplexity, Cursor, Canva, Figma, Linear, Zapier. The registry says so in the UI rather than pretending. Note that several of those nine are exactly the connectors the product vision names first.

**9 · Live Sync — PRESENT.** `main/cloud/livesync/{liveSyncInstance,liveSyncService}.ts`, `main/unified/sync/{syncStateInstance,syncStateStore}.ts`, and `memory/memoryLiveSyncBridge.ts`. Increment 02 already worked here.

**10 · Enterprise Intelligence — READY and unusually disciplined.** Eight composition platforms, each read-only with **zero mutation IPC**. Every one of them routes side effects through the same path: Assistant → Approval → ExecuteEngine → Workforce → Connectors. This is the strongest architectural pattern in the repository and any new work should follow it rather than inventing a shortcut.

---

## Cross-cutting risks that any subsequent increment inherits

**IPC responses are not runtime-validated.** Requests are Zod-checked; there are zero `safeParse` calls in `renderer/src/lib/ipc.ts`. The renderer trusts every response shape.

**No SQL database backs the enterprise record stores or the timeline.** `EnterpriseRecordStore` writes atomic JSON per module; the timeline is JSONL. The project brief names PostgreSQL, Redis, Meilisearch, and Qdrant — of those, only Qdrant is reachable, and only through the backend's semantic path. **This is the largest gap between the stated stack and the running system**, and it is a scaling question, not a correctness one: the current stores work.

**Only one migration is registered** (`0001-baseline`). Neither the timeline nor the enterprise record stores participate in the migration engine. Every schema change to a module's records is therefore currently unversioned.

**674 IPC channels** across ~50 namespaces is a large attack and maintenance surface. The fail-closed authz invariant is what keeps it safe, and it must never be weakened.

---

## Recommended implementation order — from evidence, not from the roadmap's ordering

The roadmap's proposed order was: 1 AI Copilot Unification · 2 Enterprise Module SDK · 3 Projects · 4 HR · 5 Finance GL · 6 CRM · 7 Procurement · 8 Inventory · 9 Manufacturing · 10 Analytics.

Evidence changes it substantially.

**Item 2 (Enterprise Module SDK) is deleted.** It exists. Building it would create a parallel system.

**Items 6, 7, 8, 9 (CRM, Procurement, Inventory, Manufacturing) collapse from "build" to "verify".** All are registered, certified by a locking test, permission-scoped, and surfaced in the Business Workspace. The remaining work is verification and gap-closing against real workflows, not construction.

**Item 1 (AI Copilot Unification) moves later, not earlier.** The unification target is the Assistant's port model. Every port that will exist should exist before the ports are unified, otherwise the unification is done twice. Copilot depends on the modules; the modules do not depend on Copilot.

**Item 10 (Analytics) moves last on hard evidence.** `analyticsPlatform` composes KPI feeds from existing producers and recomputes nothing. Its output is a function of what modules exist. Building analytics before HR/Projects/GL means building it against a data model that is about to change.

### The order

| # | Workstream | Why here | Depends on |
|---:|---|---|---|
| **1** | **Finance General Ledger** | The only *partial* family. Finance has Invoices + Payments and reuses the `operations:*` scope rather than a `finance:*` one (`moduleCertification.test.ts:108-112` records this deliberately). GL is the account backbone that Procurement, Inventory, Manufacturing and Maintenance postings all eventually need. Highest value, and the framework is ready. | Module framework ✓ · new `finance:*` scopes |
| **2** | **Projects Module** | No modules registered (`capabilityRegistry.ts:180`). Projects is the lighter of the two absent families and has the fewest cross-module couplings, so it is the right first *new* family — it re-proves the whole recipe end to end (types → module → scopes → seeding → family row → capability flip) on low-risk ground. | Module framework ✓ · new `projects:*` scopes |
| **3** | **HR Module** | No modules registered (`capabilityRegistry.ts:179`). Heavier than Projects: HR carries personal data, so it needs its own scope design and a privacy review that Projects does not. Doing it second means the recipe is already re-proven. | #2's scope pattern · new `hr:*` scopes |
| **4** | **Business-module verification sweep** (CRM · Procurement · Inventory · Manufacturing · Warehouse · Maintenance · Sales · Executive) | 45 modules exist and pass a registry-lock test. What is *not* proven is that they compose into real end-to-end workflows. This is where "ready to deploy" is actually won or lost, and it is cheaper than any of the builds above. | All modules ✓ |
| **5** | **AI Copilot Unification** | Now every port that will exist, exists. Retire `founder:ask`, `founder:ask-v2`, and `ai:engineering-analyze` into the Assistant's proven port model. | #1-#3 modules · assistant seam ✓ |
| **6** | **Analytics** | Composes over the finished module set. Building it earlier means rebuilding it. | #1-#5 |

**Platform hardening runs alongside, not after:** IPC response validation, the migration engine's coverage of record stores and timeline, and the connector-adapter gap for the nine Preview connectors. These are deployment blockers in a way that new modules are not, because they affect everything already shipped.

---

## What this means for A7–A17

The roadmap's remaining increments should be re-derived from this evidence rather than from the original numbering, and — per the standing constraint *"never build everything in one increment"* — each runs its own STEP 1-7 cycle with its own verification gate.

Proposed mapping, one increment each:

| Increment | Subject | Type |
|---|---|---|
| A7 | IPC response validation at the renderer boundary | Platform hardening — blocks deploy |
| A8 | Migration-engine coverage for enterprise record stores + timeline | Platform hardening — blocks deploy |
| A9 | Finance General Ledger — module, scopes, seeding, family row | New module |
| A10 | Projects module family | New module |
| A11 | HR module family (incl. personal-data scope review) | New module |
| A12 | Business-workflow verification sweep across the 45 existing modules | Verification |
| A13 | Connector adapter gap — close the highest-value Preview connectors | Integration |
| A14 | AI Copilot unification onto the Assistant port model | Consolidation |
| A15 | Analytics over the completed module set | Composition |
| A16 | Release engineering: signing, notarization, auto-update, CI green on both runners | Deploy |
| A17 | Deployment readiness review — security, performance, backward-compat, docs | Deploy gate |

A7 and A8 are placed first deliberately. They are the two findings from this recon that affect **everything already shipped**, and no amount of new module work makes a product deployable while the renderer trusts unvalidated IPC responses and record stores sit outside the migration engine.
