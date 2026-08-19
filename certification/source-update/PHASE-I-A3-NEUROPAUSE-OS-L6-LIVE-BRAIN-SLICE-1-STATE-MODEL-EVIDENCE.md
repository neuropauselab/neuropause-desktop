# OS-track L6 · Live Brain — SLICE 1 · the STATE MODEL · EVIDENCE

> Preamble (standing): The intelligence proposes. The governance decides. The execution layer acts. The independent
> verifier proves. The Action Record remembers.

**Status: STATE MODEL LANDED — TEST-VERIFIED, non-frozen.** L6 is OPEN (staged, operator-approved 19 Aug 2026). This is
the FIRST L6 slice — the Brain proves it can SEE faithfully before it reasons (S3) or proposes (S4, hard-stopped).
FREEZE INTACT.

## Control-point standing (operator-set)
L6-S1 (see) → S2/S3 (reason) pre-approved to continue **only** on S1 landing every pin green. **HARD STOP before L6-S4**
(proposals begin) and a **separate HARD STOP before L6-S5** (executions can follow). This slice is SEE-only.

## Deterministic-first (DECISIONS D-14, operator-acknowledged)
L6-S1 is a DETERMINISTIC derivation over the real read-models. "Live Brain" does NOT mean "live LLM" — no model feeds any
L6 slice until Phase E clears on the operator's go (D-13 bar). If a model ever does, its output is untrusted data under
§6/§2#13 with zero authority. Recorded here and in DECISIONS D-14.

## §2 #13 canonized (operator-approved as written)
> **The Brain proposes; it never reaches.** L6 is never granted LLM→shell/API/connector/database. Its only path to any
> external effect is BRAIN → PROPOSAL → GOVERNANCE → NEUROPAUSE EXECUTION → EXTERNAL EFFECT → INDEPENDENT VERIFICATION →
> ACTION RECORD. Its state model + reasoning hold zero execution/grant authority (zero-runtime-import, pinned).

## The observable object
`liveBrain/liveBrainState.ts` — `composeLiveBrainState(inputs)` → a `LiveBrainState`: ONE truthful operational state
object composed as a PURE JOIN over the real L1–L5 read-models + the S34a ActionRecord. Sections: workspace (L1) ·
capabilities (L4) · environment (L2) · purpose (L5) · discovery (L3) · evidence (S34a) · authority (derived L4) · health
(derived rollup) · risk (UNAVAILABLE — no model, never fabricated) · incidents (derived) · pendingWork (derived). Plus a
`conflicts` list and an `uncertainty` census. It never invents state.

## Five-valued uncertainty — first-class (the S1 core)
Every section carries one of **KNOWN / UNKNOWN / UNAVAILABLE / CONFLICTING / VERIFIED**. UNKNOWN never becomes "probably
okay": the health rollup is CONFLICTING > UNAVAILABLE > UNKNOWN > KNOWN, with VERIFIED reserved for fully-corroborated
state; an undetermined environment keeps health UNKNOWN with the summary "incomplete … NOT assumed okay" (pinned).

## The five acceptance fields — each to a named test (`liveBrainState.test.ts`, 11)
| field | how it's honored | test |
|---|---|---|
| **Observable object** | a `LiveBrainState` (sections + conflicts + uncertainty census) composed over REAL read-models | all 11 |
| **Collection boundary** | reads ONLY injected read-model outputs (no store; `actionRecord.query` is async/disk → the call-site queries and passes `ActionRecord[]` in); fail-closed: no scope → ambient sections UNAVAILABLE, never "all state" | `PURE JOIN / NO STORE` · `FAIL-CLOSED` |
| **Capability contract** | SEE-only; zero execution/grant authority — imports only TYPES (value-import set empty) | `ZERO-RUNTIME-IMPORT` |
| **Verification** | every section names its originating layer (provenance; S2 deepens to per-field evidence); the uncertainty census counts each section once; `evidence` is VERIFIED only when an independent success terminal exists | `PROVENANCE` · `UNCERTAINTY CENSUS` · `ambient KNOWN + evidence VERIFIED` |
| **Failure/UNKNOWN** | UNKNOWN stays UNKNOWN (never "okay"); risk UNAVAILABLE (not fabricated); every terminal honest | `UNKNOWN NEVER BECOMES "PROBABLY OKAY"` · `risk is UNAVAILABLE` |

## CONFLICTING — detected and SURFACED, never auto-reconciled (the completeness lens's sharpest concern)
S1 runs an EXPLICIT set of cross-substrate conflict checks; a detected conflict is surfaced in `conflicts` carrying BOTH
claims verbatim, and the affected sections are marked CONFLICTING — never silently resolved to one side:
1. **scope** — L1 and L4 disagree on tenant resolution;
2. **routed-but-verified-failed** — L4 routes a capability the S34a ActionRecord shows verified `VERIFIED_FAILURE`;
3. **environment-vs-capability** — L2 marks a capability NEED (absent) that L4 marks routed (present).
Each is pinned (`liveBrainState.test.ts` conflict block). The set is deliberately small for S1 and documented as extensible
as depth grows (Phase B).

## Grounded against the real substrate (auditor results folded in)
The planned 12-agent fleet audit did not complete (aborted by intervening operator messages — background agents share the
session abort signal). Grounding was performed by **direct reading** of every substrate file this session and is recorded
in the companion artifact `…L6-S1-SUBSTRATE-GROUNDING-AND-REVIEW.md` — six substrate claims CONFIRMED (positive results),
one CORRECTED up front (`actionRecord.query` is async/disk → S1 takes `ActionRecord[]` injected, not the store), and the
purpose-bound-vs-ambient finding that answers the sequencing question: **S1 is buildable now; the re-present branch is NOT
triggered.** No claim was papered.

## L6 Assurance — scaffolded from S1 (honest zero-baseline)
S1 establishes the observation substrate the assurance loop will use: the `uncertainty` census + `conflicts` + the
`evidence` section's independent-verification tally are the same ActionRecord-pattern signals the Brain will later use to
observe ITSELF (recommendation prediction → outcome). No recommendations exist yet (S4 is hard-stopped), so accuracy /
false-pos-neg / UNKNOWN-rate / rejection-rate are honestly **zero-baseline** until real decisions flow through S5.

## Non-frozen — no FG gate
New pure `main` module + test; type-only imports of the L1–L5 + ActionRecord shapes; CLAUDE.md §2#13 + DECISIONS D-14 are
living-doc edits (freeze-excluded, D-5) landed on operator approval. No shared-type change, no IPC channel, no frozen
touch. Proofs: `liveBrainState.test.ts` (11) + full main + typecheck node + lint clean.

## Remaining (staged — each its own gate)
S2 context/provenance (per-field evidence-object provenance) and S3 deterministic reasoning continue report-and-continue
on this clean landing. **L6-S4 (recommendation) and L6-S5 (governed maintenance) are HARD STOPS** — each reviewed at its
own evidence gate. A renderer surface for the state would touch frozen `packages/shared` → an FG gate when its turn comes.

## Live boundary (standing)
M365 `mail.send` is the SINGLE live governed consequential capability. L6-S1 READS injected read-models and composes a
truthful state; it reasons nothing, proposes nothing, executes nothing. A VERIFIED section means an independent
verification terminal exists in the evidence — not that the Brain acted.
