/**
 * NP-010 §2 — transaction-class ingestion + the honesty label, over the REAL
 * pipeline (nothing stubbed between the arrows):
 *
 *   CSV → classify → plan → approve (HIGH risk, structural) → import →
 *   records in the real module stores → provenance with `sourceTrust`.
 *
 * Three claims pinned here:
 *   1. A Zoho/QuickBooks-style payments CSV classifies as PAYMENT and lands in
 *      `finance-payments` — not as junk customers.
 *   2. An order-book CSV classifies as SALES_ORDER and lands in `sales-orders`
 *      — closing the limitation recorded in importToRelated.test.ts ("the
 *      ontology has no sales-order entity, so an orders CSV classifies as
 *      CUSTOMERS and imports two junk customer records").
 *   3. EVERY ingested object carries the honesty label `unverified-source` —
 *      on the provenance row AND the record metadata — and NO code path
 *      assigns 'verified' (reserved for future corroboration).
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type {
  DataPlanePlanSummary,
  DataPlaneRunResult,
  EnterpriseModuleDescriptor,
  EnterprisePermission,
  IpcChannelName,
} from '@neuropause/shared';
import { IpcChannel } from '@neuropause/shared';
import { EnterpriseRecordStore } from '../enterprise/framework/enterpriseRecordStore';
import { initDataPlane, type DataPlaneSubsystem } from './index';
import { TEST_TENANT_SCOPE } from '../tenancy/testScope';

const T0 = '2026-08-20T00:00:00.000Z';
const ACTOR = 'priya@example.com';

/** Zoho-style customer-payments export — headers as the real product emits them. */
const PAYMENTS = [
  'Payment Number,Invoice Number,Customer Name,Amount,Payment Date,Payment Mode,Reference Number',
  'PAY-0001,INV-0001,Acme Ltd,1200,2026-08-01,Bank Transfer,UTR12345',
  'PAY-0002,INV-0002,Borealis,800,2026-08-03,UPI,UTR67890',
].join('\n');

/** A plain order book — the exact shape that used to import as junk customers. */
const ORDERS = [
  'Order Number,Customer,Order Date,Ordered Qty,Total',
  'SO-0001,Acme Ltd,2026-07-20,10,5000',
  'SO-0002,Borealis,2026-07-22,4,1600',
].join('\n');

const DESCRIPTORS: EnterpriseModuleDescriptor[] = [
  {
    id: 'finance-payments',
    title: 'Payments',
    singular: 'Payment',
    plural: 'Payments',
    icon: 'doc',
    description: 'test',
    titleField: 'paymentNumber',
    permissions: { read: 'operations:read', write: 'operations:manage' },
    fields: [
      { key: 'paymentNumber', label: 'Payment #', type: 'text', required: true },
      { key: 'invoiceRef', label: 'Invoice', type: 'text', required: true },
      { key: 'customer', label: 'Customer', type: 'text' },
      { key: 'amount', label: 'Amount', type: 'number', required: true },
      { key: 'method', label: 'Method', type: 'text' },
      { key: 'receivedDate', label: 'Received', type: 'date' },
      { key: 'transactionRef', label: 'Transaction Ref', type: 'text' },
    ],
  },
  {
    id: 'sales-orders',
    title: 'Orders',
    singular: 'Order',
    plural: 'Orders',
    icon: 'doc',
    description: 'test',
    titleField: 'orderNumber',
    permissions: { read: 'operations:read', write: 'operations:manage' },
    fields: [
      { key: 'orderNumber', label: 'Order Number', type: 'text', required: true },
      { key: 'customer', label: 'Customer', type: 'text', required: true },
      { key: 'orderDate', label: 'Order Date', type: 'date' },
      { key: 'orderedQty', label: 'Ordered Qty', type: 'number' },
      { key: 'total', label: 'Total', type: 'number' },
    ],
  },
  // Present so the old junk-classification path is AVAILABLE to lose to the
  // real entity — the regression this test exists to hold shut.
  {
    id: 'crm-customers',
    title: 'Customers',
    singular: 'Customer',
    plural: 'Customers',
    icon: 'user',
    description: 'test',
    titleField: 'name',
    permissions: { read: 'crm:read', write: 'crm:manage' },
    fields: [
      { key: 'name', label: 'Customer Name', type: 'text', required: true },
      { key: 'email', label: 'Email', type: 'text' },
    ],
  },
];

