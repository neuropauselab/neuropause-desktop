# Phase I-A.3 Step 3A — Authoritative Actor/Tenant Claim Transport Investigation (READ-ONLY)

**No source changed. No code. No commit. No push.** Baseline HEAD `243ba73` (Step-5
committed). This gate answers, from source evidence only, how the authoritative actor and
tenant context required to reconstruct the approved eight-field binding can travel from
Boundary A to Boundary B **without creating a new authority source and without weakening the
binding**. It resolves the *design* of D1 (transport not implemented) and D2 (actor/tenant not
available at Boundary B); it does **not** implement either. Boundary-B enforcement (Step 4)
remains a later, separately-authorized gate.

**Discrepancy check (mandatory):** the source matches the Step-4 pre-code report exactly — no
new discrepancy. `bindingToRequest` attaches no claim (`router.ts:34-41`); the committed
`BoundDecisionClaim` carries no actor/tenant (`boundDecisionClaim.ts:52-58`); `runBinding` and
`workforceActionExecutor` receive neither. One **strengthening** fact was found (Q3/§A below).

---

## The reconstruction requirement (why this gate exists)

Boundary B must independently recompute `sha256(canonicalize(8-field binding))` and compare it
to `claim.bindingDigest` (`boundDecisionClaim.ts:74-76, 105-124`). The eight fields are
`{ executor, target, accountId, actionId, params, actor, tenantId, decisionId }`
(`boundDecisionClaim.ts:35-45`). At Boundary B the available material is:

| Field | Available at Boundary B today? | Source |
|---|---|---|
| executor, target, accountId, actionId, params | **Yes** | `req.params.binding` (`ExecutionBinding`, `workforceJobs.ts:39-49`) |
| decisionId | Yes (once a claim is attached) | `claim.decisionId` |
| **actor** | **No** | not on `ExecutionBinding`, not on the claim, not passed to `runBinding` |
| **tenantId** | **No** | same |

So the transport gate's entire job is to carry, alongside the claim, the **authoritative
`actor` and `tenantId`** that were used at mint — the two fields the digest binds but neither
`ExecutionBinding` nor the committed claim holds.

---

## Answers to the ten investigation questions

### Q1 — Exact source of `actor`
`deps.actor()` on `WorkforceSubsystemDeps` (`workforce/index.ts:102`), wired in
`runtimeCore.ts:769-772` to `authService.getStatus()` → `session.user.id` when
`state === 'authenticated'`, else `null`. This is the **same** Boundary-A authority I-A.1
established (`session.user.id`, not displayName/email/role, not tenant/workspace, never the
literal `'user'`, never renderer). It is in scope inside the dispatch closure
(`workforce/index.ts:195`). Fail-closed: `null` ⇒ `mintClaimForApprovedProposal` returns
`NO_ACTOR` (`boundDecisionClaimMint.ts:72`).

### Q2 — Exact source of `tenant`
`activeTenantScope()?.tenantId` — the module-level resolver imported into `runtimeCore.ts:180`
and used directly in `workforce/index.ts` (e.g. `:231`, `:255`); it is the **same** resolver
every store binds to (`jobStore.bindScope(activeTenantScope)`, `:137`). Returns `null` when no
principal resolves ⇒ mint `NO_TENANT` (`boundDecisionClaimMint.ts:73`). **Distinct from
workspace:** the tenant is `activeTenantScope()?.tenantId` (the org), never
`activeTenantScope()?.workspaceId`. In scope inside the dispatch closure.

### Q3 — Lifetime of both (and the strengthening fact)
Both are **principal-scoped and mutable** across an org/identity switch, so they must be read
**at dispatch**, not captured at boot — the same discipline the Scheduler already documents
(`workforce/index.ts:222-231`: scope captured at enqueue so a job queued under org A is not
drained as org B). **Strengthening fact:** `setDispatchApproved` fires **synchronously inside
the approval call** — `workerRuntime.ts:294` invokes `dispatchApprovedFn!(job, executable)` on
the same call stack as `approve()` (returns the job at `:296`), and `executable` is
pre-filtered to `approval?.decision === 'approved' && p.execution` (`:257-258`). Therefore the
`actor`/`tenant` read at dispatch **is the approving principal's own context at the instant of
approval** — mint provenance equals approval provenance, with no re-resolution window.

### Q4 — Can they be carried by reference?
Yes. The `BoundDecisionClaim` is by-reference by design (not a serialized/bearer token —
`boundDecisionClaim.ts:17-19, 47-50`), and `actor`/`tenantId` are plain strings. They ride on
`ExecutionRequest.params` (a `Record<string, unknown>`, **in-process only** —
`executeEngine.ts:44-51`), exactly as `params.binding` already does. No serialization to the
renderer occurs on this path.

