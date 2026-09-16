# SESSION 114 — REAL-TIME INBOUND WEBHOOK EVENT PORT (FG-S113-WEBHOOK-EVENT)

Convergence Wave 2. **No package deleted/retired · no second spine · no invented policy · no release work · no frozen token guessed.** Baseline S113 GREEN. `baseline.json` untouched.

**Headline (IMPLEMENTED):** the authorized frozen gate **FG-S113-WEBHOOK-EVENT** is applied — a **verified inbound webhook now emits ONE minimal, read-only, credential-free platform event onto the EXISTING event bus**, reaching the live intelligence/memory/timeline/notification consumers. The frozen `connectors/index.ts` change is exactly the two prepared additive lines; the emission logic lives in the non-frozen router. Fully tested incl. negatives + tenant scoping + credential-free + best-effort. S104 8/8 intact; full main 10609 passed.

Legend: **IMPLEMENTED · TESTED · REAL-ELECTRON(operator-pending) · BLOCKED-FROZEN · BLOCKED-POLICY · DEFERRED · RETIREMENT-CANDIDATE**.

## 1. Real-time event-port status — IMPLEMENTED (frozen gate applied)
Token honored: **AUTHORIZED: FG-S113-WEBHOOK-EVENT**. Change-control choreography: non-frozen accompaniment committed first (router.ts + tests, `033e86a`), then the frozen surface isolated (`connectors/index.ts`, `677a588`).
- **Frozen diff (verbatim, 4 additive lines):** inside `new InboundWebhookRouter({…})` — `emitPlatformEvent: (i) => deps.publish(i)` + `resolveTenantId: () => deps.workspaceId()` (+2 comment lines). Nothing else changed; `requestSync` preserved.
- **Non-frozen router:** additive optional ports `emitPlatformEvent?`/`resolveTenantId?`; `emitVerified(d)` fires **only after signature verification passes**, emitting `{ type:'connector.online', category:'connector', source:'connectors', actor, resource, metadata:{connectorId, provider, tenantId, kind:'inbound_webhook', receivedAt} }` via `deps.publish` → existing `PlatformEventApi.publish` → `EventBus.publish`.
- **No second bus/queue/persistence/connector framework.** Reused `deps.publish` (already wired at the runtime-core composition root, same port that carries existing `connector.*` events).

## 2. Inbound webhook → event-bus proof — TESTED
`router.test.ts` 14/14 (8 existing + 6 new): a **verified** GitHub HMAC delivery → **exactly one** `connector.online` event with the approved metadata shape + preserved 2-account `requestSync` fan-out; tenant carried from `resolveTenantId` (workspace), never from the payload. End-to-end consumers (from the wiring map): Timeline persistence (`subscribers.ts:215`), AI Memory (`runtimeCore` `initMemory` subscribing `connector.*`), renderer broadcast — all already subscribe to `connector.*`, so the new event reaches them with no consumer change.

## 3. Negative / security results — TESTED (fail-closed)
Invalid signature → **no event**; unauthenticated (no secret configured) → **no event**; the event is **credential-free** (asserted: no secret/header/token/rawBody/authorization anywhere in the emitted object); a throwing bus never breaks webhook handling (best-effort); no emit port wired → verified delivery still works (backward-compatible no-op); tenant scoping proven (event carries the resolved workspace, not payload data). **Not an ERP transaction:** the emit is a read-only signal; the only mutation path remains `requestSync` (the existing governed sync), unchanged. **Idempotency:** one verified delivery → one event; the event bus/consumers already dedupe/persist per their own contracts (S109 tamper-evident chain downstream). S104 architecture-defeat **8/8** intact.

## 4. Audit live-consumer status — DEFERRED (safe, documented)
`signedAuditChain` (S113) is ready. Wiring it into a specific live `AuditChain` consumer (sign persisted snapshot head + verify on restore) changes that consumer's **persisted snapshot shape** and needs the durable key provisioned at its init — a sensitive live-persistence slice best done on its own with the real-Electron restart proof (the S113 harness). Not forced this session; queued as the next security slice.

