# NeuroPause OS — Integration Slice 1 — Capability Discovery (pure model)

**Read-only inventory first, then ONE smallest safe vertical slice: a pure, additive capability-discovery model that
composes the connectors' EXISTING self-describing action catalogs + the user's connected accounts into one
normalized, tenant-scoped catalog — discovery metadata only, never an execution bypass. No frozen surface, no
IPC/shared change, no renderer authority, no packages imported. No commit, no push.**
Assurance labels: `SOURCE-PROVEN` `TEST-VERIFIED` `BUILD-VERIFIED` `LIVE-VERIFIED` `PILOT-VALIDATED`.

## STATUS
`TEST-VERIFIED` (pure model + 21 tests; full main suite green). NOT `LIVE-VERIFIED`, NOT `PILOT-VALIDATED`.

## HEAD
`670b52e` (certified lineage `ffa2863 → 634c9b7 → 670b52e`), branch `cert/data-import-cst-integration`,
`git diff --check` clean. Prior Wave-1/Wave-2 renderer work + Work Hub fix preserved unstaged (untouched by this slice).

## PHASE 0–1 — INVENTORY (read-only, machine-readable) `SOURCE-PROVEN`
Four read-only agents answered §42 A–M with file:line evidence. Everything the product chain needs already EXISTS
canonically; the ONE missing seam is automatic capability discovery feeding the AI.

| # | Capability (§42) | Verdict | Canonical anchor |
|---|---|---|---|
| A | Connector discovery / accounts | EXISTS | `connectors/connectorStore.ts:44` → `ConnectedAccount` (`packages/shared/.../connectors.ts:178`); IPC `connectors:list` (`connectors/index.ts:495`) |
| B | Identity / auth (stable user.id) | EXISTS | `auth/authService.ts:67`; renderer sees only `AuthStatus`, never tokens |
| — | Connector credentials (renderer-isolated) | EXISTS | `connectors/connectorVault.ts:146` (guard `:10`) — tokens never cross IPC |
| C | Capability metadata (self-describing) | PARTIAL (per-executor, not composed) | M365 `connectors/m365/actionSdk.ts:35` → `ALL_M365_ACTIONS` (`m365/index.ts:16`) → `m365/executor.ts:74 list()`; Infra `infrastructure/executor.ts:57` |
| D | AI planning + capability selection | EXISTS engine / **catalog NOT FOUND** | `ai/aiEngine.ts:47`; privacy clamp `aiRouting.ts:272`; intent classifier `assistant/assistantModel.ts:41`; **`AiEngineRequest` has NO tools field** (`aiEngine.ts:56`) |
| E | Governance verdict | EXISTS | `workforce/governance/policyEngine.ts:157` (`evaluateAction`) |
| F | Approval (authoritative approver) | EXISTS | `workforce/approverAuthority.ts:13`; IPC `workforce:proposal.approve` |
| G | Decision / admission (Boundary-B + durable single-use) | EXISTS | `workforce/execution/boundaryB.ts:42`; `executeEngine.ts:144` (`consumedDecisions`) |
| H | Execution (ExecuteEngine/session) | EXISTS | `executeEngine.ts:81`; IPC `execute:sessions` (`runtimeCore.ts:2613`) |
| I | Outcome (+ m365 UNKNOWN) | EXISTS | `executeEngine.ts:234`; `connectors/m365/executor.ts:161` NetworkError→UNKNOWN |
| J | Evidence (decision records + audit) | EXISTS | `decisions/decisionService.ts:91`; IPC `decisionRecord:list` |
| K | Holds + worker UNKNOWN→hold | EXISTS | `decisions/holdStore.ts:29`; gate `runtimeCore.ts:2526`; IPC `hold:list`/`hold:resolve` |
| L | Operator lifecycle | EXISTS | `renderer/.../HoldsView.tsx:50` + `operatorConsole.ts:37` |
| — | Capability/connector health view | EXISTS | `renderer/.../connectors/connectorCenterModel.ts:93` + `ConnectorsPage.tsx:60` (per-connector + per-service status) |
| — | M365 certified path (29/29) | EXISTS | `cst/sendTransition.ts:147`, `cst/governedAction.ts`; coverage guard `cst/m365GovernanceCoverage.test.ts:154` (`toBe(29)`) |
| **M** | **Smallest missing connection** | **THIS SLICE** | **no normalized catalog composes C into an authorization-scoped, AI-selectable capability contract** |

