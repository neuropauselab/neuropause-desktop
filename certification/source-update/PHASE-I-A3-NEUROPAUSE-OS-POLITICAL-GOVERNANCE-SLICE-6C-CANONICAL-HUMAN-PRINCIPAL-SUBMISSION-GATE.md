# NeuroPause OS — Political-Governance / Slice 6C — STOP CODE: Canonical Human-Principal Submission Gate

**STOP. No code written. The authorized minimum frozen change (extend `executeJob` + add a proposal `principal` field)
CANNOT carry an AI-capability human-principal proposal into the canonical governed lifecycle without triggering STOP
conditions #3 (synthetic worker), #4 (worker falsely represented as human), #9 (second proposal architecture), and #15
(fundamental worker-governance redesign). The canonical proposal is minted only inside a WORKER + SKILL context, and
no legitimate human/delegate worker exists. Preserving the human as PRINCIPAL (not as a worker) at this boundary
requires a separate, explicitly-authorized governance-model-extension gate. This is that report; it changes nothing.**
Status: `SOURCE-PROVEN` · `NOT-EXECUTED` · `FROZEN` · `DEFERRED`.

## Baseline `SOURCE-PROVEN`
HEAD `670b52e` (unchanged), branch `cert/data-import-cst-integration`, `git diff --check` clean. Prior Wave-2 +
Slice-1..6B capability work preserved unstaged. This slice added only this report. No commit, no push.

## Source proof of the wall `SOURCE-PROVEN`
1. **Sole mint requires worker + skill:** `executeJob(args: ExecuteArgs)` — `ExecuteArgs` REQUIRES
   `worker: Worker` and `skill: SkillImpl` (`workforce/runtime/executor.ts:35-46`). The proposal's `verdict` is
   `deps.evaluate(request, worker, now)` (`executor.ts:102`). No worker/skill ⇒ no `JobProposal`.
2. **Governance is worker-authority:** `evaluateAction(req, {worker: Worker})` (`policyEngine.ts:151-157`); every check
   reads the worker's scopes/trust. No human-subject governance entry (confirmed Slice 6A).
3. **No legitimate human/delegate worker:** the roster is entirely autonomous DOMAIN workers — `executive`,
   `engineering`, `hr`, `founder`, `finance`, `operations`, `marketing`, `legal`, `support`, `infrastructure`
   (`workforce/workers/*.ts`). None represents a human principal or user-delegated authority.
4. **No arbitrary-binding skill:** all skills hardcode `{executor,target,actionId}` (`common.ts:489-495`); dispatch/
   enqueue pass only `input` (Slice 6). The validated capability selection cannot drive a proposal via existing skills.

## Why the authorized minimum frozen change is insufficient `SOURCE-PROVEN`
6C authorized extending `executeJob` + adding a proposal `principal` carrier. But adding a `principal` field and even a
principal-stamping branch does NOT remove the structural requirement for a `worker`+`skill` origin and a worker-scoped
`evaluateAction`. To mint an AI-capability human-principal proposal you must still supply a worker, and the only ways
are:
- **(R1) a synthetic "capability/user" worker** → STOP #3 (synthetic worker), and a new proposal-producing origin →
  STOP #9;
- **(R2) reuse a domain worker** (e.g. `operations`) to carry the human's action → STOP #4 (the worker is falsely
  represented as the human principal, and governance evaluates that domain worker's trust/scopes — a category error);
- **(R3) change `executeJob` to mint without a worker** → `evaluateAction` (which requires a `Worker`) can no longer
  run → a fundamental worker-governance redesign → STOP #15.
There is no fourth route. Every path to the success condition is a declared STOP condition.

## Phase-9 minimum ("provenance + worker governance intact") — also unachievable `SOURCE-PROVEN`
Phase 9's minimum would require the AI-capability proposal to flow through a REAL worker (governance evaluates the
worker) with the human as PROVENANCE. But there is no real worker for AI-capability actions (roster is domain-
autonomous), and using a domain worker is STOP #4. So even the minimum cannot be met without a synthetic or misused
worker. (Binding an authoritative human principal onto the EXISTING worker path universally is also wrong: scheduled/
autonomous jobs have `requestedBy` `'system'`/`'workflow:'` and no human principal — a human principal must not be
fabricated for them.)

## Constitutional finding
The workforce proposal/governance pipeline assumes the PROPOSER is an autonomous worker. It has no seat for a human
PRINCIPAL who originates a proposal via an AI representative. Binding the human at the canonical proposal boundary
"without worker-substitution" (the explicit success condition) is therefore impossible in the current model. Making it
possible is not a field addition — it is a governance-model extension, which Phase 9 and STOP #15 require to be a
separate, explicitly-authorized gate, not smuggled here.

## Required next step — a distinct GOVERNANCE-MODEL EXTENSION gate (design + authorization) `DEFERRED`
A first-class **human-principal proposal origin** ALONGSIDE (never replacing) worker governance:
- a principal-scoped proposal/ActionRequest whose authority basis is the HUMAN's jurisdiction (tenant/workspace/
  connected account = the capability catalog scoping) + policy — not a worker's trust score;
- a governance evaluation path that judges the human-principal request (reusing the policy engine's rules where
  applicable) without pretending a worker asked;
- approval unchanged (authoritative human consent, separate from provenance);
- admission / Boundary-B / executor / certified M365 path all UNCHANGED downstream.
This is a fundamental additive governance change with real certification impact (a new consequential proposal origin);
it needs its own authorization, design, and certification review. It must NOT be approximated by a synthetic worker.

## What is already safely in place `TEST-VERIFIED`
Slice 6B's `PrincipalBoundProposal` (`capabilities/capabilityProposal.ts`) — the validated capability binding +
authoritative fail-closed human principal + purpose, non-executing — is exactly the input such a human-principal
governance path would consume. It is ready; the pipeline seat for it is not.

## STOP conditions triggered
#3 (synthetic worker), #4 (worker falsely represented as human principal), #9 (second proposal architecture), #15
(fundamental worker-governance redesign). Per the mandatory STOP rule: STOP CODE, write the gate, no workaround.

## Frozen audit `SOURCE-PROVEN` — **CLEAN** (nothing modified). Certification impact — **NONE** (nothing changed).
## Live status — `NOT LIVE-VERIFIED`. Pilot — `NOT PILOT-VALIDATED`.

## STOP
Traced, not built. The human principal cannot be bound at the canonical proposal boundary without a synthetic/misused
worker or a worker-governance redesign — all STOP conditions. The correct path is a separately-authorized human-
principal governance-origin gate. No frozen surface modified, no synthetic worker, no workaround, no live claim. HEAD
`670b52e`; changes unstaged. No commit. No push. STOP — do NOT start Wave-3.
