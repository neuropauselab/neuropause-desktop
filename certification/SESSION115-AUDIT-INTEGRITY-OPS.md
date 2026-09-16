# SESSION 115 — AUDIT INTEGRITY + SECURITY OPERATIONS CONVERGENCE

**Date:** 2026-09-04
**Branch:** `cert/data-import-cst-integration`
**Frozen commit (isolated):** `5875394` — `packages/shared/src/ipc/channels.ts` (+2 lines, per token)
**Token honored:** `AUTHORIZED: FG-S114-AUDIT-STATUS channels.ts security:auditIntegrity.status read-only channel, per gate doc`
**Label:** TEST-VERIFIED (Linux CI). Real-Electron macOS keychain proof = **OPERATOR-PENDING** (see §7).

---

## 1 · OBJECTIVE

Operationalize the harvested H5 (Ed25519 audit-chain signing) + H6 (durable OS-keychain key) work into a **live, read-only** security-operations surface, without a second audit system, a second key store, or any exposure of secret material. Wire the signed audit chain into the safest existing consumer, expose a governed read-only status channel, render it in the operator UI, and prove it adversarially.

## 2 · WHAT LANDED

### 2.1 Frozen (isolated commit `5875394`, per token)
`packages/shared/src/ipc/channels.ts` — two additive lines only:
- `IpcChannel.SecurityAuditIntegrityStatus = 'security:auditIntegrity.status'`
- the same member appended to `RUNTIME_INVOKABLE_CHANNELS`.

### 2.2 Non-frozen accompaniment (this session)
- **`workforce/governance/auditLog.ts`** — the safest existing consumer (a single `AuditChain`, a flat `AuditFile`, one file per tenant). Additive optional `AuditFile.signature`; `attachSigningKey(key)` (called before `load()`); `integrityStatus(): AuditIntegritySurface` verifying the LIVE chain (hash chain + Ed25519 head signature) and returning **only** `{state, algorithm, keyId, keyVersion}`. `load()` recovers the persisted signature (absent ⇒ UNSIGNED). `persist()` re-signs the head when a key is attached. Fail-closed everywhere.
- **`security/signedAuditChain.ts`** — `signAuditChainHead<T>` made generic (was `AuditChain<unknown>`, which an invariant `AuditChain<WorkforceAuditEntry>` could not satisfy).
- **`workforce/index.ts`** — provisions the durable Ed25519 key via `DurableAuditKeyProvider` over `credentialStore` (OS keychain) and `attachSigningKey`s it before the audit log loads; registers the read-only handler `{ channel: SecurityAuditIntegrityStatus, schema: EmptyRequest, handler: () => auditLog.integrityStatus() }` on the existing `workforce.handlers` array (no second frozen edit); and `declareChannelResource(...)` for the new channel (reads `workforce-governance-audit`, effect `read`).
- **`ipc/runtimeAuthz.ts`** — classifies the channel `operations:read` (deny-by-default preserved; `assertAllChannelsClassified` green).
- **`renderer/src/lib/ipc.ts`** — `ipc.security.auditIntegrity()` accessor (uses `rawInvoke` — the channel is intentionally NOT added to the frozen `IpcResponseMap`; the response is typed at the accessor instead).
- **`renderer/src/operationsPlatform/AuditIntegrityPanel.tsx`** — read-only operator panel; renders SIGNED / UNSIGNED / VERIFICATION_FAILED with algorithm/keyId/keyVersion; mounted in `EopsPlatformTab`. Never hardcodes success.

## 3 · SECRET-EXPOSURE BOUNDARY (the central safety property)

The status channel returns exactly four fields: `state`, `algorithm`, `keyId`, `keyVersion`. It NEVER returns the private key PEM, the KEK, the DEK, any credential, the chain head, or the audit entries. Proven at two layers:
- **Main:** `auditLog.integrityStatus()` constructs the surface from `verifyAuditChainIntegrity(...)` and spreads only the four safe fields.
- **Renderer:** `AuditIntegrityPanel` reads only the four fields; a defense-in-depth UI test injects `privateKeyPem`/`signature` into the response and asserts they never appear in the rendered DOM.

## 4 · ADVERSARIAL TESTS

**`workforce/governance/auditLogSigning.test.ts` (10/10):** UNSIGNED when no key (truthful, not fabricated); SIGNED and survives persist→reload; VERIFICATION_FAILED on a tampered entry (chain breaks), a forged/mutated signature, a different keypair, a wrong key version, a removed entry, a reordered entry; the exposed surface carries ONLY the four safe fields (no PEM, no signature bytes, no head, no entries); a malformed persisted signature fails closed (no throw).

**`ui-tests/auditIntegrityPanel.test.tsx` (4/4):** SIGNED renders algorithm/key metadata from the governed read; a tampered chain visibly reads VERIFICATION FAILED (never hardcoded signed); UNSIGNED reads truthfully with no key metadata; injected secret-shaped fields never render.

All failures are **fail-closed**: an unrecognized or invalid state is VERIFICATION_FAILED, never SIGNED.

## 5 · VERIFICATION (Linux CI)

- Focused signing suite: **10/10**; existing `auditLog.test.ts` + `signedAuditChain.test.ts`: **19/19** (no regression).
- Channel classification + governance: `routerClassification`, `runtimeAuthz`, `round11PublicChannelClosure`, `round12AllowlistSweep`, S104 `architectureDefeatMatrix` — **90/90** (S104 8/8 intact).
- **Channel→store coverage gate:** the new authority-gated channel raised the sensitive surface 197→198; DECLARED with the channel (`declareChannelResource`), so both baselines moved deliberately (`SENSITIVE_BASELINE` 197→198, `DECLARED_BASELINE` 5→6). Coverage now **6/198 (3.0%)** — gate green.
- **Full main suite** (sharded 8×, sandbox fd-limit workaround; equivalent coverage): **1017 files, all pass** (7 skipped).
- **UI suite:** 81 files + new panel test = all pass.
- `tsc` node + web + shared: **0**. eslint: **0**. gate-detector: channels.ts FROZEN (authorized by token), all other touched files PROCEED.

## 6 · CONVERGENCE POSTURE

This is the live operationalization of the H5+H6 harvest arc: one canonical audit chain, one durable OS-keychain key, one governed read-only status surface. No duplicate audit infrastructure, no invented policy, no package deletion/retirement. The signed chain now has a live consumer (`auditLog.integrityStatus()`) and a live operator surface — advisory/observational only, zero authority granted, zero secret exposure.

## 7 · OPERATOR-PENDING (not claimed GREEN)

The durable Ed25519 key is provisioned through `credentialStore` → Electron `safeStorage` → the OS keychain. That path cannot be exercised in the Linux CI sandbox (no macOS keychain / safeStorage). The end-to-end **real-Electron macOS** proof — provision key in the OS keychain, record governed audit entries, restart, verify SIGNED across a real relaunch, and confirm the status channel returns only the four safe fields on a fresh profile — remains **OPERATOR-PENDING**. It must be run on macOS and MUST NOT be reported GREEN until `safeStorage` is actually exercised. All in-process tests use a real generated Ed25519 keypair (`generateAuditSigningKey`), not the keychain.

## 8 · CARRIED (unchanged)
FG-S114-WEBHOOK-EVENT-TYPE (optional); ABAC enforcement (operator decision); connector consequence/reversibility policy; S99–S103 policy-open authority layers.
