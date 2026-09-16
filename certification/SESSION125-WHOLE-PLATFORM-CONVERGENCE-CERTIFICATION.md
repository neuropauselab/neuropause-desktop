# SESSION 125 — WHOLE-PLATFORM CONVERGENCE CERTIFICATION
## Governed Operational Evidence Search (enterprise knowledge/context over canonical evidence)
### Date: 2026-09-05 · Branch: cert/data-import-cst-integration · Non-frozen session (no FG token consumed)

---

## 1 · BASELINE / FINAL COMMIT
- Baseline HEAD: **06e99e7** (S124).
- Final HEAD: **this commit** (S125).
- Frozen surfaces: **UNTOUCHED** (gate-detector PROCEED ×9; no FG token).

## 2 · CAPABILITY SELECTED + WHY
**Governed Operational Evidence Search** — a deterministic, tenant-safe, read-only lexical/filter search
over already-persisted CANONICAL operational evidence: the committed-command history
(`DurableCommandJournal`) and the verified connector inbound lineage (the EventBus ring, S119).
Selected because it fills the one genuine gap: this evidence was live but only *page-able*, never
*queryable* — operators could not ask "which commands / connector events match X?" across it. It reuses
the deterministic lexical-match CONCEPT from the canonical `search/enterpriseSearch.ts` without importing
its engine or its (different) stores, so it makes fragmented canonical evidence discoverable with zero
new infrastructure. It stays read-only and never becomes an authority surface.

## 3 · REPOSITORY / PACKAGE CENSUS FINDINGS
- **`packages/search`, `packages/knowledge`, `packages/memory`** — EMPTY (no `src`). Not sources.
- **Desktop `search/enterpriseSearch.ts`** — the canonical cross-source search (`runEnterpriseSearch`:
  entity/graph/memory/timeline/federation), wired via `runtimeCore.initEnterpriseSearch` on its own
  surface. It does **NOT** cover the governed operational evidence (command journal / inbound lineage) —
  a different wiring and different stores, so the new capability is **non-duplicative**. Its lexical
  scoring concept is what was harvested.
- **Desktop `memory/`** — a real semantic/vector memory subsystem (per-viewer scoped). Deliberately NOT
  promoted here: it is a separate authority-scoped store; a deterministic lexical search over canonical
  operational evidence is preferable to bolting operational evidence onto the memory spine.
- **`packages/intelligence`, `packages/nems`** — evidence/graph/search concepts on the parallel
  `@neuropause/*` spine; not imported (second-spine prohibition).
- **Operational reads (S32/S34/S35/S119–S124)** — the authoritative, tenant-scoped evidence sources the
  new search folds over. No new source of truth introduced.

Chosen ONE activation path: the operational evidence search on the existing governed read branch.

## 4 · CANONICAL INFRASTRUCTURE REUSED
- The ONE `platform:command.dispatch` governed READ branch (`OPERATIONAL_READ_OPERATIONS`); new sibling
  operation `QueryEvidenceSearch` → `buildEvidenceSearch(...)`.
- The ONE `DurableCommandJournal` (`journal.records(tenantId)`), tenant-scoped by construction.
- The ONE EventBus ring via `readInboundLineage(source, tenantId)` (S119).
- The existing secure preload/IPC bridge, server-resolved principal, RBAC `operations:read`, tenant
  validation. No new channel / command / store / index / vector DB / search engine / event bus.

## 5 · FILES CHANGED (all non-frozen)
- **new** `apps/desktop/src/main/operationsPlatform/evidenceSearch.ts` — pure `searchOperationalEvidence`
  (deterministic AND-token lexical filter over commands + lineage; bounded; credential-free; safe
  haystack that deliberately EXCLUDES raw result payloads and raw outbox error text).
- `apps/desktop/src/main/platform/command/operationalRead.ts` — `QueryEvidenceSearch` added to the set +
  `buildEvidenceSearch(journal, lineageSource, tenantId, params)`.