## 5. Audit status IPC/UI status — BLOCKED-FROZEN (gate request)
`AuditIntegrityStatus` (SIGNED/UNSIGNED/VERIFICATION_FAILED + algorithm/keyId/keyVersion) is ready. Surfacing it read-only needs a new IPC channel in **frozen** `packages/shared/channels.ts` + a security/ops panel. No token provided → **FROZEN-GATE REQUEST** (below), not guessed.

## 6. H5/H6 real-Electron status — OPERATOR-PENDING
The S113 harness `e2e/s113AuditSignJourney.e2e.cjs` (real safeStorage, two runs = real restart) proves provision→sign→restart→recover→verify→tamper-fail on the operator's Mac. This Linux CI cannot run safeStorage; **not faked** — OPERATOR-PENDING.

## 7. Connector capability matrix
| Capability | class |
|---|---|
| OAuth+PKCE / vault / store / supervisor / entity bridge | LIVE |
| **Inbound webhook verify+route → platform event** | **LIVE (this session)** |
| Outbound signing + SSRF + retry/DLQ | LIVE |
| Slack Socket Mode | LIVE (conditional) |
| M365 mail.send + 11 cohort actions | LIVE + GOVERNED (CST) |
| M365 executor residual writes | POLICY-BLOCKED (widen) |
| Companion gateway | LIVE |
| connectors/integrations/enterprise-connectivity/integration-platform/connectivity pkgs | DUPLICATE (retirement-candidate) |

## 8. All-package convergence matrix (A/B/C/D/E)
Security: ABAC(H4✓)/Ed25519(H5✓)/envelope(H6✓)/decision-quality(H8✓) done; delegation/JIT/impersonation = **A (next)**. persistence upcaster/snapshot/migration = **B**. ai-runtime WorkflowEngine rollback = **B/C**. Audit-status IPC + audit live-consumer = **B (§5/§4)**. 5 connector pkgs + ~30 wave/NCEA pkgs = **D/E** (retirement candidates / covered). Unchanged: 39/46 unwired.

## 9. ERP/CRM/HR/Finance convergence
Certified control planes untouched (S94–S104). The new inbound event is **read-only enrichment** (timeline/intelligence/notification) — it does NOT mutate ERP; any consequential external→ERP path stays POLICY-BLOCKED until defined. CRM/HR/Finance can now receive provider events on the bus (e.g. a GitHub/Slack/M365 webhook → timeline/memory) with zero new mutation surface.

## 10–11. AI capability harvest / H8 integration
H8 `missingEvidence` (S113) live as an advisory module. Deeper AI harvest (WorkflowEngine rollback, tool registry, streaming, durable agent state) remains **B/C** (needs governed-execution policy). No second AI runtime. AI still: proposal → governed tool → authz → policy → approval → command → transaction → event/outbox → audit.

## 12. Real-time architecture
connector → **verified webhook → `emitVerified` → deps.publish → EventBus → {Timeline, Memory, renderer broadcast, notifications}** → (S109 tamper-evident chain, S111/S113-signable). The previously-missing link (verified webhook → bus) is now live. No new event system.

## 13. Persistence / recovery impact
None new — the emit is a transient bus event; downstream persistence (timeline/memory) is existing. No second persistence spine. `packages/persistence` snapshot/upcaster/migration remain **B** (future additive gate).

## 14. Security / adversarial results
connector→forged tenant: event tenant is `deps.workspaceId()`, never payload → forged-tenant payload cannot set tenant. connector→forged event: only a **verified** delivery emits; forged/unsigned → none. connector→ERP direct write: emit is read-only; no store/command path. connector→secret leakage: event is credential-free (asserted). webhook duplicate/replay: verification-gated; one verified delivery → one event. renderer→secret: no secret in event/IPC. audit forged head / cross-tenant / wrong version: S113 signer fail-closed (unchanged, still green). **All fail closed; S104 8/8.**

