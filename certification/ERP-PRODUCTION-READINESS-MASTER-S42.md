# ERP PRODUCTION-READINESS MASTER ASSESSMENT — SESSION 42

**Assessment / decision gate only. No feature built. No production source changed.**

## 1 · CURRENT COMMIT

`7e561a3 docs(erp-s41): record executed packaged-Electron SIGKILL PASS; close YELLOW` — HEAD == `origin/cert/data-import-cst-integration` (both `7e561a339cc3…`). Branch `cert/data-import-cst-integration`. Working tree clean except the pre-existing `certification/baseline.json` (preserved, not staged) and untracked custody artifacts (`dist-seam-b13/`, `out-seam-b20/`, `out-seam-s41/`, `.claude/`, the GATE/NP-AMEND/SEAM-B37 evidence, `tenantOwnership.e2e.cjs` — all preserved, not staged).

## 2 · S17–S41 MILESTONE MAP

- **S17–S21** — the governed platform: domain command seam + command bus, application boundary, RFQ/quote, durable idempotency + outbox + transaction (S18), workflow/approval runtime (S20), sales-order client adapter (S21).
- **S22** — FG-ERP-LIVE-IPC: `platform:command.dispatch` live through the real secure bridge (the one approved additive frozen change; change-control choreography).
- **S23–S30** — governed ERP commands: PostGoodsReceipt, ApproveSupplierInvoice, PaySupplierInvoice, ShipSalesOrder, InvoiceSalesOrder, IssueCustomerInvoice, ReceiveCustomerPayment + GL/journal control-plane certification.
- **S31–S36** — production-readiness: outbox delivery relay + delivered sink (S31), governed operational read (S32), DurableJsonStore concurrency (S33), health/readiness (S34), delivery-operations drill-down (S35), backup/recovery of the command spine (S36).
- **S37–S41** — crash recovery: mapped + certified (S37), PROCESSING orphan recovery (S38), transactional-outbox decision (S39), intent-first dual-write closure (S40), real-OS-SIGKILL certification incl. packaged Electron on macOS (S41).

## 3 · GREEN / YELLOW / GRAY / RED MATRIX

