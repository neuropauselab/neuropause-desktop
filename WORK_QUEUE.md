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
- **Status: COMMITTED — §1–§6 all closed (operator re-ruled §2–§6 to run, 20 Aug 2026).** §1 censuses `45a0970` ·
  §2 transaction-class ingestion + honesty label `df17ac6` (12 entities; 'verified' unassignable, pinned) ·
  §3 evidence lineage on AR aging `bf39fb5` (one pure rule, tile law live) · §4 revival ladder `1b29368`
  (**AWAITING OPERATOR ORDER RULING**) · §5 Brain business facts + reminder drafter `59cca40` (proposal-side only;
  recipient-from-mandate REFUSAL pinned; **lane wiring = explicit post-ceremony gate**) · §6
  `certification/LAUNCH-READINESS-BUSINESS.md`. Final suites: full main 862/9010/3 · ui 41/278 · honesty scans 0 ·
  FREEZE INTACT · zero frozen touches · zero external effects. Follow-ups recorded in §6 (aggregation importer,
  lineage expansion, GST formats, F-MR-5).

## NP-011 · Aggregation-shaped ingestion + lineage extension (operator green-light, 20 Aug 2026)
- **Objective:** (a) the aggregation-shaped importer — Tally XML vouchers · bank-statement CSV · GST files;
  (b) the lineage rule extended to cash position, GST summaries, and the Business dashboard tiles (FG gate
  presented if renderer/shared placement requires it); (c) invoice lifecycle evidence model approved as recorded.
- **Mechanism (a):** extractors PRE-FOLD sources into flat tables whose `Lines (JSON)` cell carries the SHARED
  line shapes the destination modules already parse — no importer surgery, no second write path. Imported
  journal entries are DRAFTS; the `post` action's full guard (accounts · balance · closed periods) is the GL
  gate — ingestion stays observation-class.
- **Status: IN PROGRESS.** Slice A COMMITTED: `dataPlane/aggregations.ts` (bank fold, conservative detection,
  deposits-positive; Tally voucher extractor, negative-is-debit, first-occurrence text) + parseFile/parseXmlDoc
  hooks + ontology entities `journal_entry`/`bank_statement` (14 canonical now) + pure + e2e tests. dataPlane
  226/226 · full main 863/9015/3 · ui 41/278 · scan 0. **Slice B COMMITTED** (`387b8b3`): GSTR-2B recognizer →
  vendor-bill DRAFTS (15th canonical entity; derived rate stated as approximation; EXACT filing amounts verbatim
  in Notes — "these figures are the filing truth"; approvedAt empty pinned — approve is the gate). **Slice C-main
  COMMITTED** (`b3ecd8c`): lineage stamped by cash-flow + tax-report generators (GST snapshot names BOTH
  registers). **Slice C-renderer: GATE_REQUIRED** — FG-11 presented
  (`certification/source-update/FG-11-GATE-SHARED-SOURCE-LINEAGE.md`, verbatim diff + confirmations); tile wiring
  NOT built until the token. Invoice-lifecycle evidence model: approved as recorded (paid ← payment reference
  exists; sent requires a certified send). **Slice C-renderer CLOSED — FG-11 token honored** (bracket
  `b2d6c46` frozen-isolated → `705057a` accompaniment → INTACT #2 `BASELINE-61cede6a036a` @ `8529a19`; one rule
  zero copies pinned; tile law live on the family bands; evidence
  `…FG-11-SHARED-SOURCE-LINEAGE-EVIDENCE.md` quoting the token). **NP-011 CLOSED.** Precision language on the
  record: "NP-011's implementation green-light is complete with FG-11; the ceremony green-light is separate —
  NP-000 remains independently held."

## NP-012 · Concentric Architecture adoption — REFERENCE + AUDIT track (operator directive, 20 Aug 2026)
- **Objective:** §0 commit the spec as ARCHITECTURE.md · §1 canonize non-equivalences · §2 gap audit →
  ARCHITECTURE-MAPPING.md · §3 ranked proposals (operator chooses; zero code without ruling) · §4 status language.
  NOT a rebuild license; yields to NP-000 and the in-flight NP-011 slices.
