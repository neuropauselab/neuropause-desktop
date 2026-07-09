/**
 * Manufacturing Digital Twin — a READ-ONLY, PURE, DETERMINISTIC what-if simulation engine. It
 * lets executives ask "what happens if …" against the REAL production model without ever touching
 * it: it deep-CLONES the planning inputs + routings, applies a deterministic scenario perturbation
 * to the clone, re-runs the EXISTING pure engines (`computeTimePhasedMrp`, `computeCapacitySchedule`,
 * `computeRoutingSchedule`) on the clone, and COMPARES the scenario against the baseline. It never
 * mutates production data, schedules, or inventory; it persists nothing; it commits nothing. Every
 * prediction is arithmetic over the two schedules — no random numbers, no ML, no fabricated data.
 *
 * It supports fifteen scenarios (machine failure, maintenance/supplier delay, material shortage,
 * demand ±, extra/reduced shift, operator loss, machine add/remove, scrap ±, routing change,
 * priority order); predicts completion date, machine utilization, order delay, inventory impact,
 * capacity usage, bottlenecks, downtime, revenue delay, late deliveries, and material risk; adds an
 * executive analysis (business impact, risk score, confidence, affected orders/customers/machines/
 * work centers/revenue); emits deterministic recommendations (each with evidence); and rolls a
 * standing resilience assessment into seven Executive KPIs. The AI explains the simulation and its
 * trade-offs; it never changes a schedule. Planning, APS, MES, Inventory, and Maintenance remain the
 * authorities — the twin only predicts.
 */
import type { ExecutiveKpi, ExecutiveRecommendation, ExecRecoPriority } from './executiveCenter';
import type { PlanningInput } from './planning';
import type { Machine } from './manufacturing';
import type { SalesOrder } from './orders';
import { computeTimePhasedMrp, type TimePhasedPlan } from './timePhasedMrp';
import { computeCapacitySchedule, deriveCapacityInsights, type CapacitySchedule, type CapacityInsights } from './capacityScheduler';
import { computeRoutingSchedule, type Routing, type RoutingSchedule } from './routing';

/* ── scenarios ─────────────────────────────────────────────────────────────── */

export type TwinScenarioType =
  | 'machine_failure'
  | 'maintenance_delay'
  | 'supplier_delay'
  | 'material_shortage'
  | 'demand_increase'
  | 'demand_decrease'
  | 'extra_shift'
  | 'reduced_shift'
  | 'operator_loss'
  | 'machine_addition'
  | 'machine_removal'
  | 'scrap_increase'
  | 'scrap_reduction'
  | 'routing_change'
  | 'priority_order';

export const TWIN_SCENARIO_TYPES: readonly TwinScenarioType[] = [
  'machine_failure',
  'maintenance_delay',
  'supplier_delay',
  'material_shortage',
  'demand_increase',
  'demand_decrease',
  'extra_shift',
  'reduced_shift',
  'operator_loss',
  'machine_addition',
  'machine_removal',
  'scrap_increase',
  'scrap_reduction',
  'routing_change',
  'priority_order',
];

export interface TwinScenario {
  type: TwinScenarioType;
  /** Machine name / SKU / supplier name / order number — scenario-specific. Resolved if omitted. */
  target?: string;
  /** Days / units / percent / count — scenario-specific. Defaulted if omitted. */
  magnitude?: number;
  label?: string;
}

/* ── helpers ───────────────────────────────────────────────────────────────── */

const DAY_MS = 24 * 60 * 60 * 1000;
const clamp = (n: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, n));
const CAPACITY_PER_MACHINE = 240; // MACHINE_HOURS_PER_DAY(8) × SCHEDULE_HORIZON_DAYS(30)

function parseDay(d: string): number | null {
  if (!d) return null;
  const t = Date.parse(d);
  return Number.isFinite(t) ? t : null;
}
function toISODate(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}
function daysBetween(fromMs: number, toMs: number): number {
  return Math.round((toMs - fromMs) / DAY_MS);
}
function clone<T>(x: T): T {
  return JSON.parse(JSON.stringify(x)) as T;
}
const WORKING = new Set(['running', 'idle']);

