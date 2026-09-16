# Phase G — Second Governed Transition: Selection + Design (DESIGN ONLY)

**Status: DESIGN ACCEPTED — with the frozen clarification `ACKNOWLEDGED ≠ VERIFIED`
(see § G-ASSURANCE and FINAL DESIGN DECISION). Selection/architecture/scope
unchanged; assurance contract clarified. Implementation (Phase H) is a separate,
not-yet-authorized step.**

This is a **design document, not an implementation**. It contains **no code, no
refactor, no abstraction, no kernel change, no durability change, no semantic
change, and nothing is pushed.** It ends in a decision gate, not a commit.

Reference baseline for all comparison: Data Import governed transition, frozen at
`fcb3a31` (`DATA-IMPORT-GOVERNED-TRANSITION-REFERENCE.md`).

---

## G1 — Candidate selection

**Selected second transition: the Microsoft 365 write action `send-mail` — one
bounded connector send (send an email via Microsoft Graph).**

- Entry: IPC `connectors:m365.execute` (`M365ActionExecute`) →
  `connectors/index.ts:395` → `M365Executor.execute` (`connectors/m365/executor.ts:78`).
- Effect: `connectors/m365/mail.ts:49` `send()` → `ctx.http.postJson('${GRAPH}/me/sendMail', …)`.
- It is the leaf that the AI-drafting path feeds: `M365Draft` (`connectors/index.ts:405`,
  "AI drafting") composes → human confirms → `send-mail` executes. Governing this
  leaf governs the consequential end of the *"AI proposes: send this approved
  message to customer X"* flow **without** governing the ExecuteEngine orchestrator.

**Documented runner-up: the infrastructure action executor** (`infrastructure/executor.ts:61`,
IPC `InfraAction`; restart/terminate/scale/revoke a cloud resource). Equally external
and bounded. **Chosen against** only because a cloud resource action usually offers a
clean remote state read-back (describe-instance → `terminating`), whereas `send-mail`
is **non-idempotent with no natural read-back** — which stresses idempotency and
verification harder and is therefore the sharper test of the frozen contract. Infra
action remains a valid third transition later.

**Rejected candidates** (from reconnaissance): webhook dispatcher (event-driven
delivery *framework*, already heavily governed — not a discrete intent);
ExecuteEngine/assistant (broad orchestrator — architecture-project scope; govern its
leaves instead); ERP document adapter and Decisions and most of Cloud (LOCAL data
mutations — same class as the reference, not "different").

---

## G0 GATE — Proof the transition is genuinely different

Not another adapter of the import family. The consequence model is categorically
different: **Data Import mutates a LOCAL in-profile store; `send-mail` causes an
EXTERNAL, non-idempotent, irreversible side effect on Microsoft's servers.**

| Dimension | Data Import (reference) | M365 `send-mail` (second) |
|---|---|---|
| Input | Import plan (`planId` + approvals) | Send request (`connectorId, accountId, actionId, params, confirmed`) |
| Resource | Local destination store | Remote mailbox / Microsoft Graph |
| Consequence | Local data mutation | External side effect (email leaves the org) |
| Reversibility | Effectively reversible (records editable) | **Irreversible** — a sent email cannot be unsent |
| Identity | Local principal (actor + tenant) | Principal + **provider/account identity** (Graph token, `accountId`) |
| Authorization | Import approval + module WRITE scope | Action authority + **Graph scopes** (provider-enforced, least-privilege) |
| Pre-state | Local destination version (`ResourceStore.key`) | Remote state / **"already sent?"** — no cheap read |
| Execution | `applyImportPlan` (local) | `postJson /me/sendMail` (network) |
| Observation | Local authoritative read-back (`readBack`) | **202 Accepted, no message id** — nothing to read back for free |
| Verification | `observed === expectedPostState` | **Not freely available** — see Verification / UNKNOWN |
| Replay protection | Row-level `externalKey` (local) | **None today** — retry sends a DUPLICATE |
| Timeout | Local execution (deterministic) | **Ambiguous remote outcome** ("executed but unknown") |
| Recovery | Governed re-import (idempotent) | Reconcile / compensation (hard — cannot unsend) |
| Evidence | TransitionOutcome + provenance | TransitionOutcome + provider ack + (proposed) remote trace |
| Durability | CST in-memory limit (Node 20) | Same CST limit + remote provider persistence |
| Unknown state | Observable locally | **Potentially unresolvable** without remote reconcile |