describe('NP-010 §2 — transaction-class ingestion + honesty label', () => {
  let dir: string;
  let stores: Map<string, EnterpriseRecordStore>;
  let sub: DataPlaneSubsystem;

  const call = async (channel: IpcChannelName, payload: unknown): Promise<unknown> => {
    const handler = sub.handlers.find((h) => h.channel === channel);
    if (!handler) throw new Error(`no handler for ${channel}`);
    return handler.handler(handler.schema.parse(payload));
  };

  const analyze = async (filename: string, body: string): Promise<DataPlanePlanSummary> =>
    (await call(IpcChannel.DataPlaneAnalyze, {
      filename,
      contentBase64: Buffer.from(body, 'utf8').toString('base64'),
    })) as DataPlanePlanSummary;

  const importAll = async (plan: DataPlanePlanSummary): Promise<DataPlaneRunResult> =>
    (await call(IpcChannel.DataPlaneImport, {
      planId: plan.planId,
      approvals: plan.tables.map((t) => ({ tableName: t.tableName, approved: true })),
      reason: 'Checked against the source system.',
    })) as DataPlaneRunResult;

  beforeEach(async () => {
    dir = join(tmpdir(), `np-bt-${randomUUID()}`);
    await fs.mkdir(dir, { recursive: true });
    const granted = new Set<EnterprisePermission>([
      'data:read',
      'data:import',
      'data:approve',
      'crm:read',
      'crm:manage',
      'operations:read',
      'operations:manage',
    ]);
    stores = new Map(
      DESCRIPTORS.map((d) => [
        d.id,
        new EnterpriseRecordStore(join(dir, `${d.id}.json`), d.id, d.id).bindScope(() => TEST_TENANT_SCOPE),
      ]),
    );
    await Promise.all([...stores.values()].map((s) => s.load()));
    sub = initDataPlane({
      userDataDir: dir,
      storeFor: (id) => stores.get(id) ?? null,
      actor: () => ACTOR,
      tenantId: () => TEST_TENANT_SCOPE.tenantId,
      now: () => T0,
      audit: () => undefined,
      authorize: (permission) => {
        if (!granted.has(permission)) throw new Error(`Missing permission ${permission}`);
      },
      modules: () => DESCRIPTORS,
      saveExport: async (name) => `/tmp/${name}`,
      onImported: () => undefined,
    });
    sub.relationships.bindScope(() => ({
      tenantId: TEST_TENANT_SCOPE.tenantId,
      workspaceId: TEST_TENANT_SCOPE.workspaceId,
    }));
  });

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('classifies a payments CSV as PAYMENT (high risk, approval structural) and lands it in finance-payments', async () => {
    const plan = await analyze('zoho-payments-august.csv', PAYMENTS);
    expect(plan.tables).toHaveLength(1);
    expect(plan.tables[0]!.entityId).toBe('payment');
    expect(plan.tables[0]!.moduleId).toBe('finance-payments');
    expect(plan.tables[0]!.requiresApproval).toBe(true); // money never auto-imports

    const run = await importAll(plan);
    expect(run.tables[0]!.status).toBe('imported');
    const records = stores.get('finance-payments')!.list();
    expect(records).toHaveLength(2);
    const pay1 = records.find((r) => r.title === 'PAY-0001')!;
    expect(pay1.fields.invoiceRef).toBe('INV-0001');
    expect(pay1.fields.amount).toBe(1200);
  });

  it('classifies an order-book CSV as SALES_ORDER — never again as junk customers', async () => {
    const plan = await analyze('order-book.csv', ORDERS);
    expect(plan.tables).toHaveLength(1);
    expect(plan.tables[0]!.entityId).toBe('sales_order');
    expect(plan.tables[0]!.moduleId).toBe('sales-orders');

    const run = await importAll(plan);
    expect(run.tables[0]!.status).toBe('imported');
    expect(stores.get('sales-orders')!.list()).toHaveLength(2);
    // The regression this closes: no customer records may appear from an orders file.
    expect(stores.get('crm-customers')!.list()).toHaveLength(0);
  });

  it('stamps EVERY ingested object unverified-source — provenance AND record metadata — and nothing writes verified', async () => {
    await importAll(await analyze('zoho-payments-august.csv', PAYMENTS));
    await importAll(await analyze('order-book.csv', ORDERS));

    const all = [...stores.get('finance-payments')!.list(), ...stores.get('sales-orders')!.list()];
    expect(all).toHaveLength(4);
    for (const record of all) {
      expect(record.metadata.importSourceTrust).toBe('unverified-source');
      const prov = sub.provenance.forRecord(record.id);
      expect(prov, `provenance missing for ${record.title}`).not.toBeNull();
      expect(prov!.sourceTrust).toBe('unverified-source');
    }

    // 'verified' is reserved for corroboration — no assignment may exist today.
    // Source-level pin, the same style as the Brain purity pins: the literal
    // may appear only in the type definition and its documentation.
    const importerSrc = readFileSync(join(__dirname, 'importer.ts'), 'utf8');
    const assignments = importerSrc.match(/sourceTrust:\s*'verified'/g) ?? [];
    expect(assignments).toHaveLength(0);
  });
});