### Q5 — Does adding them to `ExecutionRequest.params` affect any frozen contract?
**No.** `params?: Record<string, unknown>` already exists; adding the keys `claim`, `actor`,
`tenantId` is additive within that free-form in-process field — no type change. Critically, the
**public IPC schema is untouched and still excludes them**: `ExecuteRunRequest`
(`contracts.ts:113-131`) is `.strict()` and lists only `kind`/`targetId`/`input`/`label` — it
does **not** include `params`, `confirmed`, or `correlationId`, so a renderer payload bearing
any of them is **rejected** by Zod strict before the handler runs. `ExecutionBinding`
(`workforceJobs.ts:39-49`) is **not** modified — actor/tenant travel as **siblings** of the
binding, never inside it. Frozen surfaces (`ExecutionBinding`, `ExecuteRunRequest`, the
`BoundDecisionClaim` primitive, the mint, the Step-5 `ExecutionSession`/`ExecuteEngine`) stay
unchanged.

### Q6 — Is `bindingToRequest` the correct attachment seam?
Partially. `bindingToRequest(job, proposal)` (`router.ts:31`) is **pure** and today has **no
access** to actor/tenant/clock/nonce, so it cannot mint. The correct division is:
- **Mint** in the `setDispatchApproved` closure (`workforce/index.ts:195-217`) — the only seam
  that holds authoritative `actor` + `tenant` and can source the clock/nonce.
- **Attach** by widening the pure `bindingToRequest` to accept an optional authoritative
  `governance` context `{ claim, actor, tenantId }` and place it on `params` — keeping request
  shaping in the pure, testable router. When the context is absent, behavior is unchanged
  (advisory/back-compat).

### Q7 — Is the approved binding immutable after minting?
`proposal.execution` (`ExecutionBinding`) is read at dispatch and copied by reference into
`params.binding` (`router.ts:32,38`). The mint reads the **same** `proposal.execution` fields
into the `EffectBinding` (`boundDecisionClaimMint.ts:75-84`). Because dispatch is synchronous
(Q3) and there is **no `await` between mint and attach**, both observe the identical binding —
the digest covers exactly what is transported. Canonicalization is deterministic **over value**
(`canonicalJson.ts`), so the by-reference sharing of `params` is safe. **Requirement for the
implementation:** mint and build the request from the same `proposal.execution` in one
synchronous step.

