import { describe, it, expect } from 'vitest';
import type { TenantScope } from '@neuropause/shared';
import { composeWorkspaceDomain, type DomainModuleSpec, type WorkspaceDomainSources } from './domainAggregate';

const SPECS: DomainModuleSpec[] = [
  { domain: 'people', moduleId: 'hr-employees', label: 'People' },
  { domain: 'customers', moduleId: 'crm-customers', label: 'Customers' },
  { domain: 'projects', moduleId: 'projects', label: 'Projects' },
  { domain: 'documents', moduleId: 'documents', label: 'Documents' },
];

const scopeA = { tenantId: 'tenant-A' } as TenantScope;

/** Build sources with a fixed per-module count map (null = the store is absent). */
const sources = (
  scope: TenantScope | null,
  counts: Record<string, number | null>,
): WorkspaceDomainSources => ({
  scope: () => scope,
  moduleCount: (id) => (id in counts ? counts[id] : null),
  now: () => '2026-08-19T00:00:00.000Z',
});

describe('Workspace Foundation · Slice 1 · the domain aggregate (observable object)', () => {
  it('VERIFICATION — each slice is a FAITHFUL scoped count of its store (computes no new number)', () => {
    const counts = { 'hr-employees': 12, 'crm-customers': 7, projects: 3, documents: 41 };
    const snap = composeWorkspaceDomain(SPECS, sources(scopeA, counts));
    expect(snap.scopeResolved).toBe(true);
    expect(snap.tenantId).toBe('tenant-A');
    for (const s of snap.slices) {
      expect(s.state).toBe('present');
      expect(s.count).toBe(counts[s.moduleId]); // exactly the store's scoped count — no recomputation
    }
  });

  it('FAILURE/UNKNOWN — no tenant scope → the WHOLE snapshot is UNKNOWN (empty), never "all data"', () => {
    const snap = composeWorkspaceDomain(SPECS, sources(null, { 'hr-employees': 999 }));
    expect(snap.scopeResolved).toBe(false);
    expect(snap.tenantId).toBeNull();
    expect(snap.slices).toEqual([]); // never enumerates everything when scope is unresolved
  });

  it('FAILURE/UNKNOWN — an absent store is UNAVAILABLE, DISTINCT from present-but-empty', () => {
    // documents present-but-empty (0); projects store ABSENT (null → unavailable).
    const snap = composeWorkspaceDomain(SPECS, sources(scopeA, { 'hr-employees': 5, 'crm-customers': 0, documents: 0 }));
    const bySid = Object.fromEntries(snap.slices.map((s) => [s.moduleId, s]));
    expect(bySid['crm-customers']).toMatchObject({ state: 'present', count: 0 }); // empty, but present
    expect(bySid['documents']).toMatchObject({ state: 'present', count: 0 });
    expect(bySid['projects']).toMatchObject({ state: 'unavailable', count: 0 }); // absent, NOT a fabricated 0
    expect(bySid['hr-employees']).toMatchObject({ state: 'present', count: 5 });
  });

  it('COLLECTION BOUNDARY — the snapshot reflects ONLY the scoped counts it is given (tenant-isolated)', () => {
    // The scope determines which store reads are performed; a different tenant's
    // counts produce a different snapshot. The function never merges across tenants.
    const a = composeWorkspaceDomain(SPECS, sources(scopeA, { 'hr-employees': 12, 'crm-customers': 7, projects: 3, documents: 41 }));
    const scopeB = { tenantId: 'tenant-B' } as TenantScope;
    const b = composeWorkspaceDomain(SPECS, sources(scopeB, { 'hr-employees': 1, 'crm-customers': 0, projects: 0, documents: 0 }));
    expect(a.tenantId).toBe('tenant-A');
    expect(b.tenantId).toBe('tenant-B');
    expect(a.slices.find((s) => s.moduleId === 'hr-employees')?.count).toBe(12);
    expect(b.slices.find((s) => s.moduleId === 'hr-employees')?.count).toBe(1); // B never sees A's rows
  });

  it('CAPABILITY CONTRACT — READ/aggregate only: it mutates neither the specs nor the sources', () => {
    const specsCopy = SPECS.map((s) => ({ ...s }));
    const counts = { 'hr-employees': 2, 'crm-customers': 2, projects: 2, documents: 2 };
    const countsCopy = { ...counts };
    composeWorkspaceDomain(SPECS, sources(scopeA, counts));
    expect(SPECS).toEqual(specsCopy); // no in-place mutation of the domain spec
    expect(counts).toEqual(countsCopy); // no write-back through the sources
  });
});