- `apps/desktop/src/main/ipc/handlers/platformCommandIpc.ts` — routes `QueryEvidenceSearch`.
- `apps/desktop/src/renderer/src/lib/ipc.ts` — `ipc.platform.evidenceSearch(params)` accessor.
- **new** `apps/desktop/src/renderer/src/operationsPlatform/EvidenceSearchPanel.tsx` — operator search UI
  (debounced query input, bounded results, honest empty state) mounted in `EopsPlatformTab`.
- Tests: **new** `evidenceSearch.test.ts` (pure), **new** `session125EvidenceSearchRead.test.ts`
  (governed read), **new** `evidenceSearchPanel.test.tsx` (UI); + this cert.

## 6 · SECURITY / TENANT PROOF
- **Read-only:** pure fold over existing rows; dispatches no command, mutates nothing, executes nothing;
  never an authority surface. AI gains no execution authority (the pure function is data-in/data-out).
- **Tenant identity is authoritative & server-resolved:** the search reads only `journal.records(tenantId)`
  / `readInboundLineage(source, tenantId)` for the resolved principal; a renderer `claimedTenantId`
  mismatch → `TENANT_SCOPE_VIOLATION`. Proven: tenant B search returns `[]` and total 0 over tenant A
  evidence.
- **Fail-closed:** unauthenticated → `UNAUTHENTICATED`; missing `operations:read` → `UNAUTHORIZED`; empty
  evidence → honest empty; unknown `kind` → both (never error).
- **Bounded:** results clamped to the caller limit (`MAX_EVIDENCE_RESULTS` = 100); `bounded:true` signals
  truncation.
- **Credential-free / no sensitive control data:** matches and emits only safe metadata; the haystack
  EXCLUDES raw result payloads and raw outbox error text (a token that only appears in error text does
  NOT match — pinned). Asserted no secret/token/password/authorization/payload/rawbody in the pure
  result, the governed response, and the rendered DOM.
- **Hostile query contained:** query is tokenized + bounded (≤16 tokens); SQL/script/garbage input yields
  an honest empty result, never a throw or projection escape (pinned).

## 7 · FOCUSED TEST RESULTS
- `evidenceSearch.test.ts` — **9** pure tests (browse ordering, AND-token filter, inbound match, kind
  filter, no-payload/no-error-text exposure, error-text-not-searchable, bounding, hostile query, limit
  clamp).
- `session125EvidenceSearchRead.test.ts` — **9** governed-read tests through the REAL `runSecureHandler`
  over a REAL journal + EventBus (searchable evidence, tenant isolation, claimed-tenant rejected,
  unauthenticated + unauthorized, bounded, credential-free, hostile query, empty state).
- `evidenceSearchPanel.test.tsx` — **4** UI tests (renders hits + asserts `QueryEvidenceSearch`, typed
  query reaches the payload, honest empty state, no secret/payload rendered).

## 8 · FULL REGRESSION (nothing hidden)
| Check | Result |
|---|---|
| gate-detector (9 changed/new files) | **PROCEED ×9** |
| typecheck node / web | **0 / 0** |
| eslint (changed files) | **0** |
| Full main suite (8 shards) | **10,721 passed / 7 skipped** (skips pre-existing) |
| Full UI suite | **482 passed** (+4) |

Existing operational overview / reliability / connector-lineage / audit functionality unchanged and
green. CRM/HR/Expenses/Payroll/Procurement/P2P/Warehouse/Inventory/Manufacturing/Maintenance/Projects/
O2C/AR/AP/GL/AI/Connectors/Operations/Security/Audit/Backup all remained green — the capability is pure
read-only with no write path (no raw store mutation, legacy action door, cross-tenant access, replay,
duplicate accounting, authorization bypass, AI-authority bypass, or connector credential leakage).

## 9 · ELECTRON / MAC RESULT — OPERATOR-PENDING (not simulated)
Linux aarch64 sandbox, no runnable macOS Electron (`electron/dist` empty). The S121–S125 click journeys
and the S113/S115 keychain proof are deferred to the Mac. Proven instead at the real layers: the governed
search through the real `runSecureHandler` (tenant/RBAC/scope-violation/bounding/credential-free) and the
real UI→bridge path (operation + typed query asserted). No Electron/keychain result fabricated.

