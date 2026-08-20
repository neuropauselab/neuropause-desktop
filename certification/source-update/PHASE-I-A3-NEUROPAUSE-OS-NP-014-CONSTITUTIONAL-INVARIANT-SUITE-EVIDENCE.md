# NP-014 · THE CONSTITUTIONAL INVARIANT SUITE — CLOSING EVIDENCE
## NP-012 §3 ruling, slice 2 of 6 (operator, 20 Aug 2026). ARCHITECTURE-SPEC §53's own demand — "These should become automated tests" — made real in ONE named suite. Zero frozen touch.

> Preamble (standing): The intelligence proposes. The governance decides. The execution layer acts. The independent
> verifier proves. The Action Record remembers.

**Status: TEST-VERIFIED.** Zero external effects; ceremony surfaces untouched; NP-000 = HOLD unchanged.

## What landed

1. **`src/main/constitutionalInvariants.test.ts`** — 26 tests, RULE-001..012, EVERY assertion through a REAL
   seam (real module imported, real function driven; nothing under test mocked; no rule re-implemented). Each
   rule cites the deeper distributed pin it derives from — those remain the exhaustive proof; this suite is the
   legible one-place statement. Seam recon by a D-15 fleet (3 read-only scouts) extracted compile-ready fixtures
   from the existing pins; the suite passed 26/26 on its first run.
   - RULE-001: hostile `confirmed:true/authority:'true'/approved:true` fields on a REAL built proposal are inert
     (boundary answers ASK — never ALLOW); a tampered authority CLAIM refused by live re-derivation; a substrate
     answering "no approval" refused.
   - RULE-002: the verbatim PRODUCTION S5.1 predicate refuses `calendar.create` on the certified M365 connector
     (`'not a certified consequential capability'`) — connector certified ≠ action certified.
   - RULE-003: invented capability → NOT_FOUND; empty catalog fails closed; governance-not-proven never promoted.
   - RULE-004: boundary refusal on expiry AND the end-to-end lane (stash → gate at +11 min → observable DENIED
     containing "expired").
   - RULE-005: an operator edit re-derives a different fingerprint → the gate SKIPs and the ORIGINAL stash is
     untouched (ADMIT-vs-SKIP discriminated through the real consuming store, control case included).
   - RULE-006: absent read-back → HOLD ("never auto-promoted"); right-id-wrong-recipient → HOLD (id never
     evidence alone); prior HOLD + still-empty readers → HOLD (evidence, never time).
   - RULE-007: `deriveAuthority`'s signature admits no history input; a proposal GROUNDED on a VERIFIED_SUCCESS
     ActionRecord still admits only as ASK; the import graph carries no runtime edge from memory/evidence
     modules (proposal.ts empty value-import set · actionRecord.ts denylist with the cst reference type-only ·
     businessFacts.ts denylist).
   - **RULE-008 — VACUOUS-BY-CONSTRUCTION, per the ruling's exact terms**: the suite PROVES no learning module
     exists (no `src/main/learning`; no `learn|experience` file in liveBrain) AND pins that ROADMAP-HORIZON
     records the linkage. **The linkage (both directions):** the horizon doc's LB-6 block now carries the ENTRY
     CRITERION — when the experience-memory arc lands code, these assertions FAIL BY DESIGN and flipping
     RULE-008 vacuous→real (learning output driven at the authority seams → refused) gates the arc's entry. The
     test's docstring says "Do not weaken these to keep them green."
   - RULE-009: thin suite-level drive of `scrubAccountMetadata` (the real-disk proof lives in NP-013's
     `rule009CredentialBoundary.test.ts`, cited).
   - RULE-010: unbound scope denies; cross-tenant read needs the EXPLICIT `authorizeTenantRead` grant; the stamp
     takes the owner from the scope, never the payload.
   - RULE-011: `governedSend` (frozen cst/ — IMPORT-ONLY, file lives outside cst/, no gate triggered) with
     `confirmed:false` → HOLD, effect count 0, stub counter 0; `ownsAccount:false` → DENIED, effect never runs.
   - RULE-012: see below.
2. **RULE-012's provenance gap CLOSED in-slice (per the ruling):** `ActionRecordVerification` gains an OPTIONAL
   `provenance { source, method, oracle }` (additive — a record written before the field is honest about lacking
   it; never back-filled), and the ONLY production caller (`s16VerifyRun.ts`, compile-gated) now supplies
   `{ source: 's16VerifyRun', method: 'corroborated-read-back (recipient+subject+timestamp window; never id
   alone)', oracle: 'm365ReadBack:sentItems+inbox' }`. The suite pins BOTH: the stored round-trip through the
   real store (temp-dir harness) and the call-site supply (source-pinned). Both files non-frozen; the
   actionRecord OBSERVER INVARIANT (cst import stays type-only) re-asserted inside RULE-007's import-graph pin.
3. **ROADMAP-HORIZON.md** — the LB-6 entry-criterion paragraph (the RULE-008 linkage, operator's terms quoted).

## Honest bounds

- The evidence model's remaining §43 fields (source_type, confidence, uncertainty; observed/recorded split)
  stay OPEN — they are NP-015's temporal work and the mapping row 8's remaining PARTIAL, not silently claimed.
- RULE-008 asserts absence, not adversarial behavior — that is the RULING'S design, recorded in test + horizon.
- `verify-e2e-strip` was deliberately NOT re-run this slice: the script REBUILDS `out/` as a release build, and
  the armed ceremony build (seed chunk `e2eSeed-DzsziIdg.js`, verified present) must remain the LAST build
  (NP-008 law; ceremony surfaces RESERVED). The `s16VerifyRun.ts` change is INSIDE an already-compile-gated file
  the strip proof already covers structurally; the strip re-runs at the next window where `out/` is not
  ceremony-reserved.

## Verification (all RUN)

Suite **26/26 first run** · actionRecord + m365WriteStates + s5MockLoop adjacent suites 25/25 (the optional
field broke nothing) · typecheck node clean · lint clean · honesty scan 0 findings · ceremony seed chunk
verified present after all work · **full main suite 867 files / 9061 passed / 3 skipped** (was 866/9035/3 —
the delta is exactly this suite; zero regressions).
