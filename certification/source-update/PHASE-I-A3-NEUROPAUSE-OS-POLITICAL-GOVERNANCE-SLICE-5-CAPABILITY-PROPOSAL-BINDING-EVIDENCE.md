# NeuroPause OS — Political-Governance / Slice 5 — Capability → Proposal Binding

**The validated capability now binds to the authoritative identity the governed proposal lifecycle ALREADY
recognizes — using the SAME `{executor, target=connectorId, accountId, actionId}` the frozen `ExecutionBinding`
carries, because the catalog's `capabilityId` IS the connector `actionId`. Option A (non-frozen carrier) chosen and
proven; NO frozen change required to carry the capability. Pure, additive, non-executing. No frozen surface, no
shared/IPC contract, no execution, no governance change, no packages imported. No commit, no push.**
Labels: `[PROVEN]` `[IMPLEMENTED]` `[TEST-VERIFIED]` `[NOT LIVE-VERIFIED]` `[OPEN]` `[DEFERRED]` `[BLOCKED]` `[FROZEN]`.

## Current reality `[PROVEN]`
HEAD `670b52e` (unchanged), branch `cert/data-import-cst-integration`, `git diff --check` clean; prior slices preserved.
Slice 4 gave `resolveCapabilitySelection` (validated, tenant-scoped, non-executing). The validated capability had no
carrier into the governed proposal contract. This slice supplies the carrier.

## First missing seam + source proof `[PROVEN]`
The validated capability was not correlated to any proposal identity. Proven decisive facts (traced this slice):
- `capabilities/capabilityCatalog.ts:139` sets **`capabilityId: action.id`** — the capabilityId IS the connector action id.
- The frozen `ExecutionBinding` (`packages/shared/src/types/workforceJobs.ts:39-49`) already carries
  **`{ executor, target(=connectorId for m365), accountId, actionId }`**, where `actionId` is documented as
  "InfraAction.id / WriteAction.id".
- The M365 executor resolves the action AUTHORITATIVELY by `actionId` — `connectors/m365/executor.ts:85`
  `this.byId.get(actionId)`, unknown ⇒ refused.
∴ the validated capability's identity `{ executor, connectorId, accountId, capabilityId }` maps EXACTLY onto existing
`ExecutionBinding` fields; `capabilityId` is the `actionId`, not a new axis.

## Options considered → chosen `[PROVEN]`
- **Option A (non-frozen carrier)** — reuse the existing `ExecutionBinding` identity `{executor, target, accountId,
  actionId=capabilityId}`. **CHOSEN.** No frozen change needed to carry the capability.
- **Option B (frozen field, e.g. `capabilityId?` on ExecutionBinding)** — REJECTED as unnecessary: it would duplicate
  the `actionId` that already uniquely identifies the exact governed action and already flows to execution/evidence.

## Digest / identity analysis (Phase 11) `[PROVEN]`
`capabilityId === actionId`, and `actionId` is part of the `ExecutionBinding` that feeds the bound-decision claim /
`bindingDigest` → `decisionId` → durable admission → evidence (Slice-2 chain, unchanged). So the selected capability's
semantic identity ALREADY survives to execution and evidence via `actionId`. No new digest participation, no
cryptographic-identity change, no replay-surface change. `capabilityId` is descriptive of the same identity, not a
second one.

## Files changed `[PROVEN]`
- **A** `apps/desktop/src/main/capabilities/capabilityProposal.ts` — `ProposalBindingDraft`, `ProposalBindingResult`,
  pure `bindCapabilityToProposal(selection)`. No store/Electron/IPC/credential/execution.
- **A** `apps/desktop/src/main/capabilities/capabilityProposal.test.ts` — 12 tests.
- **M** `apps/desktop/src/main/capabilities/capabilityDiscoveryService.ts` (Slice-2, mine, NON-FROZEN) — added
  `executor: ExecutorKind` to `AssistantCapability` (+ projection) so the draft carries the authoritative executor.
- **M** two capability test helpers — added `executor` to their `AssistantCapability` fixtures.
No frozen file, no `packages/shared`, no `ai/`, no assistant file, no `package.json`, no IPC channel touched (audit below).

## Authority / tenant / capability / proposal flow `[IMPLEMENTED / TEST-VERIFIED]`
`bindCapabilityToProposal(selection)`:
- **Only `SELECTED` binds.** Every refusal (`NO_INTENT`/`NOT_FOUND`/`AMBIGUOUS_ACCOUNT`/`UNAVAILABLE`/
  `GOVERNANCE_NOT_PROVEN`) → `ok:false`. Capability selection is NOT authorization: an unvalidated or ungoverned
  capability can never become a proposal binding.
