# NeuroPause OS — Complete Engineering Inventory (READ-ONLY AUDIT)

**AUDIT ONLY. No code/test/frozen change; no commit/push; no app launched.** Baseline HEAD `ffa2863`, branch
`cert/data-import-cst-integration`. Method: direct source reads at `ffa2863` + 5 read-only sub-audits (packages,
UI, AI, workforce/automation, onboarding/backend/state) + the prior 27-gate `PRODUCT-READINESS-MATRIX.md` (dated
2026-08-14, commit `33b9173`, version rc.18-rc.20 — a **different** commit; its gate statuses are cited as
*prior-audit*, not re-verified here). Labels: `[PROVEN]` `[REAL]` `[SCAFFOLD]` `[STUB]` `[MOCK]` `[TEST]`
`[DOCUMENTED]` `[CONNECTED]` `[DISCONNECTED]` `[PARTIAL]` `[OPEN]` `[NOT_PROVEN]`. Distinctions preserved:
IMPLEMENTED ≠ VERIFIED ≠ CERTIFIED ≠ PILOT-VALIDATED ≠ UNIVERSAL; a UI screen existing ≠ a working backend.

## A. Repository statistics `[PROVEN]`
4625 tracked files · 2580 non-test source (.ts/.tsx) · 1115 test files · 146 JSON config · 496 markdown · 38
scripts. Per app: **desktop 1435** source files (the product), backend 101, mobile 44, **cloud 1 (scaffold)**.
Desktop main: 1012 non-test `.ts`, 807 test files, **739 IPC channel registrations**, ~64 `*Store.ts` / 81
`declareStoreScope`. ~50 packages (only 4 imported by desktop). Test status at `ffa2863` (re-run this session):
**main 8511 passed / 3 skipped (807 files); UI 183 passed (24 files)**; typecheck + lint clean.

## B. Major directories `[PROVEN]`
- `apps/desktop` — **the product** (Electron main + renderer). `src/main/{cst,connectors,workforce,ai,auth,
  onboarding,unified/sync,cloud,federation,enterprise,tenancy,security,platform,services}` + `executeEngine.ts`,
  `runtimeCore.ts`, `executionStore.ts`, `index.ts`. `src/renderer/src/{shell,enterprise,workforce,connectors,
  assistant,onboarding,firstRun,administration,missionControl,autonomousOpsCenter,understanding,…}` (~60 areas).
- `apps/backend` — **real Postgres HTTP API** (auth/org/billing/sync/memory). `apps/cloud` — scaffold (1 file).
  `apps/mobile` — small (companion-protocol bridge).
- `packages/*` — ~50; only `shared` (231 files, backbone), `companion-protocol`, `solution-packs`, vendored `cst`
  are used by desktop. The other ~46 are `[DISCONNECTED]` composition layers.
- `certification/` — this program's docs (54+ source-update files) + `PRODUCT-READINESS-MATRIX.md` +
  `windows-runtime-evidence-rc20/`.

## C. NeuroPause OS components — **there is no operating system** `[PROVEN]`
**Critical honesty finding:** "NeuroPause OS" is **NOT an operating system.** There is **no Ubuntu/Linux base, no
kernel, no daemons, no init/boot system, no system services** at the OS level. It is an **Electron desktop
application** (macOS/Windows). The only OS-level integrations are Electron app lifecycle: single-instance lock,
tray, launch-at-login, power events, auto-update, keychain (`safeStorage`). The word "kernel" in the codebase =
the **CST governance kernel** (a TypeScript library, `@neuropause/cst`), not an OS kernel. No Linux target exists
in `electron-builder.yml`. `[PROVEN-ABSENT of OS/kernel/daemon layer]`. What DOES exist as a "runtime" is
`runtimeCore.ts` (an in-process composition root) + `runtimeReadiness.ts` (starting/ready/failed) — an application
runtime, not a system runtime.

