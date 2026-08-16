# Phase I-A.3 — Bound Decision Claim: Design (contract before code)

> **SUPERSEDED IN PART (I-A3-STEP2-FINDING-1 / Option c):** the implemented v1 binding is
> **EIGHT** fields — `executor, target, accountId, actionId, params, actor, tenantId,
> decisionId`. **`policyVersion` was removed** because no authoritative per-decision policy
> version exists at Boundary A (a static substitute would misrepresent weaker provenance).
> Every `policyVersion` reference below is historical; the shipped binding excludes it.

## 1. Status
**DESIGN ONLY — no code, no `runBinding` change, no commit of source.** Specifies the
implementation contract for an **in-process bound decision claim** (Phase I-A.2 verdict:
IMPLEMENTABLE, in-process by-reference, not a serialized crypto token). Baseline HEAD
`0d8b30d`. Tags: `[PROVEN]` (repo), `[DESIGN]` (proposal), `[OPEN]`.

## 2. Objective
Define exactly how a governance decision minted at Boundary A (workforce approval) is
carried, in-process and by reference, to Boundary B (`runBinding` `'m365'`) and verified
before the effect — so that **no valid claim ⇒ no consequential effect** — for the
`mail.send` worker ingress only. Enforcement in `runBinding` remains a **separate,
explicitly-authorized implementation gate**; this document is its contract.

## 3. What is the claim object?
`[DESIGN]` `BoundDecisionClaim` — a small in-process object (a CST-`Approval` superset),
passed **by reference** on the in-process `ExecutionRequest`; never serialized to the
renderer, never a network/crypto token.
```
BoundDecisionClaim = {
  // reused, CST-Approval-shaped:
  approvalId, transitionId, approver /*=actor user.id*/, action, scope,
  resourceVersion, purpose, policyVersion, issuedAt, expiresAt, consumed,
  // added for exact effect binding + single-use:
  decisionId,        // ties to the GovernanceVerdict/ProposalApproval
  bindingDigest,     // sha256(canonicalize(binding)) — §6
  nonce,             // single-use id
}
```

## 4. What existing Approval fields are reused?
`[PROVEN]` CST `Approval` (`@neuropause/cst` types) fields reused verbatim:
`approvalId, transitionId, approver, action, scope, resourceVersion, purpose,
policyVersion, issuedAt, expiresAt, consumed`. **Added:** `decisionId, bindingDigest,
nonce`. The CST kernel is unmodified; the claim is an adapter-level superset (the
`importTransition.ts`/`sendTransition.ts` pattern), so `@neuropause/cst` and
`GovernanceVerdict`/`ProposalApproval` contracts are **untouched**. `[DESIGN]`

## 5. Exact binding structure
`[DESIGN]`
```
Binding = {
  executor,        // ExecutionBinding.executor  (= 'm365')
  target,          // connectorId
  accountId,
  actionId,        // 'mail.send'
  params,          // the send params (to/cc/bcc/subject/body/bodyType/saveToSentItems)
  actor,           // authoritative user.id (I-A.1)
  tenantId,
  policyVersion,
  decisionId,
}
```
Excluded (absent at Boundary A, per I-A.1 — do not invent): `purpose`(free-text only),
`intent`, `relationship`, `on-behalf-of`, `agent identity`.

## 6. Canonicalization + bindingDigest
`[PROVEN]`+`[DESIGN]` Use `packaging.ts` `canonicalize`/`sortKeys` (recursive key sort;
arrays keep order) — **not** plain `JSON.stringify`. Prerequisite: constrain `params` to
JSON-safe, explicitly-present primitive fields (no `undefined`, `Date`, binary; Unicode
NFC-normalized) so the digest is representation-stable.
```
bindingDigest = sha256hex( canonicalize(Binding) )    // node:crypto createHash (as CST adapters already do)
```
Any post-decision change to executor/target/account/action/params/actor/tenant/policy/
decision ⇒ a different digest ⇒ verification fails ⇒ DENY.

## 7. Where is the claim attached to the execution session?
`[PROVEN]` (flow) / `[DESIGN]` (attachment). The in-process path is:
`approveProposal` → `bindingToRequest(job, proposal)` (`workforce/execution/router.ts:31`)
→ `ExecutionRequest.params = {binding, jobId, proposalId}` → `ExecuteEngine.execute`
(`executeEngine.ts:77`) → `'connector'` executor (`workforceActionExecutor`) → `runBinding`.
**Attachment:** the claim rides on `ExecutionRequest.params.claim` (in-process by
reference); the `'connector'` executor forwards it to the Boundary-B verifier before
`runBinding` invokes `M365Executor.execute`. The claim's `nonce`/`decisionId` is also
stamped on the `ExecutionSession` (§8).