G0 verdict: **PASS — genuinely different.** It is the mirror image of the reference
(external vs local) and introduces four properties the reference never exercised:
irreversibility, non-idempotency, ack-≠-effect, and unresolvable-UNKNOWN.

---

## G2 — Consequence declaration (what state it can change)

`send-mail` can cause exactly one consequence: **transmit an email from the
authorized account's mailbox to the specified recipients** (`to/cc/bcc`, subject,
body, optional `saveToSentItems`). It cannot delete, cannot read other mailboxes,
cannot act on another tenant's account. Consequence class: **C3** (consequential,
approval/confirmation-bound) and **irreversible** — never downgradable. There is no
"low-risk send"; every `mutates` action is C3 by presence (consistent with the
frozen C3-by-presence rule).

## G3 — Control-scope declaration

| Facet | Declaration |
|---|---|
| Runtime | Desktop main process, Node 20 / Electron 42 (same CST in-memory durability limit as the reference) |
| Environment | Online; requires a connected M365 account with a valid auto-refreshing Graph token |
| Identity | Local principal (actor + tenant) **and** provider account identity (`connectorId`+`accountId`, Graph bearer) |
| Provider | Microsoft Graph (`graph.microsoft.com`), rate-gated shared transport (`rateGateKey`) |
| Resources | The remote mailbox (send) and Sent Items (proposed read-back); no local destination |
| Policy | `send-mail` → C3, approval/confirmation required; scopes least-privilege (`Mail.Send`) |
| Authorization | `ownsAccount` (tenant owns the account) + Graph scope validation + provider-side enforcement |
| Verification | Proposed: remote read-back of Sent Items by a client idempotency key (see Verification) |
| Evidence | TransitionOutcome envelope + platform events (started/completed/failed) + write-health |
| Recovery | Reconcile UNKNOWN by remote lookup; **no compensation** (cannot unsend) |

---

## Governed design (PROPOSED — how it *would* route through the frozen kernel)

The proposal mirrors the reference exactly: **one adapter + one call site**, the
existing `M365Executor.execute` effect preserved verbatim as the kernel `effect`.
Nothing below is implemented in Phase G.

### Request contract
`{ connectorId, accountId, actionId: 'send-mail', params: { to, cc?, bcc?, subject, body, bodyType?, saveToSentItems? }, confirmed }`
(unchanged IPC shape; `M365ActionExecuteRequest`). The adapter adds a **client
idempotency key** derived deterministically from the request (see Idempotency).

### Identity model
Actor = `{ id: actorId, type: 'HUMAN', tenantId }` (as the reference). The provider
identity (`connectorId`+`accountId`) is bound into the transition **target/subject**,
because "who may send from THIS mailbox" is a provider-scoped question
(`ownsAccount` already answers it).

### Governance model
`CstKernel.run(request, effect)` is the single verdict. `send-mail` is classified
**C3 by presence** (it `mutates`). Verdicts: ALLOW / HOLD / DENY / ESCALATE, same
vocabulary. `expectedPostState` must be **non-vacuous** — proposed `{ sendResolved: true }`,
mirroring `{ importResolved: true }`.

### Authorization model
Three layers, all preserved: (1) `ownsAccount` tenant authorization
(`executor.ts:96`); (2) Graph scope validation `Mail.Send` (`executor.ts:107`);
(3) provider-side least-privilege enforcement. The CST approval object is supplied
only when the C3 send is confirmed — the existing `confirmed === true` gate
(`executor.ts:101`) maps to the kernel's approval requirement (confirmation IS the
approval for this transition).

