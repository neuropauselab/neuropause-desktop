/**
 * Production Schedule Commit — the GOVERNANCE + VERSIONING + KPI + visualization layer ON TOP of the
 * existing routing-aware Finite Capacity Scheduler. It creates NO new scheduler: every schedule comes
 * from `computeRoutingSchedule` / `scheduleProductionOrderRouting` (routing.ts), which itself extends the
 * APS engine (capacityScheduler.ts). This file adds, all read-only and deterministic:
 *   • the eight scheduling KPIs (Schedule/Machine Utilization, Avg Queue, Avg Setup, Schedule Efficiency,
 *     Late Operations, Idle Capacity, Routing Violations) — composed from the mined schedule, not remined;
 *   • a strict schedule-proposal lifecycle (proposed → approved / rejected → committed, or superseded on
 *     recalculate) modeled on the Decision Execution Handoff governance — a proposal is read-only until a
 *     human approves it, and only an APPROVED proposal may commit real Production Schedule records;
 *   • a Machine-Gantt model (per-machine lanes + time-scaled operation bars) for the desktop UI;
 *   • a deterministic AI narrative (summary / risk / machine recommendation / delay / routing / optimize).
 *
 * Nothing here schedules, executes, or overwrites. Commit is the only writer, it is gated on approval, it
 * reuses `buildScheduleRecordFields` + the Production Schedules module, and it never rewrites production
 * orders. Types-only module — no I/O, no Electron.
 */
import type { EnterpriseEntity } from './enterpriseModule';
import type { ExecutiveKpi } from './executiveCenter';
import type { MachineLoad } from './capacityScheduler';
import type { ProductionSchedulePlan, RoutingSchedule, ScheduledRoutingOperation } from './routing';
import { MACHINE_HOURS_PER_DAY } from './capacityScheduler';

export const SCHEDULE_PROPOSALS_MODULE_ID = 'manufacturing-schedule-proposals';
export const SCHEDULE_PROPOSAL_KIND = 'schedule-proposal';

/* ── helpers ───────────────────────────────────────────────────────────────────── */

const str = (v: unknown): string => (v === null || v === undefined ? '' : String(v));
const num = (v: unknown): number => (typeof v === 'number' ? v : Number(str(v)) || 0);
const clamp = (n: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, n));
const round = (n: number): number => Math.round(n);
function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}
function csv(v: unknown): string[] {
  return str(v).split(',').map((s) => s.trim()).filter((s) => s !== '');
}
function oneOf<T extends string>(v: unknown, all: readonly T[], fallback: T): T {
  const s = str(v);
  return (all as readonly string[]).includes(s) ? (s as T) : fallback;
}
function hoursDisplay(h: number): string {
  if (h <= 0) return '0h';
  if (h < 48) return `${round(h)}h`;
  return `${round(h / 24)}d`;
}
function pctBand(v: number): ExecutiveKpi['band'] {
  return v >= 90 ? 'healthy' : v >= 75 ? 'watch' : v >= 50 ? 'at-risk' : 'critical';
}
function countBand(n: number): ExecutiveKpi['band'] {
  return n === 0 ? 'healthy' : n <= 3 ? 'watch' : 'at-risk';
}
function queueBand(h: number): ExecutiveKpi['band'] {
  return h <= 8 ? 'healthy' : h <= 24 ? 'watch' : 'at-risk';
}

/* ── the eight scheduling KPIs (composed from the mined routing schedule) ─────────── */

export interface SchedulingInsights {
  scheduleUtilization: number;
  machineUtilization: number;
  averageQueueHours: number;
  averageSetupHours: number;
  scheduleEfficiency: number;
  lateOperations: number;
  idleCapacity: number;
  routingViolations: number;
}

function scheduledOpsOf(schedule: RoutingSchedule): ScheduledRoutingOperation[] {
  return schedule.schedules.flatMap((p) => p.operations).filter((o) => o.scheduled);
}

