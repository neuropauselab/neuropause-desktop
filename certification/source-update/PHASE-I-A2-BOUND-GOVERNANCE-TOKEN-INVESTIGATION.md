# Phase I-A.2 — Bound Governance Token / Decision Claim Investigation

## 1. Status
**READ-ONLY CERTIFICATION-ARCHITECTURE INVESTIGATION.** No source/test/kernel/executor
changes; no commit; no push. Every conclusion is tagged `[PROVEN]` (from repository),
`[INFERRED]` (from architecture), `[DESIGN]` (proposal), or `[OPEN]`.

## 2. Baseline commit
HEAD `f6872ed` (Phase I-A.1). Working tree clean. `[PROVEN]`

## 3. Scope
Can Model C safely transport a governance decision from Boundary A (workforce approval)
to Boundary B (`runBinding` `'m365'`) as a bound, integrity-protected, non-replayable
decision claim — for the `mail.send` worker ingress only.

## 4. Non-goals
No implementation. No token code. No `runBinding`/`governedSend`/executor/`mail.ts`/
kernel/`secureBridge` change. No universal-governance claim. No `AuthorityLease` (does
not exist — §17). No closing of H-FINDING-3 (that needs actual, separately-verified
Boundary-B enforcement).

## 5. Phase-H dependency
The eventual verification must preserve the Phase-H Profile-A contract: `202 →
ACKNOWLEDGED (≠ verified)`, definite rejection `→ EXECUTION_FAILED`, lost response `→
UNKNOWN` (once, no blind retry), `VERIFIED_SUCCESS` structurally unavailable. `[PROVEN]`

## 6. Phase-I Model-C dependency
Boundary A = admission governance (has context); Boundary B = consequential-effect
enforcement (`no valid governance state ⇒ no effect`). Governance is a capability ×
ingress relationship; a governed ingress ≠ a governed capability. `[PROVEN]`

## 7. Boundary A (issuer)
Workforce approval seam: `WorkforceProposalApprove/Reject` (`workforce/index.ts:385-406`)
→ `approveProposal` → `ProposalApproval { decision, decidedBy=user.id, decidedAt=runtime
clock, note }` (`workerRuntime.ts:246`); machine decision `GovernanceVerdict`
(`workforceGovernance.ts:92`). Post I-A.1 it binds the authoritative approver + time.
`[PROVEN]`

## 8. Boundary B (enforcer)
`runBinding` (`runtimeCore.ts:2482`), case `'m365'` (`:2498`) → `M365Executor.execute`
→ pure Graph send. Reached by (a) worker-approval (`setExecutionSubmit` → engine →
runBinding) and (b) `ExecuteRun` IPC. **Un-governed today (H-FINDING-3).** `[PROVEN]`

## 9. Existing approval model
`ProposalApproval` (`workforceJobs.ts:22-24`) + `GovernanceVerdict`
(`workforceGovernance.ts:92`: requestId/workerId/skillId/decision/reasons/checks/
evaluations/trustScore/risk/decidedAt). Neither is bound to the exact executor/target/
params, and neither is integrity-protected. `[PROVEN]`