/* ── the baseline bundle (the existing engines, run once) ──────────────────────── */

export interface TwinBaseline {
  cap: CapacitySchedule;
  capInsights: CapacityInsights;
  tp: TimePhasedPlan;
  routing: RoutingSchedule | null;
}

/** Run the existing pure engines to produce the baseline schedule bundle. Read-only. */
export function computeTwinBaseline(input: PlanningInput, routings: Routing[], nowMs: number): TwinBaseline {
  const cap = computeCapacitySchedule(input, nowMs);
  return {
    cap,
    capInsights: deriveCapacityInsights(cap),
    tp: computeTimePhasedMrp(input, nowMs),
    routing: routings.length > 0 ? computeRoutingSchedule(input, routings, nowMs) : null,
  };
}

interface ScheduleSurface {
  finish: Map<string, number>;
  late: Set<string>;
  unscheduled: Set<string>;
  netUnits: number;
  latePurchase: number;
  totalPurchase: number;
}

/** Reduce a baseline bundle to the per-SKU finish/late surface used for comparison. */
function surfaceOf(b: TwinBaseline, nowMs: number): ScheduleSurface {
  const finish = new Map<string, number>();
  const late = new Set<string>();
  const unscheduled = new Set<string>();
  const horizonMs = nowMs + b.cap.horizonDays * DAY_MS;
  for (const op of b.cap.operations) {
    const ms = parseDay(op.finishDate);
    if (ms !== null) finish.set(op.sku, Math.max(finish.get(op.sku) ?? 0, ms));
    if (op.late) late.add(op.sku);
  }
  for (const o of b.cap.unscheduled) {
    unscheduled.add(o.sku);
    late.add(o.sku);
    if (!finish.has(o.sku)) finish.set(o.sku, horizonMs + 30 * DAY_MS); // unplaceable ⇒ far beyond horizon
  }
  if (b.routing) {
    for (const p of b.routing.schedules) {
      const ms = parseDay(p.plannedFinish);
      if (ms !== null) finish.set(p.product, ms);
      if (p.late || p.status !== 'planned') late.add(p.product);
      if (p.status === 'blocked' || p.status === 'unrouted') {
        unscheduled.add(p.product);
        if (!ms) finish.set(p.product, horizonMs + 30 * DAY_MS);
      }
    }
  }
  const purchase = b.tp.plannedOrders.filter((o) => o.type === 'purchase');
  return {
    finish,
    late,
    unscheduled,
    netUnits: b.tp.plannedOrders.reduce((s, o) => s + Math.max(0, o.quantity), 0),
    latePurchase: purchase.filter((o) => o.late).length,
    totalPurchase: purchase.length,
  };
}

/* ── scenario resolution + application (on a CLONE — production is never touched) ── */

function busiestMachine(baseline: TwinBaseline): string {
  const avail = baseline.cap.machineLoads.filter((l) => l.available);
  if (avail.length === 0) return '';
  return [...avail].sort((a, b) => b.utilization - a.utilization || a.machine.localeCompare(b.machine))[0].machine;
}
function topDemandSku(input: PlanningInput): string {
  const byS = new Map<string, number>();
  for (const o of input.salesOrders) if (o.status === 'pending') byS.set(o.product, (byS.get(o.product) ?? 0) + Math.max(0, o.orderedQty));
  return [...byS.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] ?? input.products[0]?.sku ?? '';
}

