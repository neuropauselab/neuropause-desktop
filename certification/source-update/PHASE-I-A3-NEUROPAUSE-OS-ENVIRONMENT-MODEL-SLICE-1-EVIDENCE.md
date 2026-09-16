# OS-track L2 · Environment Model / Graph — SLICE 1 (the OBSERVABLE OBJECT) · EVIDENCE

> Preamble (standing): The intelligence proposes. The governance decides. The execution layer acts. The independent
> verifier proves. The Action Record remembers.

**Status: OBSERVABLE OBJECT LANDED — TEST-VERIFIED, non-frozen, no FG gate.** The Environment Model's pure, purpose-bound
classifier is complete: for one purpose it resolves every required element into exactly four states — HAVE / NEED /
UNKNOWN / UNAVAILABLE — from injected evidence. FREEZE INTACT. This is **L2's FIRST slice** (counts for L6 entry).

## The observable object
`environmentModel/environmentModel.ts` — `composeEnvironmentModel(purpose, required, sources)` → an `EnvironmentModel`
(`{ purpose, elements, have, need, unknown, unavailable }`): a PURE, PURPOSE-BOUND read-model. For each element the purpose
declares as required, it reads one piece of injected evidence and classifies the element into one of the four states, with
the evidence basis recorded. It MODELS what the environment provides for one purpose; it does not collect (L3), recommend,
or build.

## The four states — the binding vocabulary, honored everywhere
| state | meaning | probe |
|---|---|---|
| **HAVE** | the environment affirmatively provides it | `present` |
| **NEED** | the purpose requires it and it is evidenced ABSENT (a real gap) | `absent` |
| **UNKNOWN** | not determined — no conclusive evidence; **never promoted to HAVE** | `unknown` |
| **UNAVAILABLE** | cannot be determined — the evidence source itself is absent (distinct from NEED) | `null` |

**UNKNOWN never silently becomes HAVE** is enforced structurally: only an affirmative `present` probe yields HAVE; an
inconclusive probe halts at UNKNOWN. An all-inconclusive environment yields **zero HAVE** (pinned). **UNAVAILABLE is
distinct from NEED**: "cannot probe" is never reported as a known gap (pinned).

## The five acceptance fields — each to a named test (`environmentModel.test.ts`, 9)
| field | how it's honored | test |
|---|---|---|
| **Observable object** | an `EnvironmentModel` (purpose + classified elements + four rollups) evidence can point at | `OBSERVABLE OBJECT` |
| **Collection boundary** | PURPOSE-BOUND: `probe` is called ONLY for the purpose's required elements — a call-spy asserts the probed set equals the required set exactly, never a full-environment scan | `COLLECTION BOUNDARY (purpose-bound)` |
| **Capability contract** | DISCOVER ≠ RECOMMEND ≠ BUILD: the model emits no recommendation and no built artifact (serialized model matches none of recommend/build/create/execute/grant) | `CAPABILITY CONTRACT` |
| **Verification** | each element's state is a FAITHFUL projection of its probe (HAVE⟺present · NEED⟺absent · UNKNOWN⟺unknown · UNAVAILABLE⟺null) | `VERIFICATION` |
| **Failure/UNKNOWN** | an empty purpose model is empty (never fabricates elements); UNKNOWN/UNAVAILABLE never collapse into HAVE/NEED | `FAILURE/UNKNOWN` + the four-states block |

## Constraints (L2, binding verbatim) — honored
Purpose-bound evidence only (the model maps ONLY over the purpose's `required` set — structurally incapable of scanning
the wider environment; proven by the probe call-spy) · the four states everywhere · UNKNOWN never silently becomes HAVE.

## Invariant (pinned)
**Zero-runtime-import** — `environmentModel.test.ts` reads the source and asserts the value-import set is EMPTY: evidence
enters ONLY through injected `sources`; there is no import path into collection, discovery, or execution, exactly as L4/L5
keep their one-way boundary.

## Non-frozen — no FG gate
New pure `main` module + test; no shared-type change, no IPC channel, no frozen touch. Proofs:
`environmentModel.test.ts` (9) + full main (**839 files, 8848 passed / 3 skipped**) + typecheck node + lint clean.

## Remaining (next increments, non-frozen)
Live-wire `sources.probe` to real evidence: a HAVE from a connected/governed connector (the L1 domain aggregate + the L4
graph's routable set), a NEED from a purpose's requirement unmet, UNAVAILABLE from local mode's honest absence. The NEED
set of this model is exactly the input L3 discovery consumes (the gaps to close under authority) — kept decoupled here
(injected), so neither layer imports the other's runtime.

## Live boundary (standing)
M365 `mail.send` is the SINGLE live governed consequential capability. This layer READS injected evidence and CLASSIFIES;
it collects nothing, executes nothing. A HAVE means evidence reported present — not that anything was acted upon.
