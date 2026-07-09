import { describe, expect, it } from 'vitest';
import {
  buildScheduleExploreModel,
  buildScheduleGanttModel,
  buildScheduleProposalFields,
  collectScheduleViolations,
  deriveSchedulingInsights,
  parseRoutingOperations,
  scheduleProductionOrderRouting,
  scheduleProposalFromRecord,
  scheduleProposalTransition,
  scheduleRecordFieldsFromOperations,
  schedulingInsightsToKpis,
  serializeRoutingOperations,
  summarizeSchedule,
  type EnterpriseEntity,
  type Machine,
  type MachineLoad,
  type ProductionSchedulePlan,
  type Routing,
  type RoutingSchedule,
  type ScheduledRoutingOperation,
} from '@neuropause/shared';

/* ── routing-engine extension: changeover honored, optional fields tolerated ─────── */

describe('routing engine extension — changeover + optional fields (backward-compatible)', () => {
  it('charges changeover like setup in the scheduled operation timing', () => {
    const routing: Routing = {
      id: 'r', routingNumber: 'ROUTE-CO', product: 'FG-1', status: 'active', notes: '',
      operations: [{ sequence: 10, operation: 'Cut', workCenter: 'WC', eligibleMachines: ['CNC-1'], setupTime: 2, runTimePerUnit: 0, queueTime: 0, inspectionTime: 0, transferTime: 0, changeoverTime: 3 }],
    };
    const machines: Machine[] = [{ id: 'm', name: 'CNC-1', code: 'MC', workCenter: 'WC', runtime: 100, downtime: 0, maintenanceDue: '', status: 'running' }];
    const plan = scheduleProductionOrderRouting({ ref: 'MO', product: 'FG-1', quantity: 0, releaseDate: '', requiredDate: '', onCriticalPath: false }, routing, machines, Date.parse('2026-07-01T00:00:00.000Z'));
    const op = plan.operations[0];
    expect(op.changeoverHours).toBe(3);
    expect(op.setupHours).toBe(2);
    expect(op.durationHours).toBe(5); // queue 0 + (setup 2 + changeover 3 + run 0 + inspection 0)
  });

  it('parses the optional fields when present and omits them from serialization when absent', () => {
    const withFields = parseRoutingOperations(JSON.stringify([
      { sequence: 10, operation: 'Cut', workCenter: 'WC', changeoverTime: 2, dependsOn: [5], alternativeWorkCenters: ['WC-2'], priority: 1 },
    ]));
    expect(withFields[0]).toMatchObject({ changeoverTime: 2, dependsOn: [5], alternativeWorkCenters: ['WC-2'], priority: 1 });
    const plain = parseRoutingOperations(JSON.stringify([{ sequence: 10, operation: 'Cut', workCenter: 'WC', setupTime: 1 }]));
    expect(plain[0].changeoverTime).toBeUndefined();
    // A plain operation serializes without the optional keys (no on-disk change for existing routings).
    expect(serializeRoutingOperations(plain)).not.toContain('changeoverTime');
  });
});

/* ── deterministic fixtures for the KPI / gantt / violation / narrative layer ─────── */

function op(over: Partial<ScheduledRoutingOperation> = {}): ScheduledRoutingOperation {
  return {
    sequence: 10, operation: 'Cutting', workCenter: 'WC', machine: 'CNC-1', eligibleMachineCount: 1, qualifiedMachineCount: 1,
    setupHours: 2, changeoverHours: 1, runHours: 4, inspectionHours: 1, queueHours: 2, transferHours: 1, durationHours: 10,
    startDate: '2026-07-01', finishDate: '2026-07-02', startHour: 0, finishHour: 8, scheduled: true, blockedReason: '', maintenanceConflict: false, onBottleneck: false, ...over,
  };
}
function plan(over: Partial<ProductionSchedulePlan> = {}): ProductionSchedulePlan {
  return { scheduleId: 'RSCH-MO-1', productionOrder: 'MO-1', product: 'FG-1', routingNumber: 'ROUTE-1', operations: [op()], plannedStart: '2026-07-01', plannedFinish: '2026-07-02', status: 'planned', onCriticalPath: false, late: false, ...over };
}
function load(over: Partial<MachineLoad> = {}): MachineLoad {
  return { machine: 'CNC-1', workCenter: 'WC', status: 'running', available: true, assignedOperations: 1, loadHours: 7, capacityHours: 10, utilization: 70, idleHours: 3, overloaded: false, bottleneck: false, maintenanceWindow: '', ...over };
}
const schedule: RoutingSchedule = { schedules: [plan()], machineLoads: [load()], horizonDays: 30 };

