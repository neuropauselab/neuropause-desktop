/**
 * GATE 7 — dp:provenance must not be a redaction bypass.
 *
 * The import PREVIEW (`dp:preview`) redacts a salary to `••••••••`, and the
 * EXPORT path double-gates on the module's OWN read permission and hides
 * personal/financial identifiers unless an administrator asks on the record.
 * `dp:provenance` did NEITHER: gated at `data:read` alone, it returned the raw
 * `ProvenanceRecord` — so `fields[].original` handed back the exact salary in
 * cleartext to any authenticated data-surface user, whether or not they could
 * read the HR module, and it shipped internal `tenantId` / `workspaceId` /
 * connector-origin fields the `DataPlaneProvenance` contract does not declare.
 *
 * "Where did this record come from?" is a legitimate question. The answer must
 * carry the source file, sheet, row, approver and the NON-sensitive originals —
 * and redact the rest, behind the same gate the export uses. Redacting on the
 * preview and the export while leaving provenance open is worse than redacting
 * nowhere, because it teaches people the salary is handled.
 *
 * Every test runs through the REAL handler, the REAL Zod schema and the REAL
 * tenant-scoped ProvenanceStore.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type {
  DataPlaneProvenance,
  EnterpriseModuleDescriptor,
  EnterprisePermission,
  IpcChannelName,
} from '@neuropause/shared';
import { IpcChannel } from '@neuropause/shared';
import { initDataPlane, type DataPlaneSubsystem } from './index';
import type { ImportResult, ProvenanceRecord } from './importer';
import { TEST_TENANT_SCOPE } from '../tenancy/testScope';

const ACTOR = 'priya@example.com';
const T0 = '2026-08-10T00:00:00.000Z';

/** A payroll module: ordinary, restricted (salary/bank/PAN) and secret (key). */
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
    { key: 'monthlySalary', label: 'Monthly Salary', type: 'number' },
    { key: 'bankAccountNumber', label: 'Bank Account', type: 'text' },
    { key: 'pan', label: 'PAN (TDS)', type: 'text' },
    { key: 'apiKey', label: 'Integration API Key', type: 'text' },
  ],
};

const SALARY = '₹1,25,000';
const BANK = '50100123456789';
const PAN = 'ABCDE1234F';
const SECRET_KEY = 'sk-live-DO-NOT-LEAK';
const A_SECRET_FILE = 'Payroll-CONFIDENTIAL.xlsx';

function run(): ImportResult {
  return {
    planId: 'imp_p1',
    sourceFile: A_SECRET_FILE,
    importedAt: T0,
    actor: ACTOR,
    status: 'imported',
    tables: [],
    totals: { imported: 1, updated: 0, skipped: 0, failed: 0, duplicates: 0, needsReview: 0 },
  };
}

/** A provenance row that records raw source values, including the salary. */
function record(recordId: string): ProvenanceRecord {
  return {
    recordId,
    moduleId: 'hr-employees',
    planId: 'imp_p1',
    sourceFile: A_SECRET_FILE,
    sourceTable: 'Payroll',
    sourceRow: 7,
    confidence: 1,
    approvedBy: ACTOR,
    importedAt: T0,
    fields: [
      { field: 'name', column: 'Name', original: 'Asha Rao', transformation: null },
      { field: 'monthlySalary', column: 'Monthly Salary', original: SALARY, transformation: `"${SALARY}" → 125000 INR` },
      { field: 'bankAccountNumber', column: 'Bank A/c', original: BANK, transformation: null },
      { field: 'pan', column: 'PAN', original: PAN, transformation: null },
      { field: 'apiKey', column: 'API Key', original: SECRET_KEY, transformation: null },
    ],
  };
}