## D. Complete workflow inventory (INPUT→UI→IPC→SERVICE→STATE→AI/WORKER→OUTPUT)
| Workflow | Status | Evidence (current source unless noted) |
|---|---|---|
| Authentication (OAuth/PKCE + email/pw) | **GREEN [REAL]** | `auth/authService.ts` (PKCE+loopback, single-flight refresh, offline-safe); backend providers google/apple/github/microsoft + argon2 |
| Onboarding / first-run | **GREEN [REAL]** | `onboarding/{onboardingService,experienceProfileService}.ts` (persist+quarantine+resume); renderer `firstRun/FirstRunExperience.tsx` |
| Workspace/tenant creation & switching | **YELLOW [REAL]** | tenancy stores + `enterprise:workspace.*`; prior-audit split-brain switcher fixed round 26 |
| AI routing (local/cloud, privacy clamp) | **GREEN [REAL]** | `ai/aiEngine.ts`, `providerManager.assembleRouteCandidates` clamp `min(platform,tenant)`, `planRoute` blocks cloud under local_only (socket-proven) |
| Local AI (Ollama) | **GREEN [REAL]** | `ai/ollamaClient.ts` real HTTP `/api/chat`; detect/pull IPC |
| Cloud AI (Anthropic/OpenAI) | **YELLOW [REAL, keys-gated]** | `claudeClient.ts`/`openaiClient.ts` real HTTP; live tests gated `NP_LIVE_AI`; cloud-live needs real keys |
| Provider configuration | **GREEN [REAL]** | `ai/aiConfigIpc.ts` cluster; vault credential storage |
| Data import/export | **YELLOW [REAL]** | dataPlane import/export engines (prior-audit Gate 7: provenance redaction HIGHs) |
| Connectors / sync | **GREEN [REAL]** | `unified/sync/orchestrator.ts` + **20 adapters** (gmail, google*, slack, salesforce, sap, oracle, workday, servicenow, hubspot, notion, atlassian, github, dynamics, m365, entra) |
| M365 consequential writes (governed) | **GREEN [CERTIFIED]** | governedSend/governedAction/CST; 29/29 coverage guard committed |
| Governance / approval | **GREEN [REAL]** | CST (IPC) + Boundary-B/Step-5 (worker); approval/awaiting_approval UI |
| Provenance / audit | **YELLOW [REAL]** | ExecutionStore + `enterprise.audit` + timeline + hash-chained audit trail + HoldsView |
| Automation | **YELLOW [REAL]** | `enterprise/automationRunner.ts` + `automationPlatform/` (create/execute/schedule; no auto-retry) |
| AI workforce / agents | **YELLOW [REAL, gated]** | `workforce/` worker→skill→proposal→approval→dispatch→executor; advisory-by-default |
| Organization/tenant | **YELLOW [REAL]** | org/membership stores + backend org API; prior-audit provisioned-owner fixed round 40 |
| Cloud / federation | **YELLOW [REAL, in-process]** | livesync backend-backed push/pull; federation IPC real but cross-node transport thin |
| Notifications | **GREEN [REAL]** | Electron Notification (automation `notify` action) |
| Settings | **GREEN [REAL]** | AI config, tenant preference, provider settings |
| Marketplace/store | **YELLOW [SCAFFOLD-ish]** | AI Store UI exists; prior-audit: 9 preview-only connectors |
| macOS release | **GREEN [REAL]** | electron-vite + electron-builder mac dmg/zip + notarize + verify:release |
| Windows release | **YELLOW [REAL]** | nsis/zip/portable; prior-audit rc.20 ran on Win11 ARM64 VM (sign-in flows backend-blocked) |

## E. Automation inventory `[REAL]`/`[PARTIAL]`
Engine: `enterprise/automationRunner.ts` + `automationStore.ts` + `automationPlatform/` + `services/taskScheduler.ts`.
Capabilities (source-verified): **create YES** (`automationStore.save`, persisted), **execute YES**
(`runRule`→`ActionExecutor`; real effects: notify/save-memory/ai-summarize; connector-write **held for
confirmation**), **schedule recurring YES** (60s tick `automationPlatform/index.ts:487` over a label subset — NOT
full cron), **background jobs YES** (workforce scheduler 1s drain; TaskScheduler intervals), **triggers**
event+schedule+manual, **retry PARTIAL** (no auto-retry; safe-recovery only), **persistence YES** (rules + occurrence
de-dup survive restart; timers recreated at boot). Permissions/security: consequential actions route through
governance (confirmation/held). Tested: yes (automation suites).

## F. AI workforce / agents inventory `[REAL, gated]`
`workforce/runtime/{workerRuntime,executor,scheduler}.ts` + `workers/*.ts`. Chain: worker → skill.run (proposals
only, never self-acting) → governance evaluate → forced `require_approval` for side-effecting → `awaiting_approval`
→ human approve → mint Bound Decision Claim → ExecuteEngine Step-5 + Boundary-B → `runBinding` → real executor.
Most built-in workers are **read-only advisory** (`proposals:[]`); the **infrastructure workforce is genuinely
consequential** (aws_ec2_stop, docker/k8s restart, secret rotate) — real effects **only after human approval**.
Real vs mock: **REAL execution, double-governed, conservatively scoped.** `[SCAFFOLD]`: **no extensible agent
tool-registry** — the "tool" layer is a fixed `runBinding` switch (infra/m365/automation); assistant `toolCall`
records are audit, not a dispatcher.

