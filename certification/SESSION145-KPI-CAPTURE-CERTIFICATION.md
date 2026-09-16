# SESSION 145 — WHOLE-REPOSITORY SUBSTANTIVE CAPABILITY CONVERGENCE CERTIFICATION
### Date: 2026-09-06 · Branch: cert/data-import-cst-integration · from 95fd624 · NON-FROZEN, no FG token
### Selected + built: **On-demand governed KPI capture goes live** (`kpi:capture`, 1 dark governed action) — GREEN

---

## 1 · Fresh discovery / census
Governed command spine LIVE (25 domain commands, all renderer-exposed after S142). Governed operational
READ branch LIVE. Enterprise module registry LIVE (~110 modules). Trial balance LIVE (S143). Federation
legacy-policy migration/quarantine LIVE (S144, 4 channels). Data-plane governed export LIVE + wired.
Backup/audit/approvals/holds all renderer-consumed. **Remaining CORRECT-BUT-DARK governed channels (registered
+ governed + tested in main, no renderer path):** `KpiCapture` (1), `EcosystemKeysRotate` (1), Sandbox authoring
CRUD (~9), Ecosystem OAuth token endpoints (dark by design, machine-facing).

## 2 · Direct vs transitive package consumption
Unchanged from S144. Direct desktop deps: `@neuropause/shared`, `companion-protocol`, vendored `cst`,
`solution-packs`. ~44 other `packages/*` remain unconsumed parallel runtimes on the no-activate list. The KPI
engine used here is the LIVE in-app `main/enterprise/**` executive-center subsystem, not a package.

## 3 · ≥8 candidates
1. **KpiCapture** (`kpi:capture`) — DARK governed action (`intelligence:read`), tenant server-resolved via
   `activeTenantScope`, reads the active tenant's inventory and writes tenant-scoped kpi-snapshots +
   kpi-exceptions (idempotent + immutable per period). Sibling `ExecutiveCenterSnapshot` already wired; the
   snapshot could be viewed but never freshly captured. **No frozen change; no undefined policy.**
2. `EcosystemKeysRotate` — DARK governed+audited action beside wired create/revoke. Developer-niche.
3. Sandbox authoring CRUD (~9 channels) — DARK, larger surface; sandbox authoring is a developer feature.
4. Ecosystem OAuth token/revoke — DARK BY DESIGN (machine-facing) — not a UI gap.
5. Governed operational-evidence export — already wired (`dp:export` / `ExportConfig.tsx`) — not dark.
6. Trial Balance / P&L / Balance Sheet report *module* — needs FG (frozen `enterprise/index.ts` registration).
7. Cross-module enterprise search — MISSING + NEEDS POLICY (ranking/authz) → excluded.
8. Inbound correlation (S138) / ABAC enforcement / persistence migration / S132 qs — NEEDS POLICY or on the
   permanent-block list → excluded.

## 4 · Ranking + selection rationale
**#1 KpiCapture wins.** It is the highest-value fully-buildable-now "correct but dark" capability: a complete
governed action (RBAC `intelligence:read`, server tenant, idempotent+immutable writes, tested in the
executive-center subsystem) that sits directly beside the already-wired executive snapshot, yet had no way for
an operator to trigger a fresh capture — the dashboard could only ever show whatever period was last captured.
Its activation is the smallest, safest, most useful "make it live" move: one renderer helper + one action
button on the panel that already loads the snapshot. `EcosystemKeysRotate` and Sandbox CRUD are developer-niche;
the report modules need an FG token; everything else is policy-blocked. No undefined policy, no frozen surface,
no new infrastructure, no AI authority.

## 5 · Exact architecture path
`ExecutiveCenterPanel ("Capture KPIs", intelligence:read) → ipc.intelligence.kpiCapture() → rawInvoke
(window.neuropause.invoke) → IPC kpi:capture → runtimeAuthz RBAC intelligence:read → executiveCenterSubsystem
handler () => captureForActiveTenant() → kpiIntelligenceInstance.captureForActiveTenant() (tenant resolved
server-side via activeTenantScope; reads inventory-products; writes tenant-scoped kpi-snapshots + kpi-exceptions,
idempotent + immutable per period) → { ok, captured } → panel truthful message + snapshot refresh via
ipc.intelligence.executiveCenterSnapshot()`. Reuses the existing channel, handler, RBAC, declareChannelResource
(mutate) contract, and the existing ExecutiveCenterPanel — no new store/channel/command/bus/authz.