describe('dp:provenance disclosure (Gate 7)', () => {
  let dir: string;
  let sub: DataPlaneSubsystem;
  let granted: Set<EnterprisePermission>;

  const call = async (channel: IpcChannelName, payload: unknown): Promise<unknown> => {
    const handler = sub.handlers.find((h) => h.channel === channel);
    if (!handler) throw new Error(`no handler for ${channel}`);
    return handler.handler(handler.schema.parse(payload));
  };
  const provenance = (recordId: string) =>
    call(IpcChannel.DataPlaneProvenance, { recordId }) as Promise<DataPlaneProvenance | null>;
  const fieldOf = (p: DataPlaneProvenance, key: string) => p.fields.find((f) => f.field === key)!;

  beforeEach(async () => {
    dir = join(tmpdir(), `np-prov-disc-${randomUUID()}`);
    await fs.mkdir(dir, { recursive: true });
    granted = new Set<EnterprisePermission>(['data:read', 'people:read', 'people:manage']);

    sub = initDataPlane({
      userDataDir: dir,
      storeFor: () => null,
      actor: () => ACTOR,
      tenantId: () => TEST_TENANT_SCOPE.tenantId,
      now: () => T0,
      audit: () => undefined,
      authorize: (permission) => {
        if (!granted.has(permission)) throw new Error(`Missing permission ${permission}`);
      },
      modules: () => [EMPLOYEES],
      appVersion: () => '1.0.0-test',
      workspaceId: () => TEST_TENANT_SCOPE.workspaceId,
      saveExport: async () => null,
      onImported: () => undefined,
    });

    // The store is bound to the active tenant in runtimeCore; do the same here,
    // then seed one payroll provenance row as that tenant.
    sub.provenance.bindScope(() => TEST_TENANT_SCOPE);
    await sub.provenance.load();
    await sub.provenance.append(run(), [record('rec_1')]);
  });

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => undefined);
  });

  /* ── the hole this file exists for ───────────────────────────────────── */

  it('an administrator sees legitimate provenance AND the restricted originals', async () => {
    // people:manage held — the payroll administrator may see the salary and
    // bank account they are responsible for, exactly as the export allows.
    const p = (await provenance('rec_1'))!;
    expect(p).not.toBeNull();
    // Legitimate provenance is preserved.
    expect(p.sourceFile).toBe(A_SECRET_FILE);
    expect(p.sourceRow).toBe(7);
    expect(p.approvedBy).toBe(ACTOR);
    expect(fieldOf(p, 'name').original).toBe('Asha Rao');
    // Restricted originals are visible to the administrator.
    expect(fieldOf(p, 'monthlySalary').original).toBe(SALARY);
    expect(fieldOf(p, 'bankAccountNumber').original).toBe(BANK);
    // …but a SECRET is never shown, not even to an administrator.
    expect(fieldOf(p, 'apiKey').original).not.toContain(SECRET_KEY);
  });

  it('a read-only actor gets provenance with the salary, bank account and PAN REDACTED', async () => {
    granted.delete('people:manage'); // read, but cannot administer the module
    const p = (await provenance('rec_1'))!;
    expect(p).not.toBeNull();

    // The whole record, serialized, must not contain any restricted value.
    const wire = JSON.stringify(p);
    for (const secret of [SALARY, '125000', BANK, PAN, SECRET_KEY]) {
      expect(wire, `"${secret}" leaked through dp:provenance`).not.toContain(secret);
    }
    // Redacted, not dropped — the field is still named so the trail is honest.
    expect(fieldOf(p, 'monthlySalary').original).toBe('••••••••');
    expect(fieldOf(p, 'bankAccountNumber').original).toBe('••••••••');
    // …and the transformation, which embeds the value, is redacted too.
    expect(fieldOf(p, 'monthlySalary').transformation ?? '').not.toContain('125000');

    // …while the ORDINARY provenance really is there: this is redaction, not a
    // broken handler.
    expect(fieldOf(p, 'name').original).toBe('Asha Rao');
    expect(p.sourceFile).toBe(A_SECRET_FILE);
  });

  it('a caller who cannot read the module is refused — data:read is not enough', async () => {
    granted.delete('people:read');
    granted.delete('people:manage');
    // A module you cannot read cannot be traced, exactly as the export refuses.
    await expect(provenance('rec_1')).rejects.toThrow(/people:read/);
  });

  it('the payload carries only the declared contract — no tenant, workspace or connector internals', async () => {
    const p = (await provenance('rec_1'))!;
    const keys = Object.keys(p).sort();
    expect(keys).toEqual(
      [
        'approvedBy',
        'confidence',
        'fields',
        'importedAt',
        'moduleId',
        'planId',
        'recordId',
        'sourceFile',
        'sourceRow',
        'sourceTable',
      ].sort(),
    );
    const wire = JSON.stringify(p);
    expect(wire).not.toContain('tenantId');
    expect(wire).not.toContain('workspaceId');
    expect(wire).not.toContain('connector');
    expect(wire).not.toContain('sourceTrust');
  });

  it('an unknown module fails closed — every field value is hidden', async () => {
    // The record exists and is in-tenant, but its module is not in this build,
    // so the read permission cannot be checked. Metadata is returned; no value
    // is revealed.
    await sub.provenance.append(
      { ...run(), planId: 'imp_p2' },
      [{ ...record('rec_2'), moduleId: 'module-not-in-this-build' }],
    );
    const p = (await provenance('rec_2'))!;
    expect(p).not.toBeNull();
    expect(p.sourceFile).toBe(A_SECRET_FILE);
    for (const f of p.fields) {
      expect(f.original).toBe('••••••••');
    }
  });

  it('a record id from outside the tenant yields null, not a trail', async () => {
    const p = await provenance('does-not-exist');
    expect(p).toBeNull();
  });
});