/** Roll the mined routing schedule into the eight scheduling KPIs. Pure — nothing is re-scheduled. */
export function deriveSchedulingInsights(schedule: RoutingSchedule): SchedulingInsights {
  const availLoads = schedule.machineLoads.filter((l) => l.available && l.capacityHours > 0);
  const totalLoad = availLoads.reduce((s, l) => s + l.loadHours, 0);
  const totalCapacity = availLoads.reduce((s, l) => s + l.capacityHours, 0);
  const scheduleUtilization = totalCapacity > 0 ? clamp(round((totalLoad / totalCapacity) * 100), 0, 100) : 0;
  const machineUtilization = availLoads.length === 0 ? 0 : clamp(round(mean(availLoads.map((l) => l.utilization))), 0, 100);
  const idleCapacity = clamp(100 - scheduleUtilization, 0, 100);

  const ops = scheduledOpsOf(schedule);
  const averageQueueHours = ops.length === 0 ? 0 : round(mean(ops.map((o) => o.queueHours)));
  const averageSetupHours = ops.length === 0 ? 0 : round(mean(ops.map((o) => o.setupHours + o.changeoverHours)));
  const efficiencies = ops.map((o) => (o.durationHours > 0 ? clamp((o.runHours / o.durationHours) * 100, 0, 100) : 100));
  const scheduleEfficiency = efficiencies.length === 0 ? 100 : clamp(round(mean(efficiencies)), 0, 100);

  const lateOperations = schedule.schedules.filter((p) => p.late).reduce((s, p) => s + p.operations.filter((o) => o.scheduled).length, 0);
  const routingViolations =
    schedule.schedules.filter((p) => p.status === 'unrouted').length +
    schedule.schedules.flatMap((p) => p.operations).filter((o) => !o.scheduled).length;

  return { scheduleUtilization, machineUtilization, averageQueueHours, averageSetupHours, scheduleEfficiency, lateOperations, idleCapacity, routingViolations };
}

/** Map scheduling insights to the eight Executive Center KPI tiles. Reuses the existing KPI type. */
export function schedulingInsightsToKpis(insights: SchedulingInsights): ExecutiveKpi[] {
  const dl = 'enterprise/schedule';
  return [
    { key: 'sch-schedule-util', label: 'Schedule Utilization', value: insights.scheduleUtilization, display: `${insights.scheduleUtilization}%`, band: insights.scheduleUtilization >= 60 && insights.scheduleUtilization <= 90 ? 'healthy' : insights.scheduleUtilization > 90 ? 'at-risk' : 'watch', deepLink: dl },
    { key: 'sch-machine-util', label: 'Machine Utilization', value: insights.machineUtilization, display: `${insights.machineUtilization}%`, band: insights.machineUtilization <= 90 ? 'healthy' : 'at-risk', deepLink: dl },
    { key: 'sch-avg-queue', label: 'Average Queue Time', value: insights.averageQueueHours, display: hoursDisplay(insights.averageQueueHours), band: queueBand(insights.averageQueueHours), deepLink: dl },
    { key: 'sch-avg-setup', label: 'Average Setup Time', value: insights.averageSetupHours, display: hoursDisplay(insights.averageSetupHours), band: queueBand(insights.averageSetupHours), deepLink: dl },
    { key: 'sch-efficiency', label: 'Schedule Efficiency', value: insights.scheduleEfficiency, display: `${insights.scheduleEfficiency}%`, band: pctBand(insights.scheduleEfficiency), deepLink: dl },
    { key: 'sch-late-ops', label: 'Late Operations', value: insights.lateOperations, display: `${insights.lateOperations}`, band: countBand(insights.lateOperations), deepLink: dl },
    { key: 'sch-idle-capacity', label: 'Idle Capacity', value: insights.idleCapacity, display: `${insights.idleCapacity}%`, band: insights.idleCapacity <= 40 ? 'healthy' : insights.idleCapacity <= 70 ? 'watch' : 'at-risk', deepLink: dl },
    { key: 'sch-routing-violations', label: 'Routing Violations', value: insights.routingViolations, display: `${insights.routingViolations}`, band: countBand(insights.routingViolations), deepLink: dl },
  ];
}

/* ── schedule-proposal lifecycle (governance, modeled on Decision Execution Handoff) ── */

export type ScheduleProposalStatus = 'proposed' | 'approved' | 'rejected' | 'committed' | 'superseded';
export const SCHEDULE_PROPOSAL_STATUSES: readonly ScheduleProposalStatus[] = ['proposed', 'approved', 'rejected', 'committed', 'superseded'];

export type ScheduleProposalAction = 'approve' | 'reject' | 'commit' | 'recalculate';

/** The one legal target status for an action from a status, or null. Recalculate supersedes the record. */
export function scheduleProposalTransition(action: ScheduleProposalAction, from: ScheduleProposalStatus): ScheduleProposalStatus | null {
  switch (action) {
    case 'approve':
      return from === 'proposed' ? 'approved' : null;
    case 'reject':
      return from === 'proposed' ? 'rejected' : null;
    case 'commit':
      return from === 'approved' ? 'committed' : null;
    case 'recalculate':
      return from === 'proposed' || from === 'approved' ? 'superseded' : null;
    default:
      return null;
  }
}

