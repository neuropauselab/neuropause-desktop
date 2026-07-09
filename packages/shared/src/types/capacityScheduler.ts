/**
 * Finite Capacity Scheduling (APS) — EXTENDS Time-Phased MRP (`timePhasedMrp.ts`) from
 * "WHEN to build/buy" to "WHICH machine builds it, in WHICH work center, at exactly WHAT
 * time, in WHAT sequence". It does NOT replace `runMrp`, `runMultiLevelMrp`,
 * `computeTimePhasedMrp`, `planning.ts`, `mrp.ts`, or `timePhasedMrp.ts` — it consumes
 * their output: `computeTimePhasedMrp(input, nowMs)` yields the production planned orders
 * (already backward-scheduled + critical-path-marked), and this engine LOADS them onto the
 * REAL machines from the Manufacturing + Maintenance systems.
 *
 * Machine availability is authoritative, never invented: a machine can take work only when
 * its Manufacturing `status` is a working state (running/idle), and its Maintenance
 * `maintenanceDue` date carves out a downtime window the scheduler routes production around.
 * Maintenance remains the authority for downtime; Manufacturing for execution. Scheduling
 * covers all four classic modes at once — forward (loading operations forward in time onto
 * finite machines), backward (due dates flow down from the MRP backward pass), critical-path
 * (critical-path jobs dispatch first), dependency (release dates already encode the BOM), and
 * constraint (finite machine capacity + maintenance windows are the constraints).
 *
 * Deterministic dispatch (late → critical-path → earliest-due → largest → sku) with greedy
 * earliest-finish machine assignment: O(n·m) over n orders and m machines (m small), a single
 * forward pass with per-machine free-time cursors — no quadratic loop, scales to thousands of
 * orders. It emits per-operation timing (queue/setup/run/changeover), per-machine load +
 * bottleneck detection, ten Executive capacity KPIs, and deterministic scheduling
 * recommendations (move-to-machine, second-shift, split, avoid-maintenance, reschedule-queue,
 * delay, overloaded, capacity-available) — each carrying the arithmetic that produced it.
 * Pure: the clock (`nowMs`) is injected. Read-only; execution never occurs here — the AI
 * explains these schedules, it never computes, schedules, or optimizes them.
 */
import type { ExecutiveKpi, ExecutiveRecommendation, ExecRecoPriority } from './executiveCenter';
import type { PlanningInput } from './planning';
import type { Machine, MachineStatus } from './manufacturing';
import { calculateMachineAvailability } from './manufacturing';
import type { PlannedOrder } from './timePhasedMrp';
import { computeTimePhasedMrp } from './timePhasedMrp';

/* ── tunables (deterministic constants — explainable, never guessed) ─────────── */

/** Operating hours in one shift-day (the machine calendar granularity). */
export const MACHINE_HOURS_PER_DAY = 8;
/** Units a machine produces per operating hour (deterministic run-rate). */
export const MACHINE_RATE_PER_HOUR = 10;
/** Fixed setup time charged once per operation. */
export const SETUP_HOURS = 2;
/** Changeover time charged when a machine switches from one SKU to a different SKU. */
export const CHANGEOVER_HOURS = 1;
/** Downtime a `maintenanceDue` window blocks on a machine (one shift-day). */
export const MAINTENANCE_WINDOW_HOURS = 8;
/** Operating hours a second shift adds per day when authorized. */
export const SECOND_SHIFT_HOURS = 8;
/** Utilization at/above which a machine is a bottleneck. */
export const UTILIZATION_BOTTLENECK_THRESHOLD = 85;
/** Scheduling horizon (days of finite capacity considered). */
export const SCHEDULE_HORIZON_DAYS = 30;
/** Slack (days) above which an early, non-critical job is a delay candidate. */
export const DELAY_SLACK_DAYS = 7;
/** Queued operations on one machine at/above which its queue should be resequenced. */
export const QUEUE_OPS_THRESHOLD = 2;

/** Machine statuses that can accept scheduled work (availability from the REAL records). */
export const WORKING_MACHINE_STATUSES: readonly MachineStatus[] = ['running', 'idle'];

const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;
const clamp = (n: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, n));

function parseDay(d: string): number | null {
  if (!d) return null;
  const t = Date.parse(d);
  return Number.isFinite(t) ? t : null;
}
function toISODate(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}
/** Map an operating-hour offset to a whole-day wall-clock offset (floor=start, ceil=finish). */
function dayMsFromHour(hour: number, round: 'floor' | 'ceil'): number {
  const days = round === 'floor' ? Math.floor(hour / MACHINE_HOURS_PER_DAY) : Math.ceil(hour / MACHINE_HOURS_PER_DAY);
  return days * DAY_MS;
}

