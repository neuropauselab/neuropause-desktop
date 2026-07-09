import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  IpcChannel,
  calculateDeliveryRisk,
  calculateFulfillment,
  calculateOrderStatus,
  calculateRevenueRecognition,
  calculateShipmentProgress,
  deriveOrderInsights,
  identifyDelayedOrders,
  orderActionPatch,
  orderInsightsToKpis,
  validateModuleDescriptor,
  type AiEngineRequest,
  type AiEngineResponse,
  type EnterprisePermission,
  type EnterpriseEntity,
  type EnterpriseRecordSummary,
  type PlatformEventInput,
  type SalesOrder,
} from '@neuropause/shared';
import type { SecureHandlerDef } from '../../../ipc/secureBridge';
import { EnterpriseModuleRegistry, buildModuleHandlers } from '../../framework';
import { ORDER_DESCRIPTOR, createOrderModule, type OrderAiRunner } from './orderModule';
import { runOrderAi } from './orderAi';

const T0 = '2026-07-08T00:00:00.000Z';
const NOW = Date.parse('2026-07-08');
const DAY = 86400000;
const day = (offset: number): string => new Date(NOW + offset * DAY).toISOString().slice(0, 10);

function order(partial: Partial<SalesOrder> = {}): SalesOrder {
  return {
    id: 'o1',
    orderNumber: 'SO-0001',
    sourceQuote: '',
    customer: 'Acme Inc.',
    contact: '',
    status: 'pending',
    currency: 'USD',
    total: 10000,
    orderedQty: 0,
    fulfilledQty: 0,
    orderDate: '',
    expectedDeliveryDate: '',
    shippedDate: '',
    deliveredDate: '',
    carrier: '',
    trackingNumber: '',
    salesRep: '',
    createdAt: T0,
    updatedAt: T0,
    ...partial,
  };
}

/* ── deterministic business logic (AI never sets these) ── */

describe('descriptor', () => {
  it('is consistent, uses sales scopes, computes read-only fields, exposes lifecycle actions', () => {
    expect(validateModuleDescriptor(ORDER_DESCRIPTOR)).toEqual([]);
    expect(ORDER_DESCRIPTOR.permissions).toEqual({ read: 'sales:read', write: 'sales:manage' });
    for (const key of ['fulfillmentPct', 'shipmentProgress', 'recognizedRevenue']) {
      expect(ORDER_DESCRIPTOR.fields.find((f) => f.key === key)?.readOnly).toBe(true);
    }
    expect(ORDER_DESCRIPTOR.actions?.map((a) => a.key)).toEqual([
      'reserveStock',
      'ship',
      'fulfill',
      'close',
      'cancel',
      'convertToInvoice',
    ]);
  });
});

describe('calculateFulfillment', () => {
  it('uses status then quantities', () => {
    expect(calculateFulfillment(order({ status: 'fulfilled' }))).toBe(100);
    expect(calculateFulfillment(order({ status: 'closed' }))).toBe(100);
    expect(calculateFulfillment(order({ status: 'cancelled' }))).toBe(0);
    expect(calculateFulfillment(order({ status: 'pending', orderedQty: 10, fulfilledQty: 4 }))).toBe(40);
    expect(calculateFulfillment(order({ status: 'shipped' }))).toBe(50);
    expect(calculateFulfillment(order({ status: 'pending' }))).toBe(0);
  });
});

describe('calculateShipmentProgress', () => {
  it('tracks the lifecycle', () => {
    expect(calculateShipmentProgress(order({ status: 'pending' }))).toBe(0);
    expect(calculateShipmentProgress(order({ status: 'shipped' }))).toBe(60);
    expect(calculateShipmentProgress(order({ status: 'fulfilled' }))).toBe(100);
    expect(calculateShipmentProgress(order({ status: 'cancelled' }))).toBe(0);
  });
});

describe('calculateRevenueRecognition', () => {
  it('recognizes proportionally to fulfillment', () => {
    expect(calculateRevenueRecognition(order({ status: 'fulfilled', total: 10000 }))).toEqual({
      recognized: 10000,
      pending: 0,
    });
    expect(calculateRevenueRecognition(order({ status: 'shipped', total: 10000 }))).toEqual({
      recognized: 5000,
      pending: 5000,
    });
    expect(calculateRevenueRecognition(order({ status: 'cancelled', total: 10000 }))).toEqual({
      recognized: 0,
      pending: 0,
    });
  });
});

