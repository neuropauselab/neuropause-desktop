# ERP SESSION 21-LIVE — LIVE ELECTRON IPC WIRING + ADVANCED APPROVAL GOVERNANCE

**Baseline:** Session 20 GREEN — `10a9a4c`; S21 (adapter + Sales Order) committed `27ccc85`.
**Outcome:** 🟡 **YELLOW — INSPECTION COMPLETE; TWO GOVERNED STOPS REACHED.** No frozen surface touched. No code applied this session (the one thing to build cannot compile before the frozen channel lands — see C). The mandated deliverables are the two decision memos below + the FG gate doc (`certification/source-update/FG-ERP-LIVE-IPC-GATE-DOC.md`).

> This session's prompt requires live IPC **and** explicitly instructs: *"If a frozen surface genuinely must change: STOP. Do not force it. Return [memo A–G]. Then wait for policy decision."* It also lists undefined approval policy as a hard STOP. Both conditions fired. This report is the honest result — it does **not** claim "wired because it compiles," and it does not fake a packaged run.

---

## A · EXISTING IPC ARCHITECTURE

Renderer → `window.neuropause.invoke(channel, payload)` (preload, `src/preload/index.ts`) → checks the frozen `ALL_INVOKABLE_CHANNELS` allowlist → `ipcRenderer.invoke` → `secureBridge.runSecureHandler` (auth + zod validation + tenant) → the handler registered in `runtimeCore.ts` `defs`. Handlers are `SecureHandlerDef` objects assembled in `runtimeCore` and registered once via `registerSecureHandlers(defs)`. Channel names + contracts live in `packages/shared/src/ipc/{channels.ts,contracts.ts}`. Classification (`requireAuth`/`permission`) is self-carried per handler or stamped in `ipc/runtimeAuthz.ts`; `assertAllChannelsClassified` enforces deny-by-default at boot.

## B · FROZEN vs EXTENSIBLE (authoritative: `certification/frozen-surfaces.json` + gate-detector)

- **FROZEN:** `packages/shared/` (⇒ `channels.ts`, `contracts.ts`, `ALL_INVOKABLE_CHANNELS` — all channel names + contracts), `runtimeCore.ts` (the `defs` composition), `enterprise/index.ts`, `connectors/index.ts`, `cst/`, `tenancy/tenantContext.ts`, `auth/*`.
- **EXTENSIBLE (not frozen):** `ipc/secureBridge.ts`, `ipc/router.ts`, `ipc/runtimeAuthz.ts`, `ipc/channelResource.ts`, `src/preload/index.ts` (generic — reads the frozen allowlist), `enterprise/framework/*`, all of `platform/*`, `erp/*`, the renderer.
- **Consequence:** a NEW live IPC channel is impossible without editing frozen `packages/shared` (name + contract + allowlist) and frozen `runtimeCore.ts` (registration). This is the FG-1 + FG-2 precedent, not a novel risk.

## C · LIVE IPC — FEASIBILITY FINDING (the crux)

**The S17–S21 platform stack has ZERO production callers.** Verified: the only files importing `dispatchCommand` / `handleApplicationRequest` / `decideApproval` / `ClientAdapter`/`AIAdapter` are the platform source files themselves and the S17–S21 `*.test.ts`. Nothing in `runtimeCore`, no IPC handler, no renderer, reaches them. The platform is genuinely **test-only infrastructure** today — the honest confirmation of the concern this session raises.

Live wiring requires the frozen change set in the gate doc. Crucially, **the non-frozen handler module cannot compile before the frozen channel-enum entry exists** (`SecureHandlerDef.channel` is typed `IpcChannelName`), so there is no non-frozen half to land first. Therefore this session **STOPS at the frozen boundary** and delivers the FG gate doc. Nothing was forced; nothing was faked.

**What IS live today (no change needed):** renderer → `enterprise:module.*` IPC → secure bridge (RBAC + tenant scope) → `buildModuleHandlers` → module `runAction`/`setStatus` → store → audit/events. This already includes the Purchase Request `submit`/`approve`/`reject`/convert actions and the document approval engine (see K). The "brain with no hands" is specifically the S17–S21 command-bus/workflow/adapter layer, not the whole product.

## D · PRELOAD / SECURE BRIDGE

Preload exposes exactly two guarded functions (`invoke`, `subscribe`), each validating the channel against the frozen shared allowlists; no `ipcRenderer`, Node, fs, or Electron internals leak. This is intact and needs no change — a new channel becomes reachable purely by being added to the frozen `ALL_INVOKABLE_CHANNELS`. No second bridge, no global `ipcRenderer`.

