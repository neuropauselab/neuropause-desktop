/**
 * Executive Decision Approval System — the GOVERNANCE layer over the Enterprise Decision Engine.
 * The Decision Engine produces PENDING recovery plans; this layer lets a human executive REVIEW,
 * APPROVE, REJECT, and VERIFY them before anything is ever executed. It is deterministic and
 * read-only with respect to production: approving or verifying a plan changes ONLY the decision
 * record's own governance state — it never touches Planning, Scheduling, MES, Inventory, or the
 * shop floor. Verification RE-RUNS the Manufacturing Digital Twin with the approved recovery
 * applied (stress + recovery composed on a clone, via the Twin's own pure primitives) and compares
 * baseline → predicted → verified to prove the plan works, again touching nothing real.
 *
 * This file holds the decision-record projection + mapper, the strict status lifecycle
 * (pending → approved/rejected → verified → archived), the deterministic verification-report
 * builder, and the executive approval KPIs. Nothing here approves, rejects, or executes on its own
 * — the backend module drives the persisted lifecycle behind RBAC (executive:read / :approve /
 * :verify), audit, and timeline. The AI explains why to approve/reject and the trade-offs; the human
 * decides. Approval System = governance authority; Decision Engine = recommendation authority;
 * Digital Twin = prediction authority; Manufacturing = execution authority.
 */
import type { EnterpriseEntity } from './enterpriseModule';
import type { ExecutiveKpi } from './executiveCenter';
import type { PlanningInput } from './planning';
import type { Routing } from './routing';
import type { DecisionType, RecoveryActionType, RecoveryPlan } from './enterpriseDecisionEngine';
import { RECOVERY_ACTION_META } from './enterpriseDecisionEngine';
import type { TwinScenario, TwinBaseline } from './manufacturingDigitalTwin';
import { computeTwinBaseline, resolveScenario, applyScenario } from './manufacturingDigitalTwin';
import { deriveCapacityInsights } from './capacityScheduler';

/* ── module identity + RBAC scopes ─────────────────────────────────────────── */

export const EXECUTIVE_DECISIONS_MODULE_ID = 'executive-decisions';
export const EXECUTIVE_DECISION_KIND = 'executive-decision';

export const EXECUTIVE_READ = 'executive:read';
export const EXECUTIVE_APPROVE = 'executive:approve';
export const EXECUTIVE_VERIFY = 'executive:verify';

/* ── status lifecycle (strict, deterministic) ──────────────────────────────── */

export type ExecutiveDecisionStatus = 'pending' | 'approved' | 'rejected' | 'verified' | 'archived';

export const EXECUTIVE_DECISION_STATUSES: readonly ExecutiveDecisionStatus[] = ['pending', 'approved', 'rejected', 'verified', 'archived'];

export type DecisionAction = 'approve' | 'reject' | 'verify' | 'archive';

/** The one legal target status for an action from a status, or null if not allowed. */
export function decisionTransition(action: DecisionAction, from: ExecutiveDecisionStatus): ExecutiveDecisionStatus | null {
  switch (action) {
    case 'approve':
      return from === 'pending' ? 'approved' : null;
    case 'reject':
      return from === 'pending' ? 'rejected' : null;
    case 'verify':
      return from === 'approved' ? 'verified' : null;
    case 'archive':
      return from === 'approved' || from === 'rejected' || from === 'verified' ? 'archived' : null;
    default:
      return null;
  }
}

/* ── coercion helpers ──────────────────────────────────────────────────────── */

const str = (v: unknown): string => (v === null || v === undefined ? '' : String(v));
const num = (v: unknown): number => (typeof v === 'number' ? v : Number(str(v)) || 0);
const clamp = (n: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, n));
function csv(v: unknown): string[] {
  return str(v)
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s !== '');
}
function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return Math.round(values.reduce((a, b) => a + b, 0) / values.length);
}
function parseJson<T>(v: unknown): T | null {
  const s = str(v).trim();
  if (!s) return null;
  try {
    return JSON.parse(s) as T;
  } catch {
    return null;
  }
}

/* ── verification report ───────────────────────────────────────────────────── */

export interface VerificationReport {
  recoveryImprovement: number;
  remainingRisk: number;
  expectedDelayDays: number;
  revenueSaved: number;
  ordersRecovered: number;
  machineUtilization: number;
  confidence: number;
  tradeoffs: string[];
  /** How close the Decision Engine's predicted improvement was to the verified improvement (0..100). */
  verificationAccuracy: number;
  baselineLate: number;
  stressedLate: number;
  recoveredLate: number;
}

/* ── the decision record projection ────────────────────────────────────────── */

