/**
 * Phase 6 finalization — Data Plane IPC wiring locks.
 *
 * WHY THIS FILE EXISTS. `runtimeCore` refuses to start if any runtime channel is
 * neither RBAC/auth-gated nor public-allowlisted. That check runs at BOOT, not in
 * the test suite — which is exactly why the previous phase declined to wire the
 * plane: a mistake would have shipped a non-booting app past a green gate.
 *
 * These tests replicate the boot invariant against the real registries, so the
 * gate now catches what only launching Electron would otherwise catch. They do
 * NOT replace launching the app (renderer, preload and window lifecycle are still
 * unverified here) — they remove the class of failure that is checkable offline.
 */
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ALL_ENTERPRISE_PERMISSIONS,
  IpcChannel,
  RUNTIME_INVOKABLE_CHANNELS,
  type EnterpriseModuleDescriptor,
  type EnterprisePermission,
  type IpcChannelName,
} from '@neuropause/shared';
import { PUBLIC_CHANNELS, RUNTIME_CHANNEL_PERMISSIONS, assertAllChannelsClassified } from '../ipc/runtimeAuthz';
import { EnterpriseRecordStore } from '../enterprise/framework/enterpriseRecordStore';
import { initDataPlane, type DataPlaneSubsystem } from './index';
import { buildXlsx } from './testFixtures';
import { sourceSignature } from './mappingMemory';

const DATA_PLANE_CHANNELS: IpcChannelName[] = [
  IpcChannel.DataPlaneInspect,
  IpcChannel.DataPlaneAnalyze,
  IpcChannel.DataPlanePlan,
  IpcChannel.DataPlaneImport,
  IpcChannel.DataPlaneHistory,
  IpcChannel.DataPlaneRun,
  IpcChannel.DataPlaneProvenance,
  IpcChannel.DataPlaneMappings,
  IpcChannel.DataPlaneSaveMapping,
  IpcChannel.DataPlaneForgetMapping,
  IpcChannel.DataPlaneOntology,
  IpcChannel.DataPlaneExportable,
  IpcChannel.DataPlaneExport,
  IpcChannel.DataPlaneRelationshipOverview,
  IpcChannel.DataPlaneRelationshipQueue,
  IpcChannel.DataPlaneRelationshipDecide,
  IpcChannel.DataPlaneRelationshipSkip,
  IpcChannel.DataPlaneRelationshipRetry,
  IpcChannel.DataPlaneRelationshipGraph,
];

const T0 = '2026-08-08T12:00:00.000Z';

let dir: string;
let sub: DataPlaneSubsystem;
let audit: { action: string; target: string; summary: string }[];
let granted: Set<EnterprisePermission>;
let stores: Map<string, EnterpriseRecordStore>;
let tenant: string;
let descriptors: EnterpriseModuleDescriptor[];
let saved: { name: string; bytes: number }[];
let saveCancelled: boolean;
let imported: { moduleId: string; recordIds: string[]; planId: string; correlationId: string }[];

function build(): DataPlaneSubsystem {
  return initDataPlane({
    userDataDir: dir,
    storeFor: (moduleId) => stores.get(moduleId) ?? null,
    actor: () => 'reviewer@np.example',
    tenantId: () => tenant,
    now: () => T0,
    audit: (e) => audit.push(e),
    authorize: (permission) => {
      if (!granted.has(permission)) {
        const err = new Error(`Missing permission ${permission}`);
        err.name = 'AuthorizationError';
        throw err;
      }
    },
    modules: () => descriptors,
    saveExport: async (name, _format, content) => {
      if (saveCancelled) return null;
      saved.push({ name, bytes: content.length });
      return `/tmp/${name}`;
    },
    onImported: (e) => imported.push(e),
  });
}