## 10 · AI INTEGRATION
The pure `searchOperationalEvidence` is a data-in/data-out function directly consumable by a context
builder, but it was NOT wired into an AI context path this session: doing so safely needs a defined
context seam and would risk a frozen response/schema boundary. Per the directive, that boundary is left
for an explicit FG request rather than guessed. AI gains no store access and no executable tool here.

## 11 · PACKAGE ACTIVATION MATRIX (delta, S125)
| Capability / package | Status | Notes |
|---|---|---|
| Operational evidence search | **LIVE (this session)** | governed `QueryEvidenceSearch` + `EvidenceSearchPanel` over journal + lineage. |
| Cross-surface operational overview | LIVE (S124) | unchanged. |
| Reliability posture + trend | LIVE (S122/S123) | searchable evidence source. |
| Connector inbound lineage + trend | LIVE (S119–S123) | searchable evidence source. |
| `search/enterpriseSearch` (entity/graph/memory/timeline/federation) | LIVE | concept reused; engine untouched, non-duplicative. |
| `packages/search` / `packages/knowledge` / `packages/memory` | EMPTY (no src) | nothing to harvest. |
| `packages/intelligence` / `packages/nems` | PARTIALLY HARVESTED / DUPLICATIVE | evidence/graph concepts on the parallel spine; not imported. |
| Desktop `memory/` semantic subsystem | LIVE (separate authority-scoped) | deliberately not promoted for operational evidence. |
| `packages/persistence` — upcaster/migration | SAFE HARVEST CANDIDATE — POLICY-BLOCKED | DECISION-MEMO-S124; unchanged. |
| `packages/security` — delegation/JIT/impersonation | POLICY-BLOCKED | authority-bearing; not activated. |
| `packages/ai-runtime` — WorkflowEngine/agent runtime | FRAMEWORK-ONLY / POLICY-BLOCKED | no second runtime. |
| Real macOS keychain (S113/S115) | OPERATOR-BLOCKED | Linux sandbox; runbook ready. |
| ~5 connector pkgs + ~30 wave/NCEA pkgs | DUPLICATIVE / RETIREMENT CANDIDATE | not deleted/archived/retired. |

## 12 · POLICY BLOCKERS DISCOVERED
None newly hit. No SLO/severity/incident/migration/authority/connector-write policy invented. The S124
persistence memo and S122 SLO memo remain authoritative; the S122 error-budget verdict stays dormant.

## 13 · FROZEN BOUNDARIES ENCOUNTERED / FG REQUESTS
None. The capability rides the existing generic `platform:command.dispatch` response `data`
(`Record<string,unknown>`) — no frozen contract touched. **No FG request this session.** (A future AI
context-seam integration is the most likely place a frozen response/schema boundary would arise; it is
deferred, not guessed.)

## 14 · NEXT RECOMMENDED CONVERGENCE TARGET
Either (a) an **operator evidence-trace drill-down** — given a `correlationId` from a search hit, compose
the already-live reads (command history + delivery + inbound lineage) into one governed correlation
timeline (read-only, tenant-safe, reuses existing builders); or (b) an explicit **FG request** to expose
`searchOperationalEvidence` to the canonical AI context path so the Brain can ground on governed
operational evidence (read-only context only, no execution).

## 15 · COMMIT SCOPE
Committed (all non-frozen): `evidenceSearch.ts` (+test), `operationalRead.ts`, `platformCommandIpc.ts`,
`ipc.ts`, `EvidenceSearchPanel.tsx`, `EopsPlatformTab.tsx`, `session125EvidenceSearchRead.test.ts`,
`evidenceSearchPanel.test.tsx`, and this certification.

**Deliberately EXCLUDED** (not this session's work, per CLAUDE.md §1 custody note): the custody-protected
`certification/baseline.json` re-record, the stray `.claude/` directory, and the unrelated `NP-FG-001` /
`NP-IPC-ENV-001` evidence docs.

**No FG token consumed. No frozen surface touched. No release/notarization. No package deleted. No
policy invented. No parallel infrastructure.**
