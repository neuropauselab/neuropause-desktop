/**
 * Industry view-model (IP-11) — PURE adapters that turn the desktop's canonical
 * `industry.snapshot` companion payload (the Wave 9 vertical packs + capability
 * evidence + readiness) into the chart inputs the executive phone view renders.
 * No RN; unit-tested in plain Node. Colours come from the shared design tokens so
 * the phone and desktop Industry Center read as one system. This shapes ONLY the
 * catalog the desktop already owns — no industry logic, no per-tenant compute.
 */
import type { IndustryCatalogCounts, IndustryCatalogSnapshot } from '@neuropause/shared';
import type { BarDatum, DonutSlice } from '../components/charts/geometry';
import { colors } from '../theme/tokens';

/** Total declared capabilities for one pack (its "size" across every counted area). */
export function packSize(counts: IndustryCatalogCounts): number {
  return (
    counts.objects +
    counts.workflows +
    counts.kpis +
    counts.compliancePacks +
    counts.connectors +
    counts.aiSkills +
    counts.documentTemplates
  );
}

/** Solution packs → ranked bars by total declared capabilities (largest first, capped). */
export function packBars(snapshot: IndustryCatalogSnapshot, limit = 8): BarDatum[] {
  return snapshot.industries
    .map((i) => ({ label: i.name, value: packSize(i.counts) }))
    .sort((a, b) => b.value - a.value)
    .slice(0, limit);
}

/** Capability-evidence areas → bars of how many capabilities each area declares. */
export function areaBars(snapshot: IndustryCatalogSnapshot): BarDatum[] {
  return snapshot.capabilities.map((g) => ({ label: g.area, value: g.items.length }));
}

/** Readiness → donut slices across the four honest evidence levels (empty levels dropped). */
export function readinessSlices(snapshot: IndustryCatalogSnapshot): DonutSlice[] {
  const r = snapshot.readiness;
  return [
    { name: 'Live-verified', value: r.liveVerified },
    { name: 'Adapter-verified', value: r.adapterVerified },
    { name: 'Data pending', value: r.businessDataPending },
    { name: 'External', value: r.regulatedExternal },
  ].filter((s) => s.value > 0);
}

/** Honest evidence-level → short display label (matches the desktop Catalog tab). */
export function evidenceLabel(level: string): string {
  switch (level) {
    case 'live-verified':
      return 'Live-verified';
    case 'adapter-verified':
      return 'Adapter-verified';
    case 'business-data-pending':
      return 'Data pending';
    case 'regulated-external':
      return 'External';
    default:
      return level;
  }
}

/** Colour for an evidence level, falling back to a muted tone for unknown levels. */
export function evidenceColor(level: string): string {
  switch (level) {
    case 'live-verified':
      return colors.bands.healthy;
    case 'adapter-verified':
      return colors.accent;
    case 'business-data-pending':
      return colors.bands.watch;
    case 'regulated-external':
      return colors.categorical[6];
    default:
      return colors.faint;
  }
}
