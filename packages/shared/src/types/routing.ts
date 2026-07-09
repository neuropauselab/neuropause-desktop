/**
 * Routing-Aware Scheduling — EXTENDS Finite Capacity Scheduling (`capacityScheduler.ts`)
 * from "which machine, when" to "which OPERATION, which routing, which work center, which
 * QUALIFIED machine, in what sequence". It does NOT replace `computeCapacitySchedule`,
 * `computeTimePhasedMrp`, `runMrp`, `runMultiLevelMrp`, `planning.ts`, `mrp.ts`,
 * `timePhasedMrp.ts`, or `capacityScheduler.ts` — it reuses their primitives (the same
 * machine-availability model, day-grid, horizon, bottleneck threshold, and machine-priority
 * rule) and consumes `computeTimePhasedMrp`'s production planned orders.
 *
 * A Routing is REAL master data: a product's ordered operations (e.g. 10 Cutting → 20
 * Machining → 30 Assembly → 40 Inspection), each with a required work center, a set of
 * qualified (eligible) machines, and deterministic setup / run-per-unit / queue / inspection
 * / transfer times. Every operation is scheduled independently: an operation may run only on a
 * machine that (a) belongs to its work center, (b) is declared qualified for it, (c) is in a
 * working state (Manufacturing), and (d) is not blocked by a maintenance window (Maintenance).
 * An operation's completion (plus its transfer time) is the earliest start of the next
 * operation — a real dependency chain. Machine eligibility is MEMOIZED per (work center ×
 * qualified set) so thousands of operations never re-scan the machine list.
 *
 * It emits deterministic Production Schedule plans (schedule id, order, per-operation machine +
 * work center + planned start/finish, status), ten Executive routing KPIs, and deterministic
 * recommendations (alternate-machine, blocked-by-maintenance, routing-conflict,
 * capability-mismatch, split-routing, reduce-queue, resequence) — each carrying the arithmetic
 * that produced it. Pure: `nowMs` is injected. Read-only — the plan becomes real Production
 * Schedule records ONLY through the explicit, human-approved Commit Schedule action. The AI
 * explains these routing decisions; it never creates schedules, assigns machines, or optimizes.
 */
import type { EnterpriseEntity } from './enterpriseModule';
import type { ExecutiveKpi, ExecutiveRecommendation, ExecRecoPriority } from './executiveCenter';
import type { PlanningInput } from './planning';
import type { Machine } from './manufacturing';
import { calculateMachineAvailability } from './manufacturing';
import type { PlannedOrder } from './timePhasedMrp';
import { computeTimePhasedMrp } from './timePhasedMrp';
import {
  MACHINE_HOURS_PER_DAY,
  MAINTENANCE_WINDOW_HOURS,
  SCHEDULE_HORIZON_DAYS,
  UTILIZATION_BOTTLENECK_THRESHOLD,
  WORKING_MACHINE_STATUSES,
  type MachineLoad,
} from './capacityScheduler';

/* ── module identity ───────────────────────────────────────────────────────── */

export const ROUTINGS_MODULE_ID = 'manufacturing-routings';
export const ROUTING_KIND = 'routing';

/** Aggregate machine-queue hours on one machine at/above which its queue should be reduced. */
export const ROUTING_QUEUE_HOURS_THRESHOLD = MACHINE_HOURS_PER_DAY; // one shift-day of queue

/* ── tunables re-exported for callers/tests (all sourced from capacityScheduler) ── */
export { MACHINE_HOURS_PER_DAY, SCHEDULE_HORIZON_DAYS } from './capacityScheduler';

const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;
const clamp = (n: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, n));
const str = (v: unknown): string => (v === null || v === undefined ? '' : String(v));
const num = (v: unknown): number => (typeof v === 'number' ? v : Number(str(v)) || 0);

function parseDay(d: string): number | null {
  if (!d) return null;
  const t = Date.parse(d);
  return Number.isFinite(t) ? t : null;
}
function toISODate(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}
function dayMsFromHour(hour: number, round: 'floor' | 'ceil'): number {
  const days = round === 'floor' ? Math.floor(hour / MACHINE_HOURS_PER_DAY) : Math.ceil(hour / MACHINE_HOURS_PER_DAY);
  return days * DAY_MS;
}
function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return Math.round(values.reduce((a, b) => a + b, 0) / values.length);
}

/* ── routing master data (operations stored as JSON, mirroring BOM components) ── */

export type RoutingStatus = 'draft' | 'active' | 'archived';

/** One routing operation — a step a product passes through (real, entered as data). */
export interface RoutingOperation {
  sequence: number;
  operation: string;
  workCenter: string;
  /** Qualified machine names/codes; empty ⇒ any machine in the work center. */
  eligibleMachines: string[];
  setupTime: number;
  /** Hours per unit; run hours = ⌈quantity × runTimePerUnit⌉. */
  runTimePerUnit: number;
  queueTime: number;
  inspectionTime: number;
  /** Move time to the next operation (added after this operation finishes). */
  transferTime: number;
}

export interface Routing {
  id: string;
  routingNumber: string;
  product: string;
  operations: RoutingOperation[];
  status: RoutingStatus;
  notes: string;
}

