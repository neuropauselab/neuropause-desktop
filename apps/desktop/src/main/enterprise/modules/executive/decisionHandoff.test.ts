import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  IpcChannel,
  decisionRecordFieldsFromPlan,
  executionProposalFromRecord,
  executiveDecisionFromRecord,
  productFromRecord,
  type BillOfMaterials,
  type BomComponent,
  type DecisionType,
  type EnterpriseEntity,
  type EnterprisePermission,
  type Machine,
  type PlanningInput,
  type PlatformEventInput,
  type Product,
  type RecoveryActionType,
  type RecoveryPlan,
  type Routing,
  type SalesOrder,
  type Supplier,
} from '@neuropause/shared';
import type { SecureHandlerDef } from '../../../ipc/secureBridge';
import { EnterpriseModuleRegistry, buildModuleHandlers } from '../../framework';
import { createExecutiveDecisionModule } from './executiveDecisionModule';
import { createExecutionProposalModule } from './executionProposalModule';
import { createScheduleModule } from '../manufacturing/scheduleModule';
import { createRoutingModule } from '../manufacturing/routingModule';
import { createPurchaseRequestModule } from '../procurement/purchaseRequestModule';
import { createWorkOrderModule } from '../maintenance/workOrderModule';
import { createProductModule } from '../inventory/productModule';
import { createStockMovementModule } from '../inventory/stockMovementModule';

const T0 = '2026-07-08T00:00:00.000Z';

/* ── the read-only planning MODEL the verification action re-runs the Twin against ── */

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

function plan(decisionType: DecisionType, action: RecoveryActionType, over: Partial<RecoveryPlan> = {}): RecoveryPlan {
  return {
    id: `decision:${decisionType}`, decisionType, title: `${decisionType.replace(/_/g, ' ')} plan`,
    businessImpact: 'Impact.', evidence: ['e1'], affectedOrders: ['FG-1'], affectedMachines: ['CNC-1'],
    affectedCustomers: ['Acme'], affectedRevenue: 1000,
    recoverySteps: [{ action, description: 'Apply the recovery.', evidence: ['x'] }],
    expectedImprovementPct: 80, confidence: 0.9, estimatedRecoveryDays: 1, priority: 'high',
    tradeoffs: ['a trade-off'], status: 'pending', score: 700, ...over,
  };
}

interface Recorded {
  publish: PlatformEventInput[];
  audit: { action: string; target: string }[];
  broadcast: { channel: string }[];
  authorized: EnterprisePermission[];
}

const paths: string[] = [];
let rec: Recorded;
let registry: EnterpriseModuleRegistry;
let handlers: SecureHandlerDef[];

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
  registry.register(createExecutiveDecisionModule(tmp('dec'), () => MODEL));
  registry.register(createExecutionProposalModule(tmp('prop')));
  registry.register(createScheduleModule(tmp('sch')));
  registry.register(createRoutingModule(tmp('route')));
  registry.register(createPurchaseRequestModule(tmp('pr')));
  registry.register(createWorkOrderModule(tmp('wo')));
  registry.register(createProductModule(tmp('prod')));
  registry.register(createStockMovementModule(tmp('mv')));
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
async function createIn(moduleId: string, fields: Record<string, unknown>) {
  return (await handler(IpcChannel.EnterpriseModuleCreate)({ moduleId, fields })) as { ok: boolean; record?: EnterpriseEntity };
}
function act(moduleId: string, id: string, action: string) {
  return handler(IpcChannel.EnterpriseModuleAction)({ moduleId, id, action }) as Promise<{ ok: boolean; message?: string }>;
}
async function update(moduleId: string, id: string, fields: Record<string, unknown>) {
  return (await handler(IpcChannel.EnterpriseModuleUpdate)({ moduleId, id, fields })) as { ok: boolean };
}
function listOf(moduleId: string): EnterpriseEntity[] {
  const mod = registry.get(moduleId);
  return mod ? mod.store.list() : [];
}
function proposals(): ReturnType<typeof executionProposalFromRecord>[] {
  return listOf('execution-proposals').map(executionProposalFromRecord);
}

async function makeDecision(p: RecoveryPlan): Promise<string> {
  const created = await createIn('executive-decisions', decisionRecordFieldsFromPlan(p, 'planner', T0));
  return created.record!.id;
}
/** Move a decision straight to VERIFIED (the approve→verify lifecycle is covered by the approval suite). */
async function verifyDecision(id: string): Promise<void> {
  await update('executive-decisions', id, { status: 'verified', verifiedBy: 'ceo@np.dev', verifiedAt: T0 });
}

