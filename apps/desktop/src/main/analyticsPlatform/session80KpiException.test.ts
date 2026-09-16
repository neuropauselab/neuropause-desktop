/**
 * S80 — Governed KPI Snapshot + Exception Intelligence: focused tests.
 * Covers §10: snapshot creation, deterministic idempotency, historical immutability, tenant
 * isolation, exception creation, dedup, no-spam on persistent condition, recovery transition,
 * notification emission + tenant isolation, fail-closed undefined threshold, and the inventory
 * safety-stock use case.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { DurableJsonStore } from '../platform/persistence/durableJsonStore';
import {
  KpiSnapshotStore, KpiExceptionStore, captureAndEvaluate,
  type KpiNotificationIntent,
} from './kpiSnapshotStore';
import { snapshotId, exceptionId, type KpiSnapshot, type KpiExceptionState } from './kpiSnapshotModel';
import { belowSafetyStockObservation, safetyStockCondition, INVENTORY_BELOW_SAFETY_KPI } from './inventorySafetyStockSeam';

const paths: string[] = [];
const tmp = () => { const p = join(tmpdir(), `np-s80-${randomUUID()}.json`); paths.push(p); return p; };
let snapStore: KpiSnapshotStore;
let excStore: KpiExceptionStore;
let clock = 0;
const now = () => new Date(Date.UTC(2026, 8, 3, 0, 0, clock++)).toISOString();

beforeEach(() => {
  clock = 0;
  snapStore = new KpiSnapshotStore(new DurableJsonStore<KpiSnapshot>(tmp()));
  excStore = new KpiExceptionStore(new DurableJsonStore<KpiExceptionState>(tmp()));
});
afterEach(async () => { for (const p of paths.splice(0)) await fs.rm(p, { force: true }).catch(() => undefined); });

const scopeA = { tenantId: 'tenant-A', workspaceId: 'ws-A' };
const scopeB = { tenantId: 'tenant-B', workspaceId: 'ws-B' };
const run = (scope: typeof scopeA, products: { sku: string; currentStock: number; safetyStock: number }[], breach: number | null = 0) =>
  captureAndEvaluate({
    scope, now, periodKey: '2026-09-03', snapshots: snapStore, exceptions: excStore,
    observations: [belowSafetyStockObservation(products)],
    conditions: [safetyStockCondition(breach)],
  });

describe('S80 · KPI snapshot store', () => {
  it('records a snapshot with deterministic id + provenance', async () => {
    const r = await run(scopeA, [{ sku: 'A', currentStock: 10, safetyStock: 5 }]);
    if ('refused' in r) throw new Error('unexpected refusal');
    expect(r.recorded).toHaveLength(1);
    expect(r.recorded[0].id).toBe(snapshotId('tenant-A', INVENTORY_BELOW_SAFETY_KPI, '2026-09-03'));
    expect(r.recorded[0]).toMatchObject({ tenantId: 'tenant-A', kpiKey: INVENTORY_BELOW_SAFETY_KPI, value: 0, source: 'inventory-safety-stock-seam' });
  });

  it('is idempotent + immutable — same (tenant,kpi,period) never overwrites the historical value', async () => {
    await run(scopeA, [{ sku: 'A', currentStock: 1, safetyStock: 5 }]); // value = 1 (breaching)
    const first = snapStore.listForTenant('tenant-A')[0];
    // a second capture in the SAME period with a DIFFERENT computed value must NOT overwrite
    const r2 = await run(scopeA, [{ sku: 'A', currentStock: 9, safetyStock: 5 }]); // would be value 0
    if ('refused' in r2) throw new Error('refused');
    // the returned snapshot is the ORIGINAL (id-identical), and no second row was created
    expect(r2.recorded[0].id).toBe(first.id);
    expect(snapStore.listForTenant('tenant-A')).toHaveLength(1);
    expect(snapStore.listForTenant('tenant-A')[0].value).toBe(first.value); // unchanged historical observation
  });

  it('tenant isolation — tenant-A cannot see tenant-B snapshots', async () => {
    await run(scopeA, [{ sku: 'A', currentStock: 1, safetyStock: 5 }]);
    await run(scopeB, [{ sku: 'B', currentStock: 1, safetyStock: 5 }]);
    expect(snapStore.listForTenant('tenant-A')).toHaveLength(1);
    expect(snapStore.listForTenant('tenant-A').every((s) => s.tenantId === 'tenant-A')).toBe(true);
    expect(snapStore.listForTenant('tenant-B').every((s) => s.tenantId === 'tenant-B')).toBe(true);
  });

  it('FAIL-CLOSED: an unresolved tenant is refused — no snapshot, no exception', async () => {
    const r = await run({ tenantId: null, workspaceId: null }, [{ sku: 'A', currentStock: 1, safetyStock: 5 }]);
    expect('refused' in r && r.refused).toBe('NO_TENANT');
    expect(snapStore.listForTenant('tenant-A')).toHaveLength(0);
  });
});

describe('S80 · exception engine', () => {
  it('creates an EXCEPTION when a product is below safety stock, with deterministic identity + notification', async () => {
    const r = await run(scopeA, [{ sku: 'A', currentStock: 2, safetyStock: 5 }]); // 1 breaching > 0
    if ('refused' in r) throw new Error('refused');
    expect(r.transitions).toHaveLength(1);
    expect(r.transitions[0]).toMatchObject({ id: exceptionId('tenant-A', INVENTORY_BELOW_SAFETY_KPI, 'inventory.belowSafetyStock.any'), status: 'EXCEPTION' });
    expect(r.notifications).toHaveLength(1);
    expect(r.notifications[0].status).toBe('EXCEPTION');
    expect(excStore.activeForTenant('tenant-A')).toHaveLength(1);
  });

  it('DEDUP / no-spam — a persistent exception across evaluations emits only ONE notification', async () => {
    const products = [{ sku: 'A', currentStock: 2, safetyStock: 5 }];
    const r1 = await run(scopeA, products); if ('refused' in r1) throw new Error('r');
    // new period so the snapshot is a fresh row, but the SAME exception condition persists
    const r2 = await captureAndEvaluate({ scope: scopeA, now, periodKey: '2026-09-04', snapshots: snapStore, exceptions: excStore, observations: [belowSafetyStockObservation(products)], conditions: [safetyStockCondition(0)] });
    if ('refused' in r2) throw new Error('r');
    expect(r1.notifications).toHaveLength(1); // fired on first transition
    expect(r2.notifications).toHaveLength(0); // steady-state: NO second notification
    expect(r2.transitions).toHaveLength(0);   // no state transition
  });

  it('RECOVERY — an active exception returning to normal transitions to RECOVERED and notifies once', async () => {
    const r1 = await run(scopeA, [{ sku: 'A', currentStock: 2, safetyStock: 5 }]); if ('refused' in r1) throw new Error('r'); // EXCEPTION
    const r2 = await captureAndEvaluate({ scope: scopeA, now, periodKey: '2026-09-05', snapshots: snapStore, exceptions: excStore, observations: [belowSafetyStockObservation([{ sku: 'A', currentStock: 9, safetyStock: 5 }])], conditions: [safetyStockCondition(0)] });
    if ('refused' in r2) throw new Error('r');
    expect(r2.transitions[0].status).toBe('RECOVERED');
    expect(r2.notifications).toHaveLength(1);
    expect(r2.notifications[0].status).toBe('RECOVERED');
    expect(excStore.activeForTenant('tenant-A')).toHaveLength(0); // recovered ⇒ no longer active
  });

  it('FAIL-CLOSED: an unconfigured (null) threshold never fires an exception', async () => {
    const r = await run(scopeA, [{ sku: 'A', currentStock: 0, safetyStock: 5 }], null); // clearly breaching, but threshold null
    if ('refused' in r) throw new Error('refused');
    expect(r.transitions).toHaveLength(0);
    expect(r.notifications).toHaveLength(0);
    expect(excStore.activeForTenant('tenant-A')).toHaveLength(0);
  });

  it('notification tenant isolation — a tenant-B exception never appears in tenant-A intents/state', async () => {
    const rA = await run(scopeA, [{ sku: 'A', currentStock: 9, safetyStock: 5 }]); // NORMAL for A
    const rB = await run(scopeB, [{ sku: 'B', currentStock: 1, safetyStock: 5 }]); // EXCEPTION for B
    if ('refused' in rA || 'refused' in rB) throw new Error('r');
    expect(rA.notifications).toHaveLength(0);
    expect(rB.notifications.every((n: KpiNotificationIntent) => n.tenantId === 'tenant-B')).toBe(true);
    expect(excStore.activeForTenant('tenant-A')).toHaveLength(0);
    expect(excStore.activeForTenant('tenant-B')).toHaveLength(1);
  });

  it('dedupeKey is stable per transition and distinct across transitions (no duplicate delivery)', async () => {
    const r1 = await run(scopeA, [{ sku: 'A', currentStock: 2, safetyStock: 5 }]); if ('refused' in r1) throw new Error('r');
    const r2 = await captureAndEvaluate({ scope: scopeA, now, periodKey: '2026-09-06', snapshots: snapStore, exceptions: excStore, observations: [belowSafetyStockObservation([{ sku: 'A', currentStock: 9, safetyStock: 5 }])], conditions: [safetyStockCondition(0)] });
    if ('refused' in r2) throw new Error('r');
    expect(r1.notifications[0].dedupeKey).toMatch(/#1$/); // first transition seq
    expect(r2.notifications[0].dedupeKey).toMatch(/#2$/); // recovery transition seq
    expect(r1.notifications[0].dedupeKey).not.toBe(r2.notifications[0].dedupeKey);
  });
});
