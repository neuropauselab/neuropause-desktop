# WHILE-HELD WORK PACKAGE · S23 KIT + CALENDAR DRY RUN + S39 · EVIDENCE

> Preamble (standing): The intelligence proposes. The governance decides. The execution layer acts. The independent
> verifier proves. The Action Record remembers.

**Status: TEST-VERIFIED. Executed under the merged directive (19 Aug 2026) while the S5.4 ceremony HOLD stands —
the HOLD is untouched; no ceremony surface (runbook, checklist) was modified. ZERO real contact. No frozen touch —
the anticipated FG gate for second-capability contract entries was NOT triggered (the dry run is module-level; a
production calendar propose surface would be that gate, presented when it arises).**

## §0 honored
No new architecture program: S23 and S39 are canonical §5 slices; the dry run exercises EXISTING S4/S5.1 machinery;
the experience-memory arc remains NOT ENTERED. No fleets were run (the ceremony can interleave at any moment and
would abort them mid-run — D-15); verification is deterministic suites throughout.

## §1 · S23 — the per-capability certification kit (mail.send back-fill) — RUN against BASELINE-73633728332a
`capabilities/certificationKit.ts` — a PURE, typed record + `runKitChecks`, the operator's seven artifacts
(capability entry · authority derivation · oracle entry OR honest UNVERIFIABLE declaration · params schema + CST
binding shape · refusal fixtures · read-back plan · evidence template), derived RETROACTIVELY from the proven
mail.send path. The full 14-field S23 contract remains the superset; this is its first executable slice. The kit
exposes no certifier and grants nothing — kit-complete ≠ certified (certification additionally needs the live chain).
**Back-fill (`certificationKit.test.ts`, 5):** mail.send completes the kit with a REAL oracle entry
(`verifyEffect`, send-corroboration); authority is the SHARED derivation (requires human approval + the named gate);
all four refusal fixtures refuse at the REAL propose core (`PRINCIPAL_UNRESOLVED` · `CAPABILITY_NOT_SELECTED` ·
`UNSUPPORTED_ACTION` — calendar.create at the edge, the boundary live today · `INVALID_PARAMS` comma-hardening);
CST binding = the real `EffectBinding` field set with params bound VERBATIM.

## §2 · calendar.create DRY RUN — PROPOSALS ONLY (claim language binding) — RUN against BASELINE-73633728332a
`capabilities/calendarCreateDryRun.test.ts` (10), all over the REAL S4/S5.1 modules; nothing past ADMIT_FOR_ASK
exists anywhere in the file; no executor wiring; **never "calendar capability certified"**:
1. **The honest-plan path, live for the first time:** a calendar.create proposal FORMS and its plan is
   `verifiable:false` with the need stated; the ASK projection renders VERBATIM
   **"UNVERIFIABLE today: needs a calendar read-back oracle (event GET-by-id corroboration)"** — never a false
   VERIFIED promise (§2#14). `deriveOracle` gained the per-capability HONEST needs registry (non-frozen;
   mail.send's plan unchanged — re-derivation equality preserved, liveBrain 95 green).
2. **The S5.1 boundary holds with the PRODUCTION predicate:** `admitForExecution` → REFUSED
   `'not a certified consequential capability'` — connector certified ≠ every action certified, at the execution
   boundary, deny-by-default.
3. **The machinery is capability-generic:** under a kit-modeled FUTURE-state predicate (test-only; a model, not a
   grant) the same proposal reaches ADMIT_FOR_ASK with disposition 'ASK' and NOTHING more — ASK-only is structural
   for a second capability too.
4. **The S4.2 attack classes hold for the second capability:** cross-tenant target REFUSED · scope escalation
   REFUSED · stale evidence EXPIRED · unresolvable evidence BLOCKED · non-approval authority BLOCKED.
5. **The kit completes for the dry-run record** with the oracle artifact honestly `HONEST UNVERIFIABLE` and the
   read-back plan stating it cannot verify until an event GET-by-id oracle exists (the S24-class pattern).

## §3 · S39 — F-S17-1 affordance reconciliation — RUN against BASELINE-e19eb88e096c
`renderer/localFirst/story.ts` — the single local-first vocabulary; the DOOR (first-run "Try Free Locally" — a door,
not a claim) and the STATE (`LocalModeBanner` "Working locally — your data stays on this device." — derived truth,
local branch only) + the one way back ("Connect an account to sync"). `FIRST_RUN_COPY` and the banner now render the
story values BY IDENTITY — the surfaces cannot drift. Pins (`localFirstStory.test.tsx`, 5): single-source identity ·
CLAIM-PLACEMENT (the door copy never contains the claim; the state line does) · the shared "locally" term · the
banner renders the state half verbatim with the real `onConnect` · the honest-copy rule survives. All visible
strings unchanged — the reconciliation is structural. **F-S17-1 CLOSED.**

## §4 · Release overlay — RECORDED, NOT ENTERED
ROADMAP-HORIZON gained the version ladder mapped onto the LB stages (v0.9.x productization → v0.9.3–7 experience
arc → **v1.0 commercial gate** = the twelve-component core with ONE unquestionably governed, observable, verifiable
capability, "v1.0 does not need 100 connectors" → v1.1–1.5 → v2.0 multi-capability → v2.x governed network), and the
ONE question left EXPLICITLY OPEN (experience arc before v1.0 vs earlier v1.0 on the proven loop) — decided by §5
amendment AFTER the ceremony; deliberately not resolved here.

## Suites (final, RUN against BASELINE-e19eb88e096c)
Full main **858 files / 8992 passed / 3 skipped** · ui **40 files / 276 passed** · liveBrain 95 · typecheck
node+web clean · lint clean. FREEZE INTACT at every commit.

## Standing
The S5.4 ceremony HOLD stands exactly as presented; the next input is the operator sitting and walking the checklist
from step 1. No real contact occurred; nothing here weakened any certified path.
