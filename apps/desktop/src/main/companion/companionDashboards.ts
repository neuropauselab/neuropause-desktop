/**
 * Companion dashboard projections (Mobile M1-04) — pure functions that turn the
 * desktop's REAL executive snapshot and module registry into the compact
 * view-models the phone renders. No fabricated numbers: the KPI strip is the
 * executive center's own KPIs, and the family list is derived from the live
 * module summaries. The heavy per-family dashboard reuses the shared
 * `buildFamilyDashboard` (the same model the desktop renders), so the phone and
 * desktop never diverge.
 */
import type {
  CompanionDashboardSnapshot,
  CompanionFamilySummary,
  EnterpriseModuleSummary,
  ExecutiveCenterSnapshot,
} from '@neuropause/shared';

/** Project the executive snapshot's KPI strip into the phone's compact tiles. */
export function buildCompanionSnapshot(exec: ExecutiveCenterSnapshot): CompanionDashboardSnapshot {
  return {
    generatedAt: exec.generatedAt,
    kpis: exec.kpis.map((k) => ({
      key: k.key,
      label: k.label,
      display: k.display,
      ...(k.band ? { band: k.band } : {}),
      ...(k.trend ? { trend: k.trend } : {}),
    })),
  };
}

/** Group the live module summaries into the families the phone can drill into. */
export function buildCompanionFamilies(
  summaries: EnterpriseModuleSummary[],
): CompanionFamilySummary[] {
  const byGroup = new Map<string, { moduleCount: number; recordCount: number }>();
  for (const s of summaries) {
    const group = s.group ?? 'Other';
    const cur = byGroup.get(group) ?? { moduleCount: 0, recordCount: 0 };
    cur.moduleCount += 1;
    cur.recordCount += s.recordCount ?? 0;
    byGroup.set(group, cur);
  }
  return [...byGroup.entries()]
    .map(([group, v]) => ({ group, moduleCount: v.moduleCount, recordCount: v.recordCount }))
    .sort((a, b) => b.recordCount - a.recordCount || a.group.localeCompare(b.group));
}
