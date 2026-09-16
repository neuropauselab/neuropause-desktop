# SESSION 111 — CONVERGENCE WAVE 2 · H5 ED25519 AUDIT-CHAIN SIGNING

One platform, action-oriented. **No package deleted/archived/excluded/retired · no second spine · no business-policy invented · no release work.** Baseline S110 GREEN (HEAD `3d54ea6`; S110 commit present). `baseline.json` untouched.

**Headline (IMPLEMENTED):** H5 harvested — an **Ed25519 signing capability for the canonical audit chain** is live in the tree, closing the exact gap the live `AuditChain` documents in its own threat model (*"a local attacker with write access to BOTH the entries and the persisted head can still forge a consistent chain"*). Pure, fail-closed, tenant-bound, non-authoritative; proven adversarially (13/13). Durable key storage/rotation is **separated as H6** (gated). S108/S109/S110 preserved.

Classification legend: **IMPLEMENTED · TESTED · REAL-ELECTRON · BLOCKED-POLICY · BLOCKED-FROZEN/KEY · DEFERRED · RETIREMENT-CANDIDATE**.

---

## 1–3. Packages inspected / activated / harvested
- **Inspected (updated at HEAD):** the live connector framework (`connectors/`, `webhooks/`, `companion/`, `cst/`), `packages/security` (ABAC/Ed25519/envelope/KEK-DEK), `packages/persistence` (event-store/upcaster/snapshot), and the connector packages. S106/S107 census holds: 39 of 46 packages unwired.
- **Activated this session:** the **Ed25519 audit-signing capability** (harvested from `packages/security/keys.ts`), landed live at `apps/desktop/src/main/security/auditSigner.ts`.
- **Harvest ledger:** H1 error-budget (S107) · H2 TrustModel (S108) · H3 event-log tamper-evidence (S109) · H4 ABAC evaluator (S110) · **H5 Ed25519 audit signing (S111)**.

## 4–6. Connector inventory / activated / blocked
- **Inventory (from S110, re-confirmed):** the live `connectors/` framework is canonical and mature — OAuth+PKCE (secret never leaves main), encrypted per-workspace vault, inbound webhook verify+router (GitHub/Slack/Notion/MS-Graph, timing-safe), outbound signing + SSRF guard + **durable retry/DLQ** (per-tenant), companion sealed gateway, and 12 M365 write actions on the CST governed-tool kernel.
- **Connectors activated this session:** **0** — correct. The safe read-only/inbound activation (surface verified inbound-webhook events into the platform event bus → intelligence/notification, a **read-only, no-policy** path) is genuinely available but requires an **additive port from `InboundWebhookRouter` into the event bus**, which touches the frozen `connectors/index.ts` composition root — an **additive FG gate**, scoped in §21 as the next connector slice (BLOCKED-FROZEN, prepared). No credential exposure, no connector→ERP write introduced.
- **Blocked (policy):** the 3 consequential connector activations (widen CST cohorts, outbound "notify" tool) still need per-action consequence/reversibility classification — **BLOCKED-POLICY**, documented, not invented.

## 7. H5 result (IMPLEMENTED · TESTED)
- **Source reproduced:** `packages/security/keys.ts` `ed25519Signer()` — `sign = edSign(null, data, priv).toString('base64')`; its own comment: *"real signing keys for the audit chain."*
- **Compared to live** `security/auditChain.ts`: a pure SHA-256 hash chain (8 consumers) with a self-documented forge-both-entries-and-head gap. **Not a second audit system** — H5 *strengthens* this one.
- **Harvested** (adapted, not imported; only `node:crypto`) to `apps/desktop/src/main/security/auditSigner.ts`: `generateAuditSigningKey` (keyId+version), `canonicalAuditAnchor` (deterministic, namespace+algo+head), `signAuditHead`, `verifyAuditHead` (fail-closed, key+version lookup), `verificationKeyOf` (public-only). Signs the chain **head**, binding namespace (tenant/log) + keyId + version.
- **The gap is closed (proven):** an attacker who forges entries AND recomputes a consistent head still fails, because the old signature does not attest the forged head and the attacker lacks the private key (`auditSigner.test.ts` "CLOSES THE DOCUMENTED GAP").
- **H5/H6 separation (per directive):** H5 is signing over **injected** keys; it stores/embeds **no** key material. Durable private-key storage (OS keychain via `secureStore`) + rotation is **H6** and is the gated follow-up that makes live signing production-real (see §21). This session proves the gap closes **whenever** a durable key is provisioned.

## 8. H4 status
ABAC evaluator remains live (S110), pure, enforcement-gated. Unchanged. Enforcement still needs the operator ruling + FG (restrict-only, RBAC ∧ ABAC-not-deny). No policy invented; no authority granted.

## 9–11. ERP / CRM / HR / Expenses improvements
None mutated this session (H5 was the named slice). All cross-domain control planes remain certified (S94–S104). No workflow needed an invented policy; the connector/event convergence that advances CRM/HR real-time is scoped in §21 (additive-FG), not forced.

