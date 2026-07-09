/**
 * Time-Phased MRP — EXTENDS the Multi-Level MRP engine (`mrp.ts`) from "what to build"
 * to "WHEN to build/buy it". It does not replace `runMultiLevelMrp`, `runMrp`, `mrp.ts`,
 * or `planning.ts`; it builds on them, reusing `runMultiLevelMrp` (net requirements +
 * BOM structure), `buildBomMap`, `selectSupplier`, and `calculateCapacityPlan`.
 *
 * From each finished good's required date (the sales order's expected delivery date) it
 * BACKWARD-SCHEDULES down the BOM: release date = required date − lead time, and each
 * component's required date is its parent's release date. It computes deterministic lead
 * times (supplier lead + transport/safety buffers for purchased; setup + qty/rate + queue
 * + safety for produced), slack, late detection, and the critical path (the longest
 * cumulative lead-time chain, memoized + cycle-safe). It emits planned orders (with
 * release/completion dates), ten scheduling KPIs, and time-phased recommendations — each
 * carrying the calculations that produced it. Pure: the clock (`nowMs`) is injected, so
 * it is fully deterministic and unit-testable. Read-only; execution never occurs here.
 */
import type { ExecutiveKpi, ExecutiveRecommendation, ExecRecoPriority } from './executiveCenter';
import type { PlanningInput } from './planning';
import { calculateCapacityPlan } from './planning';
import type { MrpBomLine } from './mrp';
import { buildBomMap, runMultiLevelMrp, selectSupplier } from './mrp';

/* ── tunables (deterministic constants — explainable, never guessed) ─────────── */

export const SAFETY_BUFFER_DAYS = 2;
export const TRANSPORT_BUFFER_DAYS = 3;
export const PRODUCTION_SETUP_DAYS = 1;
export const DAILY_PRODUCTION_RATE = 50;
export const PRODUCTION_QUEUE_DAYS = 2;
export const DEFAULT_DEMAND_HORIZON_DAYS = 30;
export const DEFAULT_SUPPLIER_LEAD_DAYS = 14;
/** Slack above which a planned order is "too early" (schedule inefficiency). */
export const EARLY_SLACK_DAYS = 60;

const DAY_MS = 24 * 60 * 60 * 1000;
const clamp = (n: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, n));

function parseDay(d: string): number | null {
  if (!d) return null;
  const t = Date.parse(d);
  return Number.isFinite(t) ? t : null;
}
function addDays(ms: number, days: number): number {
  return ms + days * DAY_MS;
}
function toISODate(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}
function daysBetween(fromMs: number, toMs: number): number {
  return Math.round((toMs - fromMs) / DAY_MS);
}

/* ── deterministic lead time ────────────────────────────────────────────────── */

export interface LeadTimeInputs {
  isManufactured: boolean;
  netRequirement: number;
  supplierLeadDays: number;
  capacityConstrained: boolean;
}

/**
 * Deterministic total lead time (days). Purchased = supplier lead + transport + safety.
 * Produced = setup + ⌈qty / daily rate⌉ + queue (when capacity is constrained) + safety.
 */
export function calculateLeadTimeDays(opts: LeadTimeInputs): number {
  if (opts.isManufactured) {
    const production = PRODUCTION_SETUP_DAYS + Math.ceil(Math.max(1, opts.netRequirement) / DAILY_PRODUCTION_RATE);
    return production + (opts.capacityConstrained ? PRODUCTION_QUEUE_DAYS : 0) + SAFETY_BUFFER_DAYS;
  }
  return Math.max(1, opts.supplierLeadDays) + TRANSPORT_BUFFER_DAYS + SAFETY_BUFFER_DAYS;
}

/* ── typed outputs ──────────────────────────────────────────────────────────── */

