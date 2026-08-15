# Phase H — M365 `send-mail` governed transition: Authorization Record + Plan (Profile A)

**Status: ACCEPTED — implementation authorized (Profile A). Authorization record
committed first; implementation stops at the next acceptance gate (NOT auto-committed).**

**Governing rule for the whole phase:** *record the strongest claim the evidence
supports — never a stronger claim.* **Most important invariant:** *an M365 `202
Accepted` establishes acknowledgement of the request at the provider boundary; it
does not establish a verified business outcome.*

Implements exactly the accepted Phase G design (`ce3ed6f`), **Profile A
(acknowledgement-only)**, with the CST kernel still frozen. This document is the
**authorization record** that freezes the Phase H boundary so it cannot drift during
implementation. Nothing here is implemented; nothing is committed until accepted.

---

## H0–H12 — Frozen authorization record

| ID | Frozen boundary |
|---|---|
| **H0** | Implementation target: the M365 `send-mail` governed transition, one adapter + one call site. |
| **H1** | **Profile A selected** (acknowledgement-only). Profile B (remote read-back → true VERIFIED) is **deferred**. |
| **H2** | **`ACKNOWLEDGED ≠ VERIFIED_SUCCESS`.** A 202 is a terminal *operational* outcome, never verified. |
| **H3** | **`UNKNOWN ≠ FAILURE`.** A lost response after transmission is `UNKNOWN`, not `EXECUTION_FAILED`. |
| **H4** | **`UNKNOWN` cannot trigger blind retry.** Retry only after governed reconciliation establishes *not sent*. |
| **H5** | **CST kernel remains frozen** (`@neuropause/cst` `293d0560…`; no kernel edit, no new vendored dep). |
| **H6** | **No universal abstraction** — no `GovernedTransition<T>`, no framework extraction (F8). |
| **H7** | **No durability work** — same Node-20 in-memory kernel-store limit, declared. |
| **H8** | **One connector transition only** — `send-mail`; no calendar/Teams/drive/other connectors. |
| **H9** | **External effect boundary identified** — `M365Executor.execute` (`connectors/m365/executor.ts:78`) → `send()` (`connectors/m365/mail.ts:49`) → Graph `/me/sendMail`; preserved **verbatim** as the kernel effect. |
| **H10** | **Negative controls required** (adapter + integration layer; the lost-response test is the flagship). |
| **H11** | **Application-level evidence required** — scoped honestly to what is reachable offline (see Evidence Plan). |
| **H12** | **Commit only after acceptance.** |

---

## Scope

### Included
- One new adapter: `apps/desktop/src/main/cst/sendTransition.ts` (the sole new module) + its negative-control test.
- One modified call site: the `M365ActionExecute` handler (`connectors/index.ts:395`) routes through the adapter.
- The existing `M365Executor.execute` effect preserved verbatim (H9).
- Transition identity, governance (C3-by-presence), authorization, claim, pre-execution idempotency check, execution, **acknowledgement/UNKNOWN classification**, evidence, governed recovery.
- Negative controls + application-level evidence (scoped, below).

### Explicitly excluded
Modifying the CST kernel · universal/transition abstraction · framework extraction ·
M365 architecture rewrite · provider SDK replacement · durable kernel-store work ·
generalized connector governance · **automatic retry of `UNKNOWN`** · **claiming
`VERIFIED_SUCCESS` without proof** · broad AI-agent governance · unrelated connector
changes · Profile B remote read-back.

---

## Adapter design (`sendTransition.ts`) — Profile A

Mirrors `importTransition.ts`: builds `CstKernel` deps, classifies consequence,
runs `kernel.run(request, effect)`, maps the envelope to a domain outcome.

- **Consequence:** `send-mail` `mutates` ⇒ **C3 by presence** (never a low-risk send).
- **`expectedPostState`:** non-vacuous `{ sendResolved: true }`. **Profile A cannot
  reach it** (no authoritative read-back), so the honest terminal for a 202 is
  `ACKNOWLEDGED`, not `VERIFIED_SUCCESS`.
