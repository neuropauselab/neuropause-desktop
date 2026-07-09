/**
 * Shop-Floor Event Ledger (MES telemetry source of truth) — an APPEND-ONLY, immutable stream of
 * manufacturing events from which ALL execution telemetry is DERIVED. It EXTENDS the Manufacturing
 * Execution System: execution records, production schedules, inventory, routing, and maintenance
 * all remain; this layer adds event sourcing so cycle / run / idle / blocked / inspection / pause /
 * downtime time, live machine + operator timelines, and OEE are calculated from actual events
 * rather than manually entered. Corrections are new events — history is never rewritten (the same
 * immutability contract as the Inventory stock ledger).
 *
 * This file holds the deterministic event MODEL + PROJECTIONS: the event-type vocabulary, the
 * `ManufacturingEvent` projection + record mapper, the pure segment accumulator that reduces an
 * event stream to time buckets, the per-execution telemetry, the live per-machine and per-operator
 * timelines, the event-derived OEE (reusing the existing manufacturing OEE rule), the ten Executive
 * telemetry KPIs, and the deterministic recommendations (machine-idle, running-without-operator,
 * high-downtime, inspection-backlog, repeated-failures, long-pause, execution-bottleneck,
 * operator-overload, late-completion-risk) — each carrying the arithmetic that produced it. Pure
 * (no I/O); the clock (`nowMs`) is injected. The AI explains the timeline; it never changes execution.
 */
import type { EnterpriseEntity } from './enterpriseModule';
import type { ExecutiveKpi, ExecutiveRecommendation, ExecRecoPriority } from './executiveCenter';
import { calculateOverallEquipmentEffectiveness, calculateProductionYield } from './manufacturing';

/* ── module identity ───────────────────────────────────────────────────────── */

export const MANUFACTURING_EVENTS_MODULE_ID = 'manufacturing-events';
export const MANUFACTURING_EVENT_KIND = 'manufacturing-event';

/* ── event vocabulary ──────────────────────────────────────────────────────── */

export type ManufacturingEventType =
  | 'machine_started'
  | 'machine_stopped'
  | 'operation_released'
  | 'operation_started'
  | 'operation_paused'
  | 'operation_resumed'
  | 'operation_completed'
  | 'operator_assigned'
  | 'operator_removed'
  | 'material_issued'
  | 'material_returned'
  | 'inspection_started'
  | 'inspection_passed'
  | 'inspection_failed'
  | 'downtime_started'
  | 'downtime_ended'
  | 'maintenance_started'
  | 'maintenance_finished'
  | 'scrap_recorded'
  | 'finished_goods_posted'
  | 'order_closed';

export const MANUFACTURING_EVENT_TYPES: readonly ManufacturingEventType[] = [
  'machine_started',
  'machine_stopped',
  'operation_released',
  'operation_started',
  'operation_paused',
  'operation_resumed',
  'operation_completed',
  'operator_assigned',
  'operator_removed',
  'material_issued',
  'material_returned',
  'inspection_started',
  'inspection_passed',
  'inspection_failed',
  'downtime_started',
  'downtime_ended',
  'maintenance_started',
  'maintenance_finished',
  'scrap_recorded',
  'finished_goods_posted',
  'order_closed',
];

/* ── coercion helpers ──────────────────────────────────────────────────────── */

const str = (v: unknown): string => (v === null || v === undefined ? '' : String(v));
const num = (v: unknown): number => (typeof v === 'number' ? v : Number(str(v)) || 0);
const clamp = (n: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, n));
function oneOf<T extends string>(v: unknown, all: readonly T[], fallback: T): T {
  const s = str(v);
  return (all as readonly string[]).includes(s) ? (s as T) : fallback;
}
function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return Math.round(values.reduce((a, b) => a + b, 0) / values.length);
}
function minutesBetween(aMs: number, bMs: number): number {
  return Math.max(0, Math.round((bMs - aMs) / 60000));
}
function startOfDayMs(nowMs: number): number {
  const day = new Date(nowMs).toISOString().slice(0, 10);
  const t = Date.parse(`${day}T00:00:00.000Z`);
  return Number.isFinite(t) ? t : nowMs;
}

/* ── the event projection ──────────────────────────────────────────────────── */

export interface ManufacturingEvent {
  id: string;
  /** Monotonic append order within the ledger (tiebreaks equal timestamps). */
  sequence: number;
  timestamp: string;
  eventType: ManufacturingEventType;
  productionOrder: string;
  execution: string;
  operation: string;
  machine: string;
  workCenter: string;
  operator: string;
  /** Quantity carried by quantitative events (finished_goods_posted, scrap_recorded). */
  quantity: number;
  reason: string;
  metadata: string;
  user: string;
  createdAt: string;
}

