# Phase I-A — Prerequisite finding I-FINDING-1: the worker path lacks authoritative actor context

**Discovered while gating Phase I-A (before any code). OBSERVE → RECORD → CLASSIFY →
STOP.** No code written. This is the §30 context-availability prerequisite for
governing the worker-approval ingress.

## Observation (grounded)

The worker-approval ingress reaches the `mail.send` effect as:
```
proposal → approveProposal(…, 'user', …)  (workforce/index.ts:375 — a ROLE marker, not an identity)
  → setDispatchApproved → bindingToRequest(job, proposal)  (workforce/execution/router.ts:31)
  → ExecuteEngine.execute  (stamps tenantId ONLY — executeEngine.ts:107; no actor)
  → 'connector' executor → runBinding 'm365'  (runtimeCore.ts:2498)
  → m365Executor.execute
```

What survives to the effect boundary:
- `ExecutionBinding` = `{ executor, target, accountId, actionId, params }` — **the effect
  parameters only** (`workforceJobs.ts:39`).
- `bindingToRequest` adds `{ targetId: job.id, params:{binding,jobId,proposalId},
  confirmed: TRUE, correlationId }` (`router.ts:34-41`).
- `ExecuteEngine.execute` stamps **`tenantId` only**, never an actor (`executeEngine.ts:107`).

What does NOT survive: an **authoritative actor identity**, and the semantic context
governance needs (purpose, on-behalf-of, relationship, authority). `confirmed:true` (the
approval) is carried; **who** approved / **on whose behalf** / **for what purpose** is not.

## Classification — the predicted information-boundary problem, not a defect

This is exactly what Phase I §29–§30 anticipated:
> *Governance must not be moved to a boundary that lacks the minimum authoritative
> context required to make the governance decision.*

Governing `mail.send` at `runBinding` would place the CST verdict where the
authoritative **actor is absent**. Per §28 (no fabricated identity — never fall back to
`session`/`worker`/`owner`/`system`/`unknown`) and §30, a naive `runBinding → governedSend`
wrap is **prohibited**: `governedSend` with `actorId=''` would simply DENY every
worker-approved send, and defaulting the actor would silently weaken the identity
boundary. The required context exists **upstream** (the job requester, the proposal's
own `verdict`/`risk`, the human who approved) but is **stripped** before `runBinding`.

So Phase I-A is **not** "wrap `runBinding`." It is first an **information-boundary**
decision: where does the authoritative actor/purpose live, and how does the governance
state reach the enforcement point?

## Options (architectural decision — the user's, not to be resolved unilaterally)

- **Option 1 — propagate context down.** Thread the authoritative actor (+ purpose /
  on-behalf-of) from the job/proposal/approval through `ExecutionBinding` /
  `ExecutionRequest` to `runBinding`, so `governedSend` has real context. Cost: touches
  the binding/request types + the dispatch flow + the engine (broader than one call
  site); must identify the *authoritative* actor at approval time (the approver? the
  on-behalf-of user? the agent?).
- **Option 2 — govern upstream at the context-rich boundary (recommended, and the
  cleanest Model-C realization).** Boundary A (admission) is the **approval** point,
  which already holds `verdict`/`risk` and knows the job/approver: mint a governance
  decision **bound to the specific consequential binding** (capability + target +
  params + actor + purpose) there. Boundary B (enforcement) at `runBinding`/the effect
  then only **verifies the binding carries a valid, matching governance token** — no
  token / mismatch ⇒ no effect. Enforcement needs no rich context; it checks a bound
  token. This mirrors CST's own approval/claim model and solves the information
  boundary (context stays where it lives).
- **Option 3 — session actor (weak, likely insufficient).** Use `authService` at
  `runBinding` *only if* worker execution is proven to always run synchronously in the
  approver's authenticated session. Rejected unless verified, and it still omits the
  on-behalf-of / agent context; fails for autonomous/scheduled execution (actor null →
  DENY everything).

## Disposition
```
I-FINDING-1   STATUS: RECORDED — Phase I-A BLOCKED on an architectural decision
Finding:      The worker-approval ingress strips authoritative actor + semantic
              context before the effect boundary; only tenant + confirmed + effect
              params survive.
Consequence:  Governing at runBinding would violate the §30 context-availability
              principle; a fabricated/session/fallback actor is prohibited (§28).
Decision needed: Option 1 (propagate context) vs Option 2 (govern upstream with a
              bound governance token — recommended) vs Option 3 (session actor, weak).
Kernel/executor: UNCHANGED. No code until the approach is chosen.
Validates:    the Phase I thesis — governance boundary + required-context availability
              are two distinct requirements; the worker path is an information-boundary
              problem, exactly as predicted.
```

**STOP — awaiting the architectural decision before any Phase I-A implementation.**
