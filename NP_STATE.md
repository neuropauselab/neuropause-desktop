# NP_STATE.md — operational state (read after CLAUDE.md, before work)
Living, TRACKED working doc (committed each slice; excluded from the freeze source spec — see DECISIONS.md D-5). Mirror of CLAUDE.md §1 with operational detail.

## Now
- HEAD `eddb325` · FREEZE INTACT (`BASELINE-1dbef0d5bbdf`) · branch `cert/data-import-cst-integration`.
- Suites (RUN against BASELINE-43dfbe3ff6f7): full main **8724/3 skipped** (823) · real-Electron e2e **13/13** (guard inert in mock mode) · guard+mode pins **16** · typecheck + lint clean · `verify-e2e-strip.sh` PASS (seed + guard absent from release).
- Landed: Slices 1–14 + **S15 EXECUTED**. S14 = real-Electron governed-loop e2e (mock Graph). S15 = first REAL send ATTEMPT at the operator's keyboard: **AUTHORIZED ✓ · SUBMITTED ✓ (Graph 202/ACKNOWLEDGED) · EXTERNALLY OBSERVED = PENDING** (automated read-back blocked by macOS Keychain, F-3). One email to the operator's own address; latch spent. FG-4 also fired live on a non-allowlisted attempt (negative proof). Profile-isolation guard landed (`996958d`, `--user-data-dir` required). Evidence: `…SLICE-15-FIRST-REAL-SEND-EVIDENCE.md`.
- **Slice 16 — DONE: FIRST VERIFIED_SUCCESS in product history.** Real in-session run (2026-08-18T13:25:54Z): TERMINAL=VERIFIED_SUCCESS, internetMessageId `<PN2P287MB1597…@…PROD.OUTLOOK.COM>`, bounce=none, attempts=1, corroborated Sent Items match. `verifyEffect` (17 pins incl. fault injection) + `m365ReadBack` + `s16VerifyRun`. No FG-5 (D-10); verify-e2e-strip PASS. Artifacts in `certification/s15-artifacts/`.
- **Slice 17 — FG-6 LANDED + renderer wall-kill (in progress; e2e unconfirmed).** Honest `local` AuthStatus + device-local principal via **FG-6** (token honored; INTACT #1 `BASELINE-3f19fb707fa0` → INTACT #2 `BASELINE-43238f789694`; then re-record at renderer `BASELINE-1dbef0d5bbdf`). `resolveGovernedActor` (`local:<id>` self-disclosing/forgery-denied/no-strip, S33 edge pinned) + `sessionEmailFor` (`local-<id>@device.invalid`, invalid-by-rule) + `localPrincipalStore` (INSTALL_GLOBAL, backup-registered). App.tsx `local` branch → full shell + `LocalModeBanner`. Suites: main **8766/3** (828) · UI **257** (35) · typecheck+lint clean · verify-e2e-strip PASS. DECISIONS D-11/D-12; CLAUDE §4 AuthStatus-exhaustiveness standing rule. **`local-mode.spec` GREEN 5/5** + **graceful cloud-absence LANDED** (`useIsLocalMode`/`CloudUnavailableLocal`/`LocalModeConnectProvider`; Org/Store/Devices/Billing show honest absence, not the "Sign in to manage…" red banner; semantic/livesync/license already graceful). UI 259 · typecheck+lint clean. **S17 CLOSED** (DoD walked in evidence). **F-S17-1** → S39.
- **BRAIN-1 CLOSED (①②③④, non-frozen, no FG gate; TEST-VERIFIED).** + CLAUDE §3 standing rule: any renderer-touching commit runs the FULL main suite (never the ui glob alone). §5 amendment draft revised to v2 (five-field acceptance standard per layer + Environment-Intelligence rules + canonical preamble) — awaiting approval. ① hostile-adapter CI gate (draft model gains no authority). ② `ai/brain/mailDraftGateway.ts` (model → zod → 1 repair → referenceDrafter fallback). ③ assistantService via `servingDraftMailer()` (reference-only). ④ `draftEval.ts` harness + eval report (honest zero-model baseline, 0 candidates) + DECISIONS D-13 + badge (names a model only when one serves) + LiteLLM reserved. Fixed a latent S17 `cssTokens` failure (LocalModeBanner `--surface`). Full main **8784/3** · UI **259** · typecheck+lint clean. Draft lane serves `referenceDrafter` until eval clears + operator go.
- **S34a — Queryable Action Record CLOSED (FG-5; TEST-VERIFIED).** `connectors/actionRecord.ts` + ONE gated observer line in frozen `connectors/index.ts` (INTACT #1 `322115041eeb` → INTACT #2 `8f0f1e137d3f`). Best-effort observer, never blocks the send; chain + fingerprints + `recordVerification`; tenant-isolated `query`. 13 tests (all 8 closing proofs + query proof + observer invariant). Full main **8796/3** · UI **259** · verify-e2e-strip PASS. Scope-fenced.
- **S19 — Counter truth CORE CLOSED (F-5 in logic; TEST-VERIFIED, non-frozen).** Definition pass first; five states (`connectors/m365WriteStates.ts`) derived from the single S34a `ActionRecord` store (no parallel counting). F-5 reproduced (old counter 0/never) + made truthful (7 tests). **Gated remaining:** the display swap touches FROZEN `ConnectorSyncSnapshot` → an FG gate to show the five states in `M365WritePanel` (presented, not silent; panel still shows the old number until then). **Next:** §5 amendment review (hard stop). **Deferred (operator keyboard):** S15 containment — revoke consent + delete app registration + `rm -rf ~/Library/Application Support/NeuroPause-S15` (evidence copied out).

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
