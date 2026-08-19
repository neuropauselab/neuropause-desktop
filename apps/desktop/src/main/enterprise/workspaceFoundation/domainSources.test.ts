import { describe, it, expect, vi } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { TenantScope } from '@neuropause/shared';

vi.mock('electron', () => ({ app: { getPath: () => '/tmp' } }));

import { EnterpriseRecordStore } from '../framework/enterpriseRecordStore';
import { TEST_TENANT_SCOPE } from '../../tenancy/testScope';
import { workspaceDomainSnapshot } from './domainSources';

// The store persists asynchronously (debounced, fail-quiet); leave the temp dir in
// place (OS-cleaned) rather than remove it mid-write. count() reads in memory.
const store = (moduleId: string, kind: string, scope: () => TenantScope | null): EnterpriseRecordStore =>
  new EnterpriseRecordStore(join(mkdtempSync(join(tmpdir(), 'np-wf-')), 'store.json'), moduleId, kind).bindScope(scope);

const other: TenantScope = { ...TEST_TENANT_SCOPE, tenantId: 'other-tenant', workspaceId: 'other-ws' } as TenantScope;

describe('WF Slice 1 · LIVE WIRING — re-proven against REAL EnterpriseRecordStores', () => {
  it('VERIFICATION + UNAVAILABLE — each domain count equals its real scoped store.count(); a missing module is UNAVAILABLE', () => {
    const people = store('hr-employees', 'employee', () => TEST_TENANT_SCOPE);
    const cust = store('crm-customers', 'customer', () => TEST_TENANT_SCOPE);
    people.create({ title: 'Alice', fields: {} });
    people.create({ title: 'Bob', fields: {} });
    people.create({ title: 'Carol', fields: {} });
    cust.create({ title: 'Acme', fields: {} });
    const stores: Record<string, EnterpriseRecordStore> = { 'hr-employees': people, 'crm-customers': cust };

    const snap = workspaceDomainSnapshot({ moduleStore: (id) => stores[id] ?? null, scope: () => TEST_TENANT_SCOPE, now: () => 'x' });
    const by = Object.fromEntries(snap.slices.map((s) => [s.moduleId, s]));
    expect(by['hr-employees']).toMatchObject({ state: 'present', count: people.count() });
    expect(by['hr-employees'].count).toBe(3); // faithful to the REAL store
    expect(by['crm-customers']).toMatchObject({ state: 'present', count: 1 });
    // 'projects'/'leads'/'opportunities'/'documents' have no store here → UNAVAILABLE, not a fabricated 0.
    expect(by['projects']).toMatchObject({ state: 'unavailable', count: 0 });
    expect(by['documents']).toMatchObject({ state: 'unavailable' });
  });

  it('COLLECTION BOUNDARY — tenant-isolated: records created under another scope never count', () => {
    let scope: TenantScope = TEST_TENANT_SCOPE;
    const people = store('hr-employees', 'employee', () => scope);
    people.create({ title: 'MineA', fields: {} }); // stamped with TEST_TENANT_SCOPE
    scope = other; // now the store resolves to a DIFFERENT tenant
    people.create({ title: 'TheirsB', fields: {} }); // stamped with other-tenant
    scope = TEST_TENANT_SCOPE; // read back as the original tenant

    const snap = workspaceDomainSnapshot({ moduleStore: () => people, scope: () => scope, now: () => 'x' });
    const people1 = snap.slices.find((s) => s.moduleId === 'hr-employees');
    expect(people1?.count).toBe(1); // only the original tenant's record — the other tenant's is invisible
    expect(people1?.count).toBe(people.count());
  });

  it('FAILURE/UNKNOWN — no scope → whole snapshot UNKNOWN even with a real populated store', () => {
    const people = store('hr-employees', 'employee', () => TEST_TENANT_SCOPE);
    people.create({ title: 'Alice', fields: {} });
    const snap = workspaceDomainSnapshot({ moduleStore: () => people, scope: () => null, now: () => 'x' });
    expect(snap.scopeResolved).toBe(false);
    expect(snap.slices).toEqual([]); // never "all data"
  });

  it('CAPABILITY CONTRACT — READ-only: composing the snapshot writes nothing to the real store', () => {
    const people = store('hr-employees', 'employee', () => TEST_TENANT_SCOPE);
    people.create({ title: 'Alice', fields: {} });
    const before = people.count();
    workspaceDomainSnapshot({ moduleStore: () => people, scope: () => TEST_TENANT_SCOPE, now: () => 'x' });
    expect(people.count()).toBe(before); // aggregate performed no write
  });
});
