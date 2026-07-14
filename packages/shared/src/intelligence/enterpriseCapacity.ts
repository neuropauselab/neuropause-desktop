/**
 * P7 — Capacity Intelligence. Detects resource pressure, utilization, cost trends, and growth from the discovered
 * cloud/infra resource attributes (the same `CloudResource.attributes` the P6 collectors already populate), and
 * emits scaling recommendations. Pure + deterministic; no new metrics pipeline — it reads what discovery captured.
 */
import type { CloudResource } from '../infra/resourceGraph';
import type { ExecutiveKpi } from '../types/executiveCenter';

export type PressureLevel = 'low' | 'moderate' | 'high' | 'critical';

/** Attribute keys that commonly carry a 0–100 utilization signal. */
const UTIL_KEYS = ['utilization', 'cpu', 'cpuutilization', 'cpu_utilization', 'memoryutilization', 'memory_utilization', 'usedpercent', 'used_percent', 'diskutilization', 'usagepercent'];
const COST_KEYS = ['cost', 'monthlycost', 'monthly_cost', 'spend', 'costusd', 'estimatedcost'];

function pickNumeric(attrs: Record<string, string | number | boolean | null>, keys: string[]): number | null {
  for (const [k, v] of Object.entries(attrs)) {
    if (!keys.includes(k.toLowerCase())) continue;
    const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v)) ? Number(v) : null;
    if (n != null && Number.isFinite(n)) return n;
  }
  return null;
}

function pressureFrom(util: number | null): PressureLevel {
  if (util == null) return 'low';
  if (util >= 90) return 'critical';
  if (util >= 75) return 'high';
  if (util >= 50) return 'moderate';
  return 'low';
}

export interface CapacitySignal {
  id: string;
  label: string;
  resourceType: string;
  utilization: number | null;
  cost: number | null;
  pressure: PressureLevel;
}
export interface CapacityGrowth {
  resources: number;
  previous: number | null;
  delta: number | null;
  ratePct: number | null;
}
export interface CapacityReport {
  signals: CapacitySignal[];
  pressureNodes: CapacitySignal[];
  utilizationAvg: number | null;
  costTotal: number;
  costOutliers: CapacitySignal[];
  growth: CapacityGrowth;
  recommendations: string[];
  /** 0–100 (higher = more capacity pressure). */
  pressureScore: number;
  builtAt: string;
}

export interface CapacityInput {
  resources: CloudResource[];
  /** Prior resource count (from a snapshot) to derive growth; null when unavailable. */
  previousResourceCount?: number | null;
}

const clamp = (n: number): number => Math.max(0, Math.min(100, Math.round(n)));

/** Compute capacity pressure, utilization, cost, and growth from discovered resources. */
export function computeEnterpriseCapacity(input: CapacityInput, nowMs: number): CapacityReport {
  const signals: CapacitySignal[] = input.resources.map((r) => {
    const utilization = pickNumeric(r.attributes, UTIL_KEYS);
    const cost = pickNumeric(r.attributes, COST_KEYS);
    return { id: r.id, label: r.name, resourceType: r.resourceType, utilization, cost, pressure: pressureFrom(utilization) };
  });

  const utils = signals.map((s) => s.utilization).filter((u): u is number => u != null);
  const utilizationAvg = utils.length ? Math.round(utils.reduce((a, b) => a + b, 0) / utils.length) : null;
  const costs = signals.map((s) => s.cost).filter((c): c is number => c != null);
  const costTotal = Math.round(costs.reduce((a, b) => a + b, 0));
  const costThreshold = costs.length ? (costs.reduce((a, b) => a + b, 0) / costs.length) * 2 : Infinity;

  const pressureNodes = signals.filter((s) => s.pressure === 'high' || s.pressure === 'critical').sort((a, b) => (b.utilization ?? 0) - (a.utilization ?? 0)).slice(0, 25);
  const costOutliers = signals.filter((s) => s.cost != null && s.cost >= costThreshold).sort((a, b) => (b.cost ?? 0) - (a.cost ?? 0)).slice(0, 15);

  const prev = input.previousResourceCount ?? null;
  const growth: CapacityGrowth = {
    resources: input.resources.length,
    previous: prev,
    delta: prev != null ? input.resources.length - prev : null,
    ratePct: prev != null && prev > 0 ? Math.round(((input.resources.length - prev) / prev) * 100) : null,
  };

  const recommendations: string[] = [];
  for (const n of pressureNodes.slice(0, 5)) recommendations.push(`Scale or rebalance ${n.label} (${n.utilization ?? '?'}% utilization, ${n.pressure} pressure).`);
  if (costOutliers.length) recommendations.push(`Review ${costOutliers.length} high-cost resource(s) — top: ${costOutliers[0].label}.`);
  if (growth.ratePct != null && growth.ratePct >= 20) recommendations.push(`Resource footprint grew ${growth.ratePct}% — plan capacity headroom.`);
  if (!recommendations.length) recommendations.push('No capacity pressure detected across discovered resources.');

  const criticalCount = signals.filter((s) => s.pressure === 'critical').length;
  const highCount = signals.filter((s) => s.pressure === 'high').length;
  const pressureScore = clamp((utilizationAvg ?? 0) * 0.5 + criticalCount * 6 + highCount * 3);

  return { signals, pressureNodes, utilizationAvg, costTotal, costOutliers, growth, recommendations, pressureScore, builtAt: new Date(nowMs).toISOString() };
}

export function capacityKpis(report: CapacityReport): ExecutiveKpi[] {
  const band: ExecutiveKpi['band'] = report.pressureScore >= 75 ? 'critical' : report.pressureScore >= 50 ? 'at-risk' : report.pressureScore >= 25 ? 'watch' : 'healthy';
  const kpis: ExecutiveKpi[] = [{ key: 'enterprise.capacity.pressure', label: 'Capacity Pressure', value: report.pressureScore, display: `${report.pressureScore}/100`, band }];
  if (report.utilizationAvg != null) kpis.push({ key: 'enterprise.capacity.utilization', label: 'Avg Utilization', value: report.utilizationAvg, display: `${report.utilizationAvg}%`, band: report.utilizationAvg >= 80 ? 'at-risk' : 'healthy' });
  if (report.costTotal > 0) kpis.push({ key: 'enterprise.capacity.cost', label: 'Tracked Spend', value: null, display: `$${report.costTotal.toLocaleString()}`, band: 'watch' });
  return kpis;
}
