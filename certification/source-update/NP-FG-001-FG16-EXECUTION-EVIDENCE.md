# FG-16 EXECUTION EVIDENCE · A.339 / GATE-R.24
### Status: FG16_FROZEN_CONTRACT_REVISION_ESTABLISHED (local commit) · NOT pushed · NOT independently reviewed · end-to-end delivery NOT claimed

## A. TOKEN (A.336, delivered A.338, verified this seam)
- Artifact: `~/Downloads/NP-FG-001-FG16-TOKEN-A336.md` · 2,824 B · SHA-256 `a04848f276e6b7dcc45180e1ba6fba3c68f305cbd31230ae1dd957b426d18dcf` — exact expected match
- Exact token string [historical quote of the issuer act]: `AUTHORIZED: FG-16 — confirmedAt evidence field`
- First-person issuer act of Saurabh Patel (human Grantor/Issuer), RES-001 §5 / HANDOFF-002 item 7 form, N=16; parents NP-FG-001 (LIVE) + NP-FG-001-RES-001 (LIVE-SUBORDINATE); one file · one field · evidence-only; explicit does-not-authorize list intact; `confirmed: boolean` separate; no HCE. Content checks: ALL PASS.

## B. GOVERNANCE
NP-FG-001 = LIVE · NP-FG-001-RES-001 = LIVE-SUBORDINATE · HANDOFF-002 = ADMITTED · **FG-16 = EXERCISED by this seam** (no other FG number touched; no new token; no registry event; registry/ledger mutations 0).

## C. FRESH EXECUTION BASELINE (2026-09-03T20:37:41Z UTC, local clock)
HEAD `1ee56e190041506b6034957495f4981fd2994690` (parent `542f3f6…`), branch `cert/data-import-cst-integration`. contracts.ts PRE: SHA `f61a111d5eb45275ee851f61d0835a38c3683cc330395d2670b3436b4588e854` · 137,406 B · 3,459 lines · CLEAN. lib/ipc.ts at committed A.333 state (`0ae508c1…`). Five governed files at governed baseline. Worktree: only `M certification/baseline.json` (custody, untouched) + the untracked A.324 evidence file. Detectors live: contracts.ts FROZEN/EXIT=2 · lib/ipc.ts PROCEED/EXIT=0. INTACT-before: ALL conditions held.

## D. MUTATION (exactly the token-authorized change)
File: `packages/shared/src/ipc/contracts.ts` · Target: `M365ActionExecuteRequest` · Inserted line (byte-exact, at line 490, after `correlationId`, before `});`):
`  confirmedAt: z.string().datetime({ offset: true }).optional().catch(undefined),`
1 file · 1 insertion · 0 deletions. Canonical diff: 636 B · SHA-256 `106636cb40035ff5f04f6003094d1c58f4a78ac4954011340be95404bf78fccb` (byte-identical to the pre-presented reviewed diff). POST: SHA `8482ef0facf20e6f13ddab4f0176d4055462769ad582530a21a7164a4d8954ae` · 137,488 B · 3,460 lines. Adversarial scope/fidelity verifier: PASS (single occurrence, byte-compared; no import/comment/strictness/field-order change; all other governed files clean; fg14 byte-pin regex re-matched post-edit).

## E. SEMANTIC VALIDATION (REAL contract, out-of-repo vitest fixture, 9/9, exit 0)
valid Z + valid offset → retained verbatim · absent → key absent · malformed ("five minutes ago", date-only) → success, undefined · number → success, undefined · empty "" → success, undefined · correlationId-only → no promotion into confirmedAt · both present → independent, verbatim. Nuance recorded honestly: soft-failed cases carry key-present-with-undefined (catch behavior); genuine absence carries no key — downstream honest-absence storage belongs to the actionRecord follow-on seam.

## F. REGRESSION (existing checks only; no test files modified)
typecheck @neuropause/shared EXIT=0 · typecheck @neuropause/desktop EXIT=0 · eslint contracts.ts --max-warnings 0 EXIT=0 · targeted fg14CausalIdentity + actionRecord suites 34/34 · full main suite 10,218 passed / 7 skipped / 2 failed — both failures are the PRE-EXISTING Gate-27 paused-release guards in releaseDiscipline.test.ts (spent rc.24 tag / stale changelog; identical at S76/S80), not regressions · full UI suite 455/455.

## G. COMMIT (isolated, local)
Commit `643be8fab16c011328fae777749dd78a47c9e0f5` · parent `1ee56e190041506b6034957495f4981fd2994690` (= pre-commit HEAD) · contents: exactly `packages/shared/src/ipc/contracts.ts`, 1 insertion, 0 deletions · committed file SHA = post-edit SHA (`8482ef0f…`, zero worktree diff vs HEAD) · `1ee56e19` remains ancestor · staged-path check before commit: exactly one path. Reversibility (evidence only, not executed): `git revert 643be8f`.

## H. NON-EFFECTS
registry 0 · governance 0 · push 0 (28 local commits remain unpublished) · tag 0 · build 0 · package 0 · release 0 · install 0 · network 0 · credentials 0 · secrets 0 · Graph 0 · external 0. package.json rc.24 vs package-lock rc.21 identity conflict: standing, untouched.

## I. PROVENANCE CEILING
Establishes: token receipt/verification · frozen contracts.ts mutation per token · contract-level semantic verification · isolated local commit. Does NOT establish: A.324 independent evidence admission · independent review · end-to-end confirmedAt delivery/persistence/readback · HCE · credential consent · Graph/external effect · build/release/installation provenance. Panel capture, actionRecord storage, and T1–T10 remain follow-on NP-FG-001 seams.