/**
 * Parse a routing's operations from its JSON textarea field. Tolerant: bad JSON or a
 * non-array yields an empty list; each entry is coerced and rows without an operation name
 * or a work center are dropped. Operations are returned sorted by sequence. Deterministic.
 */
export function parseRoutingOperations(raw: unknown): RoutingOperation[] {
  const text = str(raw).trim();
  if (!text) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  return parsed
    .map((c, i) => {
      const row = (c ?? {}) as Record<string, unknown>;
      const eligible = Array.isArray(row.eligibleMachines)
        ? row.eligibleMachines.map((m) => str(m)).filter((m) => m !== '')
        : str(row.eligibleMachines)
            .split(',')
            .map((m) => m.trim())
            .filter((m) => m !== '');
      return {
        sequence: row.sequence === undefined || row.sequence === null || row.sequence === '' ? (i + 1) * 10 : num(row.sequence),
        operation: str(row.operation),
        workCenter: str(row.workCenter),
        eligibleMachines: eligible,
        setupTime: Math.max(0, num(row.setupTime)),
        runTimePerUnit: Math.max(0, num(row.runTimePerUnit)),
        queueTime: Math.max(0, num(row.queueTime)),
        inspectionTime: Math.max(0, num(row.inspectionTime)),
        transferTime: Math.max(0, num(row.transferTime)),
      };
    })
    .filter((o) => o.operation !== '' && o.workCenter !== '')
    .sort((a, b) => a.sequence - b.sequence);
}

/** Serialize operations back to the canonical JSON textarea form. Deterministic. */
export function serializeRoutingOperations(operations: RoutingOperation[]): string {
  return JSON.stringify(operations);
}

function oneOf<T extends string>(v: unknown, all: readonly T[], fallback: T): T {
  const s = str(v);
  return (all as readonly string[]).includes(s) ? (s as T) : fallback;
}

export function routingFromRecord(record: EnterpriseEntity): Routing {
  const f = record.fields;
  return {
    id: record.id,
    routingNumber: str(f.routingNumber) || record.title,
    product: str(f.product),
    operations: parseRoutingOperations(f.operations),
    status: oneOf<RoutingStatus>(f.status, ['draft', 'active', 'archived'], 'draft'),
    notes: str(f.notes),
  };
}

/* ── deterministic operation timing ─────────────────────────────────────────── */

export interface RoutingOperationTimingInput {
  /** Machine-busy hours for this operation (setup + run + inspection). */
  workHours: number;
  /** Operating-hour offset at which the operation may claim a machine (material + queue). */
  needFromHour: number;
  /** Operating-hour offset the machine is next free. */
  machineFreeHour: number;
  /** Operating-hour offset of the machine's maintenance window start, or null. */
  maintenanceStartHour: number | null;
}

export interface RoutingOperationTiming {
  startHour: number;
  finishHour: number;
  /** Hours the operation waited for the machine to free up (dynamic queue). */
  machineWaitHours: number;
  maintenanceConflict: boolean;
}

/**
 * Deterministic timing for one operation on one machine. Start = max(machine-free, ready);
 * the machine-busy wait becomes queue. If the operation would overlap the machine's
 * maintenance window it is pushed to run AFTER the window (Maintenance is authoritative). Pure.
 */
export function computeRoutingOperationTiming(inp: RoutingOperationTimingInput): RoutingOperationTiming {
  let startHour = Math.max(inp.machineFreeHour, inp.needFromHour);
  const machineWaitHours = Math.max(0, inp.machineFreeHour - inp.needFromHour);
  let maintenanceConflict = false;
  if (inp.maintenanceStartHour !== null) {
    const mStart = inp.maintenanceStartHour;
    const mEnd = mStart + MAINTENANCE_WINDOW_HOURS;
    if (startHour < mEnd && startHour + inp.workHours > mStart) {
      maintenanceConflict = true;
      startHour = mEnd;
    }
  }
  return { startHour, finishHour: startHour + inp.workHours, machineWaitHours, maintenanceConflict };
}

/* ── typed outputs ──────────────────────────────────────────────────────────── */

export interface ScheduledRoutingOperation {
  sequence: number;
  operation: string;
  workCenter: string;
  /** Assigned machine ('' when the operation is blocked). */
  machine: string;
  /** Qualified machines currently available for this operation. */
  eligibleMachineCount: number;
  /** Qualified machines including unavailable ones (for capability vs availability diagnosis). */
  qualifiedMachineCount: number;
  setupHours: number;
  runHours: number;
  inspectionHours: number;
  /** Routing queue + dynamic machine wait. */
  queueHours: number;
  transferHours: number;
  /** queue + setup + run + inspection (lead time from ready to finish). */
  durationHours: number;
  startDate: string;
  finishDate: string;
  startHour: number;
  finishHour: number;
  scheduled: boolean;
  blockedReason: string;
  maintenanceConflict: boolean;
  onBottleneck: boolean;
}

export type ProductionSchedulePlanStatus = 'planned' | 'blocked' | 'unrouted';

