/**
 * Phase 7.2 — Family Dashboard model tests. These lock the honesty contract:
 * every widget is derived from real records (createdAt buckets, descriptor
 * status options, verified accent fields), deleted records never count, and
 * a family with no records reports hasRecords=false instead of inventing data.
 */
import { describe, expect, it } from 'vitest';
import type { EnterpriseEntity, EnterpriseFieldValue, EnterpriseModuleSummary } from '@neuropause/shared';
import {
  buildFamilyDashboard,
  countByMonth,
  countByStatusOptions,
  lastMonths,
  statusFieldOf,
} from './familyDashboardModel';

const NOW = '2026-08-07T12:00:00.000Z';

function ent(
  id: string,
  moduleId: string,
  fields: Record<string, EnterpriseFieldValue>,
  opts: { createdAt?: string; status?: string } = {},
): EnterpriseEntity {
  return {
    id,
    moduleId,
    kind: 'k',
    title: id,
    status: (opts.status ?? 'active') as EnterpriseEntity['status'],
    fields,
    tags: [],
    rev: 1,
    createdAt: opts.createdAt ?? NOW,
    updatedAt: opts.createdAt ?? NOW,
    createdBy: null,
    updatedBy: null,
    metadata: {},
  };
}

function mod(id: string, title: string, fields: EnterpriseModuleSummary['fields'] = []): EnterpriseModuleSummary {
  return {
    id,
    title,
    singular: title,
    plural: `${title}s`,
    icon: 'grid',
    description: '',
    group: 'X',
    fields,
    titleField: 'name',
    permissions: { read: 'operations:read', write: 'operations:manage' },
    actions: [],
    recordCount: 0,
    activeCount: 0,
    aiSummary: false,
  };
}

const STATUS_FIELD = {
  key: 'status',
  label: 'Status',
  type: 'select' as const,
  options: [
    { value: 'draft', label: 'Draft', tone: 'neutral' },
    { value: 'approved', label: 'Approved', tone: 'green' },
  ],
};

describe('time buckets', () => {
  it('lastMonths spans calendar months oldest-first, across year boundaries', () => {
    const months = lastMonths(3, '2026-01-15T00:00:00.000Z');
    expect(months.map((m) => m.key)).toEqual(['2025-11', '2025-12', '2026-01']);
    expect(months.map((m) => m.label)).toEqual(['Nov', 'Dec', 'Jan']);
  });

  it('countByMonth buckets by real createdAt, ignores out-of-window and deleted records', () => {
    const rows = countByMonth(
      [
        ent('a', 'm', {}, { createdAt: '2026-08-01T00:00:00.000Z' }),
        ent('b', 'm', {}, { createdAt: '2026-07-30T00:00:00.000Z' }),
        ent('c', 'm', {}, { createdAt: '2020-01-01T00:00:00.000Z' }), // out of window
        ent('d', 'm', {}, { createdAt: '2026-08-02T00:00:00.000Z', status: 'deleted' }),
      ],
      3,
      NOW,
    );
    expect(rows).toEqual([
      { month: 'Jun', count: 0 },
      { month: 'Jul', count: 1 },
      { month: 'Aug', count: 1 },
    ]);
  });
});

describe('descriptor-driven status', () => {
  it('counts by the field’s OWN options with labels + tones; empty options drop out', () => {
    const slices = countByStatusOptions(
      [
        ent('a', 'm', { status: 'approved' }),
        ent('b', 'm', { status: 'approved' }),
        ent('c', 'm', { status: 'weird' }), // not a declared option — never invented
      ],
      STATUS_FIELD,
    );
    expect(slices).toEqual([{ name: 'Approved', tone: 'green', value: 2 }]);
  });

  it('statusFieldOf prefers the "status" select and returns null when none exists', () => {
    expect(statusFieldOf(mod('m1', 'M1', [STATUS_FIELD]))?.key).toBe('status');
    expect(statusFieldOf(mod('m2', 'M2', [{ key: 'name', label: 'Name', type: 'text' }]))).toBeNull();
  });
});