/** Fill in a deterministic default target + magnitude for a scenario. */
export function resolveScenario(scenario: TwinScenario, input: PlanningInput, baseline: TwinBaseline): Required<Omit<TwinScenario, 'label'>> & { label: string } {
  const defMag: Record<TwinScenarioType, number> = {
    machine_failure: 0,
    maintenance_delay: 40,
    supplier_delay: 14,
    material_shortage: 50,
    demand_increase: 50,
    demand_decrease: 30,
    extra_shift: 0,
    reduced_shift: 1,
    operator_loss: 1,
    machine_addition: 1,
    machine_removal: 0,
    scrap_increase: 10,
    scrap_reduction: 10,
    routing_change: 25,
    priority_order: 14,
  };
  let target = scenario.target ?? '';
  if (!target) {
    if (scenario.type === 'machine_failure' || scenario.type === 'machine_removal' || scenario.type === 'maintenance_delay') target = busiestMachine(baseline);
    else if (scenario.type === 'supplier_delay') target = input.suppliers.find((s) => s.status === 'active')?.name ?? '';
    else if (['material_shortage', 'demand_increase', 'demand_decrease', 'scrap_increase', 'scrap_reduction', 'routing_change', 'priority_order'].includes(scenario.type)) target = topDemandSku(input);
  }
  return { type: scenario.type, target, magnitude: scenario.magnitude ?? defMag[scenario.type], label: scenario.label ?? scenario.type.replace(/_/g, ' ') };
}

/**
 * Apply a scenario to a DEEP CLONE of the inputs and return the perturbed clone. The originals are
 * never mutated (JSON clone). Every perturbation maps to a field the existing engines already read.
 */
export function applyScenario(
  input: PlanningInput,
  routings: Routing[],
  scenario: Required<Omit<TwinScenario, 'label'>>,
): { input: PlanningInput; routings: Routing[] } {
  const pIn = clone(input);
  const pR = clone(routings);
  const mag = scenario.magnitude;
  const t = scenario.target;

  switch (scenario.type) {
    case 'machine_failure':
    case 'machine_removal': {
      const m = pIn.machines.find((x) => x.name === t || x.code === t);
      if (m) m.status = scenario.type === 'machine_failure' ? 'breakdown' : 'down';
      break;
    }
    case 'maintenance_delay': {
      const m = pIn.machines.find((x) => x.name === t || x.code === t);
      if (m) m.downtime = m.downtime + mag; // deferred service ⇒ degraded availability
      break;
    }
    case 'reduced_shift':
    case 'operator_loss': {
      // Fewer shifts/operators ⇒ that many working machines cannot run.
      let removed = 0;
      for (const m of pIn.machines) {
        if (removed >= mag) break;
        if (WORKING.has(m.status)) {
          m.status = 'down';
          removed += 1;
        }
      }
      break;
    }
    case 'extra_shift': {
      // A second shift ≈ a second identical machine's worth of hours per working machine.
      const shadows: Machine[] = pIn.machines
        .filter((m) => WORKING.has(m.status))
        .map((m) => ({ ...m, id: `${m.id}-s2`, name: `${m.name}-S2`, code: `${m.code}-S2`, status: 'running' }));
      pIn.machines.push(...shadows);
      break;
    }
    case 'machine_addition': {
      const template = pIn.machines.find((m) => WORKING.has(m.status)) ?? pIn.machines[0];
      for (let i = 0; i < Math.max(1, mag); i++) {
        if (template) pIn.machines.push({ ...template, id: `${template.id}-add${i}`, name: `NEW-${i + 1}`, code: `NEW-${i + 1}`, status: 'running' });
      }
      break;
    }
    case 'supplier_delay': {
      for (const s of pIn.suppliers) if ((!t || s.name === t) && s.status === 'active') s.leadTime = Math.max(0, s.leadTime + mag);
      break;
    }
    case 'material_shortage': {
      for (const p of pIn.products) {
        if (p.sku !== t) continue;
        const factor = 1 - clamp(mag, 0, 100) / 100;
        p.availableStock = Math.max(0, Math.round(p.availableStock * factor));
        p.currentStock = Math.max(0, Math.round(p.currentStock * factor));
      }
      break;
    }
    case 'demand_increase':
    case 'demand_decrease':
    case 'scrap_increase':
    case 'scrap_reduction': {
      // Demand ± directly; scrap ± inflates/deflates required output (more scrap ⇒ build more).
      const up = scenario.type === 'demand_increase' || scenario.type === 'scrap_increase';
      const factor = up ? 1 + mag / 100 : 1 - mag / 100;
      const scoped = scenario.type === 'demand_increase' || scenario.type === 'demand_decrease' ? null : t; // scrap targets a SKU
      for (const o of pIn.salesOrders) {
        if (o.status !== 'pending') continue;
        if (scoped && o.product !== scoped) continue;
        o.orderedQty = Math.max(0, Math.round(o.orderedQty * factor));
      }
      break;
    }
    case 'routing_change': {
      for (const r of pR) {
        if (r.product !== t) continue;
        for (const op of r.operations) {
          op.setupTime = Math.max(0, op.setupTime * (1 + mag / 100));
          op.runTimePerUnit = Math.max(0, op.runTimePerUnit * (1 + mag / 100));
        }
      }
      break;
    }
    case 'priority_order': {
      for (const o of pIn.salesOrders) {
        if (o.status !== 'pending') continue;
        if (o.orderNumber !== t && o.product !== t) continue;
        const due = parseDay(o.expectedDeliveryDate);
        if (due !== null) o.expectedDeliveryDate = toISODate(due - mag * DAY_MS); // pull the due date in
      }
      break;
    }
  }
  return { input: pIn, routings: pR };
}