## 15. Frozen gates required (prepared, not guessed)
- **FROZEN-GATE REQUEST — AUDIT-STATUS-IPC.** File: `packages/shared/src/ipc/channels.ts` (FROZEN) — one additive read-only channel `security:auditIntegrity.status`; handler returns `{state, algorithm, keyId, keyVersion}` only (never key/KEK/DEK/secret); renderer security/ops panel. Token: `AUTHORIZED: FG-S114-AUDIT-STATUS — channels.ts security:auditIntegrity.status read-only channel, per gate doc`.
- **Dedicated `connector.webhook_received` event type** (optional refinement): `packages/shared/platform.ts` (FROZEN) one additive union literal, so the inbound event has its own type instead of reusing `connector.online`+`metadata.kind`. Token: `AUTHORIZED: FG-S114-WEBHOOK-EVENT-TYPE — platform.ts connector.webhook_received additive literal, per gate doc`. (Current impl is fully functional without it.)
- **ABAC enforcement** (S110, carried) — operator decision + FG.

## 16. Policy decisions required
Per-action consequence/reversibility for M365 executor-residual widening; ABAC enforcement point + policies; S99–S103 policy-open authority layers. Documented, not invented.

## 17. Retirement candidates — NO ACTION TAKEN
Unchanged. `packages/security` + `packages/ckdl` stay (active harvest sources). Five connector packages + other unwired packages remain retirement candidates pending operator approval. Nothing deleted/archived/excluded/deprecated.

## 18. Exact files changed
- Frozen: `apps/desktop/src/main/connectors/index.ts` (+4 additive lines, `677a588`).
- Non-frozen: `apps/desktop/src/main/connectors/inbound/router.ts` (+ optional ports + `emitVerified`), `router.test.ts` (+6 tests) (`033e86a`).
- Docs: `certification/SESSION114-...md` (this).
- `packages/*` untouched (except the frozen connectors/index.ts additive gate).

## 19. Exact test counts
router.test.ts **14/14** (6 new); connectors/inbound **30/30**; S104 **8/8**; full main **10609 passed / 7 skipped / 1 failed** (the failure is the known Class-C flaky `auth/loopbackServer.test.ts` — **3/3 in isolation**, untouched by this session); node typecheck exit 0; eslint clean; gate-detector FROZEN(connectors/index.ts, authorized) / PROCEED(router.ts).

## 20. Exact commits
- `033e86a` — non-frozen router emit port + tests.
- `677a588` — frozen connectors/index.ts additive ports (FG-S113-WEBHOOK-EVENT).
- `<this>` — S114 certification.

## 21. Working-tree status
Only the pre-existing custody-protected `baseline.json` (M, untouched) + pre-existing untracked `.claude/` and two `source-update/*EVIDENCE.md`. No release/tag/notarize/dist change.

## STOP-condition check — none tripped
No authority bypass (read-only event, S104 8/8). No tenant-isolation failure (workspace-resolved tenant, proven). No second spine (reused event bus). No credential exposure (event asserted credential-free). No connector→ERP mutation (emit is read-only; requestSync unchanged). No unauthorized frozen change (only the authorized FG-S113-WEBHOOK-EVENT applied; audit-status IPC + dedicated event type left as gate requests). No invented policy. No package deletion.

## NEXT (recommended)
1. **FG-S114-AUDIT-STATUS** — wire the read-only audit-integrity status IPC + panel + the S113 audit live-consumer (with the operator-Mac restart proof).
2. Optional **FG-S114-WEBHOOK-EVENT-TYPE** — promote the inbound event to a dedicated type.
3. Operator runs the S113 audit-key harness on Mac → real-keychain restart GREEN.