beforeEach(async () => {
  dir = await fs.mkdtemp(join(tmpdir(), 'np-dpwire-'));
  audit = [];
  tenant = 'tenant-a';
  // `crm:read` / `operations:read` are the DESTINATION modules' own read rights,
  // which export enforces on top of `data:read`. A test that narrows this set
  // below proves the second gate is load-bearing.
  granted = new Set<EnterprisePermission>([
    'data:read',
    'data:import',
    'data:approve',
    'crm:read',
    'operations:read',
  ]);
  stores = new Map([
    ['projects-projects', new EnterpriseRecordStore(join(dir, 'proj.json'), 'projects-projects', 'project')],
    ['crm-customers', new EnterpriseRecordStore(join(dir, 'cust.json'), 'crm-customers', 'customer')],
  ]);
  saved = [];
  saveCancelled = false;
  imported = [];
  descriptors = [
    {
      id: 'crm-customers',
      title: 'Customers',
      singular: 'Customer',
      plural: 'Customers',
      icon: 'user',
      description: 'Customer master data.',
      fields: [
        { key: 'name', label: 'Name', type: 'text', required: true },
        { key: 'email', label: 'Email', type: 'text' },
      ],
      titleField: 'name',
      permissions: { read: 'crm:read', write: 'crm:manage' },
    },
    {
      id: 'projects-projects',
      title: 'Projects',
      singular: 'Project',
      plural: 'Projects',
      icon: 'grid',
      description: 'Delivery projects.',
      fields: [
        { key: 'code', label: 'Project Number', type: 'text', required: true },
        { key: 'name', label: 'Project Name', type: 'text' },
      ],
      titleField: 'code',
      permissions: { read: 'operations:read', write: 'operations:manage' },
    },
  ];
  sub = build();
});

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

function handlerFor(channel: IpcChannelName): (p: unknown) => unknown | Promise<unknown> {
  const def = sub.handlers.find((h) => h.channel === channel);
  if (!def) throw new Error(`no handler registered for ${channel}`);
  return def.handler as (p: unknown) => unknown;
}

const b64 = (buf: Buffer): string => buf.toString('base64');

// ---------------------------------------------------------------------------

describe('boot invariant — the check runtimeCore performs at startup', () => {
  it('registers every Data Plane channel as runtime-invokable', () => {
    for (const channel of DATA_PLANE_CHANNELS) {
      expect(RUNTIME_INVOKABLE_CHANNELS).toContain(channel);
    }
  });

  it('exposes a handler for every declared channel', () => {
    const registered = new Set(sub.handlers.map((h) => h.channel));
    for (const channel of DATA_PLANE_CHANNELS) expect(registered).toContain(channel);
    expect(sub.handlers).toHaveLength(DATA_PLANE_CHANNELS.length);
  });

  it('gates every handler — none rides on sender-trust alone', () => {
    for (const def of sub.handlers) {
      const gated = def.permission !== undefined || def.requireAuth === true;
      expect(gated, `${def.channel} is ungated`).toBe(true);
    }
  });

  it('REPLICATES the startup classification check for Data Plane channels', () => {
    // Exactly what runtimeCore does: build the gated set from the handler defs,
    // then assert nothing is left unclassified.
    const gated = new Set<IpcChannelName>();
    for (const def of sub.handlers) {
      if (def.permission || def.requireAuth) gated.add(def.channel);
    }
    const ungated = assertAllChannelsClassified(gated, PUBLIC_CHANNELS);
    const ours = ungated.filter((c) => DATA_PLANE_CHANNELS.includes(c));
    expect(ours, `these channels would crash boot: ${ours.join(', ')}`).toEqual([]);
  });

  it('classifies each channel with a real, declared enterprise permission', () => {
    for (const channel of DATA_PLANE_CHANNELS) {
      const permission = RUNTIME_CHANNEL_PERMISSIONS[channel];
      expect(permission, `${channel} has no permission`).toBeDefined();
      expect(ALL_ENTERPRISE_PERMISSIONS).toContain(permission);
    }
  });

  it('keeps read and write scopes separate — only mutating channels take data:import', () => {
    expect(RUNTIME_CHANNEL_PERMISSIONS[IpcChannel.DataPlaneAnalyze]).toBe('data:read');
    expect(RUNTIME_CHANNEL_PERMISSIONS[IpcChannel.DataPlaneImport]).toBe('data:import');
    expect(RUNTIME_CHANNEL_PERMISSIONS[IpcChannel.DataPlaneSaveMapping]).toBe('data:import');
  });

  it('marks the mutating channels for audit', () => {
    const importDef = sub.handlers.find((h) => h.channel === IpcChannel.DataPlaneImport);
    expect(importDef?.audit).toBe(true);
    expect(sub.handlers.find((h) => h.channel === IpcChannel.DataPlaneSaveMapping)?.audit).toBe(true);
  });
});