## G. Provider inventory `[REAL]`
| Provider | Client | Real HTTP? | Credential | Provenance |
|---|---|---|---|---|
| Ollama (local) | `ai/ollamaClient.ts` | yes `/api/chat` | none (localhost) | `location:'local'` |
| Anthropic/Claude | `ai/claudeClient.ts` | yes `api.anthropic.com/v1/messages` | keychain vault (`credentialStore`) / env | `location:'external'` |
| OpenAI | `ai/openaiClient.ts` | yes `api.openai.com/v1/chat/completions` | keychain vault / env | `location:'external'` |
| (selector) PrivateFirstClient | `ai/privateFirstClient.ts` | composite | — | stamps `{location,provider,mode,reason,attempted}` |
| MockModelClient | `ai/mockClient.ts` | **no** | — | `[MOCK — tests only]` |
Routing: `min(platform,tenant)` clamp enforced at `providerManager.ts`; `local_only` provably blocks cloud
(socket test). Fallback when unconfigured/error = **honest** empty `model:'none'` (not a canned fake). Live tests
gated `NP_LIVE_AI`; wire tests ungated.

## H. Desktop feature inventory `[PROVEN]`
~60 renderer areas, typed IPC client (`ipc.<ns>.<method>`), mostly CONNECTED to runtime. UI with working backend:
execution status, approvals (approve/reject/escalate), worker/MissionControl, audit/timeline, HoldsView ledger,
incidents/recovery (AutoOps), connector health, tenant/workspace switch, AI config/assistant, onboarding.
**UI-without-distinct-backend-state (gaps):** runtime `starting/ready` (only `failed` shown); **M365 write
outcomes binary ok/text — no UNKNOWN/HOLD/DENIED/reconcile badge** (the `ConnectorWriteResult` type can't carry
them); **"reconciliation required" absent everywhere.** No single unified operator console (spread across
MissionControl/AutoOps/HoldsView/IntegrationHealth).

## I. Database / state architecture `[REAL]`
Desktop: ~64 `*Store.ts` / 81 `declareStoreScope`; base `unified/unifiedStore.ts` (JSON today, swappable);
atomic tmp+rename everywhere; **corruption = quarantine-not-reseed** (`storage/storeEnvelope.ts`) — **except**
`ExecutionStore` (fail-open, prior finding) and connector/secret vault (prior-audit reset-on-corrupt). Two keychain
vaults: `security/secureStore.ts` (refresh + AI keys) and `connectors/connectorVault.ts` (per-connector OAuth,
workspace-scoped, refuse-plaintext, fail-closed clear, key-rotation). Tenant/workspace/user scoping **enforced** via
`tenancy/{storeScope,tenantOwnedStore}.ts` (unscoped store impossible to ship). Event bus via EventEmitter +
platform events. Governance-durable: `executions.json`, `m365-governed-actions.json`. Backend: **PostgreSQL** (pg,
12 SQL migrations, transactional runner, `schema_migrations`) + Redis; hand-rolled SQL repositories (no ORM).

## J. Security / IPC architecture `[REAL]`
739 IPC channels behind a secure bridge (sender-trust → auth → permission → Zod validation, prior-audit Gate 10
GREEN pipeline). Renderer `ExecuteRunRequest` is `.strict()` (no injected authority). Governance: CST (IPC) authz +
atomic admission + idempotency; Boundary-B (worker) exact-binding verification; authoritative actor/tenant
main-process only (renderer excluded). Secrets: safeStorage/keychain, ciphertext-only, refuse-plaintext, zero
secrets in logs (prior-audit grep-verified). Fail-closed: DurableIdempotencyStore, boot router, tenant predicates.
`[OPEN]`: worker UNKNOWN collapse; ExecutionStore fail-open; `workspace-ctx:*` unauthenticated-by-design; cloud org
channels authorize on membership only (server-side enforcement unverified — prior-audit).

## K. macOS architecture `[REAL]`
electron-vite build → electron-builder (dmg + zip, arm64, hardenedRuntime, entitlements) → `afterSign:
notarize.cjs`. Single-instance lock → bootstrap → initRuntimeCore → readiness gate → RuntimeFailureNotice on fail.
Auto-update generic beta. Prior-audit: live macOS boot verified (~300ms, 722 handlers, graceful shutdown flush).
**Current caveat:** the packaged `dist/` artifacts are rc.20/`efe8196`, **not** `ffa2863`, and **not notarized**
(`notarization-status.json`: credentials absent).