## E–G · APPLICATION ADAPTER / BOUNDARY / COMMAND PATH

All three exist, are Electron-free, and are proven by the S17–S21 tests: `platform/adapter/clientAdapter.ts` → `platform/application/applicationService.ts` → `platform/command/commandBus.ts` → `platform/command/durableCommandJournal.ts`. They are ready to be driven by a live IPC handler; only the frozen entry point is missing.

## H–I · AUTHORIZATION / POLICY

One authorization engine (`ctx.authorize`, RBAC permissions) is reused everywhere — IPC handlers self-carry `requireAuth`+`permission`; the command bus re-checks via `PERMISSION_FOR_COMMAND`. No second authz engine. Policy for approvals lives in the approval subsystems (K).

## J · WORKFLOW

`platform/workflow/workflowRuntime.ts` (subsystem A) is the S20 minimal gate: `evaluateWorkflow` requires approval for exactly `SubmitPurchaseRequest`; `decideApproval` transitions a durable `ApprovalInstance` PENDING→APPROVED/REJECTED and dispatches the gated command. It is durable, tenant-scoped, idempotent — but single-level and deliberately free of thresholds/hierarchy/delegation/escalation/expiration (its docstring says so).

## K · ADVANCED APPROVAL — CENSUS + DECISION MEMO

**Finding: advanced approval is NOT missing — it already exists and is WIRED, but in a different subsystem than the S20 runtime.** Four subsystems exist:

| Subsystem | Path | Wired live? | Capabilities |
|-----------|------|-------------|--------------|
| A — platform workflow (S20) | `platform/workflow/` | yes (but test-only entry, per C) | single-level PENDING→APPROVED/REJECTED |
| **B — ERP document approval engine** | `erp/approvalEngine.ts` (+`documentSpecs.ts`, `documentAdapter.ts`) | **YES — live via `enterprise/index.ts` `canEnterStatus`** | **amount thresholds (`minAmount`/`maxAmount`), multi-step role chains (`nextStep`/`isFinalStep`), 4-rule segregation-of-duties incl. self-approval (`creator_cannot_approve`, `requester_cannot_approve_own_payment`), spend-authority matrix (`DEFAULT_SPEND_POLICY`: manager / finance≥10k / executive≥100k), a typed policy engine (`evaluateApproval`/`ApprovalPolicy`)** |
| C — governance ApprovalChain | `packages/shared` + `enterprise/governance/` | yes (org-scoped) | multi-level role chains, per-org enable/disable |
| D — automation ApprovalPlatform | `packages/automation/src/approvals.ts` | **NO — zero importers under apps/desktop** | delegation, escalation (`escalationMs`), per-level quorum |

