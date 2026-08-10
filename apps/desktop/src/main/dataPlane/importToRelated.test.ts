/**
 * Program 7 → Program 6, over the real pipeline.
 *
 *   CSV → classify → plan → import → verify → relationship resolution →
 *   Related Records
 *
 * Nothing is stubbed between those arrows. Two files are imported through the
 * actual `dp:analyze`/`dp:import` handlers into actual record stores; the
 * actual relationship engine resolves the declared links from the values the
 * imported records carry; and the actual Program 6 traversal is asked what the
 * imported customer is connected to.
 *
 * The reason to spend a test on the whole chain rather than each joint is that
 * every joint already has one, and the chain still did not work: an imported
 * order names its customer by a NAME the resolver has to match, the resolution
 * runs on a different pass from the write, and the traversal reads a third
 * store. Each of those is fine alone.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
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
import { buildRelatedRecords } from '../crossDomain/relatedRecords';
import { initDataPlane, type DataPlaneSubsystem } from './index';
import { TEST_TENANT_SCOPE } from '../tenancy/testScope';

const T0 = '2026-08-10T00:00:00.000Z';
const ACTOR = 'priya@example.com';

const CUSTOMERS = ['Customer Name,Email', 'Acme Ltd,a@acme.example', 'Borealis,b@bor.example'].join(
  '\n',
);
/**
 * Invoices, not sales orders — and that is a finding, not a preference.
 *
 * The ontology has no sales-order entity, so an orders CSV classifies as
 * CUSTOMERS (the "Customer" column carries it over the threshold) and imports
 * two junk customer records. Invoices are a declared entity with a declared
 * `invoice.customer` relationship, so this chain exercises the real machinery
 * rather than a gap. See the known limitations in the report.
 *
 * Names the customer the way a real export does — by name, not by id.
 */
const INVOICES = [
  'Invoice Number,Customer,Amount,Invoice Date',
  'INV-0001,Acme Ltd,1200,2026-07-01',
  'INV-0002,Borealis,800,2026-07-02',
].join('\n');

const MODULES: Record<string, [string, EnterprisePermission, EnterprisePermission]> = {
  'crm-customers': ['Customers', 'crm:read', 'crm:manage'],
  finance: ['Invoices', 'operations:read', 'operations:manage'],
};

const DESCRIPTORS: EnterpriseModuleDescriptor[] = [
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
      { key: 'customerCode', label: 'Customer Code', type: 'text' },
    ],
  },
  {
    id: 'finance',
    title: 'Invoices',
    singular: 'Invoice',
    plural: 'Invoices',
    icon: 'doc',
    description: 'test',
    titleField: 'number',
    permissions: { read: 'operations:read', write: 'operations:manage' },
    fields: [
      { key: 'number', label: 'Invoice #', type: 'text', required: true },
      { key: 'customer', label: 'Customer', type: 'text', required: true },
      { key: 'amount', label: 'Subtotal', type: 'number', required: true },
      { key: 'issueDate', label: 'Issued', type: 'date' },
    ],
  },
];

