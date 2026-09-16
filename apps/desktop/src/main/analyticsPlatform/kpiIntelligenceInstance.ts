/**
 * S80 live wiring — the KPI-intelligence COMPOSITION ROOT + its BackgroundService shell.
 *
 * The S80 core (kpiSnapshotModel / kpiSnapshotStore / inventorySafetyStockSeam) is Electron-free,
 * store-injectable and clock-injectable. This file owns the real I/O + identity so the core stays
 * test-drivable. It reuses:
 *   • DurableJsonStore (S33) for persistence — no new engine,
 *   • forEachTenantBackground (the proven per-tenant fan-out) for tenant-scoped capture,
 *   • serviceManager (its list is NON-FROZEN; startAll already runs) for the cadence — ZERO frozen
 *     runtimeCore lines (mirrors readBackReconcilerInstance's disposition),
 *   • the existing productModule store + each product's own safetyStock/currentStock master fields.
 *
 * Notification DELIVERY to the inbox is a non-frozen follow-up (the intents are produced + the active
 * exceptions are surfaced on the Executive Center snapshot); this gate touches exactly ONE frozen file
 * (the ExecutiveCenterSnapshot field), below the authorized envelope.
 */
import { app } from 'electron';
import { join } from 'node:path';
import type { KpiIntelligenceSnapshot } from '@neuropause/shared';
import { goodsReceiptFromRecord, productFromRecord, purchaseOrderFromRecord, supplierFromRecord } from '@neuropause/shared';
import { createLogger } from '../logger';
import type { BackgroundService } from '../services/serviceManager';
import { forEachTenantBackground, activeTenantScope } from '../enterprise/index';
import { productModule } from '../enterprise/modules/inventory/productModuleInstance';
// S82 — procurement KPI sources, read exactly the way productModule is read (tenant-scoped stores).
import {
  goodsReceiptModule,
  purchaseOrderModule,
  supplierModule,
} from '../enterprise/modules/procurement/procurementInstances';
import { DurableJsonStore } from '../platform/persistence/durableJsonStore';
import {
  KpiSnapshotStore, KpiExceptionStore, captureAndEvaluate, type KpiNotificationIntent,
} from './kpiSnapshotStore';
import type { KpiSnapshot, KpiExceptionState } from './kpiSnapshotModel';
import { belowSafetyStockObservation, safetyStockCondition, type ProductStockLike } from './inventorySafetyStockSeam';
import {
  highRiskSuppliersCondition,
  highRiskSuppliersObservation,
  openPoExposureCondition,
  openPoExposureObservation,
} from './procurementIntelligenceSeam';

const log = createLogger('kpi-intelligence');
const TICK_MS = 60_000; // matches the other background cadences

const dir = () => (typeof app !== 'undefined' && app?.getPath ? app.getPath('userData') : process.cwd());
const snapshots = new KpiSnapshotStore(new DurableJsonStore<KpiSnapshot>(join(dir(), 'kpi-snapshots.json')));
const exceptions = new KpiExceptionStore(new DurableJsonStore<KpiExceptionState>(join(dir(), 'kpi-exceptions.json')));

/** Load once so the sync Executive Center read can see persisted data after a restart. */
void Promise.all([snapshots.load(), exceptions.load()]).catch(() => undefined);

function periodKeyFor(nowMs: number): string {
  return new Date(nowMs).toISOString().slice(0, 10); // one snapshot per calendar day per (tenant,kpi)
}

/** Capture + evaluate the inventory safety-stock KPI for the CURRENT tenant scope. Fail-closed on no tenant. */
async function captureForScope(scope: { tenantId: string | null; workspaceId: string | null }): Promise<void> {
  const products: ProductStockLike[] = productModule.store
    .list()
    .filter((r) => r.status !== 'deleted')
    .map((r) => {
      const p = productFromRecord(r);
      return { sku: p.sku, currentStock: Number(p.currentStock ?? 0), safetyStock: Number(p.safetyStock ?? 0) };
    });
  // S82 — procurement observations from the SAME tenant-scoped stores, existing formulas only.
  const purchaseOrders = purchaseOrderModule.store.list().map(purchaseOrderFromRecord);
  const suppliers = supplierModule.store.list().map(supplierFromRecord);
  const goodsReceipts = goodsReceiptModule.store.list().map(goodsReceiptFromRecord);
  const result = await captureAndEvaluate({
    scope, now: () => new Date().toISOString(), periodKey: periodKeyFor(Date.now()),
    snapshots, exceptions,
    observations: [
      belowSafetyStockObservation(products),
      openPoExposureObservation(purchaseOrders),
      highRiskSuppliersObservation(suppliers, goodsReceipts),
    ],
    conditions: [
      safetyStockCondition(0), // "any product below its own safety stock" — no invented threshold
      highRiskSuppliersCondition(0), // "any supplier at the existing >=60 cutoff" — no invented threshold
      openPoExposureCondition(null), // no repo-defined exposure limit — UNCONFIGURED, fail-closed
    ],
  });
  if ('refused' in result) return; // NO_TENANT — deny-by-default, nothing produced
  for (const n of result.notifications) deliverIntent(n);
}

