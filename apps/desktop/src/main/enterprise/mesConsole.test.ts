import { describe, expect, it } from 'vitest';
import {
  buildExecutionConsoleModel,
  deriveMesSupplementalInsights,
  mesSupplementalKpis,
  type ManufacturingEvent,
  type ManufacturingEventType,
  type MesExecution,
} from '@neuropause/shared';

const BASE = '2026-07-08T00:00:00.000Z';
const NOW_MS = Date.parse('2026-07-08T01:00:00.000Z'); // one hour after BASE

function exec(p: Partial<MesExecution> = {}): MesExecution {
  return {
    id: `x-${p.executionNumber ?? 'EX'}`,
    executionNumber: 'EX-1',
    productionOrder: 'MO-1',
    schedule: 'SCH-MO-1-10',
    operation: 'Cutting',
    sequence: 10,
    workCenter: 'WC-CUT',
    machine: 'M1',
    operator: 'Op1',
    product: 'FG-1',
    warehouse: 'WH-1',
    bom: 'BOM-1',
    plannedQuantity: 10,
    firstOperation: false,
    finalOperation: false,
    status: 'running',
    blockedReason: '',
    startTime: '',
    endTime: '',
    setupMinutes: 0,
    runMinutes: 0,
    downtimeMinutes: 0,
    inspectionMinutes: 0,
    goodQuantity: 0,
    scrapQuantity: 0,
    scrapReason: '',
    inspectionRequired: false,
    inspectionResult: '',
    acceptedQuantity: 0,
    rejectedQuantity: 0,
    reworkQuantity: 0,
    qualityNotes: '',
    materialMovements: '',
    outputMovement: '',
    scrapMovement: '',
    createdAt: BASE,
    updatedAt: BASE,
    ...p,
  };
}

let seq = 0;
function evt(eventType: ManufacturingEventType, execution: string, timestamp: string, p: Partial<ManufacturingEvent> = {}): ManufacturingEvent {
  seq += 1;
  return {
    id: `e-${seq}`,
    sequence: seq,
    timestamp,
    eventType,
    productionOrder: 'MO-1',
    execution,
    operation: 'op',
    machine: 'M1',
    workCenter: 'WC',
    operator: 'Op1',
    quantity: 0,
    reason: '',
    metadata: '',
    user: 'tester@np.dev',
    createdAt: timestamp,
    ...p,
  };
}

describe('MES supplemental insights — Availability / Performance / Rework Rate', () => {
  it('computes each aggregate deterministically', () => {
    const executions = [
      exec({ executionNumber: 'E1', runMinutes: 80, downtimeMinutes: 20, plannedQuantity: 10, goodQuantity: 8, scrapQuantity: 2 }),
      exec({ executionNumber: 'E2', runMinutes: 40, downtimeMinutes: 0, plannedQuantity: 10, goodQuantity: 0 }),
      exec({ executionNumber: 'E3', runMinutes: 0, downtimeMinutes: 0, plannedQuantity: 5, goodQuantity: 4, reworkQuantity: 1 }),
    ];
    const s = deriveMesSupplementalInsights(executions);
    // availability = run 120 / (run 120 + downtime 20) = 86%; performance = produced 14 / planned 25 = 56%;
    // rework = 1 / (good 12 + scrap 2 + rework 1) = 7%.
    expect(s).toEqual({ availability: 86, performance: 56, reworkRate: 7 });
    expect(mesSupplementalKpis(executions).map((k) => k.key)).toEqual(['mes-availability', 'mes-performance', 'mes-rework']);
  });

  it('is safe on an empty floor', () => {
    expect(deriveMesSupplementalInsights([])).toEqual({ availability: 0, performance: 0, reworkRate: 0 });
  });
});