describe('the eight scheduling KPIs', () => {
  it('computes each KPI deterministically from the mined schedule', () => {
    const insights = deriveSchedulingInsights(schedule);
    expect(insights).toMatchObject({
      scheduleUtilization: 70, // load 7 / capacity 10
      machineUtilization: 70,
      averageQueueHours: 2,
      averageSetupHours: 3, // setup 2 + changeover 1
      scheduleEfficiency: 40, // run 4 / duration 10
      lateOperations: 0,
      idleCapacity: 30,
      routingViolations: 0,
    });
    expect(schedulingInsightsToKpis(insights).map((k) => k.key)).toEqual([
      'sch-schedule-util', 'sch-machine-util', 'sch-avg-queue', 'sch-avg-setup', 'sch-efficiency', 'sch-late-ops', 'sch-idle-capacity', 'sch-routing-violations',
    ]);
  });

  it('counts late operations and routing violations from real flags', () => {
    const blocked = op({ sequence: 20, operation: 'Assembly', scheduled: false, machine: '', blockedReason: 'All qualified machines unavailable.' });
    const s: RoutingSchedule = {
      schedules: [plan({ late: true, operations: [op(), blocked] }), { ...plan({ productionOrder: 'MO-2' }), status: 'unrouted', operations: [] }],
      machineLoads: [load()], horizonDays: 30,
    };
    const insights = deriveSchedulingInsights(s);
    expect(insights.lateOperations).toBe(1); // one scheduled op in the late plan
    expect(insights.routingViolations).toBe(2); // one blocked op + one unrouted order
  });
});

describe('Machine-Gantt model + violations', () => {
  it('builds machine lanes + time-scaled bars from the schedule', () => {
    const g = buildScheduleGanttModel(schedule);
    expect(g.lanes).toHaveLength(1);
    expect(g.lanes[0]).toMatchObject({ machine: 'CNC-1', utilization: 70, available: true });
    expect(g.bars).toHaveLength(1);
    expect(g.bars[0]).toMatchObject({ machine: 'CNC-1', order: 'MO-1', operation: 'Cutting', startHour: 0, finishHour: 8 });
    expect(g.maxHour).toBe(8);
  });
  it('lists routing violations with their real reasons', () => {
    const s: RoutingSchedule = { schedules: [plan({ operations: [op({ scheduled: false, machine: '', blockedReason: 'No qualified machine.' })] })], machineLoads: [load()], horizonDays: 30 };
    const v = collectScheduleViolations(s);
    expect(v).toHaveLength(1);
    expect(v[0]).toMatchObject({ order: 'MO-1', operation: 'Cutting', reason: 'No qualified machine.' });
  });
});

describe('schedule-proposal lifecycle + record mapping', () => {
  it('allows only the legal transitions', () => {
    expect(scheduleProposalTransition('approve', 'proposed')).toBe('approved');
    expect(scheduleProposalTransition('reject', 'proposed')).toBe('rejected');
    expect(scheduleProposalTransition('commit', 'approved')).toBe('committed');
    expect(scheduleProposalTransition('recalculate', 'approved')).toBe('superseded');
    expect(scheduleProposalTransition('commit', 'proposed')).toBeNull(); // must be approved first
    expect(scheduleProposalTransition('approve', 'committed')).toBeNull();
    expect(scheduleProposalTransition('recalculate', 'committed')).toBeNull();
  });

  it('maps a plan into proposal fields and back', () => {
    const fields = buildScheduleProposalFields(plan(), 'MO-1', 2, 'planner@np.dev', '2026-07-08T00:00:00.000Z');
    expect(fields).toMatchObject({ proposalNumber: 'SPROP-MO-1-v2', productionOrder: 'MO-1', version: 2, status: 'proposed', scheduledOps: 1, blockedOps: 0 });
    const record: EnterpriseEntity = {
      id: 'p1', moduleId: 'manufacturing-schedule-proposals', kind: 'schedule-proposal', title: String(fields.proposalNumber), status: 'active',
      fields, tags: [], rev: 1, createdAt: '2026-07-08T00:00:00.000Z', updatedAt: '2026-07-08T00:00:00.000Z', createdBy: null, updatedBy: null, metadata: {},
    };
    const p = scheduleProposalFromRecord(record);
    expect(p).toMatchObject({ proposalNumber: 'SPROP-MO-1-v2', version: 2, status: 'proposed', scheduledOps: 1 });
    expect(p.operations).toHaveLength(1); // the captured read-only plan
  });

  it('builds commit field-sets from the approved plan operations', () => {
    const fieldSets = scheduleRecordFieldsFromOperations([op(), op({ sequence: 20, scheduled: false, machine: '' })], 'MO-1');
    expect(fieldSets).toHaveLength(1); // only the scheduled op with a machine
    expect(fieldSets[0]).toMatchObject({ scheduleNumber: 'SCH-MO-1-10', productionOrder: 'MO-1', machine: 'CNC-1', status: 'scheduled' });
  });
});

describe('narrative + explore model', () => {
  it('produces a grounded deterministic narrative', () => {
    const n = summarizeSchedule(schedule, deriveSchedulingInsights(schedule));
    expect(n.grounded).toBe(true);
    expect(n.summary).toContain('1 production order');
    expect(n.routingExplanation).toContain('eligible machine');
  });
  it('assembles the read-only explore model', () => {
    const model = buildScheduleExploreModel(schedule, [], [{ id: 'o1', orderNumber: 'MO-1', product: 'FG-1', quantity: 10, hasRouting: true, committed: false }], 1_700_000_000_000);
    expect(model.kpis).toHaveLength(8);
    expect(model.gantt.bars).toHaveLength(1);
    expect(model.orders).toHaveLength(1);
    expect(model.narrative.grounded).toBe(true);
  });
});