describe('import → relationship resolution → related records', () => {
  let dir: string;
  let stores: Map<string, EnterpriseRecordStore>;
  let sub: DataPlaneSubsystem;
  let granted: Set<EnterprisePermission>;

  const call = async (channel: IpcChannelName, payload: unknown): Promise<unknown> => {
    const handler = sub.handlers.find((h) => h.channel === channel);
    if (!handler) throw new Error(`no handler for ${channel}`);
    return handler.handler(handler.schema.parse(payload));
  };

  /** Analyze then import one CSV, approving every table it found. */
  async function importCsv(filename: string, body: string): Promise<DataPlaneRunResult> {
    const plan = (await call(IpcChannel.DataPlaneAnalyze, {
      filename,
      contentBase64: Buffer.from(body, 'utf8').toString('base64'),
    })) as DataPlanePlanSummary;
    expect(plan.tables.length, `nothing classified in ${filename}`).toBeGreaterThan(0);
    return (await call(IpcChannel.DataPlaneImport, {
      planId: plan.planId,
      approvals: plan.tables.map((t) => ({ tableName: t.tableName, approved: true })),
      reason: 'Checked against the source system.',
    })) as DataPlaneRunResult;
  }

  const relatedTo = (recordId: string, moduleId: string, depth = 2) =>
    buildRelatedRecords(
      {
        relationships: sub.relationships,
        storeFor: (id) => stores.get(id) ?? null,
        describe: (id) =>
          MODULES[id] ? { plural: MODULES[id]![0], read: MODULES[id]![1] } : null,
        allows: (permission) => granted.has(permission),
      },
      { recordId, moduleId, depth },
    );

  beforeEach(async () => {
    dir = join(tmpdir(), `np-i2r-${randomUUID()}`);
    await fs.mkdir(dir, { recursive: true });
    granted = new Set<EnterprisePermission>([
      'data:read',
      'data:import',
      'data:approve',
      'crm:read',
      'crm:manage',
      'operations:read',
      'operations:manage',
    ]);
    stores = new Map(
      Object.keys(MODULES).map((id) => [
        id,
        new EnterpriseRecordStore(join(dir, `${id}.json`), id, id).bindScope(() => TEST_TENANT_SCOPE),
      ]),
    );
    await Promise.all([...stores.values()].map((s) => s.load()));

    sub = initDataPlane({
      userDataDir: dir,
      storeFor: (id) => stores.get(id) ?? null,
      actor: () => ACTOR,
      tenantId: () => 'org_1',
      now: () => T0,
      audit: () => undefined,
      authorize: (permission) => {
        if (!granted.has(permission)) throw new Error(`Missing permission ${permission}`);
      },
      modules: () => DESCRIPTORS,
      saveExport: async (name) => `/tmp/${name}`,
      onImported: () => undefined,
    });
  });

  afterEach(async () => {
    await Promise.all([...stores.values()].map((s) => s.flush()));
    await fs.rm(dir, { recursive: true, force: true }).catch(() => undefined);
  });

  it('walks the whole chain from two CSVs to a connected customer', async () => {
    /* 1 — customers ---------------------------------------------------- */
    const customerRun = await importCsv('customers.csv', CUSTOMERS);
    expect(customerRun.status).toBe('imported');
    expect(customerRun.tables[0]!.verification?.reconciled).toBe(true);

    const acme = stores.get('crm-customers')!.list().find((r) => r.title === 'Acme Ltd')!;
    expect(acme).toBeTruthy();

    // Nothing is connected yet, and the traversal says so honestly rather
    // than erroring.
    expect((await relatedTo(acme.id, 'crm-customers')).total).toBe(0);

    /* 2 — orders, which name the customer by NAME ---------------------- */
    const invoiceRun = await importCsv('invoices.csv', INVOICES);
    expect(invoiceRun.status).toBe('imported');
    expect(invoiceRun.tables[0]!.moduleId).toBe('finance');

    /* 3 — the chain ---------------------------------------------------- */
    const view = await relatedTo(acme.id, 'crm-customers');
    expect(view.root?.title).toBe('Acme Ltd');
    const invoices = view.groups.find((g) => g.moduleId === 'finance');
    expect(invoices, 'the imported invoice did not link to the imported customer').toBeTruthy();
    expect(invoices!.records.map((r) => r.title)).toContain('INV-0001');
    // Borealis's invoice belongs to Borealis, not to Acme.
    expect(invoices!.records.map((r) => r.title)).not.toContain('INV-0002');

    /* 4 — and it can explain itself ------------------------------------ */
    const hop = invoices!.records[0]!.path[0]!;
    expect(hop.why).toContain('finance.customer');
    expect(hop.why).toContain('"Acme Ltd"');
    expect(hop.sourceValue).toBe('Acme Ltd');
  });

  it('keeps provenance for every imported record, back to file and row', async () => {
    await importCsv('customers.csv', CUSTOMERS);
    const acme = stores.get('crm-customers')!.list().find((r) => r.title === 'Acme Ltd')!;

    const provenance = (await call(IpcChannel.DataPlaneProvenance, { recordId: acme.id })) as {
      sourceFile: string;
      sourceRow: number;
      fields: { field: string; column: string; original: string }[];
    } | null;

    expect(provenance?.sourceFile).toBe('customers.csv');
    expect(provenance?.sourceRow).toBeGreaterThan(0);
    expect(provenance?.fields.some((f) => f.original === 'Acme Ltd')).toBe(true);
    // Also on the record itself, so provenance survives the side table's cap.
    expect(acme.metadata?.importSourceFile).toBe('customers.csv');
    expect(typeof acme.metadata?.importKey).toBe('string');
  });

  it('re-importing both files changes nothing and connects nothing twice', async () => {
    await importCsv('customers.csv', CUSTOMERS);
    await importCsv('invoices.csv', INVOICES);
    const acme = stores.get('crm-customers')!.list().find((r) => r.title === 'Acme Ltd')!;
    const before = await relatedTo(acme.id, 'crm-customers');

    await importCsv('customers.csv', CUSTOMERS);
    await importCsv('invoices.csv', INVOICES);

    expect(stores.get('crm-customers')!.list()).toHaveLength(2);
    expect(stores.get('finance')!.list()).toHaveLength(2);
    const after = await relatedTo(acme.id, 'crm-customers');
    expect(after.total).toBe(before.total);
  });

  it('an actor who may import customers but not invoices gets one, blocked on the other', async () => {
    granted.delete('operations:manage');
    await importCsv('customers.csv', CUSTOMERS);
    const run = await importCsv('invoices.csv', INVOICES);

    expect(run.tables[0]!.status).toBe('blocked');
    expect(stores.get('finance')!.list()).toHaveLength(0);
    // And the customer's related-records view is honestly empty rather than
    // showing an invoice that was never written.
    const acme = stores.get('crm-customers')!.list().find((r) => r.title === 'Acme Ltd')!;
    expect((await relatedTo(acme.id, 'crm-customers')).total).toBe(0);
  });
});
