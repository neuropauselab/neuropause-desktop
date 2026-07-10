/**
 * Operator Console model (MES read-only projection) — the single deterministic model the desktop
 * Operator Console screen reads. It EXTENDS the Manufacturing Execution System: it invents nothing,
 * owns no records, and writes nothing. Every number is composed from the REAL execution records
 * (`MesExecution`) and the immutable shop-floor event ledger (`ManufacturingEvent`) by reusing the
 * existing pure engines — `deriveMesInsights` / `deriveMesSupplementalInsights` (KPIs), the
 * event-sourced `deriveExecutionTelemetry` / `deriveMachineTimeline` / `deriveOperatorTimeline` /
 * `deriveEventOee` / `deriveEventInsights` (live timelines + OEE) — and joining them onto the
 * execution records for the Operator Console, Machine Status, Work Orders, Quality, Execution
 * Timeline and Real-time Progress surfaces. The AI narrative EXPLAINS the shop floor (production
 * summary / delay / root cause / quality / operator + maintenance suggestions) and never changes it.
 *
 * Pure (no I/O); the clock (`nowMs`) is injected so live elapsed/remaining times are deterministic.
 */
import type { ExecutiveKpi } from './executiveCenter';
import type {
  MesExecution,
  MesExecutionState,
  MesExecutionInsights,
  MesSupplementalInsights,
} from './mes';
import {
  MES_TERMINAL_STATES,
  calculateCycleTime,
  calculateExecutionOee,
  calculateFirstPassYield,
  deriveMesInsights,
  deriveMesSupplementalInsights,
  mesInsightsToKpis,
  mesSupplementalInsightsToKpis,
} from './mes';
import type {
  DerivedState,
  EventInsights,
  EventOee,
  ExecutionTelemetry,
  ManufacturingEvent,
  ManufacturingEventType,
} from './mesEvents';
import {
  deriveEventInsights,
  deriveEventOee,
  deriveExecutionTelemetry,
  deriveMachineTimeline,
  deriveOperatorTimeline,
  sortEvents,
} from './mesEvents';

/* ── quality vocabulary ─────────────────────────────────────────────────────── */

export type ConsoleQualityStatus = 'none' | 'pending' | 'pass' | 'fail' | 'rework';

/* ── row projections (one per Operator Console surface) ─────────────────────── */

export interface ConsoleExecutionRow {
  id: string;
  executionNumber: string;
  productionOrder: string;
  schedule: string;
  operation: string;
  sequence: number;
  workCenter: string;
  machine: string;
  operator: string;
  product: string;
  status: MesExecutionState;
  plannedQuantity: number;
  goodQuantity: number;
  scrapQuantity: number;
  reworkQuantity: number;
  remainingQuantity: number;
  /** Completion 0..100 — good units over planned units. */
  progress: number;
  /** Live elapsed minutes (event-sourced: started → completed, or started → now). */
  elapsedMinutes: number;
  /** Deterministic remaining-time estimate from elapsed and progress. */
  remainingMinutes: number;
  cycleTime: number;
  oee: number;
  firstPassYield: number;
  qualityStatus: ConsoleQualityStatus;
  blockedReason: string;
  firstOperation: boolean;
  finalOperation: boolean;
  startTime: string;
  endTime: string;
  /** Started and not yet completed (event-sourced). */
  live: boolean;
}

export interface ConsoleOperatorRow {
  operator: string;
  currentAssignment: string;
  currentMachine: string;
  currentOperation: string;
  workload: number;
  idleMinutes: number;
  utilization: number;
  completedOperations: number;
  assignedExecutions: string[];
}

export interface ConsoleMachineRow {
  machine: string;
  workCenter: string;
  currentState: DerivedState;
  currentOperator: string;
  runningJob: string;
  queueLength: number;
  todaysRuntime: number;
  todaysDowntime: number;
  todaysUtilization: number;
  lastMaintenance: string;
  activeExecutions: number;
}

export type ConsoleWorkOrderStatus = 'queued' | 'running' | 'blocked' | 'completed';

export interface ConsoleWorkOrderRow {
  productionOrder: string;
  product: string;
  totalOperations: number;
  completedOperations: number;
  runningOperations: number;
  blockedOperations: number;
  progress: number;
  plannedQuantity: number;
  goodQuantity: number;
  scrapQuantity: number;
  status: ConsoleWorkOrderStatus;
  machines: string[];
}

