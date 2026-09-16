# OS-track L6 · Live Brain — SLICE 3 · REASONING · EVIDENCE

> Preamble (standing): The intelligence proposes. The governance decides. The execution layer acts. The independent
> verifier proves. The Action Record remembers.

**Status: REASONING LANDED — TEST-VERIFIED, non-frozen.** S3 continues report-and-continue on S1/S2's clean landing. The
Brain now REASONS over its own faithful state + provenanced context — and stops exactly at the boundary before proposing.
FREEZE INTACT. **⛔ NEXT IS THE L6-S4 HARD STOP** — no proposal code exists or will, until the S4 review package is
approved.

## The observable object
`liveBrain/brainReasoning.ts` — `reason(state, context, previous?)` → a `BrainReasoning` answering, from the S1
`LiveBrainState` + the S2 `BrainContext`: **what is happening · why · what changed · what is missing · known · unknown ·
could · should-not**. Every answer is a `ReasonedStatement` that CITES the fact fields / sections / sources it derives
from — reasoning traces to evidence exactly as the state and the observer do.

## THE BOUNDARY BEFORE S4 (the control point this slice protects)
S3 REASONS; it does NOT PROPOSE. It emits analysis only — **no** OBSERVATION→…→VERIFICATION-PLAN proposal object, **no**
REQUIRED AUTHORITY, **no** executable action target. The `could` answers merely POINT at where a proposal would be formed
at S4 ("… COULD be proposed at S4 (analysis only, not a proposal)"), carry no authority, and are gated to routable,
**non-conflicted** capabilities. Pinned by the NO-PROPOSAL invariant test: the reasoning object is exactly the eight
analytical answers — no `proposedAction`/`requiredAuthority`/`execute`/`grant` field anywhere.

## The five acceptance fields — each to a named test (`brainReasoning.test.ts`, 8)
| field | how it's honored | test |
|---|---|---|
| **Observable object** | a `BrainReasoning` (eight answers) over the REAL S1 state + S2 context | all 8 |
| **Collection boundary** | reasons ONLY from injected state + context (+ optional prior); cites only real facts/sections; invents no evidence | `known/missing cite REAL context fact fields` |
| **Capability contract** | REASON-only — analysis, never a proposal; zero execution/grant authority (imports only TYPES) | `NO-PROPOSAL INVARIANT` · `ZERO-RUNTIME-IMPORT` |
| **Verification** | every statement cites ≥1 non-empty reference; `known`/`missing` cite real S2 fact fields — reasoning traces to provenance | `traced to evidence` · `known/missing cite REAL … fields` |
| **Failure/UNKNOWN** | "what changed" is UNKNOWN without a prior context (`determinable:false`, never "assumed stable"); `should-not` enforces not-governed prohibition, unreconciled conflicts, and "UNKNOWN is never probably-fine" | `what changed is UNKNOWN without a prior` · `should-not …` |

## Answers, grounded (deterministic)
- **known/unknown** — atomic facts by certainty, each cited to its field.
- **what is missing** — gaps / NEEDs / UNAVAILABLE, cited.
- **what is happening** — the resolved (non-UNAVAILABLE) S1 sections.
- **why** — each S1 CONFLICT explained (never resolved), citing BOTH claim sources; + scope-unresolved rationale.
- **what changed** — a deterministic diff of the current vs a supplied prior context (appeared / value-changed /
  certainty-changed / disappeared); **UNKNOWN when no prior** — change is never assumed.
- **could** — pointers to routable, non-conflicted capabilities (where S4 would propose), analysis-only.
- **should-not** — not-governed → must-not-route; conflict → must-not-treat-as-settled; UNKNOWN → must-not-treat-as-okay.

## Deterministic-first (D-14) — honored
`reason` is pure, synchronous, deterministic over injected state/context. No model feeds it. If a model ever assists
reasoning (Phase E), its output is untrusted data under §6/§2#13 with zero authority; the analysis-only shape and the
zero-runtime-import boundary hold regardless.

## S4 review-package contribution (item 2 — COMPLETE)
With S2, this completes item 2 (S2 + S3 evidence summaries, every pin named + green) of the L6-S4 review package
(`L6-S4-REVIEW-PACKAGE-CHECKLIST.md`). Items 1 (independent fleet audit, quiet-window/isolated per D-15), 3 (proposal
schema worked example), 4 (L5 operational-bridge status/plan), 5 (zero-authority extended to S4) are assembled AT the S4
gate — which is the next action and a HARD STOP.

## Non-frozen — no FG gate
New pure `main` module + test; type-only imports; no shared-type change, no IPC channel, no frozen touch. Proofs:
`brainReasoning.test.ts` (8) + full main (**845 files, 8895 passed / 3 skipped**) + typecheck node + lint clean.

## Live boundary (standing)
M365 `mail.send` is the SINGLE live governed consequential capability. L6-S3 REASONS over injected read-models; it
proposes nothing, executes nothing. The Brain has now proven it can SEE (S1) and REASON (S3) faithfully — the precondition
for the S4 proposal gate.