/* ── the simulation (baseline vs scenario) ─────────────────────────────────── */

export interface SimulationPredictions {
  completionDateBaseline: string;
  completionDateScenario: string;
  completionDelayDays: number;
  machineUtilization: number;
  machineUtilizationDelta: number;
  capacityUsage: number;
  maxOrderDelayDays: number;
  totalDelayDays: number;
  lateDeliveries: number;
  bottlenecks: string[];
  addedDowntimeHours: number;
  inventoryImpactUnits: number;
  materialRisk: number;
  revenueDelay: number;
}

export interface ExecutiveAnalysis {
  businessImpact: string;
  riskScore: number;
  confidence: number;
  affectedOrders: string[];
  affectedCustomers: string[];
  affectedMachines: string[];
  affectedWorkCenters: string[];
  affectedRevenue: number;
}

export interface SimulationResult {
  scenario: Required<Omit<TwinScenario, 'label'>> & { label: string };
  predictions: SimulationPredictions;
  analysis: ExecutiveAnalysis;
  recommendations: ExecutiveRecommendation[];
}

function completionDate(surface: ScheduleSurface): number {
  let max = 0;
  for (const ms of surface.finish.values()) max = Math.max(max, ms);
  return max;
}
function pendingOrdersForSkus(orders: SalesOrder[], skus: Set<string>): SalesOrder[] {
  return orders.filter((o) => o.status === 'pending' && skus.has(o.product));
}

function rank(priority: ExecRecoPriority, confidence: number): number {
  const base: Record<ExecRecoPriority, number> = { critical: 1000, high: 700, medium: 400, low: 100 };
  return Math.round(base[priority] + confidence * 100);
}

/**
 * Run one what-if scenario against the real model. Deep-clones + perturbs + re-runs the engines +
 * compares. Pure and read-only — pass a precomputed `baseline` to avoid recomputing it.
 */
