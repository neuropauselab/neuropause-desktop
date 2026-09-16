# SESSION 116 — REAL KEYCHAIN CERTIFICATION + SECURITY CAPABILITY CONVERGENCE

**Date:** 2026-09-04 · **Branch:** `cert/data-import-cst-integration`
**Label:** TEST-VERIFIED (Linux CI). Real-macOS keychain proof = **OPERATOR-PENDING** (Linux sandbox has no safeStorage/keychain; not faked).

---

## OBJECTIVE 1 — REAL macOS KEYCHAIN CERTIFICATION → OPERATOR-PENDING
Environment measured: Linux aarch64 sandbox; `apps/desktop/node_modules/electron/dist` is empty (macOS-only install). The real Electron runtime + `safeStorage`/OS keychain **cannot be exercised here** — consistent with every prior real-Electron-on-macOS gate in this repo.

The harness `apps/desktop/e2e/s113AuditSignJourney.e2e.cjs` was re-read and is CORRECT: run1 provisions a durable Ed25519 key via REAL `safeStorage.encryptString` → signs an audit head → persists; run2 recovers via REAL `safeStorage.decryptString` across a genuine process restart → verifies valid head SIGNED → tampered head FAILS. It exercises the actual keychain (`safeStorage.isEncryptionAvailable()` guarded) and prints `S113 RESULT = GREEN` only on success.

**Operator runbook (macOS, from apps/desktop):**
```
ELEC=node_modules/electron/dist/Electron.app/Contents/MacOS/Electron
NP_S113_DIR=$(mktemp -d)
env -u NP_E2E_BUILD "$ELEC" e2e/s113AuditSignJourney.e2e.cjs --run=1 --dir="$NP_S113_DIR" ; echo "run1=$?"
env -u NP_E2E_BUILD "$ELEC" e2e/s113AuditSignJourney.e2e.cjs --run=2 --dir="$NP_S113_DIR" ; echo "run2=$?"
```
GREEN only if run1 exits 0 AND run2 prints `S113 RESULT = GREEN` and exits 0.

**Honest scope of the harness:** it proves the H5+H6 primitive (safeStorage key provision→recover across restart + Ed25519 sign/verify/tamper). The full S115 path — `AuditLog.integrityStatus()` → renderer `{state, algorithm, keyId, keyVersion}` only — is **TEST-VERIFIED** (S115 signing 10/10 + UI 4/4), not yet bundled into a single macOS harness. A future harness driving the built S115 modules end-to-end is recommended (S117 candidate). **Not claimed GREEN.**

## OBJECTIVE 2 — AUDIT-OPS REGRESSION → GREEN (no regression)
Focused suites re-run: S104 architecture-defeat matrix 8/8; S115 signing 10/10; auditLog 7/7; signedAuditChain 12/12; routerClassification 4/4; runtimeAuthz 13/13; channelStoreCoverageGate 4/4 (6/198 coverage); round11PublicChannelClosure 28/28; round12AllowlistSweep 37/37 → **123 passed**. UI audit panel 4/4. Tenant isolation sample (channelAuthorityTenancy + webhookEgressTenancy) 46/46. Renderer secret-exposure boundary + fail-closed verification: re-proven by the S115 UI panel test and the S116 abac-explain security tests. No regression.

## OBJECTIVES 3/5/6/7/8/9 — CENSUS + CLASSIFICATION (source-verified, read-only)

### packages/security (delegation / JIT / impersonation)
100% UNWIRED into apps/desktop (only negative forbidden-import assertions reference it). The pure policy-simulation core was already harvested to `abac.ts` (S110).