export interface TimePhasedLine {
  sku: string;
  name: string;
  level: number;
  netRequirement: number;
  recommendation: MrpBomLine['recommendation'];
  leadTimeDays: number;
  requiredDate: string;
  releaseDate: string;
  completionDate: string;
  slackDays: number;
  late: boolean;
  onCriticalPath: boolean;
  supplier: string;
}

export interface PlannedOrder {
  type: 'purchase' | 'production';
  sku: string;
  name: string;
  quantity: number;
  requiredDate: string;
  releaseDate: string;
  completionDate: string;
  leadTimeDays: number;
  slackDays: number;
  late: boolean;
  onCriticalPath: boolean;
  supplier: string;
}

export interface TimePhasedPlan {
  lines: TimePhasedLine[];
  plannedOrders: PlannedOrder[];
  criticalPath: string[];
  criticalPathLeadDays: number;
  cycles: string[][];
}

/* ── critical path (longest cumulative lead-time chain, memoized + cycle-safe) ── */

function computeCriticalPath(
  lines: MrpBomLine[],
  bomMap: ReturnType<typeof buildBomMap>,
  leadTime: Map<string, number>,
  netBySku: Map<string, number>,
): { path: string[]; total: number } {
  const memo = new Map<string, { total: number; chain: string[] }>();
  const walk = (sku: string, visiting: Set<string>): { total: number; chain: string[] } => {
    if (visiting.has(sku)) return { total: 0, chain: [] }; // cycle guard
    const cached = memo.get(sku);
    if (cached) return cached;
    const lead = leadTime.get(sku) ?? 0;
    const bom = bomMap.get(sku);
    let best = { total: 0, chain: [] as string[] };
    if (bom) {
      const next = new Set(visiting).add(sku);
      for (const c of [...bom.components].sort((a, b) => a.sku.localeCompare(b.sku))) {
        if ((netBySku.get(c.sku) ?? 0) <= 0) continue; // only planned components
        const r = walk(c.sku, next);
        if (r.total > best.total) best = r;
      }
    }
    const result = { total: lead + best.total, chain: [sku, ...best.chain] };
    memo.set(sku, result);
    return result;
  };

  const planned = lines.filter((l) => l.netRequirement > 0).sort((a, b) => a.level - b.level || a.sku.localeCompare(b.sku));
  let best = { total: 0, chain: [] as string[] };
  for (const l of planned.filter((l) => l.level === 0)) {
    const r = walk(l.sku, new Set());
    if (r.total > best.total) best = r;
  }
  if (best.chain.length === 0) {
    for (const l of planned) {
      const r = walk(l.sku, new Set());
      if (r.total > best.total) best = r;
    }
  }
  return { path: best.chain, total: best.total };
}

/* ── the time-phased plan (backward scheduling) ─────────────────────────────── */

/**
 * Backward-schedule the multi-level MRP against a clock (`nowMs`, injected for purity).
 * Finished-goods required dates come from their sales orders; release = required − lead;
 * each component's required date is its parent's release date (it must be on hand when the
 * parent order releases). Only net shortages become planned orders. Deterministic.
 */