// ---------------------------------------------------------------------------

describe('handlers do real work over IPC shapes', () => {
  const workbook = buildXlsx([
    { name: 'Projects', rows: [['Project Number', 'Project Name', 'Budget'], ['P-1', 'Rollout', 1000]] },
  ]);

  it('describes the ontology, including what it cannot read', async () => {
    const view = (await handlerFor(IpcChannel.DataPlaneOntology)({})) as {
      entities: unknown[];
      supportedFormats: string[];
      unsupportedFormats: { format: string; reason: string }[];
    };
    expect(view.entities.length).toBeGreaterThan(0);
    expect(view.supportedFormats).toContain('xlsx');
    expect(view.unsupportedFormats.map((f) => f.format)).toContain('pdf');
  });

  it('inspects a file without importing anything', async () => {
    const res = (await handlerFor(IpcChannel.DataPlaneInspect)({
      filename: 'p.xlsx',
      contentBase64: b64(workbook),
    })) as { format: string; supported: boolean; tableNames: string[] };
    expect(res.format).toBe('xlsx');
    expect(res.supported).toBe(true);
    expect(res.tableNames).toEqual(['Projects']);
    expect(stores.get('projects-projects')?.list()).toHaveLength(0);
  });

  it('reports an unsupported file honestly through the inspect channel', async () => {
    const res = (await handlerFor(IpcChannel.DataPlaneInspect)({
      filename: 'x.pdf',
      contentBase64: b64(Buffer.from('%PDF-1.7', 'utf8')),
    })) as { supported: boolean; unsupportedReason: string | null };
    expect(res.supported).toBe(false);
    expect(res.unsupportedReason).toMatch(/PDF/i);
  });

  it('analyze → plan → import round-trips through the cached plan', async () => {
    const plan = (await handlerFor(IpcChannel.DataPlaneAnalyze)({
      filename: 'p.xlsx',
      contentBase64: b64(workbook),
    })) as { planId: string; tables: { tableName: string }[] };
    expect(plan.tables[0]?.tableName).toBe('Projects');

    const replay = (await handlerFor(IpcChannel.DataPlanePlan)({ planId: plan.planId })) as { planId: string } | null;
    expect(replay?.planId).toBe(plan.planId);

    const run = (await handlerFor(IpcChannel.DataPlaneImport)({
      planId: plan.planId,
      approvals: [{ tableName: 'Projects', approved: true }],
    })) as { status: string; totals: { imported: number } };
    expect(run.status).toBe('imported');
    expect(run.totals.imported).toBe(1);
    expect(stores.get('projects-projects')?.list()).toHaveLength(1);
  });

  it('refuses an import against an unknown or expired plan', async () => {
    await expect(
      handlerFor(IpcChannel.DataPlaneImport)({ planId: 'imp_nope', approvals: [] }),
    ).rejects.toThrow(/no longer available/i);
  });

  it('records history and per-record provenance after an import', async () => {
    const plan = (await handlerFor(IpcChannel.DataPlaneAnalyze)({
      filename: 'p.xlsx',
      contentBase64: b64(workbook),
    })) as { planId: string };
    await handlerFor(IpcChannel.DataPlaneImport)({
      planId: plan.planId,
      approvals: [{ tableName: 'Projects', approved: true }],
    });

    const history = (await handlerFor(IpcChannel.DataPlaneHistory)({})) as { planId: string }[];
    expect(history[0]?.planId).toBe(plan.planId);

    const recordId = stores.get('projects-projects')?.list()[0]?.id ?? '';
    const trace = (await handlerFor(IpcChannel.DataPlaneProvenance)({ recordId })) as {
      sourceFile: string;
      sourceTable: string;
    } | null;
    expect(trace?.sourceFile).toBe('p.xlsx');
    expect(trace?.sourceTable).toBe('Projects');
  });
});

// ---------------------------------------------------------------------------