describe('calculateDeliveryRisk (deterministic)', () => {
  it('is zero for terminal states', () => {
    expect(calculateDeliveryRisk(order({ status: 'fulfilled' }), NOW)).toBe(0);
    expect(calculateDeliveryRisk(order({ status: 'cancelled' }), NOW)).toBe(0);
  });
  it('rises with deadline pressure and overdue days', () => {
    expect(calculateDeliveryRisk(order({ status: 'pending' }), NOW)).toBe(15); // no date + pending
    expect(calculateDeliveryRisk(order({ status: 'shipped', expectedDeliveryDate: day(5) }), NOW)).toBe(
      20,
    );
    expect(calculateDeliveryRisk(order({ status: 'shipped', expectedDeliveryDate: day(2) }), NOW)).toBe(
      40,
    );
    expect(calculateDeliveryRisk(order({ status: 'pending', expectedDeliveryDate: day(-10) }), NOW)).toBe(
      100,
    );
  });
});

describe('calculateOrderStatus + identifyDelayedOrders', () => {
  it('maps stage, flags delay, assigns health', () => {
    expect(calculateOrderStatus(order({ status: 'fulfilled' }), NOW)).toMatchObject({
      stage: 'delivered',
      health: 'low',
    });
    const delayed = calculateOrderStatus(order({ status: 'shipped', expectedDeliveryDate: day(-2) }), NOW);
    expect(delayed).toMatchObject({ stage: 'in_transit', delayed: true, health: 'high' });
    expect(calculateOrderStatus(order({ status: 'pending' }), NOW)).toMatchObject({
      stage: 'open',
      health: 'medium',
    });
  });
  it('identifyDelayedOrders returns only open, past-due orders', () => {
    const rows = [
      order({ id: 'a', status: 'shipped', expectedDeliveryDate: day(-3) }),
      order({ id: 'b', status: 'shipped', expectedDeliveryDate: day(3) }),
      order({ id: 'c', status: 'fulfilled', expectedDeliveryDate: day(-3) }),
    ];
    expect(identifyDelayedOrders(rows, NOW).map((o) => o.id)).toEqual(['a']);
  });
});

describe('orderActionPatch (deterministic transitions)', () => {
  it('advances through legal transitions and stamps dates', () => {
    expect(orderActionPatch('ship', order({ status: 'pending' }), T0)).toMatchObject({
      status: 'shipped',
      shippedDate: '2026-07-08',
    });
    expect(
      orderActionPatch('fulfill', order({ status: 'shipped', orderedQty: 10 }), T0),
    ).toMatchObject({ status: 'fulfilled', deliveredDate: '2026-07-08', fulfilledQty: 10 });
    expect(orderActionPatch('close', order({ status: 'fulfilled' }), T0)).toMatchObject({
      status: 'closed',
    });
    expect(orderActionPatch('cancel', order({ status: 'pending' }), T0)).toMatchObject({
      status: 'cancelled',
    });
  });
  it('rejects illegal transitions', () => {
    expect(orderActionPatch('ship', order({ status: 'shipped' }), T0)).toBeNull();
    expect(orderActionPatch('fulfill', order({ status: 'pending' }), T0)).toBeNull();
    expect(orderActionPatch('close', order({ status: 'pending' }), T0)).toBeNull();
    expect(orderActionPatch('cancel', order({ status: 'closed' }), T0)).toBeNull();
  });
});

describe('deriveOrderInsights + KPIs', () => {
  it('aggregates fulfillment and emits the KPI tiles', () => {
    const rows = [
      order({ id: 'a', status: 'pending', total: 10000 }),
      order({ id: 'b', status: 'shipped', total: 20000 }),
      order({ id: 'c', status: 'fulfilled', total: 30000, orderDate: day(-10), deliveredDate: day(-2) }),
      order({ id: 'd', status: 'cancelled', total: 5000 }),
    ];
    const insights = deriveOrderInsights(rows, NOW);
    expect(insights).toMatchObject({
      totalOrders: 4,
      ordersOpen: 2, // pending + shipped
      ordersDelivered: 1, // fulfilled
      ordersDelayed: 0,
      revenuePending: 20000, // 10000 (pending) + 10000 (shipped 50%)
      fulfillmentRate: 38, // (0 + 50 + 100 + 0)/4 = 37.5
      averageDeliveryDays: 8,
    });
    const kpis = orderInsightsToKpis(insights);
    expect(kpis.map((k) => k.key)).toEqual([
      'order-open',
      'order-delivered',
      'order-delayed',
      'order-revenue-pending',
      'order-fulfillment',
      'order-delivery-time',
    ]);
  });
});

/* ── the module + lifecycle actions through the framework's generic handlers ── */

interface Recorded {
  publish: PlatformEventInput[];
  audit: { action: string }[];
  broadcast: { channel: string }[];
  authorized: EnterprisePermission[];
}

const paths: string[] = [];
let rec: Recorded;
let aiNarrative: Awaited<ReturnType<OrderAiRunner>>;
let registry: EnterpriseModuleRegistry;
let handlers: SecureHandlerDef[];
let orders: ReturnType<typeof createOrderModule>;