export interface ConsoleQualityRow {
  id: string;
  executionNumber: string;
  productionOrder: string;
  operation: string;
  machine: string;
  status: Exclude<ConsoleQualityStatus, 'none'>;
  inspectionRequired: boolean;
  goodQuantity: number;
  scrapQuantity: number;
  reworkQuantity: number;
  firstPassYield: number;
  notes: string;
  blockedReason: string;
}

export interface ConsoleTimelineEvent {
  id: string;
  sequence: number;
  timestamp: string;
  eventType: ManufacturingEventType;
  label: string;
  execution: string;
  productionOrder: string;
  operation: string;
  machine: string;
  operator: string;
  quantity: number;
  reason: string;
}

export interface ExecutionCounts {
  total: number;
  queued: number;
  running: number;
  paused: number;
  blocked: number;
  inspection: number;
  completed: number;
  cancelled: number;
}

export interface ExecutionNarrative {
  productionSummary: string;
  delayAnalysis: string;
  rootCause: string;
  qualityExplanation: string;
  operatorSuggestions: string;
  maintenanceSuggestions: string;
  grounded: boolean;
}

export interface ExecutionConsoleModel {
  generatedAtMs: number;
  kpis: ExecutiveKpi[];
  insights: MesExecutionInsights;
  supplemental: MesSupplementalInsights;
  oee: EventOee;
  eventInsights: EventInsights;
  counts: ExecutionCounts;
  executions: ConsoleExecutionRow[];
  operators: ConsoleOperatorRow[];
  machines: ConsoleMachineRow[];
  workOrders: ConsoleWorkOrderRow[];
  quality: ConsoleQualityRow[];
  timeline: ConsoleTimelineEvent[];
  narrative: ExecutionNarrative;
  eventCount: number;
}

/* ── helpers ────────────────────────────────────────────────────────────────── */

const clamp = (n: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, n));
function minutesBetween(aMs: number, bMs: number): number {
  return Math.max(0, Math.round((bMs - aMs) / 60000));
}
function isTerminal(s: MesExecutionState): boolean {
  return (MES_TERMINAL_STATES as readonly string[]).includes(s);
}
function isActive(s: MesExecutionState): boolean {
  return !isTerminal(s);
}
const QUEUED_STATES: readonly MesExecutionState[] = ['scheduled', 'released', 'dispatched', 'waiting'];
function isQueued(s: MesExecutionState): boolean {
  return (QUEUED_STATES as readonly string[]).includes(s);
}

/** Map an execution state to the derived shop-floor state (for machines with no events yet). */
function stateToDerived(s: MesExecutionState): DerivedState {
  switch (s) {
    case 'running':
      return 'running';
    case 'paused':
      return 'paused';
    case 'blocked':
      return 'blocked';
    case 'inspection':
      return 'inspection';
    case 'completed':
      return 'completed';
    case 'scheduled':
    case 'released':
    case 'dispatched':
    case 'waiting':
      return 'released';
    default:
      return 'idle';
  }
}

/** The quality status of an execution (none when it carries no quality signal). */
function qualityStatusOf(e: MesExecution): ConsoleQualityStatus {
  if (e.inspectionResult === 'pass' || e.inspectionResult === 'fail' || e.inspectionResult === 'rework' || e.inspectionResult === 'pending') {
    return e.inspectionResult;
  }
  if (e.status === 'inspection') return 'pending';
  return 'none';
}

/** Sort weight so live/at-risk work floats to the top of the console. */
function statusRank(s: MesExecutionState): number {
  switch (s) {
    case 'running':
      return 0;
    case 'inspection':
      return 1;
    case 'paused':
      return 2;
    case 'blocked':
      return 3;
    case 'dispatched':
      return 4;
    case 'waiting':
      return 5;
    case 'released':
      return 6;
    case 'scheduled':
      return 7;
    case 'completed':
      return 8;
    default:
      return 9;
  }
}

/** Human label for a shop-floor event (for the Execution Timeline). */
export function manufacturingEventLabel(t: ManufacturingEventType): string {
  const labels: Record<ManufacturingEventType, string> = {
    machine_started: 'Machine started',
    machine_stopped: 'Machine stopped',
    operation_released: 'Operation released',
    operation_started: 'Operation started',
    operation_paused: 'Operation paused',
    operation_resumed: 'Operation resumed',
    operation_completed: 'Operation completed',
    operator_assigned: 'Operator assigned',
    operator_removed: 'Operator removed',
    material_issued: 'Material issued',
    material_returned: 'Material returned',
    inspection_started: 'Sent to inspection',
    inspection_passed: 'Inspection passed',
    inspection_failed: 'Inspection failed',
    downtime_started: 'Downtime started',
    downtime_ended: 'Downtime ended',
    maintenance_started: 'Maintenance started',
    maintenance_finished: 'Maintenance finished',
    scrap_recorded: 'Scrap recorded',
    finished_goods_posted: 'Finished goods posted',
    order_closed: 'Order closed',
  };
  return labels[t] ?? t;
}