export interface ProductionSchedulePlan {
  scheduleId: string;
  productionOrder: string;
  product: string;
  routingNumber: string;
  operations: ScheduledRoutingOperation[];
  plannedStart: string;
  plannedFinish: string;
  status: ProductionSchedulePlanStatus;
  onCriticalPath: boolean;
  late: boolean;
}

export interface RoutingSchedule {
  schedules: ProductionSchedulePlan[];
  machineLoads: MachineLoad[];
  horizonDays: number;
}

/* ── machine state + eligibility (memoized) ─────────────────────────────────── */

interface MachineState {
  machine: Machine;
  available: boolean;
  freeHour: number;
  maintenanceStartHour: number | null;
  capacityHours: number;
}

function dateToOperatingHour(dateMs: number | null, nowMs: number): number | null {
  if (dateMs === null) return null;
  const dayOffset = Math.floor((dateMs - nowMs) / DAY_MS);
  return Math.max(0, dayOffset) * MACHINE_HOURS_PER_DAY;
}

function buildMachineStates(machines: Machine[], nowMs: number): MachineState[] {
  const capacityPerMachine = MACHINE_HOURS_PER_DAY * SCHEDULE_HORIZON_DAYS;
  const horizonHours = 24 * SCHEDULE_HORIZON_DAYS;
  return machines.map((m) => {
    const available = (WORKING_MACHINE_STATUSES as readonly string[]).includes(m.status);
    const maintMs = parseDay(m.maintenanceDue);
    let maintenanceStartHour: number | null = null;
    if (maintMs !== null) {
      const rawHour = (maintMs - nowMs) / HOUR_MS;
      if (rawHour >= -MAINTENANCE_WINDOW_HOURS && rawHour <= horizonHours) {
        maintenanceStartHour = dateToOperatingHour(maintMs, nowMs);
      }
    }
    const capacityHours = available
      ? Math.max(0, capacityPerMachine - (maintenanceStartHour !== null ? MAINTENANCE_WINDOW_HOURS : 0))
      : 0;
    return { machine: m, available, freeHour: 0, maintenanceStartHour, capacityHours };
  });
}

/** A machine is QUALIFIED for an operation when it is in the work center and declared eligible. */
function machineQualified(m: Machine, op: RoutingOperation): boolean {
  if (m.workCenter !== op.workCenter) return false;
  if (op.eligibleMachines.length === 0) return true;
  return op.eligibleMachines.includes(m.name) || op.eligibleMachines.includes(m.code);
}

interface EligibilityGroup {
  /** Qualified + available (schedulable now). */
  available: MachineState[];
  /** Qualified regardless of availability (for capability-vs-maintenance diagnosis). */
  qualifiedCount: number;
}

function eligibilityKey(op: RoutingOperation): string {
  return `${op.workCenter}||${[...op.eligibleMachines].sort().join(',')}`;
}

/** Memoized: qualified machine states per (work center × qualified set). */
function eligibleFor(op: RoutingOperation, states: MachineState[], cache: Map<string, EligibilityGroup>): EligibilityGroup {
  const key = eligibilityKey(op);
  const cached = cache.get(key);
  if (cached) return cached;
  const qualified = states.filter((s) => machineQualified(s.machine, op));
  const group: EligibilityGroup = { available: qualified.filter((s) => s.available && s.capacityHours > 0), qualifiedCount: qualified.length };
  cache.set(key, group);
  return group;
}

/** Machine priority tiebreaker — the more reliable machine (higher availability) first. */
function machinePriority(m: Machine): number {
  return calculateMachineAvailability(m.runtime, m.downtime);
}

/* ── scheduling one production order's routing (reused by plan + commit) ─────── */

export interface RoutingJob {
  ref: string;
  product: string;
  quantity: number;
  releaseDate: string;
  requiredDate: string;
  onCriticalPath: boolean;
}