export function manufacturingEventFromRecord(record: EnterpriseEntity): ManufacturingEvent {
  const f = record.fields;
  return {
    id: record.id,
    sequence: num(f.sequence),
    timestamp: str(f.timestamp) || record.createdAt,
    eventType: oneOf<ManufacturingEventType>(f.eventType, MANUFACTURING_EVENT_TYPES, 'machine_started'),
    productionOrder: str(f.productionOrder),
    execution: str(f.execution),
    operation: str(f.operation),
    machine: str(f.machine),
    workCenter: str(f.workCenter),
    operator: str(f.operator),
    quantity: num(f.quantity),
    reason: str(f.reason),
    metadata: str(f.metadata),
    user: str(f.user),
    createdAt: record.createdAt,
  };
}

/* ── the deterministic segment accumulator (the projection core) ──────────────── */

export type DerivedState = 'released' | 'running' | 'paused' | 'blocked' | 'inspection' | 'downtime' | 'idle' | 'completed';

/** The state an execution/machine enters AFTER an event (null = annotation, no state change). */
export function stateAfterEvent(t: ManufacturingEventType): DerivedState | null {
  switch (t) {
    case 'operation_released':
      return 'released';
    case 'operation_started':
    case 'operation_resumed':
    case 'machine_started':
    case 'downtime_ended':
    case 'maintenance_finished':
    case 'inspection_passed':
      return 'running';
    case 'operation_paused':
      return 'paused';
    case 'downtime_started':
    case 'maintenance_started':
      return 'downtime';
    case 'inspection_started':
      return 'inspection';
    case 'inspection_failed':
      return 'blocked';
    case 'operation_completed':
    case 'order_closed':
      return 'completed';
    case 'machine_stopped':
      return 'idle';
    default:
      return null; // operator_assigned/removed, material_*, scrap_recorded, finished_goods_posted
  }
}

interface Buckets {
  run: number;
  pause: number;
  blocked: number;
  inspection: number;
  downtime: number;
  released: number;
}

function bucketKey(s: DerivedState): keyof Buckets | null {
  switch (s) {
    case 'running':
      return 'run';
    case 'paused':
      return 'pause';
    case 'blocked':
      return 'blocked';
    case 'inspection':
      return 'inspection';
    case 'downtime':
      return 'downtime';
    case 'released':
      return 'released';
    default:
      return null; // idle / completed carry no productive/stop time
  }
}

export interface EventWalk {
  buckets: Buckets;
  finalState: DerivedState;
  startedAt: string;
  completedAt: string;
  releasedAt: string;
  good: number;
  scrap: number;
  failures: number;
  lastOperator: string;
  lastMachine: string;
  hasStarted: boolean;
  hasCompleted: boolean;
  eventCount: number;
}

/** Sort by (timestamp, sequence) — the deterministic ledger order. */
export function sortEvents(events: ManufacturingEvent[]): ManufacturingEvent[] {
  return [...events].sort((a, b) => (Date.parse(a.timestamp) || 0) - (Date.parse(b.timestamp) || 0) || a.sequence - b.sequence);
}

/**
 * Reduce an event stream to time buckets by walking state segments. Each state-changing event
 * closes the previous state's segment [prevTs, thisTs] into its bucket; `sinceMs` clips segments to
 * a window (e.g. today); `openUntil` closes the final open segment against the clock (live view).
 * Pure + deterministic.
 */
export function accumulateEvents(events: ManufacturingEvent[], opts: { openUntil?: number; sinceMs?: number } = {}): EventWalk {
  const sorted = sortEvents(events);
  const buckets: Buckets = { run: 0, pause: 0, blocked: 0, inspection: 0, downtime: 0, released: 0 };
  const since = opts.sinceMs ?? 0;
  let prevState: DerivedState | null = null;
  let prevTs: number | null = null;
  let startedAt = '';
  let completedAt = '';
  let releasedAt = '';
  let lastOperator = '';
  let lastMachine = '';
  let good = 0;
  let scrap = 0;
  let failures = 0;
  let hasStarted = false;
  let hasCompleted = false;

  const flush = (state: DerivedState, tsEnd: number): void => {
    if (prevTs === null) return;
    const key = bucketKey(state);
    if (!key) return;
    const start = Math.max(prevTs, since);
    if (tsEnd <= start) return;
    buckets[key] += Math.max(0, Math.round((tsEnd - start) / 60000));
  };

  for (const e of sorted) {
    const ts = Date.parse(e.timestamp);
    if (!Number.isFinite(ts)) continue;
    if (e.operator) lastOperator = e.operator;
    if (e.machine) lastMachine = e.machine;
    if (e.eventType === 'finished_goods_posted') good += Math.max(0, e.quantity);
    if (e.eventType === 'scrap_recorded') scrap += Math.max(0, e.quantity);
    if (e.eventType === 'inspection_failed') failures += 1;
    if (e.eventType === 'operation_released' && !releasedAt) releasedAt = e.timestamp;
    if (e.eventType === 'operation_started' && !startedAt) {
      startedAt = e.timestamp;
      hasStarted = true;
    }
    if (e.eventType === 'operation_completed' || e.eventType === 'order_closed') {
      completedAt = e.timestamp;
      hasCompleted = true;
    }
    const ns = stateAfterEvent(e.eventType);
    if (ns === null) continue;
    if (prevState !== null) flush(prevState, ts);
    prevState = ns;
    prevTs = ts;
  }
  if (opts.openUntil !== undefined && prevState !== null && prevState !== 'completed' && prevState !== 'idle') {
    flush(prevState, opts.openUntil);
  }

  return {
    buckets,
    finalState: prevState ?? 'idle',
    startedAt,
    completedAt,
    releasedAt,
    good,
    scrap,
    failures,
    lastOperator,
    lastMachine,
    hasStarted,
    hasCompleted,
    eventCount: sorted.length,
  };
}

