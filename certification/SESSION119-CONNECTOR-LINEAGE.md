# SESSION 119 — REAL SECURITY PROOF + CONNECTOR LINEAGE

**Date:** 2026-09-04 · **Branch:** `cert/data-import-cst-integration`
**Label:** TEST-VERIFIED (Linux CI). Real macOS keychain proof = **OPERATOR-PENDING**.

---

## OBJECTIVE 1 — MAC KEYCHAIN → OPERATOR-PENDING (not faked)
Shell is Linux aarch64 (`electron/dist` empty; no macOS `safeStorage`/keychain). The `s113AuditSignJourney.e2e.cjs` harness + runbook (SESSION116 §O1) are intact; SIGNED-after-restart / VERIFICATION_FAILED-on-tamper / UNSIGNED-no-key / four-field-only remain TEST-VERIFIED (S115 signing 10/10 + UI 4/4). The full S115-module macOS harness is the operator-run / S120 candidate. Not claimed GREEN.

## OBJECTIVE 2/3 — CONNECTOR INBOUND-EVENT LINEAGE → IMPLEMENTED (read-only, tenant-scoped)
Discovery confirmed the S114 router already emits, for a VERIFIED inbound delivery, one platform event `type:'connector.online'` with `metadata {connectorId, provider, tenantId (authoritative resolveTenantId, NOT payload), kind:'inbound_webhook', receivedAt}`. Every required lineage field is deterministically available from authoritative context — except a dedupe/idempotency reference, which the S114 event genuinely does not carry (marked `dedupeRef: null` ABSENT, never invented).

Implemented `apps/desktop/src/main/connectors/inbound/lineage.ts` — a PURE, read-only projection over the EXISTING per-tenant event ring (`EventBus.replay`, already tenant-scoped/fail-closed). No new connector framework, registry, discovery service, event bus, or event store.
- `projectInboundLineage(events, tenantId)` — filters verified inbound-webhook events, scopes on the AUTHORITATIVE bus-stamped `event.tenantId` (never payload), drops incomplete/foreign-tenant events, and emits a fixed row `{eventId, connectorId, provider, verifiedSource, receivedAt, tenantId, dedupeRef:null, credentialsPresent:false}`.
- `readInboundLineage(source, tenantId)` — reads the live ring for the active tenant; null tenant ⇒ `[]` (fail-closed). Reuses `EventBus.replay`; no new store or channel.

Constraints honored: never accepts tenant from payload; no credentials/raw authorization material (the source event carries none; the row has no field for any); does not change S114 verification semantics (router/verify untouched); creates no ERP transaction; grants no AI authority; lineage is description, never an authorization input.

Live consumer note (wiring doctrine): the projection/reader are production code with a test-driven proof over the real `EventBus`; a live IPC read channel + UI surface is an **FG-gated follow-up** (a new read-only channel touches frozen `channels.ts`). Exact FG request below.

## OBJECTIVE 4 — OPTIONAL AI DISPLAY → FG REQUEST, DEFERRED (no frozen edit)
Displaying the S118 advisory metadata in the confirm panel requires an additive optional field on the frozen `CapabilityProposeM365ActionResponse.brainReview` response contract (packages/shared). NOT edited without a token. Exact FG request:
- **Gate:** `FG-S119-BRAINREVIEW-METADATA`
- **Frozen diff (additive, optional):** add `metadata?: { estimatedTokens: number; estimatedCostUsd: number; pricingKnown: boolean; estimateOnly: true; argsValid: boolean }` to `CapabilityProposeM365ActionResponse.brainReview` in `packages/shared/src/ipc/contracts.ts` (advisory; no authority/secret/tenant field).
- **Token:** `AUTHORIZED: FG-S119-BRAINREVIEW-METADATA — additive optional brainReview.metadata advisory field, per gate doc`
- **Non-frozen accompaniment:** `toBrainReview` carries the metadata through; `M365WritePanel`/`EntraConnectorPanel` render it read-only.
Deferred; did not delay the connector work.