describe('Operator Console model — read-only projection over records + event ledger', () => {
  it('assembles KPIs, counts, executions, operators, machines, work orders, quality, timeline + narrative', () => {
    seq = 0;
    const executions = [
      exec({ executionNumber: 'EX1', productionOrder: 'MO-1', schedule: 'SCH-1', operation: 'Cut', sequence: 10, machine: 'M1', operator: 'Op1', firstOperation: true, status: 'running', plannedQuantity: 10, goodQuantity: 0 }),
      exec({ executionNumber: 'EX2', productionOrder: 'MO-1', schedule: 'SCH-2', operation: 'Assemble', sequence: 20, machine: 'M2', operator: 'Op2', finalOperation: true, status: 'completed', plannedQuantity: 10, goodQuantity: 8, scrapQuantity: 2, runMinutes: 30 }),
      exec({ executionNumber: 'EX3', productionOrder: 'MO-2', schedule: 'SCH-3', operation: 'Cut', sequence: 10, machine: 'M1', operator: '', status: 'blocked', blockedReason: 'material shortage', plannedQuantity: 5 }),
    ];
    const events = [
      evt('operation_started', 'EX1', BASE, { machine: 'M1', operator: 'Op1' }),
      evt('operation_started', 'EX2', BASE, { machine: 'M2', operator: 'Op2' }),
      evt('operation_completed', 'EX2', '2026-07-08T00:30:00.000Z', { machine: 'M2', operator: 'Op2' }),
      evt('finished_goods_posted', 'EX2', '2026-07-08T00:30:00.000Z', { machine: 'M2', operator: 'Op2', quantity: 8 }),
    ];

    const model = buildExecutionConsoleModel(executions, events, NOW_MS);

    // 12 core + 3 supplemental MES KPIs.
    expect(model.kpis).toHaveLength(15);
    expect(model.kpis.map((k) => k.key)).toEqual(expect.arrayContaining(['mes-progress', 'mes-oee', 'mes-availability', 'mes-performance', 'mes-rework']));

    // Counts.
    expect(model.counts).toMatchObject({ total: 3, running: 1, blocked: 1, completed: 1, queued: 0 });

    // Executions sorted with live work first (running, then blocked, then completed).
    expect(model.executions.map((e) => e.executionNumber)).toEqual(['EX1', 'EX3', 'EX2']);
    const ex1 = model.executions.find((e) => e.executionNumber === 'EX1')!;
    expect(ex1).toMatchObject({ progress: 0, remainingQuantity: 10, live: true });
    expect(ex1.elapsedMinutes).toBe(60); // started at BASE, still running at NOW (+60m)
    const ex2 = model.executions.find((e) => e.executionNumber === 'EX2')!;
    expect(ex2).toMatchObject({ progress: 80, remainingQuantity: 0, live: false });
    expect(ex2.elapsedMinutes).toBe(30); // started BASE → completed BASE+30m

    // Operators + machines are unioned from the ledger timelines and the records.
    expect(model.operators.map((o) => o.operator).sort()).toEqual(['Op1', 'Op2']);
    expect(model.machines.map((m) => m.machine).sort()).toEqual(['M1', 'M2']);

    // Work-order rollup.
    const mo1 = model.workOrders.find((w) => w.productionOrder === 'MO-1')!;
    expect(mo1).toMatchObject({ totalOperations: 2, completedOperations: 1, progress: 50 });
    const mo2 = model.workOrders.find((w) => w.productionOrder === 'MO-2')!;
    expect(mo2).toMatchObject({ totalOperations: 1, blockedOperations: 1, status: 'blocked' });

    // Quality queue surfaces the scrapped operation only.
    expect(model.quality.map((q) => q.executionNumber)).toEqual(['EX2']);

    // Timeline is the ledger, most-recent first.
    expect(model.timeline).toHaveLength(4);
    expect(model.eventCount).toBe(4);
    expect(model.timeline[0].label).toBe('Finished goods posted');

    // Deterministic narrative — grounded, mentions the real counts.
    expect(model.narrative.grounded).toBe(true);
    expect(model.narrative.productionSummary).toContain('3 operation(s)');
  });

  it('reports an empty, grounded model when there is nothing on the floor', () => {
    const model = buildExecutionConsoleModel([], [], NOW_MS);
    expect(model.counts.total).toBe(0);
    expect(model.executions).toHaveLength(0);
    expect(model.kpis).toHaveLength(15);
    expect(model.narrative.grounded).toBe(true);
  });
});