## 12. AI improvements
H5 hardens the substrate for **auditable AI actions**: an AI-proposed action flowing through the governed command bus lands in an audit chain whose head can now be cryptographically attested — a prerequisite for L6+ independently-verifiable AI execution. S108 TrustModel stays advisory. No second AI runtime; no autonomous execution.

## 13. Real-time improvements
Recorded, not built: authenticated inbound-webhook → canonical domain/platform event (S109 tamper-evident chain, now H5-signable) → background intelligence → notification. Needs the additive event-bus port (§21). No new event bus/outbox.

## 14. Persistence improvements
H3 live. `packages/persistence` upcaster/snapshot/migration remain SQL-engine features (PGlite) — **not harvested** (would be a second persistence spine); recorded for a future durable-events slice with its own gate. H5 adds cryptographic **integrity** on top of the existing durable event/audit chain — an integrity strengthening, not a new store.

## 15. Security improvements
H5 Ed25519 audit signing (this session). Remaining `packages/security` harvest: H6 envelope encryption + KEK/DEK rotation (`keys.ts` — also the durable-key home for H5's live wiring) · delegation/JIT/impersonation on RBAC (own gated slice). No authority semantics changed.

## 16. UI improvements
None this session — audit signing is a main-process integrity primitive with no direct UI. When durable-key wiring lands (H6), a security/admin surface can show "audit chain: signed, key v_N, verified" read-only.

## 17–19. Cross-domain / real-Electron / restart
No new cross-domain workflow this session. Real-Electron / restart: N/A for a pure stateless signer with no live consumer yet; when durable-key wiring lands, its real-Electron proof (fresh profile → sign chain head with keychain key → restart → verify signature + chain) rides with that H6 slice.

## 20. Full regression
auditSigner **13/13** · live `security` + `auditChain` + `abac` + S104 = **69/69** (S104 architecture-defeat **8/8**, auditChain 8/8, abac 11/11 all intact) · node typecheck exit 0 · eslint clean · gate-detector **PROCEED**. No live/frozen file modified ⇒ ERP/governance suites structurally unaffected (full main last measured 10545/7 at S109).

## 21. Frozen gates required
- **⛔ H5-LIVE-WIRING (H6-coupled) — key-provisioning decision + additive wiring, PREPARED.** To sign live audit heads in production: provision a **durable Ed25519 signing key in the OS keychain via the existing `secureStore`** (never plaintext, never to renderer) + have each `AuditChain` consumer sign its persisted snapshot head and verify on restore. This is **additive** to the non-frozen `auditChain.ts`/consumers, but the durable-key store + rotation is **H6**; no secret store invented. On your go I land H6 key provisioning, then wire signing.
- **⛔ INBOUND-WEBHOOK-EVENT PORT — additive FG (frozen `connectors/index.ts`).** Surfacing verified inbound-webhook events to the platform event bus is a read-only, no-policy activation but the composition root is frozen; prepared as an additive FG gate.
- **⛔ ABAC enforcement (carried from S110)** — operator decision + FG.
- No token guessed; nothing frozen touched this session.

## 22. Policy decisions required
- Per-action consequence/reversibility classification for the 3 connector activations (carried).
- ABAC enforcement point + policy content (carried).
Both documented, not invented.

## 23. Retirement candidates — NO ACTION TAKEN
Unchanged. The five connector packages + the 34 other unwired packages are retirement candidates pending operator approval. **`packages/security` stays** (H5 harvested from it; H6 still to harvest). Nothing deleted/archived/excluded/deprecated.

## 24. Remaining highest-value implementation backlog
1. **H6 envelope encryption + KEK/DEK rotation** (`security/keys.ts`) — also unlocks H5 live wiring (durable signing key). Self-contained, high value.
2. **Inbound-webhook → event-bus port** (additive FG) — read-only, no policy, makes the platform genuinely more real-time.
3. **H5 live wiring** (after H6): sign `AuditChain` heads with the keychain key + real-Electron proof.
4. **ABAC enforcement** (operator ruling) → restrict-only wiring + policy-authoring UI.
5. H7 orchestrator (design note) · H8 decision-quality checklist.

## 25. Exact commits
- `<this>` — `feat(s111-h5): Ed25519 audit-chain signing harvest (pure, adversarial, key-wiring gated) + S111 cert`.

## 26. Working-tree status
Only the pre-existing custody-protected `baseline.json` (M, untouched by me) + pre-existing untracked `.claude/` and two `source-update/*EVIDENCE.md`. No release/tag/notarize/dist change.

## STOP-condition check — none tripped
No security/authority bypass (verification returns a boolean about integrity, never permission; structural no-authority-import proof; S104 8/8). No tenant-isolation failure (namespace bound into every signature; cross-tenant substitution rejected, proven). No second audit/spine (signs the existing chain). No unauthorized frozen change. No undefined business policy invented. No connector credential exposure / connector→ERP bypass. No AI→ERP mutation. No package deletion. No renderer secret exposure (signer never embeds/exports private material; proven).
