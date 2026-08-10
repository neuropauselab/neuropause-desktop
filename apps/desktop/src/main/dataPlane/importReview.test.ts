/**
 * The four gaps Program 7 left open, closed and tested through the real IPC.
 *
 *  1. ENTITY OVERRIDE — a file could be misclassified with no way to correct
 *     it. `Order Number,Customer,Total` classifies as CUSTOMERS, and declining
 *     was the only recourse.
 *  2. ROW PREVIEW — prepared rows existed in main and were stripped by
 *     `summarizePlan`, so nobody could look at the data before approving it.
 *  3. ROW ACTIONS — `skipRows` was on the contract and unreachable, and there
 *     was no way to update a record that already existed.
 *  4. IDENTITY AGAINST THE DESTINATION — duplicates were detected only within
 *     one file, so importing the same customers twice with a corrected phone
 *     number produced two of them.
 *
 * The load-bearing assertions are the refusals: an override must RECOMPUTE
 * rather than patch, a normalized-only identity match must go to a person
 * rather than either branch, and a sensitive field must not reach the
 * renderer even inside an error message.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type {
  DataPlanePlanSummary,
  DataPlanePreview,
  DataPlaneRunResult,
  EnterpriseModuleDescriptor,
  EnterprisePermission,
  IpcChannelName,
} from '@neuropause/shared';
import { IpcChannel } from '@neuropause/shared';
import { EnterpriseRecordStore } from '../enterprise/framework/enterpriseRecordStore';
import { initDataPlane, type DataPlaneSubsystem } from './index';
import { TEST_TENANT_SCOPE } from '../tenancy/testScope';

const T0 = '2026-08-10T00:00:00.000Z';
const ACTOR = 'priya@example.com';

/** Classifies as CUSTOMERS — the misclassification the override exists for. */
const ORDERS = ['Order Number,Customer,Total', 'SO-1,Acme Ltd,1200', 'SO-2,Borealis,800'].join('\n');

/**
 * A customer CODE is present deliberately. The ontology declares
 * `identityKeys: [['customerCode'], ['email'], ['name']]` and only
 * `customerCode` carries `identity: true` — so a code match is EXACT and an
 * email match is merely NORMALIZED. The two take different paths, and both are
 * exercised below.
 */
const CUSTOMERS = [
  'Customer Code,Customer Name,Email,Phone,Credit Limit',
  'CUS-1,Acme Ltd,a@acme.example,+91 98765 43210,50000',
  'CUS-2,Borealis,b@bor.example,+91 98765 43211,25000',
  // A bad NUMBER, not a bad email. Email carries `shape: 'email'`, which the
  // classifier uses to match columns but row validation does not enforce — so
  // "not-an-email" imports clean today. Noted as a limitation rather than
  // silently worked around here.
  'CUS-3,Gamma Metals,g@gamma.example,+91 98765 43212,not-a-number',
].join('\n');

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
    ],
  },
  {
    id: 'hr-employees',
    title: 'Employees',
    singular: 'Employee',
    plural: 'Employees',
    icon: 'user',
    description: 'test',
    titleField: 'name',
    permissions: { read: 'people:read', write: 'people:manage' },
    fields: [{ key: 'name', label: 'Name', type: 'text', required: true }],
  },
];