export function computeTimePhasedMrp(input: PlanningInput, nowMs: number): TimePhasedPlan {
  const result = runMultiLevelMrp(input);
  const bomMap = buildBomMap(input.boms);
  const supplier = selectSupplier(input.suppliers);
  const supplierLeadDays = supplier ? supplier.leadTime : DEFAULT_SUPPLIER_LEAD_DAYS;
  const capacityConstrained = calculateCapacityPlan(input.machines).some((c) => c.constrained);
  const netBySku = new Map(result.lines.map((l) => [l.sku, l.netRequirement]));

  const leadTime = new Map<string, number>();
  for (const line of result.lines) {
    leadTime.set(line.sku, calculateLeadTimeDays({ isManufactured: line.isManufactured, netRequirement: line.netRequirement, supplierLeadDays, capacityConstrained }));
  }

  // Seed finished-good required dates from their sales orders (earliest wins).
  const requiredMs = new Map<string, number>();
  for (const line of result.lines) {
    if (line.level !== 0 || line.independentDemand <= 0) continue;
    const dates = input.salesOrders
      .filter((o) => o.product === line.sku && o.status === 'pending' && o.expectedDeliveryDate)
      .map((o) => parseDay(o.expectedDeliveryDate))
      .filter((d): d is number => d !== null);
    requiredMs.set(line.sku, dates.length > 0 ? Math.min(...dates) : addDays(nowMs, DEFAULT_DEMAND_HORIZON_DAYS));
  }

  // Backward pass — parents (lower low-level code) before children.
  const releaseMs = new Map<string, number>();
  const ordered = [...result.lines].sort((a, b) => a.level - b.level || a.sku.localeCompare(b.sku));
  for (const line of ordered) {
    if (line.netRequirement <= 0) continue;
    const req = requiredMs.get(line.sku) ?? addDays(nowMs, DEFAULT_DEMAND_HORIZON_DAYS);
    requiredMs.set(line.sku, req);
    const rel = addDays(req, -(leadTime.get(line.sku) ?? 0));
    releaseMs.set(line.sku, rel);
    const bom = bomMap.get(line.sku);
    if (bom) {
      for (const c of bom.components) {
        if ((netBySku.get(c.sku) ?? 0) <= 0) continue;
        const existing = requiredMs.get(c.sku);
        requiredMs.set(c.sku, existing === undefined ? rel : Math.min(existing, rel));
      }
    }
  }

  const { path: criticalPath, total: criticalPathLeadDays } = computeCriticalPath(result.lines, bomMap, leadTime, netBySku);
  const critSet = new Set(criticalPath);

  const lines: TimePhasedLine[] = [];
  const plannedOrders: PlannedOrder[] = [];
  for (const line of result.lines) {
    const req = requiredMs.get(line.sku);
    const rel = releaseMs.get(line.sku);
    const lead = leadTime.get(line.sku) ?? 0;
    const scheduled = line.netRequirement > 0 && req !== undefined && rel !== undefined;
    const requiredDate = req !== undefined ? toISODate(req) : '';
    const releaseDate = rel !== undefined ? toISODate(rel) : '';
    const completionDate = req !== undefined ? toISODate(req) : '';
    const slackDays = rel !== undefined ? daysBetween(nowMs, rel) : 0;
    const late = scheduled && slackDays < 0;
    const supplierName = line.recommendation === 'purchase' ? supplier?.name ?? '' : '';
    lines.push({
      sku: line.sku,
      name: line.name,
      level: line.level,
      netRequirement: line.netRequirement,
      recommendation: line.recommendation,
      leadTimeDays: lead,
      requiredDate,
      releaseDate,
      completionDate,
      slackDays,
      late,
      onCriticalPath: critSet.has(line.sku),
      supplier: supplierName,
    });
    if (scheduled) {
      plannedOrders.push({
        type: line.recommendation === 'produce' ? 'production' : 'purchase',
        sku: line.sku,
        name: line.name,
        quantity: line.netRequirement,
        requiredDate,
        releaseDate,
        completionDate,
        leadTimeDays: lead,
        slackDays,
        late,
        onCriticalPath: critSet.has(line.sku),
        supplier: supplierName,
      });
    }
  }
  plannedOrders.sort((a, b) => (parseDay(a.releaseDate) ?? 0) - (parseDay(b.releaseDate) ?? 0) || a.sku.localeCompare(b.sku));

  return { lines, plannedOrders, criticalPath, criticalPathLeadDays, cycles: result.cycles };
}

/* ── aggregate insights (Executive Center) ─────────────────────────────────── */

export interface TimePhasedInsights {
  planningScheduleAccuracy: number;
  lateOrderRisk: number;
  capacityReadiness: number;
  supplierReadiness: number;
  productionReadiness: number;
  materialReadiness: number;
  onTimeProbability: number;
  scheduleConfidence: number;
  planningEfficiency: number;
  overallPlanningScore: number;
}

