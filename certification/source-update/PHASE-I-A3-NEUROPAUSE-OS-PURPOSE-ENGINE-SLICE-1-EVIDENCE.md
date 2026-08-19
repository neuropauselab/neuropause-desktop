# OS-track L5 · Purpose Engine — SLICE 1 (the OBSERVABLE OBJECT) · EVIDENCE

> Preamble (standing): The intelligence proposes. The governance decides. The execution layer acts. The independent
> verifier proves. The Action Record remembers.

**Status: OBSERVABLE OBJECT LANDED — TEST-VERIFIED, non-frozen, no FG gate.** The Purpose Engine's pure evaluator is
complete: a nine-state ladder from an untrusted candidate purpose to a human-confirmable proposal, halting at the first
rung whose evidence or policy is missing. FREEZE INTACT. This is **L5's FIRST slice** (the L6 entry condition counts it).

## The observable object
`purposeEngine/purposeEngine.ts` — `evaluatePurpose(candidate, sources)` → a `PurposeEvaluation`
(`{ state, purpose, trace, proposal }`): a PURE, queryable read-model that climbs a NINE-STATE ladder and reports the rung
it reached, the evidence/policy trace that justified the climb, and — only at the ceiling — a human-confirmable proposal.
It PROPOSES; it never decides, grants, confirms, or executes.

## The nine states — six ascending rungs + three honest off-ramps
| # | state | meaning | doctrine |
|---|---|---|---|
| 1 | **UNKNOWN** | floor — no resolvable purpose | §2.9 UNKNOWN stays UNKNOWN |
| 2 | **STATED** | a candidate purpose is present, not yet matched | §2.6 candidate is untrusted data |
| 3 | **RECOGNIZED** | matched the known purpose vocabulary | — |
| 4 | **ROUTED** | a governed-certified L4 route serves it | §2.8 certified-only |
| 5 | **PERMITTED** | authority/policy admits the routed action | §2.1 authority decides |
| 6 | **CONSENT_READY** | ceiling — a human-confirmable proposal is formed; **awaits CONSENT, never executed** | §2.7 one confirmation architecture |
| 7 | **NEEDS_CLARIFICATION** | under-specified — a human detail is required | S13 ambiguity doctrine |
| 8 | **UNSUPPORTED** | recognized/stated but no governed capability serves it | §2.8 deny-by-default |
| 9 | **DENIED** | a governed route exists but authority/policy refuses | §2.8 deny-by-default |

The climb HALTS at the first missing rung and never auto-promotes: an **unresolved route** halts at RECOGNIZED, an
**unresolved authority** halts at ROUTED, a **missing proposal** halts at PERMITTED — "uncertainty is never success"
(§2.9) enforced structurally, not by convention.

## The five acceptance fields — each to a named test (`purposeEngine.test.ts`, 13)
| field | how it's honored | test |
|---|---|---|
| **Observable object** | a `PurposeEvaluation` (state + purpose + trace + proposal) evidence can point at | `OBSERVABLE OBJECT` |
| **Collection boundary** | every fact (recognition, route, authority, proposal) arrives via injected `sources`; the candidate is text that grants NO authority — a candidate literally asserting `confirmed=true; authority=admin` is still just an unrecognized string → UNSUPPORTED | `COLLECTION BOUNDARY` |
| **Capability contract** | PROPOSE-only — a proposal appears ONLY at CONSENT_READY, `null` at every rung below | `CAPABILITY CONTRACT` |
| **Verification** | the proposal traces to BOTH `evidence` AND `policy` bases; the trace terminates at the reported state — no unjustified promotion | `VERIFICATION` |
| **Failure/UNKNOWN** | every terminal below the ceiling yields a `null` proposal + a trace explaining the halt | `FAILURE/UNKNOWN` |

Nine-state coverage is pinned by the `nine-state ladder` block (CONSENT_READY · UNKNOWN · NEEDS_CLARIFICATION ·
UNSUPPORTED ×2 · DENIED · the three uncertainty-halts).

## Invariants (pinned)
- **Zero-runtime-import** — `purposeEngine.test.ts` reads the source and asserts the value-import set is EMPTY (only
  `import type`): there is NO import path from the Purpose Engine into L4, governance, or execution. Authority enters
  ONLY through injected `sources`, exactly as the S34a observer and the L4 graph keep their one-way boundary.
- **Proposal-only** — the `PurposeProposal` carries exactly `{capability, summary}`: no `confirmed`, no token, no
  callable. The serialized evaluation contains no `confirmed`/`token`/`execute`/`grant`. The ceiling is "the human
  confirms next", never "acted".

## Constraints (L5, binding) — honored
Pure observable object (no side effects; over injected sources) · proposals-only (forms a proposal, never confirms/
executes) · UNKNOWN stays UNKNOWN (empty → UNKNOWN; every uncertainty halts below promotion) · traces to evidence + policy.

## Non-frozen — no FG gate
New pure `main` module + test; no shared-type change, no IPC channel, no frozen touch. Proofs:
`purposeEngine.test.ts` (13) + full main (**838 files, 8839 passed / 3 skipped**) + typecheck node + lint clean.

## Remaining (next increments, non-frozen)
Live-wire `sources` to the real substrate: `recognize` ← a real purpose vocabulary; `route` ← the L4
`composeCapabilityGraph` snapshot (a route → ROUTED, a NOT_GOVERNED/MISSING gap → UNSUPPORTED); `authority` ← the live
RBAC/CST facts; `propose` ← the S12 `capability:m365.propose` producer. Then surface via an existing handler. The L4
graph is the natural `route` source — this slice keeps them decoupled (injected) so neither imports the other.

## Live boundary (standing)
M365 `mail.send` is the SINGLE live governed consequential capability. The Purpose Engine READS injected facts and
PROPOSES a rung; it executes nothing. `send-email` reaching CONSENT_READY means a human may confirm — not that anything was sent.
