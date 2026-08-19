# OS-track L6 · S5.4 Phase 0 · FG-10 · L6 EXECUTION GATE · EVIDENCE

> Preamble (standing): The intelligence proposes. The governance decides. The execution layer acts. The independent
> verifier proves. The Action Record remembers.

**Status: FG-10 CLOSED — TEST-VERIFIED, frozen bracket INTACT. MOCK-ONLY, ZERO real contact.** The L6 execution-time gate
runs inside the governed execute path. FREEZE INTACT.

## The token (quoted verbatim)
> AUTHORIZED: FG-10 — connectors/index.ts L6 execution gate before governedSend, per gate doc

## Frozen / non-frozen split
- **FROZEN (isolated commit):** `apps/desktop/src/main/connectors/index.ts` — one import + a single gated call in the
  `mail.send` branch, mirroring the FG-4 guard shape:
  ```
  const l6 = l6ExecutionGate(deps, r);
  if (!l6.ok) return l6.refusal;
  ```
  Placed BEFORE the FG-4 first-real-send guard, so a refused proposal never touches the latch.
- **NON-FROZEN (accompaniment, before INTACT #1):** `liveBrain/executionGate.ts` (`l6ExecutionGate`) +
  `liveBrain/proposalStore.ts` (`stashProposal`/`gateL6Execution`, re-derivable-fingerprint key) + `liveBrain/toBrainReview.ts`.
- **Choreography:** INTACT #1 `BASELINE-0ced65c0283a` → frozen diff → INTACT #2 `BASELINE-8755bf876636`.

## The five conditions (all honored)
1. **Choreography** — non-frozen core checkpointed → INTACT #1 → exactly the one gated call → suites green → isolated
   frozen commit → INTACT #2 → this evidence.
2. **No-proposal → SKIP, pinned** — with no stashed L6 proposal, `l6ExecutionGate` returns `{ok:true}` and the existing
   assistant/deterministic flow is behaviorally IDENTICAL. Proven by the EXISTING suites passing unchanged (full main
   **853 files, 8958 passed / 3 skipped**; ui **38/268**) + `executionGate.test.ts` "no stashed proposal → SKIP".
3. **Refusal is observable** — an L6-gate refusal (re-derivation mismatch / expired / consumed) returns a `DENIED`
   `ConnectorWriteResult` — the SAME shape the FG-4 guard denial returns, never a silent drop. Pinned
   (`executionGate.test.ts` "authority drifts → observable DENIED refusal"). "What happened to this proposal?" stays
   answerable for refusals.
4. **Single-use, pinned** — a confirmed proposal's stash entry is consumed (`takeProposal` deletes); a replay of the same
   fingerprint finds no proposal and takes the SKIP path — never a re-admit. Pinned (`executionGate.test.ts` "single-use").
5. **Gate ≠ observer, stated** — the FG-5 ActionRecord observer stays best-effort and never blocks; the FG-10 gate MAY
   refuse, but ONLY L6-proposal-driven `mail.send` executions, never the non-L6 path. **Execution order in the handler:**
   FG-10 (this gate) FIRST → FG-4 first-real-send guard → `governedSend`.

## Re-derivation (the proposal's own words are never re-trusted)
`l6ExecutionGate` builds `ExecutionDeps` from SHARED derivations (`deriveAuthority` ← `mutationAssuranceFor`; `deriveOracle`
← the oracle registry) so a matching state re-derives identically (ADMIT) and a real drift REFUSES — via the S5.1
`admitForExecution` boundary. Deny-by-default.

## Gate registry
**FG-10 (closed):** `connectors/index.ts` L6 execution gate before `governedSend`. Token honored; INTACT #1
`BASELINE-0ced65c0283a` → frozen → INTACT #2 `BASELINE-8755bf876636`. One gated call; non-L6 → skip (unchanged); refusal
observable (DENIED); single-use.

## Next (Phase 0, report-and-continue, all non-frozen)
Panel wiring (`response.brainReview` → `BrainReviewCard`) → e2e mock executor + mock read-back seams (extend `e2eSeed`,
strip discipline) → production read-back de-gate (READ-ONLY pin; `verify-e2e-strip` keeps its meaning) → the real-Electron
e2e proving the circle in-app with all three terminals. Then the FINAL CEREMONY CHECKLIST + HOLD.

## Live boundary (standing)
M365 `mail.send` is the SINGLE live governed consequential capability. FG-10 can only REFUSE a Brain-proposal-driven send;
it makes no external contact and never weakens the certified path.
