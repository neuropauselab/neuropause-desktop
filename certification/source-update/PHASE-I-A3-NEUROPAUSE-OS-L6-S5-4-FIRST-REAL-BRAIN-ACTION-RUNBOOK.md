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

## THE CEREMONY (step by step — operator drives; Claude directs, never sends)
1. **Pre-flight.** Fresh registration + consent (op). Env wiring. Isolated profile (`--user-data-dir=…/NeuroPause-S54`).
   Allowlist = op's own address. Latch armed. Confirm `verify-freeze` INTACT and suites green.
2. **Brain proposes.** The app composes the real tenant's `LiveBrainState`, evaluates the purpose, `buildProposal` emits a
   certified `Proposal` (recipient = the op's own address, from the operator's mandate — S13 literalism, never from
   evidence). `admitForExecution` → `ADMIT_FOR_ASK`.
3. **ASK.** The confirm panel shows the eight `brainReview` fields VERBATIM (FG-9). The operator reads them. **Expiry is
   enforced at confirm** — an expired proposal is not confirmable.
4. **Human confirm.** The operator clicks confirm on the existing panel (the ONLY thing that sets `confirmed`). CST binds
   the exact params (recipient included) — a post-approval substitution is BINDING_MISMATCH, fail-closed.
5. **Governed execution (at-most-once).** Admission → the FG-4 guard checks allowlist + latch (writes the latch) →
   `governedSend` → REAL Graph 202. If the guard's allowlist/latch fails → HARD-FAIL, no send.
6. **Independent read-back.** `verifyEffect` polls Sent Items (recipient + subject + timestamp corroboration, never id
   alone) and the Inbox for a bounce; terminal = VERIFIED_SUCCESS | VERIFY_FAILED | (UNKNOWN → HOLD). Capture the
   `internetMessageId`.
7. **Evidence attaches.** `recordVerification` writes the terminal to the ActionRecord; `m365WriteStates` moves to
   EXTERNALLY_OBSERVED only on VERIFIED_SUCCESS. Copy all artifacts out.
8. **Containment.** Operator revokes consent + deletes the app registration + `rm -rf` the S5.4 profile (evidence copied
   out first). The latch is spent; a further real send is a fresh deliberate decision.

## HARD STOPS (non-negotiable)
- No real send until prerequisites 1–4 are all met. Claude never supplies credentials, never grants consent, never clicks
  confirm, never sends. One email, to the operator's own address, single-send, no retry.
- If ANY step diverges (guard fires unexpectedly, read-back UNKNOWN, latch already spent), STOP — UNKNOWN → HOLD →
  reconciliation, never a retry, never a claimed success.

## STATUS: ⛔ HELD
S5.4 is **not executable today** — **PHASE 0 (the running-app mock proof) is not built.** The ceremony (real contact)
never begins before Phase 0 is green in the running app AND the registration/consent/allowlist prerequisites are met AND
the operator gives an explicit go. Awaiting the operator's direction on whether to build **PHASE 0** next
(report-and-continue, mock-only, presenting FG gates for any frozen touch).