/* ── per-execution telemetry (event-sourced; replaces entered metrics) ────────── */

export interface ExecutionTelemetry {
  execution: string;
  productionOrder: string;
  operation: string;
  machine: string;
  operator: string;
  state: DerivedState;
  runTime: number;
  pauseTime: number;
  blockedTime: number;
  inspectionTime: number;
  downtime: number;
  idleTime: number;
  cycleTime: number;
  good: number;
  scrap: number;
  failures: number;
  started: boolean;
  completed: boolean;
  startedAt: string;
  completedAt: string;
  releasedAt: string;
  eventCount: number;
}

function groupBy(events: ManufacturingEvent[], key: (e: ManufacturingEvent) => string): Map<string, ManufacturingEvent[]> {
  const map = new Map<string, ManufacturingEvent[]>();
  for (const e of events) {
    const k = key(e);
    if (!k) continue;
    const arr = map.get(k) ?? [];
    arr.push(e);
    map.set(k, arr);
  }
  return map;
}

function telemetryFromWalk(execution: string, events: ManufacturingEvent[], w: EventWalk): ExecutionTelemetry {
  const b = w.buckets;
  const idleTime = b.pause + b.blocked + b.downtime + b.released;
  const cycleTime =
    w.hasStarted && w.completedAt
      ? minutesBetween(Date.parse(w.startedAt), Date.parse(w.completedAt))
      : b.run + b.pause + b.blocked + b.inspection + b.downtime;
  return {
    execution,
    productionOrder: events.find((e) => e.productionOrder)?.productionOrder ?? '',
    operation: events.find((e) => e.operation)?.operation ?? '',
    machine: w.lastMachine,
    operator: w.lastOperator,
    state: w.finalState,
    runTime: b.run,
    pauseTime: b.pause,
    blockedTime: b.blocked,
    inspectionTime: b.inspection,
    downtime: b.downtime,
    idleTime,
    cycleTime,
    good: w.good,
    scrap: w.scrap,
    failures: w.failures,
    started: w.hasStarted,
    completed: w.hasCompleted,
    startedAt: w.startedAt,
    completedAt: w.completedAt,
    releasedAt: w.releasedAt,
    eventCount: w.eventCount,
  };
}

/** Derive per-execution telemetry from the event ledger. Deterministic. */
export function deriveExecutionTelemetry(events: ManufacturingEvent[]): ExecutionTelemetry[] {
  const byExec = groupBy(events, (e) => e.execution);
  return [...byExec.entries()]
    .map(([execution, evs]) => telemetryFromWalk(execution, evs, accumulateEvents(evs)))
    .sort((a, b) => a.execution.localeCompare(b.execution));
}

/* ── live machine timeline ─────────────────────────────────────────────────── */

export interface MachineTimeline {
  machine: string;
  currentState: DerivedState;
  currentOperator: string;
  runningJob: string;
  queueLength: number;
  todaysRuntime: number;
  todaysDowntime: number;
  todaysUtilization: number;
  lastMaintenance: string;
}

/**
 * Derive each machine's live timeline from the ledger. Today's runtime/downtime sum the
 * per-execution telemetry (today window) for that machine — correct even when executions overlap
 * on the machine — and current state / operator / running job / queue come from its executions.
 */