describe('Decision Execution Handoff — only a VERIFIED decision creates an inert proposal', () => {
  it('hands a verified decision off: creates ONE inert Production Schedule draft + a pending proposal, stamps the decision, gates on executive:execute', async () => {
    const id = await makeDecision(plan('machine_failure_recovery', 'use_alternate_machine'));
    // Real governance lifecycle: approve → verify (proves the whole chain), then hand off.
    await update('executive-decisions', id, { approvalReason: 'Recovers a key customer order.' });
    expect((await act('executive-decisions', id, 'approve')).ok).toBe(true);
    expect((await act('executive-decisions', id, 'verify')).ok).toBe(true);

    rec.authorized.length = 0;
    const handed = await act('executive-decisions', id, 'handoff');
    expect(handed.ok).toBe(true);
    expect(rec.authorized).toContain('executive:execute'); // the dedicated execution scope is enforced

    // Exactly one inert draft in the responsible module — a scheduled (unstarted) production schedule.
    const schedules = listOf('manufacturing-schedules');
    expect(schedules).toHaveLength(1);
    expect(schedules[0].fields).toMatchObject({ scheduleNumber: `SCH-PROP-${id}`, status: 'scheduled', productionOrder: 'FG-1' });

    // Exactly one proposal, pending confirmation, routed to Manufacturing and linked to the draft.
    const props = proposals();
    expect(props).toHaveLength(1);
    expect(props[0]).toMatchObject({
      status: 'pending_confirmation', proposalType: 'production_schedule', targetModule: 'manufacturing-schedules',
      sourceDecisionId: id, targetRecord: schedules[0].id, priority: 'critical', expectedImprovementPct: 80,
    });

    // The decision is stamped handed-off and cross-links the proposal (it stays 'verified').
    const d = executiveDecisionFromRecord(registry.get('executive-decisions')!.store.get(id) as EnterpriseEntity);
    expect(d.status).toBe('verified');
    expect(registry.get('executive-decisions')!.store.get(id)!.fields).toMatchObject({ handedOff: 'true', proposalNumber: `PROP-${id}` });
  });

  it('REFUSES to hand off a decision that is not verified — nothing is created', async () => {
    const id = await makeDecision(plan('machine_failure_recovery', 'use_alternate_machine')); // still pending
    const handed = await act('executive-decisions', id, 'handoff');
    expect(handed.ok).toBe(false);
    expect(handed.message).toMatch(/verified/i);
    expect(listOf('manufacturing-schedules')).toHaveLength(0);
    expect(proposals()).toHaveLength(0);
  });

  it('is idempotent — a decision cannot be handed off twice', async () => {
    const id = await makeDecision(plan('machine_failure_recovery', 'use_alternate_machine'));
    await verifyDecision(id);
    expect((await act('executive-decisions', id, 'handoff')).ok).toBe(true);
    const again = await act('executive-decisions', id, 'handoff');
    expect(again.ok).toBe(false);
    expect(again.message).toMatch(/already been handed off/i);
    expect(proposals()).toHaveLength(1); // still exactly one
  });
});