### Claim semantics
A won claim is required to proceed. **Claim subject = `tenantId / m365-send / <idempotencyKey>`.**
This is the new hard guarantee the executor lacks today: two concurrent identical
sends contend for one claim, so only one reaches the effect — preventing concurrent
duplicate emails.

### Pre-state revalidation
For the reference, this re-checks the local destination version. For `send-mail`,
pre-state is **"has this idempotency key already been sent?"** Proposed: an
idempotency-store check (fast path) plus, on reconcile, a remote Sent-Items lookup
by key. If already sent → **VERIFIED_NOOP** (do not resend). This is the direct
analogue of the reference's re-import NOOP.

### Execution boundary
The kernel `effect` wraps the **unchanged** `M365Executor.execute` →
`send()` → `postJson /me/sendMail`. Executes only on ALLOW + won claim + pre-state
revalidation, exactly as `applyImportPlan` does.

### Observation model
The reference reads local state authoritatively. `send-mail` returns **202 Accepted
with no message id** — the provider ack is **not** an observation of effect. Proposed
observation: attach a **client-generated `internetMessageId`** (or a custom
`SingleValueExtendedProperty`) to the outgoing message, then **read back Sent Items**
filtered by that id. Presence in Sent Items = authoritative EFFECT_CONFIRMED.

### Verification model
`observed === expectedPostState`. Verification succeeds only when the Sent-Items
read-back finds the message with the idempotency key → `{ sendResolved: true }`.
**Crucially: without the read-back, the honest ceiling is `ACKNOWLEDGED`, not
`VERIFIED`.** The frozen principle applies unchanged — the ack is SEEN/EXECUTED, not
EFFECT_CONFIRMED, not VERIFIED. The design does **not** let a 202 masquerade as
`VERIFIED_SUCCESS` (which is exactly the current `mail.ts:57` `ok: true` collapse).

### UNKNOWN conditions (the heart of this transition)
```
REQUEST SENT  →  response lost / timeout  →  the email MAY have been sent
              →  outcome = UNKNOWN   (NOT failure, NOT success)
```
Today `executor.ts:148` collapses this into FAILURE (`failedWrites++`, returns
`{ok:false}`) — dishonest, because the mail may have gone. Proposed honest model:
- 202 received but read-back not yet done → `ACKNOWLEDGED` (executed, effect not yet
  confirmed).
- Network timeout / lost response → **`UNKNOWN`** → schedule reconcile.
- Reconcile queries Sent Items by idempotency key: found → `VERIFIED_SUCCESS`; provably
  absent after a bounded window → `VERIFIED_FAILURE`; still indeterminate → remains
  `UNKNOWN` (never upgraded). `UNKNOWN ↛ VERIFIED`, `ABSENCE ↛ PROOF` hold verbatim.

### G-ASSURANCE — Frozen assurance contract (the required clarification)

> **v1 shall implement governed execution with explicit `ACKNOWLEDGED` and `UNKNOWN`
> outcomes. `VERIFIED_SUCCESS` shall only be available when a genuine authoritative
> remote observation path exists. Idempotency shall be represented explicitly, but
> NeuroPause shall not claim provider-enforced duplicate suppression unless the
> provider contract establishes it.**

**`ACKNOWLEDGED ≠ VERIFIED_SUCCESS`** is a **frozen invariant** of this transition.
A 202 is acceptable as a terminal *operational* outcome (`ACKNOWLEDGED`); it is
**never** a synonym for `VERIFIED_SUCCESS`. The assurance model must not be weakened
to make the connector "green" — expose the actual verification ceiling instead.

**Five distinct propositions behind one 202** — record the *strongest claim actually
supported by evidence*, never a stronger one:

```
P1  NeuroPause transmitted the request        (SEEN / EXECUTED)
P2  Graph accepted the request                (a 202 supports ~this)
P3  Graph processed the request
P4  The message entered the intended remote mail state   (EFFECT_CONFIRMED)
P5  The recipient received the message
```
A 202 can support ~P2. It does **not** establish P4 or P5. `ACKNOWLEDGED` = "P2-ish";
`VERIFIED_SUCCESS` requires P4 via authoritative observation.

