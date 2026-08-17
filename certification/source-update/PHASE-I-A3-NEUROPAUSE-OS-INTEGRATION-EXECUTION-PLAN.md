# Phase I-A.3 — NeuroPause OS Integration Execution Plan (READ-ONLY PLAN)

**PLAN ONLY. No implementation, no code/test/frozen change, no commit, no push this turn.** Baseline HEAD
`ffa2863`, branch `cert/data-import-cst-integration`. Source basis: all prior inventory/audit docs (unchanged).
Labels: `[PROVEN]` `[REAL]` `[CONNECTED]` `[DISCONNECTED]` `[ADAPTER]` `[TOOLING]` `[DEFERRED]` `[OBSOLETE]`
`[FROZEN]` `[OPEN]` `[REQUIRED]`. Preserved: IMPLEMENTED ≠ VERIFIED ≠ CERTIFIED ≠ PILOT-VALIDATED ≠ UNIVERSAL;
UNKNOWN ≠ FAILURE ≠ SUCCESS. **This plan does not claim pilot readiness; readiness requires five-user evidence (§30).**

## Frozen-surface constraint (governs the whole plan) `[PROVEN]`
Confirmed frozen (from committed certification evidence): `@neuropause/cst` kernel, `governedAction.ts`,
`sendTransition.ts`/governedSend, `durableIdempotencyStore.ts`, `connectors/index.ts` M365 routing, `actionSdk.ts`,
`connectors/m365/executor.ts`, `boundDecisionClaim(+Mint).ts`, `boundaryB.ts`, `ExecuteEngine`/`ExecutionSession`/
**`executionStore.ts`**, `runtimeCore.ts`, `contracts.ts`, `storeScope.ts`, `package.json`, Node engine.
**Consequence:** any subtask that must change a frozen surface (notably §13B worker-UNKNOWN and §14 ExecutionStore
fail-open) is **split out as a separate STOP-and-plan certification gate**, NOT implemented in Wave 1.

## 1. Current architecture `[PROVEN]`
NeuroPause = the `apps/desktop` Electron app (1012 main files, 739 IPC channels) + optional real Postgres backend
(`apps/backend`). Governance: CST (M365 IPC, **CERTIFIED 29/29**) + Boundary-B/Step-5 (worker, PARTIALLY
EQUIVALENT). Real subsystems in-tree: AI (3 providers + privacy clamp), workforce/agents (gated), automation, 20
sync connectors, auth (OAuth/PKCE + keychain), onboarding, ~64 tenant-scoped stores. UI: ~60 renderer areas, mostly
IPC-connected. **NOT an OS** (Electron app; no kernel/daemon layer).

## 2. Target architecture `[DESIGN]`
ONE product: `USER → LOGIN → WORKSPACE(tenant/actor/account) → AI(intent/purpose) → ACTION PROPOSAL → GOVERNANCE →
APPROVAL → ADMISSION → EXECUTION(M365 IPC) → OUTCOME → EVIDENCE → RECOVERY/RECONCILE`, presented through one operator
console, over the **existing** authoritative runtime (`runtimeCore` composition root). No new governance engine,
identity system, audit system, or durable store. Adapters, not rewrites.

## 3. Actual connected capabilities `[CONNECTED]`
AI engine + 3 providers; workforce/agents; automation; 20 connectors; M365 governance (certified); auth; onboarding;
~64 stores + 2 keychain vaults; audit/timeline/HoldsView; backend (Postgres). All wired into `runtimeCore` +
renderer IPC.

## 4. Disconnected packages `[DISCONNECTED]`
~46 of ~50 `packages/*` are not imported by desktop (workforce, execution, runtime, security, persistence,
connectors, automation, intelligence, trust-platform, autonomous-ops, federation, reliability, …). They are
NEMS/NCEA/Launch-Workstream composition layers. `@neuropause/certification` = validation tooling. `cloud-core`/
`shared-cloud`/`cloud-sdk`/`runtime` = backend/cloud-only. `apps/cloud` = scaffold.

## 5. Packages that WILL be integrated (this program) `[DESIGN]`
**None by import into desktop.** The desktop already contains the real implementations in-tree. Integration =
wiring the **existing in-tree** subsystems into one product journey + console. The only external deps that stay
are the current four (`shared`, `companion-protocol`, `solution-packs`, vendored `cst`). Rationale: importing the
~46 packages would add coupling without product value (§3 of the prompt).

