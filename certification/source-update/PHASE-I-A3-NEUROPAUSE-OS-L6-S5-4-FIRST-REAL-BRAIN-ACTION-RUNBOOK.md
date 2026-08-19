# OS-track L6 · S5.4 · FIRST BRAIN-PROPOSED REAL ACTION · RUNBOOK ⛔ (awaiting explicit operator go)

> Preamble (standing): The intelligence proposes. The governance decides. The execution layer acts. The independent
> verifier proves. The Action Record remembers.

**This is a HARD STOP.** S5.4 is the first time a Live-Brain (L6) proposal drives a REAL external effect. It is its own
ceremony — human at the keyboard, one email to the operator's own address, single-send, no retry. **No real contact
happens until every prerequisite below is met AND the operator gives an explicit go.** This document is presented for
review; nothing is executed.

## What S5.4 proves (and does not)
Proves, once: the WHOLE governed chain is alive end to end for a Brain-proposed action — Brain state → proposal → ASK
(human confirm) → CST → admission → certified executor → REAL Graph send → independent read-back → the five-state panel
moves to EXTERNALLY_OBSERVED. Does NOT prove: destination delivery (send-corroboration ≠ delivery, §2#14); any second
capability; any autonomy.

## ⚑ PHASE 0 — RUNNING-APP MOCK PROOF (FIRST; before ANY ceremony step; NO real contact)
Before a single real-contact step, the WHOLE circle is demonstrated **IN THE RUNNING APP, in mock**:
- **Wire** L6's certified proposal into the REAL propose → confirm → CST → admission → `governedSend` path: the propose
  handler populates `brainReview` (FG-9) from a certified `Proposal`; `admitForExecution` gates the ASK; the confirm panel
  renders the eight review fields; confirm → CST binds → admission → a **MOCK** executor → **MOCK** read-back →
  `recordVerification` → the five-state panel moves.
- **Prove it end to end in the real-Electron harness** (extending the S14 harness), with VERIFIED_SUCCESS / VERIFY_FAILED /
  HOLD each exercised in the running app. Wire the production read-back (`s16VerifyRun` is E2E-gated today) so
  `ActionRecord.verification` is populated (§2#14).
- **Any frozen touch (IPC channels/contracts) → an FG gate presented and honored FIRST.** (The Brain propose flow may
  reuse the FG-9 `brainReview` field + the existing `capability:m365.propose` channel; a new trigger channel would be a
  new FG gate.)
- Phase 0 is MOCK (no real contact) → it proceeds report-and-continue; it is the hard **PRECONDITION** for the ceremony.

**No real contact until Phase 0 has demonstrated the whole circle in mock in the running app. It is NOT built yet.**

## PREREQUISITES FOR THE CEREMONY (real contact — all required, each its own gate)
1. **Phase 0 complete** — the running-app mock proof above, green.
2. **Fresh app registration + consent (operator, at the keyboard).** The S15 registration was deleted (containment
   complete). A NEW Azure app registration is created and consented by the operator; the operator supplies credentials.
   Claude never handles credentials or consent (prohibited).
3. **Allowlist + latch renewed (FG-4).** The `firstRealSendGuard` is armed: recipient allowlist = the operator's OWN
   address (`neuropause033@gmail.com`), all fields allowlisted, a single-send latch (at-most-once), no retry storm. Inert
   unless `NEUROPAUSE_FIRST_REAL_SEND=1`. Profile-isolation guard (`--user-data-dir`, HARD-FAIL on the default profile).
4. **Operator's explicit go**, in their own words, after reviewing this runbook.

## THE CEREMONY — FINAL CHECKLIST (execution order; each step marked OPERATOR-ACTION vs MACHINE-ACTION)
Presented 19 Aug 2026 on the operator's directive after Phase-0 acceptance. OPERATOR = only the human at the keyboard may
perform it; MACHINE = the governed runtime performs it, observed by the operator; Claude Code performs NONE of the
OPERATOR steps and never triggers a MACHINE step that makes real contact.
1. **Pre-flight — OPERATOR.** Create the fresh Azure app registration + grant consent (the S15 registration is deleted;
   containment complete). Wire env. Launch on an ISOLATED profile (`--user-data-dir=…/NeuroPause-S54`; the guard
   HARD-FAILS on the default profile). Confirm the FG-4 allowlist = the operator's OWN address
   (`neuropause033@gmail.com`), single-send latch armed, `NEUROPAUSE_FIRST_REAL_SEND=1`, no retry. Confirm
   `verify-freeze.sh` INTACT + suites green (read-only checks; Claude may direct, never supply credentials/consent).
2. **Brain proposes — MACHINE.** The app composes the real tenant's `LiveBrainState`, evaluates the purpose,
   `buildProposal` emits a certified `Proposal` (recipient = the operator's own address, from the operator's mandate —
   S13 literalism, never from evidence). `admitForExecution` → `ADMIT_FOR_ASK`. Nothing external is contacted.
3. **ASK — MACHINE shows, OPERATOR reads.** The confirm panel renders the eight `brainReview` fields VERBATIM (FG-9).
   The operator reads every field. **Expiry is enforced at confirm** — an expired proposal is not confirmable.
4. **Human confirm — OPERATOR.** The operator clicks Confirm on the existing panel (the ONLY thing that sets
   `confirmed`). CST binds the exact params (recipient included) — a post-approval substitution is BINDING_MISMATCH,
   fail-closed. Claude never clicks this.
5. **Governed execution (at-most-once) — MACHINE.** Admission → FG-10 L6 gate (re-derivation) → FG-4 guard checks
   allowlist + latch (writes the latch) → `governedSend` → REAL Graph 202. Any guard failure → HARD-FAIL, no send, STOP.
6. **Independent read-back — MACHINE.** `verifyGovernedSend`/`verifyEffect` polls Sent Items (recipient + subject +
   timestamp corroboration, never id alone) + the Inbox for a bounce; terminal = VERIFIED_SUCCESS | VERIFY_FAILED |
   (UNKNOWN → HOLD, never auto-promoted). Capture the `internetMessageId`.
7. **Evidence attaches — MACHINE, OPERATOR copies out.** `recordVerification` writes the terminal to the ActionRecord;
   `m365WriteStates` moves to EXTERNALLY_OBSERVED only on VERIFIED_SUCCESS. The operator copies all artifacts out.
8. **Containment — OPERATOR.** Revoke consent + delete the app registration + `rm -rf` the S5.4 profile (evidence copied
   out FIRST). The latch is spent; any further real send is a fresh deliberate decision.
9. **THE GO — OPERATOR, the final line.** No step of this checklist executes until the operator has reviewed it and
   given an explicit go in their own words. Silence is not consent; enthusiasm is not consent.

## HARD STOPS (non-negotiable)
- No real send until prerequisites 1–4 are all met. Claude never supplies credentials, never grants consent, never clicks
  confirm, never sends. One email, to the operator's own address, single-send, no retry.
- If ANY step diverges (guard fires unexpectedly, read-back UNKNOWN, latch already spent), STOP — UNKNOWN → HOLD →
  reconciliation, never a retry, never a claimed success.

## STATUS: ⛔ HELD — PHASE 0 COMPLETE (operator-accepted); FINAL CEREMONY CHECKLIST PRESENTED
**Phase 0 is GREEN and accepted (operator, 19 Aug 2026):** brainReview live in the confirm panel · FG-10 execution-time
re-derivation in the certified path · the read-back orchestrator READ-ONLY and severed from the old latch · mock-Graph
read-back · release strip PASS · the REAL Electron app demonstrating ALL THREE terminals with HOLD never promoted
(`…L6-S5-4-P0-READBACK-CIRCLE-EVIDENCE.md`, verbatim completion claim inside). **Prerequisite 1 is met; prerequisites
2–4 are the operator's alone.** The FINAL CEREMONY CHECKLIST (the Ceremony steps above, in execution order, each marked
operator-action vs machine-action) has been presented to the operator. **The HOLD is absolute: nothing executes until the
operator walks the checklist and gives an explicit go as its final line. Claude never supplies credentials, consent,
confirmation, or the send.**
