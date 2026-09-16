# SESSION 113 — OPERATIONAL AUDIT INTEGRITY (H5+H6) · H8 DECISION-QUALITY · REAL-TIME GATE REQUEST

Convergence Wave 2. **No package deleted/retired · no second spine · no business-policy invented · no frozen surface touched · no release work · no frozen token guessed.** Baseline S112 GREEN. `baseline.json` untouched.

**Headline (IMPLEMENTED · TESTED):** the S111 Ed25519 signer (H5) and the S112 durable keychain (H6) are now **operationally integrated** over the canonical `AuditChain` — `signedAuditChain.ts` provisions a durable signing key through the existing keychain, signs the persisted chain head, and verifies it after restart, all on **non-frozen** surfaces (no token required). Full provision→sign→restart→recover→verify + the complete tamper matrix proven (12/12). H8 decision-quality (`missingEvidence`) harvested (advisory). The webhook event-port is FROZEN and remains a gate request (not guessed). S104 8/8 intact.

Legend: **IMPLEMENTED · TESTED · REAL-ELECTRON(pending operator Mac) · BLOCKED-FROZEN · BLOCKED-POLICY · DEFERRED · RETIREMENT-CANDIDATE**.

## 1. H5 live status — IMPLEMENTED (non-frozen integration)
`FG-S112-AUDIT-KEY` needed **no frozen surface**: `signedAuditChain.ts`, `credentialStore`, and the audit consumers are all gate-detector **PROCEED**. So the wiring is plain additive non-frozen code — no literal token was required or guessed. The signer now signs the live `AuditChain.snapshot().head`, bound to namespace/tenant + algorithm + keyId + version.

## 2. H6 live status — IMPLEMENTED (durable key over existing keychain)
`DurableAuditKeyProvider` provisions/recovers the Ed25519 signing key through an injected `SecretStore` whose production binding is the existing `credentialStore` (safeStorage / OS keychain). Idempotent provisioning; recovers on restart; **no new key store**; private key only in the OS-encrypted blob (never renderer/IPC/normal file/log/audit record).

## 3. Real-Electron keychain proof — REAL-ELECTRON (pending operator Mac)
Harness `apps/desktop/e2e/s113AuditSignJourney.e2e.cjs` (two runs, real safeStorage): run 1 provisions the key in the **real** keychain + signs a head; run 2 (**real process restart**) decrypts the key back from safeStorage, verifies the signature (PASS), and confirms a tampered head FAILS. Signing/verify use the pure modules; only key persistence touches safeStorage — the exact production split. NO ERP/connector/network/IPC. This Linux CI cannot run safeStorage; **GREEN on the operator's Mac** (`--run=1` then `--run=2` on the same `--dir`).

## 4. Audit signing / restart proof — TESTED
`signedAuditChain.test.ts` 12/12: provision→sign→**restart** (fresh provider recovers the same key from the persisting keychain)→verify SIGNED; `ensureKey` idempotent; corrupt keychain blob → no key (fail-closed, never fabricated).