function scheduleOneRouting(
  job: RoutingJob,
  routing: Routing,
  states: MachineState[],
  nowMs: number,
  cache: Map<string, EligibilityGroup>,
): ProductionSchedulePlan {
  const releaseHour = dateToOperatingHour(parseDay(job.releaseDate), nowMs) ?? 0;
  let earliestStart = releaseHour;
  const operations: ScheduledRoutingOperation[] = [];
  let blocked = false;

  for (const op of routing.operations) {
    const group = eligibleFor(op, states, cache);
    const setupHours = op.setupTime;
    const runHours = Math.ceil(Math.max(0, job.quantity) * op.runTimePerUnit);
    const inspectionHours = op.inspectionTime;
    const workHours = setupHours + runHours + inspectionHours;
    const needFrom = earliestStart + op.queueTime;

    if (group.available.length === 0) {
      blocked = true;
      operations.push({
        sequence: op.sequence,
        operation: op.operation,
        workCenter: op.workCenter,
        machine: '',
        eligibleMachineCount: 0,
        qualifiedMachineCount: group.qualifiedCount,
        setupHours,
        runHours,
        inspectionHours,
        queueHours: op.queueTime,
        transferHours: op.transferTime,
        durationHours: op.queueTime + workHours,
        startDate: '',
        finishDate: '',
        startHour: 0,
        finishHour: 0,
        scheduled: false,
        blockedReason:
          group.qualifiedCount === 0
            ? `No machine in ${op.workCenter} is qualified for ${op.operation}.`
            : `All qualified machines for ${op.operation} are unavailable (maintenance/down).`,
        maintenanceConflict: false,
        onBottleneck: false,
      });
      continue; // dependency chain cannot advance past a blocked operation
    }

    let best: { st: MachineState; t: RoutingOperationTiming } | null = null;
    for (const st of group.available) {
      const t = computeRoutingOperationTiming({ workHours, needFromHour: needFrom, machineFreeHour: st.freeHour, maintenanceStartHour: st.maintenanceStartHour });
      if (best === null || t.finishHour < best.t.finishHour) {
        best = { st, t };
      } else if (t.finishHour === best.t.finishHour) {
        const cur = machinePriority(st.machine);
        const bst = machinePriority(best.st.machine);
        if (cur > bst || (cur === bst && st.machine.name.localeCompare(best.st.machine.name) < 0)) best = { st, t };
      }
    }
    const { st, t } = best!;
    st.freeHour = t.finishHour;
    const startDate = toISODate(nowMs + dayMsFromHour(t.startHour, 'floor'));
    const finishDate = toISODate(nowMs + dayMsFromHour(t.finishHour, 'ceil'));
    operations.push({
      sequence: op.sequence,
      operation: op.operation,
      workCenter: op.workCenter,
      machine: st.machine.name,
      eligibleMachineCount: group.available.length,
      qualifiedMachineCount: group.qualifiedCount,
      setupHours,
      runHours,
      inspectionHours,
      queueHours: op.queueTime + t.machineWaitHours,
      transferHours: op.transferTime,
      durationHours: op.queueTime + t.machineWaitHours + workHours,
      startDate,
      finishDate,
      startHour: t.startHour,
      finishHour: t.finishHour,
      scheduled: true,
      blockedReason: '',
      maintenanceConflict: t.maintenanceConflict,
      onBottleneck: false,
    });
    earliestStart = t.finishHour + op.transferTime;
  }

  const scheduledOps = operations.filter((o) => o.scheduled);
  const plannedStartHour = scheduledOps.length > 0 ? Math.min(...scheduledOps.map((o) => o.startHour)) : null;
  const plannedFinishHour = scheduledOps.length > 0 ? Math.max(...scheduledOps.map((o) => o.finishHour)) : null;
  const plannedStart = plannedStartHour !== null ? toISODate(nowMs + dayMsFromHour(plannedStartHour, 'floor')) : '';
  const plannedFinishMs = plannedFinishHour !== null ? nowMs + dayMsFromHour(plannedFinishHour, 'ceil') : null;
  const plannedFinish = plannedFinishMs !== null ? toISODate(plannedFinishMs) : '';
  const requiredMs = parseDay(job.requiredDate);
  const late = plannedFinishMs !== null && requiredMs !== null ? plannedFinishMs > requiredMs : false;

  return {
    scheduleId: `RSCH-${job.ref}`,
    productionOrder: job.ref,
    product: job.product,
    routingNumber: routing.routingNumber,
    operations,
    plannedStart,
    plannedFinish,
    status: blocked ? 'blocked' : 'planned',
    onCriticalPath: job.onCriticalPath,
    late,
  };
}

function unroutedPlan(job: RoutingJob): ProductionSchedulePlan {
  return {
    scheduleId: `RSCH-${job.ref}`,
    productionOrder: job.ref,
    product: job.product,
    routingNumber: '',
    operations: [],
    plannedStart: '',
    plannedFinish: '',
    status: 'unrouted',
    onCriticalPath: job.onCriticalPath,
    late: false,
  };
}

/** Schedule ONE production order through its routing (fresh machine state). Used by Commit. Pure. */
export function scheduleProductionOrderRouting(job: RoutingJob, routing: Routing, machines: Machine[], nowMs: number): ProductionSchedulePlan {
  const states = buildMachineStates(machines, nowMs);
  return scheduleOneRouting(job, routing, states, nowMs, new Map());
}

function buildMachineLoads(states: MachineState[], schedules: ProductionSchedulePlan[]): MachineLoad[] {
  const load = new Map<string, number>();
  const count = new Map<string, number>();
  for (const s of schedules) {
    for (const op of s.operations) {
      if (!op.scheduled) continue;
      load.set(op.machine, (load.get(op.machine) ?? 0) + op.setupHours + op.runHours + op.inspectionHours);
      count.set(op.machine, (count.get(op.machine) ?? 0) + 1);
    }
  }
  return states.map((st) => {
    const loadHours = load.get(st.machine.name) ?? 0;
    const capacityHours = st.capacityHours;
    const rawUtil = capacityHours > 0 ? (loadHours / capacityHours) * 100 : loadHours > 0 ? 100 : 0;
    const utilization = clamp(Math.round(rawUtil), 0, 100);
    const overloaded = capacityHours > 0 && loadHours > capacityHours;
    return {
      machine: st.machine.name,
      workCenter: st.machine.workCenter,
      status: st.machine.status,
      available: st.available,
      assignedOperations: count.get(st.machine.name) ?? 0,
      loadHours: Math.round(loadHours),
      capacityHours: Math.round(capacityHours),
      utilization,
      idleHours: Math.round(Math.max(0, capacityHours - loadHours)),
      overloaded,
      bottleneck: st.available && (overloaded || utilization >= UTILIZATION_BOTTLENECK_THRESHOLD),
      maintenanceWindow: st.maintenanceStartHour !== null ? st.machine.maintenanceDue : '',
    };
  });
}