## L. Windows architecture `[REAL, partially verified]`
electron-builder win (nsis + zip + portable, x64). Prior-audit Gate 20: rc.20 `NeuroPause-Setup.exe` ran on
Windows 11 ARM64 (QEMU/HVF VM under x64 emulation) — boot-health/IPC-race/tenant/persistence PASSED (722 handlers,
no-handler=0 across 5 launches); sign-in-gated flows (import/export, business, owner-row) backend-blocked in the
offline VM. Evidence `certification/windows-runtime-evidence-rc20/`. No Linux target.

## M. Test status `[PROVEN]` (re-run at `ffa2863`)
Main **8511 passed / 3 skipped** (807 files); UI **183 passed** (24 files); typecheck (node+web) clean; lint clean.
Coverage shape (prior-audit): main-process deep; renderer components thin (~24 UI files; jsdom harness, not
driven-UI). Governance/negative/durability/coverage-guard suites all green. E2E: `productJourney.test.ts` (8 phases,
prior-audit). Live-provider + Windows-runtime evidence are env/machine-gated.

## N. Product-readiness status (prior-audit 27 gates @ `33b9173`/rc.20, NOT re-verified at ffa2863)
After round 42: **GREEN 5 · YELLOW 21 · RED 0 · GRAY 1**. GREEN: Connectivity(9), Navigation(14), Test-suite(17),
Feature-completeness(25). Notable YELLOW: Bootstrap, Auth, Tenancy, Enterprise, Data, AI/Assistant, Database, UI,
Onboarding, Recovery, macOS, Windows, Real-user-acceptance, Final-release-gate (GO for macOS rc.20; Windows hold).
GRAY: Performance (unmeasured). **This is a prior audit of a different commit; treat as corroborating context, not
current certification.** The current-branch certification (M365 CST program) is separate (§ below).

