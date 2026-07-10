import { describe, expect, it } from 'vitest';
import {
  buildTrustModel,
  deriveTrustInsights,
  trustInsightsToKpis,
  trustLevel,
  type TrustEngineInput,
  type EnterpriseTrustModel,
} from '@neuropause/shared';

const NOW = Date.parse('2026-07-08T00:00:00.000Z');
const RECENT = '2026-07-03T00:00:00.000Z';

/** A deterministic fixture spanning machines, customers, warehouse, knowledge and process. */
function fixture(): TrustEngineInput {
  return {
    relationshipNodes: [
      { id: 'machine:M1', kind: 'machine', key: 'M1', label: 'M1', health: 'strong', risk: 10, degree: 5, resolved: true },
      { id: 'machine:M2', kind: 'machine', key: 'M2', label: 'M2', health: 'critical', risk: 80, degree: 3, resolved: true },
      { id: 'warehouse:WH1', kind: 'warehouse', key: 'WH1', label: 'WH1', health: 'healthy', risk: 20, degree: 4, resolved: true },
      { id: 'customer:GoodCo', kind: 'customer', key: 'GoodCo', label: 'GoodCo', health: 'strong', risk: 10, degree: 6, resolved: true },
      { id: 'customer:BadCo', kind: 'customer', key: 'BadCo', label: 'BadCo', health: 'weak', risk: 50, degree: 3, resolved: true },
      { id: 'customer:TrendCo', kind: 'customer', key: 'TrendCo', label: 'TrendCo', health: 'healthy', risk: 20, degree: 6, resolved: true },
      { id: 'customer:Ghost', kind: 'customer', key: 'Ghost', label: 'Ghost', health: 'broken', risk: 90, degree: 1, resolved: false }, // unresolved → no profile
    ],
    machines: [
      { name: 'M1', status: 'running', runtime: 90, downtime: 10 },
      { name: 'M2', status: 'down', runtime: 20, downtime: 80 },
    ],
    downtime: [
      { machine: 'M2', type: 'unplanned', durationHours: 5 },
      { machine: 'M2', type: 'unplanned', durationHours: 3 },
      { machine: 'M2', type: 'unplanned', durationHours: 2 },
    ],
    workOrders: [
      { workOrderNumber: 'WO-1', machine: 'M1', status: 'completed', scheduledDate: '2026-06-01', completedDate: '2026-06-01' },
      { workOrderNumber: 'WO-2', machine: 'M1', status: 'verified', scheduledDate: '2026-06-05', completedDate: '2026-06-05' },
      { workOrderNumber: 'WO-3', machine: 'M2', status: 'completed', scheduledDate: '2026-05-01', completedDate: '2026-06-01' }, // late
    ],
    executions: [{ executionNumber: 'EX-1', machine: 'M1', product: 'P1', productionOrder: 'MO-1', status: 'completed', inspectionResult: 'pass', goodQuantity: 10, scrapQuantity: 0, updatedAt: RECENT }],
    invoices: [
      { number: 'INV-G', customer: 'GoodCo', amount: 1000, amountPaid: 1000, status: 'paid' },
      { number: 'INV-B', customer: 'BadCo', amount: 1000, amountPaid: 0, status: 'overdue', dueDate: '2026-05-01' },
    ],
    orders: [
      { orderNumber: 'SO-G', customer: 'GoodCo', status: 'fulfilled', expectedDeliveryDate: '2026-06-10', deliveredDate: '2026-06-08' },
      { orderNumber: 'SO-B', customer: 'BadCo', status: 'pending', expectedDeliveryDate: '2026-05-01' }, // open + past → late
      { orderNumber: 'T1', customer: 'TrendCo', status: 'fulfilled', expectedDeliveryDate: '2026-07-05', deliveredDate: '2026-07-03' }, // on-time (recent)
      { orderNumber: 'T2', customer: 'TrendCo', status: 'fulfilled', expectedDeliveryDate: '2026-06-27', deliveredDate: '2026-06-25' },
      { orderNumber: 'T3', customer: 'TrendCo', status: 'fulfilled', expectedDeliveryDate: '2026-06-20', deliveredDate: '2026-06-18' },
      { orderNumber: 'T4', customer: 'TrendCo', status: 'fulfilled', expectedDeliveryDate: '2026-03-01', deliveredDate: '2026-03-20' }, // late (old)
      { orderNumber: 'T5', customer: 'TrendCo', status: 'fulfilled', expectedDeliveryDate: '2026-02-20', deliveredDate: '2026-03-10' },
      { orderNumber: 'T6', customer: 'TrendCo', status: 'fulfilled', expectedDeliveryDate: '2026-01-20', deliveredDate: '2026-02-10' },
    ],
    memories: [{ id: 'MEM-1', kind: 'note', title: 'Fresh note', content: 'x'.repeat(50), origin: 'explicit', entityRefs: ['a', 'b'], updatedAt: RECENT }],
    processMetrics: [{ processType: 'order-to-cash', completionRate: 80, reworkRate: 10, caseCount: 5 }],
  };
}

const find = (m: EnterpriseTrustModel, id: string) => m.profiles.find((p) => p.id === id);