- **Status: CLOSED — §3 RULED (operator, 20 Aug 2026): ranking APPROVED with sequence and bounds → NP-013…NP-018
  seeded below; slice 7 (ASK surface to ten fields) DEFERRED-RECORDED (waits for a natural FG-gate companion or
  the operator's explicit call — NOT queued). Ring-4 safe-direction divergence + stage-inversion + Part C
  affirmed as recorded. The spec-file correction commended on the record.** The canonical spec
  arrived (operator-supplied, 2026-08-20) and is committed VERBATIM as `certification/ARCHITECTURE-SPEC.md`
  (per the merged directive the filename is ARCHITECTURE-SPEC.md, superseding §0's ARCHITECTURE.md name) —
  body extracted byte-for-byte from the operator's message (sha256 `c10fd5f8…`, "One important correction"
  included); a first from-memory write was caught and REPLACED before commit. Part B transcribed FROM the text
  and classified (17 rows) · Part A re-checked (nine-timestamp ABSENT→PARTIAL-scattered; capability record
  counted ~11/16 against the real field list; initiative-chain RECORDED→PARTIAL 1-of-4) · Part C = what the
  spec itself leaves undefined, kept SOURCE_REQUIRED · §3 FINALIZED (7 ranked slices) and presented for ruling.
  Previously DONE: §1 fifteen-line table fully
  classified (14 already-law/behavior + 2 recorded-modeling; **PAYMENT ≠ AUTHORITY canonized as CLAUDE §2 #16**,
  before any Razorpay work exists) · both vocabulary rulings recorded (D-16 sole verification vocabulary;
  spec five-value set = state assessment only, mapped onto `Certainty` side-by-side; NP-CON-/NP-CAP- ids from the
  ladder onward, existing ids aliased) · Part-A element audit (tenant-DENY CONFIRMED · authn≠authz CONFIRMED ·
  credential boundary CONFIRMED w/ naming-DIVERGENT + F-MR-7 gap · observation ladder ABSENT-as-unified ·
  nine-timestamp model ABSENT) · §3 preliminary ranking presented · §4 language verbatim:
  **NP-000 = HOLD; pre-execution divergence FIXED (NP-007, supersedes the advisor doc §9); hold reason = TENANT
  AVAILABILITY only; "NP-011 progress is never evidence of NP-000 readiness — the real external-effect proof
  passes independently."** All in `certification/ARCHITECTURE-MAPPING.md`.

## NP-013 · Credential-boundary completion (NP-012 §3 ruling, slice 1 of 6)
- **Objective:** desktop log redaction at the logger boundary (closes F-MR-7) + the adversarial RULE-009 pin
  (credential material in connector metadata → refused/stripped, proven at the real persistence path).
- **Bounds (operator):** zero frozen touch. **Authority class:** effect-free (logs + tests).
- **Status: CLOSED (TEST-VERIFIED).** Boundary enforced in `logger.ts` (ONE credential-text rule + shared
  secret-key classifier; console and file sink receive the SAME redacted payload; the W-7 predicate SURVIVES,
  pinned); RULE-009 enforced at BOTH connectorStore doors (scrub-not-refuse; real-disk adversarial pins);
  vault decrypt/parse try split (plaintext excerpt leak dead); slackSocketMode call-site redaction + safeDetail
  wss-ticket gap closed (found BY the adversarial pin). 46 pins; full main 866/9035/3; zero frozen touch.
  Evidence: `PHASE-I-A3-NEUROPAUSE-OS-NP-013-CREDENTIAL-BOUNDARY-EVIDENCE.md`. **Next: NP-014.**

## NP-014 · Constitutional invariant suite (slice 2 of 6)
- **Objective:** ONE named `constitutionalInvariants.test.ts` asserting RULE-001..012 through the existing pins'
  seams; RULE-012's provenance gaps close IN-SLICE; RULE-008 asserted VACUOUS-BY-CONSTRUCTION with recorded
  linkage in the test AND the horizon doc: when learning code enters (LB-6), the test MUST flip vacuous→real as
  an ENTRY CRITERION of that arc.
- **Status: CLOSED (TEST-VERIFIED) with ONE PRESENTED remainder.** 25 tests through REAL seams (D-15 recon
  fleet extracted the fixtures); RULE-012 provenance closed AT THE STORE (optional
  `provenance{source,method,oracle}` + real-store round-trip pin); RULE-008 vacuous + linkage in test AND
  ROADMAP-HORIZON LB-6 (entry criterion, both directions); cst/ imported only, never touched.
  **CORRECTION (self-caught):** the s16VerifyRun call-site edit violated the sensitive-surface GATE
  (`src/main/e2e/` = present-before-editing; detector was run post-commit) → byte-restored (`35eac95`), pin
  removed with the gap recorded in-file, **the one-object diff PRESENTED to the operator — awaiting the go**;
  lesson recorded (detector runs pre-edit on every path, no exceptions). verify-e2e-strip deliberately NOT
  re-run (out/ stays the armed ceremony build — seed chunk verified).
  Evidence: `PHASE-I-A3-NEUROPAUSE-OS-NP-014-CONSTITUTIONAL-INVARIANT-SUITE-EVIDENCE.md`. **Next: NP-015.**

## NP-015 · Nine-timestamp completion (slice 3 of 6)
- **Objective:** additive ActionRecord fields (event_time, effect_time, request_time); effect_time populated
  from the provider read-back WHERE THE ORACLE SUPPLIES IT — honestly null where it doesn't, never derived.
- **Status: CLOSED (TEST-VERIFIED).** Discipline pinned throughout: *a time we were not told is ABSENT, not
  approximated.* `requestTime` READ from the kernel-minted requestId (strict end-anchored ISO + parse check;
  legacy/epoch/truncated → null, never a guess) · `eventTime` supplied only by a caller that observed one —
  honestly NULL on the governed send path, never borrowed from the request · `effectTime` = the provider's
  `sentDateTime` carried verbatim out of the oracle (`VerifyResult.observedEffectAt`), null on bounce/HOLD;
  optional-AND-nullable so ABSENT (pre-field, never back-filled) stays distinct from NULL (ran, none supplied).
  NP-014's authorized call-site diff landed byte-identical and its source pin is restored. Both sensitive
  diffs additive-only inside the envelope and presented verbatim in the evidence; the untouched verification
  suite passing unmodified is the no-behavior-change proof. 13 new pins; full main 868/9074/3.
  **Recorded, NOT built (outside the envelope):** the CST kernel's `TransitionOutcome.timeline` already stamps
  decided/claimed/executionStarted/executionCompleted/verified — a real source for authorization_time and
  execution_time, and the natural next temporal slice if the operator rules it.
  Evidence: `PHASE-I-A3-NEUROPAUSE-OS-NP-015-NINE-TIMESTAMP-EVIDENCE.md`. **Next: NP-016.**

## NP-016 · Capability-record completion in the S23 kit (slice 4 of 6)
- **Objective:** kit artifact to the 16-field shape + Ruling-2 aliases. The risk_class FIELD exists; its VALUES
  stay SOURCE_REQUIRED per Part C — no invented taxonomy. Full exercise arrives with ladder rung 2
  (calendar.create) post-ceremony. **Status: QUEUED.**

## NP-017 · Typed-relationship field completion (slice 5 of 6)
- **Objective:** valid_from / valid_to / source_evidence / confidence per link (dataPlane). **Status: QUEUED.**

## NP-018 · STALE as a first-class state assessment (slice 6 of 6)
- **Objective:** EXTENDS the single `Certainty` authority — no second vocabulary, no fork, ever. Window semantics
  designed in-slice with honest defaults + recorded reasoning. Brain-substrate change = its own slice, FULL main
  suite. **Status: QUEUED.**

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
- **Status: COMMITTED.** `certification/NEUROPAUSE-OS-MASTER-READINESS-REPORT.md` (§A–F) + the three
  machine-readable files (`LIVE_BRAIN_READINESS.json` · `PRODUCT_EXPERIENCE_READINESS.json` ·
  `CONNECTOR_PLATFORM_READINESS.json`). Headlines: Live Brain propose loop TEST-VERIFIED mock with pinned
  zero-authority boundaries, **4 PARTIAL stages** (S2/S3 built-but-unwired · lane workspace feed null · S22
  reconciler missing) and 2 recorded-only; **§45 GATE VERDICT: NOT sufficient for connector expansion (M-008+)**
  — Phase-A closes first. Product: app census-honest; **website fails §31 on 11 claims (F-MR-1)** and never
  advertises the certified capability. Identity: CONNECTOR/CONNECTION/CAPABILITY(M365) ids real; SYSTEM/
  INSTALLATION/REGISTRATION fragmentary; ORACLE registry missing; no RegistrationProvider abstraction. New
  findings F-MR-1..9 in the report. Recommended order: NP-000 ceremony → M-002a/b/c (S2+S3 wire · real workspace
  feed · S22 reconciler) ∥ Phase-B website truth pass (touches no Brain substrate).