describe('buildFamilyDashboard', () => {
  it('a family with no records is honestly empty — no invented widgets', () => {
    const data = buildFamilyDashboard('Sales', [mod('sales-orders', 'Orders', [STATUS_FIELD])], new Map(), NOW);
    expect(data.hasRecords).toBe(false);
    expect(data.statusDonut).toBeNull();
    expect(data.moduleBars).toEqual([]);
    expect(data.creationTrend.every((r) => r.count === 0)).toBe(true);
  });

  it('Finance binds the LATEST treasury statement’s derived position as KPIs', () => {
    const records = new Map([
      [
        'finance-treasury-positions',
        [
          ent('t1', 'finance-treasury-positions', { cashBalance: 500, receivablesOutstanding: 200, payablesOutstanding: 100, netPosition: 600, asOfDate: '2026-08-01' }, { createdAt: '2026-08-01T00:00:00.000Z' }),
          ent('t0', 'finance-treasury-positions', { cashBalance: 1, receivablesOutstanding: 1, payablesOutstanding: 1, netPosition: 1, asOfDate: '2026-07-01' }, { createdAt: '2026-07-01T00:00:00.000Z' }),
        ],
      ],
    ]);
    const data = buildFamilyDashboard('Finance', [mod('finance-treasury-positions', 'Treasury')], records, NOW);
    expect(data.kpis[0]).toEqual({ label: 'Cash', value: '500', hint: 'as of 2026-08-01' });
    expect(data.kpis[3].label).toBe('Net position');
    expect(data.kpis[3].value).toBe('600');
  });

  it('Inventory surfaces products at/below their own reorder level, worst first', () => {
    const records = new Map([
      [
        'inventory-products',
        [
          ent('p1', 'inventory-products', { name: 'Widget', availableStock: 2, reorderLevel: 10 }),
          ent('p2', 'inventory-products', { name: 'Gadget', availableStock: 50, reorderLevel: 10 }), // healthy
          ent('p3', 'inventory-products', { name: 'Gizmo', availableStock: 0, reorderLevel: 5 }),
          ent('p4', 'inventory-products', { name: 'NoPolicy', availableStock: 0, reorderLevel: 0 }), // no reorder policy
        ],
      ],
    ]);
    const data = buildFamilyDashboard('Inventory', [mod('inventory-products', 'Products')], records, NOW);
    expect(data.lowStock?.map((p) => p.name)).toEqual(['Gizmo', 'Widget']);
    expect(data.kpis[0]).toEqual({ label: 'Low stock', value: '2', hint: 'at/below reorder level' });
  });

  it('HR counts active headcount by department; exited employees never count', () => {
    const records = new Map([
      [
        'hr-employees',
        [
          ent('e1', 'hr-employees', { name: 'A', department: 'R&D' }),
          ent('e2', 'hr-employees', { name: 'B', department: 'R&D' }),
          ent('e3', 'hr-employees', { name: 'C', department: 'Sales' }),
          ent('e4', 'hr-employees', { name: 'D', department: 'R&D', exitedAt: NOW }),
        ],
      ],
    ]);
    const data = buildFamilyDashboard('HR', [mod('hr-employees', 'Employees')], records, NOW);
    expect(data.headcountByDept).toEqual([
      { name: 'R&D', active: 2 },
      { name: 'Sales', active: 1 },
    ]);
    expect(data.kpis[0]).toEqual({ label: 'Headcount', value: '3', hint: '1 exited' });
  });

  it('Procurement counts active contracts expiring inside 60 days (window-derived, never stored)', () => {
    const records = new Map([
      [
        'procurement-vendor-contracts',
        [
          ent('c1', 'procurement-vendor-contracts', { status: 'active', endDate: '2026-08-20' }), // 13 days
          ent('c2', 'procurement-vendor-contracts', { status: 'active', endDate: '2027-08-01' }), // far
          ent('c3', 'procurement-vendor-contracts', { status: 'draft', endDate: '2026-08-20' }), // not in force
          ent('c4', 'procurement-vendor-contracts', { status: 'active', endDate: '2026-01-01' }), // already expired
        ],
      ],
    ]);
    const data = buildFamilyDashboard(
      'Procurement',
      [mod('procurement-vendor-contracts', 'Vendor Contracts')],
      records,
      NOW,
    );
    expect(data.expiringContracts).toBe(1);
  });

  it('status donut reads the busiest module’s own select options', () => {
    const m1 = mod('m1', 'Small', [STATUS_FIELD]);
    const m2 = mod('m2', 'Busy', [STATUS_FIELD]);
    const records = new Map([
      ['m1', [ent('a', 'm1', { status: 'draft' })]],
      ['m2', [ent('b', 'm2', { status: 'approved' }), ent('c', 'm2', { status: 'draft' })]],
    ]);
    const data = buildFamilyDashboard('Sales', [m1, m2], records, NOW);
    expect(data.statusDonut?.title).toBe('Busy by status');
    expect(data.statusDonut?.slices.map((s) => s.name).sort()).toEqual(['Approved', 'Draft']);
    expect(data.moduleBars[0]).toEqual({ name: 'Busy', active: 2 });
  });
});