## 6. Packages that will NOT be integrated, and why `[DEFERRED]`/`[OBSOLETE]`/`[TOOLING]`
- `@neuropause/certification` → `[TOOLING]` (validation only).
- `cloud-core`, `shared-cloud`, `cloud-sdk`, `runtime` → `[DEFERRED]` backend/cloud-only (not desktop pilot).
- workforce/execution/security/persistence/connectors/automation/intelligence/trust-platform/autonomous-ops/
  federation/reliability/… → `[OBSOLETE/DUPLICATE for the desktop product]` — the desktop's in-tree implementations
  are the authoritative, tested, (for M365) certified path; the packages duplicate concepts without being wired or
  certified. **Do not replace certified in-tree code with packages.**
- `apps/cloud` → `[DEFERRED]` (scaffold).
Decision recorded per §2-of-prompt taxonomy: each ends in TOOLING / DEFERRED / OBSOLETE-DUPLICATE.

## 7. Authoritative runtime composition `[DESIGN]`
The authoritative composition root **already exists**: `runtimeCore.ts` (`initRuntimeCore`). The plan adds **no new
composition layer**; it documents the authoritative owner per responsibility (§15) and adds only renderer-side
product wiring + a build pipeline. Frozen `runtimeCore` is **not** modified in Wave 1.

## 8. AI connection `[REAL → wire to journey]`
AI engine is real and wired (`aiEngine.run`, assistant IPC). Journey wiring: user request → assistant → AI proposes
→ **proposal must route to governance, never direct effect**. §6-of-prompt bypass check is a **read-only audit
subtask** (verify no AI path reaches `action.run`/`m365.execute`/`runBinding` without governance). Finding to
confirm: AI feature consumers (`engineeringAI`, `founderAI`, automation `ai-*` actions) return text/proposals, not
effects; workforce skills only propose. If any bypass is found → block it (additive guard) or report. No frozen
change expected.

## 9. Workspace connection `[REAL]`
Tenant/actor/account already authoritative (deps.workspaceId/actor; tenant-scoped stores). Journey uses the
existing workspace switcher + tenant context. No new identity system.

## 10. Identity connection `[REAL]`
Auth (OAuth/PKCE + keychain) → session → actor; tenant via workspace. Renderer excluded from authority (.strict()).
Reuse as-is.

## 11. Workforce connection `[REAL, gated]`
Existing chain (worker→skill→proposal→approval→dispatch→Boundary-B→executor) surfaced in the console (task/proposal/
approval/execution/result/evidence). **Do not claim worker/CST parity**; represent the worker↔IPC difference
honestly (per G1). No frozen change.

## 12. Automation connection `[REAL]`
Existing automation (create/execute/schedule) surfaced with explicit limits (60s tick, label subset, connector-write
held-for-confirmation, no auto-retry). No automation bypasses governance (connector-write is held). No invented cron.

## 13. Connector connection `[REAL / scoped]`
M365 IPC writes **certified**. Other domains (Google/Slack/Salesforce/SAP/Oracle/Workday/Entra sync = **read**;
Azure/infrastructure + Automation = **consequential but NOT CST-certified**). **Do not claim non-M365 consequential
domains are governed.** Pilot scope: consequential writes = M365 IPC only; other connectors = read/sync. Infra/Azure
consequential actions are **out of pilot scope** unless a separate certification gate is authorized.

## 14. Governance connection `[CERTIFIED, reuse]`
Reuse governedSend/governedAction/CST unchanged. No second governance mechanism.

## 15. Admission connection `[CERTIFIED, reuse]`
Reuse CST idempotency (IPC) / Step-5 decisionId (worker). No duplicate canonical identity — use CST's where
authoritative (§10-of-prompt).

## 16. Evidence connection `[REAL → surface]`
One user-visible evidence timeline built from **existing** sources (ExecutionStore, audit trail, timeline,
HoldsView, `data.outcome`). Missing fields (external observation / reconciliation / verification) shown as
`UNKNOWN / NOT OBSERVED / NOT VERIFIED` — never manufactured. Renderer-only wiring.

## 17. Recovery connection `[REAL → wire]`
Wire UNKNOWN → HOLD → RECONCILIATION_REQUIRED → operator action → new governed decision → close, using the existing
HoldsView + incident/recovery infra. No blind retry. Renderer + possibly one additive IPC to raise a hold from an
M365 UNKNOWN outcome (additive, non-frozen).

## 18. Memory connection `[DEFERRED]`
Operational memory subsystem exists but is not pilot-critical; deferred (P2).