/* ── typed outputs ──────────────────────────────────────────────────────────── */

/** One production planned order loaded onto a specific machine at a specific time. */
export interface ScheduledOperation {
  sku: string;
  name: string;
  quantity: number;
  machine: string;
  workCenter: string;
  releaseDate: string;
  requiredDate: string;
  startDate: string;
  finishDate: string;
  /** Hours the job waited for the machine to free up (machine-busy queue). */
  queueHours: number;
  setupHours: number;
  runHours: number;
  changeoverHours: number;
  /** setup + changeover + run (machine-busy time for this operation). */
  durationHours: number;
  /** Finish falls after the required date. */
  late: boolean;
  /** The operation had to be pushed past the machine's maintenance window. */
  maintenanceConflict: boolean;
  onCriticalPath: boolean;
}

/** Per-machine load, utilization, and bottleneck state over the horizon. */
export interface MachineLoad {
  machine: string;
  workCenter: string;
  status: MachineStatus;
  /** The machine is in a working state (can accept work). */
  available: boolean;
  assignedOperations: number;
  loadHours: number;
  capacityHours: number;
  /** 0..100 (capped); reads 100 when overloaded. */
  utilization: number;
  idleHours: number;
  /** Assigned load exceeds finite capacity. */
  overloaded: boolean;
  /** Utilization ≥ threshold (or overloaded). */
  bottleneck: boolean;
  /** The authoritative Maintenance due date when it falls inside the horizon, else ''. */
  maintenanceWindow: string;
}

/** The finite-capacity schedule: operations loaded onto machines + what could not be placed. */
export interface CapacitySchedule {
  operations: ScheduledOperation[];
  machineLoads: MachineLoad[];
  /** Production planned orders with no available machine (no finite capacity). */
  unscheduled: PlannedOrder[];
  horizonDays: number;
}

/* ── deterministic operation timing ─────────────────────────────────────────── */

export interface OperationTimingInput {
  quantity: number;
  /** Operating-hour offset (from now) at which material/release is available (≥ 0). */
  releaseHour: number;
  /** Operating-hour offset (from now) at which the machine is next free. */
  machineFreeHour: number;
  /** The machine's last SKU differs from this one (a changeover is required). */
  changeover: boolean;
  /** Operating-hour offset of the machine's maintenance window start, or null. */
  maintenanceStartHour: number | null;
}

export interface OperationTiming {
  startHour: number;
  finishHour: number;
  queueHours: number;
  setupHours: number;
  runHours: number;
  changeoverHours: number;
  durationHours: number;
  maintenanceConflict: boolean;
}

/**
 * Deterministic timing for one operation on one machine. Duration = setup + changeover
 * (only on a SKU switch) + run (⌈qty / rate⌉). Start = max(machine-free, release); the
 * machine-busy wait becomes queue. If the operation would overlap the machine's maintenance
 * window, it is pushed to run AFTER the window (maintenance is authoritative). Pure.
 */
export function computeOperationTiming(inp: OperationTimingInput): OperationTiming {
  const setupHours = SETUP_HOURS;
  const changeoverHours = inp.changeover ? CHANGEOVER_HOURS : 0;
  const runHours = Math.max(1, Math.ceil(Math.max(0, inp.quantity) / MACHINE_RATE_PER_HOUR));
  const durationHours = setupHours + changeoverHours + runHours;

  let startHour = Math.max(inp.machineFreeHour, inp.releaseHour);
  const queueHours = Math.max(0, inp.machineFreeHour - inp.releaseHour);

  let maintenanceConflict = false;
  if (inp.maintenanceStartHour !== null) {
    const mStart = inp.maintenanceStartHour;
    const mEnd = mStart + MAINTENANCE_WINDOW_HOURS;
    const opEnd = startHour + durationHours;
    if (startHour < mEnd && opEnd > mStart) {
      maintenanceConflict = true;
      startHour = mEnd; // run the operation after the maintenance window
    }
  }

  return {
    startHour,
    finishHour: startHour + durationHours,
    queueHours,
    setupHours,
    runHours,
    changeoverHours,
    durationHours,
    maintenanceConflict,
  };
}

/* ── the finite-capacity schedule (forward loading onto real machines) ───────── */

interface MachineState {
  machine: Machine;
  available: boolean;
  freeHour: number;
  lastSku: string;
  maintenanceStartHour: number | null;
  capacityHours: number;
  ops: ScheduledOperation[];
}

/** Machine priority tiebreaker — the more reliable machine (higher availability) first. */
function machinePriority(m: Machine): number {
  return calculateMachineAvailability(m.runtime, m.downtime);
}