| File | Capability | Class | Note |
|---|---|---|---|
| `authz.ts` | AuthorizationEngine: `delegate`, `grantJit`, `impersonate` | **B (policy) / C (engine)** | GRANT authority — must NOT activate without operator policy; also a 2nd RBAC∧ABAC engine |
| `policy.ts` | PolicyEngine simulate/test/evaluate | **C (spent)** | pure core already harvested → abac.ts |
| `matrix.ts` | SECURITY_MATRIX / THREAT_MODEL (static) | **A** | read-only reference ledger |
| `sessions.ts` | SessionManager | **C** | duplicates live authService/session isolation |
| `identity.ts` | IdentityRegistry (assignRole/setState) | **C** | duplicates live identityStore; mutates roles |
| `tenancy.ts` | TenantIsolation.delegate (cross-tenant grant) | **B/C** | GRANTS cross-tenant — policy-gated |
| `aiGovernance.ts` | AiGovernance.record | **C** | overlaps live AI governance |

**Delegation / JIT / impersonation verdict:** all GRANT authority → **BLOCKED-POLICY**, must not activate without an explicit operator policy (they would also constitute a second authorization engine). Retirement candidates (Class E) pending operator approval: `authz.ts`, `sessions.ts`, `identity.ts`, `tenancy.ts` (duplicate live infra); `matrix.ts` kept as read-only reference.

### packages/persistence
PREVIEW SQL/PGlite stack, imported by cloud packages only, never by apps/desktop. `createPersistenceLayer`/`SqlDriver`/repositories/`EventStore`/`BackupManager`/`TenantRegistry` = **C (second spine — STOP)**. `schema.ts` = **E**. The only portable idea (event schema-version + upcaster-on-read) needs a versioning/replay policy → **B, memo** (`DECISION-MEMO-S116-PERSISTENCE.md`). The tamper-evidence hash was already harvested (S109). No safe Class-A slice today.

### packages/ai-runtime
PREVIEW (`0.0.0-preview.1`, "no real LLM calls", FakeProvider only), never imported by apps/desktop. `createAiRuntime`/`AgentRuntime`/`ToolRuntime`/`WorkflowEngine`/`ConnectorRuntime`/`InferencePipeline`/`GovernanceRecorder` = **C — second AI runtime / autonomous-execution risk — must NOT activate**. Safe pure slices (**A**, future harvest): `estimateCost`, `estimateTokens`, `withTimeout`, `ConversationManager`/`ContextManager` (plan/transcript formatters), and the `ToolDefinition`+Zod `safeParse` argument-validation pattern. No dry-run/simulation mode exists to lift. No autonomous execution introduced this session.

### connectors (Objective 8)
S114 verified webhook→event path preserved untouched. No consequential connector authority widened; M365 executor authority unchanged. Remaining connector harvest = read-only/observability first, consequential writes require explicit consequence/reversibility policy (unchanged posture).

### ERP/CRM/HR/Finance (Objective 9)
Certified transaction spine untouched. All undefined approval/SoD/threshold/reversal/posting-ownership/accounting/autonomy remain BLOCKED-POLICY and documented (S92–S104 memos). No accounting or authority policy invented.

## OBJECTIVE 4 — ABAC DECISION GATE → MEMO (`DECISION-MEMO-S116-ABAC.md`)
abac.ts is inert (not wired). Correct enforcement choke point identified: `runSecureHandler` in `secureBridge.ts`, immediately after the RBAC `deps.authorize`, RESTRICT-only via `isAbacPermitted`. Every attribute-population contract (subject/resource/action/environment), the ABAC policy registry+persistence, the RESTRICT-only composition rule (`not-applicable` must not block), the tenant-boundary decision, and the audit contract are UNDEFINED → operator policy required. Not wired. No policy invented.

## IMPLEMENTED (smallest safe slice) — advisory ABAC decision EXPLANATION
Priority #1 (security/authorization safety), the exact "read-only security decision/explanation/simulation capability" named as the safe target. Added to the already-live `apps/desktop/src/main/security/abac.ts` (pure, zero imports — preserves the S110 structural invariant):
- `explainAbacDecision(policies, req): AbacExplanation` — per-policy, per-condition trace (targetMatched, applicable, each condition `held` + `attributeMissing`) + the deny-wins decision + fail-closed `permitted` + human summary.
- `AbacPolicySet.explain(req)` parity method.
- Types `AbacExplanation`, `AbacPolicyTrace`, `AbacConditionTrace`.