describe('Every decision is routed to its ONE responsible execution authority', () => {
  it('procurement action → a DRAFT Purchase Request (Procurement remains the buy-side authority)', async () => {
    const id = await makeDecision(plan('material_shortage_recovery', 'increase_procurement'));
    await verifyDecision(id);
    expect((await act('executive-decisions', id, 'handoff')).ok).toBe(true);
    const prs = listOf('procurement-requests');
    expect(prs).toHaveLength(1);
    expect(prs[0].fields).toMatchObject({ requestNumber: `PR-PROP-${id}`, status: 'draft' });
    expect(proposals()[0]).toMatchObject({ proposalType: 'purchase_request', targetModule: 'procurement-requests' });
  });

  it('maintenance action → a SCHEDULED Work Order (Maintenance remains the downtime authority)', async () => {
    const id = await makeDecision(plan('maintenance_reschedule', 'delay_maintenance'));
    await verifyDecision(id);
    expect((await act('executive-decisions', id, 'handoff')).ok).toBe(true);
    const wos = listOf('maintenance-work-orders');
    expect(wos).toHaveLength(1);
    expect(wos[0].fields).toMatchObject({ workOrderNumber: `WO-PROP-${id}`, status: 'scheduled' });
    expect(proposals()[0]).toMatchObject({ proposalType: 'maintenance', targetModule: 'maintenance-work-orders' });
  });

  it('routing optimization → a DRAFT Routing (Manufacturing remains the routing authority)', async () => {
    const id = await makeDecision(plan('routing_optimization', 'resequence_jobs'));
    await verifyDecision(id);
    expect((await act('executive-decisions', id, 'handoff')).ok).toBe(true);
    const routings = listOf('manufacturing-routings');
    expect(routings).toHaveLength(1);
    expect(routings[0].fields).toMatchObject({ routingNumber: `ROUTE-PROP-${id}`, status: 'draft' });
    expect(proposals()[0]).toMatchObject({ proposalType: 'routing', targetModule: 'manufacturing-routings' });
  });

  it('safety-stock action → a VOID stock movement that changes NO balance (Inventory read-only proof)', async () => {
    // Seed a real on-hand balance of 40 via a posted receive.
    const created = await createIn('inventory-products', { sku: 'FG-1', name: 'Widget', standardCost: 5, reorderLevel: 10, safetyStock: 5, maximumStock: 200 });
    const productId = created.record!.id;
    await createIn('inventory-movements', { movementNumber: 'MV-SEED', type: 'receive', product: 'FG-1', warehouse: 'WH-1', quantity: 40 });
    const stockBefore = productFromRecord(registry.get('inventory-products')!.store.get(productId) as EnterpriseEntity).currentStock;
    expect(stockBefore).toBe(40);

    const id = await makeDecision(plan('inventory_buffer_recovery', 'use_safety_stock'));
    await verifyDecision(id);
    expect((await act('executive-decisions', id, 'handoff')).ok).toBe(true);

    // The handoff created a VOID movement — excluded from every balance, so on-hand is unchanged.
    const movements = listOf('inventory-movements').map((r) => r.fields);
    const draft = movements.find((m) => m.movementNumber === `MV-PROP-${id}`);
    expect(draft).toMatchObject({ status: 'void', product: 'FG-1' });
    const stockAfter = productFromRecord(registry.get('inventory-products')!.store.get(productId) as EnterpriseEntity).currentStock;
    expect(stockAfter).toBe(stockBefore); // inventory authority untouched — nothing executed
    expect(proposals()[0]).toMatchObject({ proposalType: 'inventory_reallocation', targetModule: 'inventory-movements' });
  });
});

describe('Human confirmation lifecycle — accepting a proposal executes NOTHING', () => {
  async function handOff(): Promise<{ decisionId: string; proposalId: string; draftId: string }> {
    const decisionId = await makeDecision(plan('machine_failure_recovery', 'use_alternate_machine'));
    await verifyDecision(decisionId);
    await act('executive-decisions', decisionId, 'handoff');
    const p = proposals()[0];
    return { decisionId, proposalId: p.id, draftId: p.targetRecord };
  }

  it('accept stamps the confirmation and authorizes the domain team — the draft stays inert', async () => {
    const { proposalId, draftId } = await handOff();
    const accepted = await act('execution-proposals', proposalId, 'accept');
    expect(accepted.ok).toBe(true);
    const p = proposals().find((x) => x.id === proposalId)!;
    expect(p).toMatchObject({ status: 'accepted', confirmedBy: 'ceo@np.dev', confirmedAt: T0 });
    // Accepting the proposal did NOT start the schedule — it is still a plain 'scheduled' draft.
    expect(registry.get('manufacturing-schedules')!.store.get(draftId)!.fields.status).toBe('scheduled');
  });

  it('reject requires a reason and refuses to accept afterwards', async () => {
    const { proposalId } = await handOff();
    const noReason = await act('execution-proposals', proposalId, 'reject');
    expect(noReason.ok).toBe(false);
    expect(noReason.message).toMatch(/reason is required/i);

    await update('execution-proposals', proposalId, { rejectionReason: 'Capacity is available in-house.' });
    expect((await act('execution-proposals', proposalId, 'reject')).ok).toBe(true);
    expect(proposals().find((x) => x.id === proposalId)).toMatchObject({ status: 'rejected', rejectedBy: 'ceo@np.dev' });
    expect((await act('execution-proposals', proposalId, 'accept')).ok).toBe(false); // cannot accept after rejection
  });

  it('enforces RBAC: proposal actions require executive:execute, and reading requires executive:read', async () => {
    const { proposalId } = await handOff();
    rec.authorized.length = 0;
    await act('execution-proposals', proposalId, 'accept');
    expect(rec.authorized).toContain('executive:execute');
    rec.authorized.length = 0;
    await handler(IpcChannel.EnterpriseModuleList)({ moduleId: 'execution-proposals' });
    expect(rec.authorized).toEqual(['executive:read']);
  });
});
