/**
 * P7.1 — Enterprise Operations Center view-model. Pure (Node), no DOM/React.
 * Locks the status→tone maps, formatters, KPI grouping, risk heatmap, health
 * dials, and the dependency-graph element builder + deterministic layout that
 * back the interactive Graph Explorer.
 */
import { describe, expect, it } from 'vitest';
import type {
  DependencyReport,
  EnterpriseHealthReport,
  EnterpriseIntelligenceReport,
  EnterpriseRiskReport,
  ExecutiveKpi,
} from '@neuropause/shared';
import {
  PRIORITY_RANK,
  bandLabel,
  bandTone,
  blastRadiusTone,
  buildGraphElements,
  compactNumber,
  confidenceTone,
  domainLabel,
  filterGraph,
  formatDuration,
  formatMoney,
  graphDomains,
  groupKpis,
  hasRootCause,
  headline,
  healthDials,
  healthScoreTone,
  impactDomainRows,
  layoutGraph,
  pct01,
  priorityTone,
  pressureTone,
  relativeTime,
  riskHeatCells,
  riskScoreTone,
  severityTone,
  shortLabel,
  sortedRecommendations,
} from './opsModel';

const NOW = Date.parse('2026-07-14T00:00:00.000Z');

describe('status → tone maps', () => {
  it('maps bands both ways', () => {
    expect(bandTone('healthy')).toBe('green');
    expect(bandTone('watch')).toBe('blue');
    expect(bandTone('at-risk')).toBe('orange');
    expect(bandTone('critical')).toBe('red');
    expect(bandLabel('at-risk')).toBe('At Risk');
  });

  it('maps severity + priority + pressure', () => {
    expect(severityTone('info')).toBe('blue');
    expect(severityTone('critical')).toBe('red');
    expect(priorityTone('low')).toBe('gray');
    expect(priorityTone('critical')).toBe('red');
    expect(pressureTone('low')).toBe('green');
    expect(pressureTone('critical')).toBe('red');
    expect(PRIORITY_RANK.critical).toBeGreaterThan(PRIORITY_RANK.high);
  });

  it('risk score tone rises with risk, health tone is its inverse', () => {
    expect(riskScoreTone(10)).toBe('green');
    expect(riskScoreTone(80)).toBe('red');
    expect(healthScoreTone(90)).toBe('green');
    expect(healthScoreTone(10)).toBe('red');
    expect(confidenceTone(0.9)).toBe('green');
    expect(confidenceTone(0.1)).toBe('gray');
  });
});

describe('labels + formatters', () => {
  it('domain labels upper-case acronyms and title-case words', () => {
    expect(domainLabel('crm')).toBe('CRM');
    expect(domainLabel('infrastructure')).toBe('Infrastructure');
    expect(domainLabel('object_storage')).toBe('Object Storage');
  });

  it('pct01 clamps 0..1', () => {
    expect(pct01(0.873)).toBe('87%');
    expect(pct01(1.5)).toBe('100%');
    expect(pct01(-1)).toBe('0%');
  });

  it('compactNumber + formatMoney (incl. exact-power + round-up boundaries)', () => {
    expect(compactNumber(950)).toBe('950');
    expect(compactNumber(1234)).toBe('1.2k');
    expect(compactNumber(2_000_000)).toBe('2M');
    expect(compactNumber(999_999.6)).toBe('1M'); // must not print "1000k"
    expect(formatMoney(0)).toBe('$0');
    expect(formatMoney(5000)).toBe('$5k');
    expect(formatMoney(2_000_000)).toBe('$2M'); // must not print "$2.00M"
    expect(formatMoney(2_500_000)).toBe('$2.5M');
  });

  it('relativeTime is past/future aware, nowMs-pure, and clean at tier boundaries', () => {
    expect(relativeTime(NOW - 120_000, NOW)).toBe('2m ago');
    expect(relativeTime(NOW - 2 * 3600_000, NOW)).toBe('2h ago');
    expect(relativeTime(NOW + 3600_000, NOW)).toBe('in 1h');
    expect(relativeTime('not-a-date', NOW)).toBe('—');
    expect(relativeTime(NOW - 3_599_000, NOW)).toBe('1h ago'); // not "60m ago"
    expect(relativeTime(NOW - 86_399_000, NOW)).toBe('1d ago'); // not "24h ago"
  });

  it('formatDuration humanizes a span', () => {
    expect(formatDuration(NOW, NOW + 90_000)).toBe('1m 30s');
    expect(formatDuration(NOW, NOW + 3 * 3600_000)).toBe('3h 0m');
  });
});

