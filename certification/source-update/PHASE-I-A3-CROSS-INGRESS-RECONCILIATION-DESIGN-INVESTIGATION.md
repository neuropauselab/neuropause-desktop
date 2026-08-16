# Phase I-A.3 — Cross-Ingress Reconciliation DESIGN Investigation (READ-ONLY)

**No production code, no tests, no commit, no push, no frozen surface changed.** Baseline HEAD
`243ba73`. Effect domain: **`mail.send`**. Labels: `[PROVEN]` / `[INFERRED]` / `[DESIGN]` / `[OPEN]`.

## Result up front
**Classification: OPTION D — the two governance mechanisms should intentionally remain separate;
certify EFFECT-DOMAIN COVERAGE, not mechanism equivalence.** The technical basis is the OPTION-C
finding: neither B1 nor B2 is implementable without a **new authoritative cross-ingress DECISION
contract**, because the M365 IPC ingress has no governed decision object and the two consumption
models are keyed on semantically different things. Identity and tenant *can* be normalized from
existing authoritative sources, but that alone does not make the mechanisms equivalent, and forcing
equivalence would weaken CST's honest Profile-A model or misrepresent a direct user action as a
governed proposal. **Answer to the Part-10 certification question: YES**, scoped below.

## 1. Current architecture `[PROVEN]`
Two both-governed ingresses to the same pure effect `mail.ts send()` (registered `mail.ts:131`),
with no third caller (`governedSend` only at `connectors/index.ts:481`; `m365Executor.execute` only
at `runtimeCore.ts:2509` (worker) and `connectors/index.ts:500` (IPC non-mail.send)):
- **Worker:** approval → `BoundDecisionClaim` → transport → Step-5 durable `decisionId` consumption →
  Boundary B (`verifyBoundaryB`) → `runBinding` → `M365Executor.execute` → send.
- **M365 IPC:** renderer (`M365ActionExecuteRequest`, non-strict) → `governedSend` → `CstKernel.run`
  (policy + Approval + in-memory idempotency) → `action.run` → send.

## 2. B1 feasibility (route M365 IPC through Boundary B) `[DESIGN]/[OPEN]`
| # | Question | Source answer | Label |
|---|---|---|---|
| A | M365 IPC create/receive a governed decision equal to a worker verdict? | **No** — the IPC path has no `JobProposal`/`GovernanceVerdict`; the "decision" is the renderer `confirmed` flag. No `verdict.requestId` exists. | `[OPEN]` |
| B | Reconstruct the 8-field binding for M365? | Partially — see §7; all fields but `decisionId` are derivable. | `[DESIGN]` |
| C | Authoritative actor source? | `authService…session.user.id` (available; IPC currently reads `displayName ?? email`). | `[PROVEN]` |
| D | Authoritative tenantId source? | `activeTenantScope().tenantId` (available; IPC currently reads `workspaceId`). | `[PROVEN]` |
| E | connectorId/accountId/actionId/params → executor/target/accountId/actionId/params? | target=connectorId, accountId, actionId, params map 1:1; executor is implicitly `'m365'`. | `[INFERRED]` |
| F | Authoritative executor identity? | `'m365'` (constant for this connector) — not an existing typed field on the IPC request. | `[DESIGN]` |
| G | Use the existing `decisionId`? | **No** — there is no worker `decisionId` on the IPC path (no proposal). | `[OPEN]` |
| H | Participate in Step-5 durable consumption? | Only if a `decisionId` is minted — which requires G. | `[OPEN]` |
| I | Reach the executor only after Boundary B? | Would require re-routing IPC `mail.send` from `governedSend` to the `runBinding`/`verifyBoundaryB` chain. | `[DESIGN]` |
| J | Frozen surfaces B1 changes | `connectors/index.ts`, `cst/sendTransition.ts` (bypassed/removed), `contracts.ts`, m365 executor, identity/tenant wiring, possibly the claim primitive (decisionId provenance). | `[DESIGN]` |
| K | Eliminate or preserve CST? | Would **eliminate or duplicate** CST for `mail.send` — losing Profile-A UNKNOWN/ACKNOWLEDGED honesty. | `[OPEN]` — harmful |
| L | Create duplicate governance decisions? | Yes if CST is kept alongside Boundary B (two authorizations for one send). | `[OPEN]` |
**B1 blocker:** no authoritative governed decision exists on the IPC path (A/G/H). Minting one is a
**new decision contract**, and B1 would weaken CST. Not directly implementable.