export function runSimulation(input: PlanningInput, routings: Routing[], scenario: TwinScenario, nowMs: number, baseline?: TwinBaseline): SimulationResult {
  const base = baseline ?? computeTwinBaseline(input, routings, nowMs);
  const resolved = resolveScenario(scenario, input, base);
  const perturbed = applyScenario(input, routings, resolved);
  const scen = computeTwinBaseline(perturbed.input, perturbed.routings, nowMs);

  const bs = surfaceOf(base, nowMs);
  const ss = surfaceOf(scen, nowMs);

  const skus = new Set<string>([...bs.finish.keys(), ...ss.finish.keys()]);
  let maxOrderDelayDays = 0;
  let totalDelayDays = 0;
  const affected: string[] = [];
  const horizonMs = nowMs + base.cap.horizonDays * DAY_MS;
  for (const sku of skus) {
    const bf = bs.finish.get(sku) ?? horizonMs;
    const sf = ss.finish.get(sku) ?? bf;
    const d = daysBetween(bf, sf);
    if (d > 0) {
      maxOrderDelayDays = Math.max(maxOrderDelayDays, d);
      totalDelayDays += d;
      affected.push(sku);
    }
  }
  affected.sort();

  const newlyLate = [...ss.late].filter((sku) => !bs.late.has(sku));
  const baselineBottlenecks = new Set(base.cap.machineLoads.filter((l) => l.bottleneck).map((l) => l.machine));
  const bottlenecks = scen.cap.machineLoads.filter((l) => l.bottleneck && !baselineBottlenecks.has(l.machine)).map((l) => l.machine).sort();

  const baseAvail = base.cap.machineLoads.filter((l) => l.available).length;
  const scenAvail = scen.cap.machineLoads.filter((l) => l.available).length;
  const addedDowntimeHours = Math.max(0, baseAvail - scenAvail) * CAPACITY_PER_MACHINE;

  const affectedSkuSet = new Set([...affected, ...newlyLate]);
  const affectedOrdersList = pendingOrdersForSkus(input.salesOrders, affectedSkuSet);
  const affectedRevenue = affectedOrdersList.reduce((s, o) => s + Math.max(0, o.total), 0);
  const affectedCustomers = [...new Set(affectedOrdersList.map((o) => o.customer).filter(Boolean))].sort();
  const totalRevenue = input.salesOrders.filter((o) => o.status === 'pending').reduce((s, o) => s + Math.max(0, o.total), 0);

  const targetMachine = base.cap.machineLoads.find((l) => l.machine === resolved.target);
  const affectedMachines = [...new Set([...(targetMachine ? [resolved.target] : []), ...bottlenecks])].sort();
  const wcByMachine = new Map(input.machines.map((m) => [m.name, m.workCenter]));
  const affectedWorkCenters = [...new Set(affectedMachines.map((m) => wcByMachine.get(m)).filter((w): w is string => !!w))].sort();

  const scenUtil = scen.capInsights.machineUtilization;
  const materialRisk = ss.totalPurchase === 0 ? 0 : clamp(Math.round((ss.latePurchase / ss.totalPurchase) * 100), 0, 100);
  const revenueSharePct = totalRevenue > 0 ? Math.round((affectedRevenue / totalRevenue) * 100) : 0;
  const riskScore = clamp(
    Math.round((Math.min(100, maxOrderDelayDays * 8) + Math.min(100, newlyLate.length * 15) + revenueSharePct + Math.min(100, scen.capInsights.capacityUsage)) / 4),
    0,
    100,
  );
  const confidence = clamp(0.6 + (input.machines.length > 0 ? 0.2 : 0) + (input.salesOrders.length > 0 ? 0.19 : 0), 0, 0.99);

  const bMs = completionDate(bs);
  const sMs = completionDate(ss);
  const predictions: SimulationPredictions = {
    completionDateBaseline: bMs > 0 ? toISODate(bMs) : '',
    completionDateScenario: sMs > 0 ? toISODate(sMs) : '',
    completionDelayDays: bMs > 0 && sMs > 0 ? Math.max(0, daysBetween(bMs, sMs)) : 0,
    machineUtilization: scenUtil,
    machineUtilizationDelta: scenUtil - base.capInsights.machineUtilization,
    capacityUsage: scen.capInsights.capacityUsage,
    maxOrderDelayDays,
    totalDelayDays,
    lateDeliveries: newlyLate.length,
    bottlenecks,
    addedDowntimeHours,
    inventoryImpactUnits: ss.netUnits - bs.netUnits,
    materialRisk,
    revenueDelay: affectedRevenue,
  };

  const impactParts = [
    predictions.completionDelayDays > 0 ? `completion slips ${predictions.completionDelayDays}d` : 'completion holds',
    `${newlyLate.length} newly-late order(s)`,
    affectedRevenue > 0 ? `${affectedRevenue.toLocaleString()} revenue at risk` : 'no revenue at risk',
  ];
  const analysis: ExecutiveAnalysis = {
    businessImpact: `${resolved.label}: ${impactParts.join(', ')}.`,
    riskScore,
    confidence,
    affectedOrders: [...affectedSkuSet].sort(),
    affectedCustomers,
    affectedMachines,
    affectedWorkCenters,
    affectedRevenue,
  };

  return { scenario: resolved, predictions, analysis, recommendations: buildScenarioRecommendations(resolved, predictions, scen) };
}

