# WORK_QUEUE.md — the governed task queue (A1)
### Living, TRACKED, freeze-excluded (D-5). Grows ONLY by operator directives or operator-approved proposals — never self-appended work. CLAUDE.md is the constitution; AUTONOMY.md defines states/classes/budgets.

Task format: **ID · objective · scope · allowed/prohibited files · dependencies · acceptance criteria · verification
commands · authority class · gate conditions · status.**

---

## NP-000 · S5.4 CEREMONY — first real Brain-proposed action
- **Objective:** one real governed send, Brain-proposed, at the operator's keyboard, per the FINAL CEREMONY CHECKLIST
  (runbook `…L6-S5-4-FIRST-REAL-BRAIN-ACTION-RUNBOOK.md`, 9 steps, OPERATOR vs MACHINE marked).
- **Scope:** the checklist only; one email to the operator's own address; single-send; no retry; containment same sitting.
- **Allowed/prohibited:** no repo change is part of this task except evidence capture; NO surface the runbook names may
  be modified by any other task while this is held.
- **Dependencies:** none (Phase 0 green; the corrected reality accepted; the bound go granted, re-armed).
- **Acceptance:** the checklist walked in order; terminal + `internetMessageId` captured; evidence copied out;
  containment complete; step-9 go given in the operator's own words BEFORE execution.
- **Verification:** independent read-back terminal (VERIFIED_SUCCESS / VERIFY_FAILED / HOLD — never assumed).
- **Authority class:** **AUTHORITY_REQUIRED (operator keyboard + explicit go).**
- **Gate conditions:** prerequisites 2–4 of the runbook are operator-only. **OUTRANKS EVERYTHING the moment the
  operator begins step 1 — all other tasks pause where they stand.**
- **Status: HELD** (awaiting the operator's sitting).

## NP-CORR-001 · Brain-propose-lane correction (recorded alongside the package)
- **Objective (completed):** close the Phase-0 overclaim — no production caller invoked the L6 stack from propose.
- **What happened:** claim → discovery (own recon) → STOP + report (divergence rule) → fix under the standing Phase-0
  mandate → in-app proof (`brainPropose.e2e.cjs`: eight fields → unedited execute → `L6-GATE ADMIT` →
  VERIFIED_SUCCESS → single-use NOT re-admitted).
- **Evidence:** `…L6-S5-4-P0-READBACK-CIRCLE-EVIDENCE.md` (ADDENDUM + dated CORRECTION note). Commits `59f9087`
  (lane) · `2315d33` (re-record, `BASELINE-413d2c24f7b2`).
- **Status: COMMITTED** (operator-accepted and commended, 19 Aug 2026).

## NP-001 · S23 — per-capability certification kit (first executable slice)
- **Objective (completed):** the seven-artifact kit, retroactive from mail.send; kit-complete ≠ certified pinned.
- **Evidence:** `…WHILE-HELD-S23-KIT-CALENDAR-DRYRUN-S39-EVIDENCE.md` §1. Commit `c1fd17e`.
- **Status: COMMITTED.**

## NP-002 · calendar.create PROPOSAL-SIDE dry run
- **Objective (completed):** the second capability through the kit up to the S5.1 line; honest UNVERIFIABLE plan live;
  production predicate REFUSES; five S4.2 attack classes hold. PROPOSALS only — never "certified".
- **Evidence:** same doc, §2. Commit `c1fd17e`.
- **Status: COMMITTED.**

## NP-003 · S39 — F-S17-1 affordance reconciliation
- **Objective (completed):** one local-first story, single-sourced by identity; claim-placement pinned; strings unchanged.
- **Evidence:** same doc, §3. Commit `68f4e2b` (INTACT `BASELINE-e19eb88e096c`).
- **Status: COMMITTED.**

## NP-004 · Release overlay (RECORDED, NOT ENTERED)
- **Objective (completed):** the version ladder onto the LB stages; the v1.0 definition; the ONE sequencing question
  left explicitly open for NP-006.
- **Evidence:** same doc, §4; `ROADMAP-HORIZON.md` §Release-Overlay. Commit `c1fd17e`.
- **Status: COMMITTED.**

## NP-005 · A0–A3 LITE dev-loop build (this directive)
- **Objective:** AUTONOMY.md + WORK_QUEUE.md (A0/A1) · gate detector (A2) · honesty scanner (A3) · the §0.3 dated
  CORRECTION note · seed the queue to reality · A4–A9 recorded NOT built.
- **Scope:** docs + `certification/` tooling only; 0 product-source changes; 0 frozen; 0 deps; 0 external effects.
- **Allowed files:** AUTONOMY.md · WORK_QUEUE.md · `certification/frozen-surfaces.json` · `certification/gate-detector.sh` ·
  `certification/honesty-scanner.sh` · the three freeze scripts' exclude lists (YELLOW, reported) · the Phase-0 evidence
  doc (append-only) · NP_STATE.md/CLAUDE §1 · the NP-005 evidence doc. **Prohibited:** everything else.
- **Dependencies:** none. **Authority class:** GREEN with YELLOW items (freeze-script exclude edit) reported.
- **Acceptance:** both scripts run read-only and self-test correctly (frozen → STOP; sensitive → GATE; clean → PROCEED;
  a crafted hostile diff → review items); freeze INTACT after the exclude-list update; queue seeded per §4.
- **Verification:** script self-tests captured · `bash certification/verify-freeze.sh` INTACT · full main suite
  (no product source touched — run to prove it).
- **Status: COMMITTED.** Self-tests: detector — frozen→STOP(2) · sensitive/effect→GATE(3) · clean→PROCEED(0) ·
  mixed→frozen dominates; scanner — clean tree 0 findings · crafted hostile diff all 8 pattern classes caught.
  YELLOW item reported: the three freeze scripts' exclude lists gained AUTONOMY.md + WORK_QUEUE.md (INTACT preserved).
  Full main 858/8992/3 (no product source touched). Evidence: `…NP-005-DEV-LOOP-A0-A3-EVIDENCE.md`.

## NP-006 · Post-ceremony §5 amendment — experience-arc-vs-v1.0 sequencing
- **Objective:** decide the ONE explicitly-open question (full experience arc before v1.0, or v1.0 earlier on the
  proven loop) by §5 amendment against the substrate as it then exists.
- **Dependencies:** **blocked on NP-000** (the ceremony).
- **Authority class:** **AUTHORITY_REQUIRED** (operator decision; five-field amendment discipline).
- **Status: QUEUED (BLOCKED on NP-000).**