## 8. How does ExecutionStore persist its lifecycle?
`[PROVEN]` `ExecuteEngine.execute` **persists the session BEFORE the executor runs**:
`this.sessions.set(id, session); this.deps.persist?.(session)` (`executeEngine.ts:110-111`),
*then* `await executor(...)` (`:130`). `ExecutionStore` (`executionStore.ts`) is durable
file storage; on boot, in-flight sessions → `interrupted`, **never rerun**
(`executionStore.ts:6`, `runtimeCore.ts:2537`). **Design:** stamp the claim's
`decisionId`/`nonce` onto the persisted `ExecutionSession` so the durable set is the
single-use ledger — no new store. (Requires a `decisionId?` field on `ExecutionSession`
— a shared-type addition, enumerated in §26.)

## 9. What constitutes claim consumption?
`[DESIGN]` Consumption = **a committed durable session bearing this claim's `nonce` has
passed the pre-effect gate**. Because the session is persisted before the effect (§8),
the durable existence of a session for the `nonce` *is* the consumption record. A replay
presenting the same `nonce` finds a prior session → DENY.

## 10. How is consumption atomic?
`[DESIGN]` At Boundary B, before the first `await` (the Graph call), perform a
**synchronous** check-then-reserve: (1) is there a prior session for this `nonce` in the
in-memory set (loaded from durable on boot)? if yes → DENY; (2) else reserve the `nonce`
(mark on this session) synchronously. The Node event loop guarantees no preemption within
the synchronous block (TOCTOU-safe in-process). The durable `persist` (already at
`:111`) follows the reservation and precedes the effect. In-process only (no cross-process
concurrency).

## 11. What happens after restart?
`[PROVEN]`+`[DESIGN]` The prior session for the `nonce` is loaded (`loadAllSync`) and, if
in-flight, marked `interrupted` — **never rerun**. A replay with the same `nonce` finds
that session → DENY. No second effect. (H-J-aligned: an interrupted send is `UNKNOWN`,
reconciled, never blind-retried.)

## 12. Concurrent delivery
`[DESIGN]` First synchronous reserve wins; the second sees the reserved `nonce` → DENY.
No double send.

## 13. Lost response after transmission
`[DESIGN]` Session left `running`/`interrupted` → **UNKNOWN**; not `EXECUTION_FAILED`;
**no blind retry**; reconcile before any resend. (Phase-H H-J.)

## 14. Effect success but acknowledgment loss
`[DESIGN]` **UNKNOWN** (the send may have happened); `nonce` remains consumed; no retry.

## 15–20. Change/expiry/missing/replay outcomes (all fail closed, no effect)
`[DESIGN]`
| Condition | Outcome |
|---|---|
| params change | `bindingDigest` mismatch → **DENY** |
| target/account/action change | digest mismatch → **DENY** |
| policyVersion change | digest mismatch (policyVersion is in the binding) → **DENY** |
| actor change | digest mismatch → **DENY** |
| tenant change | digest mismatch (+ explicit tenant check) → **DENY** |
| claim expired (`now > expiresAt`, runtime clock) | **DENY** |
| claim missing | **DENY** (no effect) |
| claim replayed (nonce consumed) | **DENY** |

