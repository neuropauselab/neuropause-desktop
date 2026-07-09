/**
 * Enterprise Decision Engine — the strategic DECISION layer above the Manufacturing Digital Twin.
 * It does NOT predict (the Twin predicts) and it does NOT execute (human approval is mandatory): it
 * ANALYZES the Twin's deterministic what-if predictions and composes them into structured, ranked
 * RECOVERY PLANS. Every plan stays PENDING — nothing changes production, nothing is scheduled,
 * nothing is committed. It is pure, read-only, and reuses the Twin's cached baseline (no duplicate
 * scheduling): a decision that maps to a stress scenario re-runs the existing engines on a clone via
 * `runSimulation`; a decision that reads the current state (late orders, inventory buffer) reads the
 * baseline directly.
 *
 * It supports ten recovery decisions (machine-failure, supplier-delay, material-shortage, capacity,
 * demand-spike, maintenance-reschedule, routing-optimization, priority-customer, late-order,
 * inventory-buffer), each with a title, business impact, evidence, affected orders/machines/
 * customers/revenue, ordered recovery steps drawn ONLY from a fixed action vocabulary (move / split /
 * alternate-machine / second-shift / resequence / delay-maintenance / increase-procurement /
 * safety-stock / expedite-supplier / subcontract), an expected improvement, a confidence, an
 * estimated recovery time, and trade-offs. It rolls up six executive scores (recovery readiness,
 * operational resilience, decision confidence, business continuity, production stability,
 * manufacturing agility) and surfaces the ranked plans as executive recommendations. The AI explains
 * why / benefits / trade-offs / impact; it never approves and never executes. The Decision Engine is
 * the strategic authority; Manufacturing stays the execution authority, the Twin the prediction
 * authority, Planning the planning authority, and Inventory the inventory authority.
 */
import type { ExecutiveKpi, ExecutiveRecommendation, ExecRecoPriority } from './executiveCenter';
import type { PlanningInput } from './planning';
import type { SalesOrder } from './orders';
import type { Routing } from './routing';
import type { SimulationResult, TwinBaseline, DigitalTwinAssessment, ResilienceInsights } from './manufacturingDigitalTwin';
import { runSimulation, assessDigitalTwin } from './manufacturingDigitalTwin';

/* ── decisions + recovery actions (fixed vocabularies — never invented) ────────── */

export type DecisionType =
  | 'machine_failure_recovery'
  | 'supplier_delay_recovery'
  | 'material_shortage_recovery'
  | 'capacity_recovery'
  | 'demand_spike_recovery'
  | 'maintenance_reschedule'
  | 'routing_optimization'
  | 'priority_customer_recovery'
  | 'late_order_recovery'
  | 'inventory_buffer_recovery';

export const DECISION_TYPES: readonly DecisionType[] = [
  'machine_failure_recovery',
  'supplier_delay_recovery',
  'material_shortage_recovery',
  'capacity_recovery',
  'demand_spike_recovery',
  'maintenance_reschedule',
  'routing_optimization',
  'priority_customer_recovery',
  'late_order_recovery',
  'inventory_buffer_recovery',
];

export type RecoveryActionType =
  | 'move_order'
  | 'split_order'
  | 'use_alternate_machine'
  | 'add_second_shift'
  | 'resequence_jobs'
  | 'delay_maintenance'
  | 'increase_procurement'
  | 'use_safety_stock'
  | 'expedite_supplier'
  | 'subcontract_production';

