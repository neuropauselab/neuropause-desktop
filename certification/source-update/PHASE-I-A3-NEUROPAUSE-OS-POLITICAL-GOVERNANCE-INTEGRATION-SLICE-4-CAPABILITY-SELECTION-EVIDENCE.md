# NeuroPause OS — Political-Governance Integration / Slice 4 — Capability Selection ("AI proposes, NeuroPause verifies")

**The first missing seam after AI capability-awareness is VALIDATED CAPABILITY SELECTION: turning an AI-proposed
`capabilityId` into a capability that NeuroPause has verified against the authoritative, tenant-scoped catalog —
refusing invented / cross-tenant / mis-routed / unavailable / governance-not-proven requests, and binding jurisdiction
by the runtime rather than the model. Pure, additive, non-executing, non-frozen. No frozen surface, no shared/IPC
contract, no execution, no governance change, no packages imported. No commit, no push.**
Labels: `[PROVEN]` `[IMPLEMENTED]` `[TEST-VERIFIED]` `[NOT LIVE-VERIFIED]` `[OPEN]` `[DEFERRED]` `[BLOCKED]`.

## Slice framing (Phase 33)
- **CURRENT REALITY** `[PROVEN]`: Slices 1–3 give a live, tenant-scoped capability catalog (Article 2 jurisdiction),
  injected into the AI context as read-only description (Article 15 — AI is representative, not sovereign). But the
  "AI/planner entry point" `selectCapability` (`capabilities/capabilityCatalog.ts:191`) and `aiSelectable()`
  (`capabilityDiscoveryService.ts:131`) have **no caller**; the assistant consumes the catalog for context only
  (`assistant/index.ts:331-332`); its `capabilities` port (`assistantService.ts:95`) is never read; `buildPlan`
  (`assistantModel.ts:327`) is capability-blind, and `AssistantPlanStep` (`packages/shared/.../assistant.ts:101`)
  carries only `executionKind`+`targetId` (internal ids), no `capabilityId`.
- **MISSING SEAM** `[PROVEN]`: nothing turns an AI-proposed capability into a VALIDATED selection. Proven by two
  read-only traces (assistant intent→proposal; governed-proposal contract).
