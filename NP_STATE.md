# NP_STATE.md — operational state (read after CLAUDE.md, before work)
Living, TRACKED working doc (committed each slice; excluded from the freeze source spec — see DECISIONS.md D-5). Mirror of CLAUDE.md §1 with operational detail.

## Now
- HEAD `f254f2d` · FREEZE INTACT (`BASELINE-9f4d36abed4e`) · branch `cert/data-import-cst-integration`.
- Suites (RUN against BASELINE-9f4d36abed4e): full main **8708/3 skipped** (821) · UI **254** (34) · real-Electron e2e **13/13** · typecheck + lint clean · `verify-e2e-strip.sh` PASS.
- Landed: Slices 1–14. **Slice 14 COMPLETE — the loop closes at the real-application level (mock Graph):** a launched Electron app drives NL turn → intent → proposal → human confirm → certified executor → mock Graph → ACKNOWLEDGED, + hostile-context and ambiguity negatives. NON-frozen throughout: compile-stripped, double-gated e2e seed (`__NP_E2E__` + `NEUROPAUSE_E2E=1`) + global-fetch mock (avoids frozen `connectors/index.ts`; D-8). TEST-VERIFIED, NOT LIVE.
- **Next: Slice 15 — first REAL email ⛔ human at keyboard.** Runbook prepared (`…SLICE-15-FIRST-REAL-SEND-RUNBOOK.md`). HARD STOP before real credentials / OAuth / real send.

## Change-control trail (S14)
```
9f4d7dd  freeze re-record — foundation INTACT
8c72836  alive(s14): e2e seed + mock-Graph seam (structurally absent) + verify-e2e-strip.sh
caac9c0  alive(s14): dispatch-vs-compose intent + assistant asks on ambiguity
0be757b  alive(s14): real-Electron governed-loop e2e (mock Graph) — S14-A/B/C green
f254f2d  fix(s14): seed uses authService.setStatus (renderer leaves the sign-in wall)
ef9c9f0  freeze re-record — INTACT (BASELINE-9f4d36abed4e)
```

## Next 3 steps
1. **S15 — first REAL email ⛔ human at keyboard.** Runbook prepared. HARD STOP before real credentials / OAuth / real send. The compiled-in recipient-allowlist guard lands here (gated if it must sit in a frozen send path).
2. S16 — read-back verification oracle (`internetMessageId` poll → VERIFIED_SUCCESS | UNKNOWN → HOLD). First `VERIFIED_SUCCESS` only here.
3. S17 — local-first (kill the sign-in wall); S34 — universal action-trace (a queryable admission record; none today).

## Wired this slice (S14)
- Real-Electron e2e harness (`e2e/mailSend.e2e.cjs`) drives the full governed loop in a launched app against a mock Graph.
- Compile-gated e2e seed (`src/main/e2e/e2eSeed.ts`) — fake principal + governed account + global-fetch mock; double-gated, structurally absent from release (`verify-e2e-strip.sh` PASS); `-e2e` version/title stamp.
- Generator refined: dispatch vs compose (drafting no longer hijacked); assistant asks on ambiguity.

## Honest status
Everything to date is **TEST-VERIFIED**, not LIVE. One connector (M365) has a governed consequential path; nothing executes without human confirmation; nothing external is effect-verified yet (Profile A). Backend down/empty; builds unsigned; NOT CERTIFIED (13C).
