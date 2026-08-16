# Phase I-A.3 Step 3 — Bound Decision Claim Transport Investigation

## 1. Status
**READ-ONLY.** No code, no commit, no push. Baseline HEAD `6dcc1fe` (Step 2). Tags:
`[PROVEN]`/`[INFERRED]`/`[DESIGN]`/`[OPEN]`. v1 claim = 8 fields (no policyVersion,
I-A3-STEP2-FINDING-1). H-FINDING-3 OPEN.

## 2. Boundary A
`WorkforceProposalApprove` (`workforce/index.ts:385`) → `approveProposal`
(`workerRuntime.ts:223`) → approved `JobProposal` (`verdict.requestId` + `execution`
binding) → `mintClaimForApprovedProposal` (`cst/boundDecisionClaimMint.ts`, Step 2). The
approved-proposal dispatch is `setDispatchApproved` (`workforce/index.ts:183`).

## 3. Boundary B
`runBinding` (`runtimeCore.ts:2482`), case `'m365'` (`:2498`) → `M365Executor.execute` →
pure Graph send. Reached via the `'connector'` executor `createWorkforceActionExecutor(runBinding)`
(`runtimeCore.ts:2531`, `workforce/execution/workforceActionExecutor.ts:21`).

## 4. Complete transport path `[PROVEN]`
```
approveProposal → setDispatchApproved(job, proposals)          workforce/index.ts:183
  → bindingToRequest(job, proposal)                            router.ts:31
      ⇒ ExecutionRequest { kind, targetId, label,
          params:{ binding, jobId, proposalId }, confirmed:true, correlationId }   router.ts:34-41
  → submitExecution = executeEngine.execute(req)               runtimeCore.ts:2533
  → ExecuteEngine.execute(req)                                 executeEngine.ts:77
      • builds ExecutionSession WITHOUT req.params             executeEngine.ts:80-108
      • persists the SESSION (not req) BEFORE the executor     executeEngine.ts:111
      • await executor(req, {setStep})  — req passed by ref    executeEngine.ts:130
  → 'connector' executor reads req.params.binding (by ref)     workforceActionExecutor.ts:23
  → runBinding(binding, confirmed) → M365Executor.execute      runtimeCore.ts:2482/2498
```

## 5. Object inventory
| Transition | Type | File:line | Serialized? | Persisted? | Renderer-influenceable? | By-ref? |
|---|---|---|---|---|---|---|
| proposal → request | `ExecutionRequest` | `router.ts:34` | no | no | no (in-process) | n/a (built) |
| request → engine | `ExecutionRequest` | `executeEngine.ts:130` | **no** | **no** | no | **yes** |
| engine session | `ExecutionSession` | `executeEngine.ts:80` | yes (metadata+result) | **yes** (metadata+result, **NOT params**) | no | — |
| engine → executor | `ExecutionRequest` (`req`) | `executeEngine.ts:130` | no | no | no | **yes** |
| executor → runBinding | `ExecutionBinding` (`req.params.binding`) | `workforceActionExecutor.ts:23` | no | no | no | **yes** |

## 6. Claim attachment point `[DESIGN]`
Attach the minted claim as **`ExecutionRequest.params.claim`** (alongside `binding`),
minted at approval dispatch (`bindingToRequest`/`setDispatchApproved`, workforce layer).
It then rides `req` by reference to the executor and is read the same way
`req.params.binding` is (`workforceActionExecutor.ts:23`). No ExecuteEngine change needed
(the engine passes `req` opaquely).

## 7. Serialization boundaries `[PROVEN]`
**None on the claim.** `ExecutionRequest` is never serialized between A and B. The
`ExecutionSession` (`executeEngine.ts:80-108`) copies **no** request params; it persists
`{id,kind,label,state,steps,result,correlationId,tenantId}`. `result` is the executor's
*output* (post-execution), not the input claim. So the claim never crosses a
serialization boundary in the live path.

## 8. Persistence boundaries `[PROVEN]`
`ExecutionStore` persists the SESSION (`executeEngine.ts:111`, before the executor), not
the request params → **the claim is not persisted.** It exists only in-memory for the
live execution.

## 9. Trust boundaries `[PROVEN]`+`[INFERRED]`
The entire A→B path is **in-process, main-process, trusted code.** The only external
actor is the renderer, excluded at §10. The claim need not be integrity-protected against
in-process code (which could also mint — the declared limit: no issuer-non-repudiation
against a fully-compromised local process, I-A.2 §11/§18). The in-process **by-reference**
model from I-A.2 holds; **no trust-model revision is required.**

## 10. Renderer reachability `[PROVEN]`
`ExecuteRunRequest` is `.strict()` and accepts only `{kind, targetId?, input?, label?}`
(`contracts.ts:113-131`) — **no `params`.** So a renderer `execute:run` cannot supply or
replace `params.binding` or `params.claim`. The binding+claim originate only from the
in-process worker-approval dispatch. (A renderer `kind:'connector'` request reaches
`runBinding` with `req.params.binding` undefined → the executor fails soft,
`workforceActionExecutor.ts:24`.)

## 11. Binding preservation `[PROVEN]`
The `{executor,target,accountId,actionId,params}` object is created once, in the approved
proposal's `execution` (Boundary A), placed on `req.params.binding` unchanged
(`router.ts:38`), and read unchanged at `runBinding` (`workforceActionExecutor.ts:23`).
**No transformation occurs between A and B.** So a claim digest computed at A over that
binding will match the actual binding at B (verified at Boundary B in Step 4).

## 12. Claim mutation risks `[INFERRED]`
`req.params` is a mutable in-memory object; in-process code *could* mutate
`params.claim`/`params.binding`. This is within the trusted boundary. The security
property: if `params.binding` is swapped without re-minting `params.claim`, the claim
digest no longer matches → Boundary B verify → **DENY (BINDING_MISMATCH)** (Step 4).
Untrusted code (renderer) cannot mutate `req.params` (§10).