/* ── per-execution row (join the record to its event telemetry) ───────────────── */

function buildExecutionRow(e: MesExecution, telemetry: ExecutionTelemetry | undefined, nowMs: number): ConsoleExecutionRow {
  const good = Math.max(0, e.goodQuantity);
  const scrap = Math.max(0, e.scrapQuantity);
  const rework = Math.max(0, e.reworkQuantity);
  const remainingQuantity = e.status === 'completed' ? 0 : Math.max(0, e.plannedQuantity - good - scrap);
  const progress = e.plannedQuantity <= 0 ? (e.status === 'completed' ? 100 : 0) : clamp(Math.round((good / e.plannedQuantity) * 100), 0, 100);

  // Live elapsed: event-sourced when the operation has been started/completed; otherwise the record's
  // entered cycle time (only meaningful once completed). A live op accrues elapsed to `nowMs`.
  let elapsedMinutes = 0;
  if (telemetry && telemetry.started) {
    const startMs = Date.parse(telemetry.startedAt);
    if (Number.isFinite(startMs)) {
      const endMs = telemetry.completed && telemetry.completedAt ? Date.parse(telemetry.completedAt) : nowMs;
      elapsedMinutes = minutesBetween(startMs, Number.isFinite(endMs) ? endMs : nowMs);
    } else {
      elapsedMinutes = telemetry.cycleTime;
    }
  } else if (e.status === 'completed') {
    elapsedMinutes = calculateCycleTime(e);
  }

  // Deterministic remaining-time estimate: scale elapsed by the not-yet-done share of progress.
  const remainingMinutes =
    e.status === 'completed' || progress >= 100 ? 0 : progress > 0 && elapsedMinutes > 0 ? Math.round((elapsedMinutes * (100 - progress)) / progress) : 0;

  return {
    id: e.id,
    executionNumber: e.executionNumber,
    productionOrder: e.productionOrder,
    schedule: e.schedule,
    operation: e.operation,
    sequence: e.sequence,
    workCenter: e.workCenter,
    machine: e.machine,
    operator: e.operator,
    product: e.product,
    status: e.status,
    plannedQuantity: e.plannedQuantity,
    goodQuantity: good,
    scrapQuantity: scrap,
    reworkQuantity: rework,
    remainingQuantity,
    progress,
    elapsedMinutes,
    remainingMinutes,
    cycleTime: telemetry ? telemetry.cycleTime : calculateCycleTime(e),
    oee: e.status === 'completed' ? calculateExecutionOee(e) : 0,
    firstPassYield: calculateFirstPassYield(good, scrap),
    qualityStatus: qualityStatusOf(e),
    blockedReason: e.blockedReason,
    firstOperation: e.firstOperation,
    finalOperation: e.finalOperation,
    startTime: e.startTime,
    endTime: e.endTime,
    live: telemetry ? telemetry.started && !telemetry.completed : false,
  };
}

/* ── operator + machine rows (event timelines unioned with record assignments) ── */

function buildOperatorRows(executions: MesExecution[], events: ManufacturingEvent[], nowMs: number): ConsoleOperatorRow[] {
  const timelines = deriveOperatorTimeline(events, nowMs);
  const byOperator = new Map<string, ConsoleOperatorRow>();
  for (const t of timelines) {
    byOperator.set(t.operator, {
      operator: t.operator,
      currentAssignment: t.currentAssignment,
      currentMachine: t.currentMachine,
      currentOperation: t.currentOperation,
      workload: t.workload,
      idleMinutes: t.idleTime,
      utilization: t.utilization,
      completedOperations: t.completedOperations,
      assignedExecutions: [],
    });
  }
  // Union with operators named on active execution records (assigned but not yet event-logged).
  for (const e of executions) {
    if (!e.operator) continue;
    let row = byOperator.get(e.operator);
    if (!row) {
      row = {
        operator: e.operator,
        currentAssignment: '',
        currentMachine: '',
        currentOperation: '',
        workload: 0,
        idleMinutes: 0,
        utilization: 0,
        completedOperations: 0,
        assignedExecutions: [],
      };
      byOperator.set(e.operator, row);
    }
    if (isActive(e.status) && e.status !== 'scheduled') row.assignedExecutions.push(e.executionNumber);
  }
  return [...byOperator.values()].sort((a, b) => b.workload - a.workload || a.operator.localeCompare(b.operator));
}

