# CLAUDE.md — NEUROPAUSE OS
### Standing law + roadmap for every Claude Code session in this repo · v1.0 · 18 Aug 2026
This file supersedes all prior prompt documents (OPERATION_ALIVE, WAVE3, FG1). Read it fully at every session start, then NP_STATE.md, then run `certification/verify-freeze.sh` before any work.

**Definition of ALIVE (governs every claim in this repo):** "alive" never means "the UI works." Alive means a real control path exists and its claimed state is supported by evidence at the layer beneath it. A green pixel with no proof underneath is a defect.

**Constitutional powers (never conflate):** INTELLIGENCE (AI proposes) · AUTHORITY (policy + permission decide what may happen) · CONSENT (the human confirms) · EXECUTION (the governed path acts once) · VERIFICATION (an independent oracle proves the effect). Each lives in different code; no slice may merge them.

---

## 1 · CURRENT STATE (Claude Code updates ONLY this section, at every slice completion)

- HEAD: `96609d4` · FREEZE INTACT (`BASELINE-43dfbe3ff6f7`) · branch `cert/data-import-cst-integration`.
- Landed: Slices 1–14 + **S15 PRE-FLIGHT** (safety infra; no real send). Slice 13 = AI mail.send intent generator + **FG-3** (`AssistantEnvelope.mailIntent`) + assistant→panel wiring (D-7). Slice 14 = **real-Electron governed-loop E2E, mock Graph only** — launched app: NL turn → intent → proposal → human confirm → certified executor → mock Graph → ACKNOWLEDGED (Profile A) + hostile/ambiguity negatives, 13/13; NON-frozen compile-stripped e2e seed + global-fetch mock (D-8). S15 pre-flight = **FG-4** (`connectors/index.ts` first-real-send guard hook, compile-stripped, `b0ac3c5`) + `firstRealSendGuard` (allowlist all fields + single-send latch) + mode coupling (run mode A, D-9); INTACT bracket befabe0 → b0ac3c5 → ad81825.
- Suites (RUN against BASELINE-43dfbe3ff6f7): full main **8724 passed / 3 skipped** (823 files) · real-Electron e2e **13/13** (guard inert in mock mode) · guard+mode pins **16** · typecheck + lint clean · `verify-e2e-strip.sh` PASS (seed + guard absent from release).
- **Slice 15 EXECUTED (human at keyboard) — first real-send ATTEMPT, LIVE-VERIFIED (Profile A — acknowledged).** AUTHORIZED ✓ (guard allowlist + CST admission; latch written) · SUBMITTED ✓ (Graph 202 / UI ACKNOWLEDGED) · EXTERNALLY OBSERVED = provider-side CONFIRMED (message in Sent Items: To neuropause033@gmail.com, subject "NeuroPause S15 first real send", 12:23 UTC matching the latch; internetMessageId + destination delivery deferred to S16). One email to the operator's own address; latch spent (at-most-once). FG-4 ALSO fired live on a non-allowlisted attempt (unscripted negative proof; latch not written). Findings: F-1 scope-reality (send-only claim dead; broad ~47-scope token; manifest-minimization work item) · F-2 Mail.Read granted → **S16 needs no re-consent** · F-4 guard/send don't log (audit gap) · F-5 M365-writes counters read never/0 (S19). A profile-isolation guard (`--user-data-dir` required; HARD-FAIL on the default profile) landed non-frozen (`996958d`).
- **Slice 16 — DONE: the FIRST VERIFIED_SUCCESS in the product's history.** `verifyEffect` oracle (corroborated match — never id alone; idempotent; UNRESOLVED never auto-promotes; 17 pins incl. fault injection) + `m365ReadBack` (in-session READ-ONLY reader) + `s16VerifyRun` (compile-gated runner). Real in-session run (2026-08-18T13:25:54Z): **TERMINAL=VERIFIED_SUCCESS**, internetMessageId `<PN2P287MB1597…@…PROD.OUTLOOK.COM>`, bounce=none, attempts=1 — corroborated Sent Items match. No FG-5 (D-10); verify-e2e-strip PASS. Artifacts in `certification/s15-artifacts/`. Send-verification, not a destination receipt (destination filtering NOT GOVERNED). **Next:** containment (operator revokes consent + deletes app registration + the S15 profile — evidence already copied out) → then **S17 local-first** (kill the sign-in wall on an honest, unseeded build), S34 action-trace.
- **Slice 17 — FG-6 LANDED (frozen bracket closed); renderer wall-kill wired.** Honest `local` AuthStatus + device-local principal (**FG-6**, token honored; INTACT #1 `BASELINE-3f19fb707fa0` → INTACT #2 `BASELINE-43238f789694`). `LocalPrincipal` (id/displayName/createdAt, no token/session/org) + `{ state:'local'; principal }`; two synthetic namespaces — actor `local:<id>` (self-disclosing, forgery-denied, never stripped — the S33 edge pinned now) + tenant `local-<id>@device.invalid` (RFC-6761 non-routable, invalid-by-rule outbound, D-12). Frozen §5 (exact): auth.ts contract · authService.enterLocalMode (restoreSession no-account → local, not the wall) · runtimeCore ×3 (2 CST actors → `resolveGovernedActor`; secureBridge → `hasActivePrincipal`) · enterprise ×3 (`sessionEmailFor` ×2 + `bindOwner`). Consumer-audit: 28 sorted, 11 auto-deny (token-gated cloud clients fail closed for local), rest deferred to safe fallback (S34); **0 typecheck-forcing → CLAUDE §4 standing rule added**. Renderer: App.tsx `local` branch → full shell + `LocalModeBanner` affordance (CTA reveals real LoginScreen w/ "keep working locally"). Suites: main **8766/3 skipped** (828) · UI **257** (35) · typecheck node+web + lint clean · verify-e2e-strip PASS. DECISIONS D-11 (non-destructive local→auth) + D-12 (actor-namespace). **`local-mode.spec` GREEN (5/5):** fresh profile + release build + backend down → no wall, local shell mounts, affordance shown — the sign-in wall is dead end-to-end. **Graceful cloud-absence LANDED:** `useIsLocalMode` + `CloudUnavailableLocal` + `LocalModeConnectProvider`; Organization/AI-Store (AppShell) + Trusted-Devices/Billing (Settings wrappers) show "unavailable while working locally" + connect, instead of the "Sign in to manage…" red banner (S19-honest; real failures still fail). Semantic/livesync/license already graceful; backfill no surface. UI 259 · typecheck+lint clean. **S17 CLOSED** (DoD walked in evidence). **F-S17-1** (reconcile onboarding "Try Free Locally" ⇄ `LocalModeBanner`) → S39.
- **BRAIN-1 — brain gateway (draft lane) CLOSED (①②③④, non-frozen, no FG gate; TEST-VERIFIED).** Scout found a near-complete gateway already exists (`AiEngine`→`ModelRouter`→`PrivateFirstClient`→Ollama-localhost/Claude/OpenAI, honest fallback, modes, vault keys); BRAIN-1 = unify + harden. ① hostile-adapter CI gate (the draft model gains NO authority — guards strip a maximally hostile drafter; runs against the seam). ② `ai/brain/mailDraftGateway.ts` — model → zod (`RawMailDraftSchema`) → ONE repair → honest `referenceDrafter` fallback. ③ assistantService routes the draft lane through `servingDraftMailer()` (serves `referenceDrafter` today — reference-only). ④ eval harness (`draftEval.ts`) scores THE BAR (a hostile-0 · b ≥95% schema-valid ≤1 repair · c authority-leak-0 per candidate · d human subject/body review + go) → **eval report** = honest zero-model baseline (0 candidates); DECISIONS D-13; badge names a model only when one serves; LiteLLM reserved (`.env.example`). **Honest correction:** a latent S17 `cssTokens` failure (LocalModeBanner undefined `--surface`) surfaced in the FULL main suite — fixed; standing rule: run full main after any `src/renderer` change, not just the ui glob. Full main **8784/3** · UI **259** · typecheck+lint clean. Draft lane serves `referenceDrafter` (zero-model) until eval clears + operator go. **Next:** §5 roadmap-amendment draft (my approval req.); S34a action-record; S19 counter-truth.
- **S34a — Queryable Action Record CLOSED (FG-5, closes F-4; TEST-VERIFIED).** The observation layer's first stone: `connectors/actionRecord.ts` — a durable, tenant-scoped, append-only evidence store, fed by ONE gated OBSERVER line in frozen `connectors/index.ts` (token `AUTHORIZED: FG-5 — connectors/index.ts action-record observer emit, one gated line, per gate doc`; INTACT #1 `BASELINE-322115041eeb` → INTACT #2 `BASELINE-8f0f1e137d3f`). `observe` = best-effort, never blocks/alters the send, logs an evidence gap on failure. Record = the chain (ids · actor VERBATIM D-12 · tenant · connector · account · recipients · verdict · outcome · admissionRef) + subject/body FINGERPRINTS + `recordVerification`; `query` answers "what happened to the email I sent?" tenant-isolated, no raw logs. Closing proof = all 8 + query proof + the OBSERVER INVARIANT (no import path record→governance/execution), 13 named tests. Full main **8796/3** · UI **259** · verify-e2e-strip PASS. Scope-fenced (no query UI/Environment-Intelligence/trace-metrics). **Next:** S19 counter-truth (five states, S34a as authoritative source) → then §5 amendment review (per-layer approval, hard stop).
- **S19 — Counter truth CORE CLOSED (closes F-5 in logic; TEST-VERIFIED, non-frozen).** Definition pass first (`S19-COUNTER-DEFINITION-PASS.md`): the old "Microsoft 365 writes" counter's source (`SyncStateStore.writeCount`, incremented only in `M365Executor.execute`) is DISJOINT from the governed `mail.send` path → an ACKNOWLEDGED S15 send displayed "0/never" (F-5). Replaced in logic by five states — REQUESTED/AUTHORIZED/EXECUTED/PROVIDER_ACKNOWLEDGED/EXTERNALLY_OBSERVED — derived by `connectors/m365WriteStates.ts` (`deriveWriteStates`/`m365WriteStates`) from the SINGLE S34a `ActionRecord` store (no parallel counting; no re-increment on the frozen send path). EXTERNALLY_OBSERVED honestly 0 until S16 feeds `recordVerification`. F-5 reproduced + made truthful (`m365WriteStates.test.ts`, 7). **Display landed via FG-7** (token honored; INTACT #1 `58024ee849b0` → INTACT #2 `959735ab2a6a`): one additive optional `ConnectorSyncSnapshot.writeStates`; `unified/sync` joins `m365WriteStates` onto each M365 snapshot (one source of truth); `M365WritePanel` RETIRES the disjoint "Writes/Last write" and shows the five states (absent → "No governed writes yet"; EXTERNALLY_OBSERVED honest 0 until `recordVerification` wired). ui-tests pin each number to its source. **S19 CLOSED — F-5 fixed end-to-end** (reproduction → derivation → display). Full main 8809/3 · UI 262 · verify-e2e-strip PASS.
- **Workspace Foundation (OS-track L1) — FIRST CLOSED SLICE (the domain aggregate; TEST-VERIFIED, non-frozen).** `enterprise/workspaceFoundation/domainAggregate.ts` + `domainSources.ts` — `composeWorkspaceDomain`/`workspaceDomainSnapshot`: a tenant-scoped READ/aggregate-only façade over the ~106 governed enterprise-module stores (NOT a new store). Observable object + LIVE WIRING re-proven against REAL `EnterpriseRecordStore`s + LOCAL-MODE HONESTY (missing local store → UNAVAILABLE, never error/fake-0) — 5+4 tests. **This is L1's first closed slice (counts for L6 entry).** The renderer SURFACE required a frozen change (every `enterprise:*` response is in frozen `packages/shared`) → presented as **FG-8** (not worked around) and **LANDED on the token** (INTACT #1 `43324a2b013f` → INTACT #2 `be240c98d4f2`): one additive optional `ExecutiveSnapshot.workspaceDomain` field; `enterprise:dashboard` handler joins `workspaceDomainSnapshot` over the real module registry under `activeTenantScope`; `WorkspaceDomainRollup` shows the STATE (present→count, unavailable→"unavailable", never fake 0) in `ExecutiveWorkspacePanel`; truthful-surface + local-mode ui-tests. **L1 SLICE-2 CLOSED** (L1 now has two closed slices). Full main **8821/3** · UI **265**.
- **Capability Graph (OS-track L4) — SLICE 1 observable object LANDED (TEST-VERIFIED, non-frozen, no FG gate).** Scout: S23 Cert Kit + S28 Policy DSL are roadmap-only, but L4 needs NEITHER — the real certification predicate exists (`mutationAssuranceFor === 'governed-certified'` = M365 `mail.send`) + BRAIN-1 lanes are real. `capabilityGraph/capabilityGraph.ts` — `composeCapabilityGraph` → PURPOSE→CAPABILITY→LANE→CONNECTOR→WORKFLOW routes over CERTIFIED SUBSTRATE ONLY; certified-only routing (uncertified mutation → NOT_GOVERNED gap; unresolved → MISSING gap; no invention); PROPOSAL-only (never executes/grants). Five acceptance fields each to a test (5). `mail.send` is the single routable consequential capability (breadth fence). **Next increment (non-frozen):** live-wire to the real `capabilityDiscoveryService`/`MANIFEST_BY_ID`/BRAIN-1 lanes, re-prove against real registries.
- **L6 Live Brain — S5.4 PHASE 0 built (mock, report-and-continue, non-frozen): the READ-BACK CIRCLE closes in the RUNNING APP.** After the earlier L6 arc (S1 state · S2 context · S3 reasoning · S4.1 proposal engine + S4.2 nine-attack fleet + S4.3 certification · S5.1 ASK-only execution boundary · **FG-9** `brainReview` ASK surface · **FG-10** L6 execution gate before `governedSend` · S5.3 full mock loop at module level), Phase 0 wired L6 into the real path and proved the whole loop in-app in mock. Panel wiring: `response.brainReview` renders the eight review fields in the confirm panel (`M365WritePanel`/`EntraConnectorPanel`). **Read-back de-gated:** `verification/verifyGovernedSend.ts` — a READ-ONLY, latch/env/electron-free orchestrator driving the pure `verifyEffect` over an injected reader (the S22 reconciler is its production caller; recorded as an explicit no-orphan gate). `e2e/mockGraph.ts` — a pure mock-Graph read-back seam (records the send; answers Sent Items/Inbox per `NEUROPAUSE_E2E_VERIFY`); the circle is proven over the REAL oracle for all three terminals. `s16VerifyRun` latch coupling severed to its gated caller; `verify-e2e-strip.sh` extended and **PASS** (seam absent from release). **Real-Electron run (`mailReadBack.e2e.cjs`) PASS, 3 launches:** certified path → ACKNOWLEDGED (mock Graph) → INDEPENDENT read-back → terminal, per knob — success→VERIFIED_SUCCESS (corroborated mock id), bounce→VERIFY_FAILED, hold→HOLD (never auto-promoted). Full main **855/8970/3**; verify-e2e-strip PASS; INTACT (`BASELINE-52008b68ddb5`). MOCK-ONLY, ZERO real contact; no frozen surface touched by Phase 0's read-back work. **PHASE 0 ACCEPTED (operator, 19 Aug 2026); FG-10 closure accepted (tenth gate, freeze never broken). FINAL CEREMONY CHECKLIST PRESENTED (runbook §Ceremony: 9 steps, each marked OPERATOR-ACTION vs MACHINE-ACTION; the go is the final line) — ⛔ ABSOLUTE HOLD; report-and-continue ends here.** Companion canon landed on the same directive: **§2 #15** ("Memory informs governance; memory never becomes governance") + the **experience-memory arc** recorded as LB-6's detailed design in ROADMAP-HORIZON (RECORDED, NOT ENTERED; leading candidate for the first post-ceremony arc; five-field discipline to enter; note: the directive said "LB-7", but the operational-memory stage is LB-6 in the recorded numbering — folded there, numbering kept, flagged for the operator). **HONEST CORRECTION after the ceremony go (pre-flight recon): the Brain-propose LANE was missing** — no production caller invoked the L6 stack from propose (renderer wiring only; the FG-10 gate always SKIPped); divergence rule honored (STOP → report → fix under the standing Phase-0 mandate, non-frozen). Landed + proven: `liveBrain/brainProposeLane.ts` (validated-artifact → real-substrate state → S4 `buildProposal` → stash → FG-9 fields; 7 pins incl. real-gate ADMIT-and-consume, edit→SKIP, expiry→DENIED), `runProposeM365ActionWithArtifact`, async propose handler (best-effort/additive-only), gate `deriveAuthority`/`deriveOracle` exported + `L6-GATE ADMIT/REFUSE` logged. Real-Electron `brainPropose.e2e.cjs` PASS (propose→eight fields→unedited execute→ADMIT→VERIFIED_SUCCESS→single-use); `mailReadBack.e2e.cjs` re-run PASS; full main **856/8977/3** · ui **39/271** · strip PASS (lane ships; seams absent). Ceremony steps 2/3/5/6 now real in-app in mock; the bound go stands; the HOLD re-arms at step 9. Claude never supplies creds/consent/confirm/send.
- **WHILE-HELD PACKAGE (19 Aug 2026, ceremony HOLD untouched): S23 kit + calendar dry run + S39 CLOSED + release overlay recorded.** S23 first executable slice: `certificationKit.ts` (seven ruled artifacts, retroactive from mail.send; kit-complete ≠ certified) + mail.send back-fill (5, real propose-core refusals). calendar.create DRY RUN (10) — PROPOSALS ONLY: honest plan "UNVERIFIABLE today: needs a calendar read-back oracle" live for the first time; PRODUCTION S5.1 predicate REFUSES (connector certified ≠ action certified at the boundary); kit-modeled future predicate → ADMIT_FOR_ASK/'ASK', nothing more; five S4.2 attack classes hold; `deriveOracle` honest needs registry (non-frozen). NO frozen touch (contract-entry gate not triggered — module-level; a production calendar propose surface is that gate). S39 (F-S17-1) CLOSED: `localFirst/story.ts` single vocabulary, door⇄state by identity, claim-placement pinned, strings unchanged. Release overlay in ROADMAP-HORIZON (v1.0 = twelve-component core + ONE governed capability; sequencing question explicitly open, §5 amendment post-ceremony). Full main **858/8992/3** · ui **40/276** · INTACT (`BASELINE-e19eb88e096c`). **⛔ Ceremony HOLD stands; next input: the operator at the keyboard, step 1.**
- **NP-005 (19 Aug 2026): the governed dev loop A0–A3 LITE is BUILT; ceremony HOLD untouched.** `AUTONOMY.md` (references this constitution — on conflict CLAUDE.md WINS; states/classes/budget/MAX_REPAIR_ATTEMPTS=2/anti-workaround verbatim; A4–A9 recorded NOT built) + `WORK_QUEUE.md` (seeded NP-000…NP-006; grows only by operator directive/approved proposal) + `certification/gate-detector.sh` over NEW `certification/frozen-surfaces.json` (authoritative machine projection of §2/§6; fail-closed; self-tests 4/4) + `certification/honesty-scanner.sh` (report-only, 8 classes, self-tested). Freeze-script excludes gained the two new living docs (INTACT preserved). Package + brain-lane correction operator-ACCEPTED; §0.3 CORRECTION note appended to the Phase-0 evidence w/ commits. Full main **858/8992/3**. **⛔ Ceremony HOLD stands (NP-000 outranks everything at step 1).**
- Honest status: everything is TEST-VERIFIED EXCEPT the S15/S16 chain, which is LIVE — one real governed M365 send (provider-side observed) and its read-back VERIFIED_SUCCESS with captured internetMessageId. Destination receipt remains NOT GOVERNED. No other external effect exists. The L6 read-back circle is TEST-VERIFIED (mock) in the running app; no L6-proposed action has ever reached a real external effect (S5.4 ceremony, operator-gated). The 41 preview packages remain NOT CERTIFIED / NOT LIVE, off the critical path; M365 is the first live governed vertical.
- Housekeeping: living docs TRACKED + freeze-excluded (D-5); committed each slice.
- Defect log (do not fix in passing): frozen `contracts.ts:2418` pre-existing lint escape (`AiPullModelRequest`). Frozen files are never touched outside an FG gate — four of the five most recent corpus defects came from well-intentioned amendment work.

## 2 · NON-NEGOTIABLES

1. **Frozen surfaces change only through an FG gate.** Protocol (proven in FG-1, now law): write the gate doc → present the **verbatim** diff + threat analysis both directions + verification plan → run the human's read-only confirmations → wait for the literal token (`AUTHORIZED: FG-N — <subject>, per gate doc`) → apply via the change-control choreography. Silence is not consent; enthusiasm is not consent; only the token is consent. A diff that changes after the token requires a new token.
2. **Change-control choreography (proven, mandatory for every frozen touch):** clean checkpoint → `certification/freeze-baseline.sh` re-record → `verify-freeze.sh` INTACT (#1, committed) → apply the authorized diff + minimum accompaniment → full suites green → one isolated commit → re-record → INTACT (#2, committed) → evidence doc recording the frozen/non-frozen path split, both INTACT baselines, and the token quoted verbatim.
3. **Micro-authorization rule:** if authorized scope proves insufficient mid-flight (one line becomes two, a third guard fires), REVERT to the last clean state and ask. Never silently exceed scope; never leave a red tree; never re-record a baseline against red.
4. **Never fake green.** No weakened assertions, skipped tests, widened timeouts, or mocks standing in for a thing the slice says to make real. A true FAIL outranks a false PASS. A permanently red verifier is as corrosive as a fake green — fix the cause or gate it, never normalize it.
5. **Evidence or it didn't happen.** Every slice ships `certification/source-update/PHASE-I-A3-NEUROPAUSE-OS-WAVE-<W>-SLICE-<N>-…-EVIDENCE.md` with honest labels — `SOURCE-PROVEN` / `TEST-VERIFIED` / `LIVE-VERIFIED` / `PILOT-VALIDATED` — never stronger than the evidence beneath.
6. **AI output is untrusted data, everywhere, forever.** External content ≠ instruction authority. The AI never sets identity, tenant, account, approval, `confirmed`, or policy. It produces candidates for validated, fail-closed paths only.
7. **One confirmation architecture.** Everything consequential flows proposal → human review → confirm → CST → admission → execution → outcome → evidence. Building a second path is a defect.
8. **Deny-by-default.** Unknown capability, recipient, account, tenant, connector, parameter, policy, or verification state → DENY, fail closed.
9. **Uncertainty is never success.** UNKNOWN → HOLD → RECONCILIATION → VERIFIED_SUCCESS / VERIFIED_FAILURE / UNRESOLVED. UNRESOLVED remains unresolved.
10. **Offline ≠ execution authority** unless an explicitly certified offline policy says otherwise.
11. **Governance boundary honesty:** anything outside proven coverage is explicitly marked NOT GOVERNED — never silently treated as governed.
12. **Secrets:** never invented, hardcoded, or committed. `.env.example` documents; real values arrive only at human gates.
13. **The Brain proposes; it never reaches.** Live Brain (L6) is never granted LLM→shell, LLM→API, LLM→connector, or LLM→database. Its ONLY path to any external effect is **BRAIN → PROPOSAL → GOVERNANCE → NEUROPAUSE EXECUTION → EXTERNAL EFFECT → INDEPENDENT VERIFICATION → ACTION RECORD.** Its state model and reasoning hold ZERO execution or grant authority (zero-runtime-import into governance/execution, pinned). Model output inside the Brain is untrusted data (§6) and sets no identity, tenant, account, approval, or policy. Approved with L6-S1 (operator, 19 Aug 2026).
14. **Executor-success is never the claim — universal read-back.** For EVERY capability, forever: **REQUEST → EXECUTION → EXTERNAL EFFECT → INDEPENDENT READ-BACK → VERIFIED_SUCCESS / VERIFIED_FAILURE / UNKNOWN**, in the D-16 terminal vocabulary, **deny-by-default** (an unrecognised or absent read-back is UNKNOWN, never success; UNKNOWN → HOLD → reconciliation, never auto-promoted — §9). A 2xx / ack / executor return is *submission*, not verification. Where no independent oracle exists the effect is honestly **UNVERIFIABLE** (stated, never silently VERIFIED). **Send-corroboration is never delivery.** Canonized with the S4 opening (operator, 19 Aug 2026).
15. **Memory informs governance; memory never becomes governance.** A prior verified success is EVIDENCE for a proposal — never permission. The system must never learn "last time this worked, therefore I am allowed": no outcome memory, experience record, or reproduction fingerprint ever sets authority, approval, `confirmed`, policy, or admission; every consequential action re-derives authorization from the live substrate at execution time, regardless of history. Similarity to a past success NEVER auto-converts to certainty or permission. Canonized with the Phase-0 acceptance (operator, 19 Aug 2026).

## 3 · OPERATING PROTOCOL

- **Session ritual:** read CLAUDE.md → NP_STATE.md → BLOCKERS.md → `verify-freeze.sh` (capture output) → resume the current slice.
- **Autonomy:** report-and-continue through slices. Hard stops ONLY at: FG gates (token wait), real credentials/OAuth consent/tenant admin, any real external send, public deploys/DNS/money/signing certs, autonomy promotions ≥L4, commercial activation, push/history-rewrite/evidence-deletion.
- **Loop per task:** ORIENT → PLAN (acceptance criteria) → BUILD → PROVE (run + capture) → RECORD (evidence + NP_STATE.md + §1 here) → COMMIT → NEXT.
- **Commits:** one commit per completed slice (evidence doc included), conventional message `alive(s13): …`. Never push. Frozen touches only inside the §2.2 choreography.
- **Full-suite discipline (standing law, from the BRAIN-1 cssTokens catch):** any commit touching renderer code (`apps/desktop/src/renderer/**`) runs the FULL main `vitest` suite before landing — NEVER the `ui-tests` glob alone. Renderer-referenced source tests (e.g. `cssTokens.test.ts`) live in the main suite; the ui glob does not cover them, and "green" claimed off the glob is a false green.
- **Blockers:** 3 genuine fix attempts → BLOCKERS.md entry (symptom, attempts, hypothesis, what unblocks) → next unblocked task. Never idle, never fabricate.
- **Decisions:** every non-obvious technical choice → DECISIONS.md (context → decision → consequences).
- **This file is living:** Claude Code updates §1 (and only §1) each slice. §2, §4, §5 change only with the human's explicit approval.

## 4 · FULL-STACK WIRING DOCTRINE (why the audit found a brain with no hands)

Every slice lands **vertical** — never frontend-only, never main-only:
- **The wiring checklist for anything new:** shared contract (schema/types) → authz classification → honest tenancy declaration (from the *implementation*, not the plan) → registration through the secure bridge → main handler → renderer consumer → backend/infra when in scope → tests at every touched layer → e2e across them → trace fields → evidence.
- **No orphan modules.** Every new export gains a production caller in the same slice, or the slice ends with an explicit gate stating why not. This is the 41-package lesson: unwired code is simulation, not product. The 41 preview packages stay archived unless a real need produces a gated plan.
- **A layer touched without its test is not done.** Renderer work ships component + e2e tests; main work ships unit + contract tests; backend work ships migration + integration tests against real compose services (testcontainers), never mocks-as-backend.
- **Declarations describe reality.** `declareChannelResource` and every governance artifact records what code *actually does*, verified by reading it — a predicted declaration is fiction.
- **UI truth rule:** every status the renderer shows (Connected, Synced, Healthy, HELD, ACKNOWLEDGED, VERIFIED, NOT GOVERNED) is derived from evidence at the layer beneath, with a test asserting the derivation.
- **AuthStatus exhaustiveness (FG-6 standing rule):** there is NO exhaustive `switch`/`assertNever` over `AuthStatus`, so the compiler is not a backstop. Every FUTURE consumer that narrows `AuthStatus` MUST handle `'local'` explicitly — no fall-through `else` may silently treat a device-local principal as signed-out. A deliberate deny gets a deliberate label (classify it accepts-local vs authenticated-only, deny-by-default for anything backend-bound). The `local:` and `@device.invalid` namespaces are reserved and never stripped (DECISIONS D-12).

## 5 · ROADMAP — SLICES 11–50

Numbering is **canonical here** and continues the repo's actual history (the planning document's table numbers are superseded; its wave names and objectives are preserved 1:1 — Wave 5 = plan slices 18–20, Wave 6 = 21–25, Wave 7 = 26–28, Wave 8 = 29–31, Wave 9 = 32–34, Wave 10 = 35–37, Wave 11 = 38–40, Wave 12 = 41–43, Wave 13 = 44–46, Wave 14 = 47–49, Final = 50). Three deliberate merges: backend-revival+sync-proof (S18), backend-completion+disaster-recovery (S40), commercial-ops+SLOs (S49) — so the complete proof lands at exactly **SLICE 50**.

### OS TRACKS — approved amendment layers (per the §5 per-layer approval, 19 Aug 2026; full five-field text in `certification/source-update/ROADMAP-AMENDMENT-PROPOSAL-OS-TRACKS.md`)
Five OS-track layers add DEPTH to the existing waves — **no new wave numbers; the finish line stays S50**. Each carries its five acceptance fields (observable object · collection boundary · capability contract · verification method · failure/UNKNOWN state) and builds through full slice discipline + evidence + an FG gate for any frozen touch when its turn comes. **Entry into §5 ≠ execution.** The canonical definitions (NeuroPause OS · Live Brain) + the Environment-Intelligence binding rules (purpose-bound discovery pipeline · DISCOVER ≠ RECOMMEND ≠ BUILD · four data states HAVE/NEED/UNKNOWN/UNAVAILABLE · build-from-zero) head the amendment doc and bind every discovery layer.
- **L1 · Workspace Foundation** → Wave 6 (S23–27). **APPROVED.** Constraint (binding verbatim): tenant-scoped; READ/aggregate-only at this layer.
- **L2 · Environment Model / Graph** → Wave 9 (S34). **APPROVED.** Constraint: purpose-bound evidence only; the four states HAVE/NEED/UNKNOWN/UNAVAILABLE everywhere; UNKNOWN never silently becomes HAVE.
- **L3 · Environment Discovery** → Wave 9 (S36). **APPROVED.** Constraint: PURPOSE → DISCOVERY REQUEST → MINIMUM REQUIRED DATA → USER/POLICY AUTHORITY → COLLECTION → CLASSIFICATION → EVIDENCE; never a silent device scan; discovery cannot recommend or build.
- **L4 · Capability Graph** → S23 kit → S28 policy. **APPROVED.** Constraint: proposes routes over certified connectors + real BRAIN-1 lanes; cannot execute; cannot grant authority.
- **L5 · Purpose Engine** → Wave 7 (S28–30). **APPROVED.** Constraint: produces PROPOSALS only (HAVE/NEED/MISSING/SOURCE/BUILD/CONNECT/PERMISSION/VALIDATE/VERIFY); cannot itself source/build/connect/execute; every proposal traces to evidence + policy.
- **L6 · Live Brain** → Wave 9–10 → S50. **APPROVED IN PRINCIPLE, ENTRY DEFERRED** — enters §5 only after L1–L5 each have ≥1 CLOSED slice, then re-presented with its five fields refreshed against the real substrate. Standing constraints already binding: a LAYER over the governed runtime + the BRAIN-1 gateway; orchestrates by proposal only; never an execution authority; its state always traces to evidence.
- **F-S17-1** (reconcile onboarding "Try Free Locally" ⇄ `LocalModeBanner`) is folded into **S39**.

### WAVE 4 — FINISH THE ALIVE CHAIN (S11–S19)

**S11 — FG-2 + the data-only handler** · frozen: runtimeCore.ts (2 lines: import + push) · main
- Gate FG-2: two additive lines (import + `defs.push(...capabilityHandlers)`) beside the existing connectors push. Present verbatim diff + the exact def shape it imports; token: `AUTHORIZED: FG-2 — runtimeCore capability registration, two additive lines (import + push), per gate doc`. Refined landing (per human): the non-frozen module lands first as its own green commit (the choreography checkpoint; a one-commit declared-but-unregistered gap, covered by the gate doc), then the two frozen lines land in an isolated frozen-only commit; fallback to a single mixed commit if a guard makes frozen-only non-green (pre-authorized).
- New non-frozen `apps/desktop/src/main/capabilities/capabilityProposeIpc.ts`: `capabilityHandlers = [{ channel: CapabilityProposeM365Action, schema: CapabilityProposeM365ActionRequest, permission: 'connectors:manage', handler }]`. Handler: edge-validated request → `resolveCapabilitySelection` → `resolvePrincipal` → `buildM365ActionProposal` → `toWritePanelProposal` → data-only response; reason passthrough lossless (union equality already proven); sub-causes in `detail`.
- Tenancy: `declareChannelResource({channel, store: <what the handler ACTUALLY reads — verified from code>, effect:'read', reason})` + DECLARED_BASELINE 3→4, same commit.
- Pins (tests): no import path handler→executor/CST/admission; never sets `confirmed`; response carries no token/credential/callable; hostile params in → inert data out.
- Exit: choreographed commit bracketed by INTACT #3/#4; suites green; evidence with frozen/non-frozen split.

**S12 — Live delivery + panel feed** · renderer + main
- First production feed of `M365WritePanel.proposal`: a dev-triggered renderer path invokes `capability:m365.propose` with manual params; response prefills the panel; confirm continues ONLY through the existing Slice-7 → certified path to mock Graph.
- Typed UI states for all four refusal reasons + loading; hostile subject/body render as inert text (no HTML, no interpolation).
- **Comma hardening lands here:** producer rejects any single address containing a comma (INVALID_PARAMS) with a pinned test — must be green before S13 lets AI supply `to`.
- Exit: dev-app e2e propose → panel → confirm → mock execute → admission; evidence.

**S13 — AI structured intent generator** · main (assistant pipeline)
- `assistantMailSendIntent(userTurn, context)` → schema-constrained `{capabilityId, params:{to,subject,body}, purpose}` → zod → the same propose path. The generator gains zero authority.
- Trigger discipline: only the user's explicit live turn; NEVER synced connector content. Extend the AI-boundary corpus: hostile synced bodies → zero intents (permanent CI gate). Ambiguity → NEEDS_CLARIFICATION question; out-of-scope → UNSUPPORTED.
- Golden set ≥30 (positive/ambiguous/hostile/out-of-scope) with an honest accuracy report; if the model misses the bar under constrained decoding, report it — never loosen the schema.
- Exit: NL turn → proposal in panel (dev app); suites + corpus green; evidence.

**S14 — Full mock E2E (the loop closes)** · all layers
- Playwright in the real Electron app: typed NL → intent → propose → panel → human-style confirm click → certified executor → mock Graph → admission recorded. Video + screens in evidence. Negative e2e: hostile context → nothing appears; ambiguous → the assistant asks.
- Exit: TEST-VERIFIED full loop — "the brain isn't connected to the hands" is now false at test level. ⛔ Hard stop before anything real.

**S15 — First real email** ⛔ human at keyboard
- Prep: test-tenant + consent runbook, env wiring, compiled-in recipient allowlist = the human's own address, single-send, no retry storms. Human supplies creds and personally clicks confirm. One real email.
- Exit: LIVE-VERIFIED (Profile A — acknowledged) with message id.

**S16 — Read-back verification oracle** · main (+FG-3 if a frozen admission field is needed)
- `verifyEffect(execution)`: poll Sent Items by `internetMessageId`, bounded backoff, idempotent. States: EXECUTION_REQUESTED → EXECUTING → ACKNOWLEDGED → VERIFY_PENDING → VERIFIED_SUCCESS | VERIFY_FAILED; failure branch EXECUTING → UNKNOWN → HOLD (reconciliation operationalized in S22).
- Fault injection: dropped ack → UNKNOWN → hold → oracle resolves later. Any frozen admission-record field → FG-3 gate first.
- Exit: mock-proven machine; then (human-gated, S15 account) the **first VERIFIED_SUCCESS in product history**.

**S17 — Local-first mode (kill the sign-in wall)** · renderer + main
- No account → full product on local store; cloud features absent gracefully; one affordance: "Working locally — connect an account to sync." Every network call behind explicit connectivity+auth state; first-run onboarding for local mode.
- Exit: fresh clone → fully usable with networking disabled; Playwright `local-mode.spec`; walkthrough evidence.

**S18 — Backend revival + live sync proof** · backend + infra + main *(public deploy separately gated ⛔)*
- `infra/compose/`: postgres:16, redis, backend, MinIO, Caddy; healthchecks; `make up` → healthy. Migrations audited + deterministic seed; `/healthz` `/readyz`; structured logs; auth hardening (argon2id, refresh rotation, lockouts) — sign-in stays optional forever. pgBackRest → MinIO; `make backup` / `make restore-drill` (scratch restore, schema+count diff, verdict).
- Sync proof: two desktop instances ↔ compose backend via testcontainers; offline-edit replay; conflict decision (LWW vs Yjs → DECISIONS.md); companion LAN pairing e2e (QR → X25519 → roundtrip) + key rotation/revocation.
- Exit: one-command healthy stack, restore-drill evidence, sync + companion e2e, deploy runbook prepared for the gate.

**S19 — Truthful surfaces** · renderer
- Status honesty suite: every UI claim (backend up/down, connector governed / read-only / NOT GOVERNED, HELD vs ACKNOWLEDGED vs VERIFIED, mode) derived from the layer beneath with tests pinning the derivation. No fake Connected/Synced/Healthy/Verified — remove or gate any surface that can't prove its claim.
- The Obsidian Bridge visual rebuild may begin here **on the human's go** — UI follows wiring, never substitutes for it.

### WAVE 5 — DURABILITY + TRUSTED RECOVERY (S20–S22)

**S20 — Crash-safe action durability** · main (+backend where state crosses)
- fsync'd write-ahead admission journal. Crash-injection harness (SIGKILL ×N + fs-snapshot power-loss) at all seven boundaries: before admission · after admission/before execution · during execution · after external ack · before evidence persistence · after UNKNOWN · during reconciliation.
- Properties proven: no duplicate consequential effect, no lost admission, no false success, no orphaned action, no evidence corruption. Central claim: NeuroPause recovers truthfully without guessing whether an external effect occurred.

**S21 — Idempotency / duplicate-effect proof** · main + connector edge
- One idempotency key per authorized action, flowing to the connector (mail: internetMessageId strategy; others: client request id where the API supports it). Attack matrix with same request/proposal/decision/admission/key/connector/account under: double-click, renderer retry, IPC retry, process restart, network timeout, Graph timeout, executor retry, reconnect.
- Property: effect count ≤ 1 per authorized action — one of the strongest claims in the certification story.

**S22 — UNKNOWN → RECONCILIATION, operational** · main + oracle
- HOLD queue + reconciler driving the S16 oracle; terminals VERIFIED_SUCCESS / VERIFIED_FAILURE / UNRESOLVED; UNRESOLVED remains — never auto-promoted. Operator surface lists holds with age + next probe. Fault-injected soak proves no hold is lost or double-resolved.

### WAVE 6 — FIRST MULTI-CONNECTOR CERTIFICATION (S23–S27)

**S23 — Connector Certification Kit** · tooling
- A typed, reusable certification contract with all 14 fields: identity · account isolation · capability discovery · action identity · parameter schema · authority model · approval model · admission · execution · outcome · verification oracle · UNKNOWN handling · evidence · recovery. Test scaffold generator + evidence-pack template. Back-fill M365 mail.send as the reference certification. A connector is certified only when **all** fields are proven — OAuth working is not certification.

**S24 — Google (one bounded capability)** ⛔ creds/consent
- Calendar `create event` only. Full pipeline: discover → select → validate → propose → human review → confirm → govern → execute → verify (GET event by id oracle) → evidence. Kit pack complete.

**S25 — Slack (send message)** ⛔ creds
- Kit pack + specific proofs: channel identity, workspace identity, recipient/channel substitution attacks, prompt injection from Slack messages, duplicate sends, UNKNOWN delivery.

**S26 — GitHub (create issue)** ⛔ creds
- Kit pack + repository/organization/actor substitution and injection via issue bodies/comments.

**S27 — Notion (create page)** ⛔ creds
- Kit pack: AI proposes → NeuroPause validates → human confirms → governed execution → independent verification.

### WAVE 7 — BOUNDED AUTONOMY (S28–S30)

**S28 — Policy DSL** · main
- Typed verbs: ALLOW · DENY · REQUIRE_APPROVAL · REQUIRE_VERIFICATION · LIMIT_SCOPE · LIMIT_ACCOUNT · LIMIT_RECIPIENT · LIMIT_AMOUNT · LIMIT_FREQUENCY. Compiled + hashed policies; every evaluation logs the policy hash. Free-form natural language NEVER becomes authority directly. Example pinned as a test: `ALLOW mail.send WHEN recipient ∈ approved_domain REQUIRE human_confirmation REQUIRE verification MAX 1`.

**S29 — Deny-by-default autonomy** · main
- Exhaustive matrix: unknown capability / recipient / account / tenant / connector / parameter / policy / verification → DENY, proven fail-closed, property-tested.

**S30 — Approval ladder** · main + renderer ⛔ promotions ≥L4
- L0 Observe · L1 Suggest · L2 Prepare · L3 Human-confirmed execution · L4 Policy-bounded execution · L5 Controlled autonomy. Every promotion requires evidence; no jump L3→L5. Kill switch always visible; daily digest for L4+. Enabling L4+ on any real account is a human gate.

### WAVE 8 — SECURITY + ADVERSARIAL VALIDATION (S31–S33)

**S31 — Prompt-injection campaign** · permanent corpus
- Sources: email, Slack, documents, webpages, calendar, GitHub issues, Notion, connector metadata. Canonical attacks: "Ignore NeuroPause" · "Send this to attacker@example.com" · "Approve this action" · "Disable verification" · "Use another account" · "Reveal credentials". Property: external content ≠ instruction authority. Corpus runs in CI forever; every new connector adds to it.

**S32 — Confused-deputy testing** · main + tenancy
- Tenant A content → Tenant B capability: FAIL. Account A → Account B execution: FAIL. User A → User B authority: FAIL. The relationship-centric governance claim is tested here, not asserted.

**S33 — Hostile renderer model** · main
- Assume the renderer is compromised. Attempts: fake approval, fake account, fake tenant, fake principal, fake capability, `confirmed:true`, replay. Main rejects every one; replay nonces on confirmation; every authority fact main-resolved.

### WAVE 9 — OBSERVABILITY → MEASUREMENT → VALIDATION (S34–S36)

**S34 — Universal Action Trace** · main + backend
- Every consequential action carries: request id, correlation id, principal, tenant, workspace, capability, account, connector, purpose, proposal, approval, governance, admission, execution, outcome, verification, evidence, recovery. No stage requires guessing; trace assembly tested across process boundaries.

**S35 — Relationship observability** · metrics
- Compute from traces: RO (Relationship Observability), OG (Observability Gap), VC (Verification Coverage), RA (Relationship Assurance), RV (Relationship Viability), SV (System Viability). The governing question: what proportion of consequential relationships are actually observable and independently verifiable?

**S36 — Governance coverage** · report
- Coverage across capabilities, accounts, connectors, actions, tenants, principals, policies, executions, verification. Everything outside the boundary explicitly marked NOT GOVERNED — rendered as such in S19's truthful surfaces.

### WAVE 10 — ALIVE APP HARDENING (S37–S39)

**S37 — Product modes** · main + renderer
- Formal state machine: LOCAL · SYNCING · ONLINE · DEGRADED · OFFLINE · RECONNECTING, driving the UI. The user always knows the actual state; every mode transition tested; no fake states possible by construction.

**S38 — Offline consequential-action policy** · main + policy
- Explicit certified answers: offline proposals? offline approvals? offline execution? queueing? authority expiry? Default: offline ≠ execution authority for cloud effects unless a certified offline policy says otherwise. Queue semantics (if any) crash-proven via S20 harness.

**S39 — First-run experience** · renderer
- Install → open → local mode → workspace creation → capability discovery → optional connector connection → first safe proposal → human confirmation. Comprehensible without reading architecture documents; Playwright fresh-profile spec.

### WAVE 11 — BACKEND COMPLETE + DISTRIBUTION (S40–S41)

**S40 — Backend production-complete + disaster recovery** · backend + infra
- Full DR drill: backup → destroy → restore → verify schema → verify counts → verify critical evidence rows. Then crash-inject the desktop↔backend relationship (kill backend mid-sync, mid-admission-upload, mid-reconciliation) — client recovers truthfully.

**S41 — Distribution** ⛔ signing certs/money
- Reproducible artifacts (Windows/macOS/Linux per declared product scope) via CI matrix; verify artifact hash, version, signature, dependencies, configuration, upgrade, rollback. electron-updater beta channel proves an in-place upgrade AND a rollback. Signing scripts ready; certs at the gate.

### WAVE 12 — PILOT CERTIFICATION (S42–S44)

**S42 — Pilot tenant** ⛔ real people
- Formally bounded profile: tenant, users, roles, connectors, capabilities, policies, limits, retention, evidence, rollback, support.

**S43 — Pilot runbook**
- Must answer: who can connect · who can approve · what AI may propose · what NeuroPause may execute · what requires confirmation · what happens on UNKNOWN · how evidence is recovered · how access is revoked · how the pilot is stopped.

**S44 — Pilot evidence package**
- One complete package: architecture boundary, identity, capability discovery, governance, approval, admission, execution, verification, recovery, security, observability, logs, tests, known limitations. Here TEST-VERIFIED → LIVE-VERIFIED → PILOT-VALIDATED becomes meaningful.

### WAVE 13 — CERTIFICATION RE-RUN (S45–S47)

**S45 — Change-control assurance re-run**
- Audit the whole trail: frozen hashes, gate docs, tokens, approved changes, evidence, rollback paths — every frozen commit bracketed by INTACT records, every token quoted.

**S46 — Full regression**
- lint · typecheck · unit · integration · UI · Playwright · security · injection corpus · tenant isolation · crash recovery · connector certifications · backup/restore · offline · online · upgrade · rollback. One report, all honest.

**S47 — Certification boundary statement**
- The final statement: NeuroPause OS is certified only for the explicitly declared deployment profile, connector set, capability set, governance policies, execution paths, verification oracles, and evidence corpus. Everything outside it: NOT CERTIFIED.

### WAVE 14 — COMMERCIAL ALIVE (S48–S49)

**S48 — First commercial deployment** ⛔ (only after pilot validation)
- commercial tenant → licensed connector → governed action → human confirmation → execution → verification → evidence.

**S49 — Commercial operations + SLOs**
- Tenant management, billing (Razorpay), license enforcement, support, incident response, audit export, backup/restore, access revocation. SLOs measured-then-targeted (never invented before baselines): availability, proposal/governance/approval/execution/verification latency, UNKNOWN resolution, recovery, evidence durability.

### FINAL — NEUROPAUSE OS 1.0

**S50 — The complete proof**
- Demonstrate, end to end, inside the declared boundary: HUMAN → PRINCIPAL → USER INTENT → AI (intelligence only) → STRUCTURED PROPOSAL → CAPABILITY VALIDATION → POLICY/GOVERNANCE → HUMAN CONSENT → ADMISSION → EXECUTION → OUTCOME → VERIFICATION → (SUCCESS → EVIDENCE | UNKNOWN → HOLD → RECONCILIATION → FINAL TRUTH).
- The master assurance question, answered with evidence: *Can NeuroPause prove, within its declared control boundary, that every consequential action is correctly identified, authorized, governed, approved where required, executed once, independently verified where possible, recovered when uncertain, and durably evidenced?* That is the finish line.

## 6 · GATE REGISTRY

- **FG-1 (closed):** `capability:m365.propose` contract — `channels.ts` + `contracts.ts`. Token honored; landed `7fc53e2`, INTACT 19e9dcd → 8afb562.
- **FG-2 (closed):** `runtimeCore.ts` registration — 2 additive lines (import + `defs.push(...capabilityHandlers)`). Token `AUTHORIZED: FG-2 — runtimeCore capability registration, two additive lines (import + push), per gate doc` honored; landed `5534c45` (+ pre-authorized non-frozen typing-fix fallback), INTACT 2668ab8 → aff5d13. Evidence `c8e42f4`.
- **FG-3 (closed):** additive optional `AssistantEnvelope.mailIntent` field in `packages/shared/src/types/assistant.ts` — the Slice-13 assistant→panel carrier (one surface via the S12 feed; DECISIONS D-7). Token `AUTHORIZED: FG-3 — AssistantEnvelope.mailIntent additive optional field, per gate doc` honored; landed `de64dd0` (+ coupled non-frozen wiring), INTACT 92a99c8 → 1ed71cc (BASELINE-52d9a12099f3). Evidence `…SLICE-13-AI-STRUCTURED-INTENT-EVIDENCE.md`.
- **FG-4 (closed):** `connectors/index.ts` first-real-send guard hook — compile-stripped, dynamically-imported gated call to the non-frozen `firstRealSendGuard` (allowlist all fields + single-send latch). Token `AUTHORIZED: FG-4 — connectors/index.ts first-real-send guard hook, compile-stripped, per gate doc` honored under 7 conditions; landed `b0ac3c5`, INTACT befabe0 → ad81825. Never weakens the certified path; inert unless `NEUROPAUSE_FIRST_REAL_SEND=1`.
- **FG-5 (anticipated):** frozen admission-record field for verification state, if S16 needs it.
- **Standing human gates:** every FG token · real credentials / OAuth app registration / tenant consent · any real external send · public deploy + DNS (`api.neuropause033.com`) · money (VPS, Apple Developer, Windows signing, GPU hosting) · autonomy ≥L4 enablement · pilot with real people · commercial activation · push / history rewrite / evidence deletion.