| # | Area | Status | Basis |
|---|------|--------|-------|
| A | Core architecture | 🟢 GREEN | Singular (one bus/journal/outbox/sink/primitive), certified S17–S41 |
| B | Authentication | 🟢 GREEN | `authService` + local-first principal + `requireAuth`; live M365 OAuth (S15/16) |
| C | Authorization / RBAC | 🟢 GREEN | `enterprise.allows` + `PERMISSION_FOR_COMMAND`, per-command RBAC proven |
| D | Tenant isolation | 🟢 GREEN | Keyed intents `${tenant}::${key}`, scope validation; tested S17–S41 |
| E | Command governance | 🟢 GREEN (layer) | dispatch→boundary→bus→authz→journal→event→outbox→audit, certified — **but not UI-driven (see S)** |
| F | Approval engine | 🟢 GREEN | Durable workflow/approval over the command bus (S17/S20) |
| G | Workflow engine | 🟢 GREEN | Durable workflow runtime (S20) |
| H | Transaction durability | 🟢 GREEN | S18 durable journal + S33 serialized writes |
| I | Idempotency | 🟢 GREEN | Committed replay (S18) + intent-first (S40) |
| J | Crash recovery | 🟢 GREEN | S37–S41; real OS SIGKILL certified, all windows, 5× |
| K | Outbox / delivery | 🟢 GREEN | S31 relay + S38 recovery; **at-least-once + idempotent (NOT exactly-once)** |
| L | Audit | 🟡 YELLOW | Governance audit sink wired on the GOVERNED path only; the UI module-CRUD path does not emit command-journal audit |
| M | Backup / restore | 🟡 YELLOW | S36 registered + round-trip proven; a full DR drill (destroy→restore→verify counts) on a real install is pending |
| N | Health / readiness | 🟢 GREEN | S34 probe + panel, honest states |
| O | Operational observability | 🟡 YELLOW | S32/S35 read surfaces exist; HOLD/RECONCILIATION_REQUIRED is surfaced (S35 data) but has NO operator ACTION to resolve it |
| P | ERP transaction workflows | 🟢 GREEN (engine) | S17–S30 execute + persist correctly and are certified — **but unreachable via the governed UI (see S)** |
| Q | AI governance | 🟢 GREEN (containment) / ⚪ GRAY (execution) | AI cannot write journal/outbox/stores or call the bus directly; AI→governed-ERP-execution is NOT wired (advisory/proposal-only) |
| R | Renderer/preload security | 🟢 GREEN | Secure bridge + `requireAuth`; no renderer/AI FS authority (S40/S41) |
| S | **UI/UX integration (governed ERP)** | 🔴 **RED (exposure gap)** | The governed command path has NO renderer WRITE path; the UI drives ERP via the NON-governed `enterprise:module.create/action` |
| T | Packaging | 🟢 GREEN | macOS `electron-vite`/`electron-builder` build proven (S13/B.13/S41) |
| U | macOS acceptance | 🟢 GREEN | S41 packaged SIGKILL PASS + B.10/B.13 packaged runtime acceptance |
| V | Windows acceptance | ⚪ UNTESTED | No Windows build/run evidence |
| W | Data import/export | 🟡 YELLOW | Data-plane import exists; governed-command import/export acceptance pending |
| X | External integrations / connectors | ⚪ GRAY | M365 is the one live governed connector; the ~41 preview packages NOT CERTIFIED (off critical path, per CLAUDE.md) |
| Y | Performance | 🟡 YELLOW | Perf baseline exists (Gate 22); no load/scale acceptance for the governed command path at volume |
| Z | Release / upgrade / migration | 🟡 YELLOW | electron-updater beta + migration engine exist; full upgrade/rollback + DR drill pending |

**No demonstrated RED defect** in the governed spine itself. The single 🔴 is an EXPOSURE gap (S), not a correctness defect: both paths are correct for what they do; the governed path is simply not the one the UI uses.

## 4 · END-TO-END WORKFLOW COVERAGE

The three canonical workflows (P2P: PR→approval→PO→GR→inventory→bill→3-way-match→AP→payment; O2C: SO→shipment→invoice→receipt→AR; Finance: journal→posting→reconciliation→reversal) are **implemented and certified at every layer FROM the command bus down** — application boundary → command bus → authorization → business policy → approval/workflow → domain command → durable transaction → persistence → event → outbox → delivery → audit (S17–S30 + S31/S36 + S37–S41). **The layer that is missing for all three is the FIRST one: UI → preload → IPC does not reach the governed command bus for ERP WRITES.** The renderer calls `platform:command.dispatch` for READS only (`QueryOperationalHistory`, `QueryPlatformHealth`, `QueryDeliveryOperations` — S32/S34/S35). No ERP command type (`CreatePurchaseRequest`, `CreateSalesOrder`, `PostGoodsReceipt`, `ApproveSupplierInvoice`, `PaySupplierInvoice`, `ShipSalesOrder`, `InvoiceSalesOrder`, `IssueCustomerInvoice`, `ReceiveCustomerPayment`) is referenced anywhere in `src/renderer`. The production UI creates/acts on ERP records through `enterprise:module.create/action` (`ipc.enterpriseModules.create/action`), which writes the durable module store but does NOT pass through the command journal / idempotency / outbox / intent-first / command-audit. **Governed ERP execution from the UI: NOT WIRED.** The governed path is exercised today only by tests, the `platformCommandLive` e2e, and the AI/API adapters.

## 5 · SECURITY / GOVERNANCE COVERAGE

