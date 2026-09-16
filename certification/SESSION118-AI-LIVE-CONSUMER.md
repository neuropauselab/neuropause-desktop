# SESSION 118 — LIVE AI PROPOSAL CONSUMER + CONNECTOR CONTEXT CONVERGENCE

**Date:** 2026-09-04 · **Branch:** `cert/data-import-cst-integration`
**Label:** TEST-VERIFIED (Linux CI). Real macOS keychain proof = **OPERATOR-PENDING**.

---

## PRIMARY OBJECTIVE — AI capability is now GENUINELY LIVE
The S117 advisory capability (`ai/proposalValidation.ts` `buildProposalMetadata`) is now consumed on the **real production propose path**, not just implemented:
- `liveBrain/brainProposeLane.ts` (`runBrainProposeLane`) now returns `{ review, metadata }` — after building the certified L6 proposal and stashing it for the FG-10 gate, it computes advisory `buildProposalMetadata` (token/cost estimate + Zod tool-argument validation of the proposed mail against the mail.send tool's own `MAIL_SEND_ARGS_SCHEMA`).
- `capabilities/capabilityProposeIpc.ts` (the live `capability:m365.propose` handler) consumes it: destructures `.review` (spread into the response exactly as before) and **logs** `.metadata` (estimate + arg validity) for operator/audit visibility **before confirmation**. Decision-neutral: the branch/return are unchanged; only what is RECORDED changed.

**Authority semantics unchanged.** The metadata is advisory only, never reaches the renderer (only `review` crosses the boundary), and gates nothing. The governed path stands: proposal → governed tool → authn/authz → policy → approval → CST → command → transaction → event/outbox → audit. No autonomous execution. No new runtime/registry/store/event bus/persistence.

## OBJECTIVE 2 — CONNECTOR: STOP + MEMO (not activated)
Source inspection: read-only connector capability discovery **already exists and is live** (`connectors/index.ts:505` `ConnectorsList` → `connectorService.list()`; `capabilities/capabilityDiscoveryService`), so a new discovery surface = duplicate infrastructure (STOP). Inbound-event lineage metadata would touch the preserved S114 verified path and needs a defined metadata contract (policy/architecture decision). Per the directive, this sub-objective STOPs with `DECISION-MEMO-S118-CONNECTOR.md` rather than inventing policy or a second framework. No connector consequential authority widened; S114 webhook verification/event behavior untouched.

## OBJECTIVE 3 — MAC KEYCHAIN → OPERATOR-PENDING
This session's shell is Linux aarch64 (no macOS `safeStorage`/keychain; `electron/dist` empty). Not faked. The `s113AuditSignJourney.e2e.cjs` harness + runbook (SESSION116 §O1) are intact; the full S115-modules end-to-end proof remains the operator-run / S119 harness candidate.

## OBJECTIVE 4 — ADVERSARIAL CERTIFICATION
- `brainProposeLane.test.ts` — NEW S118 case drives the REAL lane and proves it **actually consumes** `buildProposalMetadata`: metadata present, `advisory:true`, `estimateOnly:true`, `totalTokens>0`, `toolValidation.toolName==='mail.send'` + `ok:true`; NO authority-shaped fields (grant/permission/role/tenant/confirmed/authority/credential/allow); recipient + body never echoed in metadata (no leak). Existing lane pins updated to the `{review,metadata}` shape (mechanical) and all still green.
- `ai/proposalValidation.test.ts` (S117, re-run 17/17) — invalid/unknown/throwing tool schema fail closed; no authority; no principal/tenant param; structural import guard.
- `proposeBoundaryCharacterization.test.ts` — emitter map updated 6→7 (the one new advisory `log.info`); the propose path's emitter/level discipline re-pinned.
- Tenant scope: the lane keys on the authoritative `scope().workspaceId`; the AI proposal supplies no tenant/principal (metadata input is model/text/tool-args only). Connector context: not activated (memo).

## TESTS / RESULTS
- Propose/lane/AI focused suites: **109 passed** (incl. the new S118 metadata consumer test + updated characterization pins).
- S104 architecture-defeat matrix: **8/8**. proposalValidation: **17/17**.
- **Full main suite: all 8 batches, 10,647 passed / 7 skipped.**
- typecheck node + web: **0**. lint: **0**. gate-detector: PROCEED (both production files non-frozen).
- UI suite: **not run — no renderer file changed this session** (metadata never crosses to the renderer). Build: compile gate = node+web typecheck clean; `out/` deliberately not rebuilt (preserves the NP-008 armed ceremony build).

## STOP CONDITIONS — none hit
AI cannot execute without the governed path; cannot bypass RBAC/CST/approval; renderer supplies no tenant/authority; no secrets cross the boundary; no second runtime/registry/store/event system; no frozen files changed; no invented business policy; no connector consequential authority widened; no ERP accounting invented; no deletion/retirement.

## STATUS
- **S118 STATUS: TEST-VERIFIED**
- **REAL MAC KEYCHAIN: OPERATOR-PENDING**
- **IMPLEMENTED:** live consumption of `buildProposalMetadata` on the propose lane + IPC handler (advisory, decision-neutral)
- **TESTED:** 109 focused + 17 proposalValidation + S104 8/8 + full main 10,647/7-skip; typecheck+lint 0
- **HARVESTED:** (none new — S117 capability now activated as a live consumer)
- **BLOCKED-FROZEN:** none
- **BLOCKED-POLICY:** ABAC enforcement; delegation/JIT/impersonation; ai-runtime second runtime; connector inbound-event lineage contract; ERP undefined approval/SoD/threshold/reversal/posting/accounting
- **OPERATOR-PENDING:** real macOS keychain journey
- **DEFERRED:** connector lineage metadata (memo); full S115-modules macOS harness; ai-runtime pure estimator (superseded — token estimator already harvested S117)

**AI capability activated:** YES — advisory proposal metadata (estimate + tool-arg validation) now genuinely live on the propose path. **Connector:** NOT activated (memo — duplicate/contract-needed). **Security:** unchanged (ABAC advisory). **ERP/CRM/HR:** unchanged (spine untouched).

## FILES / COMMITS / GATES
- `apps/desktop/src/main/liveBrain/brainProposeLane.ts` (return `{review,metadata}` + `MAIL_SEND_ARGS_SCHEMA` + advisory `buildProposalMetadata`)
- `apps/desktop/src/main/capabilities/capabilityProposeIpc.ts` (consume `.review`; log advisory `.metadata`)
- `apps/desktop/src/main/liveBrain/brainProposeLane.test.ts` (shape update + S118 metadata consumer test)
- `apps/desktop/src/main/capabilities/proposeBoundaryCharacterization.test.ts` (emitter map 6→7)
- `certification/SESSION118-AI-LIVE-CONSUMER.md`, `certification/DECISION-MEMO-S118-CONNECTOR.md`
- Frozen gates used: **none.**

## CONVERGENCE MATRIX (delta)
- **AI:** S117 advisory proposal metadata is now a LIVE consumer on the propose path (implemented→live). ai-runtime runtime = C/do-not-activate (unchanged); pure estimators harvested (S117).
- **Connector:** read-only discovery already live (reused, not duplicated); inbound-event lineage = B/memo (S118).
- **Security:** ABAC advisory (S116) unchanged; delegation/JIT/impersonation BLOCKED-POLICY.
- **Persistence:** SQL spine C/do-not-adopt; upcaster B/memo.
- **No package deleted or retired.**

## TOP 3 SAFE CAPABILITIES FOR S119
1. **Full S115-modules macOS keychain harness** — real DurableAuditKeyProvider→keychain→AuditLog→integrityStatus→renderer four-field proof across restart (closes the O1 scope gap; macOS-operator run).
2. **Inbound-event lineage metadata contract + read-only advisory surface** (per DECISION-MEMO-S118-CONNECTOR) — define the contract, then a tenant-scoped read-only projection over the S114 event record.
3. **Surface AI proposal metadata to the confirm panel** — an FG-gated additive `brainReview.metadata` field so the estimate/validation is DISPLAYED (not only logged) before confirmation; zero authority, requires one frozen response-field token.
