# Phase I-A.3 — Cross-Ingress Reconciliation Investigation (READ-ONLY)

**No production code, no tests, no commit, no push.** Baseline HEAD `243ba73` (Step-5); Step-3A +
Step-4 present uncommitted. Effect domain under study: **`mail.send`**. Labels: `[PROVEN]`
(source/test-verified), `[INFERRED]`, `[DESIGN]`, `[OPEN]`.

## Headline
The `mail.send` effect has **two independent, both-governed ingresses** that do **NOT** share
authority identity, tenant, decision identity, binding, enforcement mechanism, or consumption
ledger. There is **no un-governed ingress** to the effect, but there is **no unified assurance
boundary** either. **Classification: OPTION C — separate governed execution boundaries exist.**

## 1. Worker path `[PROVEN]`
`WorkforceProposalApprove` → `setDispatchApproved` (synchronous with approval) → `governedRequests`
(mints `BoundDecisionClaim`, attaches `{claim, actor=user.id, tenantId=activeTenantScope().tenantId}`)
→ `executeEngine.execute` → **Step-5** durable `decisionId` reserve→persist → executor `'connector'`
= `createWorkforceActionExecutor` → **Step-4 `verifyBoundaryB`** (deny ⇒ stop) → `runBinding` (case
`'m365'`, `runtimeCore.ts:2508`) → `connectors.m365Executor.execute('mail.send', …)` →
`M365Executor` gates (ownsAccount → confirmed → scopes → token) → `mail.ts send()` (Graph).

## 2. M365 IPC path `[PROVEN]`
renderer → secureBridge → `IpcChannel.M365ActionExecute` handler (`connectors/index.ts:467`,
`gateConnectorHandlers` → `connectors:manage` RBAC) → schema `M365ActionExecuteRequest`
(**NOT `.strict()`**, `contracts.ts:465`) → for `actionId==='mail.send' && mailSendAction`:
`governedSend({connectorId, accountId, params, confirmed, tenantId=deps.workspaceId(),
actorId=deps.actor()??'' , policyVersion:'m365-send-policy-1', …})` (`connectors/index.ts:480`) →
`CstKernel.run(request, effect)` (`cst/sendTransition.ts`) → `effect()` = `mailSendAction.run(...)`
(same `mail.ts send()`; Graph) → `mapSendOutcome`. Every **other** `actionId` (non-`mail.send`) →
`m365.execute(...)` directly (`:500`) — RBAC + executor confirmed-gate only, **no CST, no Boundary B**.

## 3. Shared components `[PROVEN]`
Only the **pure effect** `mail.ts send()` (`mail.ts:131`, registered in `ALL_M365_ACTIONS`). Both
ingresses ultimately invoke it — the worker path via `M365Executor.execute`, the IPC path via
`governedSend → action.run` (one layer below the executor, deliberately — `sendTransition.ts:7-15`).
The two ingresses share **nothing else**: not the claim, binding, decision id, enforcement, actor
identity, tenant, or consumption store.

## 4. Divergence points (core of the finding) `[PROVEN]`
| Property | Worker | M365 IPC | Verdict |
|---|---|---|---|
| Authority (actor id) | `session.user.id` (I-A.1) | `session.user.displayName ?? email` (`runtimeCore.ts:479-483`) | **DIFFERENT identity** `[PROVEN]` |
| Tenant | `activeTenantScope().tenantId` (org) | `deps.workspaceId()` (workspace) | **DIFFERENT scope** `[PROVEN]` |
| Decision identity | `proposal.verdict.requestId` (governance approval) | `req:${idem}:${time}`, `idem`=hash (no approval decision id) | **DIFFERENT** `[PROVEN]` |
| Bound claim | `BoundDecisionClaim` transported by ref | none; CST `Approval` object (confirmed⇒C3) | **DIFFERENT** `[PROVEN]` |
| Binding | 8-field `{executor,target,accountId,actionId,params,actor,tenantId,decisionId}` | 5-field `idempotencyKey`=sha256(`tenantId|connectorId|accountId|action.id|params`) — **no actor/executor/decisionId** | **DIFFERENT** `[PROVEN]` |
| Binding digest | sha256(canonicalize(8-field)) **verified** at Boundary B | idempotency hash (used for dedup, not verified vs a claim) | **DIFFERENT purpose** `[PROVEN]` |
| Temporal validity | `claim.expiresAt` (5 min) checked at Boundary B | `approval.expiresAt` (15 min, `APPROVAL_TTL_MS`) in kernel | both present, **different** `[PROVEN]` |
| Consumption | durable `decisionId` (`ExecutionStore`, atomic rename; restart-hydrated) | CST `IdempotencyStore` keyed by `idempotencyKey` — **in-memory, not crash-durable** (`sendTransition.ts:89`) | **DIFFERENT domain + durability** `[PROVEN]` |
| Replay protection | `decisionId` single-use across restart (Step-5 `seedHistory`) | same-message dedup within process lifetime only | **DIFFERENT** `[PROVEN]` |
| Boundary-B / gate | `verifyBoundaryB` before `runBinding` | `CstKernel.run` gate before `effect()` | **DIFFERENT mechanism** `[PROVEN]` |
| Pre-effect denial | DENY ⇒ `runBinding` not called (Step-4 tests) | DENY/HOLD ⇒ `effect()` not called, `effectCalls=0` (Phase-H) | equivalent property, **different impl** `[PROVEN]` |
| Executor reachability | `m365Executor.execute` only via Boundary B (worker) | `action.run` only via `governedSend` (mail.send); `m365Executor.execute` via RBAC+confirmed (non-mail.send) | see §16 `[PROVEN]` |
| Effect | `mail.ts send()` (Graph, ≤1) | `mail.ts send()` (Graph, ≤1) | **same pure send** `[PROVEN]` |