## O. Missing / broken / unverified components
- **No OS/kernel/daemon layer** (it's an Electron app) `[PROVEN-ABSENT]`.
- **~46 packages disconnected** from the product `[DISCONNECTED]`.
- **No extensible agent tool-registry** `[SCAFFOLD]`.
- **No auto-retry** of failed automations/jobs (safe-recovery only) `[PARTIAL]`.
- **M365 write UNKNOWN/reconcile not operator-visible**; ConnectorWriteResult can't carry it `[OPEN]`.
- **Worker UNKNOWN collapse**; **ExecutionStore fail-open** `[OPEN]`.
- **No `ffa2863` deployable/notarized artifact** (dist is rc.20/`efe8196`, un-notarized) `[OPEN]`.
- **Cloud-live AI** unverified without real keys; **Windows sign-in flows** unverified offline `[NOT_PROVEN]`.
- **Federation cross-node transport** thin (in-process) `[PARTIAL]`. **apps/cloud** scaffold `[SCAFFOLD]`.
- Prior-audit YELLOW residuals (dp:provenance redaction, vault reset-on-corrupt, error-hiding UI sites).

## P. Top 20 remaining engineering gaps (prioritized)
**P0 (before any pilot/release):**
1. Build a **signed + notarized package from `ffa2863`** (current artifacts ≠ baseline). 2. ExecutionStore
fail-open → corruption-evident/fail-closed hydration (worker single-use integrity). 3. dp:provenance unredacted
disclosure + write-failure-swallow (prior-audit Gate 7 HIGHs). 4. Connector/secret vault quarantine-not-reset + add
to backup registry.
**P1 (pilot quality):** 5. Render M365 `data.outcome` (UNKNOWN/HOLD/DENIED) + a reconciliation surface. 6. Worker
UNKNOWN preservation (route worker effect through CST or call action.run one layer down). 7. Cloud-live AI
verification with real keys. 8. Windows networked sign-in acceptance run. 9. Runtime `starting/ready` UI +
unified operator console. 10. Auto-retry / durable job recovery for automations. 11. Migrations run before stores
load (prior-audit Gate 11).
**P2 (post-pilot):** 12. Extensible agent tool-registry. 13. Federation cross-node transport (real backend). 14.
apps/cloud implementation. 15. Renderer driven-UI test coverage. 16. Full cron (beyond label subset). 17. Marketplace
/preview-connector completion.
**P3 (research/future):** 18. Worker↔CST governance parity unification. 19. Cross-process/power-loss durability +
provider verification oracle. 20. Consolidation/removal of the ~46 disconnected packages (or an actual OS layer if
"OS" is to be literal).

## Q. Exact files responsible for each P0/P1 gap
1. `apps/desktop/package.json` scripts + `electron-builder.yml` + `scripts/notarize.cjs` (build action, no source
   change). 2. `apps/desktop/src/main/executionStore.ts` (loadAllSync). 3. `apps/desktop/src/main/dataPlane/
   {index.ts,importer.ts}`. 4. `apps/desktop/src/main/connectors/connectorVault.ts`, `security/secureStore.ts`.
   5. `apps/desktop/src/renderer/src/connectors/M365WritePanel.tsx` (+ HoldsView wiring). 6. `apps/desktop/src/main/
   runtimeCore.ts` (runBinding m365) and/or `connectors/m365/executor.ts` — **FROZEN, separate authorization**.
   7. `apps/desktop/src/main/ai/liveProviderVerification.test.ts` (run with keys). 8. `certification/
   windows-runtime-evidence-rc20/` procedure on a networked Windows host. 9. `apps/desktop/src/renderer/src/shell/
   RuntimeFailureNotice.tsx` + a new console. 10. `apps/desktop/src/main/enterprise/automationRunner.ts` +
   `unified/sync/retryQueue.ts` pattern. 11. `apps/desktop/src/main/runtimeCore.ts` (migration ordering).
   **None modified in this audit.**

## Final architecture map `[PROVEN]`
```
NeuroPause "OS"  = an Electron desktop application (NOT an operating system)
├── Desktop Runtime — apps/desktop/src/main/{runtimeCore.ts, index.ts, executeEngine.ts, runtimeReadiness.ts, executionStore.ts}
├── UI            — apps/desktop/src/renderer/src/{shell,enterprise,workforce,connectors,assistant,firstRun,missionControl,autonomousOpsCenter,understanding}
├── AI Platform   — src/main/ai/{aiEngine,modelRouter,providerManager,privateFirstClient,{ollama,claude,openai}Client,aiConfigIpc}.ts  [REAL, 3 real providers]
├── AI Workforce  — src/main/workforce/{runtime/{workerRuntime,executor,scheduler},workers/*,execution/{boundaryB,workforceActionExecutor}}  [REAL, gated]
├── Automation    — src/main/enterprise/{automationRunner,automationStore,automationActions} + automationPlatform/ + services/taskScheduler.ts  [REAL]
├── Connectors    — src/main/connectors/m365/* (governed) + unified/sync/{orchestrator,adapters/*20}  [REAL]
├── Data          — ~64 *Store.ts + storage/storeEnvelope.ts + tenancy/{storeScope,tenantOwnedStore} + security/secureStore + connectors/connectorVault  [REAL]
├── Enterprise    — src/main/enterprise/* (org/units/roles/audit/billing) + administration UI  [REAL]
├── Governance    — src/main/cst/{sendTransition,governedAction,durableIdempotencyStore,boundDecisionClaim(+Mint)} over vendored @neuropause/cst  [CERTIFIED for M365 IPC]
├── Cloud         — src/main/cloud/{index,livesync/*} + federation/* + apps/backend (Postgres+Redis+12 migrations)  [REAL; federation in-process; apps/cloud scaffold]
├── OS Integration— Electron only: single-instance, tray, launch-at-login, power, auto-update, keychain  [REAL; no true OS layer]
└── Release       — electron-vite + electron-builder (mac dmg/zip arm64, win nsis/zip/portable x64) + notarize + verify:release  [REAL; artifacts ≠ ffa2863, un-notarized]
```

## Verdict
NeuroPause is a **genuinely substantial, mostly-real desktop product** — real auth, onboarding, three real AI
providers with an enforced privacy clamp, a real (human-gated) workforce/automation stack, 20 sync connectors,
keychain vaults with enforced tenant isolation, and a real Postgres backend — whose **M365 consequential-write
governance is CERTIFIED on the IPC ingress**. It is **NOT an operating system** (no kernel/daemon/Linux layer), the
**~46 enterprise packages are disconnected scaffolding**, and the honest gaps are concrete (deployment artifact ≠
baseline + un-notarized, worker UNKNOWN, operator-visible reconcile, cloud-live/Windows sign-in verification, no
agent tool-registry, no auto-retry). Nothing here was made to look more complete than the source proves.

## STOP
Audit only. HEAD unchanged (`ffa2863`); 0 production/test/frozen changes; no app launched; exactly one new document;
prior documents preserved; nothing staged, committed, or pushed.
