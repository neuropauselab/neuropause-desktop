# OS-track L3 · Environment Discovery — SLICE 1 (the OBSERVABLE OBJECT) · EVIDENCE

> Preamble (standing): The intelligence proposes. The governance decides. The execution layer acts. The independent
> verifier proves. The Action Record remembers.

**Status: OBSERVABLE OBJECT LANDED — TEST-VERIFIED, non-frozen, no FG gate.** The Environment Discovery pipeline is
complete: for a purpose-bound request it walks PURPOSE → REQUEST → MINIMUM REQUIRED DATA → USER/POLICY AUTHORITY →
COLLECTION → CLASSIFICATION → EVIDENCE per element, collecting ONLY under explicit authority. FREEZE INTACT. This is
**L3's FIRST slice** (counts for L6 entry).

## The observable object
`environmentDiscovery/environmentDiscovery.ts` — `runDiscovery(request, sources)` → a `DiscoveryRun`
(`{ purpose, results }`) where each `DiscoveryResult` carries `{ element, outcome, state, evidence[] }`. It DISCOVERS
(collects under authority, classifies, evidences); it NEVER recommends, builds, or scans silently. Paired helper
`discoveryRequestFor(model)` derives the request's MINIMUM REQUIRED DATA from an L2 `EnvironmentModel`.

## The pipeline (the binding sequence, per element)
`PURPOSE → DISCOVERY REQUEST → MINIMUM REQUIRED DATA → USER/POLICY AUTHORITY → COLLECTION → CLASSIFICATION → EVIDENCE`
Each stage is recorded in the result's `evidence[]` trace. Outcomes:
| authority | collector | outcome | state |
|---|---|---|---|
| granted | datum present | `COLLECTED` | **HAVE** |
| granted | datum absent | `COLLECTED` | **NEED** |
| granted | null (failed) | `COLLECTION_FAILED` | **UNAVAILABLE** |
| denied | *not invoked* | `DENIED` | **UNKNOWN** |
| unknown | *not invoked* | `AUTHORITY_UNKNOWN` | **UNKNOWN** |

State feeds back into L2's four states — a denied/unresolved element stays **UNKNOWN** (never fabricated as HAVE/NEED).

## NEVER A SILENT DEVICE SCAN — the load-bearing invariant (pinned by a call-spy)
`collect` is reachable ONLY on the `granted` branch. The test spies both `authorize` and `collect`: authority is checked
for ALL requested elements, but `collect` is invoked for ONLY the granted one — the denied and authority-unknown elements
are **never** passed to the collector. Deny-by-default: no authority → no collection. This is the structural guarantee
that discovery cannot scan the environment behind the user's back.

## MINIMUM REQUIRED DATA — proven against a REAL L2 model
`discoveryRequestFor(model)` requests ONLY the L2 model's unmet gaps (**NEED + UNKNOWN**) — it excludes **HAVE** (already
satisfied, never re-collected) and **UNAVAILABLE** (out of discovery's reach). Proven by composing a real
`EnvironmentModel` with one element per state and asserting the request contains exactly the NEED + UNKNOWN ids. This is
the honest L2→L3 seam: discovery acts on the gaps the model found, nothing wider.

## The five acceptance fields — each to a named test (`environmentDiscovery.test.ts`, 10)
| field | how it's honored | test |
|---|---|---|
| **Observable object** | a `DiscoveryRun` (purpose + per-element results) | `OBSERVABLE OBJECT` |
| **Collection boundary** | never a silent scan (`collect` only when granted; a denied element's trace records NO COLLECTION) + minimum-required (gaps only) | `NEVER A SILENT SCAN` ×2 · `COLLECTION BOUNDARY` · `MINIMUM REQUIRED DATA` |
| **Capability contract** | DISCOVER ≠ RECOMMEND ≠ BUILD — the run emits no recommendation/built artifact | `CAPABILITY CONTRACT` |
| **Verification** | every result traces the FULL pipeline PURPOSE→REQUEST→AUTHORITY→[COLLECTION→CLASSIFICATION→EVIDENCE] | `VERIFICATION` |
| **Failure/UNKNOWN** | denied/unresolved authority stay UNKNOWN + no collection; collection failed → UNAVAILABLE; empty request → empty run | `deny-by-default outcomes stay UNKNOWN` · `pipeline outcomes` · `FAILURE/UNKNOWN` |

## Constraints (L3, binding verbatim) — honored
The full purpose-bound sequence (PURPOSE → … → EVIDENCE) · never a silent device scan (collect gated on granted
authority; call-spy) · discovery cannot recommend or build (no recommendation/artifact output).

## Invariant (pinned)
**Zero-runtime-import** — `environmentDiscovery.test.ts` reads the source and asserts the value-import set is EMPTY: the
module imports only the L2 element/model TYPES (read-only). No value import — no path into a collection back-end,
governance, or execution; authority and collection enter ONLY through injected `sources`.

## Non-frozen — no FG gate
New pure `main` module + test; a TYPE-only coupling to L2 (reading a type is not a runtime touch, D-6/D-7/D-13); no
shared-type change, no IPC channel, no frozen touch. Proofs: `environmentDiscovery.test.ts` (10) + full main (**840
files, 8858 passed / 3 skipped**) + typecheck node + lint clean.

## Remaining (next increments, non-frozen)
Live-wire `sources.authorize` to real USER/POLICY authority (the consent surface + RBAC/CST facts) and `sources.collect`
to real, minimum-scoped collectors (a connector capability probe, the local store) — each behind explicit per-element
authority, never a scan. Feed `discoveryRequestFor` from a live L2 model. The classified results flow back to L2 (an
UNKNOWN resolved to HAVE/NEED) and up to L5 (a NEED becomes a purpose gap to source/build) — decoupled here (injected),
so no layer imports another's runtime.

## Live boundary (standing)
M365 `mail.send` is the SINGLE live governed consequential capability. This layer collects ONLY what a user/policy
authorizes and classifies it; it recommends nothing, builds nothing, executes nothing. A HAVE means an authorized
collection found the element present — not that anything was acted upon.
