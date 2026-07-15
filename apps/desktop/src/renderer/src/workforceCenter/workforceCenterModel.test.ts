/**
 * P8.6 — Workforce Center view-model tests. Covers virtualization windowing, search,
 * execution/approval derivations, health/utilization, install-action gating, worker-
 * detail assembly (built-in vs installed), and the delegation graph layout.
 */
import { describe, expect, it } from 'vitest';
import type {
  DelegationPlan,
  Job,
  Worker,
  WorkerInstallDetail,
  WorkerInstallSummary,
  WorkerSummary,
} from '@neuropause/shared';
import type { WorkforceIntelligence } from '../workforce/intelligenceTypes';
import {
  approvalQueue,
  assembleWorkerDetail,
  delegationLayout,
  executionHistory,
  healthRows,
  installActions,
  jobStatusCounts,
  searchWorkforce,
  windowRange,
} from './workforceCenterModel';

const NOW = '2026-07-15T00:00:00.000Z';

function summary(over: Partial<WorkerSummary> = {}): WorkerSummary {
  return {
    id: 'worker:ops',
    name: 'Ops AI',
    role: 'operations',
    version: '1.0.0',
    lifecycle: 'idle',
    healthState: 'healthy',
    trustScore: 0.7,
    skillCount: 2,
    builtIn: true,
    ...over,
  };
}

function job(over: Partial<Job> = {}): Job {
  return {
    id: 'j1',
    workerId: 'worker:ops',
    workerRole: 'operations',
    skillId: 's',
    status: 'succeeded',
    input: {},
    requestedBy: 'u',
    summary: null,
    evidence: [],
    proposals: [],
    logs: [],
    error: null,
    grounded: true,
    createdAt: NOW,
    startedAt: NOW,
    finishedAt: NOW,
    durationMs: 10,
    ...over,
  };
}

describe('windowRange', () => {
  it('returns an empty window for empty/degenerate input', () => {
    expect(windowRange(0, 0, 40, 0)).toEqual({ start: 0, end: 0, padTop: 0, padBottom: 0 });
    expect(windowRange(0, 400, 0, 100)).toEqual({ start: 0, end: 0, padTop: 0, padBottom: 0 });
  });

  it('windows the middle of a long list with overscan + correct padding', () => {
    const r = windowRange(4000, 400, 40, 1000, 5);
    // first visible ≈ 100; minus overscan 5 → 95
    expect(r.start).toBe(95);
    expect(r.padTop).toBe(95 * 40);
    expect(r.end).toBeLessThanOrEqual(1000);
    expect(r.padTop + (r.end - r.start) * 40 + r.padBottom).toBe(1000 * 40);
  });

  it('clamps to the list bounds at the top and bottom', () => {
    expect(windowRange(0, 400, 40, 10).start).toBe(0);
    const bottom = windowRange(100000, 400, 40, 10);
    expect(bottom.end).toBe(10);
    expect(bottom.padBottom).toBe(0);
  });
});

describe('searchWorkforce', () => {
  const workers = [summary({ id: 'worker:pkg-a', name: 'Alpha', role: 'infrastructure' }), summary({ id: 'worker:hr', name: 'People', role: 'hr' })];
  const installs: WorkerInstallSummary[] = [
    { id: 'worker:pkg-a', name: 'Alpha', version: '1.0.0', author: 'Acme', state: 'enabled', role: 'infrastructure', capabilities: ['kubernetes', 'restart'], permissions: [], canRollback: false, installedAt: NOW, updatedAt: NOW },
  ];
  it('returns all when the query is blank', () => {
    expect(searchWorkforce(workers, installs, '  ')).toHaveLength(2);
  });
  it('matches name, role, id, and installed capability', () => {
    expect(searchWorkforce(workers, installs, 'alpha').map((w) => w.id)).toEqual(['worker:pkg-a']);
    expect(searchWorkforce(workers, installs, 'hr').map((w) => w.id)).toEqual(['worker:hr']);
    expect(searchWorkforce(workers, installs, 'kubernetes').map((w) => w.id)).toEqual(['worker:pkg-a']);
  });
});

