# SESSION 80 — GOVERNED KPI SNAPSHOT + EXCEPTION INTELLIGENCE

**Class:** implementation gate (Tier-1 D1 from the S79 register). Baseline S79 `40d4b1a`. **Status: CORE IMPLEMENTED + UNIT-VERIFIED (non-frozen); LIVE WIRING = FG gate; real-Electron + full-suite + build validation = PENDING Mac.** Release track PAUSED.

## Honest scope statement (read first)

S80 productionizes the governed KPI-snapshot + exception engine as **additive, non-frozen** modules with full focused-test coverage. Making it **live** (Executive Center visibility + a boot-registered capture service) requires touching **frozen** surfaces (`packages/shared` `ExecutiveSnapshot`, `runtimeCore.ts`) — which per the constitution needs the FG protocol (token + choreography), not a unilateral edit. That is presented in `FG-S80-KPI-EXCEPTION-LIVE-WIRING.md`, **not applied**. Also, this execution environment is the Linux sandbox: the **full main suite, full UI suite, build, and the real-Electron journey cannot run here** and are marked PENDING the Mac. Nothing is claimed GREEN that was not verified.

## 1 · Existing infrastructure reused (no duplicate engines)

`DurableJsonStore` (S33 per-store serialized atomic writes) for persistence · the KPI values from the existing analytics/executive-center feed and each product's own `safetyStock`/`currentStock` master fields (`inventorySafetyStockSeam`) · the tenant-ownership convention (caller-resolved scope, deny-by-default) · the existing notifications inbox (already per-tenant + already replaces a repeating condition's row = dedup) for delivery (via the FG wiring) · the existing `ExecutiveCenterSnapshot` channel for read (via the FG wiring). **No new analytics/notification/workflow/event/outbox/audit/transaction engine, no new inventory ledger.**

## 2 · Exact production files changed

Added (non-frozen, additive — no existing file edited):
- `apps/desktop/src/main/analyticsPlatform/kpiSnapshotModel.ts` — pure model + deterministic identity + state machine.
- `apps/desktop/src/main/analyticsPlatform/kpiSnapshotStore.ts` — tenant-owned immutable snapshot store + exception-state store + `captureAndEvaluate` engine.
- `apps/desktop/src/main/analyticsPlatform/inventorySafetyStockSeam.ts` — the inventory safety-stock use case.
- `apps/desktop/src/main/analyticsPlatform/session80KpiException.test.ts` — 10 focused tests.
- `apps/desktop/e2e/s80KpiExceptionJourney.e2e.cjs` — real-Electron journey (design-forward; runs after the FG wiring).

**Zero frozen surfaces touched. Zero existing files edited.**

## 3 · KPI snapshot architecture

`KpiSnapshot` = { deterministic `id`, authoritative `tenantId`/`workspaceId`, `kpiKey`, `label`, `value` (null = unavailable, honest), `band`, `calculatedAt`, `periodKey`, `dimensions`, `source`/`sourceVersion`, `recordedAt` provenance }. **Immutable**: `record()` is idempotent by deterministic `id` (`snapshotId(tenant,kpi,period,dims)`) — an existing snapshot is returned unchanged, never overwritten. Historical observations do not mutate.

## 4 · Exception state model

`NORMAL → WARNING → EXCEPTION → RECOVERED`, deterministic identity `exceptionId(tenant,kpi,condition)`. `nextExceptionState` folds a raw evaluation into durable state: an active condition returning to normal becomes `RECOVERED`; `transitionSeq` bumps **only on a transition**; **notify only on a transition into active or on RECOVERED** — never steady-state (no spam). **Fail-closed:** an unconfigured (`null`) threshold never fires; a `null` value is UNAVAILABLE, never a breach.

## 5 · Notification path

The engine emits `KpiNotificationIntent` only on transitions, each with a `dedupeKey = <exceptionId>#<transitionSeq>` (stable per transition, distinct across transitions). The FG wiring routes these to the **existing** notifications inbox (per-tenant, already deduped). No second pipeline.