## 5. Tamper / adversarial results — TESTED (fail-closed)
Modified entry → FAILED; **forged entries AND head** (internally consistent, defeats SHA-256 alone) → FAILED (signature doesn't attest the forged head); reordered/removed/duplicated → FAILED; wrong tenant (namespace) → FAILED; wrong key → FAILED; wrong key version → FAILED; forged/corrupted signature metadata → FAILED (never throws); revoked/absent key → UNSIGNED not fabricated. **Backward-compat:** unsigned history → `UNSIGNED` (never a fabricated signature, never a false failure). **Integrity ≠ authority:** the status object carries no permission/authorized field and no callable; structurally zero imports of authz/cst/command-bus.

## 6. Inbound webhook event-port status — BLOCKED-FROZEN (exact gate request below)
`connectors/index.ts` is gate-detector **FROZEN** and no literal `AUTHORIZED: FG-…` token was provided → **NOT modified, not guessed.** The read-only event path (verified webhook → tenant-scoped canonical event → existing event bus → intelligence/notification) is safe and desirable; it is issued as the FROZEN-GATE REQUEST in §16. `requestSync` behavior preserved; no second event bus; no credential in payload.

## 7. Connector capability matrix (LIVE / SAFE / FROZEN-GATED / POLICY / DUPLICATE / COVERED)
| Capability | class | note |
|---|---|---|
| OAuth+PKCE, vault, store, supervisor, entity bridge | **LIVE** | canonical |
| Inbound webhook verify+route | **LIVE** (trigger) → **FROZEN-GATED** for the event-port (§16) | read-only event emission is the safe next activation |
| Outbound signing + SSRF + retry/DLQ | **LIVE** | durable |
| Slack Socket Mode | **LIVE** (conditional on token) | inert without token |
| M365 mail.send + 11 cohort actions (mail/calendar/drive/teams/contacts) | **LIVE + CST-governed** | the AI-tool-shaped set |
| M365 executor residual writes | **POLICY-BLOCKED** to widen | per-action consequence/reversibility undefined |
| Companion gateway | **LIVE** | sealed, per-device tenant |
| `connectors`/`integrations`/`enterprise-connectivity`/`integration-platform`/`connectivity` pkgs | **DUPLICATE** | RETIREMENT-CANDIDATE |

## 8. All-package convergence matrix (A now · B frozen-gated · C policy · D duplicate/retire · E covered)
Security: ABAC(H4✓)/Ed25519(H5✓)/envelope(H6✓)/decision-quality(H8✓) = **A (done)**; delegation/JIT/impersonation = **A (next, own slice)**. persistence upcaster/snapshot/migration = **B**. ai-runtime WorkflowEngine rollback = **B/C**. Inbound-webhook event-port = **B (§16)**. The 5 connector pkgs + ~30 wave/NCEA pkgs = **D/E** (retirement candidates / covered). Unchanged: 39/46 packages unwired.

## 9. ERP/CRM/HR/Finance status
Control planes IMPLEMENTED + certified (S94–S104); untouched. No missing *safe* capability surfaced that doesn't need policy. The highest-value cross-domain convergence remains the inbound-webhook event feed (CRM/ops real-time), FROZEN-GATED (§16). Policy-open layers (payroll/adjustment/variance approval, reversal SoD, period-reopen dual-control, maintenance/project cost→GL) carried, documented, not invented.

## 10–11. AI capability harvested / H8 status — IMPLEMENTED (advisory)
`intelligence/missingEvidence.ts` — decision-quality harvest from `ckdl/analysis.ts`: `missingEvidenceGaps` (no human-input / no verified / no metric / insufficient count / unjustified alternative / no confidence) + `decisionQuality` composing the S108 TrustModel band with the gaps into an advisory readiness hint. 7/7. **ADVISORY ONLY** — no authority, no callable, structurally imports only the S108 trust types. No second AI runtime.

## 12. Real-time event path
connector → verified webhook → **[FROZEN-GATED port §16]** → canonical event → existing event bus (S109 tamper-evident, S111-signable, now H5+H6-operational) → intelligence/notification/timeline → audit. The one missing link is the frozen event-port; all downstream consumers already exist.

## 13. Persistence / recovery impact
H5+H6 add cryptographic integrity + at-rest encryption + durable-key recovery on top of the existing durable stores/outbox/audit chain — no new persistence spine. `packages/persistence` snapshot/upcaster/migration classified **B** for a future additive durable-events gate (not harvested).

## 14. Security status — 84/84 security + S104 8/8
RBAC + ABAC(non-enforcing) + CST + approval + tenant isolation + audit integrity all preserved. New adversarial coverage: cross-tenant (namespace-bound signatures), forged/wrong/wrong-version key, forged signature, corrupted metadata, revoked key, restart durability, no renderer/secret exposure, no authority from verification. S104 architecture-defeat 8/8 intact.

## 15. UI / operator status — DEFERRED (with the live-consumer wiring)
`AuditIntegrityStatus` already models `SIGNED / UNSIGNED / VERIFICATION_FAILED` + algorithm + keyId + keyVersion — the exact safe read-only surface (never private key/KEK/DEK/secret). Surfacing it needs a read-only IPC channel (frozen `channels.ts`) + a security/ops panel; folded into the live-consumer wiring slice. No separate dashboard.

## 16. Frozen gates required (prepared, not guessed)
- **FROZEN-GATE REQUEST — INBOUND-WEBHOOK-EVENT-PORT.** **File:** `apps/desktop/src/main/connectors/index.ts` (FROZEN). **Additive change:** pass an injected `emitPlatformEvent(evt)` port into `InboundWebhookRouter` so a verified, tenant-scoped delivery ALSO emits a canonical read-only domain event onto the existing event bus (in addition to `requestSync`). **Why safe:** read-only, no ERP/DB mutation, no credential in payload (only `{connectorId, provider, tenantId, kind, receivedAt}`), tenant-scoped, no second bus. **Consumers:** existing event-bus/intelligence/notification. **Tests:** authenticated→exactly one event; invalid-signature/wrong-tenant/malformed/replay/duplicate/unauthenticated/forged-tenant/credential-bearing/ERP-mutation-attempt → no unsafe event, no leak, no write. **Insertion:** one additive wiring line at the router construction site. **Rollback:** additive; absence = today's sync-only behavior. **Token needed:** `AUTHORIZED: FG-S113-WEBHOOK-EVENT — connectors/index.ts InboundWebhookRouter emitPlatformEvent additive port, per gate doc`.
- **Audit-integrity read-only status IPC** (for §15 UI) — additive `channels.ts` (frozen) + handler; prepared with the live-consumer wiring slice.
- **ABAC enforcement** (S110, carried) — operator decision + FG.

## 17. Policy decisions required
Per-action consequence/reversibility for M365 executor-residual widening; ABAC enforcement point + policy content; the S99–S103 policy-open authority layers. Documented, not invented.

## 18. Retirement candidates — NO ACTION TAKEN
Unchanged. `packages/security` **stays** (H4/H5/H6/H8 harvested; delegation/JIT still to harvest); `packages/ckdl` **stays** (H8 harvested; more advisory concepts remain). Five connector packages + other unwired packages remain retirement candidates pending operator approval. Nothing deleted/archived/excluded/deprecated.

## 19. Exact files changed
NEW: `apps/desktop/src/main/security/signedAuditChain.ts` (+test), `apps/desktop/src/main/intelligence/missingEvidence.ts` (+test), `apps/desktop/e2e/s113AuditSignJourney.e2e.cjs`, `certification/SESSION113-...md`. **No live/frozen file modified.** `packages/*` untouched.

## 20. Exact tests / results
signedAuditChain **12/12**; missingEvidence **7/7**; security + intelligence + S104 = **151/151** (S104 8/8); node typecheck exit 0; eslint clean; gate-detector **PROCEED** (both new modules). Real-Electron keychain proof = operator-Mac (harness shipped). Full main unaffected (no live file changed; last measured 10545/7 at S109).

## 21. Exact commit
`<this>` — `feat(s113): operationalize H5+H6 signed audit chain (durable key + restart) + H8 decision-quality + webhook-event FG request`.

## 22. Working-tree status
Only the pre-existing custody-protected `baseline.json` (M, untouched) + pre-existing untracked `.claude/` and two `source-update/*EVIDENCE.md`. No release/tag/notarize/dist change.

## STOP-condition check — none tripped
No security/authority bypass (integrity verification returns a boolean, never permission; S104 8/8). No tenant-isolation failure (namespace-bound signatures, proven across restart). No second audit/key/persistence/event spine. No renderer secret exposure (private key only in OS-encrypted keychain; status carries none). No unauthorized frozen change (webhook port + status IPC prepared as gate requests, not applied; no token guessed). No undefined policy invented. No connector→ERP bypass, no AI→ERP mutation, no package deletion.

## NEXT (recommended)
1. **Operator runs the `s113AuditSignJourney` harness on Mac** → real-keychain restart proof GREEN.
2. **FG-S113-WEBHOOK-EVENT** (additive, read-only) — the highest-value real-time convergence, no policy.
3. Live-consumer wiring of `signedAuditChain` into one audit consumer + the read-only `SIGNED/UNSIGNED/VERIFICATION_FAILED` status IPC/UI.