describe('groupKpis', () => {
  it('groups by the second dotted key segment, preserving first-seen order', () => {
    const kpis: ExecutiveKpi[] = [
      { key: 'enterprise.health.overall', label: 'Health', value: 80, display: '80' },
      { key: 'enterprise.risk.overall', label: 'Risk', value: 20, display: '20' },
      { key: 'enterprise.health.availability', label: 'Availability', value: 90, display: '90' },
    ];
    const groups = groupKpis(kpis);
    expect(groups.map((g) => g.key)).toEqual(['health', 'risk']);
    expect(groups[0].kpis).toHaveLength(2);
    expect(groups[0].label).toBe('Health');
  });
});

describe('riskHeatCells + healthDials', () => {
  const risk = {
    categories: [
      { category: 'operational', score: 30, band: 'watch', sampleSize: 4, contributors: [] },
      { category: 'security', score: 80, band: 'critical', sampleSize: 2, contributors: [] },
      { category: 'dependency', score: 55, band: 'at-risk', sampleSize: 1, contributors: [] },
    ],
  } as unknown as EnterpriseRiskReport;

  it('sorts heat cells hottest-first with intensity + tone', () => {
    const cells = riskHeatCells(risk);
    expect(cells[0].category).toBe('security');
    expect(cells[0].tone).toBe('red');
    expect(cells[0].intensity).toBeCloseTo(0.8, 5);
    expect(cells[cells.length - 1].category).toBe('operational');
  });

  it('health dials use the risk scale only for the risk key', () => {
    const health = {
      scores: [
        { key: 'availability', label: 'Availability', score: 90, band: 'healthy', factors: [] },
        { key: 'risk', label: 'Risk', score: 80, band: 'critical', factors: [] },
      ],
    } as unknown as EnterpriseHealthReport;
    const dials = healthDials(health);
    expect(dials[0].tone).toBe('green'); // availability 90 → health scale
    expect(dials[1].tone).toBe('red'); // risk 80 → risk scale (hot), not green
    expect(dials[0].value).toBeCloseTo(0.9, 5);
  });
});

describe('headline', () => {
  it('projects one-glance numbers and counts critical+high recommendations', () => {
    const report = {
      graph: { nodes: 12, edges: 20, byDomain: {}, crossDomainEdges: 2, truncated: false },
      health: { overall: 72, band: 'watch' },
      risk: { overall: 40, band: 'at-risk' },
      dependencies: { spofs: [{}, {}] },
      drift: { driftScore: 88 },
      capacity: { pressureScore: 33 },
      incidents: { open: 3 },
      recommendations: [
        { priority: 'critical' },
        { priority: 'high' },
        { priority: 'low' },
      ],
    } as unknown as EnterpriseIntelligenceReport;
    const h = headline(report);
    expect(h.healthScore).toBe(72);
    expect(h.healthTone).toBe('blue'); // 72 → health scale blue
    expect(h.openIncidents).toBe(3);
    expect(h.criticalRecommendations).toBe(2);
    expect(h.spofCount).toBe(2);
    expect(h.nodes).toBe(12);
  });
});

describe('sortedRecommendations', () => {
  it('orders critical → low', () => {
    const recs = [
      { id: 'a', priority: 'low' },
      { id: 'b', priority: 'critical' },
      { id: 'c', priority: 'medium' },
    ] as unknown as Parameters<typeof sortedRecommendations>[0];
    expect(sortedRecommendations(recs).map((r) => r.id)).toEqual(['b', 'c', 'a']);
  });
});

describe('shortLabel', () => {
  it('strips id prefixes and takes the last segment', () => {
    expect(shortLabel('res:aws:acct:database:db')).toBe('db');
    expect(shortLabel('erp:customer:cust-1')).toBe('cust-1');
    expect(shortLabel('plain')).toBe('plain');
  });
});

