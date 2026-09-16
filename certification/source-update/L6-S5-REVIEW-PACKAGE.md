# L6-S5 · REVIEW PACKAGE (presented at the HARD STOP — no execution wiring exists)

> Preamble (standing): The intelligence proposes. The governance decides. The execution layer acts. The independent
> verifier proves. The Action Record remembers.

S4 is certified: **the Brain CAN PROPOSE; it CANNOT REACH EXECUTION.** S5 is where a certified proposal would be governed
and — on human consent — executed. This package is presented for operator review **before any execution wiring exists**.
Everything below is DESIGN. **S5 also contains its own hard stops** (any real external effect; an FG gate for a frozen
touch) that survive this review.

## The whole S5 claim in one line
A certified `Proposal` becomes an external effect **only** by entering the EXISTING, unchanged chain:
**proposal → GOVERNANCE (ALLOW/ASK/DENY) → HUMAN CONFIRM → CST (bound decision) → durable ADMISSION → certified EXECUTOR →
EXTERNAL EFFECT → INDEPENDENT READ-BACK → ACTION RECORD.** S5 builds the *governance* + the *projection onto the existing
producer* + the *wiring of the derivation sources* — it builds NO new executor and NO second path (§2#7).

## 1 · Governance — ALLOW / ASK / DENY (deny-by-default)
A certified proposal is evaluated by governance BEFORE any human sees it:
- **DENY** (fail-closed) — if the proposal is anything but `PROPOSED` (REFUSED/EXPIRED/BLOCKED never reach governance), if
  the capability is not `governed-certified`, if `tenantProvable` is false, or if any policy check fails. Deny-by-default.
- **ASK** — the DEFAULT for every consequential mutation (§2#7 one confirmation architecture): the proposal is surfaced to
  the human for explicit confirmation. `mail.send` is always ASK. `authorityRequired.requiresApproval` is already
  guaranteed true by S4 (a no-approval authority is BLOCKED), so ASK is the only path for a consequential action today.
- **ALLOW** (auto, no human) — reserved and **NOT enabled now**: only a future S28 compiled/hashed policy + S38 certified
  offline policy could ALLOW without ASK, and only for a policy-bounded, limited, kill-switched case (autonomy ≥L4 is a
  standing human gate). Until then, ALLOW is unreachable for a consequential effect.

## 2 · The certified-executor-only path (no new executor, no second path)
The proposal's `proposedAction {capabilityId, params}` **projects onto the EXISTING** `capability:m365.propose` producer
output (`{to, subject, body}`) and terminates in the ONE certified executor (`governedSend`). Every other proposal field
is non-executable annotation. Binding rules (from the S4.2 fleet's trust contracts):
- capability/account/principal/executor are **RE-RESOLVED** by the runtime at admission from trusted sources — the
  proposal's identity fields are untrusted hints (as `capabilityProposeCore` already does).
- the human-confirmed params are digested by the **Bound Decision Claim** (full params incl. every recipient) — a
  post-approval substitution is BINDING_MISMATCH, fail-closed.
- `confirmed` is set ONLY by the human on the existing panel, on the existing execute channel — never by the Brain.

## 3 · Wiring the derivation SOURCES (the S4.2/S4.3 contracts S5 must honor)
S4 proved these are injected; S5 MUST wire them to reality (never to reasoning):
- **`authorityFor`** ← RBAC (`RUNTIME_CHANNEL_PERMISSIONS`) + CST (`policyVersion`) via the L4 assurance — the governed
  substrate, never a model/reasoning output.
- **`oracleFor`** ← the oracle registry: `mail.send` → the S16 `verifyEffect` plan (single-recipient, send-corroboration,
  **not delivery**, §2#14); every other capability → `UNVERIFIABLE`, honest.
- **state hashes** ← a real hash of the composed `LiveBrainState` at reasoning vs at admission (invalidate on drift).
- **single-tenant precondition** ← one authoritative tenant context feeds all six L6 inputs (S4.0 `tenantScope`); a mixed
  tenant refuses the proposal before governance.

## 4 · Read-back wired for real (§2#14 universalized)
Today `s16VerifyRun` is E2E-gated (structurally absent from release); `ActionRecord.verification` stays null in production.
S5 wires the read-back into the governed path so every executed effect is **REQUEST → EXECUTION → EXTERNAL EFFECT →
INDEPENDENT READ-BACK → VERIFIED_SUCCESS / VERIFY_FAILED / UNKNOWN** (D-16 vocabulary, deny-by-default). Where no oracle
exists the effect is honestly UNVERIFIABLE — the proposal already says so.

## 5 · What lands in S5 (behind this gate), and the hard stops inside it
- **Build:** the governance evaluator (ALLOW/ASK/DENY), the proposal→`capability:m365.propose` projection, the derivation
  wiring (§3), the production read-back (§4). Mock-proven e2e first (no real effect).
- **⛔ Frozen touch:** surfacing a certified proposal to the renderer / a new execute affordance almost certainly touches
  frozen `packages/shared` (channels/contracts) → an **FG gate** presented before any such change (never worked around).
- **⛔ Any real external send:** human at the keyboard, allowlisted + single-send latched exactly like S15 — a separate
  standing gate.
- **⛔ Autonomy ≥L4 / ALLOW-without-ASK:** not in S5; a separate future gate.

## The decision at this gate
Approve (or amend) the S5 design: the ALLOW/ASK/DENY model (ASK-only for consequential today), the certified-executor-only
projection, the derivation-source wiring, and the production read-back. On approval, S5 builds the governed path
mock-first; **no real external effect and no frozen touch happen without their own gates.**