## 3. B2 feasibility (shared identity/tenant/decision/binding + shared durable consumption, keep both) `[DESIGN]/[OPEN]`
| # | Question | Source answer | Label |
|---|---|---|---|
| A/B | Common authoritative identity/tenant both paths can produce? | **Yes** — `session.user.id` and `activeTenantScope().tenantId` are available on both. | `[PROVEN]` |
| C/D | Existing authoritative identity mapping (user.id ↔ displayName/email)? | Yes — same `session.user` object carries `{id,email,displayName}` (`auth.ts:46`, `authService.test.ts:88`); `user.id` is the stable one. No invention. | `[PROVEN]` |
| E | workspaceId → tenantId authoritatively? | Yes — `activeTenantScope()` returns `{tenantId=organization.id, workspaceId=workspace.id}` (`tenantContext.ts:214-215,479-480`); a workspace resolves to its org. | `[PROVEN]` |
| F | Reconcile the two decision identities? | **No** — worker `decisionId`=proposal approval; IPC has none. No shared decision object. | `[OPEN]` |
| G | Reconcile the two binding models? | All fields but `decisionId` reconcilable (see §7). | `[DESIGN]` |
| H | CST idempotencyKey become an alias of the worker decisionId? | **No** — different semantics: `decisionId` = one governance decision; `idempotencyKey` = one message CONTENT hash. Aliasing conflates decision-uniqueness with content-uniqueness. | `[OPEN]` |
| I | One durable record represent both? | Only by choosing ONE key. The only key derivable on both paths is the content hash — which is NOT the worker's decision key. | `[OPEN]` |
| J–N | Split verdicts / one consumes not the other / restart / concurrency | With independent domains: a worker send and an IPC send of the same content are **two decisions**; neither blocks the other; IPC store is in-memory (restart loses it); cross-path concurrency is unprotected. | `[OPEN]` |
**B2 blocker:** the two paths consume on **semantically different keys** (decision vs content). A
shared ledger keyed on `decisionId` has no cross-path effect (IPC has no decisionId); keyed on
content it would **over-suppress** legitimately distinct decisions (a user may approve sending the
same email twice). Plus it needs a durable shared store (CST is in-memory — frozen). Not cleanly
implementable or even clearly desirable.

## 4. Identity analysis `[PROVEN]`
Both paths authenticate via the same `authService` session, which carries `user.id` (stable),
`email`, and `displayName`. Worker uses `user.id`; IPC uses `displayName ?? email`. Normalizing IPC
to `user.id` is possible with **no invented identity** — but it changes the CST `Actor.id` and the
`PolicyStore` key, i.e. it modifies CST's authorization identity (frozen). A strengthening, but a
change requiring authorization.

## 5. Tenant analysis `[PROVEN]`
Worker = org `tenantId`; IPC = `workspaceId` (finer). `activeTenantScope()` exposes both, so the org
`tenantId` is available on the IPC path. A workspace authoritatively belongs to one org, so
workspace→tenant is derivable. Normalization is feasible but again a change to CST inputs (frozen).

## 6. Decision-identity analysis `[OPEN]`
Worker `decisionId = proposal.verdict.requestId` (`boundDecisionClaimMint.ts:83`) — an approval-
lifecycle identity. **The IPC path has no proposal and no verdict**; its `confirmed` flag is a direct
user confirmation, not a governed proposal decision. There is **no existing shared decision identity**
and none can be produced without a **new authoritative decision contract**. This is THE core blocker.

## 7. Binding analysis `[DESIGN]/[OPEN]`
| 8-field worker | M365 IPC source | Status |
|---|---|---|
| executor | `'m365'` (constant) | `[INFERRED]` |
| target | `connectorId` | `[PROVEN]` map |
| accountId | `accountId` | `[PROVEN]` |
| actionId | `actionId` (`'mail.send'`) | `[PROVEN]` |
| params | `params` | `[PROVEN]` |
| actor | `session.user.id` | `[PROVEN]` available |
| tenantId | `activeTenantScope().tenantId` | `[PROVEN]` available |
| decisionId | — (no proposal) | `[OPEN]` |
7 of 8 fields reconcilable; **`decisionId` is the sole gap**, and it is the same gap as §6. The
8-field worker binding is NOT altered by this analysis (read-only comparison). Normalizing would not
change any *existing* CST authorization semantics — CST would keep its own request — but it would
require CST to *also* carry the normalized identity/tenant, changing CST inputs.