**DEFINED (reuse, do not duplicate):** thresholds, SoD/self-approval, multi-step role chains, spend authority, policy engine — all real and live in **B**; org-scoped multi-level chains in **C**.
**ABSENT in the live app (⛔ STOP — do NOT invent, per the prompt's STOP conditions):** approval **expiration/timeout**; **delegation**; **escalation** (all three exist only in the UNWIRED package D). No duration (24h/48h/7d) and no delegation/escalation semantics were invented.

**Decision the operator must make (architecture, not code-to-invent):**
1. **Canonical approval path.** Four approval subsystems is a §31 duplication finding. The richest WIRED engine is **B**. Recommendation: when the platform command bus goes live (FG gate), route its consequential approvals through **B's `evaluateApproval`/`ApprovalPolicy`** (reuse) rather than growing subsystem A into a fifth threshold/SoD engine — that would duplicate B. This is a convergence decision, deferred to the operator (touching wired subsystems is §35 "don't rewrite stable systems unless required").
2. **Delegation / escalation / expiration.** Wiring package D (or defining these in B) requires DEFINED policy: who may delegate, escalation timing, expiration duration. **None is defined.** STOP until the operator supplies the policy; nothing invented.

## L · ERP INTEGRATION (live today, via the module path)

PR `submit`→`approve`→`reject`→convert-to-PO run through the live `enterprise:module.action` channel; the conversion command independently enforces `PR.status === approved` (S17 guard) and single-conversion (`convertedOrder` guard). PR→PR-line→PO→PO-line traceability, multi-SKU procurement, supplier integrity, and no-duplicate-conversion are all intact (S16–S20). Sales Order create (S21) is governed through the command bus but, like the rest of the platform, is not yet on the live IPC path (C).

## M · AI GOVERNANCE

The S21 `AIAdapter` routes an agent through the identical governed path (application boundary → authorization → command bus), with no DB/store handle, no privileged approval bypass, and payload-smuggled authority inert (proven by S21 tests). When the FG gate lands, the AI uses the SAME live channel as any client — no AI-specific bypass. AI self-approval of its own consequential action is blocked by the same `ctx.authorize` + (subsystem B) SoD rules that block any actor; no AI carve-out exists or was added.

## N–R · TRANSACTION / PERSISTENCE / EVENTS / OUTBOX / AUDIT

Durable transaction + idempotency + domain-event + outbox = the Session-18 `DurableCommandJournal` (atomic commit, single-flight, replay, restart-durable) — reused, one engine. Audit = the framework audit sink. Persistence = the atomic tmp+rename `EnterpriseRecordStore` + `DurableJsonStore`. All test-verified (S17–S21); all ready for the live entry point.

## S · END-TO-END TRACE (honest status)

- **Provable now (test-verified, real bridge machinery available):** application-boundary → command bus → durable journal → event → outbox → audit, and (separately) the live `enterprise:module.*` bridge path renderer→secureBridge→module→store.
- **NOT provable now:** the single fused chain USER→live IPC→command bus→…→UI, because the command bus has no live channel (frozen-gated). This is the exact deliverable of the FG gate. **Not claimed as done.**

## T · PACKAGED ELECTRON EVIDENCE

**Not produced this session, and here is the honest reason:** the build environment is Linux; the repo's Electron binary is macOS (`darwin-arm64`), and there is no display. I cannot launch the packaged app here. The packaged smoke test + the UI→IPC→…→UI trace must be run on your Mac. Once the FG gate lands, the runnable path is: `npm run build` → the existing `e2e/*.e2e.cjs` playwright `_electron` harness (mirror `journalPackaged.e2e.cjs`) driving `platform:command.dispatch`, capturing the durable-journal row + event + outbox + audit + the UI state change. I will provide that harness as part of the gated change.

## U–X · NEGATIVE CONTROLS / FAILURE / CONCURRENCY / TENANT ISOLATION

The S21 suite already proves, at the command/adapter layer: unauthenticated/unauthorized/cross-tenant/unknown-op refusals, 100-concurrent single-effect idempotency, restart-durable replay, foreign-customer refusal, AI-cannot-self-grant, and no-internal-leak. The **IPC-boundary** negative controls (bypass preload, expose ipcRenderer, unauthorized channel, renderer-supplied authoritative identity) belong to the FG-gated change and are specified in the gate doc's regression plan (F). They are not run this session because the channel does not yet exist.

## Y · REGRESSION COUNTS (this session — unchanged, no code touched)

No source changed, so the S21 baseline stands: full main **9856 passed / 7 skipped** (sharded 4×), UI **405 passed**, typecheck node+web clean, eslint clean, `electron-vite build` ok (all from commit `27ccc85`). This session adds only documentation.

## Z · TYPECHECK / LINT / BUILD

Unchanged from `27ccc85` (no code delta). Nothing to re-run for the docs-only change beyond confirming the tree is clean.

## AA · FILES CHANGED

- NEW `certification/source-update/FG-ERP-LIVE-IPC-GATE-DOC.md` (the FG gate doc — the token-ready unlock).
- NEW `certification/ERP-SESSION21L-LIVE-IPC-AND-APPROVAL-EVIDENCE.md` (this report).
- No source files changed. No frozen surface touched. `certification/baseline.json` untouched/unstaged.

## AB · FROZEN SURFACES CHANGED

**None.** The required frozen changes are specified in the gate doc and await the operator's token.

## AC · COMMIT SHA

One docs-only commit (see git log); the user pushes from the Mac.

## AD · REMAINING RISKS / DECISIONS OWED

1. **FG token** for `platform:command.dispatch` (gate doc) — the single unlock that makes the platform live end-to-end. Until granted, the S17–S21 stack remains test-only.
2. **Approval convergence decision** — pick the canonical approval engine (recommendation: subsystem B) so the live command bus reuses it rather than duplicating thresholds/SoD.
3. **Undefined policy (STOP):** delegation authority, escalation timing, expiration duration — supply policy or they stay absent.
4. **Packaged UI evidence** must be captured on macOS (environment limitation here).

## AE · STATUS: 🟡 YELLOW

Inspection and architecture audit complete and evidence-backed. Two governed STOPs reached exactly as the prompt's Part H + STOP conditions require: (1) live IPC needs a frozen change → FG gate doc prepared, awaiting token; (2) delegation/escalation/expiration are undefined policy → not invented. Advanced approval that IS defined already exists and is live (subsystem B). No frozen surface was touched; no live claim is faked. GREEN is one operator token away.
