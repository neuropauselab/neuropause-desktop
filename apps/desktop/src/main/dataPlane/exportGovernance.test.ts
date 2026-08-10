/**
 * Export governance — the things a bulk-extraction surface must refuse.
 *
 * The defect this file was written for was live and shipped: the import
 * PREVIEW redacted `monthlySalary` to `••••••••` while a reviewer checked a
 * payroll file, and the EXPORT wrote that same salary, plus the bank account,
 * IFSC, UAN, ESIC number and PAN, into a spreadsheet in cleartext for anyone
 * holding read access. Two field models, one flag, and it was on the wrong one.
 *
 * Redacting on one surface and not the other is worse than redacting on
 * neither, because it teaches people the data is being handled.
 *
 * Every test below runs through the REAL handlers, real Zod schemas and real
 * record stores. The load-bearing assertions are the refusals: what is not in
 * the file, and who is not allowed to ask for it.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type {
  DataPlaneExportPlan,
  DataPlaneExportResult,
  DataPlaneExportableModule,
  EnterpriseModuleDescriptor,
  EnterprisePermission,
  IpcChannelName,
} from '@neuropause/shared';
import { IpcChannel, classifyField } from '@neuropause/shared';
import { EnterpriseRecordStore } from '../enterprise/framework/enterpriseRecordStore';
import { initDataPlane, type DataPlaneSubsystem } from './index';
import { openZip } from './zipReader';
import { parseFile } from './parsers';

const ACTOR = 'priya@example.com';
const T0 = '2026-08-10T00:00:00.000Z';

/** A module with one of everything: ordinary, restricted and secret. */
const EMPLOYEES: EnterpriseModuleDescriptor = {
  id: 'hr-employees',
  title: 'Employees',
  singular: 'Employee',
  plural: 'Employees',
  icon: 'user',
  description: 'test',
  titleField: 'name',
  group: 'People',
  permissions: { read: 'people:read', write: 'people:manage' },
  fields: [
    { key: 'name', label: 'Name', type: 'text', required: true },
    { key: 'department', label: 'Department', type: 'text' },
    {
      key: 'status',
      label: 'Status',
      type: 'select',
      filterable: true,
      options: [
        { value: 'active', label: 'Active' },
        { value: 'exited', label: 'Exited' },
      ],
    },
    { key: 'monthlySalary', label: 'Monthly Salary', type: 'number' },
    { key: 'bankAccountNumber', label: 'Bank Account', type: 'text' },
    { key: 'pan', label: 'PAN (TDS)', type: 'text' },
    { key: 'apiKey', label: 'Integration API Key', type: 'text' },
  ],
};

const CUSTOMERS: EnterpriseModuleDescriptor = {
  id: 'crm-customers',
  title: 'Customers',
  singular: 'Customer',
  plural: 'Customers',
  icon: 'user',
  description: 'test',
  titleField: 'name',
  group: 'CRM',
  permissions: { read: 'crm:read', write: 'crm:manage' },
  fields: [
    { key: 'name', label: 'Customer Name', type: 'text', required: true },
    { key: 'email', label: 'Email', type: 'text' },
    {
      key: 'status',
      label: 'Status',
      type: 'select',
      filterable: true,
      options: [
        { value: 'active', label: 'Active' },
        { value: 'churned', label: 'Churned' },
      ],
    },
  ],
};

const DESCRIPTORS = [EMPLOYEES, CUSTOMERS];