/** Deterministic per-action metadata — implementation lead (days), trade-off, improvement factor. */
export const RECOVERY_ACTION_META: Record<RecoveryActionType, { recoveryDays: number; tradeoff: string; improvement: number; label: string }> = {
  move_order: { recoveryDays: 1, tradeoff: 'the displaced order may slip', improvement: 0.7, label: 'Move the affected order ahead in the queue.' },
  split_order: { recoveryDays: 1, tradeoff: 'extra setup / changeover across machines', improvement: 0.6, label: 'Split the largest orders across multiple machines.' },
  use_alternate_machine: { recoveryDays: 1, tradeoff: 'the alternate may be slower or need setup', improvement: 0.8, label: 'Move affected operations to an available machine with idle capacity.' },
  add_second_shift: { recoveryDays: 1, tradeoff: 'added labor cost', improvement: 0.7, label: 'Authorize a second shift on the constrained work center.' },
  resequence_jobs: { recoveryDays: 0, tradeoff: 'lower-priority jobs are deferred', improvement: 0.6, label: 'Resequence jobs — critical-path and earliest-due first.' },
  delay_maintenance: { recoveryDays: 0, tradeoff: 'higher breakdown risk if deferred too long', improvement: 0.5, label: 'Defer the maintenance window within its safe limit.' },
  increase_procurement: { recoveryDays: 5, tradeoff: 'more cash tied up in inventory', improvement: 0.6, label: 'Raise procurement / safety stock for the short material.' },
  use_safety_stock: { recoveryDays: 0, tradeoff: 'depletes the safety buffer', improvement: 0.7, label: 'Release safety stock to cover the immediate shortfall.' },
  expedite_supplier: { recoveryDays: 2, tradeoff: 'expedite / freight premium', improvement: 0.75, label: 'Expedite the affected supplier (premium freight).' },
  subcontract_production: { recoveryDays: 3, tradeoff: 'higher unit cost + quality oversight', improvement: 0.55, label: 'Subcontract the overflow to an external shop.' },
};

export interface RecoveryStep {
  action: RecoveryActionType;
  description: string;
  evidence: string[];
}

export type RecoveryPlanStatus = 'pending';

export interface RecoveryPlan {
  id: string;
  decisionType: DecisionType;
  title: string;
  businessImpact: string;
  evidence: string[];
  affectedOrders: string[];
  affectedMachines: string[];
  affectedCustomers: string[];
  affectedRevenue: number;
  recoverySteps: RecoveryStep[];
  /** Predicted risk reduction if the plan is approved (0..100). */
  expectedImprovementPct: number;
  /** 0..1 — data-completeness / prediction confidence. */
  confidence: number;
  estimatedRecoveryDays: number;
  priority: ExecRecoPriority;
  tradeoffs: string[];
  /** Always 'pending' — the Decision Engine never approves or executes. */
  status: RecoveryPlanStatus;
  /** Composite ranking score (higher = more urgent). */
  score: number;
}

/* ── helpers ───────────────────────────────────────────────────────────────── */

const clamp = (n: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, n));
function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return Math.round(values.reduce((a, b) => a + b, 0) / values.length);
}
function rank(priority: ExecRecoPriority, confidence: number): number {
  const base: Record<ExecRecoPriority, number> = { critical: 1000, high: 700, medium: 400, low: 100 };
  return Math.round(base[priority] + confidence * 100);
}
function priorityFromScore(riskScore: number): ExecRecoPriority {
  if (riskScore >= 75) return 'critical';
  if (riskScore >= 50) return 'high';
  if (riskScore >= 25) return 'medium';
  return 'low';
}
function dataConfidence(input: PlanningInput): number {
  return clamp(0.6 + (input.machines.length > 0 ? 0.2 : 0) + (input.salesOrders.length > 0 ? 0.19 : 0), 0, 0.99);
}
function step(action: RecoveryActionType, evidence: string[]): RecoveryStep {
  return { action, description: RECOVERY_ACTION_META[action].label, evidence };
}
function pendingOrdersForSkus(orders: SalesOrder[], skus: Set<string>): SalesOrder[] {
  return orders.filter((o) => o.status === 'pending' && skus.has(o.product));
}
function baselineLateSkus(b: TwinBaseline): Set<string> {
  const late = new Set<string>();
  for (const op of b.cap.operations) if (op.late) late.add(op.sku);
  for (const o of b.cap.unscheduled) late.add(o.sku);
  if (b.routing) for (const p of b.routing.schedules) if (p.late || p.status !== 'planned') late.add(p.product);
  return late;
}
function baselineBottlenecks(b: TwinBaseline): string[] {
  return b.cap.machineLoads.filter((l) => l.bottleneck).map((l) => l.machine).sort();
}
function hasIdleAlternate(b: TwinBaseline): boolean {
  // A genuine alternate needs a SECOND idle machine (one remains after the primary is lost).
  return b.cap.machineLoads.filter((l) => l.available && l.idleHours > 0).length >= 2;
}

interface PlanParts {
  decisionType: DecisionType;
  title: string;
  businessImpact: string;
  evidence: string[];
  affectedOrders: string[];
  affectedMachines: string[];
  affectedCustomers: string[];
  affectedRevenue: number;
  steps: RecoveryStep[];
  riskScore: number;
  confidence: number;
}

