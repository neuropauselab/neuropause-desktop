# SESSION 120 — LIVE AI REVIEW + CONNECTOR LINEAGE SURFACE

**Date:** 2026-09-04 · **Branch:** `cert/data-import-cst-integration`
**Label:** TEST-VERIFIED (Linux CI). Real macOS keychain proof = **OPERATOR-PENDING**.

Two S119 capabilities became real product surfaces this session.

## 1 · AI PROPOSAL METADATA — now displayed in the confirmation UI (FG-S119 used)
- **Frozen (isolated commit `5c1b3bd`, per token `AUTHORIZED: FG-S119-BRAINREVIEW-METADATA`):** one additive optional `metadata` field on `CapabilityProposeM365ActionResponse.brainReview` in `packages/shared/src/ipc/contracts.ts` — `{ estimatedTokens, estimatedCostUsd, pricingKnown, estimateOnly:true, argsValid }`.
- **Non-frozen wiring:** `capabilityProposeIpc` maps the S118 `buildProposalMetadata` output (already computed on the live propose lane) into `brainReview.metadata`; `BrainReviewCard` renders one read-only "AI estimate (advisory)" row (tokens · cost/estimate-only · arguments valid|invalid). Renderer never recalculates; reuses `ai/pricing.ts` via S117. No new pricing/token system.
- **Advisory + decision-neutral:** the field carries no authority/allow/permission/grant, no tenant/principal, no recipient/body, no credential; it influences no authorization/approval/policy/execution. The governed propose → confirm → CST → admission flow is unchanged (absent metadata ⇒ panel behaves exactly as before).

## 2 · CONNECTOR INBOUND LINEAGE — live governed read surface (no frozen change)
Exposed the S119 `readInboundLineage` as a **sibling read operation** `QueryInboundLineage` on the EXISTING governed `platform:command.dispatch` READ branch (like S32/S35) — NO new channel/command/bus/store/framework.
- `operationalRead.buildInboundLineage(source, tenantId, params)` projects the S119 lineage over the ONE live `EventBus` ring (exposed non-frozen via `platform/platformBusRef.ts`, set at platform init — a reference to the single bus, not a second bus).
- Tenant is the **server-resolved principal's** (`principal.tenantId`), never a renderer claim; `claimedTenantId` mismatch → `TENANT_SCOPE_VIOLATION`; unauthenticated → `UNAUTHENTICATED`; missing `operations:read` → `UNAUTHORIZED`. Bounded, sanitized; `dedupeRef:null` preserved (S114 event carries none — not invented). No bound bus ⇒ honest empty (fail-closed).
- S114 verification/dedupe behavior untouched (router/verify not modified). Renderer accessor + minimal UI = **S121 follow-up** (the governed read is live now; a dedicated panel is additive UI).

## Security / governance (proven)
- **AI metadata:** cannot grant authority (no authority fields — tested), cannot bypass RBAC/CST/approval (governed flow unchanged; metadata is display-only), cannot trigger execution, no proposal secret leaked (recipient/body never in metadata — S118 tests).
- **Connector lineage (session120 test, 7):** renderer cannot choose tenant; tenant B cannot read tenant A; forged payload tenant cannot change the authoritative bus-stamped tenant; unauthenticated/unauthorized fail closed; malformed events dropped; no credential/secret in rows; read-only (no ERP mutation — structural import guard).
- Preserved: RBAC ∧ ABAC(advisory) ∧ CST ∧ approval. ABAC enforcement NOT activated; delegation/JIT/impersonation NOT activated; ai-runtime NOT activated; persistence SQL spine NOT adopted.

## Tests / results
- Focused: session120 lineage read 7/7; connectors/inbound/lineage 9/9; operationalRead + delivery + brainProposeLane + proposeBoundary green (66 in the combined focused run); BrainReviewCard UI 5/5 (+ m365WritePanelBrainReview 3/3).
- **Full main: all 8 batches, 10,663 passed / 7 skipped.** **Full UI: 82 files, 466 passed.**
- typecheck node+web+shared **0**; lint **0**; gate-detector: `contracts.ts` FROZEN (authorized), all other changed files PROCEED.
- Tenant isolation: PASS. Adversarial security: PASS. macOS keychain: OPERATOR-PENDING (Linux sandbox; not faked).

## Frozen gates
- **Used:** `FG-S119-BRAINREVIEW-METADATA` (contracts.ts, isolated `5c1b3bd`).
- **Not needed:** connector lineage used the existing dispatch read branch (no frozen change).

## Files changed
- Frozen: `packages/shared/src/ipc/contracts.ts` (brainReview.metadata).
- Non-frozen: `platform/platformBusRef.ts` (new), `platform/index.ts` (set ref), `platform/command/operationalRead.ts` (QueryInboundLineage + buildInboundLineage), `ipc/handlers/platformCommandIpc.ts` (route), `ipc/handlers/session120InboundLineageRead.test.ts` (new), `capabilities/capabilityProposeIpc.ts` (map metadata into brainReview), `renderer/connectors/BrainReviewCard.tsx` (read-only row), `ui-tests/brainReviewCard.test.tsx` (metadata tests), `certification/SESSION120-…md`.

## Convergence matrix (delta)
- **AI:** S117/S118 advisory metadata now DISPLAYED in the live confirm UI (implemented→user-visible).
- **Connectors:** S119 lineage now a LIVE governed read (`QueryInboundLineage`) reusing the platform dispatch branch + the one EventBus ring — no duplicate framework; S114 preserved.
- **Security/persistence/ai-runtime:** unchanged (ABAC advisory; SQL spine C; ai-runtime C). No package deleted/retired.

## Short convergence census (A/B/C/D/E) — candidates for next
- **A (safe now):** connector-lineage read-only UI panel (accessor + panel over `QueryInboundLineage`); full S115-modules macOS keychain harness.
- **B (policy/architecture):** ABAC enforcement wiring; connector inbound dedupe reference; event schema-version/upcaster; ERP undefined approval/SoD/threshold/reversal/posting/accounting.
- **C (duplicate/do-not-adopt):** packages/ai-runtime runtime; packages/persistence SQL spine; duplicate connector/discovery packages.
- **D (preview/scaffolding):** ai-runtime sessions/memory stubs; persistence cache/objectStore S3.
- **E (retirement, operator-only):** packages/security identity/sessions/tenancy/authz duplicates (NOT retired).

## STATUS
- **S120 STATUS: TEST-VERIFIED**
- **AI metadata live/display: LIVE** (frozen field used; rendered read-only in confirm panel)
- **Connector lineage live/read-surface: LIVE governed read** (`QueryInboundLineage`); dedicated UI panel = S121
- **REAL MAC KEYCHAIN: OPERATOR-PENDING**
- **Remaining gates:** OPERATOR (macOS keychain); POLICY (ABAC enforcement, dedupe ref, ERP undefined); FROZEN (none outstanding beyond the used one).

## TOP 3 SAFE S121 CANDIDATES
1. Connector-lineage read-only UI panel (renderer accessor + minimal panel over the live `QueryInboundLineage`).
2. Full S115-modules macOS keychain harness (operator-run) — close the O1 end-to-end gap.
3. Inbound dedupe-reference contract (decision memo → then a durable idempotency ref on the S114 event, additive) so lineage `dedupeRef` becomes non-null.