/* ── deterministic recommendations from a simulation result ────────────────── */

function buildScenarioRecommendations(
  scenario: Required<Omit<TwinScenario, 'label'>> & { label: string },
  p: SimulationPredictions,
  scen: TwinBaseline,
): ExecutiveRecommendation[] {
  const recs: ExecutiveRecommendation[] = [];
  const idle = scen.cap.machineLoads.find((l) => l.available && l.idleHours > 0 && !l.bottleneck);
  const overloaded = scen.cap.machineLoads.some((l) => l.overloaded);
  const push = (id: string, icon: string, priority: ExecRecoPriority, problem: string, action: string, owner: string, evidence: string[], sys: string[]): void => {
    recs.push({
      id: `twin:${scenario.type}:${id}`,
      metric: 'production',
      icon,
      problem,
      businessImpact: p.revenueDelay > 0 ? `${p.revenueDelay.toLocaleString()} revenue at risk across ${p.lateDeliveries} late order(s).` : `${p.lateDeliveries} order(s) at risk of lateness.`,
      rootCause: `Simulation "${scenario.label}": ${p.maxOrderDelayDays}d max delay, capacity usage ${p.capacityUsage}%.`,
      priority,
      confidence: 0.85,
      expectedOutcome: 'A deterministic mitigation that the twin predicts recovers schedule.',
      evidence,
      sourceSystems: sys,
      recommendedAction: action,
      owner,
      eta: priority === 'critical' ? 'today' : 'this week',
      status: 'open',
      score: rank(priority, 0.85),
    });
  };

  if (p.addedDowntimeHours > 0 && idle) {
    push('alternate', 'shuffle', 'high', `${scenario.label} removes capacity; ${idle.machine} has ${idle.idleHours}h idle.`, `Move affected work to ${idle.machine}.`, 'Production Planner', [`addedDowntime=${p.addedDowntimeHours}h`, `alternate=${idle.machine}(${idle.idleHours}h)`], ['planning', 'manufacturing']);
  }
  if (p.capacityUsage >= 85 || overloaded) {
    push('second-shift', 'clock', 'high', `${scenario.label} pushes capacity usage to ${p.capacityUsage}%.`, 'Authorize a second shift on the constrained work center.', 'Production Planner', [`capacityUsage=${p.capacityUsage}%`, `maxDelay=${p.maxOrderDelayDays}d`], ['planning', 'manufacturing']);
    push('split', 'scissors', 'medium', `${scenario.label} overloads production.`, 'Split the largest orders across machines.', 'Production Planner', [`capacityUsage=${p.capacityUsage}%`, `bottlenecks=${p.bottlenecks.join(',') || 'none'}`], ['planning', 'manufacturing']);
  }
  if (p.lateDeliveries > 0) {
    push('resequence', 'list', 'high', `${scenario.label} makes ${p.lateDeliveries} order(s) late.`, 'Resequence orders — critical-path and earliest-due first.', 'Production Planner', [`lateDeliveries=${p.lateDeliveries}`, `totalDelay=${p.totalDelayDays}d`], ['planning', 'manufacturing']);
    if (!idle && (p.capacityUsage >= 85 || overloaded)) {
      push('subcontract', 'external-link', 'medium', `${scenario.label} exceeds internal capacity with no idle machine.`, 'Subcontract the overflow to recover the due dates.', 'Procurement', [`lateDeliveries=${p.lateDeliveries}`, `capacityUsage=${p.capacityUsage}%`], ['planning', 'procurement']);
    }
  }
  if (p.materialRisk >= 25 || scenario.type === 'supplier_delay' || scenario.type === 'material_shortage') {
    push('inventory', 'package', 'high', `${scenario.label} raises material risk to ${p.materialRisk}%.`, 'Increase safety stock / expedite the affected supplier.', 'Procurement', [`materialRisk=${p.materialRisk}%`, `inventoryImpact=${p.inventoryImpactUnits}u`], ['planning', 'inventory', 'procurement']);
  }
  if (scenario.type === 'maintenance_delay') {
    const low = p.maxOrderDelayDays <= 2 && p.lateDeliveries === 0;
    push('maintenance', 'tool', low ? 'low' : 'high', low ? `Delaying maintenance on ${scenario.target} adds little risk (${p.maxOrderDelayDays}d).` : `Delaying maintenance on ${scenario.target} risks ${p.lateDeliveries} late order(s).`, low ? `Safe to delay maintenance on ${scenario.target} within the window.` : `Perform maintenance on ${scenario.target} now and re-sequence around it.`, 'Maintenance Planner', [`maxDelay=${p.maxOrderDelayDays}d`, `lateDeliveries=${p.lateDeliveries}`], ['manufacturing', 'maintenance']);
  }

  return recs.sort((a, b) => b.score - a.score);
}