function buildPlan(a: PlanParts): RecoveryPlan {
  const primary = a.steps[0].action;
  const meta = RECOVERY_ACTION_META[primary];
  const priority = priorityFromScore(a.riskScore);
  return {
    id: `decision:${a.decisionType}`,
    decisionType: a.decisionType,
    title: a.title,
    businessImpact: a.businessImpact,
    evidence: a.evidence,
    affectedOrders: a.affectedOrders,
    affectedMachines: a.affectedMachines,
    affectedCustomers: a.affectedCustomers,
    affectedRevenue: a.affectedRevenue,
    recoverySteps: a.steps,
    expectedImprovementPct: clamp(Math.round(a.riskScore * meta.improvement), 0, 100),
    confidence: a.confidence,
    estimatedRecoveryDays: meta.recoveryDays,
    priority,
    tradeoffs: [...new Set(a.steps.map((s) => RECOVERY_ACTION_META[s.action].tradeoff))],
    status: 'pending',
    score: rank(priority, a.confidence),
  };
}

/* ── recovery steps per decision (deterministic from baseline + prediction) ────── */

function scenarioSteps(decisionType: DecisionType, baseline: TwinBaseline, sim: SimulationResult): RecoveryStep[] {
  const p = sim.predictions;
  const alt = hasIdleAlternate(baseline);
  const tight = p.capacityUsage >= 85 || p.bottlenecks.length > 0;
  const capEv = [`capacityUsage=${p.capacityUsage}%`, `maxDelay=${p.maxOrderDelayDays}d`];
  const steps: RecoveryStep[] = [];
  switch (decisionType) {
    case 'machine_failure_recovery':
      if (alt) steps.push(step('use_alternate_machine', [`addedDowntime=${p.addedDowntimeHours}h`, ...capEv]));
      steps.push(step('add_second_shift', capEv));
      if (!alt && tight) steps.push(step('subcontract_production', [`lateDeliveries=${p.lateDeliveries}`, ...capEv]));
      steps.push(step('resequence_jobs', [`lateDeliveries=${p.lateDeliveries}`]));
      break;
    case 'supplier_delay_recovery':
      steps.push(step('expedite_supplier', [`materialRisk=${p.materialRisk}%`]));
      steps.push(step('use_safety_stock', [`materialRisk=${p.materialRisk}%`]));
      steps.push(step('increase_procurement', [`inventoryImpact=${p.inventoryImpactUnits}u`]));
      break;
    case 'material_shortage_recovery':
      steps.push(step('use_safety_stock', [`inventoryImpact=${p.inventoryImpactUnits}u`]));
      steps.push(step('increase_procurement', [`inventoryImpact=${p.inventoryImpactUnits}u`]));
      steps.push(step('expedite_supplier', [`materialRisk=${p.materialRisk}%`]));
      break;
    case 'capacity_recovery':
      steps.push(step('add_second_shift', capEv));
      if (alt) steps.push(step('use_alternate_machine', capEv));
      steps.push(step('split_order', capEv));
      steps.push(step('subcontract_production', [`lateDeliveries=${p.lateDeliveries}`, ...capEv]));
      break;
    case 'demand_spike_recovery':
      steps.push(step('add_second_shift', [`inventoryImpact=${p.inventoryImpactUnits}u`, ...capEv]));
      steps.push(step('split_order', capEv));
      steps.push(step('subcontract_production', capEv));
      break;
    case 'maintenance_reschedule': {
      const low = p.maxOrderDelayDays <= 2 && p.lateDeliveries === 0;
      if (low) steps.push(step('delay_maintenance', [`maxDelay=${p.maxOrderDelayDays}d`, `lateDeliveries=0`]));
      else steps.push(step('resequence_jobs', [`maxDelay=${p.maxOrderDelayDays}d`, `lateDeliveries=${p.lateDeliveries}`]));
      break;
    }
    case 'routing_optimization':
      steps.push(step('use_alternate_machine', [`bottlenecks=${p.bottlenecks.join(',') || 'none'}`]));
      steps.push(step('resequence_jobs', capEv));
      break;
    case 'priority_customer_recovery':
      steps.push(step('resequence_jobs', [`lateDeliveries=${p.lateDeliveries}`]));
      steps.push(step('move_order', [`revenue=${p.revenueDelay}`]));
      if (alt) steps.push(step('use_alternate_machine', capEv));
      break;
    default:
      break;
  }
  return steps;
}