## 13. Claim substitution risks `[INFERRED]`
- Remove claim → at B, `MISSING_CLAIM` → DENY (Step 4).
- Replace claim / decisionId / actor / tenant / bindingDigest / nonce / issuedAt /
  expiresAt → only by **in-process** code; a replacement inconsistent with the actual
  binding → digest/decision mismatch → DENY (Step 4). A *consistent* forged pair requires
  minting, which requires an approved proposal + authoritative actor/tenant — i.e., a
  fully-compromised in-process process (out of the declared threat model).
- Renderer substitution → impossible (§10).

## 14. Restart behavior `[PROVEN]`
The claim is not persisted (§8), so it does **not** survive restart. It does not need to:
an interrupted session is **never rerun** (`executionStore.ts:6`, `runtimeCore.ts:2537`),
so a mid-flight execution produces no second effect after restart. The claim is required
only in-memory for the live A→B run.

## 15. Replay implications `[PROVEN]`+`[DESIGN]`
`nonce` exists on the claim (Step-1). Durable single-use is NOT implemented (Step 5). The
future durable consumption must anchor to the **persisted `ExecutionSession`** (bearing
the claim's `nonce`/`decisionId`), which is committed before the effect and never rerun
— the durable ledger, no new store. Interrupted sessions cannot be replayed
(`executionStore.ts` recovery).

## 16. Missing-claim behavior `[PROVEN]` (today) / `[DESIGN]` (target)
Today `runBinding` ignores any claim (H-FINDING-3 OPEN) — a binding with no claim still
executes. Target (Step 4): a consequential worker binding with **no valid claim ⇒ DENY**
before the executor. Transport alone (Step 3) does not change this; enforcement is Step 4.

## 17. Consequential capability scope
This claim mechanism governs the **`mail.send` worker ingress** via `runBinding` `'m365'`.
Not every worker execution carries a consequential binding: advisory proposals have no
`execution` (no claim, §Step-2). Infra/automation via `runBinding` are the same *shape*
but out of this experiment's scope. The direct `M365ActionExecute` IPC path is a separate
ingress (already Phase H, un-tokenized). Governance stays capability × ingress local.

## 18. Frozen-surface analysis
- **Transport (attach at A + carry to B available):** achievable in the **workforce layer**
  (`router.ts` `bindingToRequest` and/or `workforce/index.ts` dispatch) — **not frozen**.
  `ExecuteEngine`/`ExecutionStore` need **no** change (req passed opaquely; session omits
  params). ✓
- **Boundary-B enforcement (read `params.claim` + verify + DENY):** requires changing the
  executor (`workforceActionExecutor.ts`) to forward the claim **and** `runBinding`
  (`runtimeCore.ts`) to verify — **`runBinding` is FROZEN → Step 4, separately authorized.**
- No `kernel`/`executor.ts`/`mail.ts`/`secureBridge.ts`/`GovernanceVerdict`/`ProposalApproval`
  change is required for transport.

## 19. Negative controls (DESIGN requirements — for Step 4 enforcement, not now)
missing claim · forged claim · mismatched claim · expired · wrong decisionId/actor/tenant ·
changed params/accountId/target/executor/actionId · replayed nonce · renderer-supplied
claim (must be impossible, §10) · claim removed in transit → each ⇒ **DENY, no effect**.
Design only; no Boundary-B enforcement implemented in Step 3.

## 20. Required implementation changes (future steps)
- **Step 3 (transport):** attach `params.claim` at approval dispatch (workforce layer);
  mint via Step-2 with `deps.actor()` + `activeTenantScope()?.tenantId` + runtime clock.
- **Step 4 (enforcement):** `workforceActionExecutor` forwards the claim; `runBinding`
  verifies (`verifyBoundDecisionClaim`) before the executor; fail-closed DENY. (Frozen
  `runBinding` — its own gate.)
- **Step 5 (durable single-use):** anchor `nonce` consumption to the persisted
  `ExecutionSession`.

## 21. Security properties (transport)
In-process by-reference; no serialization; no persistence of the claim; renderer-excluded;
binding preserved unchanged A→B so the digest corresponds to the actual effect. The claim
does **not** grant authority; it is evidence bound to an exact effect. It does not defend
against a fully-compromised local process (declared limit).

## 22. Deviations from I-A.3
I-A.3 §7-9 assumed the claim rides `ExecutionRequest.params` — confirmed feasible with
**no ExecuteEngine/ExecutionStore change** (session omits params), which is *simpler* than
I-A.3 anticipated. No other deviation.

## 23. H-FINDING-3 implications
Transport makes the claim **available** at Boundary B but does not enforce it. The
invariant *no valid claim ⇒ no consequential effect* is **not** yet earned. H-FINDING-3
**remains OPEN** until Step 4 enforcement is implemented and its negative controls pass.

## 24. Final verdict
**IMPLEMENTABLE WITH PREREQUISITES.** The claim can travel from Boundary A to Boundary B
**in-process, by reference, on `ExecutionRequest.params.claim`** — un-serialized,
un-persisted, renderer-excluded, with the binding preserved unchanged so the digest
corresponds to the actual effect. **No trust-model revision, and no ExecuteEngine/
ExecutionStore/frozen change, is required for transport.** Prerequisites: (1) attach the
claim at the approval dispatch (workforce layer, not frozen); (2) **Boundary-B enforcement
at `runBinding` is Step 4 — a frozen surface, separately authorized** — and only it begins
to close H-FINDING-3; (3) durable single-use (Step 5). No code, no commit, no push.