/** Operating-hour offset of a release/maintenance date, floored to the shift-day grid (≥ 0). */
function dateToOperatingHour(dateMs: number | null, nowMs: number): number | null {
  if (dateMs === null) return null;
  const dayOffset = Math.floor((dateMs - nowMs) / DAY_MS);
  return Math.max(0, dayOffset) * MACHINE_HOURS_PER_DAY;
}

/**
 * Build the finite-capacity schedule. Reuses `computeTimePhasedMrp` for the production
 * planned orders (net requirements, dates, critical path), then loads them onto the REAL
 * machines: available machines only (Manufacturing status), maintenance windows carved out
 * (Maintenance `maintenanceDue`). Deterministic dispatch + greedy earliest-finish assignment,
 * one forward pass, O(n·m). Pure — `nowMs` is injected.
 */
export function computeCapacitySchedule(input: PlanningInput, nowMs: number): CapacitySchedule {
  const plan = computeTimePhasedMrp(input, nowMs);
  const horizonDays = SCHEDULE_HORIZON_DAYS;
  const capacityPerMachine = MACHINE_HOURS_PER_DAY * horizonDays;
  const horizonHours = 24 * horizonDays;

  // Machine runtime state from the authoritative records (Manufacturing status + Maintenance due).
  const states: MachineState[] = input.machines.map((m) => {
    const available = (WORKING_MACHINE_STATUSES as readonly string[]).includes(m.status);
    const maintMs = parseDay(m.maintenanceDue);
    let maintenanceStartHour: number | null = null;
    if (maintMs !== null) {
      const rawHour = (maintMs - nowMs) / HOUR_MS;
      // Only windows that fall within the horizon (allow a just-passed window still blocking).
      if (rawHour >= -MAINTENANCE_WINDOW_HOURS && rawHour <= horizonHours) {
        maintenanceStartHour = dateToOperatingHour(maintMs, nowMs);
      }
    }
    const capacityHours = available
      ? Math.max(0, capacityPerMachine - (maintenanceStartHour !== null ? MAINTENANCE_WINDOW_HOURS : 0))
      : 0;
    return { machine: m, available, freeHour: 0, lastSku: '', maintenanceStartHour, capacityHours, ops: [] };
  });

  // Dispatch order: already-late first, then critical-path, then earliest due (EDD), then
  // largest quantity, then sku — a stable, fully deterministic priority.
  const productionJobs = plan.plannedOrders.filter((o) => o.type === 'production');
  const dispatch = [...productionJobs].sort(
    (a, b) =>
      Number(b.late) - Number(a.late) ||
      Number(b.onCriticalPath) - Number(a.onCriticalPath) ||
      (parseDay(a.requiredDate) ?? 0) - (parseDay(b.requiredDate) ?? 0) ||
      b.quantity - a.quantity ||
      a.sku.localeCompare(b.sku),
  );

  const availStates = states.filter((s) => s.available && s.capacityHours > 0);
  const operations: ScheduledOperation[] = [];
  const unscheduled: PlannedOrder[] = [];

  for (const job of dispatch) {
    if (availStates.length === 0) {
      unscheduled.push(job);
      continue;
    }
    const releaseHour = dateToOperatingHour(parseDay(job.releaseDate), nowMs) ?? 0;

    // Greedy: pick the machine that FINISHES this job earliest; tiebreak by machine priority
    // (reliability) then name. Linear scan over the (small) machine set.
    let best: { st: MachineState; timing: OperationTiming } | null = null;
    for (const st of availStates) {
      const timing = computeOperationTiming({
        quantity: job.quantity,
        releaseHour,
        machineFreeHour: st.freeHour,
        changeover: st.lastSku !== '' && st.lastSku !== job.sku,
        maintenanceStartHour: st.maintenanceStartHour,
      });
      if (best === null) {
        best = { st, timing };
        continue;
      }
      if (timing.finishHour < best.timing.finishHour) {
        best = { st, timing };
      } else if (timing.finishHour === best.timing.finishHour) {
        const cur = machinePriority(st.machine);
        const bst = machinePriority(best.st.machine);
        if (cur > bst || (cur === bst && st.machine.name.localeCompare(best.st.machine.name) < 0)) {
          best = { st, timing };
        }
      }
    }
    if (best === null) {
      unscheduled.push(job);
      continue;
    }

    const { st, timing } = best;
    const startDate = toISODate(nowMs + dayMsFromHour(timing.startHour, 'floor'));
    const finishMs = nowMs + dayMsFromHour(timing.finishHour, 'ceil');
    const finishDate = toISODate(finishMs);
    const requiredMs = parseDay(job.requiredDate);
    const late = requiredMs !== null ? finishMs > requiredMs : job.late;

    const op: ScheduledOperation = {
      sku: job.sku,
      name: job.name,
      quantity: job.quantity,
      machine: st.machine.name,
      workCenter: st.machine.workCenter,
      releaseDate: job.releaseDate,
      requiredDate: job.requiredDate,
      startDate,
      finishDate,
      queueHours: timing.queueHours,
      setupHours: timing.setupHours,
      runHours: timing.runHours,
      changeoverHours: timing.changeoverHours,
      durationHours: timing.durationHours,
      late,
      maintenanceConflict: timing.maintenanceConflict,
      onCriticalPath: job.onCriticalPath,
    };
    operations.push(op);
    st.ops.push(op);
    st.freeHour = timing.finishHour;
    st.lastSku = job.sku;
  }

  const machineLoads: MachineLoad[] = states.map((st) => {
    const loadHours = st.ops.reduce((s, o) => s + o.durationHours, 0);
    const capacityHours = st.capacityHours;
    const rawUtil = capacityHours > 0 ? (loadHours / capacityHours) * 100 : loadHours > 0 ? 100 : 0;
    const utilization = clamp(Math.round(rawUtil), 0, 100);
    const overloaded = capacityHours > 0 && loadHours > capacityHours;
    const bottleneck = st.available && (overloaded || utilization >= UTILIZATION_BOTTLENECK_THRESHOLD);
    return {
      machine: st.machine.name,
      workCenter: st.machine.workCenter,
      status: st.machine.status,
      available: st.available,
      assignedOperations: st.ops.length,
      loadHours: Math.round(loadHours),
      capacityHours: Math.round(capacityHours),
      utilization,
      idleHours: Math.round(Math.max(0, capacityHours - loadHours)),
      overloaded,
      bottleneck,
      maintenanceWindow: st.maintenanceStartHour !== null ? st.machine.maintenanceDue : '',
    };
  });

  return { operations, machineLoads, unscheduled, horizonDays };
}