describe('export governance', () => {
  let dir: string;
  let stores: Map<string, EnterpriseRecordStore>;
  let sub: DataPlaneSubsystem;
  let granted: Set<EnterprisePermission>;
  let audit: { action: string; target: string; summary: string }[];
  let written: { name: string; format: string; content: Buffer }[];
  let cancelSave: boolean;

  const call = async (channel: IpcChannelName, payload: unknown): Promise<unknown> => {
    const handler = sub.handlers.find((h) => h.channel === channel);
    if (!handler) throw new Error(`no handler for ${channel}`);
    return handler.handler(handler.schema.parse(payload));
  };

  const plan = (payload: Record<string, unknown>) =>
    call(IpcChannel.DataPlaneExportPlan, payload) as Promise<DataPlaneExportPlan>;
  const run = (payload: Record<string, unknown>) =>
    call(IpcChannel.DataPlaneExport, payload) as Promise<DataPlaneExportResult>;

  /** The bytes of the data file, unwrapping the zip when one was packaged. */
  const dataText = (): string => {
    const last = written[written.length - 1];
    if (!last) throw new Error('nothing was written');
    if (!last.name.endsWith('.zip')) return last.content.toString('utf8');
    const zip = openZip(last.content);
    const entry = zip.find((n) => n !== 'manifest.json' && n !== 'README.txt')[0];
    if (!entry) throw new Error('no data file in the package');
    return zip.text(entry) ?? '';
  };

  beforeEach(async () => {
    dir = join(tmpdir(), `np-export-${randomUUID()}`);
    await fs.mkdir(dir, { recursive: true });
    audit = [];
    written = [];
    cancelSave = false;
    granted = new Set<EnterprisePermission>([
      'data:read',
      'people:read',
      'people:manage',
      'crm:read',
      'crm:manage',
    ]);
    stores = new Map(
      DESCRIPTORS.map((d) => [d.id, new EnterpriseRecordStore(join(dir, `${d.id}.json`), d.id, d.id)]),
    );
    await Promise.all([...stores.values()].map((s) => s.load()));

    const hr = stores.get('hr-employees')!;
    hr.create({
      title: 'Asha Rao',
      fields: {
        name: 'Asha Rao',
        department: 'Clinical',
        status: 'active',
        monthlySalary: 125000,
        bankAccountNumber: '50100123456789',
        pan: 'ABCDE1234F',
        apiKey: 'sk-live-DO-NOT-LEAK',
      },
      actor: ACTOR,
      now: T0,
    });
    hr.create({
      title: 'Ravi Kumar',
      fields: {
        name: 'Ravi Kumar',
        department: 'Ops',
        status: 'exited',
        monthlySalary: 90000,
        bankAccountNumber: '50100987654321',
        pan: 'ZYXWV9876Q',
        apiKey: 'sk-live-ALSO-SECRET',
      },
      actor: ACTOR,
      now: T0,
    });
    await hr.flush();

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
      appVersion: () => '1.0.0-test',
      workspaceId: () => 'workspace-default',
      saveExport: async (name, format, content) => {
        if (cancelSave) return null;
        written.push({ name, format, content });
        return `/tmp/${name}`;
      },
      onImported: () => undefined,
    });
  });

  afterEach(async () => {
    await Promise.all([...stores.values()].map((s) => s.flush()));
    await fs.rm(dir, { recursive: true, force: true }).catch(() => undefined);
  });

  /* ── the hole this file exists for ───────────────────────────────────── */

  describe('sensitive fields', () => {
    it('an ordinary export contains no salary, no bank account, no PAN and no key', async () => {
      const result = await run({ moduleId: 'hr-employees', format: 'csv' });
      const text = dataText();

      expect(result.records).toBe(2);
      for (const secret of [
        '125000',
        '90000',
        '50100123456789',
        '50100987654321',
        'ABCDE1234F',
        'ZYXWV9876Q',
        'sk-live-DO-NOT-LEAK',
        'sk-live-ALSO-SECRET',
      ]) {
        expect(text, `"${secret}" reached the export`).not.toContain(secret);
      }
      // …while the ordinary data really is there, so this is about redaction
      // and not about a broken exporter.
      expect(text).toContain('Asha Rao');
      expect(text).toContain('Clinical');
    });

    it('names what it withheld instead of quietly dropping columns', async () => {
      const result = await run({
        moduleId: 'hr-employees',
        format: 'csv',
        fields: ['name', 'monthlySalary', 'apiKey'],
      });
      const labels = result.excluded.map((e) => e.label);
      expect(labels).toContain('Monthly Salary');
      expect(labels).toContain('Integration API Key');
      // A file missing columns you asked for, with no explanation, is a file
      // you will act on as though it were complete.
      expect(result.excluded.every((e) => e.reason.length > 0)).toBe(true);
    });

    it('a secret is refused even to an administrator who asks for it explicitly', async () => {
      // `people:manage` is held, and `includeRestricted` is on. Authentication
      // material still does not leave — there is no legitimate reason for an
      // API key to be in a spreadsheet.
      const result = await run({
        moduleId: 'hr-employees',
        format: 'csv',
        fields: ['name', 'apiKey'],
        includeRestricted: true,
      });
      expect(dataText()).not.toContain('sk-live-DO-NOT-LEAK');
      expect(result.excluded.map((e) => e.key)).toContain('apiKey');
    });

    it('an administrator CAN export restricted identifiers, deliberately and on the record', async () => {
      const result = await run({
        moduleId: 'hr-employees',
        format: 'csv',
        fields: ['name', 'monthlySalary', 'bankAccountNumber'],
        includeRestricted: true,
      });
      const text = dataText();
      expect(text).toContain('125000');
      expect(text).toContain('50100123456789');
      expect(result.excluded.map((e) => e.key)).not.toContain('monthlySalary');

      // …and the audit line says so, because "exported the employee list" and
      // "exported the employee list including bank accounts" are different
      // events and only one of them is worth finding later.
      const line = audit.find((a) => a.action === 'dataplane.export');
      expect(line?.summary).toContain('INCLUDING restricted identifiers');
    });

    it('read access alone cannot ask for restricted data — it is refused, not downgraded', async () => {
      granted.delete('people:manage');
      await expect(
        run({
          moduleId: 'hr-employees',
          format: 'csv',
          fields: ['name', 'monthlySalary'],
          includeRestricted: true,
        }),
      ).rejects.toThrow(/people:manage/);
      // Nothing was written at all. Silently returning the file minus the
      // columns would look like success.
      expect(written).toHaveLength(0);
    });

    it('the plan tells a read-only actor what they cannot have, and why', async () => {
      granted.delete('people:manage');
      const p = await plan({ moduleId: 'hr-employees' });
      expect(p.mayIncludeRestricted).toBe(false);
      const salary = p.fields.find((f) => f.key === 'monthlySalary');
      expect(salary?.selectable).toBe(false);
      expect(salary?.reason).toMatch(/only someone who can edit/i);
      const key = p.fields.find((f) => f.key === 'apiKey');
      expect(key?.sensitivity).toBe('secret');
      expect(key?.selectable).toBe(false);
    });

    it('classifies by NAME, so a new module cannot leak by forgetting to declare', async () => {
      // The point of deriving rather than declaring: nobody has to remember.
      expect(classifyField({ key: 'monthlySalary', label: 'Monthly Salary' })).toBe('restricted');
      expect(classifyField({ key: 'bank_account_number', label: 'Bank Account' })).toBe('restricted');
      expect(classifyField({ key: 'apiKey', label: 'Integration API Key' })).toBe('secret');
      expect(classifyField({ key: 'refreshToken', label: 'Refresh Token' })).toBe('secret');
      // …and a declaration can only make a field MORE restricted, never less.
      expect(classifyField({ key: 'apiKey', label: 'Key', sensitive: 'normal' })).toBe('secret');
      // Ordinary business columns are left alone; an over-broad rule that hides
      // real data gets switched off by the first person it annoys.
      expect(classifyField({ key: 'companyName', label: 'Company Name' })).toBe('normal');
      expect(classifyField({ key: 'panelSize', label: 'Panel Size' })).toBe('normal');
      expect(classifyField({ key: 'accountManager', label: 'Account Manager' })).toBe('normal');
    });
  });

  /* ── scope ───────────────────────────────────────────────────────────── */

  describe('scope', () => {
    it('a filtered export contains the filtered records and no others', async () => {
      const result = await run({
        moduleId: 'hr-employees',
        format: 'csv',
        scope: { filters: [{ field: 'status', value: 'active' }] },
      });
      const text = dataText();
      expect(result.records).toBe(1);
      expect(text).toContain('Asha Rao');
      // The regression that matters: exporting "all" when the user chose
      // "filtered".
      expect(text).not.toContain('Ravi Kumar');
    });

    it('a selected-record export contains exactly those records', async () => {
      const hr = stores.get('hr-employees')!;
      const [first] = hr.list({ status: 'active', limit: 10 });
      const result = await run({
        moduleId: 'hr-employees',
        format: 'csv',
        scope: { recordIds: [first!.id] },
      });
      expect(result.records).toBe(1);
      expect(dataText()).toContain(first!.title);
    });

    it('a single record reports itself as a single record, not as the module', async () => {
      const hr = stores.get('hr-employees')!;
      const [first] = hr.list({ status: 'active', limit: 10 });
      const p = await plan({ moduleId: 'hr-employees', scope: { recordIds: [first!.id] } });
      expect(p.scope).toBe('record');
      expect(p.records).toBe(1);
      expect(p.totalRecords).toBe(2);
    });

    it('selection INSIDE a filter does not widen back to the module', async () => {
      const hr = stores.get('hr-employees')!;
      const exited = hr.list({ status: 'active', limit: 10 }).find((r) => r.fields.status === 'exited');
      const p = await plan({
        moduleId: 'hr-employees',
        scope: { filters: [{ field: 'status', value: 'active' }], recordIds: [exited!.id] },
      });
      // The id names a record the filter excludes, so the intersection is
      // empty — and it is reported as empty rather than resolved by dropping
      // whichever constraint is inconvenient.
      expect(p.records).toBe(0);
      expect(p.blockedReason).toMatch(/nothing matches/i);
    });

    it('the plan and the file agree — there is one place the count comes from', async () => {
      const scope = { filters: [{ field: 'status', value: 'active' }] };
      const p = await plan({ moduleId: 'hr-employees', scope });
      const result = await run({ moduleId: 'hr-employees', format: 'csv', scope });
      expect(result.records).toBe(p.records);
    });

    it('refuses an export with nothing in it rather than writing a header row', async () => {
      await expect(
        run({
          moduleId: 'hr-employees',
          format: 'csv',
          scope: { search: 'nobody-by-this-name' },
        }),
      ).rejects.toThrow(/nothing matches/i);
      expect(written).toHaveLength(0);
    });

    it('search cannot be used to probe a hidden value', async () => {
      // Searching the salary finds nothing, because redacted fields are not in
      // the haystack — the same rule as the import preview, for the same
      // reason.
      const hidden = await plan({ moduleId: 'hr-employees', scope: { search: '125000' } });
      expect(hidden.records).toBe(0);
      const visible = await plan({ moduleId: 'hr-employees', scope: { search: 'Asha' } });
      expect(visible.records).toBe(1);
    });
  });

  /* ── manifest ────────────────────────────────────────────────────────── */

  describe('manifest', () => {
    it('packages the data, a manifest and a readme, and the digest matches the data', async () => {
      const result = await run({
        moduleId: 'hr-employees',
        format: 'csv',
        withManifest: true,
        scope: { filters: [{ field: 'status', value: 'active' }] },
      });

      expect(result.packaged).toBe(true);
      const pkg = written[written.length - 1]!;
      expect(pkg.name.endsWith('.zip')).toBe(true);

      const zip = openZip(pkg.content);
      const names = zip.find(() => true);
      expect(names).toContain('manifest.json');
      expect(names).toContain('README.txt');

      const manifest = JSON.parse(zip.text('manifest.json') ?? '{}') as Record<string, unknown>;
      expect(manifest.createdBy).toBe(ACTOR);
      expect(manifest.schemaVersion).toBe(1);
      expect((manifest.application as { version: string }).version).toBe('1.0.0-test');
      expect((manifest.scope as { recordCount: number }).recordCount).toBe(1);
      expect((manifest.scope as { moduleRecordCount: number }).moduleRecordCount).toBe(2);
      expect((manifest.scope as { filters: unknown[] }).filters).toHaveLength(1);
      expect(manifest.includesRestricted).toBe(false);

      // The digest describes the DATA file a reader will extract, not the
      // archive around it — otherwise it cannot be checked after extraction.
      const dataName = manifest.dataFile as string;
      const bytes = zip.bytes(dataName);
      expect(bytes).not.toBeNull();
      const { createHash } = await import('node:crypto');
      expect(createHash('sha256').update(bytes!).digest('hex')).toBe(manifest.dataFileSha256);
    });

    it('the manifest carries no business values — it can be read without re-exposing the data', async () => {
      await run({
        moduleId: 'hr-employees',
        format: 'csv',
        withManifest: true,
        fields: ['name', 'monthlySalary'],
        includeRestricted: true,
      });
      const zip = openZip(written[written.length - 1]!.content);
      const manifestText = zip.text('manifest.json') ?? '';
      const readme = zip.text('README.txt') ?? '';

      // It records THAT restricted data was included…
      expect(manifestText).toContain('"includesRestricted": true');
      expect(readme).toContain('INCLUDES personal or financial identifiers');
      // …without repeating a single one of the values.
      for (const value of ['125000', 'Asha Rao', '50100123456789']) {
        expect(manifestText, `manifest leaked ${value}`).not.toContain(value);
        expect(readme, `README leaked ${value}`).not.toContain(value);
      }
    });

    it('a bare export is still a plain file — packaging is opt-in', async () => {
      const result = await run({ moduleId: 'hr-employees', format: 'csv' });
      expect(result.packaged).toBe(false);
      expect(result.manifest).toBeNull();
      expect(written[written.length - 1]!.name.endsWith('.csv')).toBe(true);
    });
  });

  /* ── permissions ─────────────────────────────────────────────────────── */

  describe('permissions', () => {
    it('a module you cannot read cannot be exported', async () => {
      granted.delete('people:read');
      await expect(run({ moduleId: 'hr-employees', format: 'csv' })).rejects.toThrow(/people:read/);
      expect(written).toHaveLength(0);
    });

    it('a module you cannot read is not even listed', async () => {
      granted.delete('people:read');
      const list = (await call(IpcChannel.DataPlaneExportable, {})) as DataPlaneExportableModule[];
      /**
       * `dp:exportable` used to gate on `data:read` alone, so it returned the
       * name and live record count of every module in the build. A count is
       * not a value, but "how many employees are there" and "which business
       * systems does this company run" are both answers, and neither was
       * theirs to have.
       */
      expect(list.map((m) => m.moduleId)).not.toContain('hr-employees');
    });

    it('planning a module you cannot read is refused too', async () => {
      granted.delete('people:read');
      await expect(plan({ moduleId: 'hr-employees' })).rejects.toThrow(/people:read/);
    });
  });

  /* ── failure and scale ───────────────────────────────────────────────── */

  describe('failure and scale', () => {
    it('a cancelled save is a cancellation, not a zero-record success', async () => {
      cancelSave = true;
      const result = await run({ moduleId: 'hr-employees', format: 'csv' });
      expect(result.cancelled).toBe(true);
      expect(result.filePath).toBeNull();
      expect(audit.find((a) => a.action === 'dataplane.export')).toBeUndefined();
    });

    it('a write failure surfaces as a failure and writes no success audit', async () => {
      const failing = initDataPlane({
        userDataDir: dir,
        storeFor: (id) => stores.get(id) ?? null,
        actor: () => ACTOR,
        tenantId: () => 'org_1',
        now: () => T0,
        audit: (e) => audit.push(e),
        authorize: () => undefined,
        modules: () => DESCRIPTORS,
        appVersion: () => '1.0.0-test',
        workspaceId: () => null,
        saveExport: async () => {
          throw new Error('disk full');
        },
        onImported: () => undefined,
      });
      const h = failing.handlers.find((x) => x.channel === IpcChannel.DataPlaneExport)!;
      await expect(h.handler(h.schema.parse({ moduleId: 'hr-employees', format: 'csv' }))).rejects.toThrow(
        /disk full/,
      );
      expect(audit.find((a) => a.action === 'dataplane.export')).toBeUndefined();
    });

    it('refuses an oversized selection rather than writing a file that is quietly incomplete', async () => {
      const crm = stores.get('crm-customers')!;
      for (let i = 0; i < 60; i += 1) {
        crm.create({ title: `C${i}`, fields: { name: `C${i}`, status: 'active' }, actor: ACTOR, now: T0 });
      }
      await crm.flush();

      const { MAX_EXPORT_RECORDS, tooLargeReason } = await import('./exportScope');
      // Asserted against the real function rather than by seeding 50,000
      // records, which would make the suite slow to prove arithmetic.
      const over = tooLargeReason({
        kind: 'module',
        label: 'All customers',
        records: new Array(MAX_EXPORT_RECORDS + 1).fill(null) as never[],
        total: MAX_EXPORT_RECORDS + 1,
        missingIds: [],
      });
      expect(over).toMatch(/at most/i);
      expect(over).toMatch(/narrow it/i);
      // …and the real path is genuinely unbounded-safe for a normal size.
      const result = await run({ moduleId: 'crm-customers', format: 'csv' });
      expect(result.records).toBe(60);
    });

    it('a thousand records round-trip through the real exporter and parse back', async () => {
      const crm = stores.get('crm-customers')!;
      for (let i = 0; i < 1000; i += 1) {
        crm.create({
          title: `Customer ${i}`,
          fields: { name: `Customer ${i}`, email: `c${i}@example.com`, status: 'active' },
          actor: ACTOR,
          now: T0,
        });
      }
      await crm.flush();

      const started = Date.now();
      const result = await run({ moduleId: 'crm-customers', format: 'xlsx', withManifest: true });
      const elapsed = Date.now() - started;

      expect(result.records).toBe(1000);
      // Read the written bytes back with the product's OWN parser, so this
      // asserts a real spreadsheet rather than a plausible buffer.
      const zip = openZip(written[written.length - 1]!.content);
      const xlsxName = zip.find((n) => n.endsWith('.xlsx'))[0]!;
      const parsed = parseFile(xlsxName, zip.bytes(xlsxName)!);
      expect(parsed.tables[0]?.rows.length).toBe(1000);
      // Not a benchmark — a guard against an accidental O(n²) in the writer.
      expect(elapsed).toBeLessThan(20_000);
    });
  });

  /* ── formats ─────────────────────────────────────────────────────────── */

  describe('formats', () => {
    it('names PDF as unavailable with the reason rather than omitting it', async () => {
      const p = await plan({ moduleId: 'crm-customers' });
      expect(p.formats.supported).toEqual(['csv', 'xlsx', 'json']);
      const pdf = p.formats.unavailable.find((f) => f.format === 'pdf');
      expect(pdf).toBeTruthy();
      expect(pdf?.reason).toMatch(/no PDF engine/i);
    });

    it('the contract refuses a format this build cannot write', async () => {
      await expect(call(IpcChannel.DataPlaneExport, { moduleId: 'crm-customers', format: 'pdf' })).rejects.toThrow();
    });

    it('JSON and CSV of the same scope carry the same records', async () => {
      const scope = { filters: [{ field: 'status', value: 'active' }] };
      const csv = await run({ moduleId: 'hr-employees', format: 'csv', scope });
      const json = await run({ moduleId: 'hr-employees', format: 'json', scope });
      expect(json.records).toBe(csv.records);
      const parsed = JSON.parse(dataText()) as Record<string, unknown>[];
      expect(parsed).toHaveLength(1);
      expect(parsed[0]!.name).toBe('Asha Rao');
      // The format changed; the governance did not.
      expect(Object.keys(parsed[0]!)).not.toContain('monthlySalary');
    });
  });

  /* ── Filters must not become a value oracle ───────────────────────────── */

  describe('filters', () => {
    it('a filter on a restricted field is REFUSED, not answered', async () => {
      /**
       * The hole: `dp:export.plan` needs only `data:read` and returns a record
       * count. Filtering on `monthlySalary=125000` and reading the count off the
       * response confirms one employee's salary — no file written, nothing
       * audited. The search path was already restricted for exactly this; the
       * filter path was not.
       */
      const p = await plan({
        moduleId: 'hr-employees',
        scope: { filters: [{ field: 'monthlySalary', value: '125000' }] },
      });
      expect(p.records).toBe(2);
      expect(p.refusedFilters.map((f) => f.field)).toContain('monthlySalary');
      expect(p.refusedFilters[0]?.reason).toMatch(/personal or financial identifier/i);
    });

    it('a filter on a secret field is refused too, and cannot name the holder', async () => {
      const p = await plan({
        moduleId: 'hr-employees',
        scope: { filters: [{ field: 'apiKey', value: 'sk-live-DO-NOT-LEAK' }] },
        fields: ['apiKey'],
      });
      expect(p.records).toBe(2);
      expect(p.refusedFilters.map((f) => f.field)).toContain('apiKey');
      // …and the "an export needs at least one column" fallback must not fire
      // here, or the file would name WHICH record held the guessed key.
      expect(p.blockedReason).toMatch(/withheld|no columns/i);
    });

    it('a filter naming a field that does not exist is refused rather than ignored', async () => {
      const p = await plan({
        moduleId: 'hr-employees',
        scope: { filters: [{ field: 'nonsense', value: 'x' }] },
      });
      expect(p.refusedFilters[0]?.reason).toMatch(/no “nonsense” field/i);
      // Silently ignoring it would produce a WIDER export than was asked for.
      expect(p.records).toBe(2);
    });

    it('an ordinary filter still works, so the refusals are about sensitivity', async () => {
      const p = await plan({
        moduleId: 'hr-employees',
        scope: { filters: [{ field: 'status', value: 'active' }] },
      });
      expect(p.records).toBe(1);
      expect(p.refusedFilters).toEqual([]);
    });

    it('the manifest records the filter by LABEL and never a withheld value', async () => {
      await run({
        moduleId: 'hr-employees',
        format: 'csv',
        withManifest: true,
        scope: {
          filters: [
            { field: 'status', value: 'active' },
            { field: 'pan', value: 'ABCDE1234F' },
          ],
        },
      });
      const zip = openZip(written[written.length - 1]!.content);
      const manifestText = zip.text('manifest.json') ?? '';
      const readme = zip.text('README.txt') ?? '';

      expect(manifestText).toContain('Status');
      // The refused filter's VALUE was being copied verbatim into the manifest,
      // the README and the audit line — so a filter was a way to write a PAN
      // into three files at once.
      for (const text of [manifestText, readme]) {
        expect(text).not.toContain('ABCDE1234F');
      }
      expect(audit.find((a) => a.action === 'dataplane.export')?.summary).not.toContain('ABCDE1234F');
    });

    it('the plan refuses restricted data the same way the run does', async () => {
      granted.delete('people:manage');
      const p = await plan({ moduleId: 'hr-employees', fields: ['name', 'monthlySalary'], includeRestricted: true });
      // A preview saying "ready" for a run that throws is the one thing a
      // preview must never do.
      expect(p.blockedReason).toMatch(/people:manage/);
    });
  });
});
