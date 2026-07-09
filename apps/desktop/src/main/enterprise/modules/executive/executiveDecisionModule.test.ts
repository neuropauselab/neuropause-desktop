import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  IpcChannel,
  decisionRecordFieldsFromPlan,
  executiveDecisionFromRecord,
  type BillOfMaterials,
  type BomComponent,
  type EnterpriseEntity,
  type EnterprisePermission,
  type Machine,
  type PlanningInput,
  type PlatformEventInput,
  type Product,
  type RecoveryPlan,
  type Routing,
  type SalesOrder,
  type Supplier,
} from '@neuropause/shared';
import type { SecureHandlerDef } from '../../../ipc/secureBridge';
import { EnterpriseModuleRegistry, buildModuleHandlers } from '../../framework';
import { createExecutiveDecisionModule } from './executiveDecisionModule';

const T0 = '2026-07-08T00:00:00.000Z';

function product(p: Partial<Product> = {}): Product {
  return { id: `p-${p.sku ?? 'X'}`, sku: 'FG-1', barcode: '', name: 'Widget', category: '', unit: 'unit', purchaseCost: 4, standardCost: 5, sellingPrice: 10, reorderLevel: 10, safetyStock: 5, maximumStock: 200, currentStock: 0, reservedStock: 0, availableStock: 0, status: 'active', ...p };
}
function order(p: Partial<SalesOrder> = {}): SalesOrder {
  return { id: 'o1', orderNumber: 'SO-1', sourceQuote: '', customer: 'Acme', contact: '', status: 'pending', currency: 'USD', total: 1000, orderedQty: 10, fulfilledQty: 0, product: 'FG-1', warehouse: 'WH-1', orderDate: '', expectedDeliveryDate: '2026-08-01', shippedDate: '', deliveredDate: '', carrier: '', trackingNumber: '', salesRep: '', createdAt: T0, updatedAt: T0, ...p };
}
function comp(sku: string, quantity: number): BomComponent {
  return { sku, quantity, waste: 0, alternative: '' };
}
function bom(productSku: string, components: BomComponent[]): BillOfMaterials {
  return { id: `b-${productSku}`, bomNumber: `BOM-${productSku}`, product: productSku, outputQuantity: 1, yield: 100, waste: 0, revision: 'A', components, status: 'active', notes: '' };
}
function supplier(p: Partial<Supplier> = {}): Supplier {
  return { id: 's1', name: 'SupplierCo', gst: '', pan: '', contactPerson: '', email: '', phone: '', bankDetails: '', paymentTerms: 'net30', leadTime: 10, vendorRating: 4, status: 'active', ...p };
}
function machine(p: Partial<Machine> = {}): Machine {
  return { id: `mc-${p.name ?? 'M'}`, name: 'CNC-1', code: 'MC-1', workCenter: 'WC-1', runtime: 50, downtime: 50, maintenanceDue: '', status: 'running', ...p };
}
const MODEL: { input: PlanningInput; routings: Routing[] } = {
  input: {
    products: [product({ sku: 'FG-1' }), product({ sku: 'RAW-1', name: 'Raw' })],
    salesOrders: [order({ product: 'FG-1', orderedQty: 10, total: 1000, customer: 'Acme' })],
    quotes: [], shipments: [], productionOrders: [], purchaseOrders: [],
    suppliers: [supplier({ leadTime: 10 })],
    boms: [bom('FG-1', [comp('RAW-1', 2)])],
    machines: [machine({ name: 'CNC-1', status: 'running' })],
    invoices: [],
  },
  routings: [],
};
function plan(): RecoveryPlan {
  return {
    id: 'decision:machine_failure_recovery', decisionType: 'machine_failure_recovery', title: 'Machine Failure Recovery — CNC-1',
    businessImpact: 'CNC-1 failure delays orders.', evidence: ['maxDelay=5d'], affectedOrders: ['FG-1'], affectedMachines: ['CNC-1'],
    affectedCustomers: ['Acme'], affectedRevenue: 1000,
    recoverySteps: [{ action: 'use_alternate_machine', description: 'Move to an idle machine.', evidence: ['x'] }],
    expectedImprovementPct: 80, confidence: 0.9, estimatedRecoveryDays: 1, priority: 'high', tradeoffs: ['alternate may be slower'], status: 'pending', score: 785,
  };
}