function spyCtx() {
  return {
    authorize: (p: EnterprisePermission) => rec.authorized.push(p),
    audit: (e: { action: string; target: string; summary: string }) => rec.audit.push(e),
    publish: (i: PlatformEventInput) => rec.publish.push(i),
    broadcast: (channel: string) => rec.broadcast.push({ channel }),
    notify: () => undefined,
    actor: () => 'tester@np.dev',
    now: () => T0,
  };
}

function tmp(tag: string): string {
  const p = join(tmpdir(), `np-${tag}-${randomUUID()}.json`);
  paths.push(p);
  return p;
}

beforeEach(() => {
  rec = { publish: [], audit: [], broadcast: [], authorized: [] };
  aiNarrative = null;
  orders = createOrderModule(tmp('order'), async () => aiNarrative);
  registry = new EnterpriseModuleRegistry();
  registry.register(orders);
  handlers = buildModuleHandlers(registry, spyCtx());
});

afterEach(async () => {
  for (const p of paths.splice(0)) await fs.rm(p, { force: true }).catch(() => undefined);
});

function handler(channel: string): (p: unknown) => unknown | Promise<unknown> {
  const def = handlers.find((d) => d.channel === channel);
  if (!def) throw new Error(`no handler for ${channel}`);
  return def.handler;
}

async function createOrder(fields: Record<string, unknown>) {
  return (await handler(IpcChannel.EnterpriseModuleCreate)({
    moduleId: 'sales-orders',
    fields,
  })) as { ok: boolean; record?: EnterpriseEntity; errors?: Record<string, string> };
}

function act(id: string, action: string) {
  return handler(IpcChannel.EnterpriseModuleAction)({
    moduleId: 'sales-orders',
    id,
    action,
  }) as Promise<{ ok: boolean; message?: string; error?: string }>;
}

describe('CRUD + computed stamps', () => {
  it('stamps fulfillmentPct, shipmentProgress, recognizedRevenue and applies defaults', async () => {
    const res = await createOrder({
      orderNumber: 'SO-1',
      customer: 'Acme Inc.',
      total: 10000,
      orderedQty: 10,
      fulfilledQty: 5,
    });
    expect(res.ok).toBe(true);
    expect(res.record?.fields).toMatchObject({
      status: 'pending',
      currency: 'USD',
      fulfillmentPct: 50,
      shipmentProgress: 0,
      recognizedRevenue: 5000,
    });
  });

  it('requires an order number and a customer', async () => {
    expect((await createOrder({ customer: 'Acme' })).ok).toBe(false);
    expect((await createOrder({ orderNumber: 'SO-9' })).ok).toBe(false);
  });
});

describe('RBAC', () => {
  it('reads authorize sales:read, writes sales:manage', async () => {
    await createOrder({ orderNumber: 'SO-1', customer: 'Acme' });
    expect(rec.authorized).toContain('sales:manage');
    rec.authorized.length = 0;
    await handler(IpcChannel.EnterpriseModuleList)({ moduleId: 'sales-orders' });
    expect(rec.authorized).toEqual(['sales:read']);
  });
});

describe('lifecycle actions (real state changes)', () => {
  it('ships → fulfills → closes, stamping dates and recomputing metrics + timeline', async () => {
    const created = await createOrder({
      orderNumber: 'SO-1',
      customer: 'Acme',
      total: 10000,
      orderedQty: 10,
    });
    const id = created.record?.id as string;

    expect((await act(id, 'ship')).ok).toBe(true);
    let rec1 = orders.store.get(id);
    expect(rec1?.fields).toMatchObject({ status: 'shipped', shippedDate: '2026-07-08', shipmentProgress: 60 });
    expect(rec.publish.at(-1)).toMatchObject({
      type: 'enterprise.record.updated',
      source: 'enterprise:sales-orders',
    });

    expect((await act(id, 'fulfill')).ok).toBe(true);
    rec1 = orders.store.get(id);
    expect(rec1?.fields).toMatchObject({
      status: 'fulfilled',
      deliveredDate: '2026-07-08',
      fulfilledQty: 10,
      fulfillmentPct: 100,
      recognizedRevenue: 10000,
    });

    expect((await act(id, 'close')).ok).toBe(true);
    expect(orders.store.get(id)?.fields.status).toBe('closed');
  });

  it('rejects illegal transitions with a deterministic message', async () => {
    const created = await createOrder({ orderNumber: 'SO-1', customer: 'Acme' });
    const id = created.record?.id as string;
    const res = await act(id, 'close'); // pending → close is illegal
    expect(res.ok).toBe(false);
    expect(res.message).toMatch(/cannot close an order that is pending/i);
    expect(orders.store.get(id)?.fields.status).toBe('pending'); // unchanged
  });

  it('cancels an open order but not a closed one', async () => {
    const created = await createOrder({ orderNumber: 'SO-1', customer: 'Acme' });
    const id = created.record?.id as string;
    expect((await act(id, 'cancel')).ok).toBe(true);
    expect(orders.store.get(id)?.fields.status).toBe('cancelled');

    const other = await createOrder({ orderNumber: 'SO-2', customer: 'Acme' });
    const id2 = other.record?.id as string;
    await act(id2, 'cancel');
    const res = await act(id2, 'cancel'); // cancelled → cancel illegal
    expect(res.ok).toBe(false);
  });

  it('rejects an unknown action', async () => {
    const created = await createOrder({ orderNumber: 'SO-1', customer: 'Acme' });
    const res = await act(created.record?.id as string, 'nope');
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/unknown action/i);
  });
});

