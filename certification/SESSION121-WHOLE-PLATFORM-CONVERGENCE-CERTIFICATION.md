# SESSION 121 — WHOLE-PLATFORM CONVERGENCE CERTIFICATION
## Connector Lineage UI + next safe platform capability
### Date: 2026-09-05 · Branch: cert/data-import-cst-integration · Non-frozen session (no FG token consumed)

---

## 0 · OBJECTIVE (as given)

Make connector lineage genuinely operator-visible via a read-only UI panel over the existing
`QueryInboundLineage` governed read; add real-Electron acceptance where possible; run the macOS
keychain proof (or record OPERATOR-PENDING honestly); activate ONE additional safe platform
capability; run full regression; certify; commit. Constraints: no faked keychain, no duplicate
infrastructure, no package deletion/retirement, no invented business policy, no release/notarization,
no frozen change without an exact authorization token.

**Standing convergence intent honored:** DISCOVER → HARVEST → IMPLEMENT into canonical live
subsystems → CONNECT → TEST → CERTIFY → CONTINUE. This session CONNECTED an already-implemented
governed read (`QueryInboundLineage`, S119/S120) to a real operator surface, and activated one
additional pure operational-intelligence capability derived from the same tenant-scoped evidence —
**no new command bus, event bus, persistence spine, AI runtime, or connector framework was created.**

---

## 1 · WHAT LANDED (all non-frozen)

### 1.1 Connector Lineage operator surface (the CONNECT step)
- `apps/desktop/src/renderer/src/operationsPlatform/ConnectorLineagePanel.tsx` **(new)** — a
  READ-ONLY, tenant-scoped panel. It fetches through the existing governed read accessor
  `ipc.platform.inboundLineage({ limit: 50 })` → `platform:command.dispatch` with
  `operation: 'QueryInboundLineage'` → the `OPERATIONAL_READ_OPERATIONS` read branch → the S119
  projection over the ONE EventBus ring, **tenant resolved server-side**. It mutates nothing, creates
  no ERP transaction, and renders exactly the sanitized rows the main process returns: connector /
  provider / verified source / received time (ISO) / event id / authoritative tenant / dedupe status
  ("none") / a credential-free badge. It renders NO secret, token, signature, credential, or raw
  payload — the projection carries none.
- `apps/desktop/src/renderer/src/operationsPlatform/EopsPlatformTab.tsx` — mounts
  `<ConnectorLineagePanel />` after `DeliveryOperationsPanel`, before `AuditIntegrityPanel`.
- `apps/desktop/src/renderer/src/lib/ipc.ts` — `ipc.platform.inboundLineage(params)` governed-read
  accessor (via `rawInvoke(IpcChannel.PlatformCommandDispatch, …)`; no frozen `IpcResponseMap` change).

### 1.2 The additional safe capability (the ACTIVATE step)
- `apps/desktop/src/main/connectors/inbound/lineage.ts` — added `InboundLineageConnectorSummary` +
  `summarizeInboundLineage(rows)`: a PURE per-connector operational-intelligence rollup (events count
  + most-recent `lastReceivedAt`, sorted most-recent-first) derived from the same tenant-scoped rows.
  It invents no data, reads no store, imports ONLY the shared `PlatformEvent` type.
- `apps/desktop/src/main/platform/command/operationalRead.ts` — `buildInboundLineage(...)` now returns
  `summary = summarizeInboundLineage(rows)` alongside `lineage` and `counts` in the SAME governed
  read result. No new operation, channel, bus, or store.

### 1.3 Tests
- `apps/desktop/src/main/connectors/inbound/lineage.test.ts` — 10 tests (9 S119 adversarial: tenant
  isolation, payload-cannot-forge-tenant, non-inbound excluded, malformed dropped, duplicate-distinct,
  fail-closed, credential-free shape, structural import-fence; + 1 S121 `summarizeInboundLineage`
  rollup/ordering test).
- `apps/desktop/ui-tests/connectorLineagePanel.test.tsx` — 3 tests: real UI→bridge→governed-read path
  asserts `operation === 'QueryInboundLineage'`; renders row + per-connector summary; empty state; and
  a leak assertion that the rendered DOM contains no secret/token/signature/authorization/payload text.
- `apps/desktop/src/main/ipc/handlers/session120InboundLineageRead.test.ts` — 7 tests (S120, still
  green): governed read branch, server-resolved tenant, RBAC, `TENANT_SCOPE_VIOLATION` on mismatch.