**Safety properties (tested):** grants NOTHING (no roles/token/grant/permission fields — top-level keys exactly `{decision, permitted, decidingPolicyId?, policies, summary}`); never echoes RESOLVED request attribute values (only held/missing booleans + the policy's own declared value) — proven with a sensitive-marker leak test; fail-closed (`permitted === isAbacPermitted` for permit/deny/not-applicable); no second engine; no frozen change; no new channel. Wiring-doctrine note: no live enforcement consumer by design — it is part of the enforcement-gated ABAC workbench (S110); its consumer is the future operator access-preview surface, gated behind `DECISION-MEMO-S116-ABAC.md`.

## TESTED
abac.test.ts 11/11 + abacExplain.test.ts 9/9 = **20/20**. Objective-2 regression 123 + UI 4 + tenant 46. typecheck node 0; lint 0; gate-detector PROCEED (both files non-frozen).

## STATUS
- **S116 STATUS: TEST-VERIFIED**
- **REAL-ELECTRON: OPERATOR-PENDING** (macOS keychain; harness ready + runbook above; not faked)
- **IMPLEMENTED:** advisory `explainAbacDecision` + `AbacPolicySet.explain` (pure, read-only, zero authority)
- **TESTED:** 20/20 abac + 173 regression (no regression)
- **HARVESTED:** ABAC decision-explanation capability (from the S110 ABAC workbench lineage)
- **BLOCKED-FROZEN:** none (no frozen change this session)
- **BLOCKED-POLICY:** ABAC enforcement wiring; delegation/JIT/impersonation; cross-tenant delegation; event schema-versioning/upcaster; all ERP undefined approval/SoD/threshold/reversal/posting/accounting/autonomy
- **OPERATOR-PENDING:** real macOS keychain journey (s113 harness)
- **DEFERRED:** ai-runtime pure estimator/validator slice; full S115-modules macOS harness; persistence upcaster (memo)

**Capability activated this session:** Security = advisory ABAC decision explanation (read-only). Persistence = none (memo). AI = none. Connector = none (S114 preserved). ERP/CRM/HR = none (spine untouched).

## UPDATED 46-PACKAGE / 4-APP CONVERGENCE MATRIX (delta)
- **apps:** desktop = canonical live; backend/cloud/mobile = companion/cloud, unchanged.
- **Harvested-to-live (cumulative):** ckdl TrustModel (S108), ABAC eval (S110) + **ABAC explanation (S116)**, Ed25519 audit signing (S111), envelope crypto/KEK-DEK (S112), signed audit chain + durable key (S113/S115), domain event-log tamper-evidence (S109), webhook event port (S114).
- **packages/security:** delegation/JIT/impersonation = BLOCKED-POLICY; identity/sessions/tenancy/authz/policy = duplicate (C→E pending approval); matrix = read-only reference (A).
- **packages/persistence:** parallel SQL spine = do-not-adopt (C); upcaster idea = memo (B).
- **packages/ai-runtime:** second AI runtime = do-not-activate (C); pure estimators/validator = future A.
- **No package deleted or retired** (retirement remains operator-approval-gated).

## TOP 3 HIGHEST-VALUE SAFE CAPABILITIES FOR S117
1. **AI proposal cost/usage annotator + tool-argument-schema validator** (pure `estimateCost`/`estimateTokens` + `ToolDefinition`+Zod `safeParse` from ai-runtime) — annotate/validate proposals with zero side effects, no second runtime, no autonomous execution. Priority #3 (AI capability infrastructure), fully safe.
2. **Full S115-modules macOS keychain harness** — drive the real `DurableAuditKeyProvider` + `AuditLog.integrityStatus` end-to-end (including the four-field renderer surface) across a real restart, closing the O1 scope gap. Priority #1/#2 (security + persistence durability).
3. **ABAC advisory read surface (operator access-preview)** — a governed READ-ONLY IPC/UI exposing `explainAbacDecision` (requires one FG channel + token; still zero authority). Priority #1 (security), gives the S116 explanation a live consumer.