describe('Trust engine — deterministic per-entity calculation', () => {
  it('scores each entity as a weighted average of its evidenced factors', () => {
    const m = buildTrustModel(fixture(), NOW);

    // Machine M1: rel 95(×1) + reliability 90(×3) + maintenance 100(×2) + quality 100(×1) = 665/7 = 95.
    const m1 = find(m, 'machine:M1')!;
    expect(m1.score).toBe(95);
    expect(m1.level).toBe('excellent');
    expect(m1.risk).toBe(5); // 100 - score, no factor below 35

    // Machine M2: rel 16(×1) + reliability 0(×3) + maintenance 0(×2) = 16/6 = 3. Quality absent (no exec on M2).
    const m2 = find(m, 'machine:M2')!;
    expect(m2.score).toBe(3);
    expect(m2.level).toBe('critical');
    expect(m2.risk).toBe(97); // worst factor < 35 → max(100-score, 70) = max(97, 70)
    expect(m2.coverage).toBe(86); // 3 of 4 applicable factors present (6/7 weight)

    const good = find(m, 'customer:GoodCo')!;
    expect(good.score).toBe(99);
    expect(good.level).toBe('excellent');
    const bad = find(m, 'customer:BadCo')!;
    expect(bad.score).toBe(15);
    expect(bad.level).toBe('critical');
  });

  it('EXCLUDES unevidenced factors (never defaults them to 100)', () => {
    const m = buildTrustModel(fixture(), NOW);
    // Warehouse WH1 has a relationship node but no audit/compliance evidence → policy_compliance is EXCLUDED,
    // so the score is the relationship factor alone (83), not inflated by an absent 100.
    const wh = find(m, 'warehouse:WH1')!;
    expect(wh.factors).toHaveLength(1);
    expect(wh.factors[0].key).toBe('relationship_health');
    expect(wh.score).toBe(83);
    expect(wh.coverage).toBe(67); // 2 of 3 applicable weight present
    expect(wh.level).toBe('good');
    // An unresolved relationship node produces no trust profile.
    expect(find(m, 'customer:Ghost')).toBeUndefined();
  });

  it('is fully deterministic — identical input yields byte-identical output', () => {
    const a = buildTrustModel(fixture(), NOW);
    const b = buildTrustModel(fixture(), NOW);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});

describe('Trust engine — trend, knowledge, process', () => {
  it('derives an upward trend from improving dated delivery history', () => {
    const m = buildTrustModel(fixture(), NOW);
    const trend = find(m, 'customer:TrendCo')!;
    expect(trend.trend.direction).toBe('up'); // 3 recent on-time vs 3 old late
    expect(trend.trend.delta).toBeGreaterThan(0);
    expect(trend.trend.sparkline.length).toBeGreaterThanOrEqual(6);
  });

  it('scores knowledge and process entities from their own evidence', () => {
    const m = buildTrustModel(fixture(), NOW);
    const know = find(m, 'knowledge:MEM-1')!;
    expect(know.score).toBe(96); // freshness 100(×3) + completeness 90(×2) = 480/5
    expect(know.kind).toBe('knowledge');
    const proc = find(m, 'process:order-to-cash')!;
    expect(proc.score).toBe(84); // 0.6*80 completion + 0.4*90 conformance
    expect(proc.level).toBe('good');
  });
});

describe('Trust engine — insights, KPIs, levels', () => {
  it('rolls profiles into the nine executive trust KPIs + level bands', () => {
    const m = buildTrustModel(fixture(), NOW);
    const insights = deriveTrustInsights(m.profiles);

    // enterprise trust = mean of all 8 profile scores (95,3,83,99,15,67,96,84) = 68.
    expect(insights.enterpriseTrust).toBe(68);
    expect(insights.customerTrust).toBe(60); // mean(99,15,67)
    expect(insights.machineTrust).toBe(49); // mean(95,3)
    expect(insights.byLevel.critical).toBeGreaterThanOrEqual(2); // M2 + BadCo
    expect(insights.lowTrustCount).toBeGreaterThanOrEqual(2);

    const kpis = trustInsightsToKpis(insights);
    expect(kpis.map((k) => k.key)).toEqual([
      'trust-enterprise', 'trust-customer', 'trust-supplier', 'trust-machine', 'trust-knowledge',
      'trust-decision', 'trust-process', 'trust-operational', 'trust-compliance',
    ]);
    expect(m.kpis.map((k) => k.key)).toEqual(kpis.map((k) => k.key));
    expect(m.narrative.grounded).toBe(true);
    expect(m.narrative.improvementRecommendations.length).toBeGreaterThan(0);

    // level bands are the fixed deterministic thresholds.
    expect(trustLevel(92)).toBe('excellent');
    expect(trustLevel(80)).toBe('good');
    expect(trustLevel(60)).toBe('moderate');
    expect(trustLevel(40)).toBe('low');
    expect(trustLevel(20)).toBe('critical');
  });

  it('is safe and grounded on an empty enterprise', () => {
    const m = buildTrustModel({}, NOW);
    expect(m.counts.profiles).toBe(0);
    expect(m.insights.enterpriseTrust).toBe(0);
    expect(m.kpis).toHaveLength(9);
    expect(m.narrative.grounded).toBe(true);
  });
});

describe('Trust engine — scales deterministically', () => {
  it('scores a large entity set with consistent structure', () => {
    const input: TrustEngineInput = { relationshipNodes: [], orders: [] };
    for (let i = 0; i < 200; i += 1) {
      input.relationshipNodes!.push({ id: `customer:C${i}`, kind: 'customer', key: `C${i}`, label: `C${i}`, health: 'healthy', risk: 20, degree: 2, resolved: true });
      input.orders!.push({ orderNumber: `O${i}`, customer: `C${i}`, status: 'fulfilled', expectedDeliveryDate: '2026-07-05', deliveredDate: '2026-07-03', updatedAt: RECENT });
    }
    const m = buildTrustModel(input, NOW);
    expect(m.profiles).toHaveLength(200);
    // every profile has a valid score, level, and at least one factor.
    expect(m.profiles.every((p) => p.score >= 0 && p.score <= 100 && p.factors.length >= 1)).toBe(true);
    expect(m.kpis).toHaveLength(9);
    expect(m.insights.customerTrust).toBeGreaterThan(0);
  });
});