## 6 · Idempotency design

Snapshots: deterministic id ⇒ re-capture is a no-op (proven). Exceptions: deterministic id ⇒ re-evaluation updates the single row, never duplicates; steady-state emits no notification; `dedupeKey` prevents duplicate delivery.

## 7 · Tenant / RBAC controls

`captureAndEvaluate` **refuses `NO_TENANT`** (deny-by-default) — an unresolved/renderer scope gets nothing. All reads filter by `tenantId`. Renderer never chooses a tenant/KPI/exception/recipient (scope is main-resolved). Proven: tenant-A cannot see tenant-B snapshots or exceptions; a tenant-B exception never appears in tenant-A intents.

## 8 · UI evidence

Executive Center visibility is the FG wiring's additive `kpiIntelligence` field on the existing snapshot (no parallel dashboard). **PENDING the FG token + Mac render.** No UI claimed GREEN.

## 9 · Real Electron evidence

`e2e/s80KpiExceptionJourney.e2e.cjs` written + committed (the FG verification-plan acceptance script). **PENDING** the FG wiring + a Mac run; **not claimed GREEN.**

## 10 · Test counts

`session80KpiException.test.ts` — **10/10 green** in the sandbox: snapshot creation, deterministic idempotency + historical immutability, tenant isolation, fail-closed no-tenant, exception creation, dedup/no-spam on a persistent condition, recovery transition, fail-closed undefined threshold, notification tenant isolation, dedupeKey stability. typecheck:node clean; eslint clean.

## 11 · Full regression

Full main suite + full UI suite + build **not runnable in this Linux sandbox** → PENDING the Mac. What ran here: the 10 focused tests (green), `typecheck:node` (exit 0, no S80-file errors), eslint (clean on all S80 files). No existing file was edited, so the blast radius on the existing suite is zero by construction; the Mac full-suite run is the confirmation.

## 12 · AI-readiness implications

This lays the S79 feedback foundation: an **immutable KPI snapshot series + exception history + (via FG) notification/recovery history** — the durable observation layer that forecasting / anomaly detection / AI recommendations / predictive alerts consume. **No ML, no autonomous AI** — S79's constitutional boundary (AI proposes; policy/approval governs; command spine executes; audit verifies) is unchanged.

## 13 · Policy dependencies

The inventory safety-stock condition uses each product's **own `safetyStock`** master field (defined data) with a configurable breach count (default 0 = any breach), **fail-closed** when unconfigured — no invented financial/accounting threshold. Other example conditions (procurement variance, receivables, production variance, downtime, budget variance) remain **fail-closed** until an operator supplies their thresholds (the S77/S78 policy blockers, unchanged).

## 14 · Remaining advanced-feature backlog

Unchanged from the S79 register: Tier-1 remainder (inventory aging + ATP; spend-analytics/supplier-risk registers) · Tier-2 (promote the workflow runtime; heuristic demand forecast; capacity enforcement; master-data dedup) · Tier-3 (widen certified AI capabilities) · Tier-4 (ML) · Tier-5 (autonomous — excluded).

## 15 · S80 final status

**S80 = PARTIAL — governed core IMPLEMENTED + UNIT-VERIFIED (10/10, typecheck+lint clean, zero frozen touched).** Remaining to full GREEN: (a) the **FG-S80 token** to apply the two frozen additive changes (`ExecutiveSnapshot` field + runtimeCore capture-service registration) + the non-frozen instance/subsystem wiring; (b) the **Mac validation** — full main suite, full UI suite, build, and the real-Electron journey. Architectural safety (§12): **no duplicate KPI/analytics/notification/workflow/event/outbox/audit engine, no renderer→store mutation, no AI→DB mutation, no renderer-supplied tenant** — verified (the core refuses NO_TENANT and touches no business/GL record).

**Release track PAUSED. STOP after S80** — do not begin S81. Next action is the operator's FG-S80 token (then the Mac validation run), or selecting the next Tier-1 item from the S79 register.