- **WHY IT MATTERS**: this is the political boundary — the AI now *knows* capabilities, so the very next thing must
  be NeuroPause *verifying* any capability the AI names, before it could ever become a proposal (Phase 12 §12: "Never
  accept model-generated capability metadata as authoritative. AI can request/select; NeuroPause verifies").
- **EXACT SOURCE LOCATION**: the gap sits between `classifyAssistantIntent`/`buildPlan` (`assistantModel.ts:183,327`)
  and `decideStep` dispatch (`assistantService.ts:672`).
- **FROZEN/NON-FROZEN**: implemented entirely in the (non-frozen) `capabilities/` module. `AssistantPlanStep`,
  `JobProposal`, `ExecutionBinding`, `GovernanceVerdict` are FROZEN (`packages/shared`) — so this slice does NOT
  carry the result on any proposal type (that is the next gate).
- **MINIMUM CHANGE**: one additive method + pure function + result types on my Slice-2 service; one new test file.
- **SECURITY IMPACT**: strictly tightening — adds an authoritative validation gate; grants nothing.
- **CERTIFICATION IMPACT**: NONE (below).
- **TEST PLAN**: happy path, every refusal, authority-not-weakenable, cross-tenant, ambiguity, fail-closed, no-leak,
  determinism, end-to-end via the service.

## Files changed `[PROVEN]`
- **M** `apps/desktop/src/main/capabilities/capabilityDiscoveryService.ts` (Slice-2, mine, NON-FROZEN) — added
  `CapabilitySelectionRequest` / `CapabilitySelectionOutcome` / `CapabilitySelectionStatus`, the pure
  `resolveCapabilitySelection(view, request)`, and the service method `resolveSelection(request)`. Pure; no store,
  Electron, IPC, credential, or execution.
- **A** `apps/desktop/src/main/capabilities/capabilitySelection.test.ts` — 15 tests.
No frozen file, no `packages/shared`, no `ai/`, no assistant file, no `package.json`, no IPC channel touched (§frozen).

## What the selection does `[IMPLEMENTED / TEST-VERIFIED]`
`resolveSelection(request: {capabilityId, accountId?, purpose?})` validates against the service's OWN active-workspace
catalog and returns one honest outcome — mapping the Constitution:
- `NO_INTENT` — no capability named.
- `NOT_FOUND` — id/account not in this tenant's catalog. Covers **invented** (Article 15 / Phase-17.4), **cross-tenant**
  (Article 2 / 17.20 — a ws-B account is simply absent from the ws-A view), and **account-substitution** (17.21).
- `AMBIGUOUS_ACCOUNT` — id matches >1 account, none named → refuse, never guess (Phase 6 "do not guess an account").
- `UNAVAILABLE` — matched but reauth/unavailable (17.9 — never silently usable).
- `GOVERNANCE_NOT_PROVEN` — matched mutation not certified → discoverable ≠ executable, never promoted (Article 6 /
  Phase 10 / 17.10).
- `SELECTED` — real, in-jurisdiction, available, governed-certified (or a read). Carries `requiresApproval` +
  `governanceStatus` from the AUTHORITATIVE match. **SELECTED is validation, NOT execution authority** — governance,
  approval and admission still run downstream (Articles 5–7); the reason string says so.

Jurisdiction (Article 2) is bound by the SERVICE's active workspace, never taken from the request — the AI cannot ask
across tenants. All authority flags come from the catalog match, never the untrusted request (Article 3 — AI may not
enlarge the mandate). `purpose` (the mandate) is echoed only as neutralized data.

## Universal-governance tests at this layer `[TEST-VERIFIED]`
`capabilitySelection.test.ts` **15/15**: SELECTED (action w/ approval + governance; read w/o approval); NO_INTENT;
NOT_FOUND (invented); NOT_FOUND (wrong account — no substitution); AMBIGUOUS_ACCOUNT (never guesses); UNAVAILABLE;
GOVERNANCE_NOT_PROVEN (not promoted; requiresApproval stays false); request text cannot lower approval; cross-tenant →
NOT_FOUND; empty/fail-closed catalog → NOT_FOUND; deterministic + side-effect-free; no credential/callable in the
outcome (structural + JSON scan); end-to-end via the live service (SELECTED within ws; no workspace → NOT_FOUND).
The pre-existing AI-boundary (`assistantAiBoundary.test.ts`) and governance/CST suites are untouched and green.

## Regression `[PROVEN]`
Capability dir **63/63** (21+15+14+13). Full main suite **8596 passed / 3 skipped / 814 files** (Slice-3 baseline
8581/3/813; +15/+1, no regression). Typecheck clean. Changed-file lint clean (`--max-warnings 0`). `git diff --check`
clean. (Pre-existing repo-wide lint error in `cst/sendTransition.negative.test.ts` untouched — documented since Slice-1.)

## Frozen audit `[PROVEN]` — **CLEAN**
`git diff --stat` over the frozen set (connectors/index.ts, connectors/m365/*, cst/*, executeEngine.ts,
executionStore.ts, boundaryB.ts, workforce/runtime/executor.ts, runtimeCore.ts, storeScope.ts, **ai/**,
**packages/shared**, package.json) = **empty**. No frozen-gate report required for this slice.

## Certification impact `[PROVEN]` — **NONE**
No change to identity / authority / tenant binding / policy / verdict / approval / canonical action identity /
admission / idempotency / effect boundary / M365 governance / verification / cohort membership. M365 29/29 and the
coverage guard UNCHANGED; CST UNCHANGED. Selection validates a description; it grants no authority and runs no effect.

## Live verification `[NOT LIVE-VERIFIED]` — proven over real store/action shapes via the exact adapter the wiring
uses, not against a live tenant/model turn.

## WHAT CONNECTED / WHAT DID NOT
- **Connected** `[TEST-VERIFIED]`: an authoritative, jurisdiction-bound, governance-aware capability-selection
  validator (`resolveSelection`) — the "NeuroPause verifies" half of Phase 12 §12. It is a live, callable method on
  the capability service (the seam the next slice will invoke).
- **Did NOT connect** `[OPEN]`: the validator is not yet CALLED by the assistant. Wiring it requires (a) the model to
  emit a parseable proposed `capabilityId`, and (b) a field to carry the validated selection into a proposal —
  `AssistantPlanStep`/`JobProposal`/`ExecutionBinding` are FROZEN (`packages/shared`) and none carries `capabilityId`.

## REMAINING / EXACT NEXT GATE `[DEFERRED]`
Slice 5 — VALIDATED SELECTION → STRUCTURED PROPOSAL into the existing governed pipeline. This needs a carrier for the
authoritative `capabilityId` on a proposal. Options: (a) a **frozen-gate** to add an optional `capabilityId` to
`ExecutionBinding`/`AssistantPlanStep` in `packages/shared` — requires a dedicated FROZEN GATE REPORT (file, function,
reason, minimal change, security + certification impact, tests, rollback); or (b) a non-frozen side-carrier that
correlates by authoritative ids. Prove the route from source before implementing; do not modify frozen surfaces
without the gate. Still: AI proposes, governance decides, human consents, admission authorizes, connector executes —
no AI execution.

## STOP
Validated capability selection implemented as a pure, authoritative, non-executing gate; every invariant (no-invent,
no-cross-tenant, no-substitute-account, no-guess, no-silent-promotion, authority-not-weakenable, fail-closed) is
tested. No frozen surface, no shared/IPC change, no execution, no packages imported, no live claim. HEAD `670b52e`;
changes unstaged. No commit. No push. STOP after this slice.