/**
 * Notification delivery hook. Deferred to a non-frozen follow-up (routing to the existing inbox);
 * for now the intent is logged and the active exception is surfaced on the executive snapshot.
 */
function deliverIntent(n: KpiNotificationIntent): void {
  log.info('KPI exception notification intent', { exceptionId: n.exceptionId, status: n.status, dedupeKey: n.dedupeKey });
}

/**
 * FG-S80b — governed ON-DEMAND capture for the ACTIVE tenant. This is the identity fix for the
 * F-P45 finding.
 *
 * WHY `activeTenantScope()` AND NOT `currentPrincipal()`: `currentPrincipal()` is the BACKGROUND
 * principal (AsyncLocalStorage), which is set only inside a `forEachTenantBackground` fan-out and is
 * NULL on the interactive IPC path — so an on-demand capture keyed on it refused every time (the
 * SEAM-B/S80-MAC observation). `activeTenantScope()` is the ONE resolver the enterprise:module.*
 * handlers already use: it PREFERS a background principal when one is in scope and falls back to the
 * session's active workspace otherwise, so it is correct on BOTH paths. It is resolved in main; a
 * renderer-supplied id is never consulted. The executive snapshot read below resolves the SAME way,
 * so what is written is what is read — writer key = reader key by construction.
 *
 * Deny-by-default: no resolvable tenant ⇒ refused, nothing captured. Idempotent + immutable
 * (reuses `captureForScope` → `captureAndEvaluate`; deterministic per-period snapshot id).
 */
export async function captureForActiveTenant(): Promise<{ ok: boolean; captured: boolean }> {
  const scope = activeTenantScope();
  if (!scope || !scope.tenantId) return { ok: false, captured: false };
  await captureForScope({ tenantId: scope.tenantId, workspaceId: scope.workspaceId ?? null });
  return { ok: true, captured: true };
}

/**
 * Read-model for the Executive Center, resolved for the ACTIVE tenant the SAME way the on-demand
 * capture writes (`activeTenantScope()`), so the read can never key on a different tenant than the
 * write. Null when no tenant resolves (never a fabricated 0).
 */
export function readKpiIntelligenceForActiveTenant(): KpiIntelligenceSnapshot | null {
  return readKpiIntelligence(activeTenantScope()?.tenantId ?? null);
}

/** Sync read-model for the Executive Center — latest snapshots + active exceptions for one tenant. */
export function readKpiIntelligence(tenantId: string | null): KpiIntelligenceSnapshot | null {
  if (!tenantId) return null; // unresolved scope ⇒ absent, never a fabricated 0
  const snaps = snapshots.latestForTenant(tenantId);
  const active = exceptions.activeForTenant(tenantId);
  return {
    capturedAt: new Date().toISOString(),
    snapshots: snaps.map((s) => ({ kpiKey: s.kpiKey, label: s.label, value: s.value, band: s.band, calculatedAt: s.calculatedAt, periodKey: s.periodKey })),
    activeExceptions: active.map((e) => ({
      kpiKey: e.kpiKey, conditionId: e.conditionId, status: e.status as 'WARNING' | 'EXCEPTION',
      observedValue: e.observedValue, threshold: e.threshold, lastTransitionAt: e.lastTransitionAt, message: e.message,
    })),
  };
}

class KpiIntelligenceCaptureService implements BackgroundService {
  readonly name = 'kpi-intelligence-capture';
  private timer: NodeJS.Timeout | null = null;

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => { void this.tick(); }, TICK_MS);
    this.timer.unref?.();
    log.info('KPI intelligence capture started', { intervalMs: TICK_MS });
  }
  stop(): void { if (this.timer) clearInterval(this.timer); this.timer = null; }

  /** One pass per operable tenant, each under that tenant's own principal (fan-out isolates failures). */
  async tick(): Promise<void> {
    await forEachTenantBackground('kpi-intelligence-capture', async (run) => {
      await captureForScope({ tenantId: run.scope.tenantId, workspaceId: run.scope.workspaceId });
    });
  }
}

export const kpiIntelligenceCapture = new KpiIntelligenceCaptureService();