/* ── standing resilience assessment (Executive Center) ─────────────────────── */

export interface ResilienceInsights {
  simulationRisk: number;
  manufacturingResilience: number;
  capacityReserve: number;
  deliveryConfidence: number;
  scheduleRobustness: number;
  inventoryBuffer: number;
  recoveryTimeDays: number;
}

export interface DigitalTwinAssessment {
  resilience: ResilienceInsights;
  recommendations: ExecutiveRecommendation[];
  baseline: TwinBaseline;
}

/** The standard stress battery the standing assessment runs against the cached baseline. */
const STRESS_BATTERY: TwinScenario[] = [
  { type: 'machine_failure' },
  { type: 'supplier_delay', magnitude: 14 },
  { type: 'demand_increase', magnitude: 25 },
];

/**
 * Assess manufacturing resilience by running the standard stress battery ONCE against a baseline
 * computed ONCE (no duplicated planning). Returns the seven resilience KPIs + the highest-impact
 * what-if recommendations. Pure + read-only.
 */
export function assessDigitalTwin(input: PlanningInput, routings: Routing[], nowMs: number): DigitalTwinAssessment {
  const baseline = computeTwinBaseline(input, routings, nowMs);
  const results = STRESS_BATTERY.map((s) => runSimulation(input, routings, s, nowMs, baseline));
  const failure = results[0]; // busiest-machine failure

  const totalOrders = baseline.cap.operations.length + baseline.cap.unscheduled.length;
  const capacityReserve = baseline.capInsights.idleCapacity;
  const deliveryConfidence = clamp(100 - baseline.capInsights.lateProductionRisk, 0, 100);
  const scheduleRobustness = totalOrders === 0 ? 100 : clamp(Math.round((1 - failure.predictions.lateDeliveries / totalOrders) * 100), 0, 100);

  const totalAvailable = input.products.reduce((s, p) => s + Math.max(0, p.availableStock), 0);
  const totalDemand = input.salesOrders.filter((o) => o.status === 'pending').reduce((s, o) => s + Math.max(0, o.orderedQty), 0);
  const inventoryBuffer = totalDemand <= 0 ? 100 : clamp(Math.round((totalAvailable / totalDemand) * 100), 0, 100);

  const recoveryTimeDays = failure.predictions.maxOrderDelayDays;
  const manufacturingResilience = clamp(
    Math.round((capacityReserve + deliveryConfidence + scheduleRobustness + inventoryBuffer + clamp(100 - recoveryTimeDays * 5, 0, 100)) / 5),
    0,
    100,
  );
  const simulationRisk = clamp(100 - manufacturingResilience, 0, 100);

  const resilience: ResilienceInsights = {
    simulationRisk,
    manufacturingResilience,
    capacityReserve,
    deliveryConfidence,
    scheduleRobustness,
    inventoryBuffer,
    recoveryTimeDays,
  };

  // Surface the highest-impact stress results as executive recommendations (deterministic).
  const recommendations: ExecutiveRecommendation[] = [];
  for (const r of results) {
    if (r.predictions.lateDeliveries > 0 || r.predictions.maxOrderDelayDays > 0 || r.analysis.affectedRevenue > 0) {
      const top = r.recommendations[0];
      recommendations.push({
        id: `twin:whatif:${r.scenario.type}`,
        metric: 'production',
        icon: 'activity',
        problem: `What-if: ${r.analysis.businessImpact}`,
        businessImpact: `${r.analysis.affectedCustomers.length} customer(s), ${r.analysis.affectedRevenue.toLocaleString()} revenue exposed if "${r.scenario.label}" occurs.`,
        rootCause: `Simulated on the real model: ${r.predictions.maxOrderDelayDays}d max delay, ${r.predictions.lateDeliveries} late, capacity usage ${r.predictions.capacityUsage}%.`,
        priority: r.analysis.riskScore >= 60 ? 'high' : 'medium',
        confidence: r.analysis.confidence,
        expectedOutcome: top ? `Mitigation: ${top.recommendedAction}` : 'Prepare a mitigation before the scenario materializes.',
        evidence: [`riskScore=${r.analysis.riskScore}`, `maxDelay=${r.predictions.maxOrderDelayDays}d`, `lateDeliveries=${r.predictions.lateDeliveries}`, `revenue=${r.analysis.affectedRevenue}`],
        sourceSystems: ['planning', 'manufacturing'],
        recommendedAction: top ? top.recommendedAction : `Plan a contingency for "${r.scenario.label}".`,
        owner: 'Operations',
        eta: 'this week',
        status: 'open',
        score: rank(r.analysis.riskScore >= 60 ? 'high' : 'medium', r.analysis.confidence),
      });
    }
  }

  return { resilience, recommendations: recommendations.sort((a, b) => b.score - a.score), baseline };
}