## 8. Policy analysis `[PROVEN]` — COMPLEMENTARY, not incompatible
Worker omits `policyVersion` (I-A3-STEP2-FINDING-1: no authoritative per-decision policy version).
CST carries `'m365-send-policy-1'` (its kernel policy identifier). These are **different, unrelated
concepts** (an absent per-decision version vs a mechanism's policy id), not a conflict. Reconciliation
does **not** require merging them; each mechanism keeps its own. Do not add `policyVersion` to the
worker claim; do not remove it from CST.

## 9. Consumption analysis `[OPEN]` — the invariant does not cleanly apply
The Part-6 invariant ("a single governed decision must not be admitted twice through different
ingresses") presumes a decision that traverses both paths. **No such object exists**: a worker send
(proposal decision) and an IPC send (direct confirmation) are distinct decisions even for identical
content. The only cross-path concern is **content duplication** (same email via both), which is a
CONTENT-idempotency property, not decision-consumption — and enforcing it globally would suppress
legitimate distinct decisions. Conceptual trace: Worker-consumes-D then IPC-send = a *different*
decision (allowed); IPC-consumes-X then Worker-send = different decision (allowed); concurrent
cross-path = two authorized sends (unprotected against content dup); worker restart = durable
(protected); IPC restart = in-memory (protection lost).

## 10. Crash/restart analysis `[PROVEN]`/`[OPEN]`
Worker: durable `decisionId` (atomic rename) + `seedHistory` hydration ⇒ replay denied across
restart. IPC: in-memory CST idempotency ⇒ restart **loses** dedup state (declared Node-20 limit,
`sendTransition.ts:89`). Neither claims provider idempotency; IPC Profile-A returns `UNKNOWN` on a
lost response and never blind-retries.

## 11. Concurrency analysis `[PROVEN]`/`[OPEN]`
Within each mechanism, pre-effect single-admission holds (Step-5 synchronous reserve; CST
`effectCalls ≤ 1`). **Across** ingresses there is no shared serialization, so the same content could
be admitted once per path concurrently — again a content-dedup gap, not a governance bypass.

## 12. Renderer-trust analysis `[PROVEN]`
Worker excludes the renderer from all consequential fields (`.strict()`). IPC deliberately lets the
renderer supply target/account/action/params/confirmed (`M365ActionExecuteRequest` non-strict) and
governs them via CST authorization + human `confirmed`. B1 would impose renderer-exclusion on the
IPC path, breaking the **direct-action** model (a user saying "send this now" is not a pre-minted
proposal). This is a fundamental trust-model difference, not a defect.

## 13. Effect reachability `[PROVEN]`
Re-verified: no third caller of `governedSend`/`m365Executor.execute`/the pure send. `mail.send`
always takes `governedSend` on IPC (registered ⇒ fallback unreachable) and Boundary B on the worker
path. **No ungoverned route to the `mail.send` effect.**

## 14. B1/B2 decision matrix (source-supported)
| Dimension | B1 | B2 |
|---|---|---|
| Identity normalization | feasible (user.id), changes CST actor id `[DESIGN]` | feasible (user.id) `[PROVEN-feasible]` |
| Tenant normalization | feasible (activeTenantScope.tenantId) `[DESIGN]` | feasible `[PROVEN-feasible]` |
| Decision reconciliation | **needs new contract** `[OPEN]` | **needs new contract** `[OPEN]` |
| Binding reconciliation | 7/8; decisionId open `[OPEN]` | 7/8; decisionId open `[OPEN]` |
| Consumption | needs minted decisionId + Step-5 reuse `[OPEN]` | shared key ill-defined / over-suppresses `[OPEN]` |
| Restart | would make IPC durable (needs decisionId) `[OPEN]` | needs durable shared store `[OPEN]` |
| Concurrency | single mechanism ⇒ unified `[DESIGN]` | still two ledgers `[OPEN]` |
| Renderer trust | breaks IPC direct-action model `[OPEN]` — harmful | preserves IPC model `[PROVEN]` |
| CST preservation | eliminates/duplicates CST — loses Profile-A `[OPEN]` — harmful | preserves CST `[PROVEN]` |
| Boundary-B reuse | yes | no |
| Frozen surfaces | many (CST, connectors, contracts, executor, identity/tenant, claim) | several (connectors identity/tenant, a durable shared store, CST durability) |
| Implementation scope | large | large |
| Risk | high (weakens CST honesty; wrong trust model for direct action) | high (over-suppression; durable store; changes CST identity) |

## 15. Classification — **OPTION D** `[DESIGN]`
Not A (B1 not directly implementable — no governed decision on IPC, and it weakens CST). Not B (B2's
shared consumption is ill-defined and risks over-suppression; still needs a new decision contract for
true equivalence). C is technically true (**neither is implementable without a new authoritative
decision contract**) and is the *reason* D is correct: the missing piece is a genuine semantic
difference — a governed proposal-approval vs a direct user confirmation — and forcing equivalence
harms assurance (weakening CST's honest Profile-A model or misrepresenting a direct action). The two
trust models are legitimately different; the sound certification unit is the **effect domain**:
```
                mail.send EFFECT
        ┌──────────────┴──────────────┐
   WORKER INGRESS               M365 IPC INGRESS
   Boundary-B / claim /         CST kernel / policy /
   durable decisionId           in-memory idempotency
        └──────────────┬──────────────┘
              NO UNGOVERNED ROUTE
```

## 16. Minimum next change (if the program later WANTS unification) `[DESIGN]`
Prerequisite before any B1/B2: establish a **new authoritative cross-ingress decision contract** —
a governed decision identity that both a proposal approval and a direct M365 confirmation can
produce — plus a **durable shared consumption store** and an agreed **content-vs-decision key**
semantics. That is a separate, explicitly-authorized architectural gate. Under Option D, the minimum
change is **none to mechanisms**; only certification-scope documentation.

## 17. Frozen surfaces affected (by any future unification) `[DESIGN]`
`cst/sendTransition.ts`, `connectors/index.ts`, `contracts.ts` (`M365ActionExecuteRequest`),
`m365/executor.ts`, identity source (`user.id` vs `displayName/email`), tenant source (`tenantId` vs
`workspaceId`), the claim primitive/binding (decisionId provenance), and a new durable store. All
frozen ⇒ separate authorization required.

## 18. Required tests (only under a future unification gate) `[DESIGN]`
Cross-ingress: identity/tenant normalization equivalence; the new decision contract's uniqueness;
shared durable consumption blocking cross-path replay; pre-effect denial parity; restart replay on
the IPC path; no over-suppression of legitimately distinct decisions.

## 19. Certification boundary (Part 10 answer: **YES**, scoped) `[PROVEN]`
NeuroPause can certify:
> "For every identified ingress to the `mail.send` effect — the worker path and the Microsoft 365 IPC
> path — a consequential send cannot occur unless that ingress passes an authoritative governance
> mechanism appropriate to its trust model (worker: Bound Decision Claim + Boundary-B pre-effect
> verification + durable single-use `decisionId` consumption; IPC: CST-kernel authorization over
> authoritative identity + policy + connector facts, with pre-effect denial and process-lifetime
> idempotency), with enforceable pre-effect denial. There is no un-governed route to the effect."
**Scope:** the `mail.send` effect only; the two known ingresses; durability = worker process-restart
(durable) and IPC single-process (in-memory) boundaries; **effect-domain coverage, NOT mechanism
equivalence and NOT cross-ingress content de-duplication.**

## 20. Non-claims
NOT: mechanism equivalence · single unified boundary · one shared consumption ledger · cross-ingress
content de-duplication (the same message may be independently authorized and sent via both paths) ·
crash-durable IPC replay protection · unified identity/tenant/decision · all M365 actions governed
(non-`mail.send` IPC = RBAC+confirmed only, outside this domain) · universal governance.

## 21. H-FINDING-3 impact
- Worker un-governed bypass: **CLOSED** `[PROVEN]`.
- No un-governed `mail.send` ingress: **CLOSED** `[PROVEN]`.
- Program-scope MECHANISM equivalence: **not pursued** — Option D reframes the target as **effect-
  domain coverage**, which IS certifiable (§19). H-FINDING-3, in its original bypass framing, is
  **resolved**; the residual (mechanism non-unification + IPC consumption durability + no cross-
  ingress content dedup) is a **declared limitation**, not an open bypass. Recommend re-stating
  H-FINDING-3 as: *"the mail.send effect domain has full governed-ingress coverage with per-ingress
  pre-effect denial; mechanism unification is intentionally out of scope."* `[DESIGN]`

## Stopping
Read-only design investigation complete. **Classification: OPTION D.** No code, no tests, no commit,
no push, no frozen surface changed. Any unification (B1/B2) requires a separately-authorized gate
that first establishes a new authoritative cross-ingress decision contract.