/* ── aggregate insights (Executive Center) ─────────────────────────────────── */

export interface CapacityInsights {
  machineUtilization: number;
  capacityUsage: number;
  idleCapacity: number;
  productionQueue: number;
  maintenanceImpact: number;
  lateProductionRisk: number;
  scheduleAccuracy: number;
  workCenterHealth: number;
  manufacturingReadiness: number;
  overallCapacityScore: number;
}

/** Roll the finite-capacity schedule into the ten Executive capacity KPIs. Pure. */
export function deriveCapacityInsights(schedule: CapacitySchedule): CapacityInsights {
  const loads = schedule.machineLoads;
  const availLoads = loads.filter((l) => l.available && l.capacityHours > 0);
  const ops = schedule.operations;
  const totalProd = ops.length + schedule.unscheduled.length;

  const machineUtilization =
    availLoads.length === 0
      ? 0
      : clamp(Math.round(availLoads.reduce((s, l) => s + l.utilization, 0) / availLoads.length), 0, 100);

  const totalCap = availLoads.reduce((s, l) => s + l.capacityHours, 0);
  const totalLoad = availLoads.reduce((s, l) => s + l.loadHours, 0);
  const totalIdle = availLoads.reduce((s, l) => s + l.idleHours, 0);
  const capacityUsage = totalCap <= 0 ? (totalLoad > 0 ? 100 : 0) : clamp(Math.round((totalLoad / totalCap) * 100), 0, 100);
  const idleCapacity = totalCap <= 0 ? (totalProd > 0 ? 0 : 100) : clamp(Math.round((totalIdle / totalCap) * 100), 0, 100);
  const productionQueue = ops.filter((o) => o.queueHours > 0).length;

  const maintMachines = loads.filter((l) => l.available && l.maintenanceWindow !== '').length;
  const maintHours = maintMachines * MAINTENANCE_WINDOW_HOURS;
  const grossCap = totalCap + maintHours;
  const maintenanceImpact = grossCap <= 0 ? 0 : clamp(Math.round((maintHours / grossCap) * 100), 0, 100);

  const lateOrUnsched = ops.filter((o) => o.late).length + schedule.unscheduled.length;
  const lateProductionRisk = totalProd === 0 ? 0 : clamp(Math.round((lateOrUnsched / totalProd) * 100), 0, 100);
  const onTimeScheduled = ops.filter((o) => !o.late).length;
  const scheduleAccuracy = totalProd === 0 ? 100 : clamp(Math.round((onTimeScheduled / totalProd) * 100), 0, 100);
  const manufacturingReadiness = totalProd === 0 ? 100 : clamp(Math.round((ops.length / totalProd) * 100), 0, 100);

  // Work-center health — a work center is healthy when it has available capacity and its
  // aggregate load fits within it. No work center but open demand ⇒ zero (no capacity at all).
  const wcMap = new Map<string, { cap: number; load: number; hasAvail: boolean }>();
  for (const l of loads) {
    const key = l.workCenter || '(unassigned)';
    const e = wcMap.get(key) ?? { cap: 0, load: 0, hasAvail: false };
    if (l.available) {
      e.cap += l.capacityHours;
      e.load += l.loadHours;
      e.hasAvail = true;
    }
    wcMap.set(key, e);
  }
  const wcs = [...wcMap.values()];
  const workCenterHealth =
    wcs.length === 0
      ? totalProd > 0
        ? 0
        : 100
      : clamp(Math.round((wcs.filter((e) => e.hasAvail && e.load <= e.cap).length / wcs.length) * 100), 0, 100);

  const overallCapacityScore = clamp(
    Math.round(
      (scheduleAccuracy + workCenterHealth + manufacturingReadiness + (100 - lateProductionRisk) + (100 - maintenanceImpact)) / 5,
    ),
    0,
    100,
  );

  return {
    machineUtilization,
    capacityUsage,
    idleCapacity,
    productionQueue,
    maintenanceImpact,
    lateProductionRisk,
    scheduleAccuracy,
    workCenterHealth,
    manufacturingReadiness,
    overallCapacityScore,
  };
}

