# SESSION 117 — AI PROPOSAL GOVERNANCE + REAL AUDIT-KEYCHAIN PROOF

**Date:** 2026-09-04 · **Branch:** `cert/data-import-cst-integration`
**Label:** TEST-VERIFIED (Linux CI). Real macOS keychain proof = **OPERATOR-PENDING**.

---

## OBJECTIVE 1 — REAL macOS H5/H6 + S115 END-TO-END → OPERATOR-PENDING
This session's shell is a **Linux aarch64 sandbox** (`uname` = Linux; `electron/dist` empty — macOS-only). The bash tool does NOT run on the user's Mac, and the desktop-control tool is typing-blocked at the granted tier for Terminal, so I **cannot** exercise `safeStorage`/keychain here. Per the honesty rule I did not fake GREEN.

Ready for the operator on macOS:
- `apps/desktop/e2e/s113AuditSignJourney.e2e.cjs` (verified correct S116) — the H5+H6 primitive: real `safeStorage` provision→recover across restart + Ed25519 sign/verify/tamper. Runbook in `SESSION116-KEYCHAIN-SECURITY-CONVERGENCE.md §O1`.
- The full S115-modules harness (DurableAuditKeyProvider → OS keychain → AuditLog → integrityStatus → renderer four-field surface) remains the recommended next real-Electron artifact (S118 candidate #2). Until run on macOS: SIGNED-after-restart / VERIFICATION_FAILED-after-tamper / UNSIGNED-no-key / four-field-only stay TEST-VERIFIED (S115 signing 10/10 + UI 4/4), not PASS.

**REAL MAC KEYCHAIN: OPERATOR-PENDING.**

## OBJECTIVES 2–5 — SAFE AI CAPABILITY HARVEST (IMPLEMENTED)
New pure module `apps/desktop/src/main/ai/proposalValidation.ts` in the canonical live AI tree — an advisory, pre-execution AI-proposal metadata + tool-argument validation layer. It harvests ONLY the pure S116-identified semantics and **reuses** the authoritative live pricing table:
- `estimateTokens(text)` — canonical pure token estimate (~4 chars/token). **De-duplicated the private copy in `mockClient.ts`, which now imports it → a real production consumer in the same slice.**
- `estimateProposalCost(model, promptTokens, completionTokens)` — delegates to the EXISTING `ai/pricing.ts` `computeCostUsd`/`MODEL_PRICING` (NO second pricing table). Returns `estimateOnly: true` and `pricingKnown` (unknown model ⇒ cost 0 **and** pricingKnown=false — honest, not "free").
- `validateToolArguments(toolName, schema, rawArgs)` — pure Zod `safeParse` → structured `{path, message, code}` errors; the caller passes the TRUSTED tool's own schema. Never executes.
- `buildProposalMetadata({model, promptText, completionText?, tool?})` → `{ estimate, toolValidation?, advisory: true }` — inert advisory data attached before the existing governance/confirmation step.

**NOT harvested (correctly):** ai-runtime's `estimateCost` (duplicate of live pricing), `withTimeout` (secureBridge already has S115 timeout), and the entire runtime (`createAiRuntime`/`AgentRuntime`/`ToolRuntime`/`WorkflowEngine`/`ConnectorRuntime`/`InferencePipeline`/`GovernanceRecorder`) — a second runtime / autonomous-execution risk.

## OBJECTIVE 3 — CANONICAL AI ARCHITECTURE (preserved)
The slice is a thin module inside `apps/desktop/src/main/ai/` reusing `ai/pricing.ts`. NO new AI runtime, tool registry, agent-state store, workflow engine, event system, or memory system. The governed path is untouched: AI proposal → governed tool → authn/authz → business policy → approval → command → durable transaction → event/outbox → audit. Consequential execution remains governed; no autonomous execution introduced. The governed `liveBrain` propose lane (`brainProposeLane.ts`) was deliberately NOT modified.

## OBJECTIVE 6 — ADVERSARIAL TESTING (17/17)
`proposalValidation.test.ts`: invalid/missing/extra(strict)/wrong-type/boundary args rejected; unknown schema fails closed (`no_schema`); a throwing schema fails closed (`schema_error`); non-object args fail closed; validation confers no authority (no `allow`/`authorized` field; metadata top-level keys exactly `advisory/estimate/toolValidation`, no grant/permission/role/tenant/confirmed/credential/authority/privatekey); estimated cost is inert; the API takes NO principal/tenant/authority parameter; **STRUCTURAL guard** — the module imports ONLY `./pricing` + `zod` and contains no executor/commandBus/dispatchCommand/runtimeAuthz/cst/store/`.execute(` reference. Cost distinguishes estimated vs `pricingKnown`; no network, no provider credential.

## OBJECTIVE 7 — CONNECTOR CONVERGENCE (documented candidate; not implemented)
S114 webhook→event path preserved untouched; no consequential M365 executor write widened. Safe candidate for a future session: **read-only connector capability discovery / inbound-event lineage metadata normalization** — an advisory context-quality enrichment carrying no authority, fitting the existing connector framework (no second framework). Deferred (the AI slice is this session's primary outcome).

## OBJECTIVE 8 — SECURITY CONVERGENCE (unchanged)
ABAC stays advisory (S116 `explainAbacDecision`). Delegation/JIT/impersonation/ABAC-enforcement NOT wired (policy + FG gate required). The new AI proposal layer **cannot** become an authorization surface — proven by the no-authority-fields + structural-import + no-principal-param tests. Security remains RBAC ∧ ABAC(advisory) ∧ CST ∧ approval.

## OBJECTIVE 9 — CONVERGENCE MATRIX (delta)
- **Harvested-to-live (cumulative):** ckdl TrustModel (S108); ABAC eval (S110) + explanation (S116); Ed25519 audit signing (S111); envelope crypto/KEK-DEK (S112); signed audit chain + durable key (S113/S115); domain event-log tamper-evidence (S109); webhook event port (S114); **AI proposal metadata/validation (S117)**.
- **packages/ai-runtime:** pure `estimateTokens` harvested; `estimateCost`/`withTimeout` = duplicate (not harvested); runtime = **C, do-not-activate**; scaffolding = **D**.
- **packages/security:** delegation/JIT/impersonation = **B/BLOCKED-POLICY**; identity/sessions/tenancy/authz = duplicate (C→E, operator-gated); matrix = read-only ref (A).
- **packages/persistence:** SQL spine = **C, do-not-adopt**; upcaster = **B, memo** (S116).
- **apps:** desktop canonical; backend/cloud/mobile unchanged. **No package deleted or retired.**

## STATUS
- **S117 STATUS: TEST-VERIFIED**
- **REAL MAC KEYCHAIN: OPERATOR-PENDING** (Linux sandbox; harness + runbook ready; not faked)
- **IMPLEMENTED:** `ai/proposalValidation.ts` (estimateTokens, estimateProposalCost, validateToolArguments, buildProposalMetadata) + mockClient de-dup consumer
- **TESTED:** proposalValidation 17/17; mockClient consumers + contextBuilder 66-suite green; S104 8/8; abac 20/20; full main all 8 batches (~10,646 passed / 7 skipped); typecheck node 0; lint 0; gate-detector PROCEED (non-frozen)
- **HARVESTED:** pure token estimator + Zod tool-arg validation pattern (from ai-runtime), reusing live pricing
- **BLOCKED-FROZEN:** none (no frozen change)
- **BLOCKED-POLICY:** ABAC enforcement; delegation/JIT/impersonation; ai-runtime second runtime / autonomous execution; ERP undefined approval/SoD/threshold/reversal/posting/accounting
- **OPERATOR-PENDING:** real macOS keychain journey
- **DEFERRED:** connector read-only discovery/lineage metadata; full S115-modules macOS harness; persistence upcaster (memo)

**AI capability activated:** advisory AI-proposal metadata + tool-argument validation (pre-execution, zero authority). **Connector:** none (S114 preserved). **Security:** none new (ABAC stays advisory). **ERP/CRM/HR:** none (spine untouched).

## FILES / COMMITS / GATES
- Files: `apps/desktop/src/main/ai/proposalValidation.ts` (new), `apps/desktop/src/main/ai/proposalValidation.test.ts` (new), `apps/desktop/src/main/ai/mockClient.ts` (de-dup import), `certification/SESSION117-AI-PROPOSAL-GOVERNANCE.md` (new).
- Frozen gates used: **none.**

## TOP 3 SAFE CAPABILITIES FOR S118
1. **Wire `buildProposalMetadata` into a live AI proposal producer** (attach advisory estimate/validation to the assistant/draft surface, decision-neutral) — gives the S117 slice an end-to-end live consumer without touching governed decision logic.
2. **Full S115-modules macOS keychain harness** — real DurableAuditKeyProvider→keychain→AuditLog→integrityStatus→renderer four-field proof across restart (closes O1 scope; macOS-operator run).
3. **Read-only connector capability discovery / inbound-event lineage metadata** (Objective 7 candidate) — advisory context-quality enrichment, zero authority, existing connector framework.
