# OS-track L6 · S5.1 · EXECUTION BOUNDARY (mock-proven) · EVIDENCE

> Preamble (standing): The intelligence proposes. The governance decides. The execution layer acts. The independent
> verifier proves. The Action Record remembers.

**Status: S5.1 LANDED — TEST-VERIFIED, non-frozen, MOCK-ONLY.** The certified-executor-only projection with
execution-time re-derivation. FREEZE INTACT. **ZERO real contact.** **⛔ The S5.4 real-send is a separate ceremony
(fresh registration + consent + allowlist/latch + runbook + explicit operator go); nothing here builds toward it.**

## The observable object
`liveBrain/proposalExecutionBoundary.ts` — `admitForExecution(proposal, deps)` → `ADMIT_FOR_ASK` (a DATA projection onto
the existing `capability:m365.propose` producer input) or `REFUSED`. It is the gate between a certified proposal and the
EXISTING governed chain; it builds no executor and imports no executor/CST/governedSend value.

## ASK-ONLY IS STRUCTURAL (the S13 pattern)
For a consequential action there is **NO ALLOW branch in the code** — the only disposition is `'ASK'` (a human MUST
confirm). ALLOW is not configured off; it is **ABSENT**. It becomes reachable only through a future S28 compiled policy +
S38 conditions, each behind its own gate. Pinned: the source contains no `'ALLOW'` disposition/branch.

## EXECUTION-TIME RE-DERIVATION (the proposal's own words are never re-trusted)
At confirm time, everything is re-derived/re-checked from the REAL substrate and compared to the proposal's claims; ANY
mismatch → REFUSED (each pinned):
| re-check | REFUSED when |
|---|---|
| certified-executor-only | the capability is not a certified consequential capability |
| tenant | the current tenant ≠ the proposal's tenant (drift) |
| expiry | `nowMs > proposal.expiry.expiresAtMs` (expired at confirm) |
| state | `stateHashAtProposal ≠ currentStateHash` (state drifted) |
| authority | re-derived `authorityFor` ≠ the proposal's `authorityRequired`, or re-derived authority does not require approval |
| verification | re-derived `oracleFor` ≠ the proposal's `verificationPlan` |
Only when ALL pass does it `ADMIT_FOR_ASK`, projecting `{capabilityId, params, target, disposition:'ASK'}` — the
executable core onto the EXISTING producer input.

## Single-path (§2#7)
Pinned: the module imports TYPES ONLY (empty value-import set → no runtime edge to ANY module, executors included); no
dynamic `import()`/`require()`. A certified proposal can reach execution ONLY by this projection into the existing
proposal → confirm → CST → admission → governedSend chain — no new executor, no second path.

## The five acceptance fields
| field | how honored |
|---|---|
| **Observable object** | `AdmissionOutcome` (ADMIT_FOR_ASK / REFUSED) + the `ExecuteProjection` |
| **Collection boundary** | re-derives ONLY from injected substrate deps; the proposal's claims are compared, never trusted |
| **Capability contract** | ASK-only (no ALLOW branch); projects DATA; zero-runtime-import (single-path) |
| **Verification** | every re-derivation mismatch → REFUSED (7 pins); ADMIT only on full agreement |
| **Failure/UNKNOWN** | non-certified / tenant / expiry / state / authority / verification drift → REFUSED, deny-by-default |

## Non-frozen — no FG gate (yet)
New pure `main` module + test; type-only import of `Proposal`; no shared-type change, no IPC channel, no frozen touch,
NO executor wiring. Proofs: `proposalExecutionBoundary.test.ts` (10) + full main (**850 files, 8942 passed / 3 skipped**)
+ typecheck node + lint clean. Production wires `deps` to the REAL RBAC/CST · oracle registry · state hash (the S5 wiring
contract) and the projection into the existing chain — mock-first, behind S5.3 + the standing gates.

## Next (report-and-continue)
**S5.2 · the ASK surface** — the confirm panel rendering the proposal's review fields VERBATIM (truthful-surface), expiry
enforced at confirm time. This touches the RENDERER/confirm panel; if it touches a frozen surface (`packages/shared`
channels/contracts) it will **STOP and present an FG gate** (never worked around). Then **S5.3** the full mock e2e loop.
**⛔ HARD STOP after S5.3; S5.4 real-send is its own ceremony.**