/** Map capacity insights to Executive Center KPI tiles (reuses the existing KPI type). */
export function capacityInsightsToKpis(insights: CapacityInsights): ExecutiveKpi[] {
  const pctBand = (v: number): ExecutiveKpi['band'] => (v >= 90 ? 'healthy' : v >= 75 ? 'watch' : 'at-risk');
  const usageBand = (v: number): ExecutiveKpi['band'] => (v >= 90 ? 'at-risk' : v >= 75 ? 'watch' : 'healthy');
  const riskBand = (v: number): ExecutiveKpi['band'] => (v <= 10 ? 'healthy' : v <= 25 ? 'watch' : 'at-risk');
  const idleBand = (v: number): ExecutiveKpi['band'] => (v <= 60 ? 'healthy' : v <= 80 ? 'watch' : 'at-risk');
  const queueBand: ExecutiveKpi['band'] =
    insights.productionQueue === 0 ? 'healthy' : insights.productionQueue <= 3 ? 'watch' : 'at-risk';
  return [
    { key: 'cap-machine-util', label: 'Machine Utilization', value: insights.machineUtilization, display: `${insights.machineUtilization}%`, band: usageBand(insights.machineUtilization), deepLink: 'enterprise/executive' },
    { key: 'cap-capacity-usage', label: 'Capacity Usage', value: insights.capacityUsage, display: `${insights.capacityUsage}%`, band: usageBand(insights.capacityUsage), deepLink: 'enterprise/executive' },
    { key: 'cap-idle', label: 'Idle Capacity', value: insights.idleCapacity, display: `${insights.idleCapacity}%`, band: idleBand(insights.idleCapacity), deepLink: 'enterprise/executive' },
    { key: 'cap-queue', label: 'Production Queue', value: insights.productionQueue, display: `${insights.productionQueue}`, band: queueBand, deepLink: 'enterprise/executive' },
    { key: 'cap-maint-impact', label: 'Maintenance Impact', value: insights.maintenanceImpact, display: `${insights.maintenanceImpact}%`, band: riskBand(insights.maintenanceImpact), deepLink: 'enterprise/executive' },
    { key: 'cap-late-risk', label: 'Late Production Risk', value: insights.lateProductionRisk, display: `${insights.lateProductionRisk}%`, band: riskBand(insights.lateProductionRisk), deepLink: 'enterprise/executive' },
    { key: 'cap-schedule-accuracy', label: 'Schedule Accuracy', value: insights.scheduleAccuracy, display: `${insights.scheduleAccuracy}%`, band: pctBand(insights.scheduleAccuracy), deepLink: 'enterprise/executive' },
    { key: 'cap-workcenter-health', label: 'Work Center Health', value: insights.workCenterHealth, display: `${insights.workCenterHealth}%`, band: pctBand(insights.workCenterHealth), deepLink: 'enterprise/executive' },
    { key: 'cap-mfg-ready', label: 'Manufacturing Readiness', value: insights.manufacturingReadiness, display: `${insights.manufacturingReadiness}%`, band: pctBand(insights.manufacturingReadiness), deepLink: 'enterprise/executive' },
    { key: 'cap-overall', label: 'Overall Capacity Score', value: insights.overallCapacityScore, display: `${insights.overallCapacityScore}`, band: pctBand(insights.overallCapacityScore), deepLink: 'enterprise/executive' },
  ];
}

/* ── recommendations (flow into the existing Executive recommendation system) ── */

function rank(priority: ExecRecoPriority, confidence: number): number {
  const base: Record<ExecRecoPriority, number> = { critical: 1000, high: 700, medium: 400, low: 100 };
  return Math.round(base[priority] + confidence * 100);
}