function pctOnTime(orders: PlannedOrder[]): number {
  if (orders.length === 0) return 100;
  return clamp(Math.round((orders.filter((o) => !o.late).length / orders.length) * 100), 0, 100);
}

/** Roll the time-phased plan into the Executive scheduling KPIs. Pure. */
export function deriveTimePhasedInsights(input: PlanningInput, nowMs: number): TimePhasedInsights {
  const plan = computeTimePhasedMrp(input, nowMs);
  const orders = plan.plannedOrders;
  const production = orders.filter((o) => o.type === 'production');
  const purchase = orders.filter((o) => o.type === 'purchase');
  const finishedGoods = orders.filter((o) => o.onCriticalPath || plan.lines.find((l) => l.sku === o.sku)?.level === 0);

  const planningScheduleAccuracy = pctOnTime(orders);
  const lateOrderRisk = orders.length === 0 ? 0 : clamp(Math.round((orders.filter((o) => o.late).length / orders.length) * 100), 0, 100);

  const capacity = calculateCapacityPlan(input.machines);
  const capacityReadiness = capacity.length === 0 ? 100 : clamp(Math.round((capacity.filter((c) => !c.constrained).length / capacity.length) * 100), 0, 100);
  const activeSuppliers = input.suppliers.filter((s) => s.status === 'active').length;
  const supplierReadiness = input.suppliers.length === 0 ? 100 : clamp(Math.round((activeSuppliers / input.suppliers.length) * 100), 0, 100);

  const productionReadiness = pctOnTime(production);
  const materialReadiness = pctOnTime(purchase);
  const onTimeProbability = pctOnTime(finishedGoods);
  const scheduleConfidence = clamp(Math.round((planningScheduleAccuracy + capacityReadiness) / 2), 0, 100);
  const wellTimed = orders.filter((o) => !o.late && o.slackDays <= EARLY_SLACK_DAYS).length;
  const planningEfficiency = orders.length === 0 ? 100 : clamp(Math.round((wellTimed / orders.length) * 100), 0, 100);
  const overallPlanningScore = clamp(
    Math.round((planningScheduleAccuracy + capacityReadiness + supplierReadiness + productionReadiness + materialReadiness) / 5),
    0,
    100,
  );

  return {
    planningScheduleAccuracy,
    lateOrderRisk,
    capacityReadiness,
    supplierReadiness,
    productionReadiness,
    materialReadiness,
    onTimeProbability,
    scheduleConfidence,
    planningEfficiency,
    overallPlanningScore,
  };
}

