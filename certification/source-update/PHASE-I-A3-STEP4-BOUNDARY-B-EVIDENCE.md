# Phase I-A.3 Step 4 — Boundary-B Enforcement: Evidence

**Status: IMPLEMENTED + VERIFIED — AWAITING REVIEW. Not committed. Not pushed.**
Baseline HEAD `243ba73` (Step-5). Step-3A and Step-4 are both present, uncommitted, in the
working tree. Labels: `[PROVEN]` (test/source-verified), `[INFERRED]`, `[DESIGN]`, `[OPEN]`.

## 1. Exact Boundary-B location `[PROVEN]`
`apps/desktop/src/main/workforce/execution/workforceActionExecutor.ts` — inside
`createWorkforceActionExecutor`, AFTER the no-binding soft-fail and BEFORE `runBinding`:
```
const binding = req.params?.binding ?? null;
if (!binding || typeof binding.executor !== 'string') return { ok:false, error:'No execution binding on request' };
const verdict = verifyBoundaryB(req, now());          // <-- Boundary B
if (!verdict.ok) return { ok:false, error:`Governance denied at Boundary B: ${verdict.reason}` };
… runBinding(binding, req.confirmed === true) …        // consequential effect
```
The verification logic is the pure `apps/desktop/src/main/workforce/execution/boundaryB.ts`
(`verifyBoundaryB`). `now` defaults to the main-process `Date.now` (authoritative runtime clock).

## 2. Exact call graph / alternate-path audit `[PROVEN]`
```
Boundary A (approval, synchronous) → governedRequests (router.ts, mints+attaches claim)
    → submit → ExecuteEngine.execute
        → [Step-5] readGovernedClaim → reserve decisionId → AWAIT persist   (durable admission)
        → executor('connector') = createWorkforceActionExecutor
            → [Step-4] verifyBoundaryB(req, now)   DENY ⇒ return, runBinding NOT called
            → runBinding → { infra | m365 | automation } executor → EFFECT
```
Audited callers (`grep`, non-test):
- `params.binding` requests are built **only** by `router.ts` (`bindingToRequest`/`governedRequests`) — always claim-attached post-3A. `[PROVEN]`
- `runBinding` is reachable **only** via `createWorkforceActionExecutor` (`runtimeCore.ts:2542`). No other caller. `[PROVEN]`
- Other `executeEngine.execute` consumers — public IPC `ExecuteRun` (`.strict()`, cannot carry `params`/`binding`), the assistant (`assistantService.ts:664`, submits `{kind,targetId,input,label,correlationId}` — no binding), and the internal `execute` API — carry **no binding**, so `workforceActionExecutor` soft-fails before any effect. `[PROVEN]`
- **No alternate route** reaches `runBinding`/the connector effect via the worker path. `[PROVEN]` (The M365ActionExecute IPC is a *separate* already-governed ingress — out of scope, untouched.)

## 3–8. What Boundary B verifies (`verifyBoundaryB`) `[PROVEN]`
| Condition | Source | Deny reason |
|---|---|---|
| 3. Claim present | `req.params.claim` (Step-3A transport, by reference) | `MISSING_CLAIM` |
| 4. Actor present | `req.params.actor` (authoritative sibling) | `MISSING_ACTOR` |
| 5. Tenant present | `req.params.tenantId` (authoritative sibling) | `MISSING_TENANT` |
| 6. Binding reconstruction | `{binding.executor,target,accountId,actionId,params, actor, tenantId, claim.decisionId}` | `BINDING_MISMATCH` (incomplete) |
| 7. Digest / structure / expiry / decision | committed `verifyBoundDecisionClaim(claim, actual, now)` recomputes `sha256(canonicalize(actual))` — **`claim.bindingDigest` never trusted alone** | `MALFORMED_CLAIM` / `EXPIRED` / `DECISION_MISMATCH` / `BINDING_MISMATCH` |

- **Digest verification** reuses the committed primitive + canonical JSON (no duplicated canonicalization). `[PROVEN]`
- **Actor/tenant** are digest fields (6/7 of 8): tampering with either changes the recomputed digest ⇒ `BINDING_MISMATCH`. Presence is *also* checked explicitly (no fallback identity). `[PROVEN]`
- **decisionId** is field 8; on the worker path it is sourced from the claim, so a wrong decision surfaces as `BINDING_MISMATCH` (the `DECISION_MISMATCH` branch remains as internal defense). `[DESIGN]`

