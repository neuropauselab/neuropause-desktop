# Phase I-A.3 — NeuroPause OS — Five-User Internal Acceptance

**This document is NOT pass evidence. No real users were run. It records the acceptance DESIGN and an honest
NOT-EXECUTED result.** Producing this as PASS would violate the gate rule ("Do not create this as PASS evidence
unless the five users actually completed the scenarios"). Labels: `[NOT EXECUTED]` `[BLOCKED-ENV]` `[DESIGN]`.

## Why NOT EXECUTED `[BLOCKED-ENV]`
Five-user internal acceptance requires: (a) a **signed + notarized pilot artifact** built from the pilot commit
`634c9b7`; (b) a **clean/disposable machine** (not the developer working copy); (c) **five real internal users**
each driving a declared scenario without developer terminal access. None of these can be provided in the current
environment (no signing/notarization credentials, no disposable VM, no recruited users). Per gate discipline, the
result is recorded as NOT EXECUTED — not simulated, not fabricated.

## Acceptance design (scenarios ready to run) `[DESIGN]`
| User | Scenario | Declared workflow | Acceptance criterion |
|---|---|---|---|
| U1 | Normal success | login → AI request → governed M365 action → approval → effect → evidence | completes without developer intervention; sees **ACKNOWLEDGED** (never VERIFIED_SUCCESS) |
| U2 | Approval | request → approval required → approve → execute → observe | understands why approval is required; completes it |
| U3 | Denial | request → denied → inspect reason → continue safely | no unintended external effect; reason is clear |
| U4 | UNKNOWN / hold | uncertain outcome → hold → inspect → reconcile → resolve | understands **UNKNOWN ≠ SUCCESS**; does not blindly retry |
| U5 | Restart / recovery | execute → restart → reopen → inspect history → continue | evidence + state remain understandable; no duplicate effect |

## Data to capture per user (when executed) `[DESIGN]`
scenario · start/end time · task completed? · developer assistance? · error/failure mode · outcome · evidence ·
understood outcome/hold/approval/denial? · could recover? — using internal test identifiers only (no unnecessary PII).

## Result
- USER 1 — **OPEN / NOT EXECUTED**
- USER 2 — **OPEN / NOT EXECUTED**
- USER 3 — **OPEN / NOT EXECUTED**
- USER 4 — **OPEN / NOT EXECUTED**
- USER 5 — **OPEN / NOT EXECUTED**

**Overall: 0 / 5.** Five-user acceptance is **NOT claimed**. NeuroPause OS is **NOT PILOT-VALIDATED**.

## Next step
Run this design on a real pilot environment with a signed+notarized `634c9b7` artifact and five internal users;
fill the table with executed evidence; then update the pilot decision in the pilot-readiness evidence document.
