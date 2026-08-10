/**
 * The four things a production import must do that this one did not.
 *
 * Each `describe` below corresponds to a defect found by auditing the pipeline
 * rather than to a feature request, and each is written so it FAILS against the
 * code as it was:
 *
 *  1. `data:import` alone could create records in any module — finance,
 *     hr-employees, crm-customers — without holding that module's manage
 *     scope. Export has always double-gated on the module's read scope; bulk
 *     insertion had no equivalent.
 *  2. Re-importing the same file duplicated every record, because
 *     `store.create` always mints a fresh id and nothing consulted what had
 *     already been imported.
 *  3. Every number in the result came from the loop that did the writing —
 *     the importer reporting on its own intentions. Nothing re-read the store.
 *  4. `applySavedMapping` was exported, tested, and called from nowhere, so a
 *     reviewer's remembered mapping changed not one column.
 *
 * Driven through the real IPC handlers over real record stores, because the
 * gate that matters is the one the handler actually installs.
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
import { initDataPlane, type DataPlaneSubsystem } from './index';
import { TEST_TENANT_SCOPE } from '../tenancy/testScope';

const T0 = '2026-08-10T00:00:00.000Z';
const ACTOR = 'priya@example.com';

const CUSTOMERS_CSV = ['Customer Name,Email', 'Acme Ltd,a@acme.example', 'Borealis,b@bor.example'].join(
  '\n',
);

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
];

describe('import hardening', () => {
  let dir: string;
  let stores: Map<string, EnterpriseRecordStore>;
  let sub: DataPlaneSubsystem;
  let granted: Set<EnterprisePermission>;
  let audit: { action: string; target: string; summary: string }[];

  const build = (): DataPlaneSubsystem =>
    initDataPlane({
      userDataDir: dir,
      storeFor: (moduleId) => stores.get(moduleId) ?? null,
      actor: () => ACTOR,
      tenantId: () => 'org_1',
      now: () => T0,
      audit: (entry) => audit.push(entry),
      authorize: (permission) => {
        if (!granted.has(permission)) throw new Error(`Missing permission ${permission}`);
      },
      modules: () => DESCRIPTORS,
      saveExport: async (name) => `/tmp/${name}`,
      onImported: () => undefined,
    });

  const call = async (channel: IpcChannelName, payload: unknown): Promise<unknown> => {
    const handler = sub.handlers.find((h) => h.channel === channel);
    if (!handler) throw new Error(`no handler for ${channel}`);
    return handler.handler(handler.schema.parse(payload));
  };

  const b64 = (text: string): string => Buffer.from(text, 'utf8').toString('base64');

  const analyze = (filename = 'customers.csv', body = CUSTOMERS_CSV) =>
    call(IpcChannel.DataPlaneAnalyze, {
      filename,
      contentBase64: b64(body),
    }) as Promise<DataPlanePlanSummary>;

  const importPlan = (planId: string, tableName: string) =>
    call(IpcChannel.DataPlaneImport, {
      planId,
      approvals: [{ tableName, approved: true }],
      reason: 'Checked against the source.',
    }) as Promise<DataPlaneRunResult>;

  beforeEach(async () => {
    dir = join(tmpdir(), `np-import-${randomUUID()}`);
    await fs.mkdir(dir, { recursive: true });
    audit = [];
    granted = new Set<EnterprisePermission>([
      'data:read',
      'data:import',
      'data:approve',
      'crm:read',
      'crm:manage',
    ]);
    stores = new Map([
      [
        'crm-customers',
        new EnterpriseRecordStore(join(dir, 'cust.json'), 'crm-customers', 'customer').bindScope(() => TEST_TENANT_SCOPE),
      ],
    ]);
    await Promise.all([...stores.values()].map((s) => s.load()));
    sub = build();
  });

  afterEach(async () => {
    await Promise.all([...stores.values()].map((s) => s.flush()));
    await fs.rm(dir, { recursive: true, force: true }).catch(() => undefined);
  });

  /* ── 1. The write gate ─────────────────────────────────────────────────── */

  describe('the destination module’s write scope', () => {
    it('refuses to create records in a module the actor cannot manage', async () => {
      granted = new Set<EnterprisePermission>([
        'data:read',
        'data:import',
        'data:approve',
        'crm:read', // can READ customers…
      ]); // …but not crm:manage
      sub = build();

      const plan = await analyze();
      const run = await importPlan(plan.planId, plan.tables[0]!.tableName);

      expect(run.tables[0]!.status).toBe('blocked');
      expect(run.tables[0]!.note).toContain('do not have permission');
      expect(run.totals.imported).toBe(0);
      // The gate is structural: nothing reached the store.
      expect(stores.get('crm-customers')!.list()).toHaveLength(0);
    });

    it('imports once the manage scope is held', async () => {
      const plan = await analyze();
      const run = await importPlan(plan.planId, plan.tables[0]!.tableName);
      expect(run.status).toBe('imported');
      expect(stores.get('crm-customers')!.list()).toHaveLength(2);
    });
  });

  /* ── 2. Idempotency ────────────────────────────────────────────────────── */

  describe('re-importing the same file', () => {
    it('does not duplicate a single record', async () => {
      const first = await analyze();
      await importPlan(first.planId, first.tables[0]!.tableName);
      expect(stores.get('crm-customers')!.list()).toHaveLength(2);

      // A fresh analysis mints a NEW plan id, which is exactly why the guard
      // keys on the source coordinates rather than the plan.
      const second = await analyze();
      const run = await importPlan(second.planId, second.tables[0]!.tableName);

      expect(stores.get('crm-customers')!.list()).toHaveLength(2);
      expect(run.totals.imported).toBe(0);
      expect(run.tables[0]!.verification?.alreadyImported).toBe(2);
      // And it says so, rather than reporting the rows as rejected.
      expect(run.tables[0]!.note).toContain('already imported');
    });

    it('still imports rows the earlier run did not reach', async () => {
      const first = await analyze();
      await importPlan(first.planId, first.tables[0]!.tableName);

      const grown = `${CUSTOMERS_CSV}\nGamma Metals,g@gamma.example`;
      const second = await analyze('customers.csv', grown);
      const run = await importPlan(second.planId, second.tables[0]!.tableName);

      expect(run.totals.imported).toBe(1);
      expect(stores.get('crm-customers')!.list()).toHaveLength(3);
    });

    it('spends the plan, so the same planId cannot be imported twice', async () => {
      const plan = await analyze();
      await importPlan(plan.planId, plan.tables[0]!.tableName);
      await expect(importPlan(plan.planId, plan.tables[0]!.tableName)).rejects.toThrow(
        /no longer available/,
      );
    });
  });

  /* ── 3. Verification ───────────────────────────────────────────────────── */

  describe('verification', () => {
    it('reconciles source rows against records read back from the store', async () => {
      const plan = await analyze();
      const run = await importPlan(plan.planId, plan.tables[0]!.tableName);
      const verification = run.tables[0]!.verification!;

      expect(verification.checked).toBe(true);
      expect(verification.sourceRows).toBe(2);
      expect(verification.created).toBe(2);
      // The number that matters: read back OUT of the store, not counted on
      // the way in.
      expect(verification.confirmed).toBe(2);
      expect(verification.reconciled).toBe(true);
      expect(verification.detail).toContain('every created record was read back');
    });

    it('refuses to call a run "imported" when the records cannot be read back', async () => {
      // Delete every record the moment it lands: the write "succeeds", the
      // store disagrees. Before verification existed this reported a clean
      // import of two customers that were not there.
      const store = stores.get('crm-customers')!;
      const realCreate = store.create.bind(store);
      store.create = ((input: Parameters<typeof realCreate>[0]) => {
        const record = realCreate(input);
        store.softDelete(record.id);
        return record;
      }) as typeof store.create;

      const plan = await analyze();
      const run = await importPlan(plan.planId, plan.tables[0]!.tableName);

      expect(run.tables[0]!.verification!.confirmed).toBe(0);
      expect(run.tables[0]!.verification!.reconciled).toBe(false);
      expect(run.tables[0]!.status).toBe('partial');
      expect(run.status).not.toBe('imported');
      expect(run.tables[0]!.note).toContain('could not be read back');
    });
  });

  /* ── 4. Saved mappings ─────────────────────────────────────────────────── */

  describe('saved mappings', () => {
    it('applies a remembered mapping instead of only counting its use', async () => {
      const plan = await analyze();
      const table = plan.tables[0]!;
      const emailColumn = table.mappings.find((m) => m.header === 'Email')!;
      expect(emailColumn.fieldKey).toBe('email');

      // A reviewer decides Email is really the customer's NAME field. Absurd
      // on purpose: nothing the classifier would ever produce, so if it comes
      // back the mapping was genuinely applied rather than re-guessed.
      await call(IpcChannel.DataPlaneSaveMapping, {
        signature: table.signature,
        entityId: table.entityId,
        columns: [
          { header: 'Customer Name', fieldKey: 'name' },
          { header: 'Email', fieldKey: 'name' },
        ],
      });

      const reanalyzed = await analyze();
      const remembered = reanalyzed.tables[0]!.mappings.find((m) => m.header === 'Email')!;
      expect(remembered.fieldKey).toBe('name');
      expect(remembered.reasons.join(' ')).toContain('remembered mapping');
      expect(remembered.confidence).toBe(1);
    });

    it('never invents a column the file does not contain', async () => {
      const plan = await analyze();
      await call(IpcChannel.DataPlaneSaveMapping, {
        signature: plan.tables[0]!.signature,
        entityId: plan.tables[0]!.entityId,
        columns: [{ header: 'Phone', fieldKey: 'phone' }],
      });
      const reanalyzed = await analyze();
      expect(reanalyzed.tables[0]!.mappings.some((m) => m.header === 'Phone')).toBe(false);
    });
  });
});