RBAC is enforced inside the command bus (`ctx.authorize(PERMISSION_FOR_COMMAND[op])`) and at the channel (`requireAuth`); tenant is principal-derived and a claimed tenant is rejected; no renderer/AI filesystem authority; the intent/journal/outbox stores live behind `DurableCommandJournal` in the main process. All GREEN **for the governed path**. Caveat: because ERP writes currently flow through the non-governed module CRUD, the command-journal-level authorization/audit is bypassed for real-user ERP writes (the module CRUD has its own RBAC via `enterprise.allows`, so writes are still authorized — but the governed idempotency/outbox/audit envelope is absent). This is the same gap as (S)/(E)/(L), stated from the security angle.

## 6 · AI GOVERNANCE ASSESSMENT

`src/main/liveBrain` and `src/main/assistant` do NOT import `DurableCommandJournal`, `dispatchOutbox`, `store.put`, or `dispatchCommand`, and do not reference `platform:command.dispatch` — verified repository-wide. **AI cannot write directly to ERP stores, the journal, or the outbox, cannot bypass authorization/approval/tenant resolution/audit.** Consistent with CLAUDE.md §13 (the Brain proposes; it never reaches). Consequence: there is currently **no governed AI→ERP execution path at all** — AI is advisory/proposal-only for ERP. That is safe (fail-closed) but means "AI executes a governed ERP command" is **⚪ GRAY (undefined/unwired)** — a future BRAIN→PROPOSAL→GOVERNANCE→EXECUTION wiring, not a defect. No AI policy was invented here.

## 7 · OPERATIONAL READINESS ASSESSMENT

An operator CAN see: system health (S34), command history + outbox status (S32), delivery status / retrying / failed reason (S35), backup count + integrity (S36 via the continuity panel). An operator CANNOT yet ACT on: a `HOLD`/`RECONCILIATION_REQUIRED` command (S40 surfaces it in the S35 read as `heldReconciliations`, but there is no operator action to resolve/retry/cancel it) — recovery is automatic for PENDING/RETRYABLE/stale-PROCESSING, but a genuinely-ambiguous HOLD needs a human decision the UI does not offer. Also, a full DR drill (restore→verify) is not operator-driven. **Operational observability: GREEN; operational ACTIONABILITY on HOLD: YELLOW.**

## 8 · PACKAGING / PLATFORM ACCEPTANCE

macOS: 🟢 packaged build + packaged-runtime acceptance + packaged real-OS-SIGKILL survival (S41). Windows: ⚪ UNTESTED. Reproducible artifacts + signing scripts exist; notarization/Windows signing are standing money/cert gates.

## 9 · S41 RESIDUAL ASSESSMENT (§6 of the directive)

The missing "same-profile authenticated packaged Electron crash recovery" is **classified D (unnecessary — equivalent lower-level evidence provides sufficient assurance), non-blocking, leave GRAY.** Rationale: (1) the packaged Electron PROCESS surviving a real OS SIGKILL + clean reboot IS proven (S41 packaged PASS, pid 78116 killed); (2) the deep same-directory recovery SEMANTICS (all windows, no duplicate effect) are certified by the S41 node harness against the IDENTICAL production `DurableCommandJournal`/intent/outbox code, on both Linux and macOS; (3) the only unexercised piece is producing GOVERNED durable state inside the packaged app before the kill, which is gated only by an authenticated-account test fixture — an evidence/tooling nicety, not a correctness or release concern. **Do NOT choose it as S43.** It may fold into a future authenticated-packaged integration test at low priority.

## 10 · DUPLICATE-INFRASTRUCTURE AUDIT

Repository-wide, exactly ONE of each production instance:
- Command bus: `dispatchCommand` (`platform/command/commandBus.ts:350`) — 1.
- Application Boundary: `handleApplicationRequest` (`platform/application/applicationService.ts:88`) — 1.
- DurableCommandJournal: constructed once (`ipc/handlers/platformCommandIpc.ts:251`).
- DeliveredEventLog: constructed once (`platformCommandIpc.ts:256`).
- Handler builder: `buildPlatformCommandHandlers`/`buildPlatformCommandDispatchDef` — 1 each.
- Intent/idempotency: the journal's committed-record replay + intent ledger (S40) — one mechanism.
- DurableJsonStore: one primitive, reused by journal/sink/intents/approvals (not duplicated).
No duplicate command bus / IPC router / boundary / journal / outbox / sink / idempotency store / recovery engine / health system. **No suspicious duplication found.**

