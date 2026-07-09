/**
 * Manufacturing Execution System (MES) — the SHOP-FLOOR EXECUTION layer that converts an
 * approved, committed Production Schedule into real execution. It EXTENDS the existing
 * Production Execution records (it does not replace Manufacturing, Inventory, Maintenance,
 * Scheduling, Planning, or the Routing/Commit engines): a committed schedule is dispatched into
 * one execution per operation, each execution runs through a deterministic lifecycle
 * (dispatched → running → paused/blocked → inspection → completed), material is consumed and
 * finished goods produced ONLY through the Inventory Ledger, and downtime remains the
 * Maintenance authority. Execution begins only after a schedule has been committed.
 *
 * This file holds the deterministic execution DOMAIN + ANALYTICS: the execution-state and
 * shop-floor-event vocabularies, the `MesExecution` projection + record mapper, the pure
 * execution metrics (cycle / run / idle / downtime / setup / inspection time, availability,
 * performance, quality, OEE, first-pass yield, scrap rate, utilization — reusing the existing
 * manufacturing math, no duplicate formulas), the twelve Executive execution KPIs, and the
 * deterministic recommendations (dispatch-delayed, machine-overloaded, inspection-backlog,
 * material-shortage, high-scrap, operator-unavailable, maintenance-conflict, routing-violation)
 * — each carrying the arithmetic that produced it. Pure (no I/O); the backend module drives the
 * real records + ledger movements. The AI explains execution; it never dispatches, moves stock,
 * completes operations, or assigns operators.
 */
import type { EnterpriseEntity } from './enterpriseModule';
import type { ExecutiveKpi, ExecutiveRecommendation, ExecRecoPriority } from './executiveCenter';
import {
  calculateMachineAvailability,
  calculateOverallEquipmentEffectiveness,
  calculateProductionYield,
  calculateScrapRate,
} from './manufacturing';

/* ── module identity (extends the existing Production Execution module) ───────── */

export { PRODUCTION_EXECUTIONS_MODULE_ID, PRODUCTION_EXECUTION_KIND } from './manufacturing';

/* ── execution lifecycle + shop-floor events (deterministic vocabularies) ──────── */

export type MesExecutionState =
  | 'scheduled'
  | 'released'
  | 'dispatched'
  | 'waiting'
  | 'running'
  | 'paused'
  | 'blocked'
  | 'inspection'
  | 'completed'
  | 'cancelled';

export const MES_EXECUTION_STATES: readonly MesExecutionState[] = [
  'scheduled',
  'released',
  'dispatched',
  'waiting',
  'running',
  'paused',
  'blocked',
  'inspection',
  'completed',
  'cancelled',
];

/** Terminal states — no further transition. */
export const MES_TERMINAL_STATES: readonly MesExecutionState[] = ['completed', 'cancelled'];

export type MesEventType =
  | 'machine_started'
  | 'machine_stopped'
  | 'operator_assigned'
  | 'operator_removed'
  | 'material_issued'
  | 'material_returned'
  | 'operation_started'
  | 'operation_paused'
  | 'operation_resumed'
  | 'operation_completed'
  | 'quality_hold'
  | 'inspection_passed'
  | 'inspection_failed'
  | 'downtime'
  | 'maintenance_delay';

export const MES_EVENT_TYPES: readonly MesEventType[] = [
  'machine_started',
  'machine_stopped',
  'operator_assigned',
  'operator_removed',
  'material_issued',
  'material_returned',
  'operation_started',
  'operation_paused',
  'operation_resumed',
  'operation_completed',
  'quality_hold',
  'inspection_passed',
  'inspection_failed',
  'downtime',
  'maintenance_delay',
];

export type MesInspectionResult = '' | 'pending' | 'pass' | 'fail' | 'rework';

/* ── coercion helpers ──────────────────────────────────────────────────────── */

const str = (v: unknown): string => (v === null || v === undefined ? '' : String(v));
const num = (v: unknown): number => (typeof v === 'number' ? v : Number(str(v)) || 0);
const bool = (v: unknown): boolean => v === true || v === 'true' || v === 1 || v === '1';
const clamp = (n: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, n));
function oneOf<T extends string>(v: unknown, all: readonly T[], fallback: T): T {
  const s = str(v);
  return (all as readonly string[]).includes(s) ? (s as T) : fallback;
}
function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return Math.round(values.reduce((a, b) => a + b, 0) / values.length);
}