function dispatchOrder(a: PlannedOrder, b: PlannedOrder): number {
  return (
    Number(b.late) - Number(a.late) ||
    Number(b.onCriticalPath) - Number(a.onCriticalPath) ||
    (parseDay(a.requiredDate) ?? 0) - (parseDay(b.requiredDate) ?? 0) ||
    b.quantity - a.quantity ||
    a.sku.localeCompare(b.sku)
  );
}

/**
 * Build the routing-aware schedule for the whole plan. Reuses `computeTimePhasedMrp` for the
 * production planned orders, then routes each through its (active) routing onto qualified
 * machines, accruing finite capacity across orders. Deterministic dispatch, memoized
 * eligibility, one forward pass per order. Pure — `nowMs` injected.
 */
export function computeRoutingSchedule(input: PlanningInput, routings: Routing[], nowMs: number): RoutingSchedule {
  const plan = computeTimePhasedMrp(input, nowMs);
  const states = buildMachineStates(input.machines, nowMs);
  const cache = new Map<string, EligibilityGroup>();

  const routingByProduct = new Map<string, Routing>();
  for (const r of routings) {
    if (r.status === 'active' && r.product && r.operations.length > 0 && !routingByProduct.has(r.product)) {
      routingByProduct.set(r.product, r);
    }
  }

  const dispatch = plan.plannedOrders.filter((o) => o.type === 'production').sort(dispatchOrder);
  const schedules: ProductionSchedulePlan[] = [];
  for (const job of dispatch) {
    const routing = routingByProduct.get(job.sku);
    const routingJob: RoutingJob = { ref: job.sku, product: job.sku, quantity: job.quantity, releaseDate: job.releaseDate, requiredDate: job.requiredDate, onCriticalPath: job.onCriticalPath };
    schedules.push(routing ? scheduleOneRouting(routingJob, routing, states, nowMs, cache) : unroutedPlan(routingJob));
  }

  const machineLoads = buildMachineLoads(states, schedules);
  const bottlenecks = new Set(machineLoads.filter((l) => l.bottleneck).map((l) => l.machine));
  for (const s of schedules) for (const op of s.operations) if (op.scheduled) op.onBottleneck = bottlenecks.has(op.machine);

  return { schedules, machineLoads, horizonDays: SCHEDULE_HORIZON_DAYS };
}

