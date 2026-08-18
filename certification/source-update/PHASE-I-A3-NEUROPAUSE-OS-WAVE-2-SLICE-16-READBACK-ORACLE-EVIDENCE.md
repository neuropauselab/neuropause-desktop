# SLICE 16 — Read-back verification oracle · EVIDENCE

**Status: MOCK-PROVEN (oracle + fault injection); the first REAL VERIFIED_SUCCESS is the operator's in-session run
(pending).** No frozen surface touched (no FG-5 — DECISIONS D-10). FREEZE INTACT.

## What landed
- **`verifyEffect` (pure oracle, non-frozen).** EXECUTED_ACK → VERIFY_PENDING → VERIFIED_SUCCESS | VERIFY_FAILED;
  UNKNOWN → HOLD. Terminal = SUCCESS | FAILED; **HOLD (UNRESOLVED) never auto-promotes** (uncertainty is never success).
  Match (condition 7): internetMessageId + recipient + subject/body fingerprint + timestamp window — **corroborated,
  never the id alone** (the 202 carries no id; the id exists only via read-back and must be cross-checked). Bounded
  backoff; a bounce/NDR is checked before success; **idempotent** (a prior terminal is returned without re-reading —
  no effect re-run, truth never flipped).
- **`m365ReadBack` (in-session reader, non-frozen).** READ-ONLY GET of Sent Items + Inbox of the own mailbox, decrypting
  the vault token where the operator's session unlocks it (D-10). Never sends, never mutates.
- **`s16VerifyRun` (compile-gated in-session runner).** `__NP_E2E__` + `NEUROPAUSE_VERIFY_S15=1` — structurally absent
  from release (`verify-e2e-strip` PASS; present in the e2e build). Builds the target from the spent latch + the
  operator's subject, runs the oracle, and LOGS the terminal state + the observed internetMessageId.

## Proofs (RUN against BASELINE-5bfe448ac6b3)
- `verifyEffect.test.ts` — **17 pins**: corroborated match / never-id-alone (wrong recipient/subject/timestamp/id all
  rejected even with a matching id; corroborates without id for the 202 case); NDR detection + reason code; VERIFIED_SUCCESS
  / VERIFY_FAILED / UNKNOWN→HOLD; bounded backoff; idempotent; **fault injection** — dropped execute response → HOLD →
  later resolves to VERIFIED_SUCCESS, or to VERIFY_FAILED on a bounce (never a false success).
- Full main **8743 passed / 3 skipped** (824 files); typecheck + lint clean; `verify-e2e-strip` PASS.

## Architecture (DECISIONS D-10)
The oracle runs IN the operator's live session (main process), because the OAuth token is keyed to that session's
Keychain (S15 F-3: an unattended process reports `isEncryptionAvailable:true` but cannot decrypt). Verification STATE is
a separate NON-frozen concern — no frozen admission field, so **no FG-5**.

## THE FIRST REAL VERIFIED_SUCCESS — operator's in-session run (pending)
Run in the operator's session (S15 profile), against the real S15 message:
```bash
cd apps/desktop
NP_E2E_BUILD=1 npx electron-vite build   # if not already built
NEUROPAUSE_S15_APPPRINCIPAL=1 NEUROPAUSE_FIRST_REAL_SEND=1 NEUROPAUSE_VERIFY_S15=1 \
  NEUROPAUSE_VERIFY_SUBJECT="NeuroPause S15 first real send, 18 Aug 2026" \
  npx electron --user-data-dir="$HOME/Library/Application Support/NeuroPause-S15" out/main/index.js
```
It sends NOTHING (the latch is spent; the guard would DENY anyway). It only reads back. Then in
`$S15_PROFILE/logs/app.log` find:
```
[NEUROPAUSE_S16_VERIFY_v1] TERMINAL=VERIFIED_SUCCESS internetMessageId=<...> bounce=none attempts=N — …
```
Paste that line and Claude records the FIRST VERIFIED_SUCCESS in product history + the full match tuple into the S15/S16
evidence — the terminal truth, never inflated.

## Remaining
- **Real in-session run** (above) → the first VERIFIED_SUCCESS + internetMessageId.
- Real-Electron e2e extension (VERIFY_PENDING → VERIFIED_SUCCESS on mock Sent Items) — the unit oracle + fault injection
  already prove the machine; a mock-Graph e2e assertion is a further integration proof.
- **Containment executes ONLY after the oracle records a real terminal outcome** (revoke consent + delete app + delete
  the S15 profile) — deferred.