### Q8 — Can the claim/context be substituted independently?
Within the threat model (renderer injection): **no untrusted writer exists**. The renderer
cannot reach `params` (strict IPC, Q5/Q9); in-process, the only writer is the trusted
dispatcher. The digest binds `claim ↔ (binding + actor + tenant + decisionId)`, so Boundary B
rejects any single-field swap (`DECISION_MISMATCH` / `BINDING_MISMATCH`,
`boundDecisionClaim.ts:115,123`). A **consistent** swap of all of {claim, actor, tenant}
requires a trusted in-process component forging a self-consistent claim — i.e. compromising the
dispatcher, which also holds the mint function. That is **out of scope** and is exactly the
already-declared limit: this is representation/**binding integrity**, **not** cryptographic
non-repudiation (no Ed25519/HMAC, no bearer token — `boundDecisionClaim.ts:17-19`).

### Q9 — Does the request object remain renderer-excluded?
**Yes — confirmed and strong.** `ExecuteRunRequest` (`contracts.ts:113-131`) `.strict()` admits
only `kind`/`targetId`/`input`/`label`; `params`/`confirmed`/`correlationId` are absent, so the
public `ExecuteRun` handler (`runtimeCore.ts:2566-2570`) can never receive them even though it
casts `payload` — Zod validates against the schema first and strict **rejects** unknown keys.
The claim/actor/tenant only ever travel the **in-process** submit path
(`workforce.setExecutionSubmit((req) => executeEngine.execute(req))`, `runtimeCore.ts:2544`),
which bypasses the IPC schema by construction — the trusted channel.

### Q10 — Exact minimal files required (for the FUTURE Step-3A implementation — NOT done here)
1. `apps/desktop/src/main/workforce/index.ts` — in the `setDispatchApproved` closure
   (`:195-217`): per approved consequential proposal, mint via
   `mintClaimForApprovedProposal({ proposal, actor: deps.actor(), tenantId:
   activeTenantScope()?.tenantId ?? null, nowMs, ttlMs, nonce })`; **on mint failure, settle
   that binding failed and do NOT dispatch it** (never dispatch a consequential binding without
   a claim — fail closed); on success, attach `{ claim, actor, tenantId }`.
2. `apps/desktop/src/main/workforce/execution/router.ts` — widen `bindingToRequest` to accept
   an optional authoritative `governance: { claim, actor, tenantId }` and place it on `params`
   (pure; no-op when absent).
3. `apps/desktop/src/main/workforce/index.ts` deps + `runtimeCore.ts:761` — add `now: () =>
   number` and `nonce: () => string` to `WorkforceSubsystemDeps`, wired to the authoritative
   main-process clock (`Date.now()`) and `crypto.randomUUID()`, so time/nonce are injectable and
   testable and **never** renderer-sourced (matching the I-A.1 clock discipline).
- **No change** to: `boundDecisionClaim.ts` / `boundDecisionClaimMint.ts` (reused as-is),
  `ExecutionBinding` (`workforceJobs.ts`), `ExecuteRunRequest` (`contracts.ts`), the Step-5
  `ExecutionSession`/`ExecuteEngine`, and `runBinding`/`workforceActionExecutor` (those belong
  to Step-4 Boundary-B, a later gate).

---

## The four §6 questions (Boundary-A provenance)

- **A. Where is the claim minted?** At the Boundary-A dispatch point (the `setDispatchApproved`
  closure), reading `deps.actor()` + `activeTenantScope()?.tenantId` + authoritative clock/nonce
  — synchronous with the approval (Q3). **Not** at Boundary B, **not** in the executor, **not**
  from renderer input. Source-supported.
- **B. What exactly is transported?** `params = { binding (existing), claim (new), actor (new,
  authoritative), tenantId (new, authoritative), jobId, proposalId }`, plus the existing
  top-level `confirmed`/`correlationId`. This is **exactly enough** for Boundary B to
  reconstruct the eight-field binding = `{ binding.executor, binding.target, binding.accountId,
  binding.actionId, binding.params, actor, tenantId, claim.decisionId }`.
- **C. Can the renderer influence any of it?** No — `ExecuteRunRequest` `.strict()` excludes
  `params`/`confirmed`/`correlationId`; only the in-process submit path carries them (Q9).
- **D. Does the transported material remain internally consistent?** Yes —
  `claim.bindingDigest == sha256(canonicalize(8-field binding))` using the **same authoritative
  values** at mint and at transport (a single synchronous closure read, Q7). Boundary B
  recomputes and compares; any mismatch ⇒ reject.

---

## D2 resolution (recommended, for authorization) — transport, do NOT extend the claim

Carry `actor` + `tenantId` as **sibling `params`**, not by adding fields to the committed
`BoundDecisionClaim`. Rationale: it keeps the frozen Step-1 primitive and its digest-vs-stored
relationship **untouched**, matches the user's refined wording ("transport the authoritative
actor and tenant context required to reconstruct the already-approved eight-field binding"), and
does not weaken the eight-field binding. The primitive stays frozen; only the transport grows.

**Provenance invariant this must preserve:** the transported `actor`/`tenant` are trustworthy at
Boundary B **because** (i) `params` is renderer-excluded (strict IPC) and (ii) they are written
by the trusted dispatcher from `deps.actor()` / `activeTenantScope()` in the same synchronous
step as the mint — **not** because a value labelled `claim.actor` is inherently authoritative.
The digest match proves *transported binding == minted binding* (binding integrity within the
trusted channel), not issuer non-repudiation.

---

## Recommended sequencing (unchanged; for your authorization)
1. **Step 3A IMPLEMENTATION** — the three files in Q10; mint at dispatch, transport
   `{ claim, actor, tenantId }`, fail closed on mint failure. **No** `runBinding` change, **no**
   executor change, **no** new persistence, **no** enforcement. Its own gate; stop at review.
2. **Step 4 (Boundary-B enforcement)** — then implementable at
   `runBinding`/`workforceActionExecutor`: reconstruct the eight-field binding from the
   transported context, `verifyBoundDecisionClaim`, gate the executor (deny ⇒
   executor-reachability zero), and **reuse the Step-5 durable consumption** already committed.

## Status
Read-only investigation complete. **No code, no commit, no push, no frozen surface touched.**
`H-FINDING-3` OPEN. Boundary B not implemented and not certifiable. Step 3A implementation is
**not** authorized by this document — it awaits your explicit go-ahead on the D2 resolution
(sibling transport) and the Q10 file set.