- **Approval:** the existing `confirmed === true` gate is the C3 approval; unconfirmed ⇒ HOLD.
- **Claim subject:** `tenantId / m365-send / <idempotencyKey>` — prevents concurrent duplicate sends.
- **Idempotency key:** deterministic from the request (recipients+subject+body+account). Represented
  explicitly, but **no claim of provider-enforced duplicate suppression** (H1/Profile A).
- **Effect:** wraps `M365Executor.execute` unchanged; runs only on ALLOW + won claim + pre-state check.
- **Outcome mapping (Profile A):**

| Kernel / effect signal | Domain outcome |
|---|---|
| unauthorized (`ownsAccount` false) | `DENIED` — no external request |
| missing Graph scope | `DENIED` — no external request |
| C3 unconfirmed | `HOLD` — no external request |
| lost/contended claim, or key already sent | `VERIFIED_NOOP` / `HOLD` — no second effect |
| effect not attempted (kernel refused) | `EXECUTION_NOT_ATTEMPTED` |
| provider **definite** rejection (4xx/5xx negative) | `EXECUTION_FAILED` |
| provider **202** received | **`ACKNOWLEDGED`** (never `VERIFIED_SUCCESS`) |
| transmission then lost response / timeout | **`UNKNOWN`** (never `EXECUTION_FAILED`) |
| sent but observed intent mismatch | `DEVIATION` |
| persistent `UNKNOWN` past window | `RECOVERY_REQUIRED` / `ESCALATE` (retry blocked) |

`VERIFIED_SUCCESS` is **structurally unavailable** in Profile A (no observation port
returns it) — enforced in code, not merely by convention. **There must be no code
path from any Profile-A state (`ACKNOWLEDGED`, `UNKNOWN`, `EXECUTION_FAILED`,
`DENIED`, `HOLD`) to `VERIFIED_SUCCESS`.** Do **not** create a fake `SentMailStore`
whose simulated state is then used to claim `VERIFIED_SUCCESS` — that would quietly
turn Profile A into Profile B without proving a real remote observation contract.
Profile B, if ever built, gets its own design + acceptance gate.

---

## Test & evidence plan (honest, given no live M365 account)

**Negative controls** (`sendTransition.negative.test.ts`) — adapter + integration
layer, using the executor seams (`makeHttp?`, `getToken`, `ownsAccount`,
`grantedScopes`) to inject a fake transport. **No live account, no real email.**

| # | Scenario | Expected | Reachable offline? |
|---|---|---|---|
| H-A | Authorized, confirmed, in-scope send | `ACKNOWLEDGED` (not VERIFIED) | inject 202 |
| H-B | Unconfirmed C3 | `HOLD`, zero external attempts | yes |
| H-C | Unauthorized (`ownsAccount` false) | `DENIED`, zero attempts | yes |
| H-D | Missing scope | `DENIED`, zero attempts | yes |
| H-E | Stale authorization at execution | `HOLD` | yes |
| H-F | Duplicate request before execution | suppressed (claim/idempotency) — one attempt | yes |
| H-G | Provider definite rejection | `EXECUTION_FAILED` | inject 4xx |
| H-H | Provider 202 | `ACKNOWLEDGED`, never `VERIFIED` | inject 202 |
| H-I | 202, no read-back capability | never `VERIFIED_SUCCESS` | Profile A structural |
| **H-J** | **Lost response after remote effect (flagship)** | **`UNKNOWN`** — not FAILURE, not VERIFIED | inject: effect ran, then throw timeout |
| H-K | `UNKNOWN` | **no automatic retry** | assert no second effect call |
| H-L | Reconciliation unavailable | `UNKNOWN` remains `UNKNOWN` | yes |
| H-M | Evidence-stage failure | not fully EVIDENCED (kernel surfaces it) | inject failing evidence |
| H-N | Replay of an `UNKNOWN` | duplicate blocked / `RECOVERY_REQUIRED` | assert governed |

**H-J is the flagship** (the Phase-D MIXED-A equivalent): the injected transport
performs the "effect" then discards the response (throws a timeout). H-J must assert
**all three** — not merely the epistemic outcome:

```
effectCalls === 1      (the external effect was attempted exactly once)
outcome    === UNKNOWN  (not FAILURE, not VERIFIED_SUCCESS)
retry      === false    (UNKNOWN did NOT authorize a second external effect)
```

The consequence-control assertion (`effectCalls===1`, `retry===false`) is as
important as the epistemic one: otherwise the adapter could return `UNKNOWN` while
having already fired a duplicate send — satisfying the epistemic rule but failing the
consequence rule (a duplicate email). H-J proves both.

**Application-level evidence** (launched app, real renderer→preload→IPC→adapter→CST):
- **Reachable offline (will be driven through the real app):** the **governance
  refusal path** — an unconfirmed or unauthorized `connectors:m365.execute` is
  **HELD/DENIED before any Graph call**, proving the CST boundary is on the real IPC
  path and refuses prior to the external effect. (No account required — refusal
  precedes the effect.)
- **Declared boundary (NOT driven through the live app):** `ACKNOWLEDGED` / `UNKNOWN`
  end-to-end require a live Graph send, which needs a connected M365 account and would
  emit a **real external email**. NeuroPause will **not** send real external mail to
  manufacture evidence. These outcomes are proven at the adapter/integration layer via
  the injected transport (H-A/H-G/H-H/H-J…). This offline boundary is declared exactly
  as Phase E declared the Node-20 durability limit — assurance is not weakened to force
  a green app-level send.

---

## Phase H acceptance matrix (to pass before Phase H closes)

| Control | Expected |
|---|---|
| Unauthorized send | DENY/HOLD, zero external attempts |
| Missing approval (unconfirmed) | HOLD |
| Invalid scope | DENY |
| Stale authorization | HOLD |
| Duplicate request before execution | suppressed |
| Provider definite rejection | EXECUTION_FAILED |
| Provider 202 | ACKNOWLEDGED |
| 202 → no read-back capability | never VERIFIED |
| Lost response after remote effect | UNKNOWN |
| UNKNOWN | no automatic retry |
| Reconciliation unavailable | UNKNOWN |
| Evidence failure | not fully evidenced |
| Successful authorized send | ACKNOWLEDGED, not VERIFIED |
| Recovery from UNKNOWN | governed (retry blocked unless reconciled) |
| Replay | no uncontrolled duplicate |
| Governance refusal via real app IPC path | HELD/DENIED before any Graph call |
| Regression (full suites) | green; typecheck clean |
| Frozen kernel + baseline | byte-identical, unmodified |

---

## Phase H closes with THREE separate conclusions (not a single "PASS")

| Conclusion | Meaning |
|---|---|
| **H-CONTRACT** | The M365 send transition correctly implements the accepted governed-transition semantics (governance, claim, execution-once, ACKNOWLEDGED/UNKNOWN classification, no-blind-retry, evidence). Proven by the negative controls. |
| **H-APP** (scoped) | The real launched Desktop proves the **governance/refusal path** through the actual renderer→IPC→CST boundary (HELD/DENIED before any Graph call). |
| **H-EXTERNAL** (NOT ESTABLISHED) | **No live Microsoft 365 send was performed.** No claim is made that a real external email was transmitted or remotely verified. This is an honest assurance boundary, not a weakness. |

## Non-goals (restated)
No kernel change · no abstraction · no durability work · no Profile B · no real
external email · no other connector actions · no push. Data Import (`fcb3a31`) and the
reference (`713db12`) are untouched.

## Decision gate
> **REQUESTED:** `ACCEPTED — proceed to implement Profile A per this plan` ·
> `REVISE` (adjust scope / evidence plan / outcome model). Also confirm the
> **app-level evidence approach** (governance-path through the real app + injected-transport
> effect-boundary; **no real email**) is acceptable, or specify if you want a live
> M365 account connected for a full end-to-end send (a separate, credentialed,
> real-external-effect decision I will not take unilaterally).

No code will be written until this plan is `ACCEPTED`.