/** Map time-phased insights to Executive Center KPI tiles (reuses the existing KPI type). */
export function timePhasedInsightsToKpis(insights: TimePhasedInsights): ExecutiveKpi[] {
  const pctBand = (v: number): ExecutiveKpi['band'] => (v >= 90 ? 'healthy' : v >= 75 ? 'watch' : 'at-risk');
  const riskBand: ExecutiveKpi['band'] = insights.lateOrderRisk <= 10 ? 'healthy' : insights.lateOrderRisk <= 25 ? 'watch' : 'at-risk';
  return [
    { key: 'tp-schedule-accuracy', label: 'Planning Schedule Accuracy', value: insights.planningScheduleAccuracy, display: `${insights.planningScheduleAccuracy}%`, band: pctBand(insights.planningScheduleAccuracy), deepLink: 'enterprise/executive' },
    { key: 'tp-late-risk', label: 'Late Order Risk', value: insights.lateOrderRisk, display: `${insights.lateOrderRisk}%`, band: riskBand, deepLink: 'enterprise/executive' },
    { key: 'tp-capacity-ready', label: 'Capacity Readiness', value: insights.capacityReadiness, display: `${insights.capacityReadiness}%`, band: pctBand(insights.capacityReadiness), deepLink: 'enterprise/executive' },
    { key: 'tp-supplier-ready', label: 'Supplier Readiness', value: insights.supplierReadiness, display: `${insights.supplierReadiness}%`, band: pctBand(insights.supplierReadiness), deepLink: 'enterprise/executive' },
    { key: 'tp-production-ready', label: 'Production Readiness', value: insights.productionReadiness, display: `${insights.productionReadiness}%`, band: pctBand(insights.productionReadiness), deepLink: 'enterprise/executive' },
    { key: 'tp-material-ready', label: 'Material Readiness', value: insights.materialReadiness, display: `${insights.materialReadiness}%`, band: pctBand(insights.materialReadiness), deepLink: 'enterprise/executive' },
    { key: 'tp-ontime-prob', label: 'On-Time Probability', value: insights.onTimeProbability, display: `${insights.onTimeProbability}%`, band: pctBand(insights.onTimeProbability), deepLink: 'enterprise/executive' },
    { key: 'tp-confidence', label: 'Schedule Confidence', value: insights.scheduleConfidence, display: `${insights.scheduleConfidence}%`, band: pctBand(insights.scheduleConfidence), deepLink: 'enterprise/executive' },
    { key: 'tp-efficiency', label: 'Planning Efficiency', value: insights.planningEfficiency, display: `${insights.planningEfficiency}%`, band: pctBand(insights.planningEfficiency), deepLink: 'enterprise/executive' },
    { key: 'tp-overall', label: 'Overall Planning Score', value: insights.overallPlanningScore, display: `${insights.overallPlanningScore}`, band: pctBand(insights.overallPlanningScore), deepLink: 'enterprise/executive' },
  ];
}

/* ── recommendations (flow into the existing Executive recommendation system) ── */

function rank(priority: ExecRecoPriority, confidence: number): number {
  const base: Record<ExecRecoPriority, number> = { critical: 1000, high: 700, medium: 400, low: 100 };
  return Math.round(base[priority] + confidence * 100);
}

/**
 * Deterministic time-phased recommendations — release-now / late-risk / delay / bottleneck
 * / alternate-supplier — from the backward schedule. Each carries the dates + slack that
 * produced it, and flows through the EXISTING Executive recommendation + timeline system.
 * AI explains these scheduling decisions; it never computes or schedules.
 */
