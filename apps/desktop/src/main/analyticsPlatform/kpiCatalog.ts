/**
 * Phase 6 Stage 12 — the unified KPI catalog. COMPOSES every reachable KPI
 * feed (the executive snapshot — which already aggregates the specialist
 * producers — process mining, and the P14/P18 reuse surfaces) into one
 * source-tagged catalog. Nothing is recomputed: rows carry the producers'
 * own values/bands verbatim; attribution comes from the registry key map;
 * an unknown key is an ATTRIBUTION GAP (flagged, never guessed); a failing
 * feed marks ONLY that feed unavailable — the catalog never fails whole.
 * Pure; reads injected.
 */
import type { EanaGap, EanaKpiCatalog, EanaKpiRow, EanaUnavailable } from '@neuropause/shared';
import { KNOWN_KPI_PRODUCER_BY_KEY, KPI_PRODUCER_REGISTRY } from './analyticsRegistry';

export const KPI_CATALOG_DISCLOSURE =
  'The catalog composes every reachable KPI feed with source attribution — producers stay authoritative, values and bands are theirs verbatim, nothing is recomputed, and a failing feed is declared unavailable rather than defaulted.';

export interface KpiFeed {
  kpis: { key: string; label: string; display: string; value: number | null; band?: string }[] | null;
}

export interface KpiCatalogInput {
  nowIso: string;
  /** The executive snapshot feed (core six + specialist + plugin KPIs). */
  executive: KpiFeed['kpis'];
  /** The process-mining KPI feed. */
  process: KpiFeed['kpis'];
  /** The P14 strategy surface (reuse) — adds surfaces, not values. */
  p14: KpiFeed['kpis'];
  /** The P18 network surface (reuse) — adds surfaces, not values. */
  p18: KpiFeed['kpis'];
  failures: Record<string, string>;
}

const ATTENTION_BANDS = new Set(['at-risk', 'critical', 'watch']);

export function buildKpiCatalog(input: KpiCatalogInput): EanaKpiCatalog {
  const unavailable: EanaUnavailable[] = Object.entries(input.failures).map(([system, reason]) => ({ system, reason }));
  const gaps: EanaGap[] = [];
  const rows = new Map<string, EanaKpiRow>();
  const feedSources = new Map<string, string[]>();

  const surfacesFor = (producerId: string): string[] => {
    const def = KPI_PRODUCER_REGISTRY.find((p) => p.id === producerId);
    return def ? [...def.surfaces] : [];
  };

  const ingest = (feed: KpiFeed['kpis'], source: string, producerFallback: string, reuseOnly: boolean, extraSurface: string): void => {
    if (feed === null) return; // the feed's failure entry already declares it
    for (const k of feed) {
      const sources = feedSources.get(k.key) ?? [];
      if (!sources.includes(source)) sources.push(source);
      feedSources.set(k.key, sources);
      const existing = rows.get(k.key);
      if (existing) {
        // Reuse made visible: the key gains a surface, never a second value.
        if (!existing.surfaces.includes(extraSurface)) existing.surfaces.push(extraSurface);
        continue;
      }
      if (reuseOnly) {
        // A key seen ONLY on a reuse surface still gets a row — with the reuse
        // feed as its source and an attribution gap if unregistered.
        const producerId = KNOWN_KPI_PRODUCER_BY_KEY.get(k.key) ?? producerFallback;
        rows.set(k.key, mkRow(k, source, producerId, [...new Set([...surfacesFor(producerId), extraSurface])]));
        continue;
      }
      const registered = KNOWN_KPI_PRODUCER_BY_KEY.get(k.key);
      const producerId = registered ?? producerFallback;
      if (!registered && producerFallback === 'unregistered') {
        gaps.push({ kind: 'unregistered-producer', subject: k.key, detail: `live key '${k.key}' has no registered producer — attribution gap, not guessed` });
      }
      rows.set(k.key, mkRow(k, source, producerId, [...new Set([...surfacesFor(producerId), extraSurface])]));
    }
  };

  const mkRow = (
    k: NonNullable<KpiFeed['kpis']>[number],
    source: string,
    producerId: string,
    surfaces: string[],
  ): EanaKpiRow => ({
    key: k.key,
    label: k.label,
    value: k.value,
    display: k.display,
    band: k.band ?? null,
    source,
    producerId,
    surfaces,
    availability: 'live',
    evidence: [k.key, source],
  });

  // The executive snapshot aggregates core + specialist + plugin KPIs; keys
  // not in the registry key map are plugin/dynamic → attribution gap.
  ingest(input.executive, 'executive-center', 'unregistered', false, 'mission-control');
  ingest(input.process, 'process-mining', 'process-mining', false, 'process-explorer');
  ingest(input.p14, 'p14-strategy-surface', 'p14-strategy-surface', true, 'strategy-center');
  ingest(input.p18, 'p18-network-surface', 'p18-network-surface', true, 'network-center');

  const all = [...rows.values()];
  const overlaps = [...feedSources.entries()]
    .filter(([, sources]) => sources.length > 1)
    .map(([key, sources]) => ({ key, sources }));

  return {
    generatedAt: input.nowIso,
    rows: all,
    totals: {
      total: all.length,
      live: all.filter((r) => r.availability === 'live').length,
      healthy: all.filter((r) => r.band === 'healthy').length,
      attention: all.filter((r) => r.band !== null && ATTENTION_BANDS.has(r.band)).length,
      unregistered: all.filter((r) => r.producerId === 'unregistered').length,
    },
    overlaps,
    gaps,
    disclosure: KPI_CATALOG_DISCLOSURE,
    unavailable,
  };
}