export function deriveMachineTimeline(events: ManufacturingEvent[], nowMs: number): MachineTimeline[] {
  const since = startOfDayMs(nowMs);
  const telemetry = deriveExecutionTelemetry(events);
  const byExec = groupBy(events, (e) => e.execution);
  const todayByExec = new Map<string, Buckets>();
  for (const [exec, evs] of byExec) todayByExec.set(exec, accumulateEvents(evs, { openUntil: nowMs, sinceMs: since }).buckets);
  const machineEvents = groupBy(events, (e) => e.machine);

  const byMachine = new Map<string, ExecutionTelemetry[]>();
  for (const t of telemetry) {
    if (!t.machine) continue;
    const arr = byMachine.get(t.machine) ?? [];
    arr.push(t);
    byMachine.set(t.machine, arr);
  }

  const out: MachineTimeline[] = [];
  for (const [machine, execs] of byMachine) {
    const todaysRuntime = execs.reduce((s, t) => s + (todayByExec.get(t.execution)?.run ?? 0), 0);
    const todaysDowntime = execs.reduce((s, t) => s + (todayByExec.get(t.execution)?.downtime ?? 0), 0);
    const active = execs.filter((t) => t.started && !t.completed).sort((a, b) => (Date.parse(a.startedAt) || 0) - (Date.parse(b.startedAt) || 0));
    const running = active.length > 0 ? active[active.length - 1] : undefined;
    const queueLength = execs.filter((t) => t.releasedAt !== '' && !t.started).length;
    let lastMaintenance = '';
    for (const e of sortEvents(machineEvents.get(machine) ?? [])) {
      if (e.eventType === 'maintenance_finished' || e.eventType === 'maintenance_started') lastMaintenance = e.timestamp;
    }
    const runDt = todaysRuntime + todaysDowntime;
    out.push({
      machine,
      currentState: running ? running.state : 'idle',
      currentOperator: running?.operator ?? '',
      runningJob: running?.execution ?? '',
      queueLength,
      todaysRuntime,
      todaysDowntime,
      todaysUtilization: runDt <= 0 ? 0 : clamp(Math.round((todaysRuntime / runDt) * 100), 0, 100),
      lastMaintenance,
    });
  }
  return out.sort((a, b) => a.machine.localeCompare(b.machine));
}

/* ── live operator timeline ────────────────────────────────────────────────── */

export interface OperatorTimeline {
  operator: string;
  currentAssignment: string;
  currentMachine: string;
  currentOperation: string;
  workload: number;
  idleTime: number;
  utilization: number;
  completedOperations: number;
}

/** Derive each operator's live timeline from the ledger, aggregating their executions' telemetry. */
export function deriveOperatorTimeline(events: ManufacturingEvent[], nowMs: number): OperatorTimeline[] {
  const telemetry = deriveExecutionTelemetry(events);
  const byExec = groupBy(events, (e) => e.execution);
  const liveByExec = new Map<string, Buckets>();
  for (const [exec, evs] of byExec) liveByExec.set(exec, accumulateEvents(evs, { openUntil: nowMs }).buckets);

  const byOperator = new Map<string, ExecutionTelemetry[]>();
  for (const t of telemetry) {
    if (!t.operator) continue;
    const arr = byOperator.get(t.operator) ?? [];
    arr.push(t);
    byOperator.set(t.operator, arr);
  }
  const out: OperatorTimeline[] = [];
  for (const [operator, execs] of byOperator) {
    let run = 0;
    let idleTime = 0;
    let inspection = 0;
    for (const t of execs) {
      const b = liveByExec.get(t.execution);
      if (!b) continue;
      run += b.run;
      idleTime += b.pause + b.blocked + b.downtime + b.released;
      inspection += b.inspection;
    }
    const tracked = run + idleTime + inspection;
    const active = execs.filter((t) => t.started && !t.completed).sort((a, b) => (Date.parse(a.startedAt) || 0) - (Date.parse(b.startedAt) || 0));
    const current = active.length > 0 ? active[active.length - 1] : undefined;
    out.push({
      operator,
      currentAssignment: current?.execution ?? '',
      currentMachine: current?.machine ?? '',
      currentOperation: current?.operation ?? '',
      workload: active.length,
      idleTime,
      utilization: tracked <= 0 ? 0 : clamp(Math.round((run / tracked) * 100), 0, 100),
      completedOperations: execs.filter((t) => t.completed).length,
    });
  }
  return out.sort((a, b) => a.operator.localeCompare(b.operator));
}

/* ── event-derived OEE ─────────────────────────────────────────────────────── */

export interface EventOee {
  availability: number;
  performance: number;
  quality: number;
  oee: number;
  machineUtilization: number;
  operatorUtilization: number;
}

