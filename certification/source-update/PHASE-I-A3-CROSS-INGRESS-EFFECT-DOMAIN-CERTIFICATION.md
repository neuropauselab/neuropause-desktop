# Phase I-A.3 — Cross-Ingress Effect-Domain Coverage (OPTION-D Certification)

**READ-ONLY verification + certification. No production/test/frozen surface changed.** Labels:
`[PROVEN]` / `[INFERRED]` / `[OPEN]` / `[DESIGN]` / `[N/A]`.

## 1. Repository state `[PROVEN]`
- Branch `cert/data-import-cst-integration`; HEAD `243ba73` (Step-5 committed).
- Working tree (uncommitted): Step-3A (`router.ts`, `workforce/index.ts`, `router.governedTransport.test.ts`),
  Step-4 (`boundaryB.ts`, `workforceActionExecutor.ts`, `workforceActionExecutor.test.ts`,
  `boundaryBEnforcement.test.ts`), and four certification docs.
- Committed: Step-5. Uncommitted: Step-3A, Step-4, cross-ingress investigation, design investigation.
  **Matches the certification context — no discrepancy.**

## 2. Declared effect domain
**`mail.send`** — the single consequential Microsoft Graph send.

## 3. Effect implementation `[PROVEN]`
The pure send `send` registered at `connectors/m365/mail.ts:131`
(`{ id: 'mail.send', …, run: send }`), reached via `WriteAction.run`. No other function performs the
Graph send for this action.

## 4. Complete ingress inventory `[PROVEN]`
Re-traced callers from source (not names):
- The pure send is invoked only through (a) `M365Executor.execute` (`connectors/m365/executor.ts:78`)
  and (b) `governedSend → action.run` (`cst/sendTransition.ts:147,266`).
- `M365Executor.execute` callers: `runtimeCore.ts:2509` (worker `runBinding`) and
  `connectors/index.ts:500` (IPC **non**-`mail.send` branch).
- `governedSend` caller: `connectors/index.ts:481` (IPC `mail.send`).
- For `actionId==='mail.send'`, the IPC handler always takes `governedSend`
  (`connectors/index.ts:480`); the raw-executor fallback is unreachable because `mail.send` is
  registered in `ALL_M365_ACTIONS` (`mail.ts:131`), so `mailSendAction` is non-null.
- No automations/webhooks/drafts caller found.

**`MAIL_SEND_EFFECT_INGRESSES = { I1 = Worker, I2 = M365 IPC }`. Third ingress: NOT FOUND.** `[PROVEN]`

## 5. Worker ingress governance evidence (Part 2) `[PROVEN]`
Chain: `WorkforceProposalApprove` → `setDispatchApproved` (`workforce/index.ts`, synchronous with
approval) → `governedRequests` (`router.ts`) mints `BoundDecisionClaim` + attaches `actor/tenantId`
→ `executeEngine.execute` → Step-5 consumption (`executeEngine.ts:147-186`) → `workforceActionExecutor`
→ `verifyBoundaryB` (`boundaryB.ts`) → `runBinding` (`runtimeCore.ts:2508`, m365) →
`M365Executor.execute` → send.
| # | Property | Source | Class |
|---|---|---|---|
| 1 | Authority | `authService…session.user.id` (`runtimeCore.ts:769`) | `[PROVEN]` |
| 2 | Decision identity | `proposal.verdict.requestId` (`boundDecisionClaimMint.ts:83`) | `[PROVEN]` |
| 3 | Claim identity | `BoundDecisionClaim{decisionId,nonce,bindingDigest,issuedAt,expiresAt}` | `[PROVEN]` |
| 4 | Actor | `user.id` | `[PROVEN]` |
| 5 | Tenant | `activeTenantScope().tenantId` | `[PROVEN]` |
| 6 | Binding | 8-field digest, recomputed at Boundary B (`boundaryB.ts` → `verifyBoundDecisionClaim`) | `[PROVEN]` |
| 7 | Temporal | `claim.issuedAt/expiresAt` vs `now` at Boundary B | `[PROVEN]` |
| 8 | Consumption identity | `decisionId` (`executeEngine.ts:92,149,154`) | `[PROVEN]` |
| 9 | Durable persistence | `ExecutionStore` atomic rename; await before effect (`executeEngine.ts:163-182`) | `[PROVEN]` |
| 10 | Replay | consumed `decisionId` DENY; restart via `seedHistory` | `[PROVEN]` |
| 11 | Pre-effect enforcement | `verifyBoundaryB` before `runBinding` (`workforceActionExecutor.ts`) | `[PROVEN]` |
| 12 | Executor unreachable on denial | `runBinding` spy = 0 on every DENY (`boundaryBEnforcement.test.ts`) | `[PROVEN]` |