describe('execution + approvals', () => {
  it('counts every status zero-filled', () => {
    const counts = jobStatusCounts([job({ status: 'running' }), job({ status: 'running' }), job({ status: 'failed' })]);
    expect(counts.running).toBe(2);
    expect(counts.failed).toBe(1);
    expect(counts.succeeded).toBe(0);
  });

  it('filters by worker + status and sorts newest first', () => {
    const jobs = [
      job({ id: 'a', createdAt: '2026-07-15T00:00:01.000Z', status: 'failed', workerId: 'worker:ops' }),
      job({ id: 'b', createdAt: '2026-07-15T00:00:03.000Z', status: 'failed', workerId: 'worker:ops' }),
      job({ id: 'c', createdAt: '2026-07-15T00:00:02.000Z', status: 'succeeded', workerId: 'worker:x' }),
    ];
    const out = executionHistory(jobs, { workerId: 'worker:ops', status: 'failed' });
    expect(out.map((j) => j.id)).toEqual(['b', 'a']);
  });

  it('builds the approval queue from undecided require_approval proposals', () => {
    const j = job({
      proposals: [
        { id: 'p1', title: 'Stop', summary: '', sideEffects: true, risk: 'high', evidence: [], payload: {}, verdict: { decision: 'require_approval', checks: [], policies: [] } as never, approval: null },
        { id: 'p2', title: 'Note', summary: '', sideEffects: true, risk: 'low', evidence: [], payload: {}, verdict: { decision: 'require_approval', checks: [], policies: [] } as never, approval: { decision: 'approved', decidedBy: 'a', decidedAt: NOW, note: null } },
      ],
    });
    const q = approvalQueue([j]);
    expect(q).toHaveLength(1);
    expect(q[0].proposalId).toBe('p1');
  });
});

describe('healthRows', () => {
  const intel: WorkforceIntelligence = {
    totalJobs: 10,
    activeWorkers: 2,
    overallSuccessRate: 0.8,
    inFlight: 3,
    workers: [
      { workerId: 'worker:ops', workerRole: 'operations', total: 10, succeeded: 8, failed: 2, cancelled: 0, inFlight: 1, successRate: 0.8, avgDurationMs: 120, p50DurationMs: 100, ungroundedRate: 0, lastActiveAt: NOW },
      { workerId: 'worker:eng', workerRole: 'engineering', total: 4, succeeded: 4, failed: 0, cancelled: 0, inFlight: 2, successRate: 1, avgDurationMs: 50, p50DurationMs: 40, ungroundedRate: 0, lastActiveAt: NOW },
    ],
    execution: { bySkill: [], byRole: [], totals: {} as never },
    bottlenecks: [],
    busiestWorkerId: 'worker:eng',
  };
  it('derives failure rate and utilization as share of live in-flight load', () => {
    const rows = healthRows([summary({ id: 'worker:ops' }), summary({ id: 'worker:eng', role: 'engineering' })], intel);
    const ops = rows.find((r) => r.id === 'worker:ops')!;
    expect(ops.failureRate).toBeCloseTo(0.2, 5);
    expect(ops.avgLatencyMs).toBe(120);
    // total in-flight = 1 + 2 = 3; ops share = 1/3
    expect(ops.utilization).toBeCloseTo(1 / 3, 5);
  });
  it('is safe when a worker has no analytics', () => {
    const rows = healthRows([summary({ id: 'worker:new' })], intel);
    expect(rows[0].total).toBe(0);
    expect(rows[0].failureRate).toBe(0);
    expect(rows[0].utilization).toBeCloseTo(0, 5); // no in-flight for this worker
  });
});

describe('installActions', () => {
  const base: WorkerInstallSummary = { id: 'worker:pkg-a', name: 'A', version: '1.0.0', author: 'Acme', state: 'enabled', role: 'operations', capabilities: [], permissions: [], canRollback: false, installedAt: NOW, updatedAt: NOW };
  it('offers disable when enabled, enable when disabled, rollback only when available', () => {
    expect(installActions(base)).toMatchObject({ canDisable: true, canEnable: false, canRollback: false });
    expect(installActions({ ...base, state: 'disabled', canRollback: true })).toMatchObject({ canDisable: false, canEnable: true, canRollback: true });
  });
});