describe('segregation of duties on high-risk approval', () => {
  const customers = buildXlsx([
    { name: 'Customers', rows: [['Customer Name', 'Email'], ['Acme Ltd', 'a@acme.example']] },
  ]);

  it('requires data:approve to approve a high-risk table, not merely data:import', async () => {
    granted = new Set<EnterprisePermission>(['data:read', 'data:import']); // no data:approve
    sub = build();

    const plan = (await handlerFor(IpcChannel.DataPlaneAnalyze)({
      filename: 'c.xlsx',
      contentBase64: b64(customers),
    })) as { planId: string; tables: { requiresApproval: boolean }[] };
    expect(plan.tables[0]?.requiresApproval).toBe(true);

    await expect(
      handlerFor(IpcChannel.DataPlaneImport)({
        planId: plan.planId,
        approvals: [{ tableName: 'Customers', approved: true }],
      }),
    ).rejects.toThrow(/data:approve/);

    // Nothing was written by the refused approval.
    expect(stores.get('crm-customers')?.list()).toHaveLength(0);
  });

  it('allows the same user to import when they hold data:approve', async () => {
    const plan = (await handlerFor(IpcChannel.DataPlaneAnalyze)({
      filename: 'c.xlsx',
      contentBase64: b64(customers),
    })) as { planId: string };
    const run = (await handlerFor(IpcChannel.DataPlaneImport)({
      planId: plan.planId,
      approvals: [{ tableName: 'Customers', approved: true }],
      reason: 'Verified against the source system',
    })) as { status: string };
    expect(run.status).toBe('imported');
    expect(audit.some((a) => a.action === 'dataplane.import.approved')).toBe(true);
  });

  it('does not demand approve rights when nothing high-risk is approved', async () => {
    granted = new Set<EnterprisePermission>(['data:read', 'data:import']);
    sub = build();
    const plan = (await handlerFor(IpcChannel.DataPlaneAnalyze)({
      filename: 'c.xlsx',
      contentBase64: b64(customers),
    })) as { planId: string };
    const run = (await handlerFor(IpcChannel.DataPlaneImport)({
      planId: plan.planId,
      approvals: [{ tableName: 'Customers', approved: false }],
    })) as { status: string };
    expect(run.status).toBe('nothing_imported');
  });
});

// ---------------------------------------------------------------------------

describe('mapping memory is tenant-isolated', () => {
  const signature = sourceSignature('Customers', ['Cust_Name', 'Cust_Email']);

  it('saves and returns a mapping for the owning tenant', async () => {
    const saved = (await handlerFor(IpcChannel.DataPlaneSaveMapping)({
      signature,
      entityId: 'customer',
      columns: [{ header: 'Cust_Name', fieldKey: 'name' }],
    })) as { version: number; tenantId: string };
    expect(saved.version).toBe(1);
    expect(saved.tenantId).toBe('tenant-a');

    const list = (await handlerFor(IpcChannel.DataPlaneMappings)({})) as unknown[];
    expect(list).toHaveLength(1);
  });

  it('NEVER returns another tenant’s mapping', async () => {
    await handlerFor(IpcChannel.DataPlaneSaveMapping)({
      signature,
      entityId: 'customer',
      columns: [{ header: 'Cust_Name', fieldKey: 'name' }],
    });

    tenant = 'tenant-b';
    const otherTenantView = (await handlerFor(IpcChannel.DataPlaneMappings)({})) as unknown[];
    expect(otherTenantView).toEqual([]);

    const bySignature = (await handlerFor(IpcChannel.DataPlaneMappings)({ signature })) as unknown[];
    expect(bySignature).toEqual([]);
  });

  it('versions a re-saved mapping instead of silently overwriting', async () => {
    await handlerFor(IpcChannel.DataPlaneSaveMapping)({
      signature,
      entityId: 'customer',
      columns: [{ header: 'Cust_Name', fieldKey: 'name' }],
    });
    const second = (await handlerFor(IpcChannel.DataPlaneSaveMapping)({
      signature,
      entityId: 'customer',
      columns: [
        { header: 'Cust_Name', fieldKey: 'name' },
        { header: 'Cust_Email', fieldKey: 'email' },
      ],
    })) as { version: number; columns: unknown[] };
    expect(second.version).toBe(2);
    expect(second.columns).toHaveLength(2);
  });

  it('rejects a mapping to an unknown entity', async () => {
    await expect(
      handlerFor(IpcChannel.DataPlaneSaveMapping)({
        signature,
        entityId: 'not-an-entity',
        columns: [{ header: 'x', fieldKey: 'y' }],
      }),
    ).rejects.toThrow(/Unknown entity/);
  });

  it('forgets a mapping only within the owning tenant', async () => {
    await handlerFor(IpcChannel.DataPlaneSaveMapping)({
      signature,
      entityId: 'customer',
      columns: [{ header: 'Cust_Name', fieldKey: 'name' }],
    });
    tenant = 'tenant-b';
    expect(await handlerFor(IpcChannel.DataPlaneForgetMapping)({ signature })).toEqual({ forgotten: false });
    tenant = 'tenant-a';
    expect(await handlerFor(IpcChannel.DataPlaneForgetMapping)({ signature })).toEqual({ forgotten: true });
  });

  it('produces a stable signature that ignores column order', () => {
    expect(sourceSignature('Customers', ['A', 'B'])).toBe(sourceSignature('Customers', ['B', 'A']));
    expect(sourceSignature('Customers', ['A', 'B'])).not.toBe(sourceSignature('Suppliers', ['A', 'B']));
  });
});

