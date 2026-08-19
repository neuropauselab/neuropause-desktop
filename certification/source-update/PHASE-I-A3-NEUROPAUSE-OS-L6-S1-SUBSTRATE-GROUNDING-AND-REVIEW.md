# L6-S1 · Substrate Grounding & Adversarial Review · EVIDENCE ARTIFACT

> Preamble (standing): The intelligence proposes. The governance decides. The execution layer acts. The independent
> verifier proves. The Action Record remembers.

## Provenance of THIS artifact (honest — no fabrication)
The planned 12-agent read-only fleet audit **did not complete**: background workflow agents share the session's abort
signal, and each operator message sent while it ran (containment + the "proceed" instructions) interrupted the in-flight
agents (`[Request interrupted by user]` in every transcript — real Read/Bash analysis done, but no structured result
emitted). Rather than fabricate a "12-lens synthesis" that never finished, this grounding was performed by **direct
reading of the real source in this session** — the same ground truth the fleet would have read. It is labeled exactly as
that: a direct-read grounding + a self-authored adversarial review, NOT an independent multi-agent result. If an
independent fleet audit is wanted as a distinct artifact, it can be run uninterrupted and folded in.

## Substrate claims — CONFIRMED against the real code (positive results, per condition #4)
Each claim below was verified by reading the named file this session. A claim surviving direct verification is recorded
as a POSITIVE result, not a non-event.

| # | Claim (from the L6 re-presentation) | Verified against | Verdict |
|---|---|---|---|
| 1 | L1 yields a tenant-scoped domain snapshot; scope unresolved → empty/UNKNOWN, absent store → UNAVAILABLE (never fake 0) | `domainAggregate.ts:69-88` (`composeWorkspaceDomain`) | CONFIRMED |
| 2 | L2 `EnvironmentModel` classifies each required element HAVE/NEED/UNKNOWN/UNAVAILABLE; UNKNOWN never → HAVE | `environmentModel.ts` (`composeEnvironmentModel`) | CONFIRMED |
| 3 | L3 `runDiscovery` walks the purpose-bound pipeline; collection never runs without granted authority | `environmentDiscovery.ts` + `liveSources.ts` | CONFIRMED |
| 4 | L4 `CapabilityGraphSnapshot` = certified-only routes + honest gaps (`not-governed`/`missing`); `scopeResolved` fail-closed | `capabilityGraph.ts:78-115` | CONFIRMED |
| 5 | L5 `evaluatePurpose` = nine-state ladder; UNKNOWN/uncertainty never auto-promotes | `purposeEngine.ts` | CONFIRMED |
| 6 | S34a `ActionRecord` carries the chain + fingerprints + `verification`; `query` is tenant-filtered | `actionRecord.ts:58-79, 224-238` | CONFIRMED |

## Substrate claim CORRECTED up front (a real finding, not papered)
**`actionRecord.query` is ASYNC and touches the filesystem** (`actionRecord.ts:225`, `app.getPath('userData')`). The
re-presentation implied L6 could "read the ActionRecord" inside its state model. It CANNOT do so purely: a pure, no-store,
zero-runtime-import join must not call an async disk-backed store or import the `actionRecord` singleton (its module runs
`declareStoreScope` + imports `electron` at load). **Correction folded into S1's design:** `composeLiveBrainState` takes
the **already-queried `readonly ActionRecord[]`** as an injected input; the production call-site does the async
`actionRecord.query(...)` and passes the result in. This preserves all five S1 pins.

## Design finding — the purpose-bound vs ambient split (answers the sequencing question)
Reading the layers surfaced that **L2/L3/L5 are purpose-BOUND** (they evaluate a specific purpose) while **L1/L4/S34a are
ambient** (tenant-scoped current state). Consequence for S1: a `LiveBrainState` composed for the active tenant scope
includes the ambient layers directly, and the purpose-bound layers **only when a purpose is in scope** — otherwise they
are honestly **UNAVAILABLE** ("no active purpose"), never fabricated. **This means S1 is buildable now from the substrate
as it exists — the re-present branch is NOT triggered.** Phase B adds DEPTH (entity/relationship model, drift, real
discovery adapters); it is not a precondition for S1's pure join.

## Adversarial self-review of the five S1 pins (what the lenses would have attacked)
- **Pure join / no store** — `composeLiveBrainState(inputs)` is a pure function over injected read-model outputs; it
  imports no store, performs no I/O, is synchronous. Pinned by a no-async + injected-inputs test.
- **Fail-closed scope** — when neither L1 nor L4 resolves a tenant scope, every ambient section is UNAVAILABLE and the
  overall state is explicitly unresolved — never "all state." Pinned.
- **CONFLICTING detection (the completeness lens's sharpest concern: WHO detects, HOW)** — S1 runs an EXPLICIT set of
  cross-substrate conflict checks (scope agreement between L1 & L4; a capability the L4 graph routes but the ActionRecord
  shows verified-FAILED; a capability L2 marks NEED but L4 marks routed). A detected conflict is surfaced in a `conflicts`
  list carrying BOTH claims verbatim, and the affected section is marked CONFLICTING — **never silently reconciled to one
  side.** The check set is deliberately small for S1 and documented as extensible as depth grows (Phase B).
- **Zero-runtime-import** — the module imports only TYPES from L1–L5 + `actionRecord`; the value-import set is empty
  (pinned), so there is no path from the Brain's state model into governance or execution.
- **Uncertainty never becomes "probably okay"** — the health rollup is CONFLICTING > UNAVAILABLE > UNKNOWN > KNOWN, with
  VERIFIED only when a section is fully KNOWN AND corroborated by an independent verification terminal. An UNKNOWN section
  renders as UNKNOWN, never "okay." Pinned.

## Not invented (deny-by-default honored)
`risk` has no real source in the substrate today → the section is **UNAVAILABLE**, never a fabricated score. `health`,
`incidents`, `pendingWork`, and `authority` are **derived functions of the real inputs** (each traces to L1–L5/ActionRecord),
clearly labeled derived — derivation, not invention.

## Live boundary (standing)
M365 `mail.send` is the SINGLE live governed consequential capability. L6-S1 READS injected read-models and composes a
truthful state; it reasons nothing, proposes nothing, executes nothing. A VERIFIED section means an independent
verification terminal exists in the evidence — not that the Brain acted.