## OBJECTIVE 5 — ADVERSARIAL TESTING (lineage 9/9)
`connectors/inbound/lineage.test.ts` against the REAL `EventBus`: verified inbound projected for the reader tenant only; a reader cannot see another tenant's lineage (isolation); a webhook payload cannot forge tenant (authoritative bus stamp wins; forged tenant reads nothing); non-inbound events excluded; malformed (missing connectorId/provider) dropped fail-closed; duplicate deliveries stay distinct rows with `dedupeRef:null` (S114 dedupe semantics unchanged); no resolved tenant ⇒ `[]`; rows carry a fixed safe shape with no secret/token/signature/authorization/header/payload; STRUCTURAL import guard (only `@neuropause/shared` type; no store/command-bus/executor/router/verify). Lineage cannot mutate ERP (pure, no store import) and cannot grant AI authority (no authority field; not an authorization input).

## OBJECTIVE 6 — REGRESSION
Required named suites (S104 8/8 · signedAuditChain 12 · auditLogSigning 10 · abac 11+9 · proposalValidation 17 · brainProposeLane · lineage 9 · channelAuthorityTenancy) → **117 passed**. **Full main: all 8 batches, 10,656 passed / 7 skipped.** typecheck node+web **0**; lint **0**; gate-detector PROCEED (lineage.ts non-frozen). UI suite: not run — no renderer change. Build: compile gate = node+web typecheck; `out/` not rebuilt (preserves NP-008 armed build).

## STOP CONDITIONS — none hit
No new connector framework/registry/discovery/event bus/event store; no duplicate AI runtime; ABAC unchanged (advisory); no delegation/JIT/impersonation; no persistence SQL spine; no ERP/Finance/HR policy invented; no frozen file changed; no deletion/retirement; no notarization/release.

## STATUS
- **macOS keychain: OPERATOR-PENDING** · **S115 end-to-end: TEST-VERIFIED** (macOS run pending)
- **Connector lineage: IMPLEMENTED** (read-only, tenant-scoped, pure; live IPC/UI surface FG-gated follow-up)
- **AI: unchanged** (S118 metadata live on the propose path; display is `FG-S119-BRAINREVIEW-METADATA`, deferred)
- **Frozen gates requested:** `FG-S119-BRAINREVIEW-METADATA` (AI display), connector-lineage read channel (implicit follow-up). **Used:** none.
- **Tenant isolation:** PASS (lineage isolation proven over the real ring; channelAuthorityTenancy green)
- **Security/adversarial:** PASS (S104 8/8; signing/abac/proposalValidation green; lineage 9/9)

## PACKAGE CONVERGENCE DELTA
- **connectors:** inbound-event lineage now has a live read-only projection over the S114 event (reuses EventBus ring; no duplicate framework). S114 path untouched.
- **AI/security/persistence:** unchanged from S118 (ai-runtime C/do-not-activate; ABAC advisory; SQL spine C). No package deleted/retired.

## REMAINING GATES
- **OPERATOR:** macOS keychain journey (S115 end-to-end).
- **POLICY:** ABAC enforcement; delegation/JIT/impersonation; persistence upcaster; ERP undefined approval/SoD/threshold/reversal/posting/accounting; inbound-event dedupe reference (absent in S114 event — needs a dedupe contract if ever required).
- **FROZEN (requested, not used):** `FG-S119-BRAINREVIEW-METADATA`; connector-lineage read channel.

## TOP 3 SAFE S120 CANDIDATES
1. **Full S115-modules macOS keychain harness** (operator-run) — closes the O1 scope gap end-to-end.
2. **FG-S119-BRAINREVIEW-METADATA** — land the additive optional field + render S118 metadata read-only in the confirm panel (display the live advisory estimate/validation).
3. **Connector-lineage read channel + read-only UI** — an FG-gated governed read channel exposing `readInboundLineage` for the active tenant (tenant-scoped, advisory), giving the S119 projection a live surface.
