# WORK_QUEUE.md — the governed task queue (A1)
### Living, TRACKED, freeze-excluded (D-5). Grows ONLY by operator directives or operator-approved proposals — never self-appended work. CLAUDE.md is the constitution; AUTONOMY.md defines states/classes/budgets.

Task format: **ID · objective · scope · allowed/prohibited files · dependencies · acceptance criteria · verification
commands · authority class · gate conditions · status.**

---

## NP-000 · S5.4 CEREMONY — first real Brain-proposed action
- **Objective:** one real governed send, Brain-proposed, at the operator's keyboard, per the FINAL CEREMONY CHECKLIST
  (runbook `…L6-S5-4-FIRST-REAL-BRAIN-ACTION-RUNBOOK.md`, 9 steps, OPERATOR vs MACHINE marked).
- **Scope:** the checklist only; one email to the operator's own address; single-send; no retry; containment same sitting.
- **Allowed/prohibited:** no repo change is part of this task except evidence capture; NO surface the runbook names may
  be modified by any other task while this is held.
- **Dependencies:** none (Phase 0 green; the corrected reality accepted; the bound go granted, re-armed).
- **Acceptance:** the checklist walked in order; terminal + `internetMessageId` captured; evidence copied out;
  containment complete; step-9 go given in the operator's own words BEFORE execution.
- **Verification:** independent read-back terminal (VERIFIED_SUCCESS / VERIFY_FAILED / HOLD — never assumed).
- **Authority class:** **AUTHORITY_REQUIRED (operator keyboard + explicit go).**
- **Gate conditions:** prerequisites 2–4 of the runbook are operator-only. **OUTRANKS EVERYTHING the moment the
  operator begins step 1 — all other tasks pause where they stand.**