## 6. M365 IPC ingress governance evidence (Part 3) `[PROVEN]`
Chain: renderer → `M365ActionExecute` (`connectors/index.ts:467`, RBAC `connectors:manage` via
`gateConnectorHandlers`) → schema `M365ActionExecuteRequest` (`contracts.ts:465`) → `governedSend`
(`connectors/index.ts:481`) → `CstKernel.run(request, effect)` (`sendTransition.ts:242,284`) →
`action.run`.
| Key | Source | Class |
|---|---|---|
| A. Actor | `deps.actor()` = `displayName ?? email` (`runtimeCore.ts:479-483`); `''` ⇒ DENY (`sendTransition.ts:174,177`) | `[PROVEN]` |
| B. Tenant | `deps.workspaceId()` (`runtimeCore.ts:471`) → CST `actor.tenantId`/`target.tenantId` | `[PROVEN]` |
| C. Authorization identity | CST `requestId=req:${idem}:${time}`, `transitionId=m365-send:${idem}` | `[PROVEN]` |
| D. Binding/idempotency | `idempotencyKey=sha256(tenantId\|connectorId\|accountId\|action.id\|params)` (`sendTransition.ts:158-162`) | `[PROVEN]` |
| E. Policy | `policyVersion='m365-send-policy-1'`; `PolicyStore` grants `SEND_ACTION` iff authorized (`:224-227`) | `[PROVEN]` |
| F. Consumption/idempotency | CST `ClaimStore`+`IdempotencyStore` (`:96-97`) | `[PROVEN]` |
| G. Persistence duration | **in-memory, process-lifetime, not crash-durable** (`:89`) | `[PROVEN]`/`[OPEN]` |
| H. Pre-effect denial location | `CstKernel.run` gates `effect()`; unauthorized ⇒ effect never invoked | `[PROVEN]` |
| I. Effect reachable after denial? | **No** — `effectCalls===0` on DENY/HOLD (`sendTransition.negative.test.ts` H-B/C/D/E/O) | `[PROVEN]` |
| J. Restart | in-memory idempotency lost on restart (declared) | `[OPEN]` |
| K. Renderer-controlled fields | `connectorId, accountId, actionId, params, confirmed` (schema **not `.strict()`**) | `[PROVEN]` |
| L. Actually governed? | **Yes** — CST authorization + ownership/scope/token + human confirm; effect at most once | `[PROVEN]` |
The IPC path satisfies **its own** authoritative pre-effect governance contract (differences from
Boundary B are not automatically failures — Part 3 rule honored).

## 7. Governance-mechanism comparison (Part 4) — preserved, NOT reconciled
| | Worker | M365 IPC |
|---|---|---|
| Governance | Boundary B (BoundDecisionClaim) | CST kernel (`governedSend`) |
| Decision id | `proposal.verdict.requestId` | `req:${idem}:${time}` |
| Consumption | durable `ExecutionStore` (`decisionId`) | in-memory CST idempotency (`idempotencyKey`) |
| Binding | 8-field digest | 5-field idempotency hash |
| Actor | `user.id` | `displayName ?? email` |
| Tenant | `activeTenantScope().tenantId` | `workspaceId()` |
| Enforcement | `verifyBoundaryB` | `CstKernel.run` |
No shared decisionId, no shared consumption key, no invented mapping. (Per instruction.)