## 10. Existing claim model
CST `Approval` (`@neuropause/cst` types): binds approver/action/scope/resourceVersion/
purpose/policyVersion/issuedAt/expiresAt/**consumed** (single-use). Constructed in
`importTransition.ts:177` / `sendTransition.ts`. **In-memory, not integrity-protected;
its binding is enforced only by the kernel evaluating it in-process.** `[PROVEN]`
`AuthorityLease` / `ExecutionClaim`: **DO NOT EXIST** as repo types (grep empty). `[PROVEN]`

## 11. Existing integrity primitives
- **Ed25519** — `nps/signature.ts` (sign/verify + keyId→PEM trust store);
  `workforce/install/signingKey.ts` = a **first-party LOCAL keypair**, get-or-create,
  persisted `0o600`, keyId = pubkey hash, registered trusted; `packaging.ts:35` signs a
  canonical digest. `[PROVEN]`
- **HMAC-SHA256** — `webhooks/signing.ts` (createHmac + timingSafeEqual, replay window),
  per-endpoint shared secret. `[PROVEN]`
- **Plain hashing** — `security/auditChain.ts` (SHA-256 chain, tamper-EVIDENT only; its
  own threat model admits a local attacker with write to entries+head can forge). `[PROVEN]`
- **Key provenance caveat `[INFERRED]`:** the Ed25519 key is locally generated and
  same-user readable (`0o600`). A signature proves **integrity/tamper-evidence**, NOT
  **authoritative external issuer identity**, and does NOT defend against a local
  privileged attacker who can read the key. "Tamper-evident" ≠ "issued by an
  unforgeable authority."

## 12. Existing canonicalization
`packaging.ts:14-27` — `sortKeys` (recursive key sort; arrays keep order) + `canonicalize
= JSON.stringify(sortKeys(...))`. Reusable for a parameter commitment. `[PROVEN]`
**Caveat `[INFERRED]`:** it does not itself normalize number formatting, `undefined`
vs omitted, Unicode NFC, or `Date`/binary; params must be constrained to JSON-safe,
explicitly-present fields, or the digest is representation-sensitive. CST idempotency
keys today use non-canonical `JSON.stringify`/concatenation (`importTransition.ts:167,195`)
— **not reusable as-is** for a binding digest. `[PROVEN]`

## 13. Existing replay primitives
CST `Approval.consumed` + `ClaimStore` + `IdempotencyStore` — **in-memory**
(`sendTransition.ts:89`: "not crash-durable; declared Node-20 limit"; durable path needs
`node:sqlite`/Node ≥22, unavailable). **In-process single-use ✓; cross-restart ✗ at the
CST layer.** `[PROVEN]`

## 14. Cross-restart durability primitive (the decisive finding)
`ExecutionStore` (V5.8, `executionStore.ts`) is **durable file persistence** for
ExecuteEngine sessions: on launch, in-flight sessions → `interrupted`, **never rerun**
(`executionStore.ts:6`, `runtimeCore.ts:2537`). **This is a real cross-restart
replay-protection primitive — at the execution-session layer, not the CST layer.** So
cross-restart single-use is achievable by anchoring a decision's consumption to the
durable session lifecycle (which is already never-rerun), not to the in-memory CST
`consumed`. `[PROVEN]` (mechanism) / `[DESIGN]` (anchoring the claim to it).

## 15. Expiry model
Authoritative `issuedAt` = the runtime clock established in I-A.1 (never renderer
`r.now`); `expiresAt = issuedAt + TTL` (CST pattern `APPROVAL_TTL_MS = 15 min`,
`importTransition.ts:50`). Checked at Boundary B; an expired claim is never renewed —
renewal = a new governance decision. `[PROVEN]` (primitives) / `[DESIGN]` (usage).

## 16. Revocation model
**None exists** (no revocation store). `[PROVEN]` For v1 a short TTL (expiry) is the
interim; explicit revocation (decision revoked / actor disabled / policy changed /
account disconnected / emergency stop) is **DEFERRED** — safe to defer *only* with a
short TTL and because consumption is single-use, so the exposure window is bounded.

## 17. Authority semantics
`AUTHENTICATED PRINCIPAL → AUTHORIZED APPROVER → GOVERNANCE DECISION → EXECUTION
AUTHORITY` must not be conflated. The claim is **evidence of a decision, not authority**.
`workforce:approve` establishes the approver is authorized to *approve*; it is **not** an
`AuthorityLease` (which does not exist). The claim must NOT manufacture execution
authority. `[PROVEN]`+`[DESIGN]`

## 18. Trust model (the key architectural finding)
**`ExecuteRunRequest` is `.strict()` and accepts only `{kind, targetId?, input?, label?}`
— no `params`, no `binding`, no `confirmed`** (`contracts.ts:113-131`). Therefore **the
renderer CANNOT inject a consequential `mail.send` binding**; the binding + `confirmed:
true` originate only from in-process worker-approval (`bindingToRequest`,
`setExecutionSubmit`). `[PROVEN]`

Consequence `[INFERRED]`: the worker→`runBinding` path is **in-process, trusted-code**;
the untrusted renderer is already excluded. So the threat surface is (a) an in-process
bug reaching `runBinding` without a decision, and (b) cross-restart replay. A
cryptographic serialized token adds **no** security against in-process code (which could
read the local signing key); the minimal safe primitive for the in-process path is an
**in-process by-reference decision claim** (a capability-style object that untrusted code
cannot obtain and that `runBinding` requires). Signing is only relevant when the claim
crosses to storage/another process — and there it is tamper-evident, not
issuer-authoritative (§11 caveat).

## 19. Token/claim alternatives
| Model | Fit | Note |
|---|---|---|
| A — in-process by-reference decision object | **RECOMMENDED (in-process path)** | unforgeable by renderer; in-process trusted; no crypto needed; consumption via CST claim + anchored to durable session |
| B — Ed25519-signed artifact | later (cross-process/persist) | tamper-evident with a LOCAL key; not issuer-non-repudiation; needed only if serialized |
| C — HMAC artifact | later | symmetric; same local-key limitation |
| D — reuse CST `Approval`/`ClaimStore` | **YES, as the in-process mechanism** | already binds action/scope/version/expiry/consumed; extend binding to the ExecutionBinding digest |
| E — hybrid (A now, B when transport crosses a boundary) | **direction** | avoids premature crypto |

**Do not introduce a second governance vocabulary:** reuse CST `Approval` + `ClaimStore`
as the in-process claim mechanism; the "decision claim" = a CST-style bound approval
carried by reference from A to B. `[DESIGN]`

## 20. Signature vs HMAC
Both exist. Neither is required for the in-process path (§18). If ever serialized: Ed25519
(asymmetric, verifier needs only the public key + trust store) is preferable to HMAC
(shared secret) for a future multi-party transport — but with a **local** key both are
tamper-evident, not issuer-authoritative. Who signs = the local main process; a worker
in the same process could read the key → **cannot** defend against in-process forgery by
crypto. `[INFERRED]`

## 21. Exact effect binding
Narrowest safe binding = a canonical digest over the fields that, if changed after
Boundary A, must invalidate the decision:

| Field | Required? | Prevents | Source | At A? | At B? |
|---|---|---|---|---|---|
| executor | YES | executor substitution | `ExecutionBinding.executor` | ✓ | ✓ |
| actionId | YES | action substitution (`mail.send`→other) | binding | ✓ | ✓ |
| target (connectorId) | YES | connector substitution | binding | ✓ | ✓ |
| accountId | YES | mailbox substitution | binding | ✓ | ✓ |
| canonical(params) | YES | recipient/subject/body substitution | binding.params | ✓ | ✓ |
| actor (user.id) | YES | actor substitution | I-A.1 approver | ✓ | (in claim) |
| tenantId | YES | cross-tenant reuse | engine tenant | ✓ | ✓ |
| policyVersion | YES | stale-policy reuse | GovernanceVerdict | ✓ | (in claim) |
| decisionId | YES | ties to the specific decision | verdict/approval | ✓ | (in claim) |
| issuedAt/expiresAt | YES | expiry | runtime clock | ✓ | (in claim) |
| nonce/jti | YES | replay | issuer | ✓ | (consumed) |
| purpose/intent/relationship | **NO** | — | **absent at A** (I-A.1 = approver only) | ✗ | — |
| risk | no | (metadata) | verdict | ✓ | — |

`purpose`/`intent`/`relationship`/`on-behalf-of` are **NOT present** at Boundary A
(I-A.1 captured only the approver principal). They are therefore **excluded** from the
binding — the effect binding does not need them, so their absence is **not** a blocker.
`[PROVEN]` (absence) / `[DESIGN]` (exclusion).

## 22. Parameter commitment
`bindingDigest = HASH(canonicalize({executor, target, accountId, actionId, params, actor,
tenant, policyVersion, decisionId}))` using `packaging.ts` `canonicalize` (NOT plain
`JSON.stringify`). Prerequisite: constrain params to JSON-safe explicit fields (§12
caveat). `[DESIGN]`

## 23. Boundary-B verification (order)
```
runBinding case 'm365':
  1. claim present?                 else DENY (no effect)
  2. integrity/authenticity ok?     (in-process: object identity; persisted: signature)
  3. not expired? (runtime clock)   else DENY
  4. recompute bindingDigest == claim.bindingDigest?  else DENY (mismatch)
  5. tenant/actor scope match?      else DENY
  6. atomic consume nonce (single-use, before effect)  else DENY (replayed)
  7. → executor (pure send)
```
Any failure ⇒ **no consequential effect** (fail closed), before the executor call. `[DESIGN]`

## 24. Cross-process semantics
Not required for v1 (worker is in-process). If ever cross-process, the by-reference
model breaks and a signed serialized claim + shared trust store is required — a **future**
architecture, out of scope. `[INFERRED]`

## 25. Cross-restart semantics
CST `consumed`/`ClaimStore` are in-memory (lost on restart) → a token-nonce single-use at
the CST layer alone is **NOT** cross-restart safe. **However**, the durable
`ExecutionStore` marks interrupted sessions and never reruns them (§14). Anchoring
consumption to session creation (persisted before the effect) yields cross-restart
single-use. **Prerequisite (design):** consume = create/commit a durable session *before*
the effect; on restart, the interrupted session is not rerun → no second effect. Without
this anchoring, cross-restart single-use is unmet. `[PROVEN]` (primitive) / `[DESIGN]`
(anchoring). Aligns with H-J: a lost response leaves the session interrupted → `UNKNOWN`,
never blind-retried.

## 26. Concurrency (TOCTOU)
`runBinding` runs on the Node event loop; a synchronous **check-then-consume** before the
first `await` (the Graph call) is atomic within the process (no preemption mid-sync).
Two concurrent deliveries of the same claim: the first synchronous consume wins; the
second sees consumed → DENY. Cross-process concurrency is out of scope (in-process only).
`reserve → execute → reconcile` is preferable to `consume-after-execute` to avoid a
double-send on retry. `[INFERRED]`+`[DESIGN]`

## 27. Crash / retry semantics
| Case | State | Retry? | Second effect? |
|---|---|---|---|
| valid claim, effect not started, crash | claim unconsumed OR session interrupted | governed re-attempt only via a new decision | no |
| effect started, crash, response lost | session interrupted → **UNKNOWN** | **no blind retry** (reconcile) | no (must not) |
| effect completed, ack lost | **UNKNOWN** | no | no |
| claim consumed, effect failed | consumed | new decision required | no |
| claim consumed, effect succeeded, worker retries | consumed → DENY | no | no |
| same claim concurrently twice | first consumes; second DENY | — | no |
Aligns with H-J (lost response → UNKNOWN, once, no retry). `[DESIGN]`

## 28. Error semantics (map to Phase-H)
MISSING / INVALID / EXPIRED / REPLAYED / BINDING_MISMATCH / ACTOR_MISMATCH /
TENANT_MISMATCH / POLICY_MISMATCH / UNKNOWN_DECISION / UNTRUSTED_ISSUER → **DENY / HOLD**
(governance refusal, no effect, `effectCalls 0`) — never `EXECUTION_FAILED`, never a
blind retry. Consumption-state-unavailable (post-restart) → **HOLD/UNKNOWN**, reconcile,
never assume valid. Only *after* a VALID claim + executed send do Phase-H transport
outcomes apply. `[DESIGN]`

## 29. Negative controls (Governance Bypass Reachability — design test requirements)
Must FAIL (→ DENY, no effect): no claim · invalid/forged claim · expired · replayed/
consumed · binding-mismatch (params/target/account/action/executor) · actor-mismatch ·
tenant-mismatch · wrong policyVersion · and — crucially — a `runBinding` `'m365'`
invocation with **no accompanying claim** must not reach the executor. Distinguish the
DESIGN property from a *currently proven runtime* property (not proven until implemented).

## 30. Certification implications (two gates)
This design can improve **Gate 1 (control correctness)** for the worker ingress. It does
**not** by itself close **Gate 2 (boundary completeness)** — `mail.send` remains reachable
via other ingresses, and enforcement must be implemented + independently verified.
**H-FINDING-3 stays OPEN** until real `runBinding` enforcement lands and passes. `[PROVEN]`

## 31. Implementation prerequisites (before any code)
1. **Primitive = in-process by-reference decision claim** (reuse CST `Approval`/`ClaimStore`), not a serialized crypto token, for the in-process path. `[DESIGN]`
2. **Cross-restart single-use** anchored to the durable `ExecutionStore` (consume = commit a durable session before the effect). `[DESIGN]`
3. **Canonical binding digest** via `packaging.ts` `canonicalize`, with params constrained to JSON-safe explicit fields. `[DESIGN]`
4. **Boundary-B enforcement in `runBinding`** — a frozen surface today; changing it is a *separate*, explicitly-authorized implementation gate (this investigation does not authorize it).
5. **Declared limitations:** local-key integrity = tamper-evidence, not issuer-non-repudiation; **revocation DEFERRED** (short TTL interim); in-process only (no cross-process).

## 32. Blockers
- **No hard architectural blocker** to the *in-process* design: authoritative actor+time ✓,
  decision object ✓, canonicalization ✓, exact binding ✓, in-process integrity (by-reference) ✓,
  in-process + cross-restart single-use ✓ (via ExecutionStore anchoring), Boundary-B point ✓,
  fail-closed ✓.
- **Declared limits (not blockers, must be recorded):** (a) cross-restart single-use requires
  anchoring to `ExecutionStore` (prerequisite, not free); (b) local-key crypto is not
  issuer-non-repudiation; (c) no revocation; (d) closes only the worker ingress (Boundary
  completeness stays incomplete).
- **Would become a BLOCKER if:** the design tried to (i) use in-memory CST `consumed` alone
  for cross-restart, (ii) claim cryptographic unforgeability against a local attacker, or
  (iii) require purpose/intent/relationship that Boundary A does not possess.

## 33. Recommendation
Proceed to a **narrow Phase I-A.3 DESIGN** for an in-process bound decision claim (Model
A / CST-`Approval`-reuse) with `ExecutionStore`-anchored cross-restart single-use and a
canonical binding digest — **then** a separately-authorized Boundary-B enforcement
implementation in `runBinding` (the gate that would begin to close H-FINDING-3). Do **not**
build a cryptographic serialized token for the in-process path. Keep Approval ≠ Authority
and the credential/governance separation frozen.

## 34. Decision table
| Question | Evidence | Result |
|---|---|---|
| Authoritative actor at A | I-A.1 `user.id` via authService (`f6872ed`) | **PASS** |
| Authoritative time | runtime clock (I-A.1); never `r.now` | **PASS** |
| Decision object | CST `Approval` + `GovernanceVerdict`/`ProposalApproval` | **PASS (reuse)** |
| Integrity primitive | in-process by-reference (primary); Ed25519/HMAC exist (persist only) | **PASS (with declared local-key limit)** |
| Canonical serialization | `packaging.ts` `canonicalize`/`sortKeys` | **PASS (constrain params)** |
| Exact effect binding | canonical digest of executor/target/account/action/params/actor/tenant/policy/decision | **PASS (design)** |
| Replay protection (in-process) | CST `consumed`/`ClaimStore` | **PASS** |
| Cross-restart protection | durable `ExecutionStore` (interrupted-never-rerun), anchored | **PASS (prerequisite)** |
| Expiry | runtime clock + `expiresAt` (TTL) | **PASS** |
| Revocation | none exists | **DEFER (short TTL)** |
| Boundary-B verification point | `runBinding` `'m365'` before executor | **PASS (point exists; enforcement not built)** |
| Credential separation | governance claim ≠ Graph OAuth token | **PASS** |
| Authority separation | claim = evidence, not authority; no AuthorityLease | **PASS** |
| Crash semantics | ExecutionStore interrupted → UNKNOWN, no rerun | **PASS (design, H-J-aligned)** |
| Concurrency semantics | event-loop atomic check-consume; in-process only | **PASS (design)** |

## 35. Final verdict
**IMPLEMENTABLE — for the in-process worker ingress, as an in-process bound decision
claim (Model A / CST-`Approval`-reuse), with `ExecutionStore`-anchored cross-restart
single-use and a canonical binding digest.** With a **required primitive clarification**
(no cryptographic serialized token for the in-process path; signing reserved for future
cross-process transport, where a local key is only tamper-evident) and **declared
prerequisites/limitations** (ExecutionStore anchoring; revocation deferred to short TTL;
closes only the worker ingress). The core invariant — *no valid governance claim ⇒ no
consequential effect* — can be realized honestly from existing primitives without
inventing identity, authority, or purpose that Boundary A lacks.

**H-FINDING-3 remains OPEN** — this is a design verdict, not enforcement; actual
`runBinding` enforcement is a separate, explicitly-authorized implementation gate.
