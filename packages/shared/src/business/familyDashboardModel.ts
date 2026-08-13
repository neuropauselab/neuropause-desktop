/**
 * Family Dashboard model (Phase 7.2; lifted renderer → shared in Mobile M1-01).
 * Pure data; no React, no I/O, no Node — portable to the desktop renderer, the
 * main-process Companion Gateway, and the mobile app alike. Tested from
 * apps/desktop (release gate): renderer/src/business/familyDashboardModel.test.ts.
 *
 * Turns a family's LIVE module records (fetched through the existing generic
 * `enterprise:module.*` IPC) into dashboard widgets. Everything here is
 * derived from real records and real descriptors:
 *
 *  • Trends bucket records by their own `createdAt` months.
 *  • Status charts read each module descriptor's OWN status select field —
 *    option labels and tones come from the descriptor, never a hardcoded map.
 *  • Family accents (Finance treasury KPIs, Inventory low stock, Procurement
 *    pipeline + expiring contracts, HR headcount, CRM funnel) bind to module
 *    ids and field keys verified against the registered modules.
 *
 * NOTHING is fabricated: a widget with no backing records reports itself
 * empty and the view renders the honest empty state instead of a chart.
 */
import type { EnterpriseEntity, EnterpriseFieldDef, EnterpriseModuleSummary } from '../types/enterpriseModule';

/* ── tiny helpers ─────────────────────────────────────────────────────────── */

const str = (v: unknown): string => (v === null || v === undefined ? '' : String(v));
const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

/** Live (non-deleted) records only — dashboards never count tombstones. */
export const liveRecords = (records: EnterpriseEntity[]): EnterpriseEntity[] =>
  records.filter((r) => r.status !== 'deleted');

/* ── time buckets ─────────────────────────────────────────────────────────── */

const MONTH_LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** The last `n` calendar months ending at `nowIso`, oldest first. */
export function lastMonths(n: number, nowIso: string): { key: string; label: string }[] {
  const now = new Date(nowIso);
  const out: { key: string; label: string }[] = [];
  for (let i = n - 1; i >= 0; i -= 1) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
    out.push({ key, label: MONTH_LABELS[d.getUTCMonth()] });
  }
  return out;
}

/** Count records per creation month over the last `n` months (real createdAt). */
export function countByMonth(
  records: EnterpriseEntity[],
  n: number,
  nowIso: string,
): { month: string; count: number }[] {
  const months = lastMonths(n, nowIso);
  const byKey = new Map(months.map((m) => [m.key, 0]));
  for (const r of liveRecords(records)) {
    const key = str(r.createdAt).slice(0, 7);
    if (byKey.has(key)) byKey.set(key, (byKey.get(key) ?? 0) + 1);
  }
  return months.map((m) => ({ month: m.label, count: byKey.get(m.key) ?? 0 }));
}

/* ── descriptor-driven status distribution ────────────────────────────────── */

/** The module's own status-like select field (options + tones), if it has one. */
export function statusFieldOf(module: EnterpriseModuleSummary): EnterpriseFieldDef | null {
  const fields = module.fields ?? [];
  return (
    fields.find((f) => f.key === 'status' && f.type === 'select' && (f.options?.length ?? 0) > 0) ??
    fields.find((f) => f.type === 'select' && (f.options?.length ?? 0) > 0) ??
    null
  );
}

export interface StatusSlice {
  name: string;
  value: number;
  tone?: string;
}

/** Count records across the field's OWN declared options (labels + tones). */
export function countByStatusOptions(records: EnterpriseEntity[], field: EnterpriseFieldDef): StatusSlice[] {
  const live = liveRecords(records);
  return (field.options ?? [])
    .map((opt) => ({
      name: opt.label,
      tone: opt.tone,
      value: live.filter((r) => str(r.fields[field.key]) === opt.value).length,
    }))
    .filter((s) => s.value > 0);
}

/* ── the assembled dashboard ──────────────────────────────────────────────── */

export interface FamilyKpi {
  label: string;
  value: string;
  hint?: string;
}

export interface FamilyDashboardData {
  /** Real headline numbers for the family (accent KPIs first when present). */
  kpis: FamilyKpi[];
  /** Records created per month (last 6) across the whole family. */
  creationTrend: { month: string; count: number }[];
  /** True when the family has at least one live record anywhere. */
  hasRecords: boolean;
  /** Active-record count per module (top 8 by count). */
  moduleBars: { name: string; active: number }[];
  /** Status distribution of the family's busiest status-carrying module. */
  statusDonut: { title: string; slices: StatusSlice[] } | null;
  /** Family-specific accent widgets (only ever from verified live data). */
  lowStock: { name: string; available: number; reorderLevel: number }[] | null;
  headcountByDept: { name: string; active: number }[] | null;
  funnel: { title: string; slices: StatusSlice[] } | null;
  expiringContracts: number | null;
}

const fmtMoney = (n: number): string =>
  Math.abs(n) >= 1000 ? `${(n / 1000).toFixed(1).replace(/\.0$/, '')}k` : `${Math.round(n * 100) / 100}`;