// ---------------------------------------------------------------------------

describe('import lifecycle notification', () => {
  it('emits one event per destination module with a correlation id', async () => {
    const seen: { moduleId: string; recordIds: string[]; correlationId: string }[] = [];
    const onImported = vi.fn((e: { moduleId: string; recordIds: string[]; planId: string; correlationId: string }) => {
      seen.push(e);
    });
    sub = initDataPlane({
      userDataDir: dir,
      storeFor: (moduleId) => stores.get(moduleId) ?? null,
      actor: () => 'reviewer@np.example',
      tenantId: () => tenant,
      now: () => T0,
      audit: (e) => audit.push(e),
      authorize: () => undefined,
      modules: () => descriptors,
      saveExport: async (name) => `/tmp/${name}`,
      onImported,
    });

    const workbook = buildXlsx([
      { name: 'Projects', rows: [['Project Number', 'Project Name'], ['P-1', 'Rollout']] },
    ]);
    const plan = (await handlerFor(IpcChannel.DataPlaneAnalyze)({
      filename: 'p.xlsx',
      contentBase64: b64(workbook),
    })) as { planId: string };
    await handlerFor(IpcChannel.DataPlaneImport)({
      planId: plan.planId,
      approvals: [{ tableName: 'Projects', approved: true }],
    });

    expect(seen).toHaveLength(1);
    expect(seen[0]?.moduleId).toBe('projects-projects');
    expect(seen[0]?.recordIds).toHaveLength(1);
    expect(seen[0]?.correlationId).toContain(plan.planId);
  });

  it('emits nothing when nothing was imported', async () => {
    const onImported = vi.fn();
    sub = initDataPlane({
      userDataDir: dir,
      storeFor: (moduleId) => stores.get(moduleId) ?? null,
      actor: () => null,
      tenantId: () => tenant,
      now: () => T0,
      audit: (e) => audit.push(e),
      authorize: () => undefined,
      modules: () => descriptors,
      saveExport: async (name) => `/tmp/${name}`,
      onImported,
    });
    const workbook = buildXlsx([
      { name: 'Customers', rows: [['Customer Name', 'Email'], ['Acme', 'a@acme.example']] },
    ]);
    const plan = (await handlerFor(IpcChannel.DataPlaneAnalyze)({
      filename: 'c.xlsx',
      contentBase64: b64(workbook),
    })) as { planId: string };
    await handlerFor(IpcChannel.DataPlaneImport)({ planId: plan.planId, approvals: [] });
    expect(onImported).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------

describe('export', () => {
  async function seedCustomers(): Promise<void> {
    const store = stores.get('crm-customers');
    if (!store) throw new Error('missing store');
    await store.load();
    store.create({ title: 'Acme', fields: { name: 'Acme', email: 'a@acme.example' }, actor: 'tester', now: T0 });
    store.create({ title: 'Globex', fields: { name: 'Globex', email: 'g@globex.example' }, actor: 'tester', now: T0 });
    // The store persists asynchronously; flush so the temp dir is not removed
    // out from under a pending write when the test ends.
    await store.flush();
  }

  it('lists only modules that actually hold records', async () => {
    await seedCustomers();
    const list = (await handlerFor(IpcChannel.DataPlaneExportable)({})) as { moduleId: string; recordCount: number }[];
    expect(list.map((m) => m.moduleId)).toEqual(['crm-customers']);
    expect(list[0]?.recordCount).toBe(2);
  });

  it('reports how many of those records came from an import, not just the total', async () => {
    await seedCustomers();
    const before = (await handlerFor(IpcChannel.DataPlaneExportable)({})) as { importedCount: number }[];
    expect(before[0]?.importedCount).toBe(0);

    const workbook = buildXlsx([
      { name: 'Customers', rows: [['Customer Name', 'Email'], ['Initech', 'i@initech.example']] },
    ]);
    const plan = (await handlerFor(IpcChannel.DataPlaneAnalyze)({
      filename: 'c.xlsx',
      contentBase64: b64(workbook),
    })) as { planId: string };
    await handlerFor(IpcChannel.DataPlaneImport)({
      planId: plan.planId,
      approvals: [{ tableName: 'Customers', approved: true }],
    });

    const after = (await handlerFor(IpcChannel.DataPlaneExportable)({})) as
      { recordCount: number; importedCount: number }[];
    expect(after[0]?.recordCount).toBe(3);
    expect(after[0]?.importedCount).toBe(1);
  });

  it('writes the file and reports exactly what was written', async () => {
    await seedCustomers();
    const res = (await handlerFor(IpcChannel.DataPlaneExport)({
      moduleId: 'crm-customers',
      format: 'csv',
    })) as { records: number; filePath: string | null; cancelled: boolean };
    expect(res.cancelled).toBe(false);
    expect(res.records).toBe(2);
    expect(res.filePath).toContain('customers-2026-08-08.csv');
    expect(saved[0]?.bytes).toBeGreaterThan(0);
  });

  it('treats a dismissed save dialog as a cancellation, not a failure', async () => {
    await seedCustomers();
    saveCancelled = true;
    const res = (await handlerFor(IpcChannel.DataPlaneExport)({
      moduleId: 'crm-customers',
      format: 'xlsx',
    })) as { cancelled: boolean; filePath: string | null; records: number };
    expect(res.cancelled).toBe(true);
    expect(res.filePath).toBeNull();
    expect(res.records).toBe(0);
    // A cancelled export is not an event worth recording as an extraction.
    expect(audit.some((a) => a.action === 'dataplane.export')).toBe(false);
  });

  it('audits a completed export as the extraction it is', async () => {
    await seedCustomers();
    await handlerFor(IpcChannel.DataPlaneExport)({ moduleId: 'crm-customers', format: 'json' });
    const entry = audit.find((a) => a.action === 'dataplane.export');
    expect(entry?.target).toBe('crm-customers');
    expect(entry?.summary).toContain('2 Customers');
  });

  it('refuses a module the actor may not READ, even with data:read granted', async () => {
    await seedCustomers();
    granted = new Set<EnterprisePermission>(['data:read']); // no crm:read
    await expect(
      handlerFor(IpcChannel.DataPlaneExport)({ moduleId: 'crm-customers', format: 'csv' }),
    ).rejects.toThrow(/crm:read/);
  });

  it('refuses an unknown module rather than writing an empty file', async () => {
    await expect(
      handlerFor(IpcChannel.DataPlaneExport)({ moduleId: 'not-a-module', format: 'csv' }),
    ).rejects.toThrow(/Unknown module/);
  });

  it('adds source columns only when provenance is requested', async () => {
    await seedCustomers();
    const plain = (await handlerFor(IpcChannel.DataPlaneExport)({
      moduleId: 'crm-customers',
      format: 'csv',
    })) as { columns: number };
    const traced = (await handlerFor(IpcChannel.DataPlaneExport)({
      moduleId: 'crm-customers',
      format: 'csv',
      includeProvenance: true,
    })) as { columns: number };
    expect(plain.columns).toBe(2);
    expect(traced.columns).toBe(6);
  });
});