export function timePhasedRecommendations(input: PlanningInput, nowMs: number, limit = 15): ExecutiveRecommendation[] {
  const plan = computeTimePhasedMrp(input, nowMs);
  const recs: ExecutiveRecommendation[] = [];
  const altSupplier = selectSupplier(input.suppliers);
  const bottlenecks = calculateCapacityPlan(input.machines).filter((c) => c.constrained).map((c) => c.machine).sort();

  for (const o of plan.plannedOrders) {
    const evidence = [
      `required=${o.requiredDate}`,
      `release=${o.releaseDate}`,
      `leadTime=${o.leadTimeDays}d`,
      `slack=${o.slackDays}d`,
      o.onCriticalPath ? 'criticalPath=yes' : 'criticalPath=no',
    ];
    const purchase = o.type === 'purchase';
    const verb = purchase ? 'purchase order' : 'production order';
    if (o.late) {
      const priority: ExecRecoPriority = o.onCriticalPath ? 'critical' : 'high';
      recs.push({
        id: `tp:late:${o.sku}`,
        metric: purchase ? 'procurement' : 'production',
        icon: 'clock',
        problem: `Risk of late delivery — ${o.name} (${o.sku}) release date ${o.releaseDate} is ${Math.abs(o.slackDays)}d in the past.`,
        businessImpact: `The ${verb} is behind schedule; downstream ${o.onCriticalPath ? 'critical-path ' : ''}demand will be late.`,
        rootCause: `Required ${o.requiredDate} − lead time ${o.leadTimeDays}d = release ${o.releaseDate}, which has passed.`,
        priority,
        confidence: 0.95,
        expectedOutcome: purchase
          ? `Release the ${verb} for ${o.quantity} of ${o.sku} today${altSupplier ? ` (or use a faster supplier than ${altSupplier.name} ~${altSupplier.leadTime}d)` : ''} to recover the schedule.`
          : `Start production of ${o.quantity} of ${o.sku} today and expedite the critical path.`,
        evidence,
        sourceSystems: ['planning', 'mrp', purchase ? 'procurement' : 'manufacturing'],
        recommendedAction: `Release the ${verb} for ${o.quantity} of ${o.sku} today.`,
        owner: purchase ? 'Procurement' : 'Production Planner',
        eta: 'today',
        status: 'open',
        score: rank(priority, 0.95),
      });
    } else if (o.slackDays <= 1) {
      recs.push({
        id: `tp:release:${o.sku}`,
        metric: purchase ? 'procurement' : 'production',
        icon: 'calendar',
        problem: `Release ${verb} today — ${o.name} (${o.sku}) is due to release on ${o.releaseDate}.`,
        businessImpact: 'Releasing on time keeps the delivery schedule intact.',
        rootCause: `Required ${o.requiredDate} − lead time ${o.leadTimeDays}d = release ${o.releaseDate} (now).`,
        priority: 'high',
        confidence: 0.9,
        expectedOutcome: `Availability by ${o.completionDate}.`,
        evidence,
        sourceSystems: ['planning', 'mrp', purchase ? 'procurement' : 'manufacturing'],
        recommendedAction: `Release the ${verb} for ${o.quantity} of ${o.sku} (release date ${o.releaseDate}).`,
        owner: purchase ? 'Procurement' : 'Production Planner',
        eta: 'today',
        status: 'open',
        score: rank('high', 0.9),
      });
    } else if (o.slackDays > EARLY_SLACK_DAYS) {
      recs.push({
        id: `tp:delay:${o.sku}`,
        metric: purchase ? 'procurement' : 'production',
        icon: 'clock',
        problem: `${o.name} (${o.sku}) can be delayed — ${o.slackDays}d of slack before its ${o.releaseDate} release.`,
        businessImpact: 'Releasing early ties up cash and capacity; delaying frees both.',
        rootCause: `Release ${o.releaseDate} is ${o.slackDays}d after today.`,
        priority: 'low',
        confidence: 0.85,
        expectedOutcome: `Hold the ${verb} until nearer ${o.releaseDate}.`,
        evidence,
        sourceSystems: ['planning', 'mrp'],
        recommendedAction: `Delay the ${verb} for ${o.sku}; release around ${o.releaseDate}.`,
        owner: purchase ? 'Procurement' : 'Production Planner',
        eta: 'this month',
        status: 'open',
        score: rank('low', 0.85),
      });
    }
  }

  if (bottlenecks.length > 0 && plan.plannedOrders.some((o) => o.type === 'production')) {
    recs.push({
      id: `tp:bottleneck:${bottlenecks.join(',')}`,
      metric: 'capacity',
      icon: 'activity',
      problem: `Machine bottleneck — reschedule production around ${bottlenecks.join(', ')}.`,
      businessImpact: 'A constrained machine adds queue time and pushes out production releases.',
      rootCause: 'Capacity-constrained machines carry an added production queue buffer in the schedule.',
      priority: 'medium',
      confidence: 0.85,
      expectedOutcome: 'Off-loading or re-sequencing recovers schedule slack on the critical path.',
      evidence: [`bottlenecks=${bottlenecks.join(',')}`, `queueBuffer=${PRODUCTION_QUEUE_DAYS}d`],
      sourceSystems: ['planning', 'mrp', 'manufacturing', 'maintenance'],
      recommendedAction: `Re-schedule production off ${bottlenecks.join(', ')} or add capacity.`,
      owner: 'Production Planner',
      eta: 'this week',
      status: 'open',
      score: rank('medium', 0.85),
    });
  }

  return recs.sort((a, b) => b.score - a.score).slice(0, limit);
}