/** Build the whole dashboard for one family from its modules' live records. */
export function buildFamilyDashboard(
  group: string,
  modules: EnterpriseModuleSummary[],
  recordsByModule: Map<string, EnterpriseEntity[]>,
  nowIso: string,
): FamilyDashboardData {
  const all: EnterpriseEntity[] = [];
  for (const m of modules) all.push(...liveRecords(recordsByModule.get(m.id) ?? []));

  const kpis: FamilyKpi[] = [];
  let lowStock: FamilyDashboardData['lowStock'] = null;
  let headcountByDept: FamilyDashboardData['headcountByDept'] = null;
  let funnel: FamilyDashboardData['funnel'] = null;
  let expiringContracts: FamilyDashboardData['expiringContracts'] = null;

  // ── Finance accent: the latest treasury statement's derived position. ──
  if (group === 'Finance') {
    const treasury = liveRecords(recordsByModule.get('finance-treasury-positions') ?? []);
    const latest = [...treasury].sort((a, b) => str(b.updatedAt).localeCompare(str(a.updatedAt)))[0];
    if (latest) {
      kpis.push(
        { label: 'Cash', value: fmtMoney(num(latest.fields.cashBalance)), hint: `as of ${str(latest.fields.asOfDate) || '—'}` },
        { label: 'Receivables', value: fmtMoney(num(latest.fields.receivablesOutstanding)) },
        { label: 'Payables', value: fmtMoney(num(latest.fields.payablesOutstanding)) },
        { label: 'Net position', value: fmtMoney(num(latest.fields.netPosition)) },
      );
    }
  }

  // ── Inventory accent: products at/below their own reorder level. ──
  if (group === 'Inventory') {
    const products = liveRecords(recordsByModule.get('inventory-products') ?? []);
    const low = products
      .filter((p) => num(p.fields.reorderLevel) > 0 && num(p.fields.availableStock) <= num(p.fields.reorderLevel))
      .map((p) => ({
        name: str(p.fields.name) || str(p.fields.sku) || p.title,
        available: num(p.fields.availableStock),
        reorderLevel: num(p.fields.reorderLevel),
      }))
      .sort((a, b) => a.available - b.available)
      .slice(0, 6);
    lowStock = low;
    kpis.push({ label: 'Low stock', value: String(low.length), hint: 'at/below reorder level' });
  }

  // ── HR accent: active headcount by department. ──
  if (group === 'HR') {
    const employees = liveRecords(recordsByModule.get('hr-employees') ?? []);
    const active = employees.filter((e) => !str(e.fields.exitedAt));
    const byDept = new Map<string, number>();
    for (const e of active) {
      const dept = str(e.fields.department).trim() || 'Unassigned';
      byDept.set(dept, (byDept.get(dept) ?? 0) + 1);
    }
    headcountByDept = [...byDept.entries()]
      .map(([name, count]) => ({ name, active: count }))
      .sort((a, b) => b.active - a.active)
      .slice(0, 8);
    kpis.push({ label: 'Headcount', value: String(active.length), hint: `${employees.length - active.length} exited` });
  }

  // ── CRM accent: the lead funnel over the lead module's own stages. ──
  if (group === 'CRM') {
    const leadModule = modules.find((m) => m.id === 'crm-leads');
    const leads = liveRecords(recordsByModule.get('crm-leads') ?? []);
    const field = leadModule ? statusFieldOf(leadModule) : null;
    if (leadModule && field && leads.length > 0) {
      funnel = { title: 'Lead funnel', slices: countByStatusOptions(leads, field) };
    }
  }

  // ── Procurement accent: vendor contracts expiring inside 60 days. ──
  if (group === 'Procurement') {
    const contracts = liveRecords(recordsByModule.get('procurement-vendor-contracts') ?? []);
    const now = new Date(nowIso).getTime();
    const soon = contracts.filter((c) => {
      if (str(c.fields.status) !== 'active') return false;
      const end = Date.parse(`${str(c.fields.endDate)}T00:00:00.000Z`);
      if (!Number.isFinite(end)) return false;
      const days = (end - now) / 86_400_000;
      return days >= 0 && days <= 60;
    }).length;
    expiringContracts = soon;
    kpis.push({ label: 'Contracts expiring', value: String(soon), hint: 'within 60 days' });
  }

  // ── Generic KPIs (every family): live totals from the registry. ──
  kpis.push({ label: 'Records', value: String(all.length), hint: 'across the family' });

  // ── Status donut: the busiest module that carries a status select. ──
  let statusDonut: FamilyDashboardData['statusDonut'] = null;
  const candidates = modules
    .map((m) => ({ module: m, field: statusFieldOf(m), records: liveRecords(recordsByModule.get(m.id) ?? []) }))
    .filter((c) => c.field !== null && c.records.length > 0)
    .sort((a, b) => b.records.length - a.records.length);
  const busiest = candidates[0];
  if (busiest && busiest.field) {
    const slices = countByStatusOptions(busiest.records, busiest.field);
    if (slices.length > 0) statusDonut = { title: `${busiest.module.title} by status`, slices };
  }

  const moduleBars = modules
    .map((m) => ({ name: m.title, active: liveRecords(recordsByModule.get(m.id) ?? []).length }))
    .filter((r) => r.active > 0)
    .sort((a, b) => b.active - a.active)
    .slice(0, 8);

  return {
    kpis,
    creationTrend: countByMonth(all, 6, nowIso),
    hasRecords: all.length > 0,
    moduleBars,
    statusDonut,
    lowStock,
    headcountByDept,
    funnel,
    expiringContracts,
  };
}