/** Map resilience insights to Executive Center KPI tiles (reuses the existing KPI type). */
export function resilienceInsightsToKpis(insights: ResilienceInsights): ExecutiveKpi[] {
  const pctBand = (v: number): ExecutiveKpi['band'] => (v >= 90 ? 'healthy' : v >= 75 ? 'watch' : 'at-risk');
  const riskBand = (v: number): ExecutiveKpi['band'] => (v <= 10 ? 'healthy' : v <= 25 ? 'watch' : 'at-risk');
  const recoveryBand: ExecutiveKpi['band'] = insights.recoveryTimeDays <= 2 ? 'healthy' : insights.recoveryTimeDays <= 7 ? 'watch' : 'at-risk';
  return [
    { key: 'dt-simulation-risk', label: 'Simulation Risk', value: insights.simulationRisk, display: `${insights.simulationRisk}%`, band: riskBand(insights.simulationRisk), deepLink: 'enterprise/executive' },
    { key: 'dt-manufacturing-resilience', label: 'Manufacturing Resilience', value: insights.manufacturingResilience, display: `${insights.manufacturingResilience}%`, band: pctBand(insights.manufacturingResilience), deepLink: 'enterprise/executive' },
    { key: 'dt-capacity-reserve', label: 'Capacity Reserve', value: insights.capacityReserve, display: `${insights.capacityReserve}%`, band: pctBand(insights.capacityReserve), deepLink: 'enterprise/executive' },
    { key: 'dt-delivery-confidence', label: 'Delivery Confidence', value: insights.deliveryConfidence, display: `${insights.deliveryConfidence}%`, band: pctBand(insights.deliveryConfidence), deepLink: 'enterprise/executive' },
    { key: 'dt-schedule-robustness', label: 'Schedule Robustness', value: insights.scheduleRobustness, display: `${insights.scheduleRobustness}%`, band: pctBand(insights.scheduleRobustness), deepLink: 'enterprise/executive' },
    { key: 'dt-inventory-buffer', label: 'Inventory Buffer', value: insights.inventoryBuffer, display: `${insights.inventoryBuffer}%`, band: pctBand(insights.inventoryBuffer), deepLink: 'enterprise/executive' },
    { key: 'dt-recovery-time', label: 'Recovery Time', value: insights.recoveryTimeDays, display: `${insights.recoveryTimeDays}d`, band: recoveryBand, deepLink: 'enterprise/executive' },
  ];
}
