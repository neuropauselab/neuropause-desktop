/**
 * Enterprise Business Suite (EBS) v1.0 — the Business Workspace model (pure data; no React, no I/O; tested).
 *
 * The Business Workspace is a PRESENTATION LAYER over the existing enterprise module framework. It creates
 * no runtime, no store, no IPC and no modules — every family below is a *grouping* of modules that are
 * already registered on the framework (`apps/desktop/src/main/enterprise`), reached through the existing
 * generic `enterprise:module.*` IPC. This file only decides how the already-real modules are grouped,
 * ordered, labelled, and counted for display.
 *
 * AUTHENTICITY: a family appears here ONLY when at least one real module carries its `descriptor.group`
 * label. Quality is the one roadmap family still absent (it lives today only as the `manufacturing-quality`
 * module inside Manufacturing) — it stays out until a module carries the group, recorded in the Capability
 * Registry as `future-release` instead of rendering as an empty room.
 */
import type { EnterpriseModuleSummary } from '@neuropause/shared';
import type { IconName } from '@renderer/components/ui/Icon';

/** Display metadata for one business family. `group` matches the modules' exact `descriptor.group` string. */
export interface BusinessFamilyMeta {
  /** The exact `descriptor.group` value this family collects (e.g. 'Finance'). */
  group: string;
  label: string;
  icon: IconName;
  blurb: string;
  /**
   * The REAL RBAC scope the family's modules enforce (for honest display only — the gate is applied in the
   * main process, not here). Finance intentionally reads `operations:*`, not `finance:*` — recorded truthfully.
   */
  permission: string;
}

/**
 * The canonical family order shown in the Business Workspace rail. Every entry here is backed by ≥1 real
 * registered module (verified from source). Phase 7 (Product Experience): HR (15 modules — employees through
 * payroll, attendance, leave, recruitment, OKRs), Projects (4), Helpdesk (1) and Documents (1) joined the
 * registry during the Final Wave; their fall-through to generic fallback metadata was registry drift, fixed
 * here. Quality remains the one roadmap family with no module carrying its group.
 */
export const BUSINESS_FAMILIES: BusinessFamilyMeta[] = [
  { group: 'Finance', label: 'Finance', icon: 'grid', blurb: 'Invoices, payments and receivables.', permission: 'operations:manage' },
  { group: 'Sales', label: 'Sales', icon: 'store', blurb: 'Quotes and sales orders.', permission: 'sales:manage' },
  { group: 'CRM', label: 'CRM', icon: 'user', blurb: 'Contacts, leads and customers.', permission: 'crm:manage' },
  { group: 'Procurement', label: 'Procurement', icon: 'clipboard', blurb: 'Suppliers, requests, purchase orders and receipts.', permission: 'procurement:manage' },
  { group: 'Inventory', label: 'Inventory', icon: 'package', blurb: 'Products, warehouses and stock movements.', permission: 'inventory:manage' },
  { group: 'Warehouse', label: 'Warehouse', icon: 'layers', blurb: 'Zones, bins, picking, packing and shipping.', permission: 'warehouse:manage' },
  { group: 'Manufacturing', label: 'Manufacturing', icon: 'cpu', blurb: 'BOMs, work orders, scheduling and execution.', permission: 'manufacturing:manage' },
  { group: 'Maintenance', label: 'Maintenance', icon: 'pulse', blurb: 'Assets, work orders and preventive plans.', permission: 'maintenance:manage' },
  // HR intentionally reads `operations:*` (the Finance/Projects reuse precedent) — recorded truthfully.
  { group: 'HR', label: 'HR & Payroll', icon: 'user', blurb: 'Employees, attendance, leave, payroll, recruitment and OKRs.', permission: 'operations:manage' },
  { group: 'Projects', label: 'Projects', icon: 'checklist', blurb: 'Projects, tasks, time entries and billing runs.', permission: 'operations:manage' },
  { group: 'Helpdesk', label: 'Helpdesk', icon: 'bell', blurb: 'Support tickets and service requests.', permission: 'operations:manage' },
  { group: 'Documents', label: 'Documents', icon: 'doc', blurb: 'Controlled business documents.', permission: 'operations:manage' },
  // Executive is a mixed-scope family: decisions enforce executive:approve, execution proposals executive:execute.
  { group: 'Executive', label: 'Executive', icon: 'sparkles', blurb: 'Decisions and execution proposals.', permission: 'executive:approve / execute' },
];

