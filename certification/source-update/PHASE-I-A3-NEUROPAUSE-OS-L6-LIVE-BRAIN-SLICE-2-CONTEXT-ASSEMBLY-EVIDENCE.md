# OS-track L6 · Live Brain — SLICE 2 · CONTEXT ASSEMBLY (provenance per field) · EVIDENCE

> Preamble (standing): The intelligence proposes. The governance decides. The execution layer acts. The independent
> verifier proves. The Action Record remembers.

**Status: CONTEXT ASSEMBLY LANDED — TEST-VERIFIED, non-frozen.** S2 continues report-and-continue on S1's clean landing
(per the staged approval). The Brain's context now carries PROVENANCE PER FIELD. FREEZE INTACT. Still SEE-only —
**HARD STOP before L6-S4** (proposals) and a separate HARD STOP before L6-S5 (executions) remain.

## The observable object
`liveBrain/brainContext.ts` — `assembleBrainContext(inputs)` → a `BrainContext` (`{ scopeResolved, tenantId, facts }`):
the five substrates + the S34a ActionRecord joined into ONE coherent context of atomic **PROVENANCED FACTS**. Where S1's
`LiveBrainState` gives synthesized SECTIONS with a section-level `source`, S2 drills to the FACT level — every fact
records **which LAYER and which EVIDENCE OBJECT** it came from (`{ field, value, certainty, provenance:{ layer, evidence } }`).

## Coherence with S1 (atomic vs synthesized — both honest)
S2 facts are ATOMIC (one per evidence object, per single source); S1 sections are SYNTHESIZED (cross-source, including
CONFLICTING). The fact "capability `mail.send` is routable" is **KNOWN** at the atomic level even when S1 marks the
capabilities section **CONFLICTING** because a DIFFERENT substrate (the ActionRecord's verified-failure) disagrees —
different granularities of the same deterministic inputs. Pinned by a test that composes both and asserts the atomic
fact stays KNOWN while the S1 section is CONFLICTING.

## The five acceptance fields — each to a named test (`brainContext.test.ts`, 7)
| field | how it's honored | test |
|---|---|---|
| **Observable object** | a `BrainContext` of provenanced facts over REAL read-models | all 7 |
| **Collection boundary** | reads ONLY injected read-model outputs; purpose-bound facts only when the substrate is present; fail-closed — no scope emits an unresolved fact and NO fabricated data facts | `FAIL-CLOSED` · `purpose-bound absent → UNAVAILABLE` |
| **Capability contract** | ASSEMBLE-only; zero execution/grant authority — imports only TYPES | `ZERO-RUNTIME-IMPORT` |
| **Verification** | EVERY fact carries provenance (layer + non-empty evidence); each evidence ref TRACES to a real object in the inputs (a route's evidence names a capability in `routes`; a slice's names a `moduleId`; an action's names the real `ActionRecord` id) | `PROVENANCE PER FIELD` · `TRACEABILITY` |
| **Failure/UNKNOWN** | UNKNOWN/UNAVAILABLE facts still carry provenance (we record WHERE we looked); an absent substrate → an explicit UNAVAILABLE fact, never silence, never fabrication | `atomic certainty is faithful` · `FAIL-CLOSED` |

## Pins
- **Provenance completeness** — every fact's `provenance.layer` ∈ {L1,L2,L3,L4,L5,S34a} and `provenance.evidence` is
  non-empty; no fact is unattributable.
- **Traceability** — each evidence ref resolves to a real input object (asserted against `inputs.capabilities.routes`,
  `inputs.workspace.slices`, `inputs.actions`).
- **Zero-runtime-import** — value-import set empty (imports only the S1 `Certainty`/`LiveBrainInputs` TYPES + the layer
  shapes); no path into governance or execution. Reads no store (S34a arrives as already-queried `ActionRecord[]`, D-14).

## Deterministic-first (D-14) — honored
`assembleBrainContext` is pure, synchronous, deterministic over injected read-models. No model feeds it. "Live Brain" does
not mean "live LLM." §2#13 boundary intact.

## S4 review-package contribution (item 2, partial)
S2's evidence summary with every pin named + green is folded into the L6-S4 review package
(`L6-S4-REVIEW-PACKAGE-CHECKLIST.md`). S3 completes item 2.

## Non-frozen — no FG gate
New pure `main` module + test; type-only imports; no shared-type change, no IPC channel, no frozen touch. Proofs:
`brainContext.test.ts` (7) + full main (**844 files, 8887 passed / 3 skipped**) + typecheck node + lint clean.

## Live boundary (standing)
M365 `mail.send` is the SINGLE live governed consequential capability. L6-S2 ASSEMBLES provenanced context from injected
read-models; it reasons nothing, proposes nothing, executes nothing.