---

## 2 · REGRESSION (nothing hidden)

| Check | Result |
|---|---|
| gate-detector on all 12 changed/added files | **PROCEED ×12** (no frozen/sensitive surface touched) |
| typecheck node (`tsconfig.node.json`) | **0 errors** |
| typecheck web (`tsconfig.web.json`) | **0 errors** |
| eslint (changed files) | **0 errors** |
| Full main suite (8 shards, `ulimit -n 65536`, forks/singleFork) | **10,664 passed / 7 skipped** (1433+1704+787+1201+1335+1236+1742+1226; skips pre-existing) |
| Full UI suite (`vitest.ui.config.ts`) | **83 files · 469 passed** |

No assertions weakened, no tests skipped, no timeouts widened. The one UI-leak failure encountered
mid-build (the panel's own subtitle/empty-hint copy literally contained "secrets"/"payload") was fixed
at the SOURCE by rewording the copy to "credential-free", not by weakening the test — the leak
assertion still runs and passes.

---

## 3 · GOVERNANCE / SECURITY PROPERTIES (unchanged, re-proven)

- **Read-only.** The panel and the new capability mutate nothing, create no ERP transaction, dispatch
  no command. `summarizeInboundLineage` is a pure function over already-verified rows.
- **Tenant scoped, fail-closed.** The read resolves the principal SERVER-SIDE; `claimedTenantId` is
  validated against the principal (`TENANT_SCOPE_VIOLATION` on mismatch, S120 tests). The projection
  scopes on the AUTHORITATIVE bus-stamped `event.tenantId`; a webhook payload cannot forge tenant
  identity (adversarial test). A reader sees only its own tenant's lineage; unresolved tenant → [].
- **Credential-free by construction.** Rows carry only the safe shape; `credentialsPresent:false`,
  `dedupeRef:null`. Both the projection test and the UI test assert no secret/token/signature/
  authorization/payload/rawbody material is present.
- **No duplicate infrastructure.** Reuses the ONE `platform:command.dispatch` governed read branch,
  the ONE EventBus ring (via the non-frozen `platformBusRef` singleton, S120), and the ONE shared
  `PlatformEvent` type. No second bus/store/channel/runtime was introduced.
- **AI cannot reach it as authority.** The lineage is verified inbound evidence (S114 verified events);
  no path lets model output set tenant, principal, or the read result.

---

## 4 · HONEST STATUS / OPERATOR-PENDING ITEMS

- **macOS keychain proof — OPERATOR-PENDING (unchanged, not faked).** This session's shell is a Linux
  aarch64 sandbox with no macOS `safeStorage`/keychain and an empty `electron/dist`. The H5/H6/S115
  keychain certification therefore cannot be exercised here and is NOT simulated. The verification
  runbook prepared in S116 stands; a real result requires the operator to run it on the Mac.
- **Real-Electron click-through for the lineage panel — OPERATOR-PENDING.** For the same reason (no
  runnable macOS Electron in this Linux sandbox, consistent with every prior session), a real
  click-driven Electron acceptance of the panel is deferred to the operator. The full path is instead
  proven at the layers available here: the governed read branch + server-resolved tenant + RBAC +
  scope-violation (S120 main tests), and the real UI → bridge → governed-read wiring including the
  asserted `QueryInboundLineage` operation (S121 UI test). No Electron result was fabricated.
- **`dedupeRef` stays `null` (no invented policy).** The S114 verified event carries no dedupe
  reference; the projection honestly reports `dedupeRef:null` and the UI shows "none". Defining inbound
  dedupe semantics is a policy decision and was NOT invented — it remains a candidate DECISION-MEMO,
  not code.

---

## 5 · COMMIT SCOPE

Committed (all non-frozen): the two new S121 files (`ConnectorLineagePanel.tsx`,
`connectorLineagePanel.test.tsx`), the four modified files (`lineage.ts`, `operationalRead.ts`,
`ipc.ts`, `EopsPlatformTab.tsx`), the extended `lineage.test.ts`, and this certification doc.

**Deliberately EXCLUDED from the commit** (not this session's work, left untouched per CLAUDE.md §1
custody note): `certification/baseline.json` (the pre-existing, custody-protected, uncommitted
re-record), the stray `.claude/` directory, and the unrelated `NP-FG-001`/`NP-IPC-ENV-001` evidence
docs.

**No FG token consumed. No frozen surface touched. No release/notarization performed.**