export interface ExecutiveDecisionRecord {
  id: string;
  decisionId: string;
  title: string;
  category: DecisionType;
  evidence: string[];
  affectedOrders: string[];
  affectedMachines: string[];
  affectedCustomers: string[];
  affectedRevenue: number;
  expectedImprovementPct: number;
  confidence: number;
  primaryAction: RecoveryActionType;
  tradeoffs: string[];
  createdBy: string;
  createdTime: string;
  status: ExecutiveDecisionStatus;
  approvedBy: string;
  approvedAt: string;
  approvalReason: string;
  approvalComments: string;
  rejectedBy: string;
  rejectedAt: string;
  rejectionReason: string;
  verifiedBy: string;
  verifiedAt: string;
  verificationReport: VerificationReport | null;
  createdAt: string;
  updatedAt: string;
}

const ACTIONS: readonly RecoveryActionType[] = Object.keys(RECOVERY_ACTION_META) as RecoveryActionType[];

function oneOf<T extends string>(v: unknown, all: readonly T[], fallback: T): T {
  const s = str(v);
  return (all as readonly string[]).includes(s) ? (s as T) : fallback;
}

export function executiveDecisionFromRecord(record: EnterpriseEntity): ExecutiveDecisionRecord {
  const f = record.fields;
  return {
    id: record.id,
    decisionId: str(f.decisionId) || record.title,
    title: str(f.title) || record.title,
    category: str(f.category) as DecisionType,
    evidence: parseJson<string[]>(f.evidence) ?? csv(f.evidence),
    affectedOrders: csv(f.affectedOrders),
    affectedMachines: csv(f.affectedMachines),
    affectedCustomers: csv(f.affectedCustomers),
    affectedRevenue: num(f.affectedRevenue),
    expectedImprovementPct: num(f.expectedImprovementPct),
    confidence: num(f.confidence),
    primaryAction: oneOf<RecoveryActionType>(f.primaryAction, ACTIONS, 'resequence_jobs'),
    tradeoffs: parseJson<string[]>(f.tradeoffs) ?? csv(f.tradeoffs),
    createdBy: str(f.createdBy),
    createdTime: str(f.createdTime),
    status: oneOf<ExecutiveDecisionStatus>(f.status, EXECUTIVE_DECISION_STATUSES, 'pending'),
    approvedBy: str(f.approvedBy),
    approvedAt: str(f.approvedAt),
    approvalReason: str(f.approvalReason),
    approvalComments: str(f.approvalComments),
    rejectedBy: str(f.rejectedBy),
    rejectedAt: str(f.rejectedAt),
    rejectionReason: str(f.rejectionReason),
    verifiedBy: str(f.verifiedBy),
    verifiedAt: str(f.verifiedAt),
    verificationReport: parseJson<VerificationReport>(f.verificationReport),
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

/** Map a Decision Engine recovery plan to the fields of a new (pending) decision record. Pure. */
export function decisionRecordFieldsFromPlan(plan: RecoveryPlan, createdBy: string, now: string): Record<string, string | number> {
  return {
    decisionId: plan.id,
    title: plan.title,
    category: plan.decisionType,
    evidence: JSON.stringify(plan.evidence),
    recoveryPlan: JSON.stringify(plan.recoverySteps),
    affectedOrders: plan.affectedOrders.join(','),
    affectedMachines: plan.affectedMachines.join(','),
    affectedCustomers: plan.affectedCustomers.join(','),
    affectedRevenue: plan.affectedRevenue,
    expectedImprovementPct: plan.expectedImprovementPct,
    confidence: Math.round(plan.confidence * 100),
    primaryAction: plan.recoverySteps[0]?.action ?? 'resequence_jobs',
    tradeoffs: JSON.stringify(plan.tradeoffs),
    createdBy,
    createdTime: now,
    status: 'pending',
  };
}

/* ── verification: re-run the Digital Twin with the approved recovery ──────────── */

/** The stress scenario a decision category was created from (null for state-derived decisions). */
export function stressScenarioForCategory(category: DecisionType): TwinScenario | null {
  switch (category) {
    case 'machine_failure_recovery':
      return { type: 'machine_failure' };
    case 'supplier_delay_recovery':
      return { type: 'supplier_delay', magnitude: 14 };
    case 'material_shortage_recovery':
      return { type: 'material_shortage' };
    case 'capacity_recovery':
      return { type: 'reduced_shift', magnitude: 1 };
    case 'demand_spike_recovery':
      return { type: 'demand_increase', magnitude: 25 };
    case 'maintenance_reschedule':
      return { type: 'maintenance_delay' };
    case 'routing_optimization':
      return { type: 'routing_change' };
    case 'priority_customer_recovery':
      return { type: 'priority_order' };
    default:
      return null; // late_order_recovery / inventory_buffer_recovery are read from the baseline
  }
}

/** The favorable scenario that models applying a recovery action. */
export function recoveryScenarioForAction(action: RecoveryActionType): TwinScenario {
  switch (action) {
    case 'use_alternate_machine':
    case 'subcontract_production':
      return { type: 'machine_addition', magnitude: 1 };
    case 'add_second_shift':
    case 'split_order':
    case 'delay_maintenance':
      return { type: 'extra_shift' };
    case 'expedite_supplier':
      return { type: 'supplier_delay', magnitude: -14 };
    case 'increase_procurement':
    case 'use_safety_stock':
      return { type: 'demand_decrease', magnitude: 30 };
    case 'move_order':
    case 'resequence_jobs':
    default:
      return { type: 'priority_order' };
  }
}

function lateSkus(b: TwinBaseline): Set<string> {
  const s = new Set<string>();
  for (const op of b.cap.operations) if (op.late) s.add(op.sku);
  for (const o of b.cap.unscheduled) s.add(o.sku);
  if (b.routing) for (const p of b.routing.schedules) if (p.late || p.status !== 'planned') s.add(p.product);
  return s;
}
function finishMap(b: TwinBaseline): Map<string, number> {
  const m = new Map<string, number>();
  for (const op of b.cap.operations) {
    const t = Date.parse(op.finishDate);
    if (Number.isFinite(t)) m.set(op.sku, Math.max(m.get(op.sku) ?? 0, t));
  }
  if (b.routing) for (const p of b.routing.schedules) {
    const t = Date.parse(p.plannedFinish);
    if (Number.isFinite(t)) m.set(p.product, t);
  }
  return m;
}

/**
 * Build the verification report by RE-RUNNING the Digital Twin: apply the decision's original stress
 * (if any) and then the approved recovery ON A CLONE, and compare baseline → stressed → recovered.
 * Reuses the Twin's pure primitives; touches nothing real. Deterministic — `nowMs` injected.
 */
export function buildVerificationReport(
  input: PlanningInput,
  routings: Routing[],
  decision: ExecutiveDecisionRecord,
  nowMs: number,
  baseline?: TwinBaseline,
): VerificationReport {
  const base = baseline ?? computeTwinBaseline(input, routings, nowMs);

  // Stress world (the damage the decision was created to recover from).
  let stressedInput = input;
  let stressedRoutings = routings;
  let stressed = base;
  const stressScenario = stressScenarioForCategory(decision.category);
  if (stressScenario) {
    const rs = resolveScenario(stressScenario, input, base);
    const s = applyScenario(input, routings, rs);
    stressedInput = s.input;
    stressedRoutings = s.routings;
    stressed = computeTwinBaseline(stressedInput, stressedRoutings, nowMs);
  }

  // Recovered world (the approved recovery applied on top of the stress).
  const rr = resolveScenario(recoveryScenarioForAction(decision.primaryAction), stressedInput, stressed);
  const recoveredInputs = applyScenario(stressedInput, stressedRoutings, rr);
  const recovered = computeTwinBaseline(recoveredInputs.input, recoveredInputs.routings, nowMs);

  const lateBase = lateSkus(base);
  const lateStressed = lateSkus(stressed);
  const lateRecovered = lateSkus(recovered);
  const totalOrders = base.cap.operations.length + base.cap.unscheduled.length;

  const atRisk = stressScenario ? lateStressed : lateBase;
  const recoveredSkus = [...atRisk].filter((sku) => !lateRecovered.has(sku));
  const ordersRecovered = recoveredSkus.length;
  const recoveryImprovement = atRisk.size > 0 ? clamp(Math.round((ordersRecovered / atRisk.size) * 100), 0, 100) : lateRecovered.size === 0 ? 100 : 0;
  const remainingRisk = totalOrders > 0 ? clamp(Math.round((lateRecovered.size / totalOrders) * 100), 0, 100) : 0;

  const orders = input.salesOrders.filter((o) => o.status === 'pending' && recoveredSkus.includes(o.product));
  const revenueSaved = orders.reduce((s, o) => s + Math.max(0, o.total), 0);

  const baseFinish = finishMap(base);
  const recFinish = finishMap(recovered);
  let expectedDelayDays = 0;
  for (const [sku, bf] of baseFinish) {
    const rf = recFinish.get(sku);
    if (rf === undefined) continue;
    expectedDelayDays = Math.max(expectedDelayDays, Math.round((rf - bf) / (24 * 60 * 60 * 1000)));
  }

  const machineUtilization = deriveCapacityInsights(recovered.cap).machineUtilization;
  const verificationAccuracy = clamp(100 - Math.abs(decision.expectedImprovementPct - recoveryImprovement), 0, 100);

  return {
    recoveryImprovement,
    remainingRisk,
    expectedDelayDays: Math.max(0, expectedDelayDays),
    revenueSaved,
    ordersRecovered,
    machineUtilization,
    confidence: decision.confidence,
    tradeoffs: decision.tradeoffs.length > 0 ? decision.tradeoffs : [RECOVERY_ACTION_META[decision.primaryAction].tradeoff],
    verificationAccuracy,
    baselineLate: lateBase.size,
    stressedLate: lateStressed.size,
    recoveredLate: lateRecovered.size,
  };
}

/* ── executive approval KPIs ───────────────────────────────────────────────── */

export interface ApprovalInsights {
  pendingDecisions: number;
  approvedDecisions: number;
  rejectedDecisions: number;
  verifiedDecisions: number;
  averageVerificationAccuracy: number;
  approvalLeadTimeHours: number;
  recoverySuccessRate: number;
}

/** Roll the decision records into the executive approval KPIs. Pure. */
export function deriveApprovalInsights(decisions: ExecutiveDecisionRecord[]): ApprovalInsights {
  const byStatus = (s: ExecutiveDecisionStatus): ExecutiveDecisionRecord[] => decisions.filter((d) => d.status === s);
  const pending = byStatus('pending');
  const approved = byStatus('approved');
  const rejected = byStatus('rejected');
  const verified = byStatus('verified');

  const accuracies = verified.map((d) => d.verificationReport?.verificationAccuracy ?? 0).filter((n) => n >= 0);
  const averageVerificationAccuracy = accuracies.length === 0 ? 100 : clamp(mean(accuracies), 0, 100);

  const leadTimes: number[] = [];
  for (const d of decisions) {
    if (!d.approvedAt || !d.createdTime) continue;
    const created = Date.parse(d.createdTime);
    const approvedAt = Date.parse(d.approvedAt);
    if (Number.isFinite(created) && Number.isFinite(approvedAt) && approvedAt >= created) leadTimes.push(Math.round((approvedAt - created) / (60 * 60 * 1000)));
  }
  const approvalLeadTimeHours = leadTimes.length === 0 ? 0 : mean(leadTimes);

  const successful = verified.filter((d) => (d.verificationReport?.recoveryImprovement ?? 0) >= 50).length;
  const recoverySuccessRate = verified.length === 0 ? 100 : clamp(Math.round((successful / verified.length) * 100), 0, 100);

  return {
    pendingDecisions: pending.length,
    approvedDecisions: approved.length,
    rejectedDecisions: rejected.length,
    verifiedDecisions: verified.length,
    averageVerificationAccuracy,
    approvalLeadTimeHours,
    recoverySuccessRate,
  };
}

/** Map approval insights to Executive Center KPI tiles (reuses the existing KPI type). */
export function approvalInsightsToKpis(insights: ApprovalInsights): ExecutiveKpi[] {
  const pctBand = (v: number): ExecutiveKpi['band'] => (v >= 90 ? 'healthy' : v >= 75 ? 'watch' : 'at-risk');
  const pendingBand: ExecutiveKpi['band'] = insights.pendingDecisions === 0 ? 'healthy' : insights.pendingDecisions <= 3 ? 'watch' : 'at-risk';
  const leadBand: ExecutiveKpi['band'] = insights.approvalLeadTimeHours <= 24 ? 'healthy' : insights.approvalLeadTimeHours <= 72 ? 'watch' : 'at-risk';
  return [
    { key: 'apr-pending', label: 'Pending Decisions', value: insights.pendingDecisions, display: `${insights.pendingDecisions}`, band: pendingBand, deepLink: 'enterprise/executive' },
    { key: 'apr-approved', label: 'Approved Decisions', value: insights.approvedDecisions, display: `${insights.approvedDecisions}`, deepLink: 'enterprise/executive' },
    { key: 'apr-rejected', label: 'Rejected Decisions', value: insights.rejectedDecisions, display: `${insights.rejectedDecisions}`, deepLink: 'enterprise/executive' },
    { key: 'apr-verified', label: 'Verified Decisions', value: insights.verifiedDecisions, display: `${insights.verifiedDecisions}`, deepLink: 'enterprise/executive' },
    { key: 'apr-verification-accuracy', label: 'Average Verification Accuracy', value: insights.averageVerificationAccuracy, display: `${insights.averageVerificationAccuracy}%`, band: pctBand(insights.averageVerificationAccuracy), deepLink: 'enterprise/executive' },
    { key: 'apr-approval-lead-time', label: 'Approval Lead Time', value: insights.approvalLeadTimeHours, display: `${insights.approvalLeadTimeHours}h`, band: leadBand, deepLink: 'enterprise/executive' },
    { key: 'apr-recovery-success', label: 'Recovery Success Rate', value: insights.recoverySuccessRate, display: `${insights.recoverySuccessRate}%`, band: pctBand(insights.recoverySuccessRate), deepLink: 'enterprise/executive' },
  ];
}