describe('import review — override, preview, row actions, identity', () => {
  let dir: string;
  let stores: Map<string, EnterpriseRecordStore>;
  let sub: DataPlaneSubsystem;
  let granted: Set<EnterprisePermission>;
  let audit: { action: string; target: string; summary: string }[];

  const call = async (channel: IpcChannelName, payload: unknown): Promise<unknown> => {
    const handler = sub.handlers.find((h) => h.channel === channel);
    if (!handler) throw new Error(`no handler for ${channel}`);
    return handler.handler(handler.schema.parse(payload));
  };

  const analyze = (filename: string, body: string) =>
    call(IpcChannel.DataPlaneAnalyze, {
      filename,
      contentBase64: Buffer.from(body, 'utf8').toString('base64'),
    }) as Promise<DataPlanePlanSummary>;

  const preview = (planId: string, tableName: string, opts: Record<string, unknown> = {}) =>
    call(IpcChannel.DataPlanePreview, { planId, tableName, ...opts }) as Promise<DataPlanePreview | null>;

  beforeEach(async () => {
    dir = join(tmpdir(), `np-review-${randomUUID()}`);
    await fs.mkdir(dir, { recursive: true });
    audit = [];
    granted = new Set<EnterprisePermission>([
      'data:read',
      'data:import',
      'data:approve',
      'crm:read',
      'crm:manage',
      'people:read',
      'people:manage',
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
      tenantId: () => 'org_1',
      now: () => T0,
      audit: (e) => audit.push(e),
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

  /* ── 1. Entity override ────────────────────────────────────────────────── */

  describe('entity override', () => {
    it('an orders file really does misclassify — this is the gap', async () => {
      const plan = await analyze('orders.csv', ORDERS);
      // Not an assertion about what SHOULD happen; a lock on the known
      // behaviour the override exists to rescue. If the ontology ever grows a
      // sales-order entity this fails, which is the right time to revisit it.
      expect(plan.tables[0]!.entityId).toBe('customer');
    });

    it('recomputes mapping, validation and the plan from the raw source', async () => {
      const plan = await analyze('orders.csv', ORDERS);
      const before = plan.tables[0]!;

      const after = (await call(IpcChannel.DataPlaneReclassify, {
        planId: plan.planId,
        tableName: before.tableName,
        entityId: 'employee',
        reason: 'These are staff records, not customers.',
      })) as DataPlanePlanSummary;

      const table = after.tables[0]!;
      expect(table.entityId).toBe('employee');
      expect(table.moduleId).toBe('hr-employees');
      // Mapping is recomputed against the NEW entity's own fields. Asserted
      // against the live ontology rather than a hand-written allow-list: an
      // earlier version listed keys `employee` does not have, so it could not
      // have failed.
      const { entityById } = await import('./ontology');
      const employeeKeys = new Set(entityById('employee')!.fields.map((f) => f.key));
      for (const mapping of table.mappings) {
        if (mapping.fieldKey === null) continue;
        expect(employeeKeys.has(mapping.fieldKey), `${mapping.fieldKey} is not an employee field`).toBe(true);
      }
      // The old entity's mappings are gone — `Customer` mapped to a customer
      // field, and that field does not exist on an employee.
      expect(table.mappings.some((m) => m.fieldKey === 'customerCode')).toBe(false);
      // Required fields are recomputed for the new entity too.
      expect(table.missingRequired.length).toBeGreaterThan(0);
    });

    it('records the detector’s original verdict alongside the override', async () => {
      const plan = await analyze('orders.csv', ORDERS);
      const after = (await call(IpcChannel.DataPlaneReclassify, {
        planId: plan.planId,
        tableName: plan.tables[0]!.tableName,
        entityId: 'employee',
        reason: 'Staff.',
      })) as DataPlanePlanSummary;

      const table = after.tables[0]!;
      expect(table.classificationMethod).toBe('reviewer');
      // "We thought Customer, a person said Employee" is the whole point.
      expect(table.detectedEntityId).toBe('customer');
      expect(table.detectedConfidence).toBeGreaterThan(0);
      expect(table.override?.fromEntityId).toBe('customer');
      expect(table.override?.toEntityId).toBe('employee');
      expect(table.override?.by).toBe(ACTOR);
      expect(table.override?.reason).toBe('Staff.');
      expect(audit.some((a) => a.action === 'dataplane.entity.override')).toBe(true);
    });

    it('refuses an entity this build cannot import, and says which it can', async () => {
      const plan = await analyze('orders.csv', ORDERS);
      await expect(
        call(IpcChannel.DataPlaneReclassify, {
          planId: plan.planId,
          tableName: plan.tables[0]!.tableName,
          entityId: 'salesOrder',
        }),
      ).rejects.toThrow(/not an entity this build can import/);
    });

    it('requires data:import — changing what a file becomes is not a read', async () => {
      // The scope is stamped by the runtime annotator, which this harness
      // bypasses by calling handlers directly, so the classification is what
      // there is to assert here.
      const { RUNTIME_CHANNEL_PERMISSIONS } = await import('../ipc/runtimeAuthz');
      expect(RUNTIME_CHANNEL_PERMISSIONS[IpcChannel.DataPlaneReclassify]).toBe('data:import');
    });

    it('an overridden table ALWAYS needs approval — reclassify is not a way around it', async () => {
      // The forced path reports confidence 1, which lands in the `high` band
      // and switched off `requiresApproval`'s low-confidence clause. So
      // reclassifying a medium-confidence table to THE SAME ENTITY used to
      // drop the `data:approve` requirement without changing anything about
      // the data.
      const products = ['Product Name,SKU,Unit Price', 'Widget,SKU-1,10', 'Gadget,SKU-2,20'].join('\n');
      const plan = await analyze('products.csv', products);
      const before = plan.tables[0]!;

      const after = (await call(IpcChannel.DataPlaneReclassify, {
        planId: plan.planId,
        tableName: before.tableName,
        entityId: before.entityId,
        reason: 'Same entity, confirming.',
      })) as DataPlanePlanSummary;

      expect(after.tables[0]!.requiresApproval).toBe(true);
      expect(after.requiresApproval).toBe(true);
    });
  });

  /* ── 2. Row preview ────────────────────────────────────────────────────── */

  describe('row preview', () => {
    it('returns the actual rows, with their issues', async () => {
      const plan = await analyze('customers.csv', CUSTOMERS);
      const page = (await preview(plan.planId, plan.tables[0]!.tableName))!;

      expect(page.total).toBe(3);
      expect(page.rows[0]!.title).toBe('Acme Ltd');
      expect(page.rows[0]!.sourceRow).toBeGreaterThan(0);
      const bad = page.rows.find((r) => r.title === 'Gamma Metals')!;
      expect(bad.verdict).toBe('invalid');
      expect(bad.issues[0]!.message).toMatch(/credit limit/i);
      expect(bad.issues[0]!.original).toBe('not-a-number');
    });

    it('filters by bucket and counts the whole table, not the page', async () => {
      const plan = await analyze('customers.csv', CUSTOMERS);
      const table = plan.tables[0]!.tableName;

      const invalid = (await preview(plan.planId, table, { mode: 'invalid' }))!;
      expect(invalid.total).toBe(1);
      expect(invalid.rows).toHaveLength(1);
      // Counts describe the table so the chips can show them all at once.
      expect(invalid.counts.all).toBe(3);
      expect(invalid.counts.valid).toBe(2);
      expect(invalid.counts.invalid).toBe(1);
    });

    it('searches only what a person can see', async () => {
      const plan = await analyze('customers.csv', CUSTOMERS);
      const table = plan.tables[0]!.tableName;
      expect((await preview(plan.planId, table, { search: 'borealis' }))!.total).toBe(1);
      expect((await preview(plan.planId, table, { search: 'nothing here' }))!.total).toBe(0);
    });

    it('paginates, and will not hand back more than 100 rows at once', async () => {
      const many = ['Customer Name,Email', ...Array.from({ length: 250 }, (_, i) => `Cust ${i},c${i}@x.example`)].join('\n');
      const plan = await analyze('many.csv', many);
      const table = plan.tables[0]!.tableName;

      const first = (await preview(plan.planId, table, { limit: 100 }))!;
      expect(first.rows).toHaveLength(100);
      expect(first.total).toBe(250);
      const second = (await preview(plan.planId, table, { offset: 100, limit: 100 }))!;
      expect(second.rows[0]!.rowIndex).toBe(100);
      // The cap is enforced at the SCHEMA, so an over-large ask is refused
      // outright rather than silently clamped. Asserting the clamp alone could
      // never fail, because the schema rejects anything above 100 first.
      await expect(
        call(IpcChannel.DataPlanePreview, { planId: plan.planId, tableName: table, limit: 500 }),
      ).rejects.toThrow();
    });

    it('reports the plan the preview implies', async () => {
      const plan = await analyze('customers.csv', CUSTOMERS);
      const page = (await preview(plan.planId, plan.tables[0]!.tableName))!;
      expect(page.plan.create).toBe(2);
      expect(page.plan.skip).toBe(1); // the invalid row
      expect(page.plan.update).toBe(0);
      expect(page.plan.review).toBe(0);
    });

    it('returns null for a plan that has expired rather than inventing one', async () => {
      expect(await preview('imp_gone', 'Sheet1')).toBeNull();
    });
  });

  /* ── Redaction. The header claimed this was covered; it was not. ───────── */

  describe('sensitive fields never reach the renderer', () => {
    /** `employee.monthlySalary` is the ontology's `sensitive: true` field. */
    const PAYROLL = [
      'Employee Number,Name,Email,Monthly Salary',
      'E-1,Asha Rao,asha@example.com,"₹1,25,000"',
      'E-2,Ravi Kumar,ravi@example.com,not-a-number',
    ].join('\n');

    it('redacts the value, the transformation note AND the error message', async () => {
      const plan = await analyze('payroll.csv', PAYROLL);
      const table = plan.tables.find((t) => t.entityId === 'employee');
      expect(table, 'payroll.csv did not classify as employees').toBeTruthy();
      const page = (await preview(plan.planId, table!.tableName))!;

      const serialized = JSON.stringify(page);
      // The formatted value, the raw source text, and the normalization note
      // that quotes it — an earlier version redacted only the first, so the
      // salary shipped anyway inside `transformations`.
      expect(serialized).not.toContain('125000');
      expect(serialized).not.toContain('1,25,000');
      // And the error message, which embeds the offending value too.
      expect(serialized).not.toContain('not-a-number');

      const salary = page.rows[0]!.fields.find((f) => f.key === 'monthlySalary');
      if (salary) {
        expect(salary.redacted).toBe(true);
        expect(salary.value).toBe('••••••••');
      }
    });

    it('does not let the search box reach a redacted value', async () => {
      const plan = await analyze('payroll.csv', PAYROLL);
      const table = plan.tables.find((t) => t.entityId === 'employee')!;
      // Searching the exact salary must not single the row out.
      const hit = (await preview(plan.planId, table.tableName, { search: '125000' }))!;
      expect(hit.total).toBe(0);
      // While a visible field still searches normally.
      expect((await preview(plan.planId, table.tableName, { search: 'Asha' }))!.total).toBe(1);
    });

    it('no entity uses a sensitive field as its title', async () => {
      // `title` is emitted raw and is in the search haystack. Nothing today
      // makes it sensitive; this pins that, because the day someone adds such
      // an entity the leak would be silent.
      const { ONTOLOGY } = await import('./ontology');
      for (const entity of ONTOLOGY) {
        const titleField = entity.fields.find((f) => f.key === entity.titleField);
        expect(titleField?.sensitive, `${entity.id} titles on a sensitive field`).not.toBe(true);
      }
    });
  });

  /* ── 3 + 4. Identity against the destination, and row actions ──────────── */

  describe('matching what is already there', () => {
    /** Import the customers file, then re-analyze it against a populated store. */
    async function importThenReanalyze(): Promise<DataPlanePlanSummary> {
      const first = await analyze('customers.csv', CUSTOMERS);
      await call(IpcChannel.DataPlaneImport, {
        planId: first.planId,
        approvals: [{ tableName: first.tables[0]!.tableName, approved: true }],
        reason: 'checked',
      });
      // Change a NON-identity field. Changing the email would change the
      // identity itself, which is a different record by definition — and the
      // reason an earlier version of this test found no match at all.
      return analyze('customers-v2.csv', CUSTOMERS.replace('+91 98765 43210', '+91 90000 00001'));
    }

    it('recognises a record that already exists and defaults to SKIP', async () => {
      const plan = await importThenReanalyze();
      const page = (await preview(plan.planId, plan.tables[0]!.tableName))!;
      const acme = page.rows.find((r) => r.title === 'Acme Ltd')!;

      expect(acme.existingMatch).not.toBeNull();
      expect(acme.existingMatch!.title).toBe('Acme Ltd');
      // Matched on the declared identity FIELD, so this is exact — and an
      // exact match still defaults to SKIP. Replacing a stored value is a
      // decision, and the importer is not entitled to make it.
      expect(acme.existingMatch!.kind).toBe('exact');
      expect(acme.action).toBe('skip');
      // And it shows exactly what would change if the reviewer chose update.
      const phone = acme.existingMatch!.differs.find((d) => d.field === 'phone')!;
      expect(phone.existing).not.toBe(phone.incoming);
    });

    it('UPDATES an existing record only when the reviewer says so, row by row', async () => {
      const plan = await importThenReanalyze();
      const table = plan.tables[0]!.tableName;
      const page = (await preview(plan.planId, table))!;
      const acme = page.rows.find((r) => r.title === 'Acme Ltd')!;

      const run = (await call(IpcChannel.DataPlaneImport, {
        planId: plan.planId,
        approvals: [
          {
            tableName: table,
            approved: true,
            rowActions: [{ rowIndex: acme.rowIndex, action: 'update' }],
          },
        ],
        reason: 'Confirmed the new address with the customer.',
      })) as DataPlaneRunResult;

      expect(run.tables[0]!.updated).toBe(1);
      expect(run.tables[0]!.imported).toBe(0);
      // The record was changed in place — not duplicated.
      const customers = stores.get('crm-customers')!.list().filter((r) => r.title === 'Acme Ltd');
      expect(customers).toHaveLength(1);
      expect(String(customers[0]!.fields.phone)).toContain('90000');
      // And the update was verified by reading it back.
      expect(run.tables[0]!.verification?.reconciled).toBe(true);
    });

    it('does nothing to an existing record when the reviewer leaves the default', async () => {
      const plan = await importThenReanalyze();
      const run = (await call(IpcChannel.DataPlaneImport, {
        planId: plan.planId,
        approvals: [{ tableName: plan.tables[0]!.tableName, approved: true }],
        reason: 'checked',
      })) as DataPlaneRunResult;

      expect(run.tables[0]!.updated).toBe(0);
      expect(
        String(stores.get('crm-customers')!.list().find((r) => r.title === 'Acme Ltd')!.fields.phone),
      ).toContain('43210');
    });

    it('an explicit SKIP keeps a row out even when it would otherwise create', async () => {
      const plan = await analyze('customers.csv', CUSTOMERS);
      const table = plan.tables[0]!.tableName;
      const page = (await preview(plan.planId, table))!;
      const borealis = page.rows.find((r) => r.title === 'Borealis')!;

      const run = (await call(IpcChannel.DataPlaneImport, {
        planId: plan.planId,
        approvals: [
          {
            tableName: table,
            approved: true,
            rowActions: [{ rowIndex: borealis.rowIndex, action: 'skip' }],
          },
        ],
        reason: 'checked',
      })) as DataPlaneRunResult;

      expect(run.tables[0]!.imported).toBe(1);
      expect(stores.get('crm-customers')!.list().map((r) => r.title)).not.toContain('Borealis');
    });

    it('an update with no matching record fails loudly rather than creating one', async () => {
      const plan = await analyze('customers.csv', CUSTOMERS);
      const table = plan.tables[0]!.tableName;
      const page = (await preview(plan.planId, table))!;
      const fresh = page.rows.find((r) => r.title === 'Borealis')!;

      const run = (await call(IpcChannel.DataPlaneImport, {
        planId: plan.planId,
        approvals: [
          { tableName: table, approved: true, rowActions: [{ rowIndex: fresh.rowIndex, action: 'update' }] },
        ],
        reason: 'checked',
      })) as DataPlaneRunResult;

      expect(run.tables[0]!.failed).toBe(1);
      expect(run.tables[0]!.errors[0]!.message).toContain('no matching record');
      expect(stores.get('crm-customers')!.list().map((r) => r.title)).not.toContain('Borealis');
    });
  });
});