## 9. Decision verification `[PROVEN/DESIGN]`
Boundary B has no independent decision oracle at `runBinding`; the claim IS the decision
assertion. Its integrity (decisionId ∈ digest) + temporal validity + exact-binding
correspondence are what is enforced. Honest statement: **semantic (in-process) claim
verification ≠ cryptographic issuer authentication.** No bearer token, no signature. `[DESIGN]`

## 10. Durable-consumption interaction `[PROVEN]`
Boundary B does **not** implement consumption. The committed Step-5 mechanism (inside the
frozen `ExecuteEngine`) owns single-use: `decisionId` synchronous check→reserve → AWAIT persist
→ executor; rollback on persist failure; `seedHistory` hydration on restart. Boundary B is the
**semantic** gate that must ALSO pass before `runBinding`. `decisionId` is the uniqueness key;
`bindingDigest`/`claimNonce` are integrity/audit. Same decision → at most one admitted effect;
different decision, same binding → independently allowed.

## 11. Deny-before-executor property `[PROVEN]`
Every DENY returns from the executor **before** `runBinding` is called. Proven by the
enforcement suite with a `runBinding` spy: on every negative control the spy has **0** calls and
effect count is **0** (`boundaryBEnforcement.test.ts`). A governance denial is a *refusal*, never
an ordinary execution that still runs the effect.

## 12. Alternate-path audit — see §2. `[PROVEN]` No bypass found; no `ALTERNATE-PATH-FINDING` filed.

## 13. Concurrency `[PROVEN]`
`boundaryBEnforcement.test.ts` "concurrent submissions of the same decision → exactly one
effect": `Promise.all([execute(req), execute(req)])` ⇒ `runBinding` called once (Step-5's
synchronous check→reserve). No specific winner asserted.

## 14. Restart `[PROVEN]`
"after restart (seedHistory hydration) the same claim is DENIED — executor = 0": engine-2
hydrates from engine-1's persisted sessions; replay of the same claim is denied; `runBinding`
(engine-2) = 0. Declared persistence boundary preserved: **atomic rename / process-restart
semantics, no fsync** — hard-power-loss durability NOT claimed. `[OPEN]` (fsync, separate change)

## 15. Persistence-failure `[PROVEN]`
"durable-persistence failure refuses before the effect — runBinding = 0": a rejecting `persist`
⇒ Step-5 rolls back the reservation and refuses; `runBinding` = 0, effect = 0.

## 16. Negative controls `[PROVEN]` (all assert executor unreachable / reason)
Pure `boundaryB.test.ts`: no-claim→`MISSING_CLAIM`; missing/empty actor→`MISSING_ACTOR`;
missing tenant→`MISSING_TENANT`; incomplete binding→`BINDING_MISMATCH`; malformed
digest→`MALFORMED_CLAIM`; expired→`EXPIRED`; target/action/account/executor/params
mismatch→`BINDING_MISMATCH`; actor mismatch→`BINDING_MISMATCH`; tenant
mismatch→`BINDING_MISMATCH`; digest tamper→`BINDING_MISMATCH`; valid→ALLOW.
Real-path `boundaryBEnforcement.test.ts`: no-claim (control 1), tampered binding (5), expired
(3), replay (13), concurrency (14), restart (15), persistence-failure (16) — each asserts
`runBinding` calls = 0 (except the valid path = 1) and effect count.

## 17. Valid path `[PROVEN]`
"a valid governed request reaches the executor exactly once and completes": `runBinding` called
once with the exact binding + `confirmed:true`; session `completed`; `session.decisionId`
stamped. Effect = 1.

## 18. Frozen surfaces — UNCHANGED `[PROVEN]`
`git diff` shows NO change to: `boundDecisionClaim.ts`, `boundDecisionClaimMint.ts`,
`executeEngine.ts`, `runtimeCore.ts`, `packages/shared executeEngine.ts`, `workforceJobs.ts`,
`ipc/contracts.ts` (`ExecuteRunRequest` `.strict()`), m365 `executor.ts`, `workerRuntime.ts`,
`mail.ts`/`sendTransition.ts`, `ExecutionStore`, kernel. No new store, no crypto token, no
authority model, 8-field binding unchanged, no `policyVersion`/`purpose`/`intent`. **No
`runtimeCore` change** (the Boundary-B clock defaults to the authoritative `Date.now`).