/**
 * Business Workspace favorites reuse the EXISTING shared personalization store (no new store). They are
 * scoped with this id prefix + kind so the command palette can route them back into the Business Workspace
 * (rather than the Enterprise view). These constants are the one contract shared by the writer (the family
 * section) and the reader (the command palette) — kept here so the two can never drift.
 */
export const BUSINESS_FAVORITE_KIND = 'business-module';
const BUSINESS_FAVORITE_PREFIX = 'business:';
export const businessFavoriteId = (moduleId: string): string => `${BUSINESS_FAVORITE_PREFIX}${moduleId}`;
export const moduleIdFromBusinessFavorite = (id: string): string =>
  id.startsWith(BUSINESS_FAVORITE_PREFIX) ? id.slice(BUSINESS_FAVORITE_PREFIX.length) : id;

const FAMILY_BY_GROUP = new Map<string, BusinessFamilyMeta>(BUSINESS_FAMILIES.map((f) => [f.group, f]));
const FAMILY_ORDER = new Map<string, number>(BUSINESS_FAMILIES.map((f, i) => [f.group, i]));

/** One family, resolved against the live module registry: its metadata, its real modules, and honest counts. */
export interface BusinessFamilyGroup {
  meta: BusinessFamilyMeta;
  modules: EnterpriseModuleSummary[];
  /** Total records across the family's modules (real, summed from the registry summaries). */
  recordCount: number;
  /** Active (non-archived) records across the family's modules. */
  activeCount: number;
  /** True when at least one module in the family exposes a real per-record AI summary. */
  hasAi: boolean;
}

/** Fallback metadata for a module whose `group` is not one of the known families (keeps the view honest & future-proof). */
function fallbackMeta(group: string): BusinessFamilyMeta {
  return { group, label: group, icon: 'grid', blurb: 'Business records.', permission: '—' };
}

/**
 * Group the live module summaries into business families. Only families that actually have modules are
 * returned, in the canonical order above; any module whose group is not a known family is grouped under its
 * own raw group label and appended after the known families (so a newly-registered family surfaces at once).
 * A module with no `group` is skipped — it is not a business-family module.
 */
export function groupModulesByFamily(modules: EnterpriseModuleSummary[]): BusinessFamilyGroup[] {
  const byGroup = new Map<string, EnterpriseModuleSummary[]>();
  for (const m of modules) {
    const g = (m.group ?? '').trim();
    if (!g) continue;
    const list = byGroup.get(g);
    if (list) list.push(m);
    else byGroup.set(g, [m]);
  }

  const groups: BusinessFamilyGroup[] = [];
  for (const [group, mods] of byGroup) {
    const meta = FAMILY_BY_GROUP.get(group) ?? fallbackMeta(group);
    const recordCount = mods.reduce((sum, m) => sum + (m.recordCount ?? 0), 0);
    const activeCount = mods.reduce((sum, m) => sum + (m.activeCount ?? 0), 0);
    const hasAi = mods.some((m) => m.aiSummary === true);
    // Preserve descriptor order within a family, but keep it stable/deterministic by title.
    const orderedModules = [...mods].sort((a, b) => a.title.localeCompare(b.title));
    groups.push({ meta, modules: orderedModules, recordCount, activeCount, hasAi });
  }

  return groups.sort((a, b) => {
    const ai = FAMILY_ORDER.has(a.meta.group) ? FAMILY_ORDER.get(a.meta.group)! : Number.MAX_SAFE_INTEGER;
    const bi = FAMILY_ORDER.has(b.meta.group) ? FAMILY_ORDER.get(b.meta.group)! : Number.MAX_SAFE_INTEGER;
    if (ai !== bi) return ai - bi;
    return a.meta.label.localeCompare(b.meta.label); // unknown families: alphabetical, after the known ones
  });
}

/** The set of module ids belonging to a family — the key used to scope timeline/activity/search to the family. */
export function familyModuleIds(family: BusinessFamilyGroup): string[] {
  return family.modules.map((m) => m.id);
}

/** Find the family that owns a given module id (used to resolve a deep-link into the workspace). */
export function findFamilyForModule(
  groups: BusinessFamilyGroup[],
  moduleId: string,
): BusinessFamilyGroup | null {
  return groups.find((g) => g.modules.some((m) => m.id === moduleId)) ?? null;
}

/** Total real record count across every business family (the workspace-level KPI). */
export function totalBusinessRecords(groups: BusinessFamilyGroup[]): number {
  return groups.reduce((sum, g) => sum + g.recordCount, 0);
}
