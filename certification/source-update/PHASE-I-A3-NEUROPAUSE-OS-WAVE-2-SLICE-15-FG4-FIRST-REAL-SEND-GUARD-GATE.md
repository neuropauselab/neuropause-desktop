# FG-4 — first-real-send guard hook (Slice 15 pre-flight) · GATE EXECUTION

**Status: LANDED (guard + mode coupling + FG-4 hook). No real send performed. No credentials, no OAuth, no external
contact.** This is S15 PRE-FLIGHT safety infrastructure — the human executes the real send at their keyboard.

## Token (verbatim)
`AUTHORIZED: FG-4 — connectors/index.ts first-real-send guard hook, compile-stripped, per gate doc`
— granted with seven binding conditions (five in the authorizing message, two in the addendum), all folded in below.

## The frozen diff (the ENTIRE frozen change) — `connectors/index.ts`, landed `b0ac3c5`
```diff
+declare const __NP_E2E__: boolean;
 ...
         if (r.actionId === 'mail.send' && mailSendAction) {
+          if (__NP_E2E__) {
+            const { firstRealSendGuard } = await import('./firstRealSendGuard');
+            const guard = firstRealSendGuard(r.params);
+            if (!guard.ok) return guard.refusal;
+          }
           const g = await governedSend({
```
12 insertions, `connectors/index.ts` only. It NEVER weakens the certified path — governedSend / CST / scopesOk / actor /
admission are untouched; the guard only REFUSES before the executor. `contracts.ts:2418` untouched.

## Run mode: A (app-principal-only) — approved
The app's own login hits the dead backend (local-first is S17). Mode A seeds **only** the app principal; the Microsoft
identity, consent, token, send, and admission are **all real**. A distinct flag `NEUROPAUSE_S15_APPPRINCIPAL=1` (never
`NEUROPAUSE_E2E=1`), same `__NP_E2E__` compile gate + strip proof. The `-e2e` version/title stamp shows the build is
seeded (not a release); evidence discloses: *"app principal seeded (NeuroPause login only, pending S17); Microsoft
identity, consent, token, send, admission: real."*

## The seven binding conditions — how each is met
1. **MODE COUPLING (HARD-FAIL).** `resolveE2eMode` (`e2e/e2eMode.ts`) throws (→ `app.exit(1)` at startup) if
   `NEUROPAUSE_S15_APPPRINCIPAL=1` without `NEUROPAUSE_FIRST_REAL_SEND=1`, or if `NEUROPAUSE_E2E=1` is combined with either
   real-send flag (mock and real are mutually exclusive). Pinned: `e2eMode.test.ts` (6, incl. both HARD-FAILs).
2. **ALL RECIPIENT FIELDS.** The guard parses the SAME normalized params the executor reads (`strArr`/`optStrArr` from
   `actionSdk`): `to` must be EXACTLY the one compiled-in operator address; ANY cc/bcc → DENIED; unparseable → DENIED
   (fail closed). Pinned: `firstRealSendGuard.test.ts` (allowlist / cc / bcc / unparseable / empty / multi).
3. **STRUCTURAL ABSENCE.** The frozen hook DYNAMICALLY imports the guard inside the `__NP_E2E__` branch (the proven
   pattern); zero top-level side effects (lazy latch path — no `app.getPath` at module scope). `verify-e2e-strip.sh`
   extended to assert the guard module + its strings are absent from a release build — **PASS** (0/0/0/0).
4. **LATCH SEMANTICS.** Latch-before-send = at-most-once BY DESIGN: a failed attempt CONSUMES the send; re-running
   requires deliberately deleting `first-real-send.latch`. Pinned: second send → `SINGLE_SEND_LATCH`; the latch is a
   durable file that survives a fresh call (restart). Stated in the runbook.
5. **RUNBOOK ADDITIONS (human side).** Screen-record the whole session (consent→send); capture the exact UTC send time;
   screenshot the received email in the destination inbox (destination-side proof ahead of S16). In the runbook.
6. **EVIDENCE VOCABULARY (addendum).** Report THREE separate outcomes — **AUTHORIZED** (governance passed) ·
   **SUBMITTED** (Graph 202 accepted) · **EXTERNALLY OBSERVED** (independent read-back) — never a collapsed "SUCCESS."
   The experiment is a *single real-send ATTEMPT*, not a "successful send": the latch consumes the attempt even if the
   send fails, by design (condition 4).
7. **S16 MATCH CRITERIA (design ahead; implement in S16).** The read-back oracle matches on **internetMessageId +
   recipient + subject/body fingerprint + timestamp window** — NEVER the id alone. Recorded for S16.

## INTACT bracket + proofs
- `befabe0` INTACT #1 (non-frozen checkpoint `48921e1`) → `b0ac3c5` FG-4 landing → `ad81825` INTACT #2
  (BASELINE-d0a055b3121d). Later de-flake `63ccf62` → re-record `96609d4` (BASELINE-43dfbe3ff6f7). FREEZE INTACT.
- RUN: full main **8724 passed / 3 skipped** (823 files); guard+mode pins **16**; real-Electron e2e **13/13** (guard
  inert in mock mode — `NEUROPAUSE_FIRST_REAL_SEND` unset); typecheck + lint clean; `verify-e2e-strip.sh` **PASS**.

## Certification impact: NONE
The certified path is unchanged; the hook is compile-stripped from release and only refuses. No real send occurred.
The first real send is the human's keyboard gate (S15 runbook + go/no-go checklist).