describe('assembleWorkerDetail', () => {
  function worker(over: Partial<Worker> = {}): Worker {
    return {
      identity: { id: 'worker:pkg-a', name: 'Alpha', role: 'infrastructure', version: '1.2.0', developer: 'NeuroPause' },
      goals: ['g'],
      skills: [
        { id: 'scan', title: 'Scan', description: '', sideEffects: false, requires: ['read:timeline'] },
        { id: 'stop', title: 'Stop', description: '', sideEffects: true, requires: ['execute:action'] },
      ],
      permissions: [
        { scope: 'read:timeline', granted: true },
        { scope: 'execute:action', granted: true },
      ],
      memoryScope: 'self',
      policyIds: [],
      trustScore: 0.6,
      lifecycle: 'idle',
      health: { state: 'healthy', lastCheckAt: NOW, successRate: 1, jobsRun: 0, jobsFailed: 0, message: null },
      createdAt: NOW,
      updatedAt: NOW,
      builtIn: false,
      metadata: { source: 'installed', author: 'Acme', version: '1.2.0', capabilities: ['ops'] },
      ...over,
    };
  }
  const detail: WorkerInstallDetail = {
    id: 'worker:pkg-a', name: 'Alpha', version: '1.2.0', author: 'Acme', state: 'enabled', role: 'infrastructure',
    capabilities: ['ops', 'restart'], permissions: ['read:timeline', 'execute:action'], canRollback: true, installedAt: NOW, updatedAt: NOW,
    description: 'd', memoryScope: 'self', goals: ['g'],
    skills: [{ kind: 'infra', id: 'stop', label: 'Stop', target: 'aws', actionId: 'aws_ec2_stop', required: ['instanceId'], refKey: 'instanceId' }],
    dependencies: ['worker:pkg-base'], engine: { neuropause: '^1.0.0' }, checksum: 'abc', signatureKeyId: 'wpkg_1', signed: true, previousVersion: '1.1.0',
  };

  it('merges install detail: publisher, verified signature, execution bindings, connector usage, deps', () => {
    const vm = assembleWorkerDetail(worker(), detail);
    expect(vm.publisher).toBe('Acme');
    expect(vm.signature).toBe('Signed · verified');
    expect(vm.executionBindings).toEqual([{ skillId: 'stop', executor: 'infra', target: 'aws', actionId: 'aws_ec2_stop' }]);
    expect(vm.connectorUsage).toEqual(['aws']);
    expect(vm.dependencies).toEqual(['worker:pkg-base']);
    expect(vm.permissions).toEqual(['read:timeline', 'execute:action']);
  });

  it('renders a built-in worker as first-party with no install detail', () => {
    const vm = assembleWorkerDetail(worker({ builtIn: true, identity: { id: 'worker:founder', name: 'Founder', role: 'founder', version: '1.0.0', developer: 'NeuroPause' }, metadata: {} }), null);
    expect(vm.signature).toBe('Built-in · first-party');
    expect(vm.publisher).toBe('NeuroPause');
    expect(vm.executionBindings).toEqual([]);
    expect(vm.dependencies).toEqual([]);
  });
});

describe('delegationLayout', () => {
  const plan: DelegationPlan = {
    goalId: 'g', goalTitle: 'Ship', generatedAt: NOW,
    assignments: [
      { taskId: 't1', taskTitle: 'Design', workerId: 'w1', workerName: 'W1', role: 'engineering', matchScore: 0.9, reasons: [], startOffset: 0, finishOffset: 1, onCriticalPath: true, dependsOn: [], wave: 0 },
      { taskId: 't2', taskTitle: 'Build', workerId: 'w2', workerName: 'W2', role: 'engineering', matchScore: 0.8, reasons: [], startOffset: 1, finishOffset: 2, onCriticalPath: true, dependsOn: ['t1'], wave: 1 },
      { taskId: 't3', taskTitle: 'Docs', workerId: null, workerName: null, role: null, matchScore: 0, reasons: [], startOffset: 1, finishOffset: 2, onCriticalPath: false, dependsOn: ['t1'], wave: 1 },
    ],
    waves: [['t1'], ['t2', 't3']],
    criticalPath: ['t1', 't2'],
    estimatedDuration: 2, totalTasks: 3, assignedTasks: 2, unassigned: ['t3'],
    load: [], confidence: 0.7, error: null, errorDetail: null,
  };

  it('lays tasks into wave columns with dependency edges and critical flags', () => {
    const layout = delegationLayout(plan);
    expect(layout.nodes).toHaveLength(3);
    const t1 = layout.nodes.find((n) => n.taskId === 't1')!;
    const t2 = layout.nodes.find((n) => n.taskId === 't2')!;
    expect(t2.x).toBeGreaterThan(t1.x); // later wave → further right
    expect(t1.onCriticalPath).toBe(true);
    expect(layout.nodes.find((n) => n.taskId === 't3')!.assigned).toBe(false);
    const critEdge = layout.edges.find((e) => e.from === 't1' && e.to === 't2')!;
    expect(critEdge.critical).toBe(true);
    const nonCrit = layout.edges.find((e) => e.from === 't1' && e.to === 't3')!;
    expect(nonCrit.critical).toBe(false);
    expect(layout.width).toBeGreaterThan(0);
    expect(layout.height).toBeGreaterThan(0);
  });
});