**Connectors wired (real):** ~21 OAuth **read-only** connectors (`connectors/manifests.ts:99+`) + `microsoft-entra`
(only real mutate surface, via the certified M365 path) + infra platforms (`aws/azure/gcp/...`, `infrastructure/`).
**~46 `@neuropause/*` packages remain deliberately disconnected — NOT imported** (per Absolute Rule 4).

## SLICE CHOICE `SOURCE-PROVEN`
§43 precondition confirmed: identity + connector/account state EXIST, automatic capability discovery is MISSING. Per
§6 ("no suitable unified registry exists → create the smallest additive registry; it is discovery metadata, NOT an
execution bypass"), the smallest safe vertical slice is the pure normalization model. Rendering/IPC exposure is a
LATER slice (a new IPC channel would touch frozen `packages/shared` — a frozen-gate item, surfaced in NEXT SLICE).

## FILES CHANGED (this slice) `SOURCE-PROVEN`
- **A** `apps/desktop/src/main/capabilities/capabilityCatalog.ts` — pure model: `DiscoveredCapability`,
  `ConnectorActionSource`, `discoverCapabilities`, `capabilitiesForWorkspace`, `selectableCapabilities`,
  `selectCapability`. Pure functions; no IO, no authority, imports only frozen-shared TYPES (read).
- **A** `apps/desktop/src/main/capabilities/capabilityCatalog.test.ts` — 21 tests.
Nothing else. No frozen file, no shared contract, no renderer, no package.json, no IPC channel touched (audit below).

## WHY
So NeuroPause can answer, from authoritative state alone, "what can this user actually do, by which account, in which
tenant, read or consequential-mutation, which executor, approval?" — the precondition for "the user does not
hand-wire a workflow per connector" (§5, §20, §28). It composes what already exists; it invents nothing.

## WHAT CONNECTED `TEST-VERIFIED`
The pure model composes the REAL shapes the product already produces — `ConnectedAccount` (accounts),
`ConnectorWriteActionInfo` (M365's self-describing catalog, the strongest existing source: 29 mutate + 5 read),
`ExecutorKind` — into `DiscoveredCapability`. It is a faithful normalization of real capability sources. It is NOT
yet wired to a live store, an IPC channel, or the renderer (that is the next slice).

## SAFETY CONTRACT (structural, not just tested) `TEST-VERIFIED`
- **Authority not weakenable** — `consequential` and `approvalRequired` are DERIVED from `mutates`, never accepted
  from input. No field and no caller can mark a mutation approval-free. Conservative: mutate ⇒ consequential ⇒
  approval-required; the governance engine (`policyEngine`) remains the authority that decides at proposal time.
- **Never claims verified** — verification is `provider-ack-only` for mutations (acknowledged ≠ verified), `none`
  for reads. There is no `verified` value.
- **Discovery metadata only** — a capability carries no token, no credential, no callable `run`. `selectCapability`
  returns a DESCRIPTION or a refusal; it never executes and never waives approval. Real effects still flow through
  proposal → governance → approval → admission → executor unchanged.
- **Closed over authoritative sources** — a capability absent from every source cannot appear; the AI (or any
  untrusted content) cannot invent one → `selectCapability` = NOT_FOUND.
- **Tenant-scoped** — `capabilitiesForWorkspace`/`selectCapability` never cross the workspace boundary; unclaimed
  (`null` workspace) accounts are never returned; a cross-tenant reach → CROSS_TENANT.
- **Only usable accounts contribute** — disconnected/connecting/error accounts discover nothing; reauth/unavailable
  are surfaced honestly and are NOT selectable.

## TESTS `TEST-VERIFIED`
`capabilityCatalog.test.ts` — **21/21**: read vs mutate derivation; mutate⇒consequential⇒approval NOT weakenable by
input; never `verified`; per-status contribution (connected/reauth/unavailable emit, disconnected/connecting/error
emit nothing); no-source ⇒ nothing; empty ⇒ empty; tenant isolation (only requested workspace; unclaimed excluded;
cross-tenant refused); `selectCapability` description-only + NOT_FOUND on unknown id + NOT_AVAILABLE on reauth +
CROSS_TENANT; `selectableCapabilities` only-available; no credential/token/callable in any capability (structural +
JSON scan); multi-connector attribution (m365 vs infra executor); prompt-injection — a hostile action label cannot
change the authority classification.

## SECURITY `TEST-VERIFIED`
Covers §23 (AI cannot invent/select unauthorized capability, cannot cross tenant, cannot make a read-only source
mutate-approval-free; credentials never present; discovery ≠ execution) and §24 (connector content is DATA — a
hostile label grants no authority). AI-cannot-execute / cannot-self-approve / cannot-mint-claim remain enforced
upstream (`assistantAiBoundary.test.ts`, `boundaryB*.test.ts`) — unchanged.

## REGRESSION `TEST-VERIFIED`
Full **main suite 8554 passed / 3 skipped / 811 files** (baseline 8533/3/810; +21/+1, no regression). Typecheck clean
(exit 0). Changed-file lint clean (`--max-warnings 0`, exit 0). NOTE: a repo-wide eslint error exists in
`apps/desktop/src/main/cst/sendTransition.negative.test.ts` (unused `WriteActionResult` import) — **pre-existing at
HEAD, untouched by this slice** (verified via `git show HEAD:…`), flagged for separate cleanup.

## FROZEN AUDIT `SOURCE-PROVEN`
`git diff --stat` over the frozen set (connectors/index.ts, m365/executor.ts, m365/actionSdk.ts, cst/*,
executeEngine.ts, boundaryB.ts, runtimeCore.ts, storeScope.ts, packages/shared, package.json) = **empty**.
`git diff --check` clean. This slice is a NEW additive directory only. No frozen-gate report required (none touched).

## CERTIFICATION IMPACT `SOURCE-PROVEN` — **NONE**
M365 IPC 29/29 UNCHANGED; CST UNCHANGED; governance/authority/admission/effect-boundary UNCHANGED; worker/CST parity
NOT PROVEN. The catalog composes existing records; it grants no authority and no effect.

## LIVE STATUS `BLOCKED-ENV` — TEST-VERIFIED ≠ LIVE-VERIFIED. No clean env / signed artifact / live tenant run. The
model is proven over fixtures using real shared types, not a live account.

## PILOT IMPACT — none yet. This is the discovery foundation; it changes no user-visible surface this slice.

## WHAT REMAINS `OPEN`
- Wire `discoverCapabilities` in main from the LIVE sources: `connectorStore.all()` (accounts) + `m365 executor.list()`
  (actions) + infra `executor.list()` — a pure read composition (no frozen file: reads existing exposed data).
- Extend sources beyond M365: infra `InfraActionInfo`, worker `WorkerSkill`/`ExecutionBinding`, and read-only OAuth
  connectors at the granularity their manifests actually provide (honest coverage, no fabrication).
- Surface the catalog read-only (renderer capability view / AI-facing selectable catalog). If this needs a NEW IPC
  channel, that edits frozen `packages/shared/src/ipc/channels.ts` → STOP + frozen-gate report first.

## NEXT SLICE (do NOT start automatically)
Slice 2 — compose `discoverCapabilities` from the live main-side stores (accounts + M365/infra action lists) into a
tenant-scoped catalog read model, tested against the real stores; decide renderer/IPC exposure (frozen-gate check on
channels.ts) as its own step.

## STOP
One smallest safe vertical slice implemented + tested; pure, additive, reversible (delete the directory); no frozen
surface, no IPC/shared change, no renderer authority, no packages imported, no live claim. HEAD `670b52e`; changes
unstaged. No commit. No push. STOP after the slice, per §49.
