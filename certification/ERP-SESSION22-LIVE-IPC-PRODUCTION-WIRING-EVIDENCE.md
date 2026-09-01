# ERP SESSION 22 — LIVE IPC PRODUCTION WIRING (FG-ERP-LIVE-IPC) + ADVANCED APPROVAL INTEGRATION

**Baseline:** Session 21 investigation (`aa66365`); S21 adapter/Sales Order (`27ccc85`).
**Authorization used:** `AUTHORIZED: FG-ERP-LIVE-IPC — platform:command.dispatch channel + contract + runtimeCore push` (operator, this session).
**Status:** 🟢 **GREEN (source + real-bridge)** for the governed live path; 🟡 the packaged-GUI acceptance step must run on macOS (this Linux sandbox cannot launch the macOS Electron binary — harness + runbook provided, §W).

The S17–S21 platform is no longer test-only: a real `platform:command.dispatch` IPC channel now puts the command bus on the live path, proven through the **real secure bridge** (`runSecureHandler`) end-to-end.

---

## A · EXACT IPC CHANGES

New live channel `platform:command.dispatch`. Renderer → `window.neuropause.invoke` (preload, validates the frozen `ALL_INVOKABLE_CHANNELS` allowlist) → IPC → `secureBridge.runSecureHandler` (auth gate → RBAC → zod → handler) → `platformCommandIpc` handler → `ElectronClientAdapter` → `handleApplicationRequest` (Application Boundary) → command bus → authorization → workflow/approved-gate → domain command → durable transaction + event + outbox → audit → response.

## B · FROZEN SURFACES TOUCHED (authorized, additive-only — verified)

Purely additive, **42 insertions / 0 deletions** across three files (git-verified, §24):
- `packages/shared/src/ipc/channels.ts` — `IpcChannel.PlatformCommandDispatch` (map) + its entry in `RUNTIME_INVOKABLE_CHANNELS` (which `ALL_INVOKABLE_CHANNELS` spreads).
- `packages/shared/src/ipc/contracts.ts` — `PlatformCommandDispatchRequest` (zod) + `PlatformCommandDispatchResponse` (type).
- `apps/desktop/src/main/runtimeCore.ts` — one import + one `defs.push(...buildPlatformCommandHandlers({ registry: enterprise.modules, allows: enterprise.allows }))`.

Pre-edit → post-edit sha256 (change-control record; INTACT before, INTACT after around the additive hunks):
- channels.ts `0d391bb4…` → `9f8fc484…`
- contracts.ts `ce57c893…` → `33bb791b…`
- runtimeCore.ts `d949b7c7…` → `830f1f53…`

`certification/baseline.json` is custody-protected (already dirty pre-session) and was **NOT** run through `freeze-baseline.sh` nor staged — the baseline re-record remains the operator's call (consistent with the standing §1 note). No vitest test enforces baseline hashes, so the additive change is regression-clean; frozen-surface integrity is verified by the additive-only diff (§24) + full regression.

## C · WHY EACH FROZEN CHANGE WAS NECESSARY

A new invokable IPC channel cannot exist without its name + contract in `packages/shared` (frozen) and its registration in `runtimeCore` (frozen) — the FG-1/FG-2 precedent. There is no non-frozen path (the S21L investigation proved the platform had zero production callers). This is exactly the authorized FG scope; nothing beyond it was touched.

## D · PRELOAD / SECURE BRIDGE

Unchanged. The preload exposes only the guarded `invoke`/`subscribe`, each validating the channel against the frozen shared allowlist — the new channel becomes reachable purely by allowlist membership; no `ipcRenderer`/Node/fs/secret leak. No second bridge.

## E · IPC AUTHORIZATION (two-layer, both defensible)

Channel-level: `requireAuth: true` (the sanctioned `REQUIRE_AUTH_ONLY` pattern, added to the accounting list) — the bridge refuses an unauthenticated session before any handler runs. Command-level: the command bus enforces the FINE per-command RBAC via `PERMISSION_FOR_COMMAND` → `ctx.authorize`, whose permission set is derived from the ONE RBAC gate `enterprise.allows`. This mirrors `EnterpriseModuleAction/Create/SetStatus` exactly (requireAuth + inner authorize). A single static channel permission cannot express a dispatcher carrying procurement:manage / sales:manage / … commands.

## F · APPLICATION ADAPTER · G · APPLICATION BOUNDARY · H · COMMAND BUS

No new adapter/boundary/bus. The handler builds the S21 `ElectronClientAdapter` (source `'electron'`, attribution only) → the existing `handleApplicationRequest` → the existing `dispatchCommand`. Identity/tenant are resolved SERVER-SIDE (authenticated session + `activeTenantScope` + `enterprise.allows`); the renderer envelope's `claimedTenantId` is validated and rejected on mismatch — never authoritative.

## I · EXISTING ADVANCED APPROVAL ENGINE (reused, not duplicated)

