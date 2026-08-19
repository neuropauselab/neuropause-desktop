# NP-005 · GOVERNED DEV LOOP A0–A3 LITE · EVIDENCE

> Preamble (standing): The intelligence proposes. The governance decides. The execution layer acts. The independent
> verifier proves. The Action Record remembers.

**Status: TEST-VERIFIED (self-tests) / SOURCE-PROVEN (docs). Executed under the consolidated directive (19 Aug 2026)
while the S5.4 ceremony HOLD stands — the HOLD untouched. ZERO product-source changes; ZERO frozen touch; ZERO new
dependencies; ZERO external effects. A4–A9 RECORDED, NOT BUILT (post-ceremony only).**

## §0.3 condition honored
A dated **CORRECTION** note was APPENDED to the Phase-0 evidence doc itself
(`…L6-S5-4-P0-READBACK-CIRCLE-EVIDENCE.md`): claim → discovery → fix → in-app proof, with the lane commit referenced
(`59f9087`, re-record `2315d33` / `BASELINE-413d2c24f7b2`). History preserved — nothing above it rewritten.

## A0 · AUTONOMY.md (root, living, freeze-excluded)
Task states (QUEUED→…→COMMITTED; BLOCKED/GATE_REQUIRED/AUTHORITY_REQUIRED/FAILED/UNKNOWN — **BLOCKED is a
legitimate result**; **UNKNOWN is automatic**: crashed runner ≠ PASS, unexecuted test = NOT_VERIFIED) ·
GREEN/YELLOW/RED action classes · the default scope budget (~15 files · 0 deletions · 0 frozen · 0 new deps ·
0 external effects; exceeded → STOP + replan) · **MAX_REPAIR_ATTEMPTS = 2 → BLOCKED_BY_REPEATED_FAILURE** ·
plan-before-code · **the anti-workaround rule VERBATIM** ("when a frozen boundary is hit, never seek a technically
clever route to the same forbidden change — STOP, prepare the FG gate, WAIT"). **CLAUDE.md remains the ONE
constitution — AUTONOMY.md references it, never duplicates; on conflict CLAUDE.md wins** (stated in its header).
A4–A9 recorded as the staged path, explicitly NOT BUILT until after the ceremony.

## A1 · WORK_QUEUE.md seeded to reality (§4)
NP-000 ceremony (**AUTHORITY_REQUIRED, HELD, outranks everything at step 1**) · NP-CORR-001 the brain-lane
correction (COMMITTED, its own entry) · NP-001–NP-004 the executed package (COMMITTED with evidence refs + commits
`c1fd17e`/`68f4e2b`) · NP-005 this directive · NP-006 the post-ceremony §5 sequencing amendment
(AUTHORITY_REQUIRED, blocked on NP-000). Growth rule in the header: operator directives or operator-approved
proposals only — never self-appended work.

## A2 · Gate detector (`certification/gate-detector.sh`, read-only, fail-closed)
Classifies target paths from AUTHORITATIVE metadata — `certification/baseline.json` (anchor, must exist) +
**`certification/frozen-surfaces.json`** (NEW: the machine projection of the CLAUDE §2/§6 gate registry, FG-1..10;
on conflict CLAUDE.md wins) — never memory. Missing metadata → REFUSE (exit 4). **Self-tests (captured):**
frozen (`packages/shared/…`, `runtimeCore.ts`) → STOP exit 2 · sensitive (`firstRealSendGuard.ts`) + effect-bearing
(`connectors/m365/mail.ts`) → GATE exit 3 · clean (`brainProposeLane.ts`, `localFirst/story.ts`) → PROCEED exit 0 ·
mixed → frozen dominates (exit 2). Honest limitation STATED in AUTONOMY.md + the metadata: a path scan cannot prove
effect-freedom — the task author declares it; the detector flags known effect-bearing paths.

## A3 · Honesty scanner (`certification/honesty-scanner.sh`, read-only, report-only)
Scans the working diff (or `--diff-file` for self-tests) for: test/describe/it `.skip` · `.only(` · `as any` ·
`eslint-disable` · empty catch · timeout inflation (≥5-digit) · assertions removed in excess (removed `expect(` >
added) · ONLY-test-files-changed (expected-output edited instead of the implementation). Findings are **REVIEW
ITEMS** for the task report — never silently green; the scanner never blocks. **Self-tests (captured):** the current
clean tree → 0 findings; a crafted hostile diff → all 8 pattern classes caught.

## YELLOW item (reported per AUTONOMY.md)
The three freeze scripts' exclude lists (`freeze-baseline.sh` / `verify-freeze.sh` / `record-gate.sh`) gained
`AUTONOMY.md` + `WORK_QUEUE.md` (living root docs, D-5 pattern — exactly as ROADMAP-HORIZON before them).
`verify-freeze.sh` re-run after the edit: **FREEZE INTACT** (excluding paths that did not exist under the old spec
leaves the recorded hash unchanged).

## Runs (RUN against BASELINE-e19eb88e096c)
Gate-detector self-tests 4/4 · honesty-scanner self-tests 2/2 (0 findings clean / 8-class hostile catch) ·
`verify-freeze.sh` **INTACT** · full main **858 files / 8992 passed / 3 skipped** (proving no product source was
touched by this task).

## Standing
The S5.4 ceremony HOLD stands exactly as presented (NP-000 outranks everything at step 1). The queue grows only by
operator directive or approved proposal. A4–A9 wait for the other side of the ceremony.
