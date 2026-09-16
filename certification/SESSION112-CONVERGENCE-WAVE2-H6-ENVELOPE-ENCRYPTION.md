# SESSION 112 — CONVERGENCE WAVE 2 · H6 ENVELOPE ENCRYPTION + KEK/DEK LIFECYCLE

One platform, action-oriented. **No package deleted/archived/excluded/retired · no second spine · no business-policy invented · no release work.** Baseline S111 GREEN (HEAD `<s111 head>`). `baseline.json` untouched.

**Headline (IMPLEMENTED · TESTED):** H6 harvested — **envelope encryption + KEK/DEK lifecycle** (AES-256-GCM, per-tenant KEK, versioning/rotation/revocation) is live in the tree as a pure, fail-closed, tenant-isolated capability, plus a **durable KEK provider that reuses the existing keychain** (`credentialStore`/`secureStore`, no new secret store) with proven **restart durability**. 15/15 incl. adversarial + restart. S108/S109/S110/S111 preserved; S104 8/8 intact.

Legend: **IMPLEMENTED · TESTED · REAL-ELECTRON · BLOCKED-POLICY · BLOCKED-FROZEN · DEFERRED · RETIREMENT-CANDIDATE**.

## 1. H6 implementation status — IMPLEMENTED · TESTED
- **Source reproduced:** `packages/security/keys.ts` `KeyManager`/`Envelope`/`LocalKeyProvider` — fresh DEK seals data (AES-256-GCM), DEK wrapped under tenant KEK, rotation re-wraps, revoked version can't decrypt.
- **Harvested** (adapted, node:crypto only) to `apps/desktop/src/main/security/envelopeCrypto.ts`: `EnvelopeCipher.encrypt/decrypt/rewrap/rotate/revoke`, `KekProvider` interface, `InMemoryKekProvider`, typed `EnvelopeError`. Pure, Electron-free, fail-closed.

## 2. H5 live-wiring status — BLOCKED-FROZEN (gate prepared, §16)
Not wired this session. H5 signing (S111) + H6 durable key now make live audit-head signing *possible*; wiring it (provision key at boot → sign each `AuditChain` snapshot head → verify on restore) touches boot/consumer surfaces and is prepared as the FG/boot gate in §16. No token guessed.

## 3. H6 encryption architecture
Two-tier envelope: **DEK** (random per record, AES-256-GCM seals the plaintext) wrapped by the **tenant KEK** (versioned). The `Envelope` carries only ciphertext + wrapped DEK + IVs/tags + `keyVersion` — **no plaintext, no key material**. Decrypt unwraps the DEK with the tenant KEK version then opens the data; GCM auth tags make any tamper fail-closed.

## 4. Key lifecycle / rotation — IMPLEMENTED
`rotate(tenant)` mints a new KEK version; `rewrap(env)` re-wraps a record's DEK under the newest KEK **without touching the ciphertext**; `revoke(tenant, version)` makes a version undecryptable. Proven: rotate→rewrap keeps decryptability; after revoke of v1 the rewrapped-to-v2 envelope still decrypts while the old v1 envelope is dead.

## 5. secureStore integration — IMPLEMENTED (durable adapter) · REAL-ELECTRON deferred
`apps/desktop/src/main/security/durableKekProvider.ts` — a `KekProvider` over an injected async `SecretStore` (production binding = the existing `credentialStore`, safeStorage/OS-keychain). KEK set persisted as one OS-encrypted keychain blob (base64 keys + version/revoked); **never plaintext on disk, never over IPC, never renderer**. Electron-free by injection ⇒ unit-testable; the real safeStorage-across-process-restart proof is the operator-Mac harness (deferred, §6).

## 6. Real-Electron / restart proof
- **Unit-level restart durability (proven):** a fresh `DurableKekProvider` instance loads from the same persisting `SecretStore` blob and decrypts records sealed before the "restart"; survives rotation; corrupt blob → fail-closed (empty key set, never a fabricated key); tenant isolation persists across restart.
- **Real-Electron (deferred to operator Mac):** provision KEK in the real keychain → encrypt → close app → restart → recover → decrypt → tamper → verification failure. Rides with the H5 live-wiring slice (§16), since both need a real keychain across a real process restart.

## 7. Inbound webhook event-port status — BLOCKED-FROZEN (request in §16)
The read-only path (verified inbound webhook → tenant-scoped event → existing platform event bus → intelligence/notification) is safe and desirable, but `InboundWebhookRouter` today only calls `requestSync()`; surfacing the verified event needs an **additive port from the frozen `connectors/index.ts` composition root**. Prepared as a FROZEN-GATE REQUEST (§16), not guessed. No second event bus; read-only; no credential exposure.