**Three levels that must never be collapsed:**

```
Level 1  Local intent identity      action_id / transition_id / request_id / idempotency_key   (NeuroPause controls)
Level 2  Remote acknowledgement      HTTP 202                                                   (provider controls)
Level 3  Remote effect verification  message in an authoritative observable state               (depends on provider)
```
Level 1 ≠ Level 2 ≠ Level 3. A locally generated `client_message_id` is useful for
**correlation**; it does **not** by itself establish that a retry will not duplicate
the external effect. That claim requires the actual provider contract to guarantee
duplicate suppression — until then, retry safety is NOT assumed.

**Two capability profiles (do not pretend Profile A is Profile B):**

```
Profile A — acknowledgement-only (legitimate v1)
  Govern → Authorize → Claim → Execute → 202 → ACKNOWLEDGED → Evidence
  (ACKNOWLEDGED, terminal; NEVER labelled VERIFIED)

Profile B — remotely verifiable (separate capability; only if the provider exposes
            a sufficiently authoritative observation mechanism)
  Govern → Authorize → Claim → Execute → ACK → Observe → Verify → VERIFIED_SUCCESS
```

**v1 outcome model** (superset of the reference; `VERIFIED_SUCCESS` is *impossible*
unless a real verification path exists):
`DENIED` · `HOLD` · `EXECUTION_NOT_ATTEMPTED` · `EXECUTION_FAILED` · `ACKNOWLEDGED` ·
`UNKNOWN` · `VERIFIED_SUCCESS` · `VERIFIED_NOOP` · `DEVIATION` · `RECOVERY_REQUIRED`.

### Evidence model
TransitionOutcome envelope (as reference) + the existing platform events
(started/completed/failed, `executor.ts:128/145/155`) + write-health counters +
the idempotency key as the correlation handle. Same Node-20 in-memory durability
limitation, explicitly carried.

### Recovery model (G8 — with the required clarification)
Recovery must distinguish **DEFINITE FAILURE** from **OUTCOME UNKNOWN**. They demand
different actions:

```
DEFINITE FAILURE  → retry may be governable (the send provably did not happen)
UNKNOWN           → DO NOT BLINDLY RETRY → RECONCILE → OBSERVE REMOTE STATE → VERIFY
```

**Frozen connector invariant:** after ambiguous external execution the state is
`UNKNOWN`, not `FAILED`. A retry is only governable if reconciliation establishes
**NOT SENT**. If reconciliation cannot establish the state, `UNKNOWN` **remains
`UNKNOWN`** — it is never upgraded to `VERIFIED` and never silently downgraded to
`FAILED` to justify a resend. Blindly retrying an `UNKNOWN` send risks a duplicate
irreversible effect and is prohibited.

- **No compensation** — an email cannot be unsent. Recovery for `send-mail` means
  *reconcile-to-truth*, not *rollback* (contrast the reference, where a bad import
  can be corrected).
- Persistent `UNKNOWN` past the reconcile window → `RECOVERY_REQUIRED` / `ESCALATE`
  (human), with the duplicate-send path **blocked** unless a governed reconciliation
  authorizes it.

### Failure taxonomy
`DENY` (unauthorized / not owner / missing scope) → no effect;
`HOLD` (unconfirmed C3) → no effect;
lost claim / already-sent → NOOP or HOLD;
`VERIFIED_FAILURE` (read-back proves not sent) ;
`DEVIATION` (sent, but observed state ≠ intended — e.g. wrong recipient count) ;
`UNKNOWN` (timeout, unresolved) ;
`ESCALATE` (unresolved past window).

---

## G6 — CST port mapping (what is actually reusable)