/** OEE derived purely from the event ledger (reuses the manufacturing OEE rule). */
export function deriveEventOee(events: ManufacturingEvent[], nowMs: number): EventOee {
  const telemetry = deriveExecutionTelemetry(events);
  const run = telemetry.reduce((s, t) => s + t.runTime, 0);
  const pause = telemetry.reduce((s, t) => s + t.pauseTime, 0);
  const blocked = telemetry.reduce((s, t) => s + t.blockedTime, 0);
  const inspection = telemetry.reduce((s, t) => s + t.inspectionTime, 0);
  const downtime = telemetry.reduce((s, t) => s + t.downtime, 0);
  const good = telemetry.reduce((s, t) => s + t.good, 0);
  const scrap = telemetry.reduce((s, t) => s + t.scrap, 0);

  const availability = run + downtime <= 0 ? 100 : clamp(Math.round((run / (run + downtime)) * 100), 0, 100);
  const performance = run + pause + blocked + inspection <= 0 ? 100 : clamp(Math.round((run / (run + pause + blocked + inspection)) * 100), 0, 100);
  const quality = calculateProductionYield(good, scrap);
  const oee = calculateOverallEquipmentEffectiveness(availability, performance, quality);

  const machines = deriveMachineTimeline(events, nowMs);
  const machineUtilization = machines.length === 0 ? 0 : clamp(mean(machines.map((m) => m.todaysUtilization)), 0, 100);
  const operators = deriveOperatorTimeline(events, nowMs);
  const operatorUtilization = operators.length === 0 ? 0 : clamp(mean(operators.map((o) => o.utilization)), 0, 100);

  return { availability, performance, quality, oee, machineUtilization, operatorUtilization };
}

/* ── aggregate insights (Executive Center) ─────────────────────────────────── */

export interface EventInsights {
  liveProduction: number;
  machineHealth: number;
  operatorEfficiency: number;
  executionStability: number;
  scheduleAdherence: number;
  downtimeTrend: number;
  qualityTrend: number;
  eventThroughput: number;
  manufacturingConfidence: number;
  completionForecast: number;
}

/** Roll the event ledger into the ten Executive telemetry KPIs. Pure. */
export function deriveEventInsights(events: ManufacturingEvent[], nowMs: number): EventInsights {
  const telemetry = deriveExecutionTelemetry(events);
  const machines = deriveMachineTimeline(events, nowMs);
  const operators = deriveOperatorTimeline(events, nowMs);
  const oee = deriveEventOee(events, nowMs);

  const started = telemetry.filter((t) => t.started);
  const completed = telemetry.filter((t) => t.completed);
  const running = telemetry.filter((t) => t.state === 'running');

  const liveProduction = running.length;
  const machineHealth =
    machines.length === 0
      ? 100
      : clamp(mean(machines.map((m) => (m.todaysRuntime + m.todaysDowntime <= 0 ? 100 : Math.round((m.todaysRuntime / (m.todaysRuntime + m.todaysDowntime)) * 100)))), 0, 100);
  const operatorEfficiency = operators.length === 0 ? 100 : clamp(mean(operators.map((o) => o.utilization)), 0, 100);
  const stable = started.filter((t) => t.failures === 0 && t.downtime === 0).length;
  const executionStability = started.length === 0 ? 100 : clamp(Math.round((stable / started.length) * 100), 0, 100);
  const scheduleAdherence = started.length === 0 ? 100 : clamp(Math.round((completed.length / started.length) * 100), 0, 100);

  const totalRun = telemetry.reduce((s, t) => s + t.runTime, 0);
  const totalDowntime = telemetry.reduce((s, t) => s + t.downtime, 0);
  const downtimeTrend = totalRun + totalDowntime <= 0 ? 0 : clamp(Math.round((totalDowntime / (totalRun + totalDowntime)) * 100), 0, 100);
  const qualityTrend = oee.quality;
  const eventThroughput = events.length;

  const manufacturingConfidence = clamp(Math.round((machineHealth + qualityTrend + executionStability + scheduleAdherence) / 4), 0, 100);
  const completionForecast =
    telemetry.length === 0 ? 100 : clamp(Math.round(((completed.length + running.length * 0.5) / telemetry.length) * 100), 0, 100);

  return {
    liveProduction,
    machineHealth,
    operatorEfficiency,
    executionStability,
    scheduleAdherence,
    downtimeTrend,
    qualityTrend,
    eventThroughput,
    manufacturingConfidence,
    completionForecast,
  };
}