## 8. Connector capability matrix (governed? tenant? idempotent? auditable? reversible? mutates? AI-safe? frozen-blocked? duplicate?)
| Capability | live | governed | tenant | idempotent | auditable | AI-safe today | note |
|---|---|---|---|---|---|---|---|
| OAuth+PKCE / vault / store | ✓ | n/a | workspace | n/a | ✓ | infra | canonical |
| Inbound webhook verify+route | ✓ | n/a (trigger) | per-account | n/a | ✓ | read | event-port = §16 gate |
| Outbound signing + SSRF + retry/DLQ | ✓ | n/a | per-tenant | ✓ (DLQ) | ✓ | no | durable delivery |
| M365 `mail.send` + 11 cohort actions | ✓ | **CST** | ✓ | ✓ (durable) | ✓ | **yes (governed)** | the AI-tool-shaped set |
| M365 executor residual writes | ✓ | confirm-gated | ✓ | partial | ✓ | no | widen = BLOCKED-POLICY |
| Companion gateway | ✓ | sealed RPC | per-device | replay-guarded | ✓ | no | reads today |
**Connectors activated this session:** 0 (the one safe activation is the §16 event-port, frozen-gated). **No consequential action widened** (policy).

## 9. All-package convergence matrix (A harvest-now · B additive-frozen · C policy · D duplicate/retire · E covered)
| Package(s) | Class | Canonical destination |
|---|---|---|
| `security` (ABAC✓H4, Ed25519✓H5, envelope✓H6) | **A (ongoing)** | `security/*` — remaining: delegation/JIT/impersonation (own gated slice) |
| `persistence` (upcaster/snapshot/migration) | **B** | `platform/command` durable log — needs a durable-events gate; NOT the PGlite engine |
| `ai-runtime` WorkflowEngine (rollback pattern) | **B/C** | `orchestration/` — design note, Rule-3 care |
| `ckdl` missingEvidence (H8) | **A** | advisory over liveBrain proposals |
| `reliability` SLO/error-budget | (H1 done) | `operationsPlatform` |
| `connectors`/`integrations`/`enterprise-connectivity`/`integration-platform`/`connectivity` | **D** | duplicate live `connectors/` — RETIREMENT-CANDIDATE |
| `business`/`industry`/`workplace`/`workspace`/`commercial`/`production`/`federation`/`nems`/`cloudops`/`automation`/`autonomous-ops`/`execution`/`operations`/`workforce`/`intelligence` | **D/E** | superseded by live subsystems — RETIREMENT-CANDIDATE / covered |
| 14-pkg deployment/launch cluster | **D** | descriptor generators — RETIREMENT-CANDIDATE |
Unchanged from S106/S107: 39 of 46 packages unwired; live app = `shared`+`cst`+`companion-protocol`+`solution-packs` (+backend cloud libs).

## 10. ERP/CRM/HR/Finance convergence status (classification, no policy invented)
- **P2P / O2C / Inventory / Manufacturing / Maintenance / Projects / Finance-GL/AR/AP:** control planes **IMPLEMENTED + certified** (S94–S104). No mutation this session.
- **SAFE NEXT (no policy):** none required a change this session; the highest-value safe cross-domain convergence is the inbound-webhook→event feed (§16) enabling CRM/ops real-time.
- **POLICY-BLOCKED (carried):** payroll/adjustment/variance approval thresholds, reversal SoD, period-reopen dual-control, maintenance/project cost→GL, the 3 consequential connector activations, ABAC enforcement — documented, not invented.
- **No MISSING core capability** surfaced this session.

## 11. AI capability harvest candidates (next, safe, no policy)
H8 `missingEvidence` decision-quality checklist (advisory over liveBrain proposals) — self-contained, no policy. Tool-registry/streaming/agent-state remain **BLOCKED-POLICY/architecture** (need governed execution policy). No second AI runtime.

## 12. Real-time architecture status
Existing event chain (S109 tamper-evident, S111 signable) is the spine. Inbound-connector-event entry point = the §16 event-port gate. No new event bus/outbox.

## 13. Persistence status
H3 live; H5+H6 add cryptographic integrity + at-rest encryption capability. `packages/persistence` upcaster/snapshot/migration = **B** (additive, own gate) — NOT harvested (would be a second persistence spine).

