# OS-track L6 · S5.4 Phase 0 · READ-BACK CIRCLE · EVIDENCE

> Preamble (standing): The intelligence proposes. The governance decides. The execution layer acts. The independent
> verifier proves. The Action Record remembers. **Executor-success is never the claim (constitutional §2 #14).**

**Status: TEST-VERIFIED — the whole circle (send → ACK → INDEPENDENT read-back → terminal) closes over the REAL oracle
at MODULE LEVEL *and* IN THE RUNNING APP (real-Electron e2e). MOCK-ONLY, ZERO real contact. No frozen surface touched.**

This increment supplies the missing half of the governed loop: after the certified path returns ACKNOWLEDGED (mock
Graph 202, which carries no message id), an INDEPENDENT read-back reaches a real terminal — VERIFIED_SUCCESS,
VERIFY_FAILED, or HOLD — so "accepted for delivery" is never laundered into "delivered."

## What landed (all non-frozen)
1. **`verification/verifyGovernedSend.ts` (+test, 6)** — the DE-GATED, READ-ONLY read-back orchestrator. Builds a
   `VerificationTarget` from a plain send ref (recipient · subject · body-fingerprint · timestamp window) and drives the
   pure `verifyEffect` over an INJECTED reader. **No latch, no env, no electron.** This is the orchestration that was
   previously trapped inside the compile-stripped `e2e/s16VerifyRun.ts`; it is READ-ONLY and carries no e2e identity, so
   it is production-safe and now lives in `verification/`. Three terminals proven with fake readers; idempotent on a
   prior terminal; READ-ONLY surface asserted (exactly two readers + a clock — nothing that could emit an effect).
2. **`e2e/mockGraph.ts` (+test, 6)** — the PURE mock-Graph seam (no electron). Records a governed send from the REAL
   `/me/sendMail` body, then answers the read-back Sent Items / Inbox GETs per the harness knob `NEUROPAUSE_E2E_VERIFY`:
   `success` → Sent Items echoes the send ⇒ VERIFIED_SUCCESS; `bounce` → Inbox carries an NDR referencing the recipient
   ⇒ VERIFY_FAILED; `hold` → nothing observed ⇒ bounded backoff exhausts ⇒ HOLD (never auto-promoted). **The circle is
   proven over the REAL `verifyEffect` for all three terminals.** The mock never invents a success the oracle would not
   corroborate (deny-by-default knob resolution: unknown value → the honest `success` path is only chosen for the
   literal `success`; `hold`/`bounce` are explicit).
3. **`e2e/e2eSeed.ts`** — `installGraphMock` now delegates to `mockGraph`; exports the captured-send state; on a captured
   send (and only when the knob is set) fires the READ-ONLY read-back so the circle closes IN-PROCESS.
4. **`e2e/e2eVerifyRun.ts`** — compile-gated mock read-back trigger (`NEUROPAUSE_E2E_VERIFY_v1`); delegates to
   `verifyGovernedSend` over the REAL `makeM365GraphReader` (whose fetch loops back through the mock).
5. **`e2e/s16VerifyRun.ts`** — the latch coupling is SEVERED to this compile-gated caller only; it now delegates to
   `verifyGovernedSend`. The read-back logic no longer lives behind the latch/env gate.
6. **`scripts/verify-e2e-strip.sh`** — `mockGraph` + `e2eVerifyRun` chunk names and the two new sentinels added to the
   NEGATIVE strip checks. **PASS confirmed** against a fresh release build (0 sentinel files, 0 seam chunks, 0 branch
   refs, 0 guard strings). The READ-ONLY orchestrator carries no sentinel/latch/env and is deliberately NOT in the
   negative list — it is production source that ships when a production caller imports it.
7. **`e2e/mailReadBack.e2e.cjs`** — the real-Electron read-back harness (three knobs → three terminals), driving the
   send through the certified IPC path via the preload bridge and asserting the read-back terminal in the main log.

## Explicit no-orphan gate (CLAUDE §4)
`verifyGovernedSend` has NO production caller yet — its only callers are the in-session S16 runner and the e2e trigger,
both compile-gated because RUNNING a read-back requires either the operator's live session (vault unlock, D-10) or the
e2e mock. The orchestrator is de-gated (production location, READ-ONLY, latch/env-free); its TRIGGER is legitimately
gated. **The production caller is the S22 reconciler (UNKNOWN → RECONCILIATION), which will call `verifyGovernedSend`
as its verification step.** Recorded here as the deliberate gate rather than wired to a synthetic caller.

## Runs (RUN against BASELINE-52008b68ddb5)
- `verifyGovernedSend.test.ts` — 6/6. `mockGraph.test.ts` — 6/6 (circle over the real oracle, all three terminals).
- Full main — **855 files / 8970 passed / 3 skipped**. typecheck node clean; lint clean.
- `verify-e2e-strip.sh` — **PASS** (mock read-back seam absent from the release build).
- **Real-Electron read-back run (`mailReadBack.e2e.cjs`) — PASS, 0 assertions failed, 3 launches.** In the running app,
  each knob drove the certified path → ACKNOWLEDGED (mock Graph 202, executor hit the mock, not the real Graph) → the
  INDEPENDENT read-back → the expected terminal, observed in the main-process log:
  - `success` → **TERMINAL=VERIFIED_SUCCESS**, with a corroborated (mock) `internetMessageId=<mock-…@MOCK.OUTLOOK.COM>`.
  - `bounce` → **TERMINAL=VERIFY_FAILED** (NDR referencing the recipient).
  - `hold` → **TERMINAL=HOLD**, explicitly asserted NOT auto-promoted to VERIFIED_SUCCESS.
  This is the S14 governed-send loop extended with its verifying half — the circle now closes end-to-end in the real
  Electron application, not merely at module level. Artifacts: `apps/desktop/e2e/artifacts/readback-{success,bounce,hold}.png`.

## Completion claim (operator-required, verbatim)
Final suite numbers: full main **855 files / 8970 passed / 3 skipped** · ui **39 files / 271 passed** ·
`verifyGovernedSend.test.ts` 6/6 · `mockGraph.test.ts` 6/6 · typecheck node+web clean · lint clean ·
`verify-e2e-strip.sh` **PASS** · real-Electron `mailReadBack.e2e.cjs` **PASS (0 failed, 3 launches)** — all RUN against
`BASELINE-52008b68ddb5`; the state re-recorded INTACT at `BASELINE-d2d9a75b45bc`.

> **"the L6 circle is mock/test-verified in the running app; no real external effect has occurred; the first real
> Brain-proposed action remains operator-gated."**

## ADDENDUM (19 Aug 2026, pre-ceremony) — HONEST CORRECTION: the Brain-propose lane was missing; now built + proven
**The gap (found in pre-ceremony recon, reported before any ceremony step):** the completion report above overclaimed
"brainReview live in the confirm panel" — the RENDERER wiring was live and ui-tested, but NO production caller populated
`response.brainReview`, stashed a proposal, or invoked the L6 stack from the propose path (the liveBrain modules' only
production caller was the FG-10 gate itself, which therefore always SKIPped). The ceremony as written could not have
executed steps 2/3 and step 5 would have been a human-composed governed send, not a Brain-proposed action. Per the
divergence rule: STOP, report — then fix under the standing Phase-0 mandate (which explicitly included this wiring).

**The fix (all non-frozen; the FG-9 field was already frozen-landed):**
- `liveBrain/brainProposeLane.ts` (+7 pins) — composes the REAL substrate (workspace-domain snapshot · capability graph
  over the real assurance predicate · S34a ActionRecords) into a `LiveBrainState`, drives the S4-certified
  `buildProposal` from the VALIDATED producer artifact (never the raw request), stashes for the FG-10 gate, returns the
  FG-9 fields. Alignment invariants pinned: tenancy key = the workspace id (the gate's own key); derivations are
  LITERALLY the gate's exported `deriveAuthority`/`deriveOracle`; stash params are the EXACT execute shape (an operator
  EDIT breaks the fingerprint → SKIP — an edited send is no longer the Brain's proposal); expiry (10-min governed
  window) → observable DENIED at the gate; cross-tenant action evidence → tenant unprovable → NO proposal; propose-side
  purity (no executor/CST/send-transition import).
- `capabilityProposeCore.runProposeM365ActionWithArtifact` — same validation, also returns the internal artifact (never
  crosses IPC). `capabilityProposeIpc` — async handler feeds the lane best-effort/additive-only: any lane refusal or
  failure yields the response exactly as today, with no `brainReview`.
- `executionGate.ts` — `deriveAuthority`/`deriveOracle` exported (single source, both sides); ADMIT/REFUSE now logged
  (`L6-GATE ADMIT/REFUSE`) so a Brain-proposed send is distinguishable from a merely-governed one in the running app.

**The in-app proof (`e2e/brainPropose.e2e.cjs` — real Electron, mock Graph, PASS 0 failed):** propose over the real
channel → `brainReview` present, all eight fields, recipient named, honest plan → UNEDITED execute → ACKNOWLEDGED +
**`L6-GATE ADMIT` in the main log** → independent read-back → **TERMINAL=VERIFIED_SUCCESS** → a second identical send
is NOT re-admitted (exactly one ADMIT across two sends — single-use in-app). `mailReadBack.e2e.cjs` re-run PASS on the
same bundle. Full main **856/8977/3** · ui **39/271** · typecheck node clean · lint clean · `verify-e2e-strip.sh`
**PASS** with the lane confirmed PRESENT in the release bundle (production code) and the seams absent.

**Honest notes:** (1) the lane's workspace-domain modules read UNAVAILABLE (the enterprise registry accessor is private
to its runtime; the state is honest about it — never a fake count). (2) The execution gate's state-hash comparison
remains the FG-10 placeholder (stable per tenant); drift protection at confirm = expiry + tenant + authority/oracle
re-derivation. (3) The L6 tenancy key equals the WORKSPACE id, matching the live ActionRecord convention and the gate.

## Constitutional honesty
Send-verification, not a destination receipt (destination filtering remains NOT GOVERNED). The mock proves the MACHINE:
the READ-ONLY oracle reaches a corroborated terminal from independent mailbox evidence. HOLD (UNRESOLVED) never
auto-promotes to SUCCESS. The single live governed consequential capability is unchanged; this increment makes NO
external contact and weakens NO validation.