| Kernel port | Reuse verdict | Note |
|---|---|---|
| `TimeSource` / `SystemTime` | **Reused as-is** | constitutional |
| `PolicyStore` | **Reused (pattern)** | actor→scope map + C3-by-presence; connector-specific: send is always C3 |
| `ClaimStore` | **Reused (pattern)** | new subject `tenant/m365-send/<key>` — prevents concurrent dup sends |
| `IdempotencyStore` | **Reused, but key is provider-carried** | client `internetMessageId`, not a local row `externalKey` |
| `ResourceStore` (observe) | **Reused shape, REMOTE implementation** | pre/post-state via Sent-Items read-back, not a local store |
| `EvidenceStore` | **Reused as-is** | same in-memory Node-20 limit |
| `reconcile` (optional) | **Now ESSENTIAL** | reference used a trivial `() => ({known:false})`; send needs a real remote reconcile |
| `guards` (18) | **Reused as-is** | constitutional |

## The key Phase-G question, answered empirically

*Which properties are constitutional, which are CST-level, which are
transition-specific?*

- **Constitutional** (both transitions): identity, purpose/intent, governance,
  authorization, execution, observation, verification, evidence, recovery, and the
  `SEEN ≠ CLAIMED ≠ EXECUTED ≠ EFFECT_CONFIRMED ≠ VERIFIED ≠ EVIDENCED` distinction.
- **CST-contract level** (both): claim, revalidation, verdict, authorization,
  execution boundary, observation, verification, evidence envelope, `UNKNOWN ↛
  VERIFIED`, `ABSENCE ↛ PROOF`.
- **Data-Import-specific**: table risk, row actions, local `externalKey`, destination
  version, import plan, local `readBack`.
- **Connector/send-specific**: provider account identity, Graph scopes,
  client-message-id idempotency, **remote** read-back, 202-ack ≠ delivery,
  non-idempotent POST, no-unsend irreversibility, reconcile-by-remote-query.

**Finding (precise).** The Data Import reference contract **survives as a governing
semantic framework**, but the M365 transition demonstrates that its concrete
**observation, idempotency, reconciliation, and verification ports cannot be assumed
to have the same semantics across transition types.** For the reference these ports
were local and near-free; here `observation` is a remote read-back that may not
exist, `idempotency` is a client correlation key that does **not** by itself
guarantee remote duplicate suppression, and `reconcile` graduates from trivial
(`() => ({known:false})`) to essential. This proves NeuroPause has a **contractual
architecture, not a copy-paste implementation**: the reusable part is the
**contract**, while idempotency/observation/reconcile are **per-transition
implementations**, not shared code. It is a warning against premature abstraction.

---

## Proposed eventual implementation footprint (for a LATER phase — not now)

Minimum, mirroring the reference's one-adapter-one-call-site discipline:
- **New:** `apps/desktop/src/main/cst/sendTransition.ts` (adapter — the sole new
  module), + its negative-control test.
- **Modified (one call site):** `connectors/index.ts` `M365ActionExecute` handler
  routes through the adapter; `M365Executor.execute` preserved verbatim as the effect.
- **Requires a real design decision first:** the idempotency key + Sent-Items
  read-back (a genuinely new capability, not present today) — this is the part that
  needs its own acceptance before any code.
- No kernel change; no new vendored dependency; same frozen `@neuropause/cst`.

## Negative-control matrix (to be PROVEN in a later implementation phase, not now)