## 11 · FROZEN-SURFACE AUDIT

Frozen manifest (`certification/frozen-surfaces.json`): `packages/shared/`, `runtimeCore.ts`, `connectors/index.ts`, `cst/`, `enterprise/index.ts`, `tenancy/tenantContext.ts`, `auth/auth.ts`, `auth/authService.ts`. Within the **S17–S41** arc, the ONLY frozen touch is **S22 FG-ERP-LIVE-IPC** (`runtimeCore.ts` + `packages/shared` channels/contracts) — the single APPROVED additive frozen change via the change-control choreography. All other S17–S41 sessions touched no frozen surface (verified in each evidence doc + `git log --name-only`). The frozen `cst/durableIdempotencyStore.ts` was CONSUMED as a reference in S39/S40 but never modified or imported. No duplicate implementation was created outside a frozen surface (the intent ledger is on the non-frozen journal, not a fork of the CST kernel). Frozen surfaces intact.

## 12 · TOP 5 REMAINING GATES (ranked)

**Ranking dimensions:** customer/business impact · security · data-integrity · release-blocking · evidence gap · architectural leverage · implementation risk · dependency ordering.

### Gate 1 — EXPOSE THE GOVERNED ERP COMMAND PATH THROUGH THE PRODUCTION UI  ⭐ RECOMMENDED S43
- **Current state:** governed command path complete + certified (S17–S41); NO renderer write path; UI drives ERP via non-governed module CRUD.
- **Evidence:** §4 above — zero ERP command types in `src/renderer`; renderer `platform:command.dispatch` is read-only.
- **Risk:** LOW–MODERATE — reuse the existing `rawInvoke(PlatformCommandDispatch, …)` precedent (S32/S35) for writes; wire ONE workflow first; no new architecture, no frozen change.
- **Why now:** without it, the entire 25-session governance/durability/idempotency/outbox/crash-recovery/audit investment is UNREACHABLE by real users — the highest business + data-integrity + release leverage of any gate.
- **Estimated scope:** one workflow end-to-end (recommend O2C: `CreateSalesOrder`) from a UI action → `platform:command.dispatch` → governed path, with a reproduce-first proving the UI action currently bypasses governance, then the wired governed create + a driven-UI test.
- **Dependencies:** none (all infra exists).
- **Expected outcome:** a real user creates an ERP record through the governed path (durable journal + idempotency + outbox + audit + crash-recovery), proven end-to-end from the UI.

### Gate 2 — OPERATOR ACTION FOR HOLD / RECONCILIATION_REQUIRED
- **Current state:** HOLD is surfaced (S35 `heldReconciliations`) but not actionable.
- **Evidence:** §7. **Risk:** LOW. **Why now:** an ambiguous crash outcome needs a human decision; today it is visible but stuck.
- **Scope:** a governed operator action (resolve/retry/cancel a HOLD) through the existing read seam + a policy for what each action does. **Dependencies:** benefits from Gate 1's UI wiring. **Outcome:** operators can clear a HOLD safely.

### Gate 3 — WINDOWS PLATFORM ACCEPTANCE
- **Current state:** UNTESTED. **Evidence:** §8. **Risk:** MODERATE (platform-specific paths/locks). **Why now:** release-blocking for any Windows customer; the product scope names Windows. **Scope:** Windows build + a real-runtime + crash-recovery acceptance run. **Dependencies:** none. **Outcome:** cross-platform release readiness.

