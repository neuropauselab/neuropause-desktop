# OS-track L6 · S5.3 · THE FULL MOCK LOOP · EVIDENCE

> Preamble (standing): The intelligence proposes. The governance decides. The execution layer acts. The independent
> verifier proves. The Action Record remembers.

**Status: S5.3 LANDED — TEST-VERIFIED, non-frozen. MOCK-ONLY, ZERO real contact.** The whole chain is wired through the
REAL modules with the external boundaries mocked. FREEZE INTACT. **⛔ HARD STOP after S5.3 — the S5.4 real-send is its own
ceremony (fresh registration + consent + allowlist/latch renewed + explicit operator go); nothing here builds toward it.**

## Honest scope (what this is, and is not)
S5.3 is a full-loop **INTEGRATION test** (`s5MockLoop.test.ts`) that wires the REAL modules end to end —
`composeLiveBrainState → buildProposal → admitForExecution → actionRecord.observe → verifyEffect → recordVerification →
m365WriteStates` — with the ONLY mocks at the external boundaries (the executor result + the Graph reader). It proves the
CHAIN works deterministically with zero real contact. It is **NOT** a Playwright real-Electron UI e2e: that requires the
PRODUCTION WIRING (the L6 chain into the running app — the propose handler populating `brainReview`, the panel, the confirm
channel), which does not exist yet and is a larger integration (the production call-site + likely more frozen IPC → FG
gates). That real-Electron UI e2e is the remaining step, recorded here and NOT claimed as done.

## The loop, exercised (each an assertion)
| step | REAL module | mocked? |
|---|---|---|
| Brain state | `composeLiveBrainState` | no |
| certified proposal | `buildProposal` | no |
| ASK (human MUST confirm) | `admitForExecution` → `ADMIT_FOR_ASK` | no |
| [human confirm] | simulated | — |
| executor → ActionRecord | `actionRecord.observe` (real store, temp dir) | executor RESULT mocked |
| read-back | `verifyEffect` (real oracle) | Graph reader mocked |
| verification attaches | `actionRecord.recordVerification` | no |
| five-state derivation | `m365WriteStates` / `deriveWriteStates` | no |

## Failure is first-class (§2#9) — all three outcomes exercised
- **VERIFIED_SUCCESS** — a corroborating Sent Items row → EXTERNALLY_OBSERVED moves (the five-state panel advances).
- **VERIFY_FAILED** — a postmaster bounce (NDR 5.1.1) → recorded, EXTERNALLY_OBSERVED does NOT move (a verified failure is
  never success).
- **HOLD (UNKNOWN)** — neither a match nor a bounce after the bounded backoff → recorded, EXTERNALLY_OBSERVED does NOT
  move (uncertainty is never success).
Each uses the REAL `verifyEffect` corroboration/bounce/backoff logic + the REAL D-16 `isSuccessTerminal` in
`deriveWriteStates` — the states move ONLY on an independently-corroborated success.

## Proofs
`s5MockLoop.test.ts` (4) + full main (**851 files, 8946 passed / 3 skipped**) + typecheck node + lint clean.

## Remaining (before real contact — its own gates)
- The **real-Electron UI e2e** (Playwright) + the **production wiring** (L6 → propose handler → panel → execute), touching
  frozen IPC → **FG gate(s)** — a larger integration slice, NOT done here.
- The **production read-back wiring** (`s16VerifyRun` is E2E-gated today) so `ActionRecord.verification` is populated in
  release, per §2#14.
- **S5.4 · the first Brain-proposed real action** — the ceremony below.

## Live boundary (standing)
M365 `mail.send` is the SINGLE live governed consequential capability. S5.3 makes ZERO external contact; every external
boundary is mocked. No real send exists.