const SCENARIO_DECISIONS: { decisionType: DecisionType; scenario: Parameters<typeof runSimulation>[2] }[] = [
  { decisionType: 'machine_failure_recovery', scenario: { type: 'machine_failure' } },
  { decisionType: 'supplier_delay_recovery', scenario: { type: 'supplier_delay', magnitude: 14 } },
  { decisionType: 'material_shortage_recovery', scenario: { type: 'material_shortage' } },
  { decisionType: 'capacity_recovery', scenario: { type: 'reduced_shift', magnitude: 1 } },
  { decisionType: 'demand_spike_recovery', scenario: { type: 'demand_increase', magnitude: 25 } },
  { decisionType: 'maintenance_reschedule', scenario: { type: 'maintenance_delay' } },
  { decisionType: 'routing_optimization', scenario: { type: 'routing_change' } },
  { decisionType: 'priority_customer_recovery', scenario: { type: 'priority_order' } },
];

function planFromScenario(decisionType: DecisionType, sim: SimulationResult, baseline: TwinBaseline): RecoveryPlan | null {
  const p = sim.predictions;
  const a = sim.analysis;
  const hasRisk = p.lateDeliveries > 0 || p.maxOrderDelayDays > 0 || a.affectedRevenue > 0 || p.materialRisk > 0 || p.inventoryImpactUnits > 0;
  if (decisionType !== 'maintenance_reschedule' && !hasRisk) return null;
  const steps = scenarioSteps(decisionType, baseline, sim);
  if (steps.length === 0) return null;
  const title = `${decisionType.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())}${a.affectedMachines.length ? ` — ${a.affectedMachines.join(', ')}` : ''}`;
  return buildPlan({
    decisionType,
    title,
    businessImpact: a.businessImpact,
    evidence: [`maxDelay=${p.maxOrderDelayDays}d`, `lateDeliveries=${p.lateDeliveries}`, `capacityUsage=${p.capacityUsage}%`, `materialRisk=${p.materialRisk}%`, `revenue=${a.affectedRevenue}`],
    affectedOrders: a.affectedOrders,
    affectedMachines: a.affectedMachines,
    affectedCustomers: a.affectedCustomers,
    affectedRevenue: a.affectedRevenue,
    steps,
    riskScore: a.riskScore,
    confidence: a.confidence,
  });
}

function lateOrderPlan(baseline: TwinBaseline, input: PlanningInput): RecoveryPlan | null {
  const lateSkus = baselineLateSkus(baseline);
  if (lateSkus.size === 0) return null;
  const orders = pendingOrdersForSkus(input.salesOrders, lateSkus);
  const revenue = orders.reduce((s, o) => s + Math.max(0, o.total), 0);
  const customers = [...new Set(orders.map((o) => o.customer).filter(Boolean))].sort();
  const riskScore = clamp(Math.round(Math.min(100, lateSkus.size * 20)), 0, 100);
  const steps = [
    step('resequence_jobs', [`lateOrders=${lateSkus.size}`]),
    step('move_order', [`revenue=${revenue}`]),
    step('add_second_shift', [`lateOrders=${lateSkus.size}`]),
  ];
  return buildPlan({
    decisionType: 'late_order_recovery',
    title: `Late Order Recovery — ${lateSkus.size} order(s)`,
    businessImpact: `${lateSkus.size} order(s) are scheduled late in the current plan; ${revenue.toLocaleString()} revenue exposed.`,
    evidence: [`lateOrders=${lateSkus.size}`, `revenue=${revenue}`, `bottlenecks=${baselineBottlenecks(baseline).join(',') || 'none'}`],
    affectedOrders: [...lateSkus].sort(),
    affectedMachines: baselineBottlenecks(baseline),
    affectedCustomers: customers,
    affectedRevenue: revenue,
    steps,
    riskScore,
    confidence: dataConfidence(input),
  });
}