## 21. Exact error to the caller
`[DESIGN]` A governance refusal maps to the existing `ConnectorWriteResult`
(as `sendTransition`'s `mapSendOutcome` does): `{ ok:false, data:{ outcome:'DENIED'|'HOLD'|
'UNKNOWN' } , message }`. A DENY/HOLD is a **governance refusal (`effectCalls 0`)**, never
`EXECUTION_FAILED`. `UNKNOWN` never triggers a blind retry. Preserves the Phase-H contract
(202→ACKNOWLEDGED; definite rejection→EXECUTION_FAILED; lost→UNKNOWN; no structural
VERIFIED_SUCCESS).

## 22. Evidence written
`[PROVEN]`+`[DESIGN]` Reuse existing evidence: the `ProposalApproval`/`GovernanceVerdict`
(persisted via `jobStore`/`auditLog`), the durable `ExecutionSession` (carrying
`decisionId`/`nonce`/outcome), and optionally an `AuditChain` entry
(`governanceStore`/`auditChain.ts`). **No new evidence store.** No new provenance
vocabulary.

## 23. Negative controls (Governance Bypass Reachability — design test requirements)
`[DESIGN]` Must FAIL (→ DENY, `effectCalls 0`, no Graph call): **no claim** · forged/
invalid claim · expired · replayed (nonce consumed) · binding-mismatch (params/target/
account/action/executor) · actor-mismatch · tenant-mismatch · wrong policyVersion.
**Flagship:** a `runBinding` `'m365'` invocation with **no accompanying claim** must not
reach `M365Executor.execute`. Plus a **cross-restart replay** control: consume → restart
(interrupted) → replay same nonce → DENY, no second send. These are *design* requirements;
they become *proven runtime* properties only when implemented + verified.

## 24. What would runBinding verification do (Boundary B order)
`[DESIGN]`
```
runBinding case 'm365' (mail.send), before invoking M365Executor.execute:
  claim = request.claim
  if !claim                                  → DENY (missing)
  if now > claim.expiresAt (runtime clock)   → DENY (expired)
  if sha256(canonicalize(actualBinding)) != claim.bindingDigest → DENY (mismatch)
  if claim.tenantId != runtime tenant        → DENY (tenant)
  if nonce already consumed (durable set)    → DENY (replayed)
  reserve(nonce) synchronously               // atomic, pre-effect
  → M365Executor.execute (frozen)            // the send
```
Any failure ⇒ no executor call. Enforcement lives at `runBinding` — a **frozen surface**;
implementing it is the next, separately-authorized gate.

## 25. Trust / non-claims (frozen)
`[PROVEN]` In-process by-reference (renderer cannot inject a binding — `ExecuteRunRequest`
`.strict()`, `contracts.ts:113`). No cryptographic token for the in-process path. The
claim is **evidence of a decision, not authority** (Approval ≠ Authority; no
`AuthorityLease` — does not exist). Governance claim ≠ Graph OAuth credential. Local-key
signing (if ever serialized) = tamper-evidence, not issuer-non-repudiation. Revocation
**DEFERRED** (short TTL interim). This closes only the **worker ingress** for `mail.send`
— boundary completeness stays incomplete; **H-FINDING-3 stays OPEN** until enforcement is
implemented + verified.

## 26. Exact files that would eventually change (implementation gate — NOT now)
`[DESIGN]`
- **New:** `apps/desktop/src/main/cst/boundDecisionClaim.ts` — the claim object +
  `bindingDigest` (canonicalize + sha256) + verify function (the sole new module).
- **New test:** `boundDecisionClaim.negative.test.ts` — the §23 bypass controls.
- **Boundary A (mint):** `workforce/index.ts` approve handler (or a thin mint call) —
  build the claim from `ProposalApproval` + `GovernanceVerdict` + the binding.
- **Threading:** `workforce/execution/router.ts` (`bindingToRequest` — attach
  `params.claim`), and the `'connector'` executor (`workforceActionExecutor.ts`) to
  forward the claim to the verifier.
- **Boundary B (enforce):** `runtimeCore.ts` `runBinding` case `'m365'` — verify before
  `M365Executor.execute`. **(FROZEN today; separate authorized gate.)**
- **Durable single-use:** stamp `decisionId?/nonce?` on `ExecutionSession` — a
  `packages/shared` type addition + `executeEngine.ts`/`executionStore.ts` wiring.
- **UNCHANGED:** kernel, `M365Executor.execute`, `mail.ts`, `governedSend`/`sendTransition`,
  `secureBridge`, CST contracts, Data Import, the Phase-H IPC path.

## 27. Prerequisites before implementation
1. Confirm the primitive = in-process by-reference claim (I-A.2 §35). 2. Confirm
`ExecutionSession` may carry `decisionId/nonce` (shared-type addition). 3. Confirm the
durable-session-as-single-use-ledger anchoring (§8-11). 4. Confirm params
canonicalization constraints (§6). 5. Confirm `runBinding` enforcement is a **separate
authorized gate**. 6. Confirm revocation deferred (short TTL).

## 28. Decision gate
**DESIGN COMPLETE — READY FOR REVIEW.** On acceptance, the next step is a **narrow,
separately-authorized implementation gate** in this order: (a) `boundDecisionClaim.ts` +
negative controls; (b) Boundary-A mint; (c) claim threading; (d) `ExecutionSession`
single-use anchoring; (e) **Boundary-B enforcement in `runBinding`** — only (e) begins to
close H-FINDING-3, and only after its negative controls pass. No code until authorized.
**H-FINDING-3 remains OPEN.**