describe('timeline events', () => {
  it('emits created / updated / status_changed / deleted', async () => {
    const created = await createOrder({ orderNumber: 'SO-1', customer: 'Acme' });
    const id = created.record?.id as string;
    expect(rec.publish.at(-1)?.type).toBe('enterprise.record.created');

    await handler(IpcChannel.EnterpriseModuleUpdate)({
      moduleId: 'sales-orders',
      id,
      fields: { carrier: 'FedEx' },
    });
    expect(rec.publish.at(-1)?.type).toBe('enterprise.record.updated');

    await handler(IpcChannel.EnterpriseModuleSetStatus)({
      moduleId: 'sales-orders',
      id,
      status: 'archived',
    });
    expect(rec.publish.at(-1)?.type).toBe('enterprise.record.status_changed');

    await handler(IpcChannel.EnterpriseModuleDelete)({ moduleId: 'sales-orders', id });
    expect(rec.publish.at(-1)?.type).toBe('enterprise.record.deleted');
  });
});

describe('AI summary', () => {
  it('exposes aiSummary=true and the lifecycle actions', async () => {
    const summaries = (await handler(IpcChannel.EnterpriseModulesList)({})) as Array<{
      id: string;
      aiSummary: boolean;
      actions: { key: string }[];
    }>;
    const o = summaries.find((s) => s.id === 'sales-orders');
    expect(o).toMatchObject({ aiSummary: true });
    expect(o?.actions.map((a) => a.key)).toEqual([
      'reserveStock',
      'ship',
      'fulfill',
      'close',
      'cancel',
      'convertToInvoice',
    ]);
  });

  it('falls back to a deterministic summary; health stays deterministic', async () => {
    aiNarrative = null;
    const created = await createOrder({
      orderNumber: 'SO-1',
      customer: 'Acme',
      total: 10000,
      status: 'pending',
      expectedDeliveryDate: day(-10),
    });
    const id = created.record?.id as string;
    const summary = (await handler(IpcChannel.EnterpriseModuleSummarize)({
      moduleId: 'sales-orders',
      id,
    })) as EnterpriseRecordSummary;
    expect(summary.grounded).toBe(false);
    expect(summary.risk).toBe('high'); // overdue open order → high
    expect(summary.summary).toMatch(/fulfilled/i);
  });

  it('uses the AI narrative when grounded; health stays deterministic', async () => {
    aiNarrative = { summary: 'AI order', executiveExplanation: 'AI exec', grounded: true, model: 'm' };
    const created = await createOrder({ orderNumber: 'SO-1', customer: 'Acme', status: 'fulfilled' });
    const id = created.record?.id as string;
    const summary = (await handler(IpcChannel.EnterpriseModuleSummarize)({
      moduleId: 'sales-orders',
      id,
    })) as EnterpriseRecordSummary;
    expect(summary.summary).toBe('AI order');
    expect(summary.grounded).toBe(true);
    expect(summary.risk).toBe('low'); // delivered → low
  });
});

describe('runOrderAi', () => {
  const o = order();
  const signals = {
    assessment: { stage: 'open' as const, delayed: false, health: 'low' as const, reason: 'ok' },
    fulfillment: 0,
    shipmentProgress: 0,
    revenue: { recognized: 0, pending: 10000 },
    deliveryRisk: 15,
  };
  it('returns the narrative from a grounded response', async () => {
    const engine = {
      run: async (_r: AiEngineRequest): Promise<AiEngineResponse> =>
        ({
          text: '',
          data: { summary: 'hi', executiveExplanation: 'e' },
          grounded: true,
          model: 'm',
        }) as unknown as AiEngineResponse,
    };
    expect(await runOrderAi(engine, o, signals)).toMatchObject({ summary: 'hi', grounded: true });
  });
  it('returns null when ungrounded', async () => {
    const engine = {
      run: async (): Promise<AiEngineResponse> =>
        ({ text: '', data: null, grounded: false, model: 'none' }) as unknown as AiEngineResponse,
    };
    expect(await runOrderAi(engine, o, signals)).toBeNull();
  });
});