function inventoryBufferPlan(baseline: TwinBaseline, input: PlanningInput): RecoveryPlan | null {
  void baseline;
  const demandBySku = new Map<string, number>();
  for (const o of input.salesOrders) if (o.status === 'pending') demandBySku.set(o.product, (demandBySku.get(o.product) ?? 0) + Math.max(0, o.orderedQty));
  const totalDemand = [...demandBySku.values()].reduce((s, v) => s + v, 0);
  if (totalDemand <= 0) return null;
  const totalAvailable = input.products.reduce((s, p) => s + Math.max(0, p.availableStock), 0);
  const bufferPct = clamp(Math.round((totalAvailable / totalDemand) * 100), 0, 100);
  if (bufferPct >= 50) return null; // adequate buffer — no plan
  const shortSkus = input.products.filter((p) => (demandBySku.get(p.sku) ?? 0) > Math.max(0, p.availableStock)).map((p) => p.sku).sort();
  const orders = pendingOrdersForSkus(input.salesOrders, new Set(shortSkus));
  const revenue = orders.reduce((s, o) => s + Math.max(0, o.total), 0);
  const customers = [...new Set(orders.map((o) => o.customer).filter(Boolean))].sort();
  const riskScore = clamp(100 - bufferPct, 0, 100);
  const steps = [
    step('increase_procurement', [`inventoryBuffer=${bufferPct}%`, `shortSkus=${shortSkus.length}`]),
    step('use_safety_stock', [`inventoryBuffer=${bufferPct}%`]),
  ];
  return buildPlan({
    decisionType: 'inventory_buffer_recovery',
    title: `Inventory Buffer Recovery — ${bufferPct}% coverage`,
    businessImpact: `Available stock covers only ${bufferPct}% of committed demand; ${shortSkus.length} SKU(s) under-buffered.`,
    evidence: [`inventoryBuffer=${bufferPct}%`, `available=${totalAvailable}`, `demand=${totalDemand}`, `shortSkus=${shortSkus.length}`],
    affectedOrders: shortSkus,
    affectedMachines: [],
    affectedCustomers: customers,
    affectedRevenue: revenue,
    steps,
    riskScore,
    confidence: dataConfidence(input),
  });
}

/**
 * Build the deterministic recovery plans. Reuses the provided baseline for every scenario (no
 * duplicate scheduling of the base plan). Pure + read-only — nothing is persisted or executed.
 */
export function buildRecoveryPlans(input: PlanningInput, routings: Routing[], nowMs: number, baseline: TwinBaseline): RecoveryPlan[] {
  const plans: RecoveryPlan[] = [];
  for (const { decisionType, scenario } of SCENARIO_DECISIONS) {
    if (decisionType === 'routing_optimization' && routings.length === 0) continue;
    const sim = runSimulation(input, routings, scenario, nowMs, baseline);
    const plan = planFromScenario(decisionType, sim, baseline);
    if (plan) plans.push(plan);
  }
  const late = lateOrderPlan(baseline, input);
  if (late) plans.push(late);
  const inv = inventoryBufferPlan(baseline, input);
  if (inv) plans.push(inv);
  return plans.sort((a, b) => b.score - a.score || a.decisionType.localeCompare(b.decisionType));
}

/* ── executive scores ──────────────────────────────────────────────────────── */

export interface DecisionInsights {
  recoveryReadiness: number;
  operationalResilience: number;
  decisionConfidence: number;
  businessContinuity: number;
  productionStability: number;
  manufacturingAgility: number;
}

/** Roll the recovery plans + Twin resilience into the six executive decision scores. Pure. */
export function deriveDecisionInsights(plans: RecoveryPlan[], resilience: ResilienceInsights, input: PlanningInput): DecisionInsights {
  const recoveryReadiness = plans.length === 0 ? 100 : clamp(mean(plans.map((p) => p.expectedImprovementPct)), 0, 100);
  const decisionConfidence = plans.length === 0 ? 100 : clamp(mean(plans.map((p) => Math.round(p.confidence * 100))), 0, 100);

  const totalRevenue = input.salesOrders.filter((o) => o.status === 'pending').reduce((s, o) => s + Math.max(0, o.total), 0);
  const maxExposure = plans.reduce((m, p) => Math.max(m, p.affectedRevenue), 0);
  const businessContinuity = totalRevenue <= 0 ? 100 : clamp(100 - Math.round((maxExposure / totalRevenue) * 100), 0, 100);

  const distinctActions = new Set<RecoveryActionType>();
  for (const p of plans) for (const s of p.recoverySteps) distinctActions.add(s.action);
  const optionScore = clamp(Math.min(100, distinctActions.size * 15), 0, 100);
  const manufacturingAgility = clamp(Math.round((resilience.capacityReserve + optionScore) / 2), 0, 100);

  return {
    recoveryReadiness,
    operationalResilience: resilience.manufacturingResilience,
    decisionConfidence,
    businessContinuity,
    productionStability: resilience.scheduleRobustness,
    manufacturingAgility,
  };
}

