# FG GATE — S80 KPI/Exception live wiring (frozen surfaces) — PRESENTED, NOT APPLIED

**Status:** awaiting operator FG token(s). The S80 governed core is implemented + unit-verified on **non-frozen** surfaces (`analyticsPlatform/kpiSnapshotModel.ts`, `kpiSnapshotStore.ts`, `inventorySafetyStockSeam.ts`). **Making it LIVE requires touching frozen surfaces**, which per the constitution needs the FG protocol (verbatim diff → threat analysis → read-only confirmations → literal token → change-control choreography). This document presents the gate; nothing here is applied.

## Why a gate is required (measured)

Every live surfacing point is a frozen surface:
1. **`packages/shared/src/types/enterprise.ts`** (FROZEN) — the `ExecutiveSnapshot` type. Surfacing persisted KPI snapshots + active exceptions to the typed Executive Center UI needs an **additive optional field** (e.g. `kpiIntelligence?: { snapshots; exceptions }`).
2. **`apps/desktop/src/main/runtimeCore.ts`** (FROZEN) — boot composition. Registering the capture background service + constructing the tenant-owned stores needs **≤2 additive lines** (import + `serviceManager.register(...)` / instance import), mirroring the `readBackReconcilerInstance` precedent (`runtimeCore.ts:4125` `serviceManager.startAll` already runs).
3. **`channels.ts` / `contracts.ts`** (FROZEN) — only if a **dedicated** read channel is preferred over extending `ExecutiveCenterSnapshot`. Recommendation: **do NOT add a channel** — extend the already-registered `ExecutiveCenterSnapshot` composition in NON-frozen `enterprise/executiveCenterSubsystem.ts` / `executiveCenter.ts`, so only surfaces (1) and (2) are frozen.

## Proposed additive diffs (verbatim, for the gate)

- **(1) `ExecutiveSnapshot`** — one additive optional field: `kpiIntelligence?: KpiIntelligenceSnapshot | null;` + the `KpiIntelligenceSnapshot` interface (snapshots[], activeExceptions[]) in shared. Additive-optional ⇒ no existing consumer breaks.
- **(2) `runtimeCore.ts`** — `import { initKpiIntelligence } from './analyticsPlatform/kpiIntelligenceInstance';` + `const kpiIntel = initKpiIntelligence({ productStore, tenantScope, eventPublish });` and pass `kpiIntel.snapshot` into the executive-center composition; register its capture as a background service (reuses `serviceManager`, `notifications`, `eventBus`).
- **Non-frozen accompaniment:** `kpiIntelligenceInstance.ts` (constructs the two `DurableJsonStore`s + wires `captureAndEvaluate` to the real product store + routes `KpiNotificationIntent`s to the existing notifications inbox); `executiveCenterSubsystem.ts` composition adds `kpiIntelligence` to the snapshot it already returns through the live channel.

## Threat analysis (both directions)

- **Additive-optional field** cannot break existing renderers (they ignore unknown/undefined). Reads are tenant-scoped (`captureAndEvaluate` refuses `NO_TENANT`), so no cross-tenant leak. The capture service performs **read-only** KPI observation + **append-only immutable** snapshots + exception-state upserts; it mutates no business/financial record and posts no GL. Notifications route through the existing inbox (already per-tenant, already deduped) — no second pipeline.
- **Backout:** the field is optional and the service is additive; removing the two runtimeCore lines + the field reverts cleanly.

## Verification plan (on the Mac, after the token)

Full main suite + full UI suite + typecheck:release + lint:release + build, then the real-Electron journey `e2e/s80KpiExceptionJourney.e2e.cjs` (KPI condition → snapshot → exception → notification → Executive Center visibility → recovery) on a fresh profile.

## What is already done WITHOUT this gate

The entire governed **core** (model + stores + engine + inventory seam) plus **10 focused tests** (idempotency, immutability, tenant isolation, dedup/no-spam, recovery, notification isolation, fail-closed threshold) — all green, typecheck:node clean, eslint clean, zero frozen surfaces touched.

**⛔ Awaiting the operator's FG token to apply (1) + (2). Until then S80 ships the non-frozen governed core only.**
