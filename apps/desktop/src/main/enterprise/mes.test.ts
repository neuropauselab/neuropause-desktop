import { describe, expect, it } from 'vitest';
import {
  calculateCycleTime,
  calculateExecutionAvailability,
  calculateExecutionOee,
  calculateExecutionPerformance,
  calculateExecutionUtilization,
  calculateFirstPassYield,
  deriveMesInsights,
  mesInsightsToKpis,
  mesRecommendations,
  type MesExecution,
} from '@neuropause/shared';

function exec(p: Partial<MesExecution> = {}): MesExecution {
  return {
    id: `x-${p.executionNumber ?? 'EX'}`,
    executionNumber: 'EX-1',
    productionOrder: 'MO-1',
    schedule: 'SCH-MO-1-10',
    operation: 'Cutting',
    sequence: 10,
    workCenter: 'WC-CUT',
    machine: 'CNC-1',
    operator: 'Op1',
    product: 'FG-1',
    warehouse: 'WH-1',
    bom: 'BOM-1',
    plannedQuantity: 10,
    firstOperation: true,
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
    createdAt: '',
    updatedAt: '',
    ...p,
  };
}

describe('deterministic execution metrics (reuse the manufacturing math)', () => {
  it('cycle / availability / performance / FPY / OEE / utilization', () => {
    expect(calculateCycleTime(exec({ setupMinutes: 5, runMinutes: 50, downtimeMinutes: 10, inspectionMinutes: 5 }))).toBe(70);
    expect(calculateExecutionAvailability(exec({ runMinutes: 80, downtimeMinutes: 20 }))).toBe(80);
    expect(calculateExecutionPerformance(exec({ plannedQuantity: 10, goodQuantity: 8, scrapQuantity: 1 }))).toBe(90);
    expect(calculateFirstPassYield(9, 1)).toBe(90);
    expect(calculateExecutionOee(exec({ runMinutes: 80, downtimeMinutes: 20, plannedQuantity: 10, goodQuantity: 9, scrapQuantity: 1 }))).toBe(72);
    expect(calculateExecutionUtilization(exec({ setupMinutes: 0, runMinutes: 50, downtimeMinutes: 10, inspectionMinutes: 0 }))).toBe(83);
  });
});

describe('deriveMesInsights + KPIs', () => {
  it('rolls execution records into the twelve execution KPIs', () => {
    const executions = [
      exec({ executionNumber: 'E1', status: 'completed', productionOrder: 'O1', sequence: 10, machine: 'M1', plannedQuantity: 10, goodQuantity: 8, scrapQuantity: 2, runMinutes: 80, downtimeMinutes: 20 }),
      exec({ executionNumber: 'E2', status: 'running', productionOrder: 'O1', sequence: 20, machine: 'M1', plannedQuantity: 10, runMinutes: 40 }),
      exec({ executionNumber: 'E3', status: 'blocked', blockedReason: 'material shortage', productionOrder: 'O2', sequence: 10, machine: 'M2', plannedQuantity: 5 }),
    ];
    const insights = deriveMesInsights(executions);
    expect(insights).toMatchObject({
      productionProgress: 33,
      scheduleAdherence: 67,
      machineUtilization: 90,
      oee: 64,
      qualityYield: 80,
      scrapRate: 20,
      downtimeImpact: 14,
      blockedOperations: 1,
      productionRisk: 22,
      executionHealth: 78,
      manufacturingReadiness: 67,
      completionForecast: 50,
    });
    expect(mesInsightsToKpis(insights).map((k) => k.key)).toEqual([
      'mes-progress',
      'mes-health',
      'mes-adherence',
      'mes-utilization',
      'mes-oee',
      'mes-quality',
      'mes-scrap',
      'mes-downtime',
      'mes-blocked',
      'mes-risk',
      'mes-readiness',
      'mes-forecast',
    ]);
  });

  it('reports full progress and no risk when there are no executions', () => {
    const insights = deriveMesInsights([]);
    expect(insights).toMatchObject({ productionProgress: 100, blockedOperations: 0, productionRisk: 0, manufacturingReadiness: 100 });
  });
});

describe('execution recommendations — deterministic + evidence-backed', () => {
  it('surfaces material shortage, high scrap and out-of-sequence routing violations', () => {
    const executions = [
      exec({ executionNumber: 'EX-M', status: 'blocked', blockedReason: 'material shortage', productionOrder: 'OM', sequence: 10 }),
      exec({ executionNumber: 'EX-V1', status: 'running', productionOrder: 'OV', sequence: 10, operator: 'Op' }),
      exec({ executionNumber: 'EX-V2', status: 'completed', productionOrder: 'OV', sequence: 20, operator: 'Op', goodQuantity: 10 }),
      exec({ executionNumber: 'EX-S', status: 'completed', productionOrder: 'OS', sequence: 10, operator: 'Op', goodQuantity: 8, scrapQuantity: 2 }),
    ];
    const recs = mesRecommendations(executions);
    const ids = recs.map((r) => r.id);
    expect(ids).toContain('mes:material:EX-M'); // blocked on material
    expect(ids).toContain('mes:routing:OV'); // op 20 completed while op 10 still running
    expect(ids).toContain('mes:scrap:EX-S'); // 20% scrap rate
    expect(recs.every((r) => r.evidence.length > 0 && r.confidence > 0)).toBe(true);
  });

  it('flags dispatch delay and operator-unavailable', () => {
    const recs = mesRecommendations([
      exec({ executionNumber: 'EX-D', status: 'dispatched', operator: '' }),
    ]);
    expect(recs.some((r) => r.id === 'mes:dispatch-delayed')).toBe(true);
    expect(recs.some((r) => r.id === 'mes:operator:EX-D')).toBe(true);
  });
});