/** Map decision insights to Executive Center KPI tiles (reuses the existing KPI type). */
export function decisionInsightsToKpis(insights: DecisionInsights): ExecutiveKpi[] {
  const pctBand = (v: number): ExecutiveKpi['band'] => (v >= 90 ? 'healthy' : v >= 75 ? 'watch' : 'at-risk');
  return [
    { key: 'dec-recovery-readiness', label: 'Recovery Readiness', value: insights.recoveryReadiness, display: `${insights.recoveryReadiness}%`, band: pctBand(insights.recoveryReadiness), deepLink: 'enterprise/executive' },
    { key: 'dec-operational-resilience', label: 'Operational Resilience', value: insights.operationalResilience, display: `${insights.operationalResilience}%`, band: pctBand(insights.operationalResilience), deepLink: 'enterprise/executive' },
    { key: 'dec-decision-confidence', label: 'Decision Confidence', value: insights.decisionConfidence, display: `${insights.decisionConfidence}%`, band: pctBand(insights.decisionConfidence), deepLink: 'enterprise/executive' },
    { key: 'dec-business-continuity', label: 'Business Continuity', value: insights.businessContinuity, display: `${insights.businessContinuity}%`, band: pctBand(insights.businessContinuity), deepLink: 'enterprise/executive' },
    { key: 'dec-production-stability', label: 'Production Stability', value: insights.productionStability, display: `${insights.productionStability}%`, band: pctBand(insights.productionStability), deepLink: 'enterprise/executive' },
    { key: 'dec-manufacturing-agility', label: 'Manufacturing Agility', value: insights.manufacturingAgility, display: `${insights.manufacturingAgility}%`, band: pctBand(insights.manufacturingAgility), deepLink: 'enterprise/executive' },
  ];
}

/* ── recommendations (flow into the existing Executive recommendation system) ── */

/**
 * Surface the ranked recovery plans as executive recommendations — each carrying evidence, impact,
 * priority, expected improvement, confidence, and trade-offs. Every plan is PENDING; the AI explains
 * it; approval + execution belong to a human (a future module). Deterministic.
 */
export function decisionRecommendations(plans: RecoveryPlan[], limit = 20): ExecutiveRecommendation[] {
  return plans.slice(0, limit).map((plan) => {
    const primary = plan.recoverySteps[0];
    return {
      id: plan.id,
      metric: 'production',
      icon: 'shield',
      problem: `${plan.title}: ${plan.businessImpact}`,
      businessImpact: `${plan.affectedCustomers.length} customer(s), ${plan.affectedRevenue.toLocaleString()} revenue exposed across ${plan.affectedOrders.length} order(s).`,
      rootCause: `Decision Engine (from Digital Twin): ${plan.evidence.join(', ')}.`,
      priority: plan.priority,
      confidence: plan.confidence,
      expectedOutcome: `Recovery plan (PENDING approval): ${primary.description} Expected improvement ~${plan.expectedImprovementPct}%, recovery in ~${plan.estimatedRecoveryDays}d. Trade-offs: ${plan.tradeoffs.join('; ')}.`,
      evidence: plan.evidence,
      sourceSystems: ['digital-twin', 'planning', 'manufacturing'],
      recommendedAction: `${primary.description} (${plan.recoverySteps.length} step(s); requires human approval).`,
      owner: 'Operations',
      eta: plan.estimatedRecoveryDays <= 1 ? 'today' : 'this week',
      status: 'open',
      score: plan.score,
    };
  });
}

/* ── one-call assessment (Executive Center) ────────────────────────────────── */

export interface DecisionEngineAssessment {
  plans: RecoveryPlan[];
  insights: DecisionInsights;
  recommendations: ExecutiveRecommendation[];
  resilience: ResilienceInsights;
}

/**
 * Assess the enterprise decision posture: build the ranked recovery plans, the six executive scores,
 * and the executive recommendations — reusing the Digital Twin's cached baseline (no duplicate
 * scheduling of the base plan). Pass the already-computed `twin` assessment to avoid recomputation.
 * Pure, read-only, and produces only PENDING plans — nothing executes.
 */
export function assessDecisionEngine(input: PlanningInput, routings: Routing[], nowMs: number, twin?: DigitalTwinAssessment): DecisionEngineAssessment {
  const t = twin ?? assessDigitalTwin(input, routings, nowMs);
  const plans = buildRecoveryPlans(input, routings, nowMs, t.baseline);
  const insights = deriveDecisionInsights(plans, t.resilience, input);
  return { plans, insights, recommendations: decisionRecommendations(plans), resilience: t.resilience };
}