describe('buildGraphElements', () => {
  const dep: DependencyReport = {
    cycles: [{ nodes: ['a', 'b', 'c'], size: 3, domains: ['infrastructure'] }],
    spofs: [
      { id: 'db', label: 'db', domain: 'infrastructure', blastRadius: 5, dependents: 3, risk: 70 },
    ],
    bottlenecks: [
      { id: 'gw', label: 'gw', domain: 'infrastructure', throughput: 4, inDegree: 2, outDegree: 2 },
    ],
    failureChains: [{ path: ['db', 'x', 'y'], length: 3, domains: ['infrastructure'] }],
    criticalCount: 1,
    cyclic: true,
    builtAt: '2026-07-14T00:00:00.000Z',
  } as unknown as DependencyReport;

  it('unions nodes across findings, keeps the highest-precedence role, and de-dupes edges', () => {
    const g = buildGraphElements(dep);
    // db appears as both a spof and the head of a failure chain → spof wins.
    const db = g.nodes.find((n) => n.id === 'db')!;
    expect(db.role).toBe('spof');
    expect(db.risk).toBe(70);
    // chain nodes x,y and cycle nodes a,b,c materialize with derived labels.
    expect(g.nodes.find((n) => n.id === 'y')!.role).toBe('chain');
    expect(g.nodes.find((n) => n.id === 'a')!.role).toBe('cycle');
    // failure-chain edges are directed db→x→y; cycle edges ring a→b→c→a.
    expect(g.edges.some((e) => e.from === 'db' && e.to === 'x' && e.kind === 'depends')).toBe(true);
    expect(g.edges.filter((e) => e.kind === 'cycle')).toHaveLength(3);
  });

  it('graphDomains + filterGraph keep only in-domain nodes and their internal edges', () => {
    const g = buildGraphElements(dep);
    expect(graphDomains(g)).toEqual(['infrastructure']);
    const filtered = filterGraph(g, 'infrastructure');
    expect(filtered.nodes.length).toBe(g.nodes.length);
    const empty = filterGraph(g, 'finance');
    expect(empty.nodes).toHaveLength(0);
    expect(empty.edges).toHaveLength(0);
  });

  it('layoutGraph is deterministic and centers a single cluster at the origin', () => {
    const g = buildGraphElements(dep);
    const a = layoutGraph(g);
    const b = layoutGraph(g);
    expect(a.map((n) => [n.id, n.x, n.y])).toEqual(b.map((n) => [n.id, n.x, n.y]));
    // one domain → cluster radius 0 → the heaviest node sits at the origin.
    const heaviest = a.find((n) => n.id === 'db')!;
    expect(heaviest.x).toBeCloseTo(0, 6);
    expect(heaviest.y).toBeCloseTo(0, 6);
    // every position stays inside the [-1,1] square.
    for (const n of a) {
      expect(Math.abs(n.x)).toBeLessThanOrEqual(1);
      expect(Math.abs(n.y)).toBeLessThanOrEqual(1);
    }
  });

  it('layoutGraph normalizes a large single-domain graph into the [-1,1] square', () => {
    // A 60-node failure chain (one domain) drives the spiral well past 1.0 before
    // normalization; every position must still be clamped inside the unit square.
    const path = Array.from({ length: 60 }, (_, i) => `n${i}`);
    const bigDep = { ...dep, spofs: [], bottlenecks: [], cycles: [], failureChains: [{ path, length: 60, domains: ['infrastructure'] }] } as unknown as DependencyReport;
    const laid = layoutGraph(buildGraphElements(bigDep));
    expect(laid.length).toBe(60);
    for (const n of laid) {
      expect(Math.abs(n.x)).toBeLessThanOrEqual(1);
      expect(Math.abs(n.y)).toBeLessThanOrEqual(1);
    }
  });
});

describe('change impact + root cause presentation', () => {
  it('impactDomainRows shares sum to ~1 and sort largest-first', () => {
    const rows = impactDomainRows({
      affectedByDomain: { infrastructure: 6, finance: 2 },
    } as never);
    expect(rows[0].domain).toBe('infrastructure');
    expect(rows[0].share).toBeCloseTo(0.75, 5);
    expect(rows.reduce((s, r) => s + r.share, 0)).toBeCloseTo(1, 5);
  });

  it('blastRadiusTone escalates with radius', () => {
    expect(blastRadiusTone(0)).toBe('green');
    expect(blastRadiusTone(3)).toBe('blue');
    expect(blastRadiusTone(10)).toBe('orange');
    expect(blastRadiusTone(25)).toBe('red');
  });

  it('hasRootCause requires a symptom and at least one candidate', () => {
    expect(hasRootCause(null)).toBe(false);
    expect(hasRootCause({ symptom: null, candidates: [], confidence: 0, builtAt: '' })).toBe(false);
    expect(
      hasRootCause({
        symptom: { eventId: 'e', resourceId: 'r', label: 'l' },
        candidates: [{ eventId: 'e2' }],
        confidence: 0.5,
        builtAt: '',
      } as never),
    ).toBe(true);
  });
});