## 8. Negative-control evidence (Part 6) — DENY **and** effect-unreachable, freshly re-run `[PROVEN]`
**Worker** (`boundaryB.test.ts` 16, `boundaryBEnforcement.test.ts` 8, `executeEngine.durableConsumption.test.ts` 9):
missing/malformed/expired/actor-mismatch/tenant-mismatch/binding-mismatch → DENY with `runBinding`=0;
consumed → DENY; persistence-fail → 0 effect; concurrent → ≤1 effect; restart → DENY. Each asserts
executor-unreachable, not merely a verdict.
**M365 IPC** (`sendTransition.negative.test.ts` 16): H-B unconfirmed → HOLD, `effectCalls=0`, action
calls=0; H-C unauthorized → DENIED, `effectCalls=0`; H-D missing scope → DENIED; H-E no token →
DENIED; H-O missing actor → DENIED, no fallback; H-F/H-K replay → HOLD, second `effectCalls=0`,
exactly one external send. Each asserts `effectCalls===0` AND the injected action's own counter = 0
(**effect unreachable, distinct from the DENY verdict**). Fresh run this gate: **49/49 across the four
suites.** `[PROVEN]`

## 9. Effect-reachability evidence (Part 5 Option-D test) `[PROVEN]`
Statement evaluated: *"For every known ingress to `mail.send`, the send cannot occur unless that
ingress passes an authoritative governance mechanism appropriate to its trust model, with pre-effect
denial and defined replay/idempotency semantics."*
- **Worker** meets every condition (authoritative governance + claim + binding + Boundary-B +
  durable consumption + executor-unreachable-on-denial). `[PROVEN]`
- **M365 IPC** meets its conditions (CST authorization + identity/context + policy/ownership/scope +
  confirmation + pre-effect denial + defined in-memory idempotency + effect-unreachable-on-denial).
  `[PROVEN]`
- No third ingress. → **Statement SOURCE-SUPPORTED.**

## 10. Restart/replay scope (Part 7 rows) `[PROVEN]`/`[OPEN]`
Worker replay is durable across process restart (`seedHistory`); IPC idempotency is process-lifetime
only (in-memory). Neither claims provider idempotency or hard-power-loss durability.

## 11. Renderer trust differences `[PROVEN]`
Worker: `ExecuteRunRequest` `.strict()` — renderer supplies none of the consequential fields. IPC:
`M365ActionExecuteRequest` non-strict — renderer supplies target/account/action/params/confirmed,
governed by CST authorization + human confirm. Different, intentional trust models — not a defect.

## 12. Cross-ingress coverage table + answers (Part 7)
| Property | Worker | M365 IPC | Coverage |
|---|---|---|---|
| Known ingress | I1 | I2 | enumerated `[PROVEN]` |
| Authority | user.id | displayName/email | both authoritative `[PROVEN]` |
| Identity/tenant | org tenantId | workspaceId | both authoritative, different scope `[PROVEN]` |
| Decision/authorization | proposal verdict | CST request/approval | both present, different `[PROVEN]` |
| Binding | 8-field digest | 5-field idem hash | both present, different `[PROVEN]` |
| Temporal validity | claim expiry (Boundary B) | approval expiry (CST) | both `[PROVEN]` |
| Consumption/idempotency | durable decisionId | in-memory idem | both present, different domain `[PROVEN]`/`[OPEN]` |
| Persistence scope | restart-durable | single-process | covered w/ declared limit `[PROVEN]`/`[OPEN]` |
| Pre-effect enforcement | Boundary B | CST kernel | both `[PROVEN]` |
| Effect unreachable on denial | runBinding=0 | effectCalls=0 | both `[PROVEN]` |
| Restart semantics | DENY replay | idem lost | asymmetric `[OPEN]` |
| Renderer trust | excluded | supplied+governed | different models `[PROVEN]` |
Answers: **1. Both governed — YES. 2. Ungoverned ingress — NO. 3. Mechanisms must be equivalent — NO.
4. Shared decisionId required — NO. 5. Shared consumption ledger required — NO. 6. Cross-ingress
content dedup required for certification — NO. 7. Effect-domain coverage certifiable without
mechanism equivalence — YES.** `[PROVEN]`

## 13. Option-D determination `[PROVEN]`
Both ingresses are governed by an authoritative, pre-effect mechanism appropriate to their trust
model, each with defined replay/idempotency semantics and proven effect-unreachability on denial; no
third ingress exists. **Effect-domain coverage for `mail.send` is PROVEN. OPTION D confirmed.**