- **Authority** — `requiresApproval`/`governanceStatus`/`consequential` come from the authoritative catalog match,
  never the AI; request text cannot lower them (tested).
- **Tenant** — jurisdiction is bound upstream by the service's active workspace (Slice 4); the draft inherits the
  in-tenant capability only.
- **Capability** — `draft.actionId === capabilityId` (tested; can never diverge); connector/account/executor from the
  authoritative capability.
- **Proposal** — the draft mirrors the `ExecutionBinding` identity subset + purpose (mandate). It carries NO
  parameters (Phase 9: a "send email" capability is not authority to send a specific message), NO credential, NO
  callable. It is a correlation draft — NON-EXECUTING, NOT a `JobProposal`.

## Security tests (Phase 10) `[TEST-VERIFIED]`
`capabilityProposal.test.ts` **12/12**: SELECTED governed-certified action binds with correct identity + political
facts; read binds w/o approval; `actionId === capabilityId` across ids; NO_INTENT/NOT_FOUND/UNAVAILABLE/
GOVERNANCE_NOT_PROVEN cannot bind; ambiguous cannot bind (never guesses); governance-not-proven never promoted;
request text cannot lower approval; draft is plain data (no function fields, no token material, no params);
deterministic. Slice-4 selection invariants (invent/cross-tenant/substitute-account/fail-closed) remain green
upstream. AI-boundary / CST / governance suites untouched and green.

## Regression `[PROVEN]`
Capability dir **75/75** (21+15+14+13+12). Full main suite **8608 passed / 3 skipped / 815 files** (Slice-4 baseline
8596/3/814; +12/+1, no regression). Typecheck clean. Changed-file lint clean (`--max-warnings 0`). `git diff --check`
clean. (Pre-existing repo-wide lint error in `cst/sendTransition.negative.test.ts` untouched — documented since Slice 1.)

## Frozen audit `[PROVEN]` — **CLEAN**
`git diff --stat` over the frozen set (connectors/index.ts, connectors/m365/*, cst/*, executeEngine.ts,
executionStore.ts, boundaryB.ts, **workforce/runtime/executor.ts**, runtimeCore.ts, storeScope.ts, **ai/**,
**packages/shared** incl. `workforceJobs.ts`/`ExecutionBinding`, package.json) = **empty**. No frozen-gate report
required for this slice — Option A needed none.

## Certification impact `[PROVEN]` — **NONE**
No change to identity / authority / tenant binding / policy / verdict / approval / canonical action identity /
admission / idempotency / effect boundary / M365 governance / verification / cohort membership. `bindingDigest` /
`decisionId` construction UNCHANGED (capabilityId reuses the already-bound actionId). M365 29/29 + coverage guard
UNCHANGED; CST UNCHANGED.

## Live status `[NOT LIVE-VERIFIED]` — proven over real catalog/binding shapes, not a live tenant/execution.
## Pilot status — NOT PILOT-VALIDATED. No user-visible surface changed.

## Remaining gap `[OPEN]`
The binding draft is not yet turned into an actual `JobProposal` that enters governance. Proposal creation today runs
through `workforce/runtime/executor.ts` (**FROZEN**) from deterministic worker `ProposedAction`s — there is no
non-frozen entry that accepts an AI-path binding draft and produces a governed `JobProposal`. So the draft is the
authoritative correlation object, but its submission into the governed pipeline is the next seam.

## Next gate (do NOT start) `[DEFERRED]`
Slice 6 — DRAFT → GOVERNED PROPOSAL. Investigate a NON-FROZEN submission path (e.g. a worker/skill in the non-frozen
`workforce/workers/common.ts` that accepts a validated binding and emits a `ProposedAction`+`ExecutionBinding`, which
the existing runtime governs) BEFORE considering any frozen change. If only a frozen entry exists, STOP and write the
frozen-gate report. Still: AI proposes, governance decides, human consents, admission authorizes, connector executes.

## STOP
Validated capability bound to the authoritative proposal identity via the existing (frozen-recognized) ExecutionBinding
fields — no frozen change, no new identity, no execution. Every invariant tested. HEAD `670b52e`; changes unstaged. No
commit. No push. STOP after this slice — do NOT start Slice 6.