/** Map event insights to Executive Center KPI tiles (reuses the existing KPI type). */
export function eventInsightsToKpis(insights: EventInsights): ExecutiveKpi[] {
  const pctBand = (v: number): ExecutiveKpi['band'] => (v >= 90 ? 'healthy' : v >= 75 ? 'watch' : 'at-risk');
  const riskBand = (v: number): ExecutiveKpi['band'] => (v <= 10 ? 'healthy' : v <= 25 ? 'watch' : 'at-risk');
  return [
    { key: 'evt-live-production', label: 'Live Production', value: insights.liveProduction, display: `${insights.liveProduction}`, band: insights.liveProduction > 0 ? 'healthy' : 'watch', deepLink: 'enterprise/executive' },
    { key: 'evt-machine-health', label: 'Machine Health', value: insights.machineHealth, display: `${insights.machineHealth}%`, band: pctBand(insights.machineHealth), deepLink: 'enterprise/executive' },
    { key: 'evt-operator-efficiency', label: 'Operator Efficiency', value: insights.operatorEfficiency, display: `${insights.operatorEfficiency}%`, band: pctBand(insights.operatorEfficiency), deepLink: 'enterprise/executive' },
    { key: 'evt-execution-stability', label: 'Execution Stability', value: insights.executionStability, display: `${insights.executionStability}%`, band: pctBand(insights.executionStability), deepLink: 'enterprise/executive' },
    { key: 'evt-schedule-adherence', label: 'Schedule Adherence', value: insights.scheduleAdherence, display: `${insights.scheduleAdherence}%`, band: pctBand(insights.scheduleAdherence), deepLink: 'enterprise/executive' },
    { key: 'evt-downtime-trend', label: 'Downtime Trend', value: insights.downtimeTrend, display: `${insights.downtimeTrend}%`, band: riskBand(insights.downtimeTrend), deepLink: 'enterprise/executive' },
    { key: 'evt-quality-trend', label: 'Quality Trend', value: insights.qualityTrend, display: `${insights.qualityTrend}%`, band: pctBand(insights.qualityTrend), deepLink: 'enterprise/executive' },
    { key: 'evt-event-throughput', label: 'Event Throughput', value: insights.eventThroughput, display: `${insights.eventThroughput}`, deepLink: 'enterprise/executive' },
    { key: 'evt-manufacturing-confidence', label: 'Manufacturing Confidence', value: insights.manufacturingConfidence, display: `${insights.manufacturingConfidence}%`, band: pctBand(insights.manufacturingConfidence), deepLink: 'enterprise/executive' },
    { key: 'evt-completion-forecast', label: 'Completion Forecast', value: insights.completionForecast, display: `${insights.completionForecast}%`, band: pctBand(insights.completionForecast), deepLink: 'enterprise/executive' },
  ];
}

/* ── recommendations (flow into the existing Executive recommendation system) ── */

export const EVENT_HIGH_DOWNTIME_SHARE = 25;
export const EVENT_INSPECTION_BACKLOG = 2;
export const EVENT_REPEATED_FAILURES = 2;
export const EVENT_LONG_PAUSE_MINUTES = 60;
export const EVENT_BOTTLENECK_QUEUE = 3;
export const EVENT_OPERATOR_OVERLOAD = 3;
export const EVENT_LATE_COMPLETION_MINUTES = 480;

function rank(priority: ExecRecoPriority, confidence: number): number {
  const base: Record<ExecRecoPriority, number> = { critical: 1000, high: 700, medium: 400, low: 100 };
  return Math.round(base[priority] + confidence * 100);
}

/**
 * Deterministic telemetry recommendations — machine-idle / running-without-operator /
 * high-downtime / inspection-backlog / repeated-failures / long-pause / execution-bottleneck /
 * operator-overload / late-completion-risk — read straight off the event-derived timelines. Each
 * carries the arithmetic that produced it and flows through the EXISTING Executive recommendation +
 * timeline system. The AI explains these; it never changes execution.
 */
