import { describe, expect, it } from 'vitest';
import {
  deriveEventInsights,
  deriveEventOee,
  deriveExecutionTelemetry,
  deriveMachineTimeline,
  deriveOperatorTimeline,
  eventInsightsToKpis,
  eventRecommendations,
  type ManufacturingEvent,
  type ManufacturingEventType,
} from '@neuropause/shared';

const BASE = Date.parse('2026-07-08T08:00:00.000Z');
const at = (mins: number): string => new Date(BASE + mins * 60000).toISOString();

let seq = 0;
function ev(eventType: ManufacturingEventType, mins: number, p: Partial<ManufacturingEvent> = {}): ManufacturingEvent {
  seq += 1;
  const timestamp = at(mins);
  return {
    id: `e${seq}`,
    sequence: p.sequence ?? seq,
    timestamp,
    eventType,
    productionOrder: 'MO-1',
    execution: 'EX-1',
    operation: 'Cut',
    machine: 'M1',
    workCenter: 'WC-1',
    operator: 'O1',
    quantity: 0,
    reason: '',
    metadata: '',
    user: 'u',
    createdAt: timestamp,
    ...p,
  };
}

/** One full execution: released→started→paused→resumed→downtime→resumed→inspection→pass→completed. */
function fullExecution(): ManufacturingEvent[] {
  seq = 0;
  return [
    ev('operation_released', 0),
    ev('operation_started', 10),
    ev('operation_paused', 40), // run [10,40] = 30
    ev('operation_resumed', 50), // pause [40,50] = 10
    ev('downtime_started', 80), // run [50,80] = 30 (run 60)
    ev('downtime_ended', 95), // downtime [80,95] = 15
    ev('inspection_started', 105), // run [95,105] = 10 (run 70)
    ev('inspection_passed', 115), // inspection [105,115] = 10
    ev('operation_completed', 130), // run [115,130] = 15 (run 85)
    ev('finished_goods_posted', 130, { quantity: 9 }),
    ev('scrap_recorded', 131, { quantity: 1 }),
  ];
}

describe('event-sourced execution telemetry (derived, not entered)', () => {
  it('reduces the event stream to deterministic time buckets', () => {
    const [t] = deriveExecutionTelemetry(fullExecution());
    expect(t).toMatchObject({
      execution: 'EX-1',
      runTime: 85, // 30 + 30 + 10 + 15
      pauseTime: 10,
      downtime: 15,
      inspectionTime: 10,
      blockedTime: 0,
      idleTime: 35, // pause 10 + downtime 15 + released 10
      cycleTime: 120, // completed 130 − started 10
      good: 9,
      scrap: 1,
      failures: 0,
      state: 'completed',
      completed: true,
    });
  });
});

describe('event-derived OEE (never entered)', () => {
  it('computes availability / performance / quality / OEE + utilizations from events', () => {
    const oee = deriveEventOee(fullExecution(), BASE + 140 * 60000);
    expect(oee).toMatchObject({
      availability: 85, // run 85 / (run 85 + downtime 15)
      performance: 81, // run 85 / (run 85 + pause 10 + inspection 10)
      quality: 90, // good 9 / (good 9 + scrap 1)
      oee: 62, // 0.85 × 0.81 × 0.90
      machineUtilization: 85,
      operatorUtilization: 65, // run 85 / (run 85 + idle 35 + inspection 10)
    });
  });
});

describe('live machine + operator timelines', () => {
  const now = BASE + 60 * 60000;
  function scenario(): ManufacturingEvent[] {
    seq = 0;
    return [
      ev('operation_released', 0, { execution: 'EX-A', machine: 'M-RUN', operator: 'O1' }),
      ev('operation_started', 10, { execution: 'EX-A', machine: 'M-RUN', operator: 'O1' }),
      ev('operation_released', 0, { execution: 'EX-B', machine: 'M-IDLE', operator: '' }),
      ev('operation_released', 0, { execution: 'EX-C', machine: 'M-NOOP', operator: '' }),
      ev('operation_started', 10, { execution: 'EX-C', machine: 'M-NOOP', operator: '' }),
    ];
  }

  it('derives current state, running job, queue and today runtime per machine', () => {
    const machines = deriveMachineTimeline(scenario(), now);
    const idle = machines.find((m) => m.machine === 'M-IDLE');
    const run = machines.find((m) => m.machine === 'M-RUN');
    expect(idle).toMatchObject({ currentState: 'idle', runningJob: '', queueLength: 1 });
    expect(run).toMatchObject({ currentState: 'running', currentOperator: 'O1', runningJob: 'EX-A', todaysRuntime: 50, todaysUtilization: 100 });
  });

  it('derives operator workload and current assignment', () => {
    const operators = deriveOperatorTimeline(scenario(), now);
    const o1 = operators.find((o) => o.operator === 'O1');
    expect(o1).toMatchObject({ workload: 1, currentAssignment: 'EX-A', currentMachine: 'M-RUN', completedOperations: 0 });
    expect(o1!.utilization).toBeGreaterThan(0); // running segment counted live
  });

  it('flags machine idle-with-queue and running-without-operator', () => {
    const recs = eventRecommendations(scenario(), now);
    expect(recs.some((r) => r.id === 'evt:idle:M-IDLE')).toBe(true);
    expect(recs.some((r) => r.id === 'evt:no-operator:M-NOOP')).toBe(true);
    expect(recs.every((r) => r.evidence.length > 0 && r.confidence > 0)).toBe(true);
  });
});

describe('executive event KPIs + recommendations', () => {
  it('rolls the ledger into the ten telemetry KPIs', () => {
    const insights = deriveEventInsights(fullExecution(), BASE + 140 * 60000);
    expect(insights.eventThroughput).toBe(11);
    expect(insights.qualityTrend).toBe(90);
    expect(insights.scheduleAdherence).toBe(100); // 1 started, 1 completed
    expect(eventInsightsToKpis(insights).map((k) => k.key)).toEqual([
      'evt-live-production',
      'evt-machine-health',
      'evt-operator-efficiency',
      'evt-execution-stability',
      'evt-schedule-adherence',
      'evt-downtime-trend',
      'evt-quality-trend',
      'evt-event-throughput',
      'evt-manufacturing-confidence',
      'evt-completion-forecast',
    ]);
  });

  it('detects repeated inspection failures deterministically', () => {
    seq = 0;
    const events = [
      ev('operation_started', 10, { execution: 'EX-F' }),
      ev('inspection_started', 20, { execution: 'EX-F' }),
      ev('inspection_failed', 30, { execution: 'EX-F' }),
      ev('operation_resumed', 35, { execution: 'EX-F' }),
      ev('inspection_started', 40, { execution: 'EX-F' }),
      ev('inspection_failed', 50, { execution: 'EX-F' }),
    ];
    const recs = eventRecommendations(events, BASE + 60 * 60000);
    expect(recs.some((r) => r.id === 'evt:failures:EX-F')).toBe(true);
  });
});