/* ── the execution projection (a superset of the run log, MES-aware) ──────────── */

export interface MesExecution {
  id: string;
  executionNumber: string;
  productionOrder: string;
  /** The committed Production Schedule record this execution runs. */
  schedule: string;
  operation: string;
  sequence: number;
  workCenter: string;
  machine: string;
  operator: string;
  product: string;
  warehouse: string;
  bom: string;
  plannedQuantity: number;
  /** First operation backflushes material; final operation posts finished goods. */
  firstOperation: boolean;
  finalOperation: boolean;
  status: MesExecutionState;
  blockedReason: string;
  startTime: string;
  endTime: string;
  setupMinutes: number;
  runMinutes: number;
  downtimeMinutes: number;
  inspectionMinutes: number;
  goodQuantity: number;
  scrapQuantity: number;
  scrapReason: string;
  inspectionRequired: boolean;
  inspectionResult: MesInspectionResult;
  acceptedQuantity: number;
  rejectedQuantity: number;
  reworkQuantity: number;
  qualityNotes: string;
  materialMovements: string;
  outputMovement: string;
  scrapMovement: string;
  createdAt: string;
  updatedAt: string;
}

/** Map an execution record to the MES projection. Deterministic (no I/O). */
export function mesExecutionFromRecord(record: EnterpriseEntity): MesExecution {
  const f = record.fields;
  return {
    id: record.id,
    executionNumber: str(f.executionNumber) || record.title,
    productionOrder: str(f.productionOrder),
    schedule: str(f.schedule),
    operation: str(f.operation),
    sequence: num(f.sequence),
    workCenter: str(f.workCenter),
    machine: str(f.machine),
    operator: str(f.operator),
    product: str(f.product),
    warehouse: str(f.warehouse),
    bom: str(f.bom),
    plannedQuantity: num(f.plannedQuantity),
    firstOperation: bool(f.firstOperation),
    finalOperation: bool(f.finalOperation),
    status: oneOf<MesExecutionState>(f.status, MES_EXECUTION_STATES, 'scheduled'),
    blockedReason: str(f.blockedReason),
    startTime: str(f.startTime),
    endTime: str(f.endTime),
    setupMinutes: num(f.setupMinutes),
    runMinutes: num(f.runMinutes),
    downtimeMinutes: num(f.downtimeMinutes),
    inspectionMinutes: num(f.inspectionMinutes),
    goodQuantity: num(f.goodQuantity),
    scrapQuantity: num(f.scrapQuantity),
    scrapReason: str(f.scrapReason),
    inspectionRequired: bool(f.inspectionRequired),
    inspectionResult: oneOf<MesInspectionResult>(f.inspectionResult, ['', 'pending', 'pass', 'fail', 'rework'], ''),
    acceptedQuantity: num(f.acceptedQuantity),
    rejectedQuantity: num(f.rejectedQuantity),
    reworkQuantity: num(f.reworkQuantity),
    qualityNotes: str(f.qualityNotes),
    materialMovements: str(f.materialMovements),
    outputMovement: str(f.outputMovement),
    scrapMovement: str(f.scrapMovement),
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

export function isTerminalExecution(state: MesExecutionState): boolean {
  return (MES_TERMINAL_STATES as readonly string[]).includes(state);
}

/* ── deterministic execution metrics (reuse the manufacturing math) ───────────── */

/** Total elapsed cycle time (minutes) = setup + run + downtime + inspection. Deterministic. */
export function calculateCycleTime(e: MesExecution): number {
  return Math.max(0, e.setupMinutes + e.runMinutes + e.downtimeMinutes + e.inspectionMinutes);
}

/** Idle time (minutes) = downtime (non-productive elapsed within the cycle). Deterministic. */
export function calculateIdleTime(e: MesExecution): number {
  return Math.max(0, e.downtimeMinutes);
}

/** Availability 0..100 — run vs run + downtime (reuses the manufacturing rule). Deterministic. */
export function calculateExecutionAvailability(e: MesExecution): number {
  return calculateMachineAvailability(e.runMinutes, e.downtimeMinutes);
}

/** Performance 0..100 — produced (good + scrap) vs planned. Deterministic. */
export function calculateExecutionPerformance(e: MesExecution): number {
  if (e.plannedQuantity <= 0) return 0;
  return clamp(Math.round(((e.goodQuantity + e.scrapQuantity) / e.plannedQuantity) * 100), 0, 100);
}

/** First-pass yield 0..100 — good vs good + scrap (reuses production yield). Deterministic. */
export function calculateFirstPassYield(goodQuantity: number, scrapQuantity: number): number {
  return calculateProductionYield(goodQuantity, scrapQuantity);
}

/** Execution OEE 0..100 — Availability × Performance × Quality (reuses the manufacturing rule). */
export function calculateExecutionOee(e: MesExecution): number {
  return calculateOverallEquipmentEffectiveness(
    calculateExecutionAvailability(e),
    calculateExecutionPerformance(e),
    calculateFirstPassYield(e.goodQuantity, e.scrapQuantity),
  );
}

/** Utilization 0..100 — run vs total cycle time. Deterministic. */
export function calculateExecutionUtilization(e: MesExecution): number {
  const cycle = calculateCycleTime(e);
  if (cycle <= 0) return 0;
  return clamp(Math.round((e.runMinutes / cycle) * 100), 0, 100);
}

/* ── aggregate insights (Executive Center) ─────────────────────────────────── */

export interface MesExecutionInsights {
  productionProgress: number;
  executionHealth: number;
  scheduleAdherence: number;
  machineUtilization: number;
  oee: number;
  qualityYield: number;
  scrapRate: number;
  downtimeImpact: number;
  blockedOperations: number;
  productionRisk: number;
  manufacturingReadiness: number;
  completionForecast: number;
}

/** Roll the execution records into the twelve Executive execution KPIs. Pure. */
export function deriveMesInsights(executions: MesExecution[]): MesExecutionInsights {
  const n = executions.length;
  const byState = (s: MesExecutionState): MesExecution[] => executions.filter((e) => e.status === s);
  const completed = byState('completed');
  const running = byState('running');
  const inspection = byState('inspection');
  const paused = byState('paused');
  const blocked = byState('blocked');
  const cancelled = byState('cancelled');

  const productionProgress = n === 0 ? 100 : clamp(Math.round((completed.length / n) * 100), 0, 100);
  const scheduleAdherence = n === 0 ? 100 : clamp(Math.round(((n - blocked.length - cancelled.length) / n) * 100), 0, 100);

  const utilized = executions.filter((e) => calculateCycleTime(e) > 0);
  const machineUtilization = utilized.length === 0 ? 0 : clamp(mean(utilized.map((e) => calculateExecutionUtilization(e))), 0, 100);
  const oee = completed.length === 0 ? 0 : clamp(mean(completed.map((e) => calculateExecutionOee(e))), 0, 100);

  const sumGood = executions.reduce((s, e) => s + Math.max(0, e.goodQuantity), 0);
  const sumScrap = executions.reduce((s, e) => s + Math.max(0, e.scrapQuantity), 0);
  const qualityYield = calculateFirstPassYield(sumGood, sumScrap);
  const scrapRate = calculateScrapRate(sumGood, sumScrap);

  const totalRun = executions.reduce((s, e) => s + Math.max(0, e.runMinutes), 0);
  const totalDowntime = executions.reduce((s, e) => s + Math.max(0, e.downtimeMinutes), 0);
  const downtimeImpact = totalRun + totalDowntime <= 0 ? 0 : clamp(Math.round((totalDowntime / (totalRun + totalDowntime)) * 100), 0, 100);

  const blockedOperations = blocked.length;
  const blockedShare = n === 0 ? 0 : Math.round((blocked.length / n) * 100);
  const productionRisk = clamp(Math.round((blockedShare + scrapRate + downtimeImpact) / 3), 0, 100);
  const executionHealth = clamp(100 - productionRisk, 0, 100);

  const progressing = running.length + completed.length + inspection.length + paused.length;
  const manufacturingReadiness = n === 0 ? 100 : clamp(Math.round((progressing / n) * 100), 0, 100);
  const completionForecast =
    n === 0 ? 100 : clamp(Math.round(((completed.length + (running.length + inspection.length + paused.length) * 0.5) / n) * 100), 0, 100);

  return {
    productionProgress,
    executionHealth,
    scheduleAdherence,
    machineUtilization,
    oee,
    qualityYield,
    scrapRate,
    downtimeImpact,
    blockedOperations,
    productionRisk,
    manufacturingReadiness,
    completionForecast,
  };
}

/** Map execution insights to Executive Center KPI tiles (reuses the existing KPI type). */
export function mesInsightsToKpis(insights: MesExecutionInsights): ExecutiveKpi[] {
  const pctBand = (v: number): ExecutiveKpi['band'] => (v >= 90 ? 'healthy' : v >= 75 ? 'watch' : 'at-risk');
  const riskBand = (v: number): ExecutiveKpi['band'] => (v <= 10 ? 'healthy' : v <= 25 ? 'watch' : 'at-risk');
  const blockedBand: ExecutiveKpi['band'] =
    insights.blockedOperations === 0 ? 'healthy' : insights.blockedOperations <= 2 ? 'watch' : 'at-risk';
  return [
    { key: 'mes-progress', label: 'Production Progress', value: insights.productionProgress, display: `${insights.productionProgress}%`, band: pctBand(insights.productionProgress), deepLink: 'enterprise/executive' },
    { key: 'mes-health', label: 'Execution Health', value: insights.executionHealth, display: `${insights.executionHealth}%`, band: pctBand(insights.executionHealth), deepLink: 'enterprise/executive' },
    { key: 'mes-adherence', label: 'Schedule Adherence', value: insights.scheduleAdherence, display: `${insights.scheduleAdherence}%`, band: pctBand(insights.scheduleAdherence), deepLink: 'enterprise/executive' },
    { key: 'mes-utilization', label: 'Machine Utilization', value: insights.machineUtilization, display: `${insights.machineUtilization}%`, band: pctBand(insights.machineUtilization), deepLink: 'enterprise/executive' },
    { key: 'mes-oee', label: 'Overall Equipment Effectiveness', value: insights.oee, display: `${insights.oee}%`, band: pctBand(insights.oee), deepLink: 'enterprise/executive' },
    { key: 'mes-quality', label: 'Quality Yield', value: insights.qualityYield, display: `${insights.qualityYield}%`, band: pctBand(insights.qualityYield), deepLink: 'enterprise/executive' },
    { key: 'mes-scrap', label: 'Scrap Rate', value: insights.scrapRate, display: `${insights.scrapRate}%`, band: riskBand(insights.scrapRate), deepLink: 'enterprise/executive' },
    { key: 'mes-downtime', label: 'Downtime Impact', value: insights.downtimeImpact, display: `${insights.downtimeImpact}%`, band: riskBand(insights.downtimeImpact), deepLink: 'enterprise/executive' },
    { key: 'mes-blocked', label: 'Blocked Operations', value: insights.blockedOperations, display: `${insights.blockedOperations}`, band: blockedBand, deepLink: 'enterprise/executive' },
    { key: 'mes-risk', label: 'Production Risk', value: insights.productionRisk, display: `${insights.productionRisk}%`, band: riskBand(insights.productionRisk), deepLink: 'enterprise/executive' },
    { key: 'mes-readiness', label: 'Manufacturing Readiness', value: insights.manufacturingReadiness, display: `${insights.manufacturingReadiness}%`, band: pctBand(insights.manufacturingReadiness), deepLink: 'enterprise/executive' },
    { key: 'mes-forecast', label: 'Completion Forecast', value: insights.completionForecast, display: `${insights.completionForecast}%`, band: pctBand(insights.completionForecast), deepLink: 'enterprise/executive' },
  ];
}

/* ── recommendations (flow into the existing Executive recommendation system) ── */

/** Machine overload threshold — active executions on one machine at/above which it is overloaded. */
export const MES_MACHINE_OVERLOAD_THRESHOLD = 3;
/** Inspection backlog threshold — executions awaiting inspection at/above which it is a backlog. */
export const MES_INSPECTION_BACKLOG_THRESHOLD = 2;
/** Scrap rate (%) at/above which an execution is flagged high-scrap. */
export const MES_HIGH_SCRAP_THRESHOLD = 10;

function rank(priority: ExecRecoPriority, confidence: number): number {
  const base: Record<ExecRecoPriority, number> = { critical: 1000, high: 700, medium: 400, low: 100 };
  return Math.round(base[priority] + confidence * 100);
}

const ACTIVE_STATES: readonly MesExecutionState[] = ['dispatched', 'waiting', 'running', 'paused', 'blocked', 'inspection'];

/**
 * Deterministic execution recommendations — dispatch-delayed / machine-overloaded /
 * inspection-backlog / material-shortage / high-scrap / operator-unavailable /
 * maintenance-conflict / routing-violation — read straight off the execution records. Each
 * carries the arithmetic that produced it and flows through the EXISTING Executive
 * recommendation + timeline system. The AI explains these; it never dispatches or executes.
 */
export function mesRecommendations(executions: MesExecution[], limit = 20): ExecutiveRecommendation[] {
  const recs: ExecutiveRecommendation[] = [];

  // Dispatch delayed — executions dispatched but not yet started.
  const dispatched = executions.filter((e) => e.status === 'dispatched');
  if (dispatched.length > 0) {
    recs.push({
      id: 'mes:dispatch-delayed',
      metric: 'production',
      icon: 'send',
      problem: `Dispatch delayed — ${dispatched.length} dispatched operation(s) have not started.`,
      businessImpact: 'Dispatched-but-idle operations hold up the schedule and downstream operations.',
      rootCause: `${dispatched.length} execution(s) are in the dispatched state with no start recorded.`,
      priority: dispatched.length >= 5 ? 'high' : 'medium',
      confidence: 0.9,
      expectedOutcome: 'Starting the dispatched operations releases the shop-floor queue.',
      evidence: [`dispatched=${dispatched.length}`, `operations=${dispatched.map((e) => e.executionNumber).slice(0, 5).join(',')}`],
      sourceSystems: ['manufacturing'],
      recommendedAction: 'Start the dispatched operations (or reassign their machines/operators).',
      owner: 'Production Supervisor',
      eta: 'today',
      status: 'open',
      score: rank(dispatched.length >= 5 ? 'high' : 'medium', 0.9),
    });
  }

  // Machine overloaded — a machine carrying many active operations.
  const activeByMachine = new Map<string, number>();
  for (const e of executions) {
    if (!e.machine || !(ACTIVE_STATES as readonly string[]).includes(e.status)) continue;
    activeByMachine.set(e.machine, (activeByMachine.get(e.machine) ?? 0) + 1);
  }
  for (const [machine, count] of [...activeByMachine.entries()].sort((a, b) => b[1] - a[1])) {
    if (count < MES_MACHINE_OVERLOAD_THRESHOLD) continue;
    recs.push({
      id: `mes:overload:${machine}`,
      metric: 'capacity',
      icon: 'alert-triangle',
      problem: `Machine overloaded — ${machine} has ${count} active operation(s) at once.`,
      businessImpact: 'A machine with too many concurrent operations serializes work and delays completion.',
      rootCause: `${count} executions are active on ${machine} (threshold ${MES_MACHINE_OVERLOAD_THRESHOLD}).`,
      priority: 'high',
      confidence: 0.85,
      expectedOutcome: 'Re-routing some operations to another qualified machine relieves the load.',
      evidence: [`machine=${machine}`, `activeOps=${count}`, `threshold=${MES_MACHINE_OVERLOAD_THRESHOLD}`],
      sourceSystems: ['manufacturing', 'planning'],
      recommendedAction: `Re-route or resequence operations off ${machine}.`,
      owner: 'Production Supervisor',
      eta: 'today',
      status: 'open',
      score: rank('high', 0.85),
    });
  }

  // Inspection backlog — executions awaiting inspection.
  const awaitingInspection = executions.filter((e) => e.status === 'inspection');
  if (awaitingInspection.length >= MES_INSPECTION_BACKLOG_THRESHOLD) {
    recs.push({
      id: 'mes:inspection-backlog',
      metric: 'quality',
      icon: 'search',
      problem: `Inspection backlog — ${awaitingInspection.length} operation(s) are held awaiting inspection.`,
      businessImpact: 'Operations held in inspection cannot complete; finished goods are delayed.',
      rootCause: `${awaitingInspection.length} executions are in the inspection state (threshold ${MES_INSPECTION_BACKLOG_THRESHOLD}).`,
      priority: 'medium',
      confidence: 0.85,
      expectedOutcome: 'Clearing the inspection queue releases the held operations.',
      evidence: [`awaitingInspection=${awaitingInspection.length}`, `threshold=${MES_INSPECTION_BACKLOG_THRESHOLD}`],
      sourceSystems: ['manufacturing', 'quality'],
      recommendedAction: 'Assign QA to clear the inspection backlog.',
      owner: 'Quality Lead',
      eta: 'today',
      status: 'open',
      score: rank('medium', 0.85),
    });
  }

  // Material shortage — blocked executions whose block is material-related.
  const materialBlocked = executions.filter((e) => e.status === 'blocked' && /material|stock|shortage/i.test(e.blockedReason));
  for (const e of materialBlocked) {
    recs.push({
      id: `mes:material:${e.executionNumber}`,
      metric: 'inventory',
      icon: 'package',
      problem: `Material shortage — ${e.operation || e.executionNumber} (${e.productionOrder}) is blocked: ${e.blockedReason}.`,
      businessImpact: 'A material-blocked operation halts the order until stock is available.',
      rootCause: `Execution ${e.executionNumber} is blocked for material: ${e.blockedReason}.`,
      priority: 'high',
      confidence: 0.9,
      expectedOutcome: 'Replenishing the component (via procurement/warehouse) unblocks the operation.',
      evidence: [`execution=${e.executionNumber}`, `product=${e.product}`, `reason=${e.blockedReason}`],
      sourceSystems: ['manufacturing', 'inventory'],
      recommendedAction: `Replenish material for ${e.product} to unblock ${e.executionNumber}.`,
      owner: 'Procurement',
      eta: 'today',
      status: 'open',
      score: rank('high', 0.9),
    });
  }

  // High scrap — an execution scrapping above the threshold.
  for (const e of executions) {
    const rate = calculateScrapRate(e.goodQuantity, e.scrapQuantity);
    if (e.scrapQuantity > 0 && rate >= MES_HIGH_SCRAP_THRESHOLD) {
      recs.push({
        id: `mes:scrap:${e.executionNumber}`,
        metric: 'quality',
        icon: 'trash',
        problem: `High scrap — ${e.operation || e.executionNumber} scrapped ${e.scrapQuantity} (${rate}% scrap rate).`,
        businessImpact: 'A high scrap rate wastes material and lowers first-pass yield.',
        rootCause: `Scrap ${e.scrapQuantity} of ${e.goodQuantity + e.scrapQuantity} produced = ${rate}% (threshold ${MES_HIGH_SCRAP_THRESHOLD}%).`,
        priority: 'high',
        confidence: 0.85,
        expectedOutcome: 'Root-causing the scrap (tooling/material/setup) restores yield.',
        evidence: [`execution=${e.executionNumber}`, `good=${e.goodQuantity}`, `scrap=${e.scrapQuantity}`, `scrapRate=${rate}%`],
        sourceSystems: ['manufacturing', 'quality'],
        recommendedAction: `Investigate scrap on ${e.operation || e.executionNumber} (${e.machine || 'machine'}).`,
        owner: 'Quality Lead',
        eta: 'this week',
        status: 'open',
        score: rank('high', 0.85),
      });
    }
  }

  // Operator unavailable — an active operation with no operator assigned.
  const noOperator = executions.filter((e) => (e.status === 'running' || e.status === 'dispatched') && !e.operator);
  for (const e of noOperator) {
    recs.push({
      id: `mes:operator:${e.executionNumber}`,
      metric: 'production',
      icon: 'user-x',
      problem: `Operator unavailable — ${e.operation || e.executionNumber} is ${e.status} with no operator assigned.`,
      businessImpact: 'An operation without an operator cannot progress reliably.',
      rootCause: `Execution ${e.executionNumber} is ${e.status} and has no operator.`,
      priority: 'medium',
      confidence: 0.8,
      expectedOutcome: 'Assigning an operator lets the operation run.',
      evidence: [`execution=${e.executionNumber}`, `status=${e.status}`, `operator=none`],
      sourceSystems: ['manufacturing'],
      recommendedAction: `Assign an operator to ${e.operation || e.executionNumber}.`,
      owner: 'Production Supervisor',
      eta: 'today',
      status: 'open',
      score: rank('medium', 0.8),
    });
  }

  // Maintenance conflict — a blocked/downtime operation tied to maintenance.
  const maintenanceBlocked = executions.filter(
    (e) => (e.status === 'blocked' && /maintenance|breakdown|down|repair/i.test(e.blockedReason)) || (e.downtimeMinutes > 0 && e.status === 'blocked'),
  );
  for (const e of maintenanceBlocked) {
    recs.push({
      id: `mes:maintenance:${e.executionNumber}`,
      metric: 'maintenance',
      icon: 'tool',
      problem: `Maintenance conflict — ${e.operation || e.executionNumber} is blocked on ${e.machine || 'a machine'}${e.blockedReason ? `: ${e.blockedReason}` : ''}.`,
      businessImpact: 'A maintenance-blocked operation waits until the machine returns to service.',
      rootCause: `Execution ${e.executionNumber} is blocked${e.downtimeMinutes > 0 ? ` with ${e.downtimeMinutes}m downtime` : ''} (authority: Maintenance).`,
      priority: 'high',
      confidence: 0.8,
      expectedOutcome: 'Completing maintenance (or re-routing) returns the operation to running.',
      evidence: [`execution=${e.executionNumber}`, `machine=${e.machine}`, `downtimeMinutes=${e.downtimeMinutes}`],
      sourceSystems: ['manufacturing', 'maintenance'],
      recommendedAction: `Resolve maintenance on ${e.machine || 'the machine'} or re-route ${e.executionNumber}.`,
      owner: 'Maintenance Planner',
      eta: 'today',
      status: 'open',
      score: rank('high', 0.8),
    });
  }

  // Routing violation — a later operation completed while an earlier one on the same order is not.
  const byOrder = new Map<string, MesExecution[]>();
  for (const e of executions) {
    if (!e.productionOrder) continue;
    const arr = byOrder.get(e.productionOrder) ?? [];
    arr.push(e);
    byOrder.set(e.productionOrder, arr);
  }
  for (const [orderRef, ops] of byOrder) {
    const completedMax = Math.max(-1, ...ops.filter((o) => o.status === 'completed').map((o) => o.sequence));
    const earlierIncomplete = ops.filter((o) => o.status !== 'completed' && o.status !== 'cancelled' && o.sequence < completedMax);
    if (completedMax >= 0 && earlierIncomplete.length > 0) {
      const seqs = earlierIncomplete.map((o) => o.sequence).sort((a, b) => a - b);
      recs.push({
        id: `mes:routing:${orderRef}`,
        metric: 'production',
        icon: 'git-branch',
        problem: `Routing violation — ${orderRef} completed operation ${completedMax} while earlier operation(s) ${seqs.join(', ')} are not complete.`,
        businessImpact: 'Completing a later operation before an earlier one breaks the routing dependency chain.',
        rootCause: `Operation ${completedMax} is completed but operation(s) ${seqs.join(', ')} (earlier in the routing) are not.`,
        priority: 'high',
        confidence: 0.85,
        expectedOutcome: 'Enforcing routing order prevents out-of-sequence completion.',
        evidence: [`order=${orderRef}`, `completedSeq=${completedMax}`, `incompleteEarlier=${seqs.join(',')}`],
        sourceSystems: ['manufacturing', 'planning'],
        recommendedAction: `Review ${orderRef}: complete operations in routing order (${seqs.join(', ')} before ${completedMax}).`,
        owner: 'Production Planner',
        eta: 'today',
        status: 'open',
        score: rank('high', 0.85),
      });
    }
  }

  return recs.sort((a, b) => b.score - a.score).slice(0, limit);
}
