# SESSION 107 — PACKAGE ACTIVATION & PLATFORM CONVERGENCE

**Class:** activation audit + first safe harvest. **NO deletion · NO archive · NO package removed from workspace/tsconfig · NO second spine · NO business-policy invention · NO frozen surface touched · NO release work.** Baseline S106 GREEN, HEAD `c4befcf`. Deep per-package inspection traced real exports/tests/dependency-roots (not filenames), compared each against the live subsystem, and executed exactly one genuinely-safe harvest with tests. `baseline.json` untouched.

**Mission restated:** make every *valuable* capability in the repository part of the ONE live NeuroPause platform — by harvesting into the canonical live subsystems where justified, keeping experimental packages intact, and placing genuinely-unnecessary packages on a RETIREMENT-CANDIDATE list that **STOPS for operator approval** before any deletion. The objective is live integration, not folder-merging.

---

## 1. THE STRUCTURAL FINDING THAT CONSTRAINS EVERY INTEGRATION

The ~39 unwired packages are **not** 39 independent capabilities waiting to be plugged in. They form **one self-referential parallel platform**: every leaf depends on a shared infrastructure root — `@neuropause/ai-runtime` (which ships only a `FakeProvider`, no real LLM), `@neuropause/cloud-core`, `@neuropause/runtime`, `@neuropause/automation`, `@neuropause/business` — and those roots **duplicate the live spine** (command bus, event bus, AI gateway, persistence, governance). Concretely, the "Wave 8–14" business/industry/workplace packages sit at the *top* of a dependency stack rooted on `ai-runtime`+`cloud-core`+`runtime`.

**Consequence (Rule 3, binding):** you cannot import any leaf package without dragging in its parallel-infrastructure root — i.e. **direct integration of any package = standing up a second command bus / event bus / AI gateway / persistence next to the live one.** That is exactly the duplication the canonical architecture forbids. Therefore:

> **DIRECT INTEGRATION (option A) is ruled out for essentially the entire island by construction.** The only sound activation is **B — HARVEST**: extract the specific pure capability/algorithm into the canonical live subsystem, re-implemented against the live governance/event/store, importing nothing from the parallel root. Everything else is **E — keep experimental / intact** or **F — retirement-candidate (approval required)**.

This is not a reason to delete anything. It is the reason activation must be *surgical harvest*, one capability at a time, into code that already runs.

---

## 2. PER-PACKAGE DETERMINATION (A–F)

Legend: **A** direct-integration · **B** harvest-into-canonical · **C** adapter · **D** domain-plugin · **E** experimental-keep · **F** retirement-candidate (APPROVAL REQUIRED). Every determination cites the live subsystem it was compared against.

### AI / agent / intelligence cluster
| Package | Real content | Live equivalent (superior?) | Determination |
|---|---|---|---|
| `ai-runtime` | `FakeProvider` only; `AgentRuntime`=Map+run (no tool-calling loop); `ToolRuntime`=governed dispatcher; **`WorkflowEngine`** (ordered steps + retry/timeout + approval checkpoint + **compensating rollback**, `workflows.ts:62-155`) | live `liveBrain/{brainProposeLane,executionGate,proposalExecutionBoundary}` is far more advanced (re-derived authority, oracle registry, drift detection). Live has **no** ordered-step-with-rollback orchestrator. | **B (harvest `WorkflowEngine` shape only)** + rest **F** |
| `workforce` | registry=Map CRUD; planner=hardcoded 4-node chain; reasoning=regex; HITL=Set.has | live `workforce/` + `brainProposeLane`/`executionGate` already stricter | **F** |
| `autonomous-ops` | Map CRUD; digital-twin=count table; 5-line utilities (interval-overlap, proportional split, round-robin) | live `autonomousOps/`, `twin/`, `strategy/`, `insight/` already model these | **F** |
| `execution` | real pipeline *order* (policy→HITL→rate-limit→circuit→retry→observe→govern) but teeth imported from `@neuropause/integrations`; local `policy.ts` risk-tier evaluator | live `connectors/` path implements the pieces natively + governed by `executionGate` | **F** (pipeline order = doc idea only) |
| `intelligence` | in-memory `KnowledgeGraph` (no tenant isolation); BFS blast-radius/root-cause; `computeConfidence` log-curve | live `graph/graphStore.ts` enforces **per-hop tenant visibility**, persistence, shortest-path — strictly superior; live `memory/memoryRanking.ts` already does explainable scoring | **F** |
| `ckdl` | **`TrustModel.assess()`** (weighted multi-signal explainable trust: freshness half-life, human-approval weighted ABOVE ai-confidence, explicit caveats; `trust.ts:57-154`); `missingEvidence()` decision-quality checklist; graphs inferior to live | live has **no** multi-signal trust assessor (`cst/boundDecisionClaim.ts` has none) | **B (harvest `TrustModel`)** + graphs **F** |

