/**
 * EBS v1.0 — Business Workspace model tests. These lock the authenticity + reuse contract of the presentation
 * layer: families are derived purely from the modules' real `descriptor.group`, only families that actually
 * have modules appear (roadmap-only families like Quality never render as empty rooms), counts are
 * honest sums of the registry summaries, and the Finance RBAC caveat (operations:*, not finance:*) is recorded.
 */
import { describe, expect, it } from 'vitest';
import type { EnterpriseModuleSummary } from '@neuropause/shared';
import {
  BUSINESS_FAMILIES,
  groupModulesByFamily,
  familyModuleIds,
  findFamilyForModule,
  totalBusinessRecords,
} from './businessModel';

function mod(
  id: string,
  group: string | undefined,
  opts: { recordCount?: number; activeCount?: number; aiSummary?: boolean } = {},
): EnterpriseModuleSummary {
  return {
    id,
    title: id,
    singular: id,
    plural: `${id}s`,
    icon: 'grid',
    description: '',
    group,
    fields: [{ key: 'name', label: 'Name', type: 'text' }],
    titleField: 'name',
    permissions: { read: 'crm:read', write: 'crm:manage' },
    actions: [],
    recordCount: opts.recordCount ?? 0,
    activeCount: opts.activeCount ?? 0,
    aiSummary: opts.aiSummary ?? false,
  };
}

describe('BUSINESS_FAMILIES — the honest family set', () => {
  // Phase 7: HR, Projects, Helpdesk and Documents modules registered during the
  // Final Wave, so the family set grew from nine to thirteen. Quality remains
  // the one roadmap family with no module carrying its group.
  it('lists exactly the thirteen real families, in canonical order, and never Quality', () => {
    const groups = BUSINESS_FAMILIES.map((f) => f.group);
    expect(groups).toEqual([
      'Finance', 'Sales', 'CRM', 'Procurement', 'Inventory', 'Warehouse', 'Manufacturing', 'Maintenance',
      'HR', 'Projects', 'Helpdesk', 'Documents', 'Executive',
    ]);
    expect(groups).not.toContain('Quality');
  });

  it('records the Finance RBAC caveat truthfully (operations:*, not finance:*)', () => {
    const finance = BUSINESS_FAMILIES.find((f) => f.group === 'Finance')!;
    expect(finance.permission).toBe('operations:manage');
    // Every family carries a real, non-empty display permission and a valid icon/label.
    for (const f of BUSINESS_FAMILIES) {
      expect(f.permission.length).toBeGreaterThan(0);
      expect(f.label.length).toBeGreaterThan(0);
      expect(f.group.length).toBeGreaterThan(0);
    }
  });
});

describe('groupModulesByFamily', () => {
  it('groups modules by descriptor.group and preserves the canonical family order', () => {
    const modules = [
      mod('crm', 'CRM'),
      mod('finance', 'Finance'),
      mod('sales-orders', 'Sales'),
    ];
    const groups = groupModulesByFamily(modules);
    expect(groups.map((g) => g.meta.group)).toEqual(['Finance', 'Sales', 'CRM']);
  });

  it('only returns families that actually have modules — absent families never appear', () => {
    const groups = groupModulesByFamily([mod('finance', 'Finance'), mod('crm', 'CRM')]);
    expect(groups).toHaveLength(2);
    expect(groups.map((g) => g.meta.group)).toEqual(['Finance', 'CRM']);
    // No empty room for roadmap families:
    expect(groups.some((g) => ['Quality', 'HR', 'Projects'].includes(g.meta.group))).toBe(false);
  });

  it('sums record/active counts and detects AI across a family', () => {
    const groups = groupModulesByFamily([
      mod('finance', 'Finance', { recordCount: 10, activeCount: 7, aiSummary: true }),
      mod('finance-payments', 'Finance', { recordCount: 5, activeCount: 2, aiSummary: false }),
    ]);
    expect(groups).toHaveLength(1);
    const finance = groups[0];
    expect(finance.recordCount).toBe(15);
    expect(finance.activeCount).toBe(9);
    expect(finance.hasAi).toBe(true);
    expect(finance.modules).toHaveLength(2);
  });

  it('skips modules with no group (they are not business-family modules)', () => {
    const groups = groupModulesByFamily([mod('finance', 'Finance'), mod('loose', undefined), mod('blank', '   ')]);
    expect(groups).toHaveLength(1);
    expect(groups[0].meta.group).toBe('Finance');
  });

  it('appends unknown groups after the known families (future-proof, alphabetical)', () => {
    const groups = groupModulesByFamily([
      mod('zeta', 'Zeta'),
      mod('finance', 'Finance'),
      mod('alpha', 'Alpha'),
    ]);
    // Known family first, then unknown groups alphabetically.
    expect(groups.map((g) => g.meta.group)).toEqual(['Finance', 'Alpha', 'Zeta']);
  });

  it('orders modules within a family deterministically by title', () => {
    const groups = groupModulesByFamily([
      mod('crm-zeta', 'CRM'),
      mod('crm-alpha', 'CRM'),
    ]);
    expect(groups[0].modules.map((m) => m.id)).toEqual(['crm-alpha', 'crm-zeta']);
  });
});

describe('helpers', () => {
  const groups = groupModulesByFamily([
    mod('finance', 'Finance', { recordCount: 4 }),
    mod('crm', 'CRM', { recordCount: 6 }),
    mod('crm-leads', 'CRM', { recordCount: 2 }),
  ]);

  it('familyModuleIds returns the family module ids', () => {
    const crm = groups.find((g) => g.meta.group === 'CRM')!;
    expect(familyModuleIds(crm).sort()).toEqual(['crm', 'crm-leads']);
  });

  it('findFamilyForModule resolves a module to its family, or null', () => {
    expect(findFamilyForModule(groups, 'crm-leads')?.meta.group).toBe('CRM');
    expect(findFamilyForModule(groups, 'finance')?.meta.group).toBe('Finance');
    expect(findFamilyForModule(groups, 'does-not-exist')).toBeNull();
  });

  it('totalBusinessRecords sums record counts across every family', () => {
    expect(totalBusinessRecords(groups)).toBe(12);
  });
});