- **Status: HELD** (awaiting the operator's sitting).

## NP-CORR-001 · Brain-propose-lane correction (recorded alongside the package)
- **Objective (completed):** close the Phase-0 overclaim — no production caller invoked the L6 stack from propose.
- **What happened:** claim → discovery (own recon) → STOP + report (divergence rule) → fix under the standing Phase-0
  mandate → in-app proof (`brainPropose.e2e.cjs`: eight fields → unedited execute → `L6-GATE ADMIT` →
  VERIFIED_SUCCESS → single-use NOT re-admitted).
- **Evidence:** `…L6-S5-4-P0-READBACK-CIRCLE-EVIDENCE.md` (ADDENDUM + dated CORRECTION note). Commits `59f9087`
  (lane) · `2315d33` (re-record, `BASELINE-413d2c24f7b2`).
- **Status: COMMITTED** (operator-accepted and commended, 19 Aug 2026).

## NP-001 · S23 — per-capability certification kit (first executable slice)
- **Objective (completed):** the seven-artifact kit, retroactive from mail.send; kit-complete ≠ certified pinned.
- **Evidence:** `…WHILE-HELD-S23-KIT-CALENDAR-DRYRUN-S39-EVIDENCE.md` §1. Commit `c1fd17e`.
- **Status: COMMITTED.**

## NP-002 · calendar.create PROPOSAL-SIDE dry run
- **Objective (completed):** the second capability through the kit up to the S5.1 line; honest UNVERIFIABLE plan live;
  production predicate REFUSES; five S4.2 attack classes hold. PROPOSALS only — never "certified".
- **Evidence:** same doc, §2. Commit `c1fd17e`.
- **Status: COMMITTED.**

## NP-003 · S39 — F-S17-1 affordance reconciliation
- **Objective (completed):** one local-first story, single-sourced by identity; claim-placement pinned; strings unchanged.
- **Evidence:** same doc, §3. Commit `68f4e2b` (INTACT `BASELINE-e19eb88e096c`).
- **Status: COMMITTED.**

## NP-004 · Release overlay (RECORDED, NOT ENTERED)
- **Objective (completed):** the version ladder onto the LB stages; the v1.0 definition; the ONE sequencing question
  left explicitly open for NP-006.
- **Evidence:** same doc, §4; `ROADMAP-HORIZON.md` §Release-Overlay. Commit `c1fd17e`.
- **Status: COMMITTED.**

## NP-005 · A0–A3 LITE dev-loop build (this directive)
- **Objective:** AUTONOMY.md + WORK_QUEUE.md (A0/A1) · gate detector (A2) · honesty scanner (A3) · the §0.3 dated
  CORRECTION note · seed the queue to reality · A4–A9 recorded NOT built.
- **Scope:** docs + `certification/` tooling only; 0 product-source changes; 0 frozen; 0 deps; 0 external effects.
- **Allowed files:** AUTONOMY.md · WORK_QUEUE.md · `certification/frozen-surfaces.json` · `certification/gate-detector.sh` ·
  `certification/honesty-scanner.sh` · the three freeze scripts' exclude lists (YELLOW, reported) · the Phase-0 evidence
  doc (append-only) · NP_STATE.md/CLAUDE §1 · the NP-005 evidence doc. **Prohibited:** everything else.
- **Dependencies:** none. **Authority class:** GREEN with YELLOW items (freeze-script exclude edit) reported.
- **Acceptance:** both scripts run read-only and self-test correctly (frozen → STOP; sensitive → GATE; clean → PROCEED;
  a crafted hostile diff → review items); freeze INTACT after the exclude-list update; queue seeded per §4.
- **Verification:** script self-tests captured · `bash certification/verify-freeze.sh` INTACT · full main suite
  (no product source touched — run to prove it).
- **Status: COMMITTED — reconciled to the CONSOLIDATED CONTROLLED-EXECUTION DIRECTIVE (same day).** The formal
  directive refined the LITE build; AUTONOMY.md was rewritten to operationalize it in full (hierarchy + conflict-STOP ·
  ceremony priority + the "beginning step 1" hard transition · authority wall + CONFIDENCE≠AUTHORITY · non-expansion +
  DISCOVERED FOLLOW-UP · status semantics · YELLOW = stop-before-the-boundary with PROPOSAL+IMPACT+PLAN+TESTS+GATE
  REQUEST · DEV-A1 pre-flight contract · detector UNKNOWN→STOP default + self-protection · scanner minimum targets +
  no-green-by-suppression + §3.3 immutability · §5.1–5.11 execution rules · §6 evidence minimum + reproducibility
  tuple · A4–A9 + §8 recorded). Detector gained the UNKNOWN safety default (out-of-repo/traversal path → UNKNOWN exit
  5; unparseable metadata → REFUSE exit 4; frozen dominates) — self-tests 7/7. Scanner gained no-op-promise-catch ·
  removed-throws-in-excess · removed-validation-in-excess + code-file scoping (docs MENTIONING patterns are not
  findings — a permanently-noisy verifier corrodes like fake green) — self-tests: clean 0 · hostile 8 · hostile2 4.
  Detector/scanner edits were authorized BY the directive itself (§2/§3 specify the behavior) — noted, not
  self-approved. Original self-tests: detector frozen→STOP(2)/sensitive+effect→GATE(3)/clean→PROCEED(0); YELLOW
  reported (freeze-script excludes +2 living docs, INTACT). Full main 858/8992/3 (no product source touched).
  Evidence: `…NP-005-DEV-LOOP-A0-A3-EVIDENCE.md` (+ consolidation addendum).

## NP-007 · Fresh-Profile App-Principal Bootstrap Reconciliation (bounded divergence repair)
- **Objective:** repair the S17×S15-seed ordering collision that BLOCKED the ceremony at step 1 on the fresh S54
  profile; close the fresh-profile coverage gap in the real-Electron harnesses.
- **Discovered failure (19 Aug 2026, ceremony step 1):** on a fresh isolated profile in app-principal mode, S17 local
  mode enters first (`16:32:38.987 Entering device-local mode`), the enterprise bootstrap claims the org owner row for
  the LOCAL principal (`16:32:39.020 Owner bound to the active principal { local: true }`), and the e2e seed swaps the
  session to the app principal only afterwards (`16:32:39.448 installing seeds — mode=app-principal`) → permanent
  `not_a_member`, fail-closed on every org-scoped channel (Connector Center unloadable; routing-choice save refused).
- **Observed W-7 predicate (verbatim):** `reason: 'not_a_member', sessionEmailShape: '3@example.com',
  activeWorkspaceId: 'workspace-default', workspaceFound: true, workspaceOrgId: 'org-default',
  organizationFound: true, organizationOperable: true, memberCount: 28, humanMembersWithEmail: 1,
  sessionMatchedAMember: false, ownerExists: true, ownerClaimed: true, ownerOrgMatches: true,
  ownerEmailShape: '42@device.invalid', sessionMatchesOwner: false, memberStatus: null, memberInWorkspace: null`
- **Safety result: FAIL-CLOSED.** No external effect · no OAuth exercised in-app (`accounts: 0`) · FG-4 latch not
  written · no expiry started. The failed profile is EVIDENCE — ARCHIVED, never deleted; logs preserved at
  `~/Desktop/S54-divergence-logs-2026-08-19`.
- **IN SCOPE (pre-flight classified BEFORE edit):** `main/index.ts` (PROCEED) · `e2e/e2eSeed.ts` (GATE — granted by
  this directive) · the fresh-profile Electron harness + existing harnesses (PROCEED) · associated tests · evidence.
  Effect-freedom declared: all changes are compile-stripped e2e seams + harnesses; zero external effects.
- **OUT OF SCOPE:** the owner-row policy and O-13 · frozen contracts · the authority model · OAuth behavior ·
  production connectors · any real external effect · ceremony authorization. Any need to cross these → STOP → FG gate.
- **Verification ladder (binding):** V1 reproduce-first on a fresh temp profile with the CURRENT build (the ordering
  correction is a HYPOTHESIS until V1 confirms the mechanism) → V2 smallest ordering correction, e2e-flag-gated,
  strip stays green and meaningful → V3 S17 non-regression pinned both ways → V4 the exact ceremony scenario green in
  the fresh-profile harness → V5 full ladder to the FULL main suite + strip PASS.
- **Authority class:** GATE_REQUIRED — granted (operator, 19 Aug 2026). **Status: COMMITTED — V1–V5 ALL GREEN.**
  V1 reproduced-first (broken 5/5 on the CURRENT build, fresh temp profile) · V2 smallest ordering correction
  (`installE2eSeedPrincipal` between restore and init; late seams unchanged) · V3 plain-profile S17 pins identical
  pre/post (4/4) · V4 ceremony scenario fixed 5/5 (owner=app principal · zero not_a_member · connectors:list loads 22 ·
  propose typed) + brainPropose & mailReadBack re-run GREEN on fresh temp profiles (coverage gap closed) · V5 full main
  858/8992/3 · strip PASS · honesty scan 0. Findings: coverage gap CLOSED · title-stamp red herring → runbook step-1
  pre-flight corrected (seed log line is authoritative) · DISCOVERED FOLLOW-UP: strip-grep belt-and-braces (out-of-scope
  sensitive file; proposal only). Evidence: `…NP-007-FRESH-PROFILE-BOOTSTRAP-EVIDENCE.md` (ExperienceRecord-shaped,
  document only).
- **NP-000 is SUSPENDED at step 1** — safety HELD, authority never exercised; restarts on the operator's say-so after
  §4 (archive + fresh profile). The bound go stands; the checklist is unchanged; Azure 1a–1c carry over.

## NP-008 · App liveliness census & launch readiness (operator directive, 19 Aug 2026 night)
- **Objective:** §1 read-only liveliness census of EVERY nav surface on a plain local-first THROWAWAY profile →
  truth-table artifact; §2 fixes in truth-order (BROKEN → fake-as-real → substrate wiring → honest labels);
  §3 LAUNCH-READINESS.md; §4 rules (zero real contact · FG gates for frozen · full main on renderer changes ·
  deterministic work, no fleets · never push · one commit per coherent slice).
- **Scope:** app-wide renderer/main NON-frozen. **Ceremony surfaces RESERVED:** the r2 profile, the app-principal
  env, the mail-send path, the runbook/checklist — untouched. NP-000 stays SUSPENDED (resumes on the operator's
  new tenant tomorrow; Azure 1a–1c to be redone there).
- **Census result (§1):** 47/47 surfaces walked — BROKEN 0 · LIVE 29 · RENDERS-ONLY 14 (13 Preview-labeled, 1 not)
  · GATED 2 · STUB 0. First-run claims all traced (the "local model server with 4 models" line is a REAL
  `detectOllama()` probe). Findings F-N8-1…7 recorded in `certification/APP-LIVELINESS-CENSUS-2026-08-19.md`;
  evidence JSON committed as `certification/np-008-census-report.json`.
- **Authority class:** GREEN with GATE stops for anything frozen; zero external effects.
- **Status: COMMITTED — all three sections done, class changes census-verified live.** §2 fixes: F-N8-1 (intent-home
  Preview-labeled) · F-N8-2 (empty-graph notice on Intelligence, pinned) · F-N8-3 (Release Ops refusals NAMED via
  `describeLoadFailures` — the F-5 class, model + ui pins; live post-walk shows "1 of the operations panels could not
  load: Backups") · F-N8-5 (workforce count-drift copy) · F-N8-6 (device-local identity truth in Settings). §2.3
  verified ALREADY WIRED with pins (m365WriteStatesDisplay · workspaceDomainRollup · FG-9 brainReview); ActionRecord
  read-model recorded as DISCOVERED FOLLOW-UP (S34a fence stands). §3 `certification/LAUNCH-READINESS.md`.
  Verification: post-fix census 47/47 · full main **859/8996/3** · ui **41/278** · typecheck clean · strip PASS ·
  FREEZE INTACT `BASELINE-1ac1c6b0bbbb` (zero frozen touches; two PRE-EXISTING frozen-surface lint errors recorded,
  untouched). Ceremony build preserved: LAST build is NP_E2E_BUILD=1, seed chunk + sentinel verified. Commits
  `6ec7a3d` · `e46e661` · `e24666e` · docs commit. Open: F-N8-4/7, F-N8-2 residual (opscenter/release-ops tiles),
  N-1/N-3, follow-up proposals — all in LAUNCH-READINESS §Open items. **Operator-ACCEPTED as closed (20 Aug 2026
  morning). Ruling: the ActionRecord-answerability follow-up is a QUEUED PROPOSAL behind the S34a fence — DO NOT
  BUILD; the operator rules on it after the ceremony.**

## NP-010 · BUSINESS REALITY PROGRAM (operator directive v1, 20 Aug 2026)
- **Objective:** the two-axis frame — READ-WIDE (observation-class ingestion: consent-scoped, provenanced, honestly
  labeled) vs WRITE-DEEP (every outbound action consequential-class: proposal+ASK until it individually passes the
  S23 kit). §1 connector reality census + business-data map (two artifacts, FIRST, read-only) · §2 universal
  ingestion spine (file-based first, zero credentials) · §3 ERP/financial core (READ+COMPUTE+DRAFT only, evidence
  lineage on every number) · §4 connector revival ladder (ranked; OPERATOR chooses order; each rung its own kit run)
  · §5 Brain over business data (proposal-side ONLY; the overdue-invoice reminder class, riding certified mail.send
  AFTER the ceremony) · §6 LAUNCH-READINESS business edition.
- **Scope/rules (§7):** NP-000 FIRST IN LINE, its surfaces reserved; pauses the moment the operator begins step 1 ·
  real credentials/consent/live connections ONLY at the operator's keyboard · file ingestion needs none and may
  proceed fully · FG gates for frozen · D-15 quiet window for any fleet · full main per renderer rule · one commit
  per slice · never push · ingested ≠ verified, drafted ≠ sent, kit-complete ≠ certified.
- **Authority class:** GREEN read-side; every write capability GATE_REQUIRED via its own S23 kit run.
- **Status: IN PROGRESS — §1 census sweeps running (read-only).** Nothing is built before the two truth artifacts
  exist.

## NP-006 · Post-ceremony §5 amendment — experience-arc-vs-v1.0 sequencing
- **Objective:** decide the ONE explicitly-open question (full experience arc before v1.0, or v1.0 earlier on the
  proven loop) by §5 amendment against the substrate as it then exists.
- **Dependencies:** **blocked on NP-000** (the ceremony).
- **Authority class:** **AUTHORITY_REQUIRED** (operator decision; five-field amendment discipline).
- **Status: QUEUED (BLOCKED on NP-000).**

---

## MASTER DIRECTIVE HORIZON (adopted 20 Aug 2026 — "MASTER CONTROLLED DEVELOPMENT + PRODUCTIZATION DIRECTIVE")
Phase order (binding unless the operator re-rules): **A Live Brain completion → B OS product experience → C system
registration + canonical identity → D connector/capability/oracle registries → E personal → F professional →
G enterprise connectors → H multi-connector ecosystem → I dev-automation maturity.** First objective is ONE coherent
governed OS (working Live Brain, one proven capability, truthful UX, reusable connector abstraction) — never
connector count. NP-000/S5.4 remains ABSOLUTE priority; "beginning step 1" stops everything.

**⚠ NUMBERING COLLISION — OPERATOR RULING REQUIRED.** The directive's §44 strategic queue reuses IDs NP-001…NP-030
that are COMMITTED HISTORY here (NP-001 S23 kit · NP-002 calendar dry run · NP-005 A0–A3 · NP-007 bootstrap repair ·
NP-008 liveliness census · NP-010 Business Reality). Committed IDs are never renumbered (evidence docs reference
them). The master strategic order is recorded below under provisional M-prefixed IDs pending the operator's ruling:
- M-001 Live Brain completion audit (GREEN — §58 recon RUNNING) · M-002 Live Brain remaining closed slices ·
  M-003 experience/memory boundary (memory never authority) · M-004 OS product-experience audit · M-005 P/P/E UX
  model · M-006 system identity foundation · M-007 registration interface · M-008 canonical connector resolution ·
  M-009 M365 connector reference NP-CON-M365-000001 · M-010 mail.send capability ref NP-CAP-M365-MAIL-SEND-0001 ·
  M-011 mail.send oracle ref NP-ORACLE-M365-MAIL-SEND-0001 · M-012 test connection ref NP-CONN-M365-TEST-000001 ·
  M-013 master connector resolution · M-014/016/018 tier priority studies · M-015/017/019 first tier connectors ·
  M-020 second-connector abstraction proof · M-021 website catalog · M-022–024 P/P/E product surfaces · M-025–029
  lifecycle/versioning/revocation/experience/multi-connector governance. HORIZON ONLY — entered one task at a time.
- **Gate:** LIVE_BRAIN_READINESS must read sufficiently complete before M-008+ (connector platform) begins.
- **Sequencing note:** NP-010 (Business Reality) §2–§6 are RE-SEQUENCED under this order (its §1 census artifacts
  are DONE and feed the master report; its read-side spine work maps into Phases B/E). Flagged for confirmation.

## §58 FIRST ACTION — READ-ONLY RECON → MASTER READINESS REPORT
- Status: IN PROGRESS. Composed from committed evidence (NP-008 product census · NP-010 connector + data censuses ·
  CLAUDE §1 Live Brain arc) + a 3-auditor read-only recon workflow (live-brain stages vs the §6 checklist · website
  + P/P/E experience classification · identity/registration substrate vs the seven-identity model). Output:
  certification/NEUROPAUSE-OS-MASTER-READINESS-REPORT.md + machine-readable LIVE_BRAIN_READINESS /
  PRODUCT_EXPERIENCE_READINESS / CONNECTOR_PLATFORM_READINESS JSONs. NO CODE until the report exists.