## 6 · Files changed (all non-frozen)
- `apps/desktop/src/renderer/src/lib/ipc.ts` — one `ipc.intelligence.kpiCapture` helper (via untyped
  `rawInvoke`, since `kpi:capture` is not in the frozen `IpcResponseMap` — the platform-dispatch precedent
  reused in S144).
- `apps/desktop/src/renderer/src/enterprise/ExecutiveCenterPanel.tsx` — `Button` import; `capturing`/`captureMsg`
  state; a `captureKpis` async handler (truthful outcome message; refreshes the snapshot on success); a
  "Capture KPIs" action on the Executive Intelligence panel + the outcome banner. NEVER fabricates a count — a
  refusal (`ok:false`) and an "already captured this period" (`captured:false`) each get their own honest
  message.
- **new** `apps/desktop/ui-tests/session145KpiCapture.test.tsx` (3).

## 7 · Frozen / FG status
**No frozen surface touched. No FG token.** gate-detector = PROCEED ×3. The channel, handler, RBAC entry,
zod contract, and KPI engine already existed; only the renderer was added.

## 8 · Security proof
`kpi:capture` keeps its existing governance: RBAC `intelligence:read`, enforced main-side. The renderer sends an
EMPTY payload (proven: `sawPayload` `toEqual({})`, no `tenantId`/`orgId`/`org` field) — the tenant is resolved
SERVER-SIDE via `activeTenantScope`, never renderer-supplied. Writes are idempotent + immutable per period, so a
double-click cannot double-write (a second capture in the same period returns `captured:false`, not a
re-mutation). AI remains advisory — this is an operator-initiated button, not an AI-dispatched action. No
secret/credential/raw-payload surface; the panel shows only the `{ ok, captured }` outcome as a truthful
message.

## 9 · Tenant proof
Tenant identity is server-resolved (`activeTenantScope`); the renderer never supplies it. The focused test
asserts the dispatched payload is exactly `{}` with no tenant/org key. Snapshot and capture both scope to the
active tenant server-side.

## 10 · Policy analysis
**No undefined policy invented.** KPI capture semantics were fully defined by the executive-center subsystem:
what is captured (inventory-derived KPI snapshots + exceptions), the period grain, and the idempotent+immutable
write rule all already exist and are tested in main. S145 adds no approval/SoD/threshold/retention/ownership
decision — it only exposes an existing governed action on the real product path.

## 11 · Focused test results
`session145KpiCapture.test.tsx` (3): capture dispatches `kpi:capture` with an EMPTY payload (no
renderer-supplied tenant/org); `captured:false` (already captured this period — immutable) is returned honestly,
not thrown; a governed refusal (`ok:false`) is returned honestly, not thrown. All 3 green.

## 12 · Full regression
| Check | Result |
|---|---|
| gate-detector (3 files) | **PROCEED ×3** — zero frozen |
| typecheck node / web | **0 / 0** (exit 0 / 0) |
| eslint (3 files) | **0** |
| Full main (8 shards) | **10,844 passed / 7 skipped** (1038 files) — unchanged vs S144 (renderer-only, decision-neutral) |
| Full UI | **528 passed** (94 files) — S144 525 → **+3** |

## 13 · Package activation status
Unchanged. No package activated/imported/retired/deleted; no duplicate infrastructure. Reuses the live
executive-center subsystem + the existing ExecutiveCenterPanel + the existing intelligence IPC cluster.

## 14 · Remaining blockers (unchanged, not pretended solved)
- S138 inbound correlation policy; persistence-migration policy; ABAC/delegation/JIT authority policy; SLO
  verdict; macOS/keychain/live-Electron OPERATOR-PENDING (Linux); S132 qs/supply-chain remediation.

## 15 · Commit hash
`<see commit below>` (single non-frozen commit).

## 16 · Recommended S146
Next fully-buildable "correct but dark" candidate (no frozen change): **EcosystemKeysRotate** (a dark governed +
audited action beside the already-wired ecosystem create/revoke). Sandbox authoring CRUD (~9 channels) is a
larger dark developer surface. A dedicated Trial Balance / P&L / Balance Sheet report *module* remains an
FG-gated slice (frozen `enterprise/index.ts` registration) — present the exact FG request. Respect the S138
block, the parallel-runtime no-activate list, and the S132 debt.

**No FG token. No duplicate infrastructure. No AI authority. No invented policy. No secrets/raw payload exposed.
Zero frozen surfaces touched. An executive dashboard that could show KPIs but never capture a fresh period is now
capturable on the real governed product path. macOS/keychain NOT claimed (Linux CI).**
