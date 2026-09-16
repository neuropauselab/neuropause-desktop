# NeuroPause OS — Political-Governance / Slice 6 — FROZEN GATE: Capability Proposal Submission

**STOP. No code written. Source tracing proves the validated capability binding cannot enter the canonical
`JobProposal → governance → approval → admission → execution` pipeline through a thin non-frozen bridge. The sole
`JobProposal` mint site is FROZEN, and the only non-frozen route requires a new proposal-producing worker/skill
architecture (a Phase-21 STOP condition). This is the mandated frozen/architecture gate report — it changes nothing
and requests explicit authorization for a chosen option.**
Status labels: `SOURCE-PROVEN` `NOT-EXECUTED` `FROZEN` `DEFERRED`.

## Baseline `SOURCE-PROVEN`
HEAD `670b52e` (unchanged), branch `cert/data-import-cst-integration`, `git diff --check` clean. Working tree carries
only prior-slice work; **this slice added no source, only this report.** No commit, no push.

## The exact blocker `SOURCE-PROVEN`
- **Sole `JobProposal` mint site:** `executeJob` in **`apps/desktop/src/main/workforce/runtime/executor.ts:53`**
  (mapping `:78-117`), which stamps each `ProposedAction` from `skill.run(...).proposals` → `ActionRequest` →
  `deps.evaluate(request, worker, now)` (`:102`) → the `JobProposal` literal (`:104-116`). **This file is FROZEN.**
- **`JobProposal`** type: `packages/shared/src/types/workforceJobs.ts:51` — **FROZEN.** **`ExecutionBinding`**
  (`:39-49`) — FROZEN; already carries `{executor, target, accountId, actionId}` (Slice-5 identity match holds).
- **The only NON-FROZEN feed into `executeJob`** is a `SkillImpl.run()` returning a `ProposedAction`
  (`workforce/sdk/index.ts:47-57`, NON-FROZEN; requires `permissions: WorkerPermissionScope[]` + `risk`).
- **No existing skill accepts an arbitrary binding.** Every executable skill hardcodes `{executor, target, actionId}`
  at definition (`workforce/workers/common.ts:457-512` `execSkill`, binding from literal `spec` at `:489-495`; e.g.
  `mailPair` → `actionId:'mail.send'` `:343`). Worker-dispatch (`runtimeCore.ts:2481`, FROZEN, `targetId`=workerId →
  `workforce/index.ts:573-578` picks the first skill) and enqueue (`runtime/scheduler.ts:78` `enqueue(JobSpec)`;
  `JobSpec` `workforceJobs.ts:113-125` = `{workerId, skillId, input?, …}`) pass only `input` (params) — never a
  binding identity or a caller-supplied proposal.
- **Missing carrier:** there is no non-frozen way to feed a runtime-minted, pre-validated `ProposedAction`/binding
  into `executeJob` for a job. Only `skill.run()` output is stamped.

## Governance principal — NOT the blocker `SOURCE-PROVEN`
`evaluateAction` / `GovernanceRuntime.evaluate` require a `Worker` (trust/permissions) — `policyEngine.ts:151-157`,
`governance/index.ts:38`; there is no human-subject governance entry. This is SATISFIABLE without mismatch: a binding
can ride a Worker granted `execute:action` at sub-floor trust, and `executionProposal` (`common.ts:177-188`) already
forces `require_approval` (`pol:high-risk-approval`, `policyEngine.ts:207-214`) plus the `executor.ts:85-87` binding
backstop. Human authority still enters authoritatively at APPROVAL (`approverAuthority.ts:13`). So the principal is
not the obstacle — the **stamping monopoly** is.

## Why non-frozen integration is insufficient `SOURCE-PROVEN`
An arbitrary validated capability binding can become a governed `JobProposal` ONLY by one of:
- **(i) FROZEN change** — extend `executeJob` (`workforce/runtime/executor.ts`) to accept a trusted, runtime-minted,
  pre-validated `ProposedAction`/binding for the job, instead of only `skill.run(...).proposals`. Violates "no frozen
  change."
