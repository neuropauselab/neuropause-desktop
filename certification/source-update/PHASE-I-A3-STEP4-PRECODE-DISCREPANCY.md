# Phase I-A.3 Step 4 — Boundary-B Enforcement: Pre-Code Discrepancy Report (STOP)

**READ-ONLY. No source changed, no commit, no push.** Baseline HEAD `fafafc7`. The Phase-1
mandatory pre-code review found that Boundary-B enforcement **cannot be implemented at
`runBinding` in isolation**: two prerequisites are unmet, both **outside** the authorized
focus ("runBinding and its immediate enforcement path"). Reporting per Phase 1 / the frozen-
surface rule ("If another surface is required: STOP and report the exact discrepancy before
changing it").

## Discrepancy D1 — claim transport is NOT implemented (only the investigation was committed)

The gate preamble states *"I-A.3 Step 3 In-process claim transport = COMMITTED."* The source
shows otherwise:
- `bindingToRequest` (`workforce/execution/router.ts:34-41`) builds the request as
  `params: { binding, jobId, proposalId }` — **no `claim`.** No mint call, no attach.
- The only committed Step-3 artifact is the **investigation doc** (`fafafc7`,
  `PHASE-I-A3-STEP3-TRANSPORT-INVESTIGATION.md`). The transport **code** (mint at approval +
  attach `req.params.claim`) was **never written**.

**Consequence:** `req.params.claim` is **always absent** today. Boundary B would have **no
claim to enforce**, and the Step-5 durable-consumption mechanism (which reads
`req.params.claim`, `executeEngine.ts readGovernedClaim`) is **dormant** — it engages only
when a claim is attached, which never happens on the live path. `[PROVEN]`

Fixing D1 = a **workforce-layer** change (mint the claim at the approval dispatch with the
authoritative actor/tenant/decision/clock, and attach it to the `ExecutionRequest` in
`bindingToRequest`/`setDispatchApproved`). That is **not** `runBinding` — outside this gate's
authorized focus.

## Discrepancy D2 — Boundary B cannot reconstruct the 8-field binding to verify the digest

Phase 3 requires: *"Boundary B must independently reconstruct the actual binding and
calculate its digest … compare with `claim.bindingDigest`."* The source makes this
**unsatisfiable** with the committed claim + Boundary-B context:
- The committed `BoundDecisionClaim` = `{ decisionId, nonce, bindingDigest, issuedAt,
  expiresAt }` (`cst/boundDecisionClaim.ts:53-57`) — it does **NOT** carry `actor` or
  `tenantId`. Those live in `EffectBinding` (`:41-42`), which is **digested** but **not
  stored** on the claim.
- The digest = `sha256(canonicalize({ executor, target, accountId, actionId, params,
  actor, tenantId, decisionId }))` (8 fields).
- At Boundary B: `workforceActionExecutor` has `req.params.binding` = `ExecutionBinding`
  `{ executor, target, accountId?, actionId?, params? }` (no actor/tenant), and
  `runBinding(binding, confirmed)` (`runtimeCore.ts:2482`) receives only `binding` +
  `confirmed`. **Neither has `actor` or `tenantId`.**

**Consequence:** Boundary B cannot recompute the digest — `actor` and `tenantId` are bound
into it but are **neither on the claim nor available at `runBinding`**. A recompute over only
the available fields cannot match `claim.bindingDigest`, so Phase-2 checks #6 (binding
digest), #7 (actor), #8 (tenant) are **not evaluable** at Boundary B today. `[PROVEN]`

Fixing D2 requires ONE of (all outside `runBinding`):
- extend the committed `BoundDecisionClaim` to carry `actor` + `tenantId` (a **Step-1
  claim-primitive** change — committed), so Boundary B reconstructs `{ req.params.binding.* +
  claim.actor + claim.tenantId + claim.decisionId }` and recomputes; **or**
- transport `actor` + `tenantId` alongside the claim (a **transport** change); **or**
- redefine the binding digest to exclude `actor`/`tenantId` (a **Step-1 design** change,
  which would weaken the binding — not recommended).

## Why I did not proceed
Both fixes lie outside "runBinding and its immediate enforcement path." Implementing
Boundary-B enforcement now would either (a) enforce nothing (no claim present — D1), or
(b) require silently changing the committed claim primitive or the transport (D2) — which the
gate forbids without explicit authorization. Per the rule, I stopped.

## Recommended sequencing (for authorization)
1. **Step 3 (transport) IMPLEMENTATION** — mint at Boundary-A dispatch + attach
   `req.params.claim`; **decide D2 here**: have the mint/attach carry `actor` + `tenantId`
   (e.g. extend the transported claim, or a small transport envelope) so Boundary B can
   recompute the digest. (Workforce-layer + a claim/transport decision.)
2. **Step 4 (Boundary-B enforcement)** — then implementable at `runBinding`/
   `workforceActionExecutor`: recompute the digest over the actual binding + carried
   actor/tenant, verify expiry/decision, and gate the executor (deny ⇒ executor-reachability
   zero). Reuse Step-5 consumption (already in `ExecuteEngine`).

## Status
No code. No commit. No new store. No frozen surface touched. `H-FINDING-3` OPEN. Boundary B
**NOT** implemented and **NOT** certifiable. Awaiting a decision on D1 (transport
implementation) and D2 (how Boundary B obtains `actor`/`tenantId` for digest verification)
before any Boundary-B code.