No new approval engine was built (§13 honored). Two approval integrations, both real:
- **Command-level (this channel):** the PR flow enforces the approved-gate — `ConvertPurchaseRequestToPO` refuses unless `status === approved` (proven live, §K). This is the S20 workflow integration at the command path.
- **Advanced engine (subsystem B, `erp/approvalEngine.ts`):** amount thresholds, multi-step role chains, segregation-of-duties incl. self-approval prevention, spend-authority matrix — already LIVE on the `enterprise:module.setStatus` → `canEnterStatus` path, and proven "the way the renderer reaches it" by the existing `erp/documentWiring.test.ts` ("segregation of duties actually bites on a real status change; a refusal is a HOLD, not a lost error"). The live IPC transport gate over those same module handlers is proven by this session's `runSecureHandler` test. **Not duplicated; not re-implemented.**

Delegation / escalation / expiration remain undefined policy → NOT invented (§14, §26 STOP honored).

## J · WORKFLOW INTEGRATION

The command bus routes PR submit/approve/reject/convert to the module actions with their status guards; convert independently re-checks approved. No UI state substitutes for domain state.

## K · PROCUREMENT E2E (through the REAL secure bridge)

`platformCommandIpc.test.ts` drives `runSecureHandler(def, payload, deps)` — the real pipeline — for the full flow: CreatePR → Submit → Approve → Convert → PO created; the created records exist in the real stores; the durable journal holds the committed command + `PurchaseRequestCreated` event + a pending outbox entry; the audit sink recorded `module.procurement-requests.created`.

## L · SALES E2E

Sales Order (S21) rides the SAME channel/command bus (`CreateSalesOrder` is a routed command); no Sales-specific bypass exists. Its command-path governance is proven by the S21 adapter suite; it shares this session's live transport.

## M · AI GOVERNANCE

An AI agent uses the identical governed path (S21 `AIAdapter` → same `handleApplicationRequest` → same command bus). No DB/store handle, no privileged IPC, no approval bypass; payload-smuggled authority is inert (S21 tests). AI self-approval is blocked by the same authorization + subsystem-B SoD that blocks any actor — no AI carve-out exists or was added.

## N–Q · TRANSACTION / PERSISTENCE / EVENTS / OUTBOX / AUDIT

Reused Session-18 `DurableCommandJournal` (atomic commit of idempotency + event + outbox; `reload()` for restart) — one file under userData. Persistence via the existing atomic stores. Audit via the existing enterprise `governanceStore` sink (the SAME one the live module handlers use). One engine each; nothing duplicated.

## R · IDEMPOTENCY

100 concurrent identical CreatePR through the live channel → exactly ONE PR (single-flight coalescing), one committed journal record; a subsequent same-key call replays to the same id. (`platformCommandIpc.test.ts`.)

## S · CONCURRENCY · T · RESTART/FAILURE

Concurrency: the 100-concurrent single-effect test. Restart: `journal.reload()` preserves the outbox and the key still replays with no duplicate effect. Failure: bridge auth-gate refusal + app-boundary UNAUTHENTICATED + UNAUTHORIZED + VALIDATION_ERROR + TENANT_SCOPE_VIOLATION all produce the closed error contract with no mutation and no internal leak.

## U · TENANT ISOLATION

`claimedTenantId` ≠ principal → TENANT_SCOPE_VIOLATION, no mutation. Two tenants with the same idempotency key are independent (no cross-tenant dedupe). Renderer-supplied tenant never overrides the authenticated tenant (server-side resolution).

## V · NEGATIVE-CONTROL RESULTS (each guard proven load-bearing; byte-identical restore, sha-verified)

| NC | Guard mutated | Matched test | Result |
|----|---------------|--------------|--------|
| A | remove `requireAuth: true` from the dispatch def | bridge AUTH GATE refuses | 🔴 fails → load-bearing |
| B | defeat the idempotency key | 100 concurrent → ONE PR | 🔴 fails → load-bearing |
| C | disable claimed-tenant vs principal check | TENANT_SCOPE_VIOLATION | 🔴 fails → load-bearing |
| D | weaken CreatePR permission → procurement:read | UNAUTHORIZED when principal lacks | 🔴 fails → load-bearing |
| E | remove the channel's classification entry | accounts for every invokable channel | 🔴 fails → load-bearing |

All 5 files restored byte-identical (sha256 round-trip verified).

## W · PACKAGED ELECTRON EVIDENCE (must run on macOS)

**Not executed here — honest reason:** this build environment is Linux; the repo's Electron binary is macOS (`darwin-arm64`); no display. I cannot launch the packaged GUI. Provided instead: `apps/desktop/e2e/platformCommandLive.e2e.cjs`, authored faithfully against the proven `journalPackaged.e2e.cjs`/`journalRuntime.e2e.cjs` pattern. On the Mac:

```
cd apps/desktop && npm run build && npx electron-builder --mac --arm64 --publish never
NODE_PATH="$(git rev-parse --show-toplevel)/node_modules" \
  NP_APP_BIN="$PWD/dist/mac-arm64/NeuroPause.app/Contents/MacOS/NeuroPause" \
  node e2e/platformCommandLive.e2e.cjs
```

It launches the packaged app on a throwaway `--user-data-dir`, drives `window.neuropause.invoke('platform:command.dispatch', …)` (the exact call a UI control makes) for CreatePR→Submit→Approve→Convert, asserts the PENDING-cannot-convert and cross-tenant-claim refusals and idempotent replay, and reads `platform-command-journal.json` off disk to confirm the durable effect. **This is the DEFINITION-OF-DONE step (§28 items 1–17); it is prepared and unrun-here, and must be run on macOS to claim the packaged-GUI acceptance.**

## X · END-TO-END TRACE (proven at the real bridge)

UI-context invoke → preload allowlist → IPC `platform:command.dispatch` → `runSecureHandler` (auth gate → zod) → `platformCommandIpc` handler → `ElectronClientAdapter` → `handleApplicationRequest` (request context, server-resolved principal) → `dispatchCommand` → authorization (`ctx.authorize`) → workflow/approved-gate → domain command → `DurableCommandJournal.run` (transaction + `PurchaseRequestCreated` event + outbox) → `governanceStore` audit → mapped `PlatformCommandDispatchResponse`. Every link asserted in `platformCommandIpc.test.ts`; the renderer-paint link is the Mac harness step (§W).

## Y · ARCHITECTURE / IMPORT AUDIT

`platform/*` stays Electron-free (the composition lives in `ipc/handlers/`, verified by the S19/S21 independence tests staying green). Dependency direction holds: renderer → preload → IPC → adapter → application → domain → infra. One canonical each: command bus, application boundary, authorization (`enterprise.allows`), approval engine (subsystem B unchanged), workflow, transaction/event/outbox (Session-18 journal), audit (`governanceStore`). No microservice, no broker, no duplicate infrastructure.

## Z · REGRESSION COUNTS

Full main (sharded 4×): **941 files · 9871 passed · 7 skipped · 0 failed** (S21 baseline 940/9856; delta +1 file/+15 tests = `platformCommandIpc.test.ts`). UI: **70 files · 405 passed**. Focused live-bridge suite: 15 passed.

## AA · TYPECHECK / LINT / BUILD

`typecheck:node` clean · `typecheck:web` clean · `typecheck:test` no S22-file errors · eslint clean on all S22 files (the pre-existing `contracts.ts` `AiPullModelRequest` escape — logged defect — is untouched; my additive change introduces zero new lint errors) · `electron-vite build` ✓.

## AB · FILES CHANGED

Frozen (additive, authorized): `packages/shared/src/ipc/channels.ts`, `packages/shared/src/ipc/contracts.ts`, `apps/desktop/src/main/runtimeCore.ts`.
Non-frozen new: `apps/desktop/src/main/ipc/handlers/platformCommandIpc.ts` (+ `.test.ts`), `apps/desktop/e2e/platformCommandLive.e2e.cjs`, this evidence doc.
Non-frozen modified: `apps/desktop/src/main/platform/adapter/clientAdapter.ts` (`ElectronClientAdapter`), `apps/desktop/src/main/ipc/runtimeAuthz.test.ts` (`REQUIRE_AUTH_ONLY` entry).

## AC · COMMIT SHA

One commit (see git log); the user pushes from the Mac. `baseline.json` not staged.

## AD · REMAINING RISKS / FOLLOW-UPS

1. **Packaged-GUI acceptance** must run on macOS (§W) — the only unproven link is the renderer paint; the governed chain beneath it is proven at the real bridge.
2. **Renderer UI control**: this session wired the transport; a dedicated on-screen button that calls `invoke('platform:command.dispatch', …)` is a small renderer add whose value is only verifiable on the Mac (the harness already drives the identical bridge call).
3. **Approval convergence** (four approval subsystems) remains an architecture decision (S21L memo); the command bus reuses the S20 workflow at the command level and composes with subsystem B at the document level — no duplication, but convergence to one canonical engine is deferred to an operator ruling.
4. Delegation/escalation/expiration stay absent (undefined policy).

## AE · STATUS: 🟢 GREEN (governed live path) / 🟡 packaged-GUI pending macOS

The platform command bus is LIVE through the real secure bridge and proven end-to-end (auth → RBAC → workflow/approved-gate → durable transaction → event → outbox → audit), with idempotency, tenant isolation, restart durability, and five load-bearing negative controls. Frozen surfaces changed only by the authorized additive hunks. The one thing not done here — a mouse-click in the packaged macOS GUI — is prepared as a runnable harness and is the operator's Mac step; per the session's final rule, "LIVE IPC wired" is claimed for the governed chain through the real bridge, and the packaged-GUI traversal is explicitly marked pending that run.