| # | Scenario | Expected |
|---|---|---|
| S-A | Authorized, confirmed, in-scope send | ALLOW → executed → read-back → VERIFIED_SUCCESS |
| S-B | Unconfirmed C3 send | HOLD → no effect |
| S-C | Unauthorized (not `ownsAccount`) | DENY → no effect |
| S-D | Missing Graph scope | DENY → no effect |
| S-E | Duplicate send, same idempotency key | second is VERIFIED_NOOP (no duplicate email) |
| S-F | 202 received, read-back confirms | VERIFIED_SUCCESS (not merely ack) |
| S-G | 202 received, read-back cannot confirm | ACKNOWLEDGED / UNKNOWN — never VERIFIED_SUCCESS |
| S-H | Network timeout after send | UNKNOWN → reconcile (never auto-FAILURE) |
| S-I | Reconcile finds message in Sent Items | UNKNOWN → VERIFIED_SUCCESS |
| S-J | Reconcile proves not sent | VERIFIED_FAILURE |
| S-K | Concurrent identical sends | one claim wins; the other NOOP/HOLD — no double send |
| S-L | Sent but recipients differ from intent | DEVIATION |
| S-M | **Stale authorization** at execution | HOLD — no external request |
| S-N | **Provider definite rejection** (4xx/5xx with a definite negative) | EXECUTION_FAILED |
| S-O | **Lost response after transmission** (remote effect happens, response discarded) | **UNKNOWN** — never EXECUTION_FAILED, never VERIFIED_SUCCESS |
| S-P | **Remote reconciliation unavailable** | UNKNOWN remains UNKNOWN |
| S-Q | **Duplicate-send risk on retry of an UNKNOWN** | retry blocked / RECOVERY_REQUIRED unless reconciliation authorizes |
| S-R | **Evidence-stage failure** | not fully EVIDENCED (kernel surfaces it; no fabricated success) |

**S-O is the decisive test.** It must simulate: *the remote effect occurs, then the
response is deliberately discarded.* The system must produce **`UNKNOWN`** — proving
it produces neither `EXECUTION_FAILED` nor `VERIFIED_SUCCESS` without further
evidence. This is the concrete proof of `UNKNOWN ↛ VERIFIED` and `ABSENCE ↛ PROOF`
for an irreversible external action.

## Explicit non-goals (Phase G and its eventual implementation)

- No generic `GovernedTransition<T>` / `UniversalActionRuntime` — the abstraction is
  derived only after ≥2 transitions are independently proven.
- No change to Data Import, the kernel, or any frozen semantics.
- No governing of the ExecuteEngine/assistant orchestrator (leaf only).
- No solving of Node-20 durability.
- No compensation/unsend machinery (declared impossible for this transition).
- No push; no broadening to other connector actions (calendar/Teams/drive) in this pass.

---

## Phase G close

| Gate | Result |
|---|---|
| G0 — Genuine difference | PASS |
| G1 — M365 send selected | PASS |
| G2 — Consequence defined | PASS |
| G3 — Control scope | PASS |
| G4 — Reference comparison | PASS |
| G5 — Semantic delta | PASS |
| G6 — CST port mapping | PASS |
| G7 — UNKNOWN model | PASS |
| G8 — Recovery model | PASS (with clarification: `UNKNOWN` never blindly retried) |
| G9 — Verification ceiling | ACCEPTED (`ACKNOWLEDGED ≠ VERIFIED`) |
| G10 — Implementation boundary | PASS (one adapter + one call site; kernel frozen) |
| G11 — Negative controls | PASS (with S-M…S-R additions; S-O decisive) |
| G12 — Non-goals | PASS |

## FINAL DESIGN DECISION — ACCEPTED (`ACKNOWLEDGED ≠ VERIFIED`)

The Phase G design is **ACCEPTED** with the frozen assurance clarification recorded
above (§ G-ASSURANCE). The resolution of the previously-open question:

- **`ACKNOWLEDGED` is acceptable as a terminal operational outcome for v1.** It is
  **not** acceptable as a synonym for `VERIFIED_SUCCESS`.
- **`VERIFIED_SUCCESS` is impossible unless a genuine authoritative remote
  observation path exists** (Profile B). Full "true VERIFIED send" is **not** to be
  implemented unless the provider/repository contract establishes such a mechanism.
- **`UNKNOWN` is a first-class terminal/intermediate state** after ambiguous external
  execution, and the implementation must **never retry `UNKNOWN` blindly.**
- **Idempotency is represented explicitly**, but NeuroPause does **not** claim
  provider-enforced duplicate suppression unless the provider contract establishes it.

**Next:** Phase H — the *minimal* implementation of exactly this design, with the CST
kernel still frozen — is to be **considered for authorization separately**. No code
is written under Phase G.