export function eventRecommendations(events: ManufacturingEvent[], nowMs: number, limit = 25): ExecutiveRecommendation[] {
  const recs: ExecutiveRecommendation[] = [];
  const machines = deriveMachineTimeline(events, nowMs);
  const operators = deriveOperatorTimeline(events, nowMs);
  const telemetry = deriveExecutionTelemetry(events);

  for (const m of machines) {
    // Machine idle with queued work.
    if ((m.currentState === 'idle' || m.currentState === 'released') && m.queueLength > 0) {
      recs.push({
        id: `evt:idle:${m.machine}`,
        metric: 'capacity',
        icon: 'pause',
        problem: `Machine idle — ${m.machine} is ${m.currentState} with ${m.queueLength} job(s) queued.`,
        businessImpact: 'An idle machine with queued work wastes available capacity.',
        rootCause: `${m.machine} has no running job while ${m.queueLength} released operation(s) wait.`,
        priority: 'high',
        confidence: 0.85,
        expectedOutcome: 'Starting a queued operation puts the machine back into production.',
        evidence: [`machine=${m.machine}`, `state=${m.currentState}`, `queue=${m.queueLength}`],
        sourceSystems: ['manufacturing'],
        recommendedAction: `Start a queued operation on ${m.machine}.`,
        owner: 'Production Supervisor',
        eta: 'today',
        status: 'open',
        score: rank('high', 0.85),
      });
    }
    // Machine running without an operator.
    if (m.currentState === 'running' && !m.currentOperator) {
      recs.push({
        id: `evt:no-operator:${m.machine}`,
        metric: 'production',
        icon: 'user-x',
        problem: `Machine running without operator — ${m.machine} is running with no operator assigned.`,
        businessImpact: 'An unattended running machine is a quality and safety risk.',
        rootCause: `${m.machine} is in the running state but no operator_assigned event is active.`,
        priority: 'high',
        confidence: 0.85,
        expectedOutcome: 'Assigning an operator restores supervision of the running job.',
        evidence: [`machine=${m.machine}`, `state=running`, `operator=none`, `runningJob=${m.runningJob || 'unknown'}`],
        sourceSystems: ['manufacturing'],
        recommendedAction: `Assign an operator to ${m.machine}.`,
        owner: 'Production Supervisor',
        eta: 'today',
        status: 'open',
        score: rank('high', 0.85),
      });
    }
    // High downtime today.
    if (m.todaysRuntime + m.todaysDowntime > 0) {
      const share = Math.round((m.todaysDowntime / (m.todaysRuntime + m.todaysDowntime)) * 100);
      if (share >= EVENT_HIGH_DOWNTIME_SHARE) {
        recs.push({
          id: `evt:downtime:${m.machine}`,
          metric: 'maintenance',
          icon: 'alert-triangle',
          problem: `High downtime — ${m.machine} is ${share}% down today (${m.todaysDowntime}m of ${m.todaysRuntime + m.todaysDowntime}m).`,
          businessImpact: 'High downtime erodes availability and pushes out completion.',
          rootCause: `Downtime ${m.todaysDowntime}m vs runtime ${m.todaysRuntime}m today = ${share}% (threshold ${EVENT_HIGH_DOWNTIME_SHARE}%).`,
          priority: 'high',
          confidence: 0.85,
          expectedOutcome: 'Root-causing the downtime (maintenance) recovers availability.',
          evidence: [`machine=${m.machine}`, `downtime=${m.todaysDowntime}m`, `runtime=${m.todaysRuntime}m`, `share=${share}%`],
          sourceSystems: ['manufacturing', 'maintenance'],
          recommendedAction: `Investigate downtime on ${m.machine} with Maintenance.`,
          owner: 'Maintenance Planner',
          eta: 'today',
          status: 'open',
          score: rank('high', 0.85),
        });
      }
    }
    // Execution bottleneck — deep machine queue.
    if (m.queueLength >= EVENT_BOTTLENECK_QUEUE) {
      recs.push({
        id: `evt:bottleneck:${m.machine}`,
        metric: 'capacity',
        icon: 'activity',
        problem: `Execution bottleneck — ${m.machine} has ${m.queueLength} operation(s) queued.`,
        businessImpact: 'A deep queue on one machine serializes work and delays completion.',
        rootCause: `${m.queueLength} released operations wait on ${m.machine} (threshold ${EVENT_BOTTLENECK_QUEUE}).`,
        priority: 'medium',
        confidence: 0.8,
        expectedOutcome: 'Re-routing or adding capacity clears the bottleneck.',
        evidence: [`machine=${m.machine}`, `queue=${m.queueLength}`, `threshold=${EVENT_BOTTLENECK_QUEUE}`],
        sourceSystems: ['manufacturing', 'planning'],
        recommendedAction: `Relieve the queue on ${m.machine} (re-route or add capacity).`,
        owner: 'Production Planner',
        eta: 'today',
        status: 'open',
        score: rank('medium', 0.8),
      });
    }
  }

  // Inspection backlog.
  const inspecting = telemetry.filter((t) => t.state === 'inspection');
  if (inspecting.length >= EVENT_INSPECTION_BACKLOG) {
    recs.push({
      id: 'evt:inspection-backlog',
      metric: 'quality',
      icon: 'search',
      problem: `Inspection backlog — ${inspecting.length} operation(s) are held in inspection.`,
      businessImpact: 'Operations held in inspection cannot complete; output is delayed.',
      rootCause: `${inspecting.length} executions are in the inspection state (threshold ${EVENT_INSPECTION_BACKLOG}).`,
      priority: 'medium',
      confidence: 0.85,
      expectedOutcome: 'Clearing the inspection queue releases the held operations.',
      evidence: [`inInspection=${inspecting.length}`, `threshold=${EVENT_INSPECTION_BACKLOG}`],
      sourceSystems: ['manufacturing', 'quality'],
      recommendedAction: 'Assign QA to clear the inspection backlog.',
      owner: 'Quality Lead',
      eta: 'today',
      status: 'open',
      score: rank('medium', 0.85),
    });
  }

  for (const t of telemetry) {
    // Repeated failures.
    if (t.failures >= EVENT_REPEATED_FAILURES) {
      recs.push({
        id: `evt:failures:${t.execution}`,
        metric: 'quality',
        icon: 'alert-octagon',
        problem: `Repeated failures — ${t.execution} failed inspection ${t.failures} time(s).`,
        businessImpact: 'Repeated inspection failures signal a systemic quality problem.',
        rootCause: `${t.failures} inspection_failed events on ${t.execution} (threshold ${EVENT_REPEATED_FAILURES}).`,
        priority: 'high',
        confidence: 0.85,
        expectedOutcome: 'Root-causing the failure mode restores yield.',
        evidence: [`execution=${t.execution}`, `failures=${t.failures}`, `machine=${t.machine}`],
        sourceSystems: ['manufacturing', 'quality'],
        recommendedAction: `Root-cause repeated failures on ${t.execution} (${t.machine || 'machine'}).`,
        owner: 'Quality Lead',
        eta: 'today',
        status: 'open',
        score: rank('high', 0.85),
      });
    }
    // Long pause on an unfinished operation.
    if (!t.completed && t.pauseTime >= EVENT_LONG_PAUSE_MINUTES) {
      recs.push({
        id: `evt:pause:${t.execution}`,
        metric: 'production',
        icon: 'pause',
        problem: `Long pause — ${t.execution} has been paused for ${t.pauseTime}m.`,
        businessImpact: 'A long pause ties up the machine and delays the order.',
        rootCause: `${t.execution} accumulated ${t.pauseTime}m of pause time (threshold ${EVENT_LONG_PAUSE_MINUTES}m).`,
        priority: 'medium',
        confidence: 0.8,
        expectedOutcome: 'Resuming or re-routing the operation recovers the lost time.',
        evidence: [`execution=${t.execution}`, `pauseMinutes=${t.pauseTime}`, `threshold=${EVENT_LONG_PAUSE_MINUTES}`],
        sourceSystems: ['manufacturing'],
        recommendedAction: `Resume or re-route ${t.execution}.`,
        owner: 'Production Supervisor',
        eta: 'today',
        status: 'open',
        score: rank('medium', 0.8),
      });
    }
    // Late completion risk — started/released long ago, not completed.
    const anchor = t.startedAt || t.releasedAt;
    if (!t.completed && anchor) {
      const elapsed = minutesBetween(Date.parse(anchor), nowMs);
      if (elapsed >= EVENT_LATE_COMPLETION_MINUTES) {
        recs.push({
          id: `evt:late:${t.execution}`,
          metric: 'production',
          icon: 'clock',
          problem: `Late completion risk — ${t.execution} has run ${elapsed}m without completing.`,
          businessImpact: 'An operation open far beyond its cycle risks a late order.',
          rootCause: `${t.execution} started/released ${elapsed}m ago and is still ${t.state} (threshold ${EVENT_LATE_COMPLETION_MINUTES}m).`,
          priority: 'high',
          confidence: 0.8,
          expectedOutcome: 'Expediting or re-sequencing the operation protects the due date.',
          evidence: [`execution=${t.execution}`, `elapsedMinutes=${elapsed}`, `state=${t.state}`],
          sourceSystems: ['manufacturing', 'planning'],
          recommendedAction: `Expedite ${t.execution} or re-sequence its order.`,
          owner: 'Production Planner',
          eta: 'today',
          status: 'open',
          score: rank('high', 0.8),
        });
      }
    }
  }

  // Operator overload — too many concurrent active assignments.
  for (const o of operators) {
    if (o.workload >= EVENT_OPERATOR_OVERLOAD) {
      recs.push({
        id: `evt:overload:${o.operator}`,
        metric: 'production',
        icon: 'users',
        problem: `Operator overload — ${o.operator} is running ${o.workload} operation(s) at once.`,
        businessImpact: 'An overloaded operator cannot attend every running job, risking quality.',
        rootCause: `${o.operator} has ${o.workload} active started-not-completed operations (threshold ${EVENT_OPERATOR_OVERLOAD}).`,
        priority: 'medium',
        confidence: 0.8,
        expectedOutcome: 'Reassigning some operations balances the operator load.',
        evidence: [`operator=${o.operator}`, `workload=${o.workload}`, `threshold=${EVENT_OPERATOR_OVERLOAD}`],
        sourceSystems: ['manufacturing'],
        recommendedAction: `Rebalance ${o.operator}'s workload across operators.`,
        owner: 'Production Supervisor',
        eta: 'today',
        status: 'open',
        score: rank('medium', 0.8),
      });
    }
  }

  return recs.sort((a, b) => b.score - a.score).slice(0, limit);
}