## 19. Files changed (Step 4 only)
- Production: `workforce/execution/boundaryB.ts` (NEW), `workforce/execution/workforceActionExecutor.ts` (+clock param, +Boundary-B gate).
- Tests: `workforce/execution/boundaryB.test.ts` (NEW, 16), `workforce/execution/boundaryBEnforcement.test.ts` (NEW, 8), `workforce/execution/workforceActionExecutor.test.ts` (updated 5→7: governed routing + 2 deny controls).

## 20–23. Test counts / typecheck / lint / regression `[PROVEN]`
- Step-4 focused: `boundaryB` 16, `boundaryBEnforcement` 8, `workforceActionExecutor` 7 — with Step-3A/Step-5/router/runtime-exec = **73/73** in the execution+durable set.
- Full main suite: **800 files, 8356 passed, 3 skipped** (pre-Step-4 798/8330 → +2 files, +26 tests; no regression). UI: **24 files, 183 passed**.
- Typecheck: clean (node + web). Lint (changed files, `--max-warnings 0`): clean. `git diff --check`: clean.
- Negative-control scan: no `'user'`/`'system'`/`'unknown'`/renderer/displayName/email/workspaceId fallback in Step-4 production code (only a comment "never a renderer timestamp").

## 24. Remaining limitations (declared) `[OPEN]`
- **No cryptographic authenticity.** In-process semantic claim; trust rests on renderer-excluded transport + main-process provenance. Not a bearer token.
- **Consume-then-verify ordering.** Step-5 admission (frozen ExecuteEngine) precedes Boundary B, so a semantic DENY burns the `decisionId` without effect (`CONSUMED ≠ EFFECT_SUCCESS`, fail-closed). On the live path the transported binding always matches the claim, so semantic DENY is reachable only by a tampered/malformed request — impossible from the renderer. `[DESIGN]`
- **`claimNonce` cosmetic gap.** Step-5 `readGovernedClaim` reads `claim.claimNonce` while the transported claim names the field `nonce`, so `session.claimNonce` stamps `''` on the live path; `decisionId` single-use and `bindingDigest` are intact. In the frozen Step-5 surface — untouched. `[OPEN]`
- **No fsync / hard-power-loss durability; single-process runtime scope.** Preserved from Step-5.
- **Scope is the worker execution path only** — not universal governance, not the M365 IPC ingress.

## 25. Certification effect
Permitted claim for this gate:
> "Boundary B independently validates the transported Bound Decision Claim against the actual
> execution binding and authoritative actor and tenant context, enforces temporal and decision
> validity, and prevents re-admission of a consumed governed decision before the consequential
> worker executor is reachable, within the declared single-process and process-restart
> persistence scope."

NOT claimed: universal governance · all worker paths governed · all mail.send governed · all
consequential actions governed · cryptographic claim authenticity · hard-power-loss durability ·
provider idempotency · effect success · verification success · AuthorityLease · ExecutionClaim ·
policyVersion provenance · Boundary A = complete NOI · universal sector certification.

## 26. H-FINDING-3 status
**Reassessed — the worker consequential path is now governed at Boundary B** (§2 alternate-path
audit shows the worker route to `runBinding` cannot be reached with a binding but no valid
claim; negative controls prove executor unreachable on denial; valid path reaches the executor).
For the **worker execution boundary**, H-FINDING-3 is **CLOSED**. `[PROVEN, scoped]`

It is NOT closed globally: H-FINDING-3 originally concerned `mail.send` reachable un-governed via
the worker path *versus* the M365ActionExecute IPC ingress. This gate governs the **worker
path**; the separate IPC ingress was already governed and is untouched. A whole-of-`mail.send`
certification requires confirming both ingresses under one policy — a separate reconciliation
gate. Until that reconciliation is recorded, treat H-FINDING-3 as **CLOSED for the worker path,
OPEN as a program-level cross-ingress reconciliation.** `[OPEN]`
