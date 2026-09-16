# SEAM-22 · FIRST PRODUCTION-WIRED VERIFICATION — RUN PLAN (PREPARED, NOT EXECUTED)
**23 Aug 2026 · ⛔ EVERY step marked OPERATOR-ACTION is a standing human gate (CLAUDE.md §3: real credentials/consent, any real external send). This plan creates no effect and authorizes nothing.**

## PURPOSE
Flip, with ONE controlled governed send, the two facts the shipped product has never produced:
- `reconciliation/readBackReconciler` reachability: **POSSIBLE → PROVEN** (F-P45 §19 item 2, `productionWired`, flips only on a real run — never by hand);
- `EXTERNALLY_OBSERVED` **0 → 1** in the five-state funnel, derived from the store, displayed by the panel,
  and reconstructed by the new independent read-back (`reconciliation/readBack.ts`).

**This is NOT the NP-000 ceremony.** The L6 ceremony HOLD stands untouched; this run is S15-class
(operator-at-keyboard governed send), not a brain-proposed action.

## PRECONDITIONS (all OPERATOR-ACTION unless marked MACHINE)
1. M365 consent chain re-established — the S16 containment REVOKED consent and deleted the app
   registration, so a new app registration + consent is required (⛔ credentials/OAuth gate).
   Mail.Read must be granted for the read-back oracle (S16 precedent: no re-consent was needed then;
   verify scopes at connect time).
2. A connected M365 account whose mailbox the operator owns; recipient = the operator's own address
   (allowlist discipline of S15; FG-4 latch semantics are compile-stripped from release — this run uses
   the ordinary governed path, not the first-send guard).
3. The app launched on a dedicated profile (`--user-data-dir`, per the S15 profile-isolation guard),
   release-grade or dev per the operator's choice — recorded either way.
4. MACHINE: reconciler registered via serviceManager (already true, F-P39 closure), tick = 60 s.
5. MACHINE: pre-run snapshot of `action-records.json` (absent or counts recorded).

## TARGET / ACTION / EXPECTED
- ACTION: one `mail.send` through the certified path (panel confirm = the C3 approval), subject chosen
  by the operator, recipient = operator's own address.
- EXPECTED EFFECT: one email; Graph 202 ⇒ outcome ACKNOWLEDGED; `executed: true`; ActionRecord row
  appended (workspace-keyed, F-P45 accommodation).
- EXPECTED OBSERVATION/VERIFICATION: within ≤ ~2 reconciler ticks, `recordVerification` attaches
  `VERIFIED_SUCCESS` with provenance `m365ReadBack:sentItems+inbox`, `effectTime` = provider
  `sentDateTime` verbatim; D1 interval `requestTime ≤ effect ≤ at` within the 120 s width bound.
- PROOF SURFACES (MACHINE): the M365 panel's five states read 1/1/1/1/**1**; `readBack(ws, {transitionId})`
  reports FINAL_STATUS `VERIFIED_SUCCESS` with the full timeline; the reconciler log records one
  reconciliation pass with `considered ≥ 1`.

## STOP CONDITIONS
- Any DENY/HOLD at confirm → stop, read back, report — do not retry blindly.
- UNKNOWN after 5 ticks → leave HELD (HOLD is terminal to the reconciler; §2 #9 — never promote by hand);
  report with the reconciler's typed reason.
- Any second send is OUT OF SCOPE for this plan (one action, at-most-once).

## ROLLBACK / RECOVERY
- The email is to the operator's own mailbox — reversal = delete the message (outside governance, noted).
- Evidence rows are append-only and are NOT deleted under any outcome (evidence-deletion is a standing
  hard stop). A failed run leaves honest rows (that is the system working).

## EVIDENCE LOCATION
`<profile userData>/action-records.json` (the run's rows) · reconciler log lines · panel screenshot ·
a `readBack` report transcript — to be filed as
`certification/source-update/SEAM-22-FIRST-PRODUCTION-VERIFICATION-EVIDENCE.md` after the run,
labelled LIVE-VERIFIED only for what the provider actually corroborated (§2 #14: send-corroboration,
never delivery).

## AUTHORIZED OPERATOR
The run executes only when the operator personally performs steps 1–3 and the confirm click.
**Claude never supplies credentials, consent, confirmation, or the send.** This document is the plan;
its execution is not scheduled by it.