### Security / data / domain cluster
| Package | Real content | Live equivalent | Determination |
|---|---|---|---|
| `security` | **real ABAC** (deny-wins, versioning, simulate/test, `policy.ts:69-128`); delegation/JIT/impersonation (`authz.ts:135-168`); **Ed25519 signing** + envelope KEK/DEK rotation (`keys.ts`); light dep-root (runtime/cloud-core only) | live `enterprise/authz.ts` = RBAC only; `security/auditChain.ts` documents an **unmitigated forgery gap** Ed25519 would close; `secureStore` = single flat safeStorage blob | **B (harvest ABAC + Ed25519 + envelope-encryption — each its own gated slice)** |
| `persistence` | append-only event store with **content-hash tamper-evidence + upcaster + snapshot** (`eventStore.ts:71-141`); PREVIEW PGlite infra | live `platform/command/domainEventLog.ts` = in-memory Map, no hash/snapshot; live persistence = JSON files | **B (harvest hash/upcaster/snapshot PATTERN into domainEventLog — NOT the PGlite engine)** |
| `reliability` | **SLO/error-budget** formula (burn-rate, budget-ms, `slo.ts:66-76`); measured heap-delta chaos fault | live has **no** error-budget concept; live `sandbox/lab/chaosEngine.ts` deliberately probes memory-pressure by a host-safety contract | **B (harvest error-budget — DONE this session)**; chaos harvest **REJECTED** (would breach the live engine's host-safety design — Rule 5: live is superior for its context) |
| `automation` | tiered HITL classifier; SLA metrics over history | live governance/approval boundary (S46–S104) already deep + adversarially certified | **E** (not confidently non-duplicate) |
| `operations` | incidents/health/DR | live `operationsPlatform/` + `autonomousOps/` already real | **E** |
| `business` | in-memory double-entry `ErpCore` (trivial) | live ERP (S11–S104: GRNI, 3-way match, WIP/variance, reversal, crash recovery, SoD) — vastly superior | **F** |
| `industry` | industry verticals on top of `business` | live `industry/`, `industryPacks/` already wired | **F** |
| `connectors` / `integrations` | generic connector scaffolding | live `connectors/` (OAuth+PKCE, vault, M365 suite, webhook verify, first-real-send guard, supervisor) — vastly superior | **F** |
| `federation` / `workplace` / `workspace` / `commercial` / `production` / `nems` / `cloudops` | composition wrappers at the top of the spine | live `federation*/`, `workspaces/`, etc. already real | **F** |

### Deployment / launch-workstream cluster (14 pkgs)
`platform-automation`, `platform-operations`, `environment-provisioning`, `deploy`, `deployment-orchestrator`, `operator-deployment`, `customer-deployment`, `infrastructure`, `release`, `customer-experience`, `enterprise-connectivity`, `trust-platform`, `integration-platform`, `connectivity` — verified **infra-descriptor/PREVIEW generators**: their own headers state "Infrastructure is NEVER classified live; assets are represented, not created"; `terraform.ts` emits HCL **string templates** never executed. Zero app consumers, no runtime capability. → **F (group)**.

### Genuinely-kept (not island): `shared`, `cst`, `companion-protocol`, `solution-packs` (desktop-wired), `cloud-core`/`shared-cloud`/`runtime` (backend-wired), `cli`/`certification`/`sdk` (dev tooling — **E**).

---

## 3. RETIREMENT-CANDIDATE LIST — ⛔ APPROVAL REQUIRED (NOTHING DELETED)

Per Rule 1 & 8, these are **classified only** — no deletion, archive, workspace/tsconfig removal, or build-exclusion has been or will be performed without explicit operator approval. They are retirement-candidates because their capability is either **strictly inferior to a live subsystem**, **a trivial utility cheaper to rewrite than extract**, or **a non-executing descriptor generator** — and any value they hold is captured in the Harvest Backlog (§4).

**Retirement-candidates (approval required):** `ai-runtime`* , `workforce`, `autonomous-ops`, `execution`, `intelligence`*, `ckdl`* , `business`, `industry`, `connectors`, `integrations`, `federation`, `workplace`, `workspace`, `commercial`, `production`, `nems`, `cloudops`, and the 14-package deployment/launch cluster.
(*`ai-runtime`, `intelligence`, `ckdl` become retirement-candidates **only after** their harvest items in §4 are completed — harvest first, retire later, on approval.)

**Not retirement-candidates:** `automation`, `operations` (E — kept experimental, deeper diff pending); `security`, `persistence`, `reliability` (B — active harvest sources, keep until harvested); `cli`, `certification`, `sdk` (E — dev tooling).

**No action is requested this session beyond acknowledgement.** Deletion, if ever desired, is a separate operator-approved slice per package.

---

## 4. HARVEST BACKLOG — ordered, each its own future slice

Every item lands in an existing live subsystem, imports nothing from the parallel root, and carries a safety class. Ordered by value ÷ risk.

| # | Harvest | Source → live target | Safety class | Status |
|---|---|---|---|---|
| H1 | **Error-budget / burn-rate calculator** | `reliability/slo.ts` → `operationsPlatform/errorBudget.ts` | SAFE-ADDITIVE (pure, non-frozen, non-certified) | **DONE this session** |
| H2 | **Multi-signal explainable TrustModel** (advisory, never sets authority) | `ckdl/trust.ts` → new `liveBrain`-adjacent pure module | SAFE-ADDITIVE but advisory-only; needs a read-only consumer; must honor §2 #15/#16 (score ≠ authority) | queued |
| H3 | **Event-log tamper-evidence** (row content-hash + upcaster + snapshot pattern) | `persistence/eventStore.ts` → `platform/command/domainEventLog.ts` | SPINE-SENSITIVE — the command/event durability path (S40/S41 certified); reproduce-first + own slice | queued |
| H4 | **ABAC policy evaluator** (deny-wins, simulate/test) | `security/policy.ts` → `enterprise/authz.ts`/`runtimeAuthz` | AUTHZ-CRITICAL — likely FG gate; own reproduce-first slice | queued |
| H5 | **Ed25519 audit-chain signing** (closes the documented forgery gap) | `security/keys.ts` → `security/auditChain.ts` | SECURITY-CRITICAL — own slice | queued |
| H6 | **Envelope encryption + KEK/DEK rotation** | `security/keys.ts` → `security/secureStore.ts` | SECURITY-CRITICAL — own slice | queued |
| H7 | **Ordered-step orchestrator with compensating rollback** | `ai-runtime/workflows.ts` (shape) → new `orchestration/` module on the live bus | DESIGN-SENSITIVE — Rule 3 forbids a second workflow *engine*; this is an agent-step orchestrator distinct from the approval workflow runtime; needs a design note + operator input | queued |
| H8 | **Decision-quality checklist** (`missingEvidence`) | `ckdl/analysis.ts` → advisory over `liveBrain` proposals | SAFE-ADDITIVE, minor | queued |

**Nothing above touches an economic mutation, and none grants AI authority** — every harvest is either advisory, a pure calculator, or a governance/integrity *strengthening* that flows through the existing control plane (Rule 6: AI never mutates ERP/GL/inventory/payments/HR/tenant state directly).

---

## 5. EXECUTED THIS SESSION — H1: error-budget calculator (SAFE-ADDITIVE harvest)

- **New files (production + test):** `apps/desktop/src/main/operationsPlatform/errorBudget.ts` + `errorBudget.test.ts`.
- **What:** a pure, total `computeErrorBudget({target, windowMs, observedDowntimeMs})` → `{budgetMs, consumedMs, remainingMs, burnRate, status}`. Harvested (adapted, **not imported**) from `packages/reliability/src/slo.ts:66-76`; zero dependencies, no spine import, no clock/store/governance.
- **Why safe:** `operationsPlatform` is live, tested (stage9), **non-frozen** (gate-detector **PROCEED**), and off the certified economic/authz/command-spine paths. The math is definitional — `budget=(1−target)·window`, `burnRate=consumed/budget`, `breached` at `burnRate≥1` — **not invented accounting/business policy**. The one convention, the `at-risk` display band (`AT_RISK_BURN=0.75`), is an SRE-standard operational display default carried verbatim from the source and overridable — explicitly NOT a GL/accounting/approval value, so it is outside the "no business-policy invention" rule.
- **Honesty preserved (no orphan, no fake):** the live SLA framework (`slaFramework.ts`) has a standing law — *"a target with no measuring aggregate is `unmeasurable`, never estimated."* Wiring error-budget into the SLA report requires a **real observed-downtime aggregate**, which does not exist today; inventing one would violate that law. So per the repo's established "pure-model-first, wiring-gated" pattern (S81/S83/S84), **H1 lands the pure, tested calculator and explicitly GATES the SLA-report wiring** to a follow-up slice that first provides a genuine downtime source. The module is exercised by 12 unit tests (definitional cases, boundary at `burnRate===1`, over-burn, `target=1` zero-budget, negative/over-window/NaN clamps, override banding).
- **Proof:** `errorBudget.test.ts` **12/12 passed**; full node typecheck **exit 0**; eslint **clean**; `slaFramework.stage9.test.ts` baseline **7/7** (unchanged — no live file modified). gate-detector **PROCEED**. No frozen surface, no `baseline.json`, no release-track file touched.

---

## 6. WHAT WAS DELIBERATELY NOT DONE (and why that is the correct call)

- **No package imported / wired directly** — every leaf drags in the parallel spine (§1); direct integration would build a second command/event/AI/persistence spine (Rule 3 violation).
- **No package deleted, archived, or excluded** — retirement is classification-only, STOP-for-approval (Rule 1).
- **Chaos measured-heap harvest REJECTED** — the live chaos engine intentionally probes `memory-pressure` under a host-safety contract; the package's allocate-and-measure would breach it. Comparing both (Rule 5), the live implementation is superior for its safety context.
- **H2–H8 not force-landed** — each touches an advisory/authz/security/spine surface that demands its own reproduce-first slice (and H3–H6 likely an FG gate). Ramming them into a single broad session would violate the standing discipline (reproduce-first, no fake green, no orphan, frozen-gated). They are specified and queued, ready to execute on the operator's go — the same gated cadence every prior change in this repo followed.

---

## 7. STATUS & RECOMMENDED NEXT

- **Production change:** one additive pure module + its test (`operationsPlatform/errorBudget.{ts,test.ts}`). **No live file modified. No frozen surface. No deletion. `baseline.json` untouched. Release-track untouched.**
- **Rules honored:** no direct deletion (1); unwired≠useless, inspected deeply (2); canonical spine preserved, no duplicate infra (3); harvest-into-canonical preferred (4); modularity kept, no folder-flatten (5); AI never granted direct mutation (6).
- **Recommended next harvest:** **H2 — the TrustModel** (advisory, on-mission for governed AI, self-contained) OR **H3 — event-log tamper-evidence** (integrity strengthening on the durability spine). Both are their own reproduce-first slices; H3 additionally needs an S40/S41 regression pass. **Awaiting operator go — no auto-proceed.**
- **Approval requested (non-blocking):** acknowledgement of the §3 RETIREMENT-CANDIDATE list. Nothing is deleted until you approve, per Rule 1/8.