function buildMachineRows(executions: MesExecution[], events: ManufacturingEvent[], nowMs: number): ConsoleMachineRow[] {
  const timelines = deriveMachineTimeline(events, nowMs);
  const workCenterOf = new Map<string, string>();
  const activeByMachine = new Map<string, number>();
  for (const e of executions) {
    if (!e.machine) continue;
    if (e.workCenter && !workCenterOf.has(e.machine)) workCenterOf.set(e.machine, e.workCenter);
    if (isActive(e.status)) activeByMachine.set(e.machine, (activeByMachine.get(e.machine) ?? 0) + 1);
  }
  const byMachine = new Map<string, ConsoleMachineRow>();
  for (const t of timelines) {
    byMachine.set(t.machine, {
      machine: t.machine,
      workCenter: workCenterOf.get(t.machine) ?? '',
      currentState: t.currentState,
      currentOperator: t.currentOperator,
      runningJob: t.runningJob,
      queueLength: t.queueLength,
      todaysRuntime: t.todaysRuntime,
      todaysDowntime: t.todaysDowntime,
      todaysUtilization: t.todaysUtilization,
      lastMaintenance: t.lastMaintenance,
      activeExecutions: activeByMachine.get(t.machine) ?? 0,
    });
  }
  // Union with machines that carry active execution records but have no events yet.
  for (const [machine, active] of activeByMachine) {
    if (byMachine.has(machine)) continue;
    const running = executions.find((e) => e.machine === machine && e.status === 'running');
    const anyActive = executions.find((e) => e.machine === machine && isActive(e.status));
    byMachine.set(machine, {
      machine,
      workCenter: workCenterOf.get(machine) ?? '',
      currentState: stateToDerived(running?.status ?? anyActive?.status ?? 'released'),
      currentOperator: running?.operator ?? '',
      runningJob: running?.executionNumber ?? '',
      queueLength: executions.filter((e) => e.machine === machine && isQueued(e.status)).length,
      todaysRuntime: 0,
      todaysDowntime: 0,
      todaysUtilization: 0,
      lastMaintenance: '',
      activeExecutions: active,
    });
  }
  return [...byMachine.values()].sort((a, b) => a.machine.localeCompare(b.machine));
}

/* ── work-order rollup + quality queue ────────────────────────────────────────── */

function buildWorkOrderRows(executions: MesExecution[]): ConsoleWorkOrderRow[] {
  const byOrder = new Map<string, MesExecution[]>();
  for (const e of executions) {
    if (!e.productionOrder) continue;
    const arr = byOrder.get(e.productionOrder) ?? [];
    arr.push(e);
    byOrder.set(e.productionOrder, arr);
  }
  const rows: ConsoleWorkOrderRow[] = [];
  for (const [productionOrder, ops] of byOrder) {
    const total = ops.length;
    const completed = ops.filter((o) => o.status === 'completed').length;
    const running = ops.filter((o) => o.status === 'running').length;
    const blocked = ops.filter((o) => o.status === 'blocked').length;
    const finalOp = ops.find((o) => o.finalOperation) ?? ops[ops.length - 1];
    const status: ConsoleWorkOrderStatus =
      completed === total ? 'completed' : blocked > 0 && running === 0 ? 'blocked' : running > 0 ? 'running' : 'queued';
    rows.push({
      productionOrder,
      product: finalOp?.product || ops.find((o) => o.product)?.product || '',
      totalOperations: total,
      completedOperations: completed,
      runningOperations: running,
      blockedOperations: blocked,
      progress: total === 0 ? 0 : clamp(Math.round((completed / total) * 100), 0, 100),
      plannedQuantity: finalOp?.plannedQuantity ?? 0,
      goodQuantity: ops.reduce((s, o) => s + Math.max(0, o.goodQuantity), 0),
      scrapQuantity: ops.reduce((s, o) => s + Math.max(0, o.scrapQuantity), 0),
      status,
      machines: [...new Set(ops.map((o) => o.machine).filter((m) => m !== ''))],
    });
  }
  return rows.sort((a, b) => a.progress - b.progress || a.productionOrder.localeCompare(b.productionOrder));
}