### Gate 4 — FULL DISASTER-RECOVERY DRILL (backup → destroy → restore → verify)
- **Current state:** S36 round-trip proven in isolation; no full DR drill on a real install. **Evidence:** §3 (M/Z). **Risk:** LOW. **Why now:** data-integrity assurance for the whole install, not just the command spine. **Scope:** an operator-driven destroy→restore→verify-counts drill + evidence. **Dependencies:** none. **Outcome:** provable recoverability of a real install.

### Gate 5 — GOVERNED AI → ERP EXECUTION PATH (proposal → approval → governed command)
- **Current state:** GRAY — AI is advisory-only for ERP; no execution path. **Evidence:** §6. **Risk:** MODERATE (governance-sensitive). **Why now:** the product's premise is AI-driven ERP; today AI cannot execute anything ERP. **Scope:** wire BRAIN→PROPOSAL→human approval→`dispatchCommand` for ONE command, reusing the existing proposal + governed path. **Dependencies:** Gate 1 (the governed UI path) first. **Outcome:** AI can propose an ERP action that a human approves and the governed path executes + verifies.

## 13 · RECOMMENDED S43

**Gate 1 — expose the governed ERP command path through the production UI (start with O2C `CreateSalesOrder`).** It is not novel; it is the gate that most increases actual production readiness. Every other gate (2, 5 especially) depends on or is amplified by it, and it converts the entire certified S17–S41 spine from "correct but dark" into "reachable by a real user." Non-frozen, low-risk, reuses existing infrastructure.

## 14 · EXPLICIT NON-GOALS (for S43 and beyond)

No new database / WAL / Kafka / queue / transaction engine / recovery engine / microservice / shadow store; no command-bus redesign; no frozen-surface change; no new ERP transaction type; do not turn the non-governed module CRUD into a second command bus (wire the UI to the EXISTING one); do not claim exactly-once; do not invent AI or reconciliation policy.

## 15 · RELEASE-BLOCKING ISSUES

1. **Governed ERP is not reachable from the UI (Gate 1)** — release-blocking for "governed ERP for real customers."
2. **Windows acceptance untested (Gate 3)** — release-blocking for Windows customers.
3. **No operator action for HOLD (Gate 2)** — operational blocker for unattended production.
Non-blocking (documented, non-defect): S41 packaged-authenticated residual (GRAY, §9); connectors preview set (GRAY); full DR drill (assurance, not correctness).

## 16 · THE THREE READINESS QUESTIONS (kept separate, per §13)

**Is NeuroPause architecturally production-ready?** **YES.** The governed command spine is singular, complete, and certified end-to-end from the command bus down (durability, idempotency, outbox, crash recovery incl. real OS SIGKILL, backup, health, audit), with no duplicate infrastructure and frozen surfaces intact. Architectural blockers: **none**.

**Is NeuroPause operationally production-ready?** **PARTIALLY.** Health, delivery, backup, and crash-recovery are observable (S32/S34/S35/S36) and recovery is automatic for PENDING/RETRYABLE/stale-PROCESSING. Operational blockers: **no operator action to resolve a HOLD (Gate 2); no full DR drill on a real install (Gate 4).**

**Is NeuroPause release-ready for a real customer?** **NO.** Release blockers: **(1) the governed ERP command path is not exposed through the production UI (Gate 1) — real users cannot drive governed ERP workflows; (2) Windows is untested (Gate 3); (3) HOLD has no operator action (Gate 2).** The governed engine is ready; the customer-facing surface over it is not.

## 17 · REGRESSION (this session — nothing changed)

Platform-command certification suites S18/S31–S40: **129/129**. Full main (sharded 4×): **960 files · 10056 passed · 7 skipped · 0 failed** (identical to S41). UI: **73 files · 414 passed**. typecheck node+web clean; eslint clean; `npm run build` ✓. No production behaviour changed to improve counts.

## 18 · COMMIT / CUSTODY

Docs only — `docs(erp-s42): establish production readiness baseline`. `certification/baseline.json` and all untracked custody artifacts preserved, NOT staged. No production source changed; no frozen surface touched.
