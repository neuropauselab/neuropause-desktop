# AUTONOMY.md — the governed autonomous development loop (A0–A3 LITE)
### Adopted 19 Aug 2026 by operator directive · living, TRACKED, freeze-excluded (D-5)

**CLAUDE.md is the ONE constitution.** This document REFERENCES it and formalizes existing law into an operating
loop; it duplicates nothing and adds no authority. **On any conflict, CLAUDE.md wins.** The queue lives in
`WORK_QUEUE.md`; it grows ONLY by operator directives or by proposals presented to and approved by the operator —
never self-appended work.

## Build stages (the staged path — RECORDED, not all built)
- **A0 · Operating docs** (this file + WORK_QUEUE.md) — BUILT.
- **A1 · The seeded queue** — BUILT (WORK_QUEUE.md seeded to reality).
- **A2 · Gate detector** (`certification/gate-detector.sh`) — BUILT. Read-only pre-flight classification.
- **A3 · Honesty scanner** (`certification/honesty-scanner.sh`) — BUILT. Read-only diff scan → review items.
- **A4–A9 · NOT BUILT — post-ceremony only:** evidence generator (A4) · failure/reproduction memory (A5, enters with
  the LB-6 experience arc under §2 #15) · autonomous queue (A6) · overnight mode (A7) · development live brain
  (A8–A9). Each enters by operator approval after the S5.4 ceremony, never before.

## Task states
QUEUED → DISCOVERING → PLANNED → IMPLEMENTING → TESTING → VERIFYING → EVIDENCE → READY_FOR_REVIEW → COMMITTED.
Exceptional states (any stage): **BLOCKED · GATE_REQUIRED · AUTHORITY_REQUIRED · FAILED · UNKNOWN.**
- **BLOCKED is a LEGITIMATE result** — three genuine attempts, then a BLOCKERS.md entry and the next unblocked task
  (CLAUDE §3), never idling and never fabricating.
- **UNKNOWN is automatic:** a crashed runner is never PASS; an unexecuted test is NOT_VERIFIED; an unrecognized
  outcome is UNKNOWN and stays UNKNOWN until resolved (CLAUDE §2 #9).

## Action classes
- **GREEN** — proceed without asking: read/scout anything; edit non-frozen source within the scope budget; run
  suites/lint/typecheck; write per-task evidence; commit a completed task (never push).
- **YELLOW** — proceed and REPORT prominently: new files beyond the plan; renderer changes (triggers the full-suite
  rule); freeze-script exclude-list changes; anything touching e2e/verification seams (strip discipline must re-PASS).
- **RED** — STOP and wait for the operator: ANY frozen touch (FG gate, token, choreography — CLAUDE §2 #1–2); real
  credentials/consent/external sends; deletions beyond scope; autonomy promotions; pushes. RED is never worked around.

## Default scope budget (per task; exceeded → STOP + replan with the operator)
≤ ~15 files touched · **0 deletions** · **0 frozen surfaces** · **0 new dependencies** · **0 external effects**.

## Repair policy
**MAX_REPAIR_ATTEMPTS = 2** on a failing verification, then the task state is **BLOCKED_BY_REPEATED_FAILURE** with
the failure captured verbatim in the task report — never a third quiet retry, never a weakened assertion (§2 #4).

## Plan-before-code
A substantial task (new module, cross-layer wiring, anything YELLOW) gets a written plan in the task entry
(objective → files → acceptance → verification commands) BEFORE the first edit. Trivial mechanical fixes may proceed
directly with the plan stated in the commit message.

## The anti-workaround rule (verbatim, binding)
When a frozen boundary is hit, never seek a technically clever route to the same forbidden change — STOP, prepare
the FG gate, WAIT.

## Pre-flight (every task, before the first edit)
1. `bash certification/gate-detector.sh <file>...` over every file the plan intends to touch — the classification
   comes from AUTHORITATIVE metadata (`certification/baseline.json` + `certification/frozen-surfaces.json`), never
   from memory. FROZEN → STOP (RED). GATE → present the gate and wait. PROCEED → go.
   Honest limitation (stated, not hidden): "new external effect" is declared by the task author in the task entry —
   a path scan cannot prove effect-freedom; the detector flags known effect-bearing paths, the author declares the rest.
2. Confirm the scope budget fits; note any YELLOW class in the plan.

## Post-flight (every task, before READY_FOR_REVIEW)
1. `bash certification/honesty-scanner.sh` over the working diff — every hit becomes a REVIEW ITEM in the task
   report, never silently green. A justified hit (e.g. a deliberate `.skip` with an operator ruling) is EXPLAINED,
   not deleted from the report.
2. The verification ladder ends at the FULL main suite (`npx vitest run`) — and the full ui suite whenever
   `src/renderer/**` changed (the standing renderer rule, CLAUDE §3). Suites are RUN, numbers recorded against the
   current `BASELINE-<id>`.
3. Per-task evidence in the standing format (`certification/source-update/…-EVIDENCE.md`), honest labels only.

## Standing prohibitions (CLAUDE §2/§3, restated by reference)
Never push. `git push --force`, `git reset --hard`, `git clean -fd` are PROHIBITED always. Never fake green. Frozen
surfaces only through FG gates. D-15 quiet window for any fleet. Secrets never invented or committed. Every
consequential external action remains behind the ONE confirmation architecture — this loop develops the product; it
never gains execution authority over it.