## 19. Backend connection `[REAL / classify]`
Per-capability LOCAL/REMOTE/HYBRID: auth = REMOTE (backend), but desktop degrades offline; M365 governance/execution
= LOCAL (desktop + Graph); workspace/tenant = LOCAL (with REMOTE org sync HYBRID); billing/semantic-memory = REMOTE.
**Pilot-critical local-first capabilities (M365 governance, execution, evidence) must NOT depend on backend
availability.** Backend required only for sign-in + cloud sync.

## 20. UI connection `[REAL → extend]`
Extend existing surfaces into one operator console (do not build a new dashboard). Add the M365 outcome-state model
(§11-of-prompt) to `M365WritePanel` + a console view aggregating health/approvals/executions/holds/unknown/
reconciliation/incidents/connectors/audit/evidence. Renderer-only.

## 21. Security connection `[REAL, verify]`
Verify (tests) tenant/workspace/user/account/connector isolation, no renderer-controlled authority, IPC/worker
authority. Reuse existing enforcement; add cross-boundary regression tests (A≠B). No frozen change.

## 22. Deployment connection `[REQUIRED, build]`
Reproducible pipeline from the **integration HEAD** (built on `ffa2863`): build → package → **sign → notarize** →
verify → install → first-run → health → ready, macOS (+ Windows where supported). **Current `dist/` artifacts
(rc.20/`efe8196`, un-notarized) are NOT pilot artifacts** and must not be called such. Do not claim clean-machine
readiness until executed (G2-A: currently NOT EXECUTED).

## 23. P0 implementation sequence (before five-user pilot) — split by frozen impact `[DESIGN]`
**P0-SAFE (renderer/build/test only — no frozen surface):**
1. Authoritative composition **documentation** (this plan; no code).
2. AI→intent→governed-action **bypass audit** (read-only) + additive guard if needed.
3. Workspace/user/tenant/account journey wiring (reuse).
4. **M365 governed workflow end-to-end** via the certified IPC path (reuse; the journey spine).
5. **Outcome UI state model** in `M365WritePanel` (renderer; render existing `data.outcome`).
6. **Holds/Reconciliation wiring** (renderer + additive IPC).
7. **Operator console** (extend existing surfaces).
8. **Evidence timeline** (renderer, from existing sources).
9. Cross-boundary **security regression tests**.
10. **Build pilot artifact from `ffa2863`-based integration HEAD** (build/release action) + execute install/startup/
    restart verification (closes G2-A NOT-EXECUTED).
**P0-FROZEN (STOP-and-plan — separate certification gate, NOT Wave 1):**
11. **ExecutionStore fail-open → fail-closed** (`executionStore.ts` FROZEN) — see §14-of-prompt; requires a change
    plan + certification impact + tests proving no silent re-execution. **Do not implement without authorization.**
12. **Worker OUTCOME_UNKNOWN** (`runtimeCore`/`executor.ts` FROZEN) — see §13-of-prompt option B; **default to option
    A (operator procedure) for the pilot**; option B is a separate frozen gate.

## 24. P1 implementation sequence (before external customer) `[DESIGN]`
Broader connector workflows (read/sync); automation surfacing; workforce surfacing; backend/cloud sign-in +
sync; stronger verification (still no fabricated VERIFIED); improved recovery; **Windows networked sign-in
acceptance**; deployment automation (CI signing/notarization).

## 25. P2 future work `[DEFERRED]`
Worker↔CST parity; cross-process durability; power-loss/fsync; provider idempotency; automated reconciliation;
extensible agent tool-registry; broader federation; memory; apps/cloud.

## 26. Exact files for Wave 1 (P0-SAFE only) `[DESIGN]`
- `apps/desktop/src/renderer/src/connectors/M365WritePanel.tsx` — render outcome states (REQUESTED/APPROVAL_REQUIRED/
  APPROVED/DENIED/HELD/ADMITTED/EXECUTING/EXECUTION_FAILED/OUTCOME_UNKNOWN/RECONCILIATION_REQUIRED/ESCALATED;
  **never fabricate VERIFIED_SUCCESS**).
- `apps/desktop/src/renderer/src/understanding/HoldsView.tsx` (+ wiring) — connect M365 UNKNOWN → hold/reconcile.
- A new renderer operator-console view (e.g. `src/renderer/src/operatorConsole/…`) aggregating existing IPC feeds.
- Possibly one additive main IPC handler to raise a hold from an M365 UNKNOWN outcome (additive channel; NOT a
  frozen-surface change; new file under `src/main/…`, registered via the existing secure-handler seam).
- No change to any frozen file. `packages/shared/src/types/connectors.ts` — **only if** a typed outcome field is
  added; prefer using the existing `data.outcome` to avoid touching shared types.