## 14. Exact certified statement
> "For every enumerated ingress to the NeuroPause `mail.send` effect domain — the worker ingress and
> the Microsoft 365 IPC ingress — the consequential Graph send is reachable only after that ingress
> passes an authoritative governance mechanism appropriate to its trust model: the worker ingress via
> Bound Decision Claim verification at Boundary B over an exact 8-field binding with durable single-use
> `decisionId` consumption; the M365 IPC ingress via CST-kernel authorization over authoritative
> identity, policy, ownership, scope, token, and human confirmation, with process-lifetime idempotency.
> Each ingress enforces pre-effect denial (proven: the effect is unreachable on denial, not merely a
> verdict), and no third ingress to the effect exists. This is governed-ingress COVERAGE of the
> declared effect domain, not equivalence of the two mechanisms."

## 15. Exact non-claims
NOT claimed: mechanism equivalence · shared decision identity · shared consumption ledger ·
cross-ingress content de-duplication · all M365 actions governed (non-`mail.send` IPC = RBAC+confirmed
only) · all connectors/workflows governed · universal governance · crash-durable IPC replay ·
hard-power-loss durability · provider idempotency · effect success · verified success · cryptographic
authenticity · certification of any sector/professional/personal use beyond this effect domain.

## 16. Remaining limitations `[OPEN]`
- IPC idempotency is in-memory (process-restart loses it).
- No cross-ingress content de-duplication (the same message may be independently authorized and sent
  via both ingresses — each is a distinct governed decision, not a bypass).
- Worker `session.claimNonce` cosmetic gap (Step-4 evidence).
- Scope note: non-`mail.send` M365 IPC write actions reach the executor via RBAC+confirmed only (no
  CST/Boundary B) — outside this effect domain; candidate for its own gate.

## 17. Next certification gate
Optionally extend effect-domain coverage to **other M365 write actions** (non-`mail.send` IPC path),
and/or a durability upgrade for IPC idempotency. Mechanism unification (B1/B2) remains **out of scope**
and would require a separately-authorized new cross-ingress decision contract (design investigation).

## 18. Source file references
`connectors/m365/mail.ts:131` · `connectors/m365/executor.ts:78` · `connectors/index.ts:467-502` ·
`cst/sendTransition.ts:89,147-292` · `packages/shared/src/ipc/contracts.ts:113(strict),465(non-strict)` ·
`runtimeCore.ts:471,479-483,769,2493-2540(2508)` · `workforce/index.ts (setDispatchApproved)` ·
`workforce/execution/router.ts (governedRequests)` · `workforce/execution/boundaryB.ts` ·
`workforce/execution/workforceActionExecutor.ts` · `executeEngine.ts:70,92,147-186` ·
`cst/boundDecisionClaimMint.ts:83` · tests: `sendTransition.negative.test.ts`, `boundaryB.test.ts`,
`boundaryBEnforcement.test.ts`, `executeEngine.durableConsumption.test.ts`.

## 19. Constitutional principle (Part 10 — source-supported, recorded)
- "NeuroPause OS certification is based on demonstrated governed-ingress coverage of a declared
  consequential effect domain, not on equivalence of the governance mechanisms used by different
  ingress paths."
- "Different ingress trust models may use different authoritative governance mechanisms, provided each
  establishes the required pre-effect control and evidence properties for the declared effect domain."
- "An effect domain shall not be considered fully governed until all known consequential ingress paths
  to that effect have been enumerated and each has demonstrated authoritative pre-effect governance."

## H-FINDING-3 reassessment (Part 8)
- A. Worker bypass → **CLOSED** `[PROVEN]` (Boundary B).
- B. `mail.send` ungoverned ingress → **NONE** `[PROVEN]` (both governed; no third).
- C. Mechanism equivalence → **OUT OF SCOPE** (not required).
- D. Shared consumption → **NOT REQUIRED**.
- E. Universal M365 governance → **NOT CLAIMED**.
**H-FINDING-3: CLOSED — DECLARED `mail.send` EFFECT DOMAIN** (governed-ingress coverage), with the
explicit non-claims above.

## STOP
Read-only. No code, no tests, no commit, no push, no frozen surface changed.