- **(ii) NEW worker/skill architecture** — a generic "capability submission" worker + skill (non-frozen
  `workforce/workers/*` + `sdk`) that re-validates the request against the catalog and emits the `ExecutionBinding`.
  This is a **new proposal-producing origin** (Phase-21 STOP: "a workaround would create a second proposal
  architecture"), needs a new Worker on the roster (trust/permissions config), and hits the **model gap** below.
- **Narrow non-frozen case that does NOT meet the objective:** if the capability's `{executor,target,actionId}`
  already equals a shipped skill's fixed binding (e.g. `mail.send`/`mailPair`), dispatch/enqueue already reaches
  governance — but that path re-fires a HARDCODED skill; it does not carry the validated SELECTION identity and does
  not generalize to the catalog. It is not "validated capability → proposal."

## Model gap `SOURCE-PROVEN`
`ProposedAction` requires `permissions: WorkerPermissionScope[]` + `risk` (`sdk/index.ts:51-52`). The catalog entry
(`capabilities/capabilityCatalog.ts:54-74`) carries OAuth `requiredScopes` + `operation` + `executor` — a DIFFERENT
namespace, and no `WorkerPermissionScope`/`risk`. Any bridge must SYNTHESIZE `permissions:['execute:action']` +
`risk:'high'` (as `executionProposal` does), never derive them from the catalog.

## Options for authorization (implement NONE now)
### Option A — minimal FROZEN extension to `executeJob`
Accept an optional, trusted, main-process-minted `ProposedAction` (built from a SELECTED capability via the existing
`bindCapabilityToProposal`) for the current job, still stamped through the SAME governance call.
- **Minimum change:** one additive optional parameter/branch in `executor.ts` `executeJob`; no type change if the
  `ProposedAction` is supplied via a non-frozen skill-adjacent hook. **Certification impact: HIGH** — modifies the
  certified proposal-stamping core; requires re-certification of the proposal path + new cohort tests.
### Option B — non-frozen capability-submission worker/skill
A trusted main-process skill that receives a capability REQUEST via `input`, calls
`capabilityDiscoveryService.resolveSelection` + `bindCapabilityToProposal` (re-validating against the authoritative,
tenant-scoped catalog so the caller can NEVER inject an unvalidated binding), and emits a `ProposedAction` with the
validated `ExecutionBinding`.
- **Minimum change:** a new worker + skill (non-frozen) + registry wiring + structured `input` carrying the request.
  **Certification impact: MEDIUM** — no frozen change, but a new governed proposal origin + a new Worker principal;
  requires governance/roster review and the permissions/risk synthesis.
- **Recommendation:** **Option B** is less invasive to certified surfaces (no frozen change, stamping core untouched),
  but it is NOT a thin bridge and introduces a synthetic-worker principal + a new proposal origin — so it needs
  explicit product/governance authorization before implementation. Neither option is implemented here.

## Impact analysis (both options) `SOURCE-PROVEN`
- **Identity/digest:** unchanged — the binding is the existing `ExecutionBinding` `{executor,target,accountId,
  actionId=capabilityId}`; `bindingDigest`/`decisionId` construction is not modified (Slice-5 result holds).
- **Tenant:** preserved — the binding is resolved from the service's active-workspace catalog; `Job.tenantId` remains
  store-stamped (`jobStore.put` `runtime/jobStore.ts:226`). The caller cannot name the tenant.
- **Approval:** preserved and authoritative — `resolveAuthoritativeApprover` (`approverAuthority.ts:13`) still binds
  the human; a bound consequential proposal is `require_approval`.
- **Admission/execution:** unchanged — Boundary-B + durable single-use admission + certified M365 path all downstream
  and untouched.
- **Evidence:** unchanged — decision records / holds / execution sessions reconstruct via authoritative ids.
- **AI boundary:** preserved — the AI supplies only a capability REQUEST (id+account+purpose); the trusted runtime
  re-validates and mints the binding. AI never executes, approves, or mints admission.

## Regression / rollback
- No code changed → no regression run required this slice. (For reference, capability dir is 75/75 at Slice-5; main
  suite 8608/3-skipped/815.) Frozen audit: **empty** (nothing modified). Rollback: N/A (report only).

## STOP conditions triggered (Phase 21)
"proposal submission requires frozen modification" (Option A) and "a workaround would create a second proposal
architecture" (Option B). Per Phase 10, this halts implementation pending explicit authorization.

## Next gate (do NOT start) `DEFERRED`
Await explicit authorization for Option A or B. Then implement ONLY the chosen bridge as its own slice, with full
security tests (Phase 11), regression, frozen audit, and evidence. No renderer workaround, no side-channel, no fake
proposal, no timestamp correlation.

## STOP
Traced, not built. The validated capability → governed proposal submission is blocked by the frozen stamping monopoly
and requires an authorized decision (frozen extension or a new non-frozen submission worker/skill). No frozen surface
modified, no code written, no live claim. HEAD `670b52e`; changes unstaged. No commit. No push. STOP — do NOT start
Slice 7.