## 5–10. Comparisons (Parts 5–10)
- **Authority (§5):** both authoritative (from `authService`), but **different projections** —
  `user.id` (worker) vs `displayName ?? email` (IPC). Same person, non-equal identifiers. `[PROVEN]`
- **Claim (§3-recon):** IPC does **NOT** (A) receive the `BoundDecisionClaim`, (B) reconstruct the
  8-field binding, (C) verify `bindingDigest`, (D) use the governance `decisionId`, (E) touch the
  Step-5 consumption store, or (F) reach `verifyBoundaryB`. All six **diverge**. `[PROVEN]`
- **Binding (§8):** worker = 8-field, actor+tenant+decisionId bound; IPC = 5-field idempotency hash,
  **no actor/executor/decisionId**. Not comparable digests. `[PROVEN]`
- **Actor/Tenant (§6-7):** see table — different on both axes. `[PROVEN]`
- **Temporal (§10-time):** both enforce expiry, different TTLs/objects. `[PROVEN]`
- **Consumption (§9):** **INDEPENDENT domains.** Worker key = `decisionId` (proposal
  requestId, durable). IPC key = `idempotencyKey` (hash of tenant|connector|account|action|params,
  in-memory). If the worker consumes decision `D`, the IPC path can still send (its key is unrelated
  to `D`), and vice-versa. **No shared ledger.** `[OPEN]`
- **Replay/crash/restart (§10):** worker replay is denied across process restart (durable +
  `seedHistory`); IPC dedup is process-lifetime only (in-memory), so a restart **loses** IPC
  idempotency state. Neither claims provider idempotency; IPC Profile-A returns `UNKNOWN` on a lost
  response and never blind-retries (`sendTransition.ts`). `[PROVEN]` / durability gap `[OPEN]`

## 11. Renderer trust boundary (Part 4) `[PROVEN]`
- **Worker:** renderer supplies **none** of claim/actor/tenant/binding/target/account/action/params
  (`ExecuteRunRequest` `.strict()`, no `params`). Consequential fields originate in the trusted
  main process. `[PROVEN]`
- **M365 IPC:** `M365ActionExecuteRequest` is **NOT `.strict()`**; the renderer **directly supplies**
  `connectorId` (target), `accountId` (account), `actionId` (action), `params`, and `confirmed`
  (the C3 approval). Only `actor` and `tenant` come from the main process (`deps.actor()` /
  `deps.workspaceId()`). **Reported per Part 4:** renderer input **does** reach consequential fields
  on this path. This is **NOT an un-governed bypass** — the CST kernel authorizes the effect over
  authoritative identity + policy + connector facts (ownsAccount/scopes/token), and `confirmed` is
  the human C3 approval — but it is a **fundamentally different trust model** (authorize-at-ingress
  over a renderer-proposed action, vs verify-a-transported-claim with renderer exclusion). This is
  the central reason the two ingresses are **not equivalent**. `[PROVEN]`

## 15–16. Consequential-effect callers / alternate paths (Part 5) `[PROVEN]`
- Pure `mail.ts send()` callers: (1) `M365Executor.execute` — reached by worker (`runtimeCore:2509`,
  **after Boundary B**) and by IPC non-`mail.send` (`connectors/index.ts:500`, RBAC+confirmed);
  (2) `governedSend` (`connectors/index.ts:481`, IPC `mail.send`). No third caller in
  automations/webhooks/drafts (searched). `[PROVEN]`
- **No un-governed `mail.send` ingress:** IPC `mail.send` always takes the `governedSend` branch —
  the fallback to raw `m365.execute` requires `mailSendAction` to be null, but `mail.ts:131`
  registers `mail.send` in `ALL_M365_ACTIONS`, so `mailSendAction` is non-null by construction.
  Worker `mail.send` is claim-gated at Boundary B. **No route reaches the send without governance.**
  `[PROVEN]`