/** Field-sets for the real Production Schedule records a Commit persists (one per scheduled op). Pure. */
export function buildScheduleRecordFields(plan: ProductionSchedulePlan, orderNumber: string): Array<Record<string, string>> {
  return plan.operations
    .filter((op) => op.scheduled)
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

/* ── aggregate insights (Executive Center) ─────────────────────────────────── */

export interface RoutingInsights {
  routingReadiness: number;
  machineQualification: number;
  operationReadiness: number;
  scheduleStability: number;
  capacityUtilization: number;
  productionConfidence: number;
  manufacturingReadiness: number;
  scheduleCompletion: number;
  criticalOperationRisk: number;
  overallApsScore: number;
}

/** Roll the routing schedule into the ten Executive routing KPIs. Pure. */
export function deriveRoutingInsights(schedule: RoutingSchedule): RoutingInsights {
  const orders = schedule.schedules;
  const totalOrders = orders.length;
  const routed = orders.filter((s) => s.status !== 'unrouted');
  const allOps = routed.flatMap((s) => s.operations);
  const totalOps = allOps.length;
  const scheduledOps = allOps.filter((o) => o.scheduled);

  const routingReadiness = totalOrders === 0 ? 100 : clamp(Math.round((routed.length / totalOrders) * 100), 0, 100);
  const machineQualification = totalOps === 0 ? 100 : clamp(Math.round((allOps.filter((o) => o.qualifiedMachineCount > 0).length / totalOps) * 100), 0, 100);
  const operationReadiness = totalOps === 0 ? 100 : clamp(Math.round((scheduledOps.length / totalOps) * 100), 0, 100);
  const scheduleStability = scheduledOps.length === 0 ? 100 : clamp(Math.round((scheduledOps.filter((o) => !o.onBottleneck).length / scheduledOps.length) * 100), 0, 100);

  const availLoads = schedule.machineLoads.filter((l) => l.available && l.capacityHours > 0);
  const capacityUtilization = availLoads.length === 0 ? 0 : clamp(mean(availLoads.map((l) => l.utilization)), 0, 100);

  const productionConfidence = clamp(Math.round((routingReadiness + machineQualification + operationReadiness) / 3), 0, 100);
  const fullyScheduled = orders.filter((s) => s.status === 'planned');
  const manufacturingReadiness = totalOrders === 0 ? 100 : clamp(Math.round((fullyScheduled.length / totalOrders) * 100), 0, 100);
  const onTimeOrders = fullyScheduled.filter((s) => !s.late).length;
  const scheduleCompletion = totalOrders === 0 ? 100 : clamp(Math.round((onTimeOrders / totalOrders) * 100), 0, 100);

  const criticalOrders = orders.filter((s) => s.onCriticalPath);
  const riskyCritical = criticalOrders.filter((s) => s.status !== 'planned' || s.late).length;
  const criticalOperationRisk = criticalOrders.length === 0 ? 0 : clamp(Math.round((riskyCritical / criticalOrders.length) * 100), 0, 100);

  const overallApsScore = clamp(
    Math.round((routingReadiness + machineQualification + operationReadiness + scheduleCompletion + manufacturingReadiness + (100 - criticalOperationRisk)) / 6),
    0,
    100,
  );

  return {
    routingReadiness,
    machineQualification,
    operationReadiness,
    scheduleStability,
    capacityUtilization,
    productionConfidence,
    manufacturingReadiness,
    scheduleCompletion,
    criticalOperationRisk,
    overallApsScore,
  };
}

/** Map routing insights to Executive Center KPI tiles (reuses the existing KPI type). */
export function routingInsightsToKpis(insights: RoutingInsights): ExecutiveKpi[] {
  const pctBand = (v: number): ExecutiveKpi['band'] => (v >= 90 ? 'healthy' : v >= 75 ? 'watch' : 'at-risk');
  const usageBand = (v: number): ExecutiveKpi['band'] => (v >= 90 ? 'at-risk' : v >= 75 ? 'watch' : 'healthy');
  const riskBand = (v: number): ExecutiveKpi['band'] => (v <= 10 ? 'healthy' : v <= 25 ? 'watch' : 'at-risk');
  return [
    { key: 'rt-routing-readiness', label: 'Routing Readiness', value: insights.routingReadiness, display: `${insights.routingReadiness}%`, band: pctBand(insights.routingReadiness), deepLink: 'enterprise/executive' },
    { key: 'rt-machine-qual', label: 'Machine Qualification', value: insights.machineQualification, display: `${insights.machineQualification}%`, band: pctBand(insights.machineQualification), deepLink: 'enterprise/executive' },
    { key: 'rt-operation-readiness', label: 'Operation Readiness', value: insights.operationReadiness, display: `${insights.operationReadiness}%`, band: pctBand(insights.operationReadiness), deepLink: 'enterprise/executive' },
    { key: 'rt-schedule-stability', label: 'Schedule Stability', value: insights.scheduleStability, display: `${insights.scheduleStability}%`, band: pctBand(insights.scheduleStability), deepLink: 'enterprise/executive' },
    { key: 'rt-capacity-util', label: 'Capacity Utilization', value: insights.capacityUtilization, display: `${insights.capacityUtilization}%`, band: usageBand(insights.capacityUtilization), deepLink: 'enterprise/executive' },
    { key: 'rt-production-confidence', label: 'Production Confidence', value: insights.productionConfidence, display: `${insights.productionConfidence}%`, band: pctBand(insights.productionConfidence), deepLink: 'enterprise/executive' },
    { key: 'rt-mfg-readiness', label: 'Manufacturing Readiness', value: insights.manufacturingReadiness, display: `${insights.manufacturingReadiness}%`, band: pctBand(insights.manufacturingReadiness), deepLink: 'enterprise/executive' },
    { key: 'rt-schedule-completion', label: 'Schedule Completion', value: insights.scheduleCompletion, display: `${insights.scheduleCompletion}%`, band: pctBand(insights.scheduleCompletion), deepLink: 'enterprise/executive' },
    { key: 'rt-critical-risk', label: 'Critical Operation Risk', value: insights.criticalOperationRisk, display: `${insights.criticalOperationRisk}%`, band: riskBand(insights.criticalOperationRisk), deepLink: 'enterprise/executive' },
    { key: 'rt-overall', label: 'Overall APS Score', value: insights.overallApsScore, display: `${insights.overallApsScore}`, band: pctBand(insights.overallApsScore), deepLink: 'enterprise/executive' },
  ];
}

/* ── recommendations (flow into the existing Executive recommendation system) ── */

function rank(priority: ExecRecoPriority, confidence: number): number {
  const base: Record<ExecRecoPriority, number> = { critical: 1000, high: 700, medium: 400, low: 100 };
  return Math.round(base[priority] + confidence * 100);
}

/**
 * Deterministic routing recommendations — alternate-machine / blocked-by-maintenance /
 * routing-conflict / capability-mismatch / split-routing / reduce-queue / resequence — read
 * straight off the computed routing schedule. Each carries the arithmetic (work centers,
 * qualified machines, load, queue, dates) that produced it and flows through the EXISTING
 * Executive recommendation + timeline system. The AI explains; it never schedules or optimizes.
 */
export function routingRecommendations(schedule: RoutingSchedule, limit = 20): ExecutiveRecommendation[] {
  const recs: ExecutiveRecommendation[] = [];
  const loads = schedule.machineLoads;
  const idleQualified = (workCenter: string, notMachine: string): MachineLoad | undefined =>
    loads.find((l) => l.available && l.workCenter === workCenter && l.machine !== notMachine && !l.bottleneck && l.idleHours > 0);

  // Routing conflict — a production order with no active routing.
  for (const s of schedule.schedules.filter((x) => x.status === 'unrouted')) {
    recs.push({
      id: `rt:routing:${s.product}`,
      metric: 'production',
      icon: 'git-branch',
      problem: `Routing conflict — ${s.product} has no active routing, so its operations cannot be scheduled.`,
      businessImpact: 'Without a routing the order cannot be sequenced onto machines; it will not build.',
      rootCause: `No active routing defines the operations for ${s.product}.`,
      priority: s.onCriticalPath ? 'critical' : 'high',
      confidence: 0.9,
      expectedOutcome: `Defining a routing for ${s.product} makes it schedulable.`,
      evidence: [`product=${s.product}`, `routing=none`, s.onCriticalPath ? 'criticalPath=yes' : 'criticalPath=no'],
      sourceSystems: ['planning', 'manufacturing'],
      recommendedAction: `Define an active routing (operations + work centers) for ${s.product}.`,
      owner: 'Production Planner',
      eta: s.onCriticalPath ? 'today' : 'this week',
      status: 'open',
      score: rank(s.onCriticalPath ? 'critical' : 'high', 0.9),
    });
  }

  for (const s of schedule.schedules) {
    for (const op of s.operations) {
      // Capability mismatch — no machine in the work center is qualified for the operation.
      if (!op.scheduled && op.qualifiedMachineCount === 0) {
        recs.push({
          id: `rt:capability:${s.product}:${op.sequence}`,
          metric: 'production',
          icon: 'alert-octagon',
          problem: `Machine capability mismatch — operation ${op.sequence} ${op.operation} (${s.product}) has no qualified machine in ${op.workCenter}.`,
          businessImpact: 'An operation with no capable machine blocks the whole routing downstream.',
          rootCause: `No machine in work center ${op.workCenter} is listed as eligible for ${op.operation}.`,
          priority: 'critical',
          confidence: 0.9,
          expectedOutcome: 'Qualifying a machine (or correcting the work center) unblocks the operation.',
          evidence: [`operation=${op.sequence}:${op.operation}`, `workCenter=${op.workCenter}`, `qualifiedMachines=0`],
          sourceSystems: ['manufacturing'],
          recommendedAction: `Qualify a machine in ${op.workCenter} for ${op.operation} (or fix the routing work center).`,
          owner: 'Manufacturing Engineer',
          eta: 'today',
          status: 'open',
          score: rank('critical', 0.9),
        });
      }
      // Blocked by maintenance/availability — qualified machines exist but none is available.
      if (!op.scheduled && op.qualifiedMachineCount > 0 && op.eligibleMachineCount === 0) {
        recs.push({
          id: `rt:maint:${s.product}:${op.sequence}`,
          metric: 'maintenance',
          icon: 'tool',
          problem: `Operation blocked by maintenance — ${op.operation} (${s.product}) has ${op.qualifiedMachineCount} qualified machine(s) in ${op.workCenter}, all unavailable.`,
          businessImpact: 'A qualified but down/maintenance machine blocks the operation until it returns.',
          rootCause: `Every qualified machine for ${op.operation} is in maintenance or down (authority: Maintenance).`,
          priority: 'high',
          confidence: 0.85,
          expectedOutcome: 'Returning one qualified machine to service (or adding another) unblocks the operation.',
          evidence: [`operation=${op.sequence}:${op.operation}`, `workCenter=${op.workCenter}`, `qualified=${op.qualifiedMachineCount}`, `available=0`],
          sourceSystems: ['manufacturing', 'maintenance'],
          recommendedAction: `Bring a qualified ${op.workCenter} machine back online for ${op.operation}, or add capacity.`,
          owner: 'Maintenance Planner',
          eta: 'this week',
          status: 'open',
          score: rank('high', 0.85),
        });
      }
      // Requires alternate machine — scheduled onto a bottleneck while an idle qualified machine exists.
      if (op.scheduled && op.onBottleneck) {
        const alt = idleQualified(op.workCenter, op.machine);
        if (alt) {
          recs.push({
            id: `rt:alternate:${s.product}:${op.sequence}`,
            metric: 'capacity',
            icon: 'shuffle',
            problem: `Operation ${op.operation} (${s.product}) should move to ${alt.machine} — ${op.machine} is a bottleneck while ${alt.machine} is ${alt.utilization}% utilized.`,
            businessImpact: 'Re-routing the operation to an idle qualified machine recovers on-time completion.',
            rootCause: `${op.machine} is a bottleneck (util ${loads.find((l) => l.machine === op.machine)?.utilization ?? 0}%); ${alt.machine} has ${alt.idleHours}h idle.`,
            priority: 'high',
            confidence: 0.85,
            expectedOutcome: `Running ${op.operation} on ${alt.machine} relieves ${op.machine}.`,
            evidence: [`operation=${op.sequence}:${op.operation}`, `from=${op.machine}`, `to=${alt.machine}`, `toIdle=${alt.idleHours}h`],
            sourceSystems: ['planning', 'manufacturing'],
            recommendedAction: `Re-route ${op.operation} for ${s.product} from ${op.machine} to ${alt.machine}.`,
            owner: 'Production Planner',
            eta: 'this week',
            status: 'open',
            score: rank('high', 0.85),
          });
        }
      }
      // Split routing — one operation's run alone exceeds a machine's capacity + alternates exist.
      if (op.scheduled) {
        const cap = loads.find((l) => l.machine === op.machine)?.capacityHours ?? 0;
        const qualifiedAvail = loads.filter((l) => l.available && l.workCenter === op.workCenter && l.capacityHours > 0).length;
        if (op.runHours > cap && qualifiedAvail >= 2) {
          recs.push({
            id: `rt:split:${s.product}:${op.sequence}`,
            metric: 'capacity',
            icon: 'scissors',
            problem: `Split routing — operation ${op.operation} (${s.product}) runs ${op.runHours}h, beyond ${op.machine}'s ${cap}h capacity.`,
            businessImpact: 'An operation larger than one machine can build in the horizon must be split to complete.',
            rootCause: `Run ${op.runHours}h for the operation exceeds machine capacity ${cap}h, and ${qualifiedAvail} qualified machines exist.`,
            priority: 'medium',
            confidence: 0.8,
            expectedOutcome: `Splitting ${op.operation} across ${qualifiedAvail} qualified machines parallelizes it.`,
            evidence: [`operation=${op.sequence}:${op.operation}`, `run=${op.runHours}h`, `machineCap=${cap}h`, `qualifiedMachines=${qualifiedAvail}`],
            sourceSystems: ['planning', 'manufacturing'],
            recommendedAction: `Split ${op.operation} for ${s.product} across qualified ${op.workCenter} machines.`,
            owner: 'Production Planner',
            eta: 'this week',
            status: 'open',
            score: rank('medium', 0.8),
          });
        }
      }
    }
    // Resequence — a late critical-path order with a blocked or bottleneck operation.
    if (s.onCriticalPath && s.status === 'planned' && s.late) {
      const contended = s.operations.find((o) => o.scheduled && o.onBottleneck);
      if (contended) {
        recs.push({
          id: `rt:resequence:${s.product}`,
          metric: 'production',
          icon: 'list',
          problem: `Resequence ${s.product} — a critical-path order finishes late (${s.plannedFinish}) behind contended operation ${contended.operation}.`,
          businessImpact: 'A late critical-path order pushes out dependent demand; resequencing its operations recovers time.',
          rootCause: `Operation ${contended.operation} sits on bottleneck machine ${contended.machine}; the order finishes ${s.plannedFinish}.`,
          priority: 'high',
          confidence: 0.8,
          expectedOutcome: 'Prioritizing this order at the contended operation reduces its completion date.',
          evidence: [`product=${s.product}`, `plannedFinish=${s.plannedFinish}`, `contendedOp=${contended.sequence}:${contended.operation}`, `machine=${contended.machine}`],
          sourceSystems: ['planning', 'manufacturing'],
          recommendedAction: `Resequence ${s.product} ahead of lower-priority work at ${contended.machine}.`,
          owner: 'Production Planner',
          eta: 'this week',
          status: 'open',
          score: rank('high', 0.8),
        });
      }
    }
  }

  // Reduce queue — a machine whose accumulated operation queue exceeds the threshold.
  const queueByMachine = new Map<string, { ops: number; hours: number }>();
  for (const s of schedule.schedules) {
    for (const op of s.operations) {
      if (!op.scheduled || op.queueHours <= 0) continue;
      const e = queueByMachine.get(op.machine) ?? { ops: 0, hours: 0 };
      e.ops += 1;
      e.hours += op.queueHours;
      queueByMachine.set(op.machine, e);
    }
  }
  for (const [machine, q] of [...queueByMachine.entries()].sort((a, b) => b[1].hours - a[1].hours)) {
    if (q.hours < ROUTING_QUEUE_HOURS_THRESHOLD) continue;
    recs.push({
      id: `rt:queue:${machine}`,
      metric: 'capacity',
      icon: 'clock',
      problem: `Reduce the queue on ${machine} — ${q.ops} operation(s) wait ${q.hours}h in total.`,
      businessImpact: 'A deep operation queue delays every job waiting behind it.',
      rootCause: `${q.ops} routed operations queue on ${machine} for ${q.hours}h of cumulative wait.`,
      priority: 'medium',
      confidence: 0.8,
      expectedOutcome: 'Off-loading or resequencing the queue on this machine recovers lead time.',
      evidence: [`machine=${machine}`, `queuedOps=${q.ops}`, `queueHours=${q.hours}h`, `threshold=${ROUTING_QUEUE_HOURS_THRESHOLD}h`],
      sourceSystems: ['planning', 'manufacturing'],
      recommendedAction: `Reduce ${machine}'s operation queue (off-load or resequence).`,
      owner: 'Production Planner',
      eta: 'this week',
      status: 'open',
      score: rank('medium', 0.8),
    });
  }

  return recs.sort((a, b) => b.score - a.score).slice(0, limit);
}
