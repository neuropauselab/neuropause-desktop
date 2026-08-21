# BLOCKERS — NeuroPause OS
### Read at every session ritual, after CLAUDE.md and NP_STATE.md. Current as of 20 Aug 2026.

> **THIS FILE IS AN ENTRY POINT, NOT A REGISTER.** The register is
> **`certification/CONTROL-REGISTER.md`** — four classes (A findings · B constitution · C held · D operator
> decisions), with every finding naming the law it violates and every law carrying its open findings and its
> enforcement (PINNED / SCRIPT / PROSE). The narrative record remains in
> **`certification/ARCHITECTURE-MAPPING.md` §5–§13**, with FINDINGS-WITHOUT-A-LANE at §6.6.
>
> **Why it was rewritten:** it sat at 1,430 bytes and two days stale while ~34 findings accumulated, and the
> session ritual reads it every time. **An entry point that is blind is worse than no entry point, because it is
> trusted.**

---

## ⛔ HARD HOLDS — nothing proceeds past these without an operator ruling

| Hold | State | Released by |
|---|---|---|
| **NP-000 · the ceremony** | **HELD.** Hold reason has been re-ruled twice: tenant availability → executed-and-empty propose lane → **the unresolved P1 contradiction**. | operator only |
| **A second external effect** | **PROHIBITED.** One real send exists (S15/S16, 20 Aug 12:17). | operator only |
| **P1 attempt 2** | **UNAUTHORIZED.** Runs against `certification/P1-REPRODUCTION-RUNBOOK-v2.md`, fresh sitting, rested operator. | operator only |
| **`first-real-send.latch`** | **PRESERVED** at `~/NeuroPause-S54-r3/`. Never deleted, never re-armed. | operator only |
| **Frozen surfaces** | **UNCHANGED.** Any touch needs an FG gate + literal token + §2.2 choreography. | operator token |

## 🔴 SHIP-BLOCKING — the four

1. **P1 · silent unresolved-TENANT-SCOPE branch.** *Required phrasing:* **"a silent unresolved-TENANT-SCOPE
   branch EXISTS and is CAPABLE of producing the observed result, but the ceremony evidence does not establish
   that it occurred."** `brainProposeLane:81` returns null and emits nothing. **P1 = AWAITING CONTROLLED
   REPRODUCTION** — it is not an investigation; the historical A/B event of 18:16:59 is **CLOSED AS UNKNOWN and
   is not reopened.**
2. **F-P24 · governance cannot prove its refusals.** A DENY mints no ActionRecord (observed live: the 18:19 FG-4
   denial left an audit line and no evidence row). P4-MIN closed the propose-refusal half only. **P4-FULL** — the
   three-record model (GOVERNANCE / EXECUTION / VERIFICATION, reconciled against D-16 and `Certainty`) — is the fix.
3. **F-P13 · a per-profile safety device does not protect a multi-instance desktop.** Two instances ran 20 hours;
   an 18:19 Confirm in the r2 window would have sent for real. **The process-list check is now a step-1 ceremony
   gate**, and F-P29 corrected its predicate to mains-only-exact-zero.
4. **F-P8 · model output reaches a send-capable form with nothing between.** The P2.4 PRODUCT-DRAFT path is
   structurally outside the authority boundary and functionally upstream of it. No content validation exists on
   the governed `mail.send` path — empty, raw JSON and placeholder bodies all pass.

## 🟡 HELD / DEFERRED — decided, waiting on sequence

- **P4-MIN-b** — an emitter at `brainProposeLane:81`. Admissible on the same F-P24 merit; **held so the
  reproduction's observation surface does not change again before the run.** Lands after attempt 2.
- **Option A** — un-gating the DEV-gated refusal surface. **Re-priced: it would put recipient addresses on a
  production screen** (F-P26), so it inherits the PII enumeration on top of its §4 UI-truth tests.
- **FG-13** — `ConnectedAccount.grantedScopes` nullable, so UNKNOWN is distinguishable from genuinely-empty. P0
  traded a fail-open lie for a fail-closed conflation; this closes the honesty half.
- **F-P25** — `verify-freeze.sh` conflates "a frozen surface changed" with "the baseline is behind HEAD".
- **F-P32** — the 2026-08-07 legacy document block (24 files, one commit, never revised) **ESCALATED**; see §11.
- **Containment** — `certification/CONTAINMENT-PROCEDURE.md` now exists but carries **UNKNOWN** steps.

## ⚠️ HAZARDS — commands that destroy something irreplaceable

- **`npm run dev:desktop` overwrites `apps/desktop/out/`** — `electron-vite` declares no `outDir`. That directory
  holds the **22:18 artifact attempt 2 runs against**. Custody copy at
  `~/NeuroPause-S54-r3-evidence/artifact-2218/` (manifest `b3c7a899…5e79fad`); restore from it rather than
  rebuilding, because a rebuild is a different artifact.
- **The prod database has no landed backup path** (S18's pgBackRest/restore-drill is not built). A verified dump
  is in custody at `~/NeuroPause-S54-r3-evidence/prod-db-backup/` (`e5c36a1e…86feb5c`) — **that is a snapshot, not
  a backup system.**

## 📋 STANDING PROCESS RULES EARNED THE HARD WAY

- **NO OPERATOR-IN-THE-LOOP STEP AT THE END OF A LONG SITTING.**
- **A STATED PRECONDITION WITHOUT A CHECK IS NOT A PRECONDITION.**
- **INSTRUMENTED SILENCE IS EVIDENCE; UNINSTRUMENTED SILENCE IS NOT.**
- **UNLOCATED ABSENCE IS NOT EVIDENCE.**
- **UNIFORMITY IS NOT CORROBORATION** — a sweep whose every row returns the same answer is as likely broken as uniform.
- **AN UNRESOLVED CONTRADICTION IS A FINDING, NOT A DEFECT TO BE SMOOTHED.**
- **RECORD SUPERSEDES RECOLLECTION** — including for procedures (F-P27).
- **A SAFETY GATE MUST TEST THE EXACT DANGEROUS STATE, NOT A CORRELATED SIGNATURE** (F-P29).
- **HONEST LABELS, NOT SAFE LABELS** — a pessimistic label the evidence contradicts is still a wrong label.
- **AN UNVERIFIED BACKUP IS NOT A BACKUP** — read the rows back out of the archive; an exit code is not evidence.
- **INSTRUMENTED SILENCE IS EVIDENCE ONLY IF THE INSTRUMENT CAN REACH THE SINK** (F-P35).

## ⏭️ NEXT

**THE SEVERITY GATE — the operator's to run, not Claude's.** Which of the ~34 findings are ship-blocking, which
are record-only, and **what the exit criteria are.** The findings programme has never had exit criteria, and that
— not any individual defect — is what stands between this and a finished product.