- **Scope note:** IPC **non-`mail.send`** M365 write actions reach `m365Executor.execute` with only
  RBAC + the executor confirmed-gate (no CST, no Boundary B). Those are **outside** the declared
  `mail.send` effect domain, but they are a real, broader ungoverned-by-CST surface worth a separate
  finding. `[PROVEN, out of scope]`

## 17. Crash/restart comparison — see §10. Worker durable; IPC in-memory. `[PROVEN]`/`[OPEN]`

## 18. Classification — **OPTION C — SEPARATE GOVERNANCE PATH EXISTS** `[PROVEN]`
Not Option A (not equivalent: no shared claim/binding/decision/consumption; different identity &
tenant). Not Option B by itself (equivalence needs more than a minimal extension — it needs identity
normalization, tenant normalization, a shared binding definition, and a shared consumption ledger).
Both ingresses **are** governed; they are **two boundaries**, not one.

## 19. Minimum required change (DESCRIBED, NOT authorized) `[DESIGN]`
To reach cross-ingress equivalence, a future gate would need ONE of:
- **B1 (unify enforcement):** have the IPC `mail.send` mint a `BoundDecisionClaim` at ingress over an
  8-field binding (normalizing identity to `user.id` and tenant to `activeTenantScope().tenantId`)
  and verify at a shared Boundary B, reusing Step-5 durable consumption. Large; touches frozen
  `sendTransition.ts`, `connectors/index.ts`, identity/tenant wiring.
- **B2 (unify consumption + identity only):** keep both mechanisms but share ONE durable
  consumption ledger and ONE normalized (identity, tenant, binding) definition so a decision consumed
  on either path blocks the other. Still touches frozen surfaces.
Either is a **substantial, separately-authorized** architectural gate — not doable within any prior
scope.

## 20. Frozen surfaces a reconciliation would affect `[DESIGN]`
`cst/sendTransition.ts` (governedSend/CST), `connectors/index.ts` (IPC handler), `m365/executor.ts`,
`packages/shared ipc/contracts.ts` (`M365ActionExecuteRequest`), the identity source (`user.id` vs
`displayName/email`), the tenant source (`tenantId` vs `workspaceId`), and possibly the claim
primitive/binding definition. All frozen ⇒ reconciliation requires its own gate.

## 21. Tests required (future gate, NOT written) `[DESIGN]`
Cross-ingress negative controls: same message via both ingresses; consumption on one blocks the
other; identity/tenant normalization; renderer cannot alter the normalized binding; restart replay
on the IPC path; equivalence of pre-effect denial on both paths.

## 22. H-FINDING-3 impact `[PROVEN]` / `[OPEN]`
- **Original bypass (un-governed worker path):** **CLOSED** — Boundary B gates the worker `mail.send`
  (Step-4). `[PROVEN]`
- **No un-governed `mail.send` ingress exists.** `[PROVEN]`
- **Cross-ingress EQUIVALENCE / single unified boundary:** **NOT PROVEN.** The two ingresses use
  different identity, tenant, decision identity, binding, enforcement, and consumption domains (IPC
  consumption non-durable). Therefore **H-FINDING-3 remains OPEN at PROGRAM scope**, refined: the
  openness is **non-unification**, not a silent bypass. `[OPEN]`

## 23. Exact certification boundary (strongest source-supported claim)
> "`mail.send` is governed on BOTH its ingresses — the worker path by pre-effect Bound Decision Claim
> verification at Boundary B over an exact 8-field binding with durable single-use consumption, and
> the Microsoft 365 IPC path by a CST-kernel authorization over authoritative identity, policy, and
> connector facts with process-lifetime idempotency. There is NO un-governed ingress to the
> `mail.send` effect. The two mechanisms are NOT equivalent and NOT reconciled: they use different
> actor identities (`user.id` vs display-name/email), different tenants (org vs workspace), different
> decision identities, different bindings, and independent consumption domains (the IPC path's
> consumption is in-memory, not crash-durable). A single unified governance boundary across ingresses
> is NOT established."

## 24. Non-claims
NOT: universally governed · all M365 actions governed (non-`mail.send` IPC = RBAC+confirmed only) ·
cross-ingress equivalence · shared consumption ledger · crash-durable IPC replay protection · unified
identity/tenant · provider idempotency · verified effect success · that renderer exclusion holds on
the IPC path (it does not — the effect is governed by authorization, not exclusion).

## Stopping
Read-only investigation complete. No source changed. **Classification: OPTION C.** H-FINDING-3
CLOSED for the un-governed-bypass concern, **OPEN at program scope** as a non-unification finding.
The next implementation gate (reconciliation B1/B2) must be **separately authorized**.