## 27. Exact tests for Wave 1 `[DESIGN]`
- `M365WritePanel` UI test: each outcome class renders its distinct state; UNKNOWN not shown as failure/success.
- Holds/reconcile UI test: UNKNOWN → hold raised → reconcile → resolve; no blind retry control exists.
- Journey test (reuse `productJourney.test.ts` pattern): login→workspace→AI proposal→governedAction→approval→
  admission→M365 effect(stub)→outcome→evidence, over real classes.
- Regression matrix for the certified path (reuse): positive, denial, approval, replay, concurrency, restart,
  UNKNOWN, evidence, tenant/account boundary — all via the existing governedAction/coverage suites (must stay green).
- Security: tenant A≠B, user A≠B, account A≠B isolation tests.

## 28. Frozen-surface impact `[PROVEN]`
Wave-1 (P0-SAFE): **zero frozen-surface change** (renderer + additive main IPC + tests + build). P0-FROZEN items
(§23.11–12) and all P2 parity work **do** touch frozen surfaces → each is its own STOP-and-plan gate with change
plan + certification impact before any edit. The M365 coverage guard and all committed cohorts remain intact and
green.

## 29. Certification impact `[PROVEN]`
Wave-1 changes **do not alter any governance certification** (they render already-certified outcomes and add a
console/evidence view). M365 IPC 29/29 stays CERTIFIED; worker parity stays NOT PROVEN. New certification is
required only for the frozen P0-FROZEN items (ExecutionStore fail-closed; worker UNKNOWN) — each a separate gate.

## 30. Five-user acceptance matrix `[REQUIRED — evidence gate]`
Pilot readiness is declared ONLY after this is executed with evidence (no developer intervention except recorded
incidents):
| User | Workflow category | Input | Expected | Observed | Evidence | Failure | Recovery | Final |
|---|---|---|---|---|---|---|---|---|
| U1 | AI-assisted info task | (declared) | grounded answer, provenance | — | — | — | — | — |
| U2 | Governed M365 action | (declared) | governed effect / honest outcome | — | — | — | — | — |
| U3 | Approval workflow | (declared) | approve→admission→effect | — | — | — | — | — |
| U4 | Automation/workflow | (declared) | governed automation (held write) | — | — | — | — | — |
| U5 | Connector (read/sync) | (declared) | sync + evidence | — | — | — | — | — |
| any | Failure/recovery | induced UNKNOWN | HOLD→reconcile, no blind retry | — | — | — | — | — |
| any | Audit/evidence review | — | full timeline, honest gaps | — | — | — | — | — |
Every failure must end in DENIED/HELD/ESCALATED/EXECUTION_FAILED/OUTCOME_UNKNOWN/RECONCILIATION_REQUIRED/
VERIFIED_SUCCESS — never silent. Matrix is **empty (unexecuted)** until Wave-1 ships and the pilot runs.

## 31. Product Definition of Done (per subsystem) `[REQUIRED]`
A subsystem is integrated only when ALL hold: CODE (wired into the product journey) · TEST (positive + negative +
boundary green) · UI (operator can use it) · EVIDENCE (durable, honest gaps labeled) · FAILURE (terminates in a
named controlled state) · RECOVERY (hold/reconcile, no blind retry) · SECURITY (tenant/account isolation tested) ·
REGRESSION (full suite + coverage guard green; typecheck/lint clean) · CERTIFICATION IMPACT (stated; frozen surfaces
untouched or separately gated). "The import works" is NOT done.

## Implementation waves (sequencing) `[DESIGN]`
- **Wave 1 = §23 P0-SAFE items 1–10** (renderer + additive IPC + tests + build), each an atomic commit with
  `git status / diff --check / tests / typecheck / lint / frozen-surface audit`; commit only on explicit per-wave
  authorization; never `git add -A`, never touch certification history.
- **Wave 1 gate:** the §27 tests green (positive/denial/approval/replay/concurrency/restart/UNKNOWN/evidence/UI/
  tenant-account) before Wave 2.
- **Frozen gates (§23.11–12, P2):** separate authorizations, each with change plan + certification impact.
- **Five-user pilot (§30):** only after Wave 1 gate + a signed/notarized `ffa2863`-based artifact + executed
  install/startup/restart verification.

## STOP
Master integration execution plan complete (all 31 required sections). **No implementation performed. Wave 1 is NOT
implemented this turn.** HEAD unchanged (`ffa2863`); 0 production/test/frozen changes; exactly one new plan document;
prior documents preserved; nothing staged, committed, or pushed. Awaiting explicit authorization to begin Wave 1
(P0-SAFE only); the frozen-surface items remain separately gated.