interface Recorded {
  publish: PlatformEventInput[];
  audit: { action: string }[];
  broadcast: { channel: string }[];
  authorized: EnterprisePermission[];
}

const paths: string[] = [];
let rec: Recorded;
let registry: EnterpriseModuleRegistry;
let handlers: SecureHandlerDef[];
let decisions: ReturnType<typeof createExecutiveDecisionModule>;

function spyCtx() {
  return {
    authorize: (p: EnterprisePermission) => rec.authorized.push(p),
    audit: (e: { action: string; target: string; summary: string }) => rec.audit.push(e),
    publish: (i: PlatformEventInput) => rec.publish.push(i),
    broadcast: (channel: string) => rec.broadcast.push({ channel }),
    notify: () => undefined,
    actor: () => 'ceo@np.dev',
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
  registry = new EnterpriseModuleRegistry();
  decisions = createExecutiveDecisionModule(tmp('dec'), () => MODEL);
  registry.register(decisions);
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
async function createDecision() {
  return (await handler(IpcChannel.EnterpriseModuleCreate)({ moduleId: 'executive-decisions', fields: decisionRecordFieldsFromPlan(plan(), 'planner', T0) })) as { ok: boolean; record?: EnterpriseEntity };
}
function act(id: string, action: string) {
  return handler(IpcChannel.EnterpriseModuleAction)({ moduleId: 'executive-decisions', id, action }) as Promise<{ ok: boolean; message?: string }>;
}
async function update(id: string, fields: Record<string, unknown>) {
  return (await handler(IpcChannel.EnterpriseModuleUpdate)({ moduleId: 'executive-decisions', id, fields })) as { ok: boolean };
}
function getDecision(id: string) {
  return (handler(IpcChannel.EnterpriseModuleGet)({ moduleId: 'executive-decisions', id }) as Promise<EnterpriseEntity>).then(executiveDecisionFromRecord);
}

describe('Executive Decision Approval lifecycle', () => {
  it('requires a reason to approve, stamps the approver, and gates on RBAC', async () => {
    const created = await createDecision();
    const id = created.record!.id;
    const noReason = await act(id, 'approve');
    expect(noReason.ok).toBe(false);
    expect(noReason.message).toMatch(/reason is required/);

    await update(id, { approvalReason: 'Recovers a key customer order at acceptable cost.' });
    const approved = await act(id, 'approve');
    expect(approved.ok).toBe(true);
    expect(await getDecision(id)).toMatchObject({ status: 'approved', approvedBy: 'ceo@np.dev', approvedAt: T0 });
    expect(rec.authorized).toContain('executive:approve'); // module write scope enforced
  });

  it('verifies an approved decision by re-running the Twin and stores the report (executive:verify)', async () => {
    const id = (await createDecision()).record!.id;
    await update(id, { approvalReason: 'ok' });
    await act(id, 'approve');
    const before = JSON.stringify(MODEL); // read-only proof

    const verified = await act(id, 'verify');
    expect(verified.ok).toBe(true);
    expect(rec.authorized).toContain('executive:verify'); // dedicated verify scope enforced
    const d = await getDecision(id);
    expect(d).toMatchObject({ status: 'verified', verifiedBy: 'ceo@np.dev' });
    expect(d.verificationReport).toMatchObject({ recoveryImprovement: 100, ordersRecovered: 1, verificationAccuracy: 80 });
    expect(JSON.stringify(MODEL)).toBe(before); // verification never mutated the planning model

    const archived = await act(id, 'archive');
    expect(archived.ok).toBe(true);
    expect((await getDecision(id)).status).toBe('archived');
  });

  it('requires a reason to reject and refuses illegal transitions', async () => {
    const id = (await createDecision()).record!.id;
    expect((await act(id, 'verify')).ok).toBe(false); // cannot verify a pending decision
    expect((await act(id, 'reject')).ok).toBe(false); // reason required
    await update(id, { rejectionReason: 'Cost outweighs the benefit.' });
    const rejected = await act(id, 'reject');
    expect(rejected.ok).toBe(true);
    expect(await getDecision(id)).toMatchObject({ status: 'rejected', rejectedBy: 'ceo@np.dev' });
    expect((await act(id, 'approve')).ok).toBe(false); // cannot approve after rejection
  });
});