function buildQualityRows(executions: MesExecution[]): ConsoleQualityRow[] {
  const rows: ConsoleQualityRow[] = [];
  for (const e of executions) {
    const q = qualityStatusOf(e);
    const flagged = q !== 'none' || e.inspectionRequired || e.scrapQuantity > 0 || e.reworkQuantity > 0 || e.blockedReason === 'Quality hold';
    if (!flagged) continue;
    const status: Exclude<ConsoleQualityStatus, 'none'> = q === 'none' ? (e.reworkQuantity > 0 ? 'rework' : 'pending') : q;
    rows.push({
      id: e.id,
      executionNumber: e.executionNumber,
      productionOrder: e.productionOrder,
      operation: e.operation,
      machine: e.machine,
      status,
      inspectionRequired: e.inspectionRequired,
      goodQuantity: Math.max(0, e.goodQuantity),
      scrapQuantity: Math.max(0, e.scrapQuantity),
      reworkQuantity: Math.max(0, e.reworkQuantity),
      firstPassYield: calculateFirstPassYield(e.goodQuantity, e.scrapQuantity),
      notes: e.qualityNotes,
      blockedReason: e.blockedReason,
    });
  }
  const order: Record<string, number> = { fail: 0, pending: 1, rework: 2, pass: 3 };
  return rows.sort((a, b) => (order[a.status] ?? 9) - (order[b.status] ?? 9) || a.executionNumber.localeCompare(b.executionNumber));
}

/* ── deterministic narrative (explains the floor; invents nothing) ────────────── */

function buildNarrative(
  executions: MesExecution[],
  counts: ExecutionCounts,
  insights: MesExecutionInsights,
  supplemental: MesSupplementalInsights,
  machines: ConsoleMachineRow[],
  operators: ConsoleOperatorRow[],
): ExecutionNarrative {
  const n = counts.total;
  const productionSummary =
    n === 0
      ? 'No executions have been dispatched yet — commit and dispatch a Production Schedule to begin shop-floor execution.'
      : `${n} operation(s) on the floor: ${counts.running} running, ${counts.paused} paused, ${counts.blocked} blocked, ${counts.inspection} in inspection, ${counts.queued} queued, ${counts.completed} completed. ` +
        `Progress ${insights.productionProgress}%, OEE ${insights.oee}% (availability ${supplemental.availability}%, performance ${supplemental.performance}%, quality ${insights.qualityYield}%).`;

  const blockedOps = executions.filter((e) => e.status === 'blocked');
  const delayAnalysis =
    counts.blocked === 0 && counts.paused === 0
      ? 'No operation is blocked or paused — the floor is flowing.'
      : `${counts.blocked} blocked + ${counts.paused} paused operation(s) are holding the schedule. ` +
        (blockedOps.length > 0
          ? `Blocked: ${blockedOps.slice(0, 4).map((e) => `${e.executionNumber} (${e.blockedReason || 'no reason'})`).join('; ')}${blockedOps.length > 4 ? '…' : ''}.`
          : 'Paused operations should be resumed or re-sequenced.');

  const busiest = [...machines].sort((a, b) => b.activeExecutions - a.activeExecutions)[0];
  const rootCause =
    counts.blocked === 0
      ? insights.downtimeImpact > 0
        ? `Downtime is ${insights.downtimeImpact}% of tracked machine time — chase the largest downtime contributors first.`
        : 'No systemic bottleneck detected — blocks and downtime are both low.'
      : `The dominant constraint is ${busiest && busiest.activeExecutions >= 3 ? `${busiest.machine} carrying ${busiest.activeExecutions} active operation(s)` : 'blocked material / quality holds'}; ` +
        `${insights.blockedOperations} blocked operation(s) trace to their recorded reasons above.`;

  const scrapExecs = executions.filter((e) => e.scrapQuantity > 0);
  const qualityExplanation =
    insights.qualityYield >= 99 && supplemental.reworkRate === 0
      ? 'First-pass yield is at target and no rework has been recorded — quality is clean.'
      : `First-pass yield ${insights.qualityYield}%, scrap rate ${insights.scrapRate}%, rework rate ${supplemental.reworkRate}%. ` +
        (scrapExecs.length > 0 ? `Scrap concentrated on ${scrapExecs.slice(0, 3).map((e) => e.executionNumber).join(', ')}.` : 'Scrap is spread thin across operations.');

  const noOperator = executions.filter((e) => (e.status === 'running' || e.status === 'dispatched') && !e.operator);
  const overloaded = operators.filter((o) => o.workload >= 3);
  const operatorSuggestions =
    noOperator.length === 0 && overloaded.length === 0
      ? 'Operator coverage is balanced — every running operation has an assignee and no operator is overloaded.'
      : [
          noOperator.length > 0 ? `Assign operators to ${noOperator.slice(0, 4).map((e) => e.executionNumber).join(', ')} (running/dispatched with no operator).` : '',
          overloaded.length > 0 ? `Rebalance ${overloaded.map((o) => `${o.operator} (${o.workload} jobs)`).join(', ')}.` : '',
        ]
          .filter((s) => s !== '')
          .join(' ');

  const downMachines = machines.filter((m) => m.currentState === 'downtime' || m.currentState === 'blocked' || (m.todaysRuntime + m.todaysDowntime > 0 && m.todaysUtilization < 60));
  const maintenanceSuggestions =
    downMachines.length === 0
      ? 'No machine is in downtime or under-utilized — no maintenance action indicated (Maintenance remains the downtime authority).'
      : `Review ${downMachines.slice(0, 4).map((m) => `${m.machine}${m.todaysDowntime > 0 ? ` (${m.todaysDowntime}m down today)` : ''}`).join(', ')} with Maintenance; downtime is recorded by Maintenance, not edited here.`;

  return { productionSummary, delayAnalysis, rootCause, qualityExplanation, operatorSuggestions, maintenanceSuggestions, grounded: true };
}