## 14. Security / adversarial results — 15/15 (H6) + S104 8/8
Tampered ciphertext → fail-closed; tampered wrapped-DEK → fail-closed; **cross-tenant** (A's KEK can't decrypt B, and never returns B's plaintext); unknown key version → fail-closed; **revoked** version rejected; corrupted metadata → typed error; rotation lifecycle preserved; **restart durability**; corrupt keychain blob → fail-closed no-fabrication; structural: envelopeCrypto imports only node:crypto, durableKekProvider imports no electron/safeStorage (injected), Envelope carries no key/plaintext. Security dir 84/84 (auditChain 8/8, abac 11/11, auditSigner 13/13, envelopeCrypto 15/15, gate24 16, authz 10/10…); **S104 architecture-defeat 8/8**.

## 15. UI / operator status
None this session (H6 is a main-process primitive). When H5 live-wiring lands (§16), a read-only security status surface can show `SIGNED/UNSIGNED/VERIFICATION_FAILED` + key version/algorithm/availability — **never** private key/KEK/DEK/secret. Deferred with that slice.

## 16. Frozen gates required (prepared, not guessed)
- **FG-S112-AUDIT-KEY (H5 live-wiring):** provision a durable Ed25519 signing key via `credentialStore` at boot; each `AuditChain` consumer signs its persisted snapshot head + verifies on restore. **Files:** `security/auditChain.ts` (additive sign/verify hooks — non-frozen) + boot provisioning (assess `runtimeCore` — if boot wiring is frozen, that line is the gate). **Safe:** signing adds integrity only; verify is read-only; no authority. **Tests:** real-Electron provision→sign→restart→verify→tamper-fail. **Rollback:** additive; absence = today's behavior.
- **FROZEN-GATE REQUEST — INBOUND-WEBHOOK-EVENT-PORT:** **file** `apps/desktop/src/main/connectors/index.ts` (frozen composition root). **Change:** additive — pass an injected `emitPlatformEvent` port into `InboundWebhookRouter` so a verified, tenant-scoped webhook delivery also emits a canonical read-only domain event onto the existing event bus (in addition to `requestSync`). **Safe:** read-only, no ERP mutation, no credential in the event, tenant-scoped, no second bus. **Consumers affected:** existing event-bus/intelligence/notification only. **Tests:** authenticated→event received; unauthenticated/wrong-sig/wrong-tenant/duplicate/malformed→no event, no leak, no ERP write. **Insertion:** one additive wiring line at the router construction site. **Rollback:** additive; absence = today's sync-only behavior.
- **ABAC enforcement (carried, S110):** operator decision + FG.

## 17. Policy decisions required
Per-action consequence/reversibility for the 3 connector activations; ABAC enforcement point + policies; the S99–S103 policy-open authority layers. All documented, not invented.

## 18. Retirement candidates — NO ACTION TAKEN
Unchanged. `packages/security` **stays** (H4/H5/H6 harvested; delegation/JIT still to harvest). Five connector packages + the other unwired packages remain retirement candidates pending operator approval. Nothing deleted/archived/excluded.

## 19. Exact files changed
NEW: `apps/desktop/src/main/security/envelopeCrypto.ts`, `durableKekProvider.ts`, `envelopeCrypto.test.ts`; `certification/SESSION112-...md`. **No live/frozen file modified.** `packages/security` untouched.

## 20. Exact tests/results
envelopeCrypto **15/15**; security dir + S104 **84/84** (S104 8/8); node typecheck exit 0; eslint clean; gate-detector **PROCEED** (envelopeCrypto, durableKekProvider). Full main unaffected (no live file changed; last measured 10545/7 at S109).

## 21. Exact commit
`<this>` — `feat(s112-h6): envelope encryption + KEK/DEK rotation harvest (pure + durable keychain adapter, adversarial) + S112 cert`.

## 22. Working-tree status
Only the pre-existing custody-protected `baseline.json` (M, untouched) + pre-existing untracked `.claude/` and two `source-update/*EVIDENCE.md`. No release/tag/notarize/dist change.

## STOP-condition check — none tripped
No security/authority bypass (envelope grants nothing; structural no-authority-import; S104 8/8). No tenant-isolation failure (per-tenant KEK, proven cross-tenant + across restart). No second persistence/secret store (reuses keychain). No renderer secret exposure (no key/plaintext in Envelope; durable provider Electron-free by injection; production KEK OS-encrypted). No unauthorized frozen change (two gates prepared, not applied). No undefined policy invented. No connector→ERP bypass, no AI→ERP mutation, no package deletion.

## NEXT (recommended)
1. **FG-S112-AUDIT-KEY** — wire H5 live on the H6 durable key (real-Electron provision→sign→restart→verify). Highest value: turns the audit-integrity story production-real.
2. **INBOUND-WEBHOOK-EVENT-PORT** (additive FG) — read-only, no policy, makes the platform genuinely real-time.
3. **H8 missingEvidence** advisory (no policy).