/**
 * Deterministic finite-capacity recommendations — machine-overloaded / move-to-machine /
 * second-shift / split-production / avoid-maintenance-window / reschedule-queue / delay-job /
 * capacity-available — read straight off the computed schedule. Each carries the arithmetic
 * (loads, capacities, idle hours, slack, maintenance dates) that produced it, and flows through
 * the EXISTING Executive recommendation + timeline system. The AI explains these scheduling
 * decisions; it never computes, schedules, or optimizes.
 */
export function capacityRecommendations(schedule: CapacitySchedule, limit = 15): ExecutiveRecommendation[] {
  const recs: ExecutiveRecommendation[] = [];
  const loads = schedule.machineLoads;
  const idleMachines = loads
    .filter((l) => l.available && l.capacityHours > 0 && l.idleHours > 0)
    .sort((a, b) => b.idleHours - a.idleHours);
  const lateOrUnschedCount = schedule.operations.filter((o) => o.late).length + schedule.unscheduled.length;

  // Machine Overloaded (+ Move To Machine B, else Run Second Shift).
  const overloaded = loads
    .filter((l) => l.overloaded)
    .sort((a, b) => b.loadHours - b.capacityHours - (a.loadHours - a.capacityHours));
  for (const l of overloaded) {
    const over = Math.max(1, l.loadHours - l.capacityHours);
    const priority: ExecRecoPriority = over >= MACHINE_HOURS_PER_DAY ? 'critical' : 'high';
    recs.push({
      id: `cap:overload:${l.machine}`,
      metric: 'capacity',
      icon: 'alert-triangle',
      problem: `Machine overloaded — ${l.machine} carries ${l.loadHours}h of work against ${l.capacityHours}h capacity (+${over}h over).`,
      businessImpact: 'An overloaded machine cannot clear its queue within the horizon; downstream orders slip.',
      rootCause: `Assigned work (${l.loadHours}h across ${l.assignedOperations} operation(s)) exceeds the ${schedule.horizonDays}-day capacity of ${l.capacityHours}h.`,
      priority,
      confidence: 0.95,
      expectedOutcome: `Removing ~${over}h of work brings ${l.machine} back within capacity.`,
      evidence: [`load=${l.loadHours}h`, `capacity=${l.capacityHours}h`, `over=+${over}h`, `utilization=${l.utilization}%`, `assigned=${l.assignedOperations}`],
      sourceSystems: ['planning', 'manufacturing', 'maintenance'],
      recommendedAction: `Off-load ~${over}h from ${l.machine}.`,
      owner: 'Production Planner',
      eta: priority === 'critical' ? 'today' : 'this week',
      status: 'open',
      score: rank(priority, 0.95),
    });

    const target = idleMachines.find((t) => t.machine !== l.machine);
    if (target) {
      const moveHours = Math.max(1, Math.min(over, target.idleHours));
      recs.push({
        id: `cap:move:${l.machine}->${target.machine}`,
        metric: 'capacity',
        icon: 'shuffle',
        problem: `Move production from ${l.machine} to ${target.machine} — ${target.machine} has ${target.idleHours}h idle while ${l.machine} is +${over}h over.`,
        businessImpact: 'Re-balancing load onto an idle machine recovers on-time completion without adding capacity.',
        rootCause: `${l.machine} at ${l.utilization}% utilization vs ${target.machine} at ${target.utilization}%.`,
        priority: 'high',
        confidence: 0.9,
        expectedOutcome: `Moving ~${moveHours}h of work to ${target.machine} relieves the ${l.machine} overload.`,
        evidence: [`from=${l.machine}(+${over}h)`, `to=${target.machine}(${target.idleHours}h idle)`, `move=${moveHours}h`],
        sourceSystems: ['planning', 'manufacturing'],
        recommendedAction: `Reassign ~${moveHours}h of production from ${l.machine} to ${target.machine}.`,
        owner: 'Production Planner',
        eta: 'this week',
        status: 'open',
        score: rank('high', 0.9),
      });
    } else {
      recs.push({
        id: `cap:second-shift:${l.machine}`,
        metric: 'capacity',
        icon: 'clock',
        problem: `Run a second shift on ${l.machine} — no idle machine can absorb the +${over}h overload.`,
        businessImpact: 'Adding a shift creates capacity when the load cannot be moved elsewhere.',
        rootCause: `Every other machine is busy or unavailable, and ${l.machine} is +${over}h beyond a single ${MACHINE_HOURS_PER_DAY}h/day shift.`,
        priority: 'high',
        confidence: 0.85,
        expectedOutcome: `A second ${SECOND_SHIFT_HOURS}h/day shift adds ${SECOND_SHIFT_HOURS * schedule.horizonDays}h over the ${schedule.horizonDays}-day horizon.`,
        evidence: [`over=+${over}h`, `shiftAdds=${SECOND_SHIFT_HOURS}h/day`, `horizon=${schedule.horizonDays}d`],
        sourceSystems: ['planning', 'manufacturing'],
        recommendedAction: `Authorize a second shift on ${l.machine}.`,
        owner: 'Production Planner',
        eta: 'this week',
        status: 'open',
        score: rank('high', 0.85),
      });
    }
  }

  // Split Production — a single operation too big for its machine's finite capacity.
  const capByMachine = new Map(loads.map((l) => [l.machine, l.capacityHours]));
  const hasAlternate = loads.filter((l) => l.available && l.capacityHours > 0).length >= 2;
  const bigOps = schedule.operations
    .filter((o) => hasAlternate && o.durationHours > (capByMachine.get(o.machine) ?? 0))
    .sort((a, b) => b.durationHours - a.durationHours)
    .slice(0, 3);
  for (const o of bigOps) {
    const cap = capByMachine.get(o.machine) ?? 0;
    recs.push({
      id: `cap:split:${o.sku}:${o.machine}`,
      metric: 'capacity',
      icon: 'scissors',
      problem: `Split production of ${o.name} (${o.sku}) — its ${o.durationHours}h run exceeds ${o.machine}'s ${cap}h capacity.`,
      businessImpact: 'A single order larger than one machine can build in the horizon stalls unless split.',
      rootCause: `Order duration ${o.durationHours}h for ${o.quantity} unit(s) > machine capacity ${cap}h.`,
      priority: 'medium',
      confidence: 0.85,
      expectedOutcome: 'Splitting the order across machines parallelizes it within the horizon.',
      evidence: [`duration=${o.durationHours}h`, `machineCap=${cap}h`, `qty=${o.quantity}`],
      sourceSystems: ['planning', 'manufacturing'],
      recommendedAction: `Split the production order for ${o.quantity} of ${o.sku} across multiple machines.`,
      owner: 'Production Planner',
      eta: 'this week',
      status: 'open',
      score: rank('medium', 0.85),
    });
  }

  // Avoid Maintenance Window — operations pushed past a machine's maintenance window.
  const conflictByMachine = new Map<string, ScheduledOperation[]>();
  for (const o of schedule.operations) {
    if (!o.maintenanceConflict) continue;
    const arr = conflictByMachine.get(o.machine) ?? [];
    arr.push(o);
    conflictByMachine.set(o.machine, arr);
  }
  for (const [machine, ops] of [...conflictByMachine.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    const due = loads.find((l) => l.machine === machine)?.maintenanceWindow ?? '';
    recs.push({
      id: `cap:maint:${machine}`,
      metric: 'maintenance',
      icon: 'tool',
      problem: `Avoid the maintenance window on ${machine} — ${ops.length} operation(s) collide with scheduled downtime${due ? ` (due ${due})` : ''}.`,
      businessImpact: 'Running into a maintenance window risks both the job and the asset; the schedule already defers these operations.',
      rootCause: `Maintenance is due ${due || 'within the horizon'} (authority: Maintenance); its ${MAINTENANCE_WINDOW_HOURS}h window blocks ${machine}.`,
      priority: 'medium',
      confidence: 0.9,
      expectedOutcome: 'Sequencing these operations clear of the window protects throughput and the preventive-maintenance plan.',
      evidence: [`machine=${machine}`, `maintenanceDue=${due}`, `window=${MAINTENANCE_WINDOW_HOURS}h`, `affected=${ops.length}`],
      sourceSystems: ['manufacturing', 'maintenance'],
      recommendedAction: `Reschedule ${ops.map((o) => o.sku).join(', ')} around ${machine}'s maintenance window.`,
      owner: 'Maintenance Planner',
      eta: 'this week',
      status: 'open',
      score: rank('medium', 0.9),
    });
  }

  // Reschedule Queue — a machine with multiple operations waiting on it.
  const queueByMachine = new Map<string, { ops: number; hours: number }>();
  for (const o of schedule.operations) {
    if (o.queueHours <= 0) continue;
    const e = queueByMachine.get(o.machine) ?? { ops: 0, hours: 0 };
    e.ops += 1;
    e.hours += o.queueHours;
    queueByMachine.set(o.machine, e);
  }
  for (const [machine, q] of [...queueByMachine.entries()].sort((a, b) => b[1].hours - a[1].hours)) {
    if (q.ops < QUEUE_OPS_THRESHOLD) continue;
    recs.push({
      id: `cap:queue:${machine}`,
      metric: 'capacity',
      icon: 'list',
      problem: `Resequence the queue on ${machine} — ${q.ops} operation(s) are waiting (${q.hours}h total queue).`,
      businessImpact: 'A deep machine queue delays whichever jobs sit behind lower-priority work.',
      rootCause: `${q.ops} operations wait on ${machine} for ${q.hours}h of cumulative queue time.`,
      priority: 'medium',
      confidence: 0.8,
      expectedOutcome: 'Ordering the queue critical-path- and earliest-due-first minimizes lateness.',
      evidence: [`queuedOps=${q.ops}`, `queueHours=${q.hours}h`, `machine=${machine}`],
      sourceSystems: ['planning', 'manufacturing'],
      recommendedAction: `Re-sequence ${machine}'s queue (critical-path and earliest-due first).`,
      owner: 'Production Planner',
      eta: 'this week',
      status: 'open',
      score: rank('medium', 0.8),
    });
  }

  // Delay Job N Hours — a non-critical, early job on a bottleneck machine, freeing it for urgent work.
  const delayCandidates = schedule.operations
    .filter((o) => {
      if (o.onCriticalPath || o.late) return false;
      const reqMs = parseDay(o.requiredDate);
      const finMs = parseDay(o.finishDate);
      if (reqMs === null || finMs === null) return false;
      const slackDays = Math.round((reqMs - finMs) / DAY_MS);
      const load = loads.find((l) => l.machine === o.machine);
      return slackDays >= DELAY_SLACK_DAYS && !!load?.bottleneck;
    })
    .sort((a, b) => (parseDay(b.requiredDate) ?? 0) - (parseDay(a.requiredDate) ?? 0))
    .slice(0, 3);
  for (const o of delayCandidates) {
    const reqMs = parseDay(o.requiredDate) ?? 0;
    const finMs = parseDay(o.finishDate) ?? 0;
    const slackDays = Math.round((reqMs - finMs) / DAY_MS);
    const delayHours = Math.max(1, Math.min(slackDays * MACHINE_HOURS_PER_DAY, MACHINE_HOURS_PER_DAY * 2));
    recs.push({
      id: `cap:delay:${o.sku}:${o.machine}`,
      metric: 'capacity',
      icon: 'clock',
      problem: `Delay ${o.name} (${o.sku}) by ~${delayHours}h on ${o.machine} — it has ${slackDays}d of slack while the machine is a bottleneck.`,
      businessImpact: 'Holding a job with slack frees a bottleneck machine for urgent or critical-path work now.',
      rootCause: `Finish ${o.finishDate} is ${slackDays}d before the ${o.requiredDate} due date on bottleneck machine ${o.machine}.`,
      priority: 'low',
      confidence: 0.8,
      expectedOutcome: `Deferring ~${delayHours}h opens ${o.machine} for higher-priority production without risking ${o.sku}'s due date.`,
      evidence: [`finish=${o.finishDate}`, `required=${o.requiredDate}`, `slack=${slackDays}d`, `delay=${delayHours}h`, `machine=${o.machine}`],
      sourceSystems: ['planning', 'manufacturing'],
      recommendedAction: `Delay ${o.sku} by ~${delayHours}h to free ${o.machine} for critical work.`,
      owner: 'Production Planner',
      eta: 'this week',
      status: 'open',
      score: rank('low', 0.8),
    });
  }

  // Capacity Available — an under-used machine while other work is late or unscheduled.
  if (lateOrUnschedCount > 0) {
    for (const t of idleMachines.filter((l) => l.utilization <= 50 && l.idleHours >= MACHINE_HOURS_PER_DAY).slice(0, 2)) {
      recs.push({
        id: `cap:available:${t.machine}`,
        metric: 'capacity',
        icon: 'check-circle',
        problem: `Capacity available on ${t.machine} — ${t.idleHours}h idle (${t.utilization}% utilized) while ${lateOrUnschedCount} operation(s) are late or unscheduled.`,
        businessImpact: 'Idle capacity next to late or unplaced work is recoverable throughput.',
        rootCause: `${t.machine} is only ${t.utilization}% utilized (${t.idleHours}h idle) over the ${schedule.horizonDays}-day horizon.`,
        priority: 'low',
        confidence: 0.8,
        expectedOutcome: `Routing late or unscheduled production to ${t.machine} uses its ${t.idleHours}h of free time.`,
        evidence: [`machine=${t.machine}`, `idle=${t.idleHours}h`, `utilization=${t.utilization}%`, `lateOrUnscheduled=${lateOrUnschedCount}`],
        sourceSystems: ['planning', 'manufacturing'],
        recommendedAction: `Route late or unscheduled production onto ${t.machine} (${t.idleHours}h free).`,
        owner: 'Production Planner',
        eta: 'this week',
        status: 'open',
        score: rank('low', 0.8),
      });
    }
  }

  return recs.sort((a, b) => b.score - a.score).slice(0, limit);
}