export interface ScheduleProposalRecord {
  id: string;
  proposalNumber: string;
  productionOrder: string;
  product: string;
  routingNumber: string;
  version: number;
  status: ScheduleProposalStatus;
  scheduledOps: number;
  blockedOps: number;
  lateOps: number;
  plannedStart: string;
  plannedFinish: string;
  machines: string[];
  /** How the scheduler chose machines for this proposal (deterministic, human-readable). */
  selectionBasis: string;
  /** The scheduled operations (JSON) captured at proposal time — the read-only plan. */
  operations: ScheduledRoutingOperation[];
  generatedBy: string;
  generatedTime: string;
  approvedBy: string;
  approvedAt: string;
  rejectionReason: string;
  rejectedBy: string;
  rejectedAt: string;
  committedBy: string;
  committedAt: string;
  committedSchedules: string[];
  late: boolean;
  createdAt: string;
  updatedAt: string;
}

function parseOps(v: unknown): ScheduledRoutingOperation[] {
  const s = str(v).trim();
  if (!s) return [];
  try {
    const p = JSON.parse(s);
    return Array.isArray(p) ? (p as ScheduledRoutingOperation[]) : [];
  } catch {
    return [];
  }
}

export function scheduleProposalFromRecord(record: EnterpriseEntity): ScheduleProposalRecord {
  const f = record.fields;
  return {
    id: record.id,
    proposalNumber: str(f.proposalNumber) || record.title,
    productionOrder: str(f.productionOrder),
    product: str(f.product),
    routingNumber: str(f.routingNumber),
    version: num(f.version) || 1,
    status: oneOf<ScheduleProposalStatus>(f.status, SCHEDULE_PROPOSAL_STATUSES, 'proposed'),
    scheduledOps: num(f.scheduledOps),
    blockedOps: num(f.blockedOps),
    lateOps: num(f.lateOps),
    plannedStart: str(f.plannedStart),
    plannedFinish: str(f.plannedFinish),
    machines: csv(f.machines),
    selectionBasis: str(f.selectionBasis),
    operations: parseOps(f.operations),
    generatedBy: str(f.generatedBy),
    generatedTime: str(f.generatedTime),
    approvedBy: str(f.approvedBy),
    approvedAt: str(f.approvedAt),
    rejectionReason: str(f.rejectionReason),
    rejectedBy: str(f.rejectedBy),
    rejectedAt: str(f.rejectedAt),
    committedBy: str(f.committedBy),
    committedAt: str(f.committedAt),
    committedSchedules: csv(f.committedSchedules),
    late: str(f.late) === 'true',
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

/** The deterministic machine-selection basis the routing engine used (surfaced for the proposal + AI). */
export const SCHEDULE_SELECTION_BASIS =
  'Eligible machines (work center + qualification) → earliest finish (least-loaded first) → highest availability → name. Offline / down / maintenance machines are excluded.';

/** Map a mined single-order plan into the fields of a new (proposed, read-only) schedule proposal. Pure. */
export function buildScheduleProposalFields(
  plan: ProductionSchedulePlan,
  orderNumber: string,
  version: number,
  generatedBy: string,
  now: string,
): Record<string, string | number> {
  const scheduled = plan.operations.filter((o) => o.scheduled);
  const machines = [...new Set(scheduled.map((o) => o.machine).filter((m) => m !== ''))];
  return {
    proposalNumber: `SPROP-${orderNumber}-v${version}`,
    productionOrder: orderNumber,
    product: plan.product,
    routingNumber: plan.routingNumber,
    version,
    status: 'proposed',
    scheduledOps: scheduled.length,
    blockedOps: plan.operations.filter((o) => !o.scheduled).length,
    lateOps: plan.late ? scheduled.length : 0,
    plannedStart: plan.plannedStart,
    plannedFinish: plan.plannedFinish,
    machines: machines.join(','),
    selectionBasis: SCHEDULE_SELECTION_BASIS,
    operations: JSON.stringify(plan.operations),
    generatedBy,
    generatedTime: now,
    late: plan.late ? 'true' : 'false',
  };
}

/**
 * Field-sets for the real Production Schedule records a COMMIT persists, built from the APPROVED
 * proposal's captured operations (not re-scheduled) — one record per scheduled operation. Pure.
 */
export function scheduleRecordFieldsFromOperations(operations: ScheduledRoutingOperation[], orderNumber: string): Array<Record<string, string>> {
  return operations
    .filter((op) => op.scheduled && op.machine)
    .map((op) => ({
      scheduleNumber: `SCH-${orderNumber}-${op.sequence}`,
      productionOrder: orderNumber,
      workCenter: op.workCenter,
      machine: op.machine,
      startDate: op.startDate,
      endDate: op.finishDate,
      status: 'scheduled',
    }));
}

/* ── Machine-Gantt model (per-machine lanes + time-scaled operation bars) ──────────── */

export interface ScheduleLane {
  machine: string;
  workCenter: string;
  status: string;
  available: boolean;
  utilization: number;
  loadHours: number;
  capacityHours: number;
  idleHours: number;
  bottleneck: boolean;
  maintenanceWindow: string;
}
export interface ScheduleBar {
  machine: string;
  order: string;
  product: string;
  operation: string;
  sequence: number;
  startHour: number;
  finishHour: number;
  durationHours: number;
  startDate: string;
  finishDate: string;
  late: boolean;
  maintenanceConflict: boolean;
  onBottleneck: boolean;
}
export interface ScheduleGanttModel {
  lanes: ScheduleLane[];
  bars: ScheduleBar[];
  maxHour: number;
  horizonDays: number;
}

/** Build the Machine-Gantt model directly from the mined routing schedule. Pure — no re-scheduling. */
export function buildScheduleGanttModel(schedule: RoutingSchedule): ScheduleGanttModel {
  const lanes: ScheduleLane[] = schedule.machineLoads.map((l) => ({
    machine: l.machine, workCenter: l.workCenter, status: l.status, available: l.available,
    utilization: l.utilization, loadHours: l.loadHours, capacityHours: l.capacityHours, idleHours: l.idleHours,
    bottleneck: l.bottleneck, maintenanceWindow: l.maintenanceWindow,
  }));
  const bars: ScheduleBar[] = [];
  for (const p of schedule.schedules) {
    for (const op of p.operations) {
      if (!op.scheduled || !op.machine) continue;
      bars.push({
        machine: op.machine, order: p.productionOrder, product: p.product, operation: op.operation, sequence: op.sequence,
        startHour: op.startHour, finishHour: op.finishHour, durationHours: Math.max(1, op.finishHour - op.startHour),
        startDate: op.startDate, finishDate: op.finishDate, late: p.late, maintenanceConflict: op.maintenanceConflict, onBottleneck: op.onBottleneck,
      });
    }
  }
  const maxHour = Math.max(MACHINE_HOURS_PER_DAY, ...bars.map((b) => b.finishHour), 0);
  return { lanes, bars, maxHour, horizonDays: schedule.horizonDays };
}

/* ── deterministic AI narrative (composes the computed numbers; invents nothing) ──── */

export interface ScheduleViolation {
  order: string;
  operation: string;
  workCenter: string;
  reason: string;
}
export interface ScheduleNarrative {
  summary: string;
  riskExplanation: string;
  machineRecommendation: string;
  delayAnalysis: string;
  routingExplanation: string;
  optimizations: string[];
  grounded: boolean;
}

/** List the routing violations (blocked / unrouted operations) with their real reasons. Pure. */
export function collectScheduleViolations(schedule: RoutingSchedule): ScheduleViolation[] {
  const out: ScheduleViolation[] = [];
  for (const p of schedule.schedules) {
    if (p.status === 'unrouted') {
      out.push({ order: p.productionOrder, operation: '—', workCenter: '—', reason: `No active routing for ${p.product}.` });
      continue;
    }
    for (const op of p.operations) {
      if (!op.scheduled) out.push({ order: p.productionOrder, operation: op.operation, workCenter: op.workCenter, reason: op.blockedReason });
    }
  }
  return out;
}

export function summarizeSchedule(schedule: RoutingSchedule, insights: SchedulingInsights): ScheduleNarrative {
  const orders = schedule.schedules;
  const planned = orders.filter((o) => o.status === 'planned');
  const blocked = orders.filter((o) => o.status === 'blocked');
  const unrouted = orders.filter((o) => o.status === 'unrouted');
  const late = orders.filter((o) => o.late);
  const ops = scheduledOpsOf(schedule);
  const loads = schedule.machineLoads.filter((l) => l.available);
  const busiest = loads.reduce<MachineLoad | null>((m, l) => (m === null || l.utilization > m.utilization ? l : m), null);
  const idlest = loads.reduce<MachineLoad | null>((m, l) => (m === null || l.utilization < m.utilization ? l : m), null);

  const summary =
    orders.length === 0
      ? 'No production orders are planned in the horizon, so there is nothing to schedule yet.'
      : `${orders.length} production order(s) routed across ${loads.length} available machine(s): ${planned.length} fully planned, ${blocked.length} blocked, ${unrouted.length} unrouted. ` +
        `${ops.length} operation(s) scheduled at ${insights.scheduleUtilization}% schedule utilization (avg queue ${hoursDisplay(insights.averageQueueHours)}, avg setup ${hoursDisplay(insights.averageSetupHours)}).`;

  const riskExplanation =
    insights.routingViolations === 0 && late.length === 0
      ? 'No routing violations and no late orders — the schedule is feasible as mined.'
      : `${insights.routingViolations} routing violation(s) and ${late.length} late order(s). Blocked operations stop their order's chain until a qualified machine frees up or leaves maintenance.`;

  const machineRecommendation =
    busiest && idlest && busiest.machine !== idlest.machine && busiest.utilization - idlest.utilization >= 20
      ? `${busiest.machine} is the busiest at ${busiest.utilization}%; ${idlest.machine} sits at ${idlest.utilization}%. Moving eligible operations from ${busiest.machine} to ${idlest.machine} would rebalance load.`
      : busiest
        ? `${busiest.machine} carries the highest load (${busiest.utilization}%). No materially idler qualified machine is available to offload to.`
        : 'No available machine carries load in the horizon.';

  const delayAnalysis =
    late.length === 0
      ? 'No order is projected to finish after its required date.'
      : `${late.length} order(s) finish late: ${late.slice(0, 5).map((o) => o.productionOrder).join(', ')}${late.length > 5 ? '…' : ''}. Late finishes trace to queue behind busier machines and to blocked operations.`;

  const routingExplanation =
    'Each operation is placed on an eligible machine (correct work center + qualified) with the earliest finish; ties break to the least-loaded, then most available, machine. Offline, down, and maintenance machines are excluded, and maintenance windows push overlapping operations to run after the window.';

  const optimizations: string[] = [];
  if (insights.averageSetupHours > 8) optimizations.push(`Average setup is ${hoursDisplay(insights.averageSetupHours)} — sequencing similar products cuts changeover.`);
  if (busiest && busiest.utilization >= 85) optimizations.push(`${busiest.machine} is a bottleneck at ${busiest.utilization}% — offload or add a shift.`);
  if (insights.routingViolations > 0) optimizations.push(`Resolve ${insights.routingViolations} routing violation(s): add qualified machines or clear maintenance.`);
  if (insights.scheduleEfficiency < 60) optimizations.push(`Schedule efficiency is ${insights.scheduleEfficiency}% — queue + setup dominate run time; reduce waiting.`);
  if (optimizations.length === 0) optimizations.push('The schedule is efficient and feasible — no material optimization identified.');

  return { summary, riskExplanation, machineRecommendation, delayAnalysis, routingExplanation, optimizations, grounded: true };
}

/* ── the read-only explore model the desktop Production Schedule screen consumes ──── */

export interface ScheduleOrderRow {
  /** The production order record id — the handle the UI uses to trigger a Propose action. */
  id: string;
  orderNumber: string;
  product: string;
  quantity: number;
  hasRouting: boolean;
  committed: boolean;
}
export interface ScheduleExploreModel {
  generatedAtMs: number;
  horizonDays: number;
  kpis: ExecutiveKpi[];
  insights: SchedulingInsights;
  gantt: ScheduleGanttModel;
  violations: ScheduleViolation[];
  narrative: ScheduleNarrative;
  machineLoads: MachineLoad[];
  proposals: ScheduleProposalRecord[];
  orders: ScheduleOrderRow[];
}

/** Assemble the read-only explore model from the mined schedule + governance proposals. Pure. */
export function buildScheduleExploreModel(
  schedule: RoutingSchedule,
  proposals: ScheduleProposalRecord[],
  orders: ScheduleOrderRow[],
  generatedAtMs: number,
): ScheduleExploreModel {
  const insights = deriveSchedulingInsights(schedule);
  return {
    generatedAtMs,
    horizonDays: schedule.horizonDays,
    kpis: schedulingInsightsToKpis(insights),
    insights,
    gantt: buildScheduleGanttModel(schedule),
    violations: collectScheduleViolations(schedule),
    narrative: summarizeSchedule(schedule, insights),
    machineLoads: schedule.machineLoads,
    proposals,
    orders,
  };
}