/* ── the assembled model ──────────────────────────────────────────────────────── */

/** Assemble the read-only Operator Console model from execution records + the event ledger. Pure. */
export function buildExecutionConsoleModel(executions: MesExecution[], events: ManufacturingEvent[], nowMs: number): ExecutionConsoleModel {
  const telemetry = deriveExecutionTelemetry(events);
  const telemetryByExec = new Map<string, ExecutionTelemetry>(telemetry.map((t) => [t.execution, t]));

  const insights = deriveMesInsights(executions);
  const supplemental = deriveMesSupplementalInsights(executions);
  const oee = deriveEventOee(events, nowMs);
  const eventInsights = deriveEventInsights(events, nowMs);
  const kpis = [...mesInsightsToKpis(insights), ...mesSupplementalInsightsToKpis(supplemental)];

  const counts: ExecutionCounts = {
    total: executions.length,
    queued: executions.filter((e) => isQueued(e.status)).length,
    running: executions.filter((e) => e.status === 'running').length,
    paused: executions.filter((e) => e.status === 'paused').length,
    blocked: executions.filter((e) => e.status === 'blocked').length,
    inspection: executions.filter((e) => e.status === 'inspection').length,
    completed: executions.filter((e) => e.status === 'completed').length,
    cancelled: executions.filter((e) => e.status === 'cancelled').length,
  };

  const executionRows = executions
    .map((e) => buildExecutionRow(e, telemetryByExec.get(e.executionNumber), nowMs))
    .sort((a, b) => statusRank(a.status) - statusRank(b.status) || a.productionOrder.localeCompare(b.productionOrder) || a.sequence - b.sequence);

  const operators = buildOperatorRows(executions, events, nowMs);
  const machines = buildMachineRows(executions, events, nowMs);
  const workOrders = buildWorkOrderRows(executions);
  const quality = buildQualityRows(executions);

  const timeline: ConsoleTimelineEvent[] = sortEvents(events)
    .reverse()
    .slice(0, 200)
    .map((ev) => ({
      id: ev.id,
      sequence: ev.sequence,
      timestamp: ev.timestamp,
      eventType: ev.eventType,
      label: manufacturingEventLabel(ev.eventType),
      execution: ev.execution,
      productionOrder: ev.productionOrder,
      operation: ev.operation,
      machine: ev.machine,
      operator: ev.operator,
      quantity: ev.quantity,
      reason: ev.reason,
    }));

  const narrative = buildNarrative(executions, counts, insights, supplemental, machines, operators);

  return {
    generatedAtMs: nowMs,
    kpis,
    insights,
    supplemental,
    oee,
    eventInsights,
    counts,
    executions: executionRows,
    operators,
    machines,
    workOrders,
    quality,
    timeline,
    narrative,
    eventCount: events.length,
  };
}
