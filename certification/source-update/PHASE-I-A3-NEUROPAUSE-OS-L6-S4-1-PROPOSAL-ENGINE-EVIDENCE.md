# OS-track L6 · S4.1 · THE PROPOSAL ENGINE + L5 BRIDGE · EVIDENCE

> Preamble (standing): The intelligence proposes. The governance decides. The execution layer acts. The independent
> verifier proves. The Action Record remembers.

**Status: S4.1 LANDED — TEST-VERIFIED, non-frozen.** The Brain can now form a certified proposal ARTIFACT — data-only,
deterministic, and structurally unable to reach execution. FREEZE INTACT. **S4.2 (the 9-attack integrity fleet) is next,
under a D-15 quiet window. S5 execution stop remains separate and behind S4.**

## The proposal artifact (`proposal.ts`) — exactly the reviewed field set
`buildProposal(request, deps)` → a `Proposal` with EXACTLY: `proposalId, tenantId, purpose, observation, diagnosis,
evidence[], policyFacts[], options[], selectedOption, proposedAction, target, scope, authorityRequired, risk,
reversibility, expectedEffect, verificationPlan, expiry` — or a `REFUSED` / `EXPIRED` / `BLOCKED` verdict. The proposal is
DATA: no callable, token, credential, oracle handle, or `confirmed`. It is consumed only by the existing
proposal→confirm→CST→admission→executor→verification→ActionRecord path (§2#7); S5 wires that, behind its own hard stop.

## DERIVATION RULES — built IN, so the attacks pass BY CONSTRUCTION
| rule | mechanism | attack it defeats |
|---|---|---|
| **(a) authorityRequired DERIVED** | `deps.authorityFor(capabilityId, target)` (RBAC/CST via L4). The `ProposalRequest` type has **no** `authorityRequired` field — a caller/reasoning/model literally cannot inject one. | 2 · authority injection |
| **(b) verificationPlan DERIVED** | `deps.oracleFor(capabilityId, params)` (oracle registry). Oracle → concrete plan; **none → `{ verifiable:false, needs:… }` UNVERIFIABLE** — never free-text, never a false VERIFIED (§2#14). | 8 · missing oracle |
| **(c) evidence RESOLVES** | every `evidence[]` ref must `deps.resolveEvidence(...)` to a real record; else BLOCKED. | 3 · evidence injection |
| **(d) EXPIRY** | evidence older than `freshnessWindowMs`, OR `stateHashAtReasoning !== currentStateHash` → **EXPIRED → HOLD** (never governance-eligible). | 4 · stale · 5 · state changed |
| **(e) TENANT** | forms ONLY from a `tenantProvable` state + matching target tenant + matching scope; else REFUSED (S4.0 wired end to end). | 1 · cross-tenant · 9 · scope escalation |
| **conflict** | any `state.conflicts` → BLOCKED. | 7 · conflicting evidence |
| **inert data** | narrative/params copied verbatim as DATA; the producer never interprets them; derived fields are untouched by a hostile `observation`/`params`. | 6 · prompt/model manipulation |

All nine are pinned in `proposal.test.ts` (17) — they pass **by construction** here; **S4.2's independent fleet
adversarially re-verifies each, failing-test-first.**

## Determinism + zero-authority
- **Deterministic (D-14)**: pure over `(request, deps)`; `nowMs` + the state hashes are INJECTED, never read; the
  `proposalId` is a deterministic composite (same identity → same id, idempotent). Pinned.
- **Zero-runtime-import**: `proposal.ts` imports TYPES ONLY — no value import at all (the strictest pin). The Brain
  proposes; it never reaches (§2#13). Pinned.

## The L5 operational bridge (`purposeBridge.ts`) — built WITH S4
`bridgePurpose(deps)` → a `PurposeBridge` (`purposeId, purposeState, consentState, scope, tenantId, evidence,
capabilities, constraints`). **NOTHING is inferred merely because an action is technically possible:** the bridge maps
ONLY the capability the PURPOSE resolved to (L5's own proposal at CONSENT_READY) AND only if it is a real governed route
in the L4 graph. A not-consent-ready purpose, or a resolved capability that is not a governed route, yields NO capability
→ NOT_READY. Deterministic, data-only, zero-runtime-import. `purposeBridge.test.ts` (4).

## The five acceptance fields
| field | how honored |
|---|---|
| **Observable object** | the `Proposal` artifact + `PurposeBridge` |
| **Collection boundary** | every field traces to an injected evidence object or policy fact; authority/verification are DERIVED, never authored |
| **Capability contract** | PROPOSE-only, DATA-only; no callable/token/confirmed; zero-runtime-import (strictest pin); consumed only by the one governed path |
| **Verification** | `verificationPlan` is honest — UNVERIFIABLE when no oracle; determinism pinned |
| **Failure/UNKNOWN** | REFUSED (tenant/scope) · EXPIRED→HOLD (stale/changed) · BLOCKED (unresolved evidence / conflict) — deny-by-default |

## Non-frozen — no FG gate
New pure `main` modules + tests; type-only imports; no shared-type change, no IPC channel, no frozen touch. Proofs:
`proposal.test.ts` (17) + `purposeBridge.test.ts` (4) + full main (**849 files, 8925 passed / 3 skipped**) + typecheck
node + lint clean.

## Next
**S4.2 · the integrity fleet** — the nine-attack adversarial union set, run UNINTERRUPTED under a **D-15 quiet window**
(requested when ready), each finding fixed failing-test-first. Then **S4.3 certification** (ten proofs; certifies S4 CAN
PROPOSE, CANNOT REACH EXECUTION) → HOLD. **S5 remains its own hard stop.**

## Live boundary (standing)
M365 `mail.send` is the SINGLE live governed consequential capability. S4.1 forms a proposal ARTIFACT — it proposes
nothing to a human yet, executes nothing; a proposal is data awaiting the governed path S5 will wire.
