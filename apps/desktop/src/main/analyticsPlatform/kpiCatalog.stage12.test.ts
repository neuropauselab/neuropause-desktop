/**
 * Phase 6 Stage 12 — the unified KPI catalog: source attribution from the
 * registry key map, reuse surfaces adding surfaces (never second values),
 * attribution gaps for unregistered live keys (flagged, never guessed),
 * verbatim bands, overlap visibility, and the never-fails-whole guarantee.
 */
import { describe, expect, it } from 'vitest';
import { buildKpiCatalog, KPI_CATALOG_DISCLOSURE } from './kpiCatalog';

const NOW = '2026-08-01T09:00:00.000Z';

const EXEC = [
  { key: 'org-health', label: 'Org health', display: '82/100', value: 82, band: 'healthy' },
  { key: 'engineering-health', label: 'Engineering health', display: '74/100', value: 74, band: 'watch' },
  { key: 'automation-success', label: 'Automation success', display: '96%', value: 96, band: 'healthy' },
  { key: 'plugin.custom-tile', label: 'Plugin tile', display: '7', value: 7 },
];

function build(over: Partial<Parameters<typeof buildKpiCatalog>[0]> = {}) {
  return buildKpiCatalog({
    nowIso: NOW,
    executive: EXEC,
    process: [{ key: 'process-cycle-hours', label: 'Median cycle', display: '18h', value: 18, band: 'watch' }],
    p14: [{ key: 'org-health', label: 'Org health', display: '82/100', value: 82, band: 'healthy' }],
    p18: [{ key: 'engineering-health', label: 'Engineering health', display: '74/100', value: 74, band: 'watch' }],
    failures: {},
    ...over,
  });
}

describe('buildKpiCatalog — attribution (producers authoritative)', () => {
  it('attributes registered keys through the registry key map, verbatim values and bands', () => {
    const c = build();
    const org = c.rows.find((r) => r.key === 'org-health')!;
    expect(org.producerId).toBe('executive-core');
    expect(org.source).toBe('executive-center');
    expect(org.display).toBe('82/100');
    expect(org.band).toBe('healthy');
    expect(c.rows.find((r) => r.key === 'automation-success')!.producerId).toBe('work-intelligence-automation');
    expect(c.rows.find((r) => r.key === 'process-cycle-hours')!.producerId).toBe('process-mining');
  });

  it('flags an unregistered live key as an attribution gap — never guessed', () => {
    const c = build();
    const plugin = c.rows.find((r) => r.key === 'plugin.custom-tile')!;
    expect(plugin.producerId).toBe('unregistered');
    expect(c.totals.unregistered).toBe(1);
    const gap = c.gaps.find((g) => g.subject === 'plugin.custom-tile')!;
    expect(gap.kind).toBe('unregistered-producer');
    expect(gap.detail).toContain('not guessed');
  });

  it('reuse surfaces add surfaces to an existing row — never a second value or row', () => {
    const c = build();
    const org = c.rows.filter((r) => r.key === 'org-health');
    expect(org).toHaveLength(1);
    expect(org[0].surfaces).toContain('strategy-center'); // gained from the P14 reuse feed
    expect(org[0].source).toBe('executive-center'); // the value stays the producer's
  });

  it('reports keys served by multiple live feeds as overlaps (reuse made visible, not resolved)', () => {
    const c = build();
    const overlap = c.overlaps.find((o) => o.key === 'org-health')!;
    expect(overlap.sources).toEqual(['executive-center', 'p14-strategy-surface']);
  });

  it('a key seen ONLY on a reuse surface still gets a row, attributed to that surface', () => {
    const c = build({ executive: [], p18: [{ key: 'network-only', label: 'Network only', display: 'x', value: null }] });
    const row = c.rows.find((r) => r.key === 'network-only')!;
    expect(row.producerId).toBe('p18-network-surface');
    expect(row.source).toBe('p18-network-surface');
  });
});

describe('buildKpiCatalog — failure isolation (never fails whole)', () => {
  it('a failed feed becomes an unavailable entry; every other feed still lands', () => {
    const c = build({ process: null, failures: { 'process-kpis': 'mining provider threw' } });
    expect(c.unavailable).toContainEqual({ system: 'process-kpis', reason: 'mining provider threw' });
    expect(c.rows.some((r) => r.key === 'org-health')).toBe(true);
    expect(c.rows.some((r) => r.key === 'process-cycle-hours')).toBe(false);
  });

  it('all feeds failing yields an empty catalog with every failure declared — no fabricated rows', () => {
    const c = build({
      executive: null,
      process: null,
      p14: null,
      p18: null,
      failures: { 'executive-kpis': 'x', 'process-kpis': 'x', 'p14-kpis': 'x', 'p18-kpis': 'x' },
    });
    expect(c.rows).toEqual([]);
    expect(c.totals.total).toBe(0);
    expect(c.unavailable).toHaveLength(4);
  });

  it('totals count healthy/attention from verbatim bands; bandless KPIs are neither', () => {
    const c = build();
    expect(c.totals.total).toBe(5); // 4 exec + 1 process; the P14/P18 reuse feeds add surfaces, not rows
    expect(c.totals.healthy).toBe(2); // org-health, automation-success
    expect(c.totals.attention).toBe(2); // engineering-health (watch), process-cycle-hours (watch)
    expect(c.disclosure).toBe(KPI_CATALOG_DISCLOSURE);
    expect(c.disclosure).toContain('nothing is recomputed');
  });
});
