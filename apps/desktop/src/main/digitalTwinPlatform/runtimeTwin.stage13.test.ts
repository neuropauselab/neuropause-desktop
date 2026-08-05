/**
 * Phase 6 Stage 13 — the runtime & execution twin (G-1).
 *
 * The gap P15 never covered. These tests lock the three things that make this a
 * composition rather than a second execution system: statistics and supervisor
 * status are carried through VERBATIM, the only derived values (per-kind counts,
 * row projections) are derived from what was actually observed rather than from
 * what was registered, and an unreadable engine produces `null` rather than a
 * zeroed-out fake that reads like a healthy idle system.
 *
 * Everything here is deterministic: fixtures are literals, no clock is read.
 */
import { describe, expect, it } from 'vitest';
import type {
  ExecutionKind,
  ExecutionSession,
  ExecutionState,
  ExecutionStats,
  RecoveryPolicy,
  RecoveryRecord,
  SupervisedSubsystem,
  SupervisorStatus,
} from '@neuropause/shared';
import { buildRuntimeTwin, RUNTIME_TWIN_DISCLOSURE, type RuntimeTwinInput } from './runtimeTwin';

const NOW = '2026-08-01T09:00:00.000Z';

function mkSession(over: Partial<ExecutionSession> & { id: string; kind: ExecutionKind }): ExecutionSession {
  return {
    label: `session ${over.id}`,
    state: 'completed' as ExecutionState,
    steps: [],
    currentStep: -1,
    startedAt: '2026-07-31T12:00:00.000Z',
    completedAt: '2026-07-31T12:00:05.000Z',
    durationMs: 5_000,
    error: null,
    resultSummary: null,
    result: null,
    ...over,
  };
}

function mkRecord(over: Partial<RecoveryRecord> & { id: string; subsystem: SupervisedSubsystem }): RecoveryRecord {
  return {
    reason: 'unhealthy',
    startedAt: '2026-07-31T12:00:00.000Z',
    durationMs: 120,
    ok: true,
    detail: null,
    ...over,
  };
}

const STATS: ExecutionStats = {
  active: 1,
  queued: 2,
  completed: 3,
  failed: 4,
  cancelled: 5,
  successRate: 0.42,
  averageRuntimeMs: 1_234,
};

const ALL_POLICIES: Record<SupervisedSubsystem, RecoveryPolicy> = {
  runtime: 'automatic',
  platform: 'manual',
  automation: 'automatic',
  voice: 'disabled',
  backend: 'automatic',
};

function mkStatus(over: Partial<SupervisorStatus> = {}): SupervisorStatus {
  return {
    policies: ALL_POLICIES,
    recovering: [],
    lastRecovery: null,
    recoveryCount: 0,
    recentFailures: 0,
    ...over,
  };
}

function mkInput(over: Partial<RuntimeTwinInput> = {}): RuntimeTwinInput {
  return {
    nowIso: NOW,
    execution: {
      registeredKinds: ['worker', 'automation'],
      active: [mkSession({ id: 'a1', kind: 'connector', state: 'running' })],
      history: [
        mkSession({ id: 'h1', kind: 'decision', state: 'failed' }),
        mkSession({ id: 'h2', kind: 'automation', state: 'completed' }),
        mkSession({ id: 'h3', kind: 'decision', state: 'completed' }),
      ],
      stats: STATS,
    },
    supervisor: { status: mkStatus(), history: [] },
    failures: {},
    ...over,
  };
}

describe('execution — per-kind counts are derived from what was OBSERVED, not from what was registered', () => {
  it('unions the registered kinds with every kind seen on a session, sorted by localeCompare', () => {
    const twin = buildRuntimeTwin(mkInput());
    expect(twin.execution.kinds.map((k) => k.kind)).toEqual([
      'automation',
      'connector',
      'decision',
      'worker',
    ]);
  });

  it('still counts a session whose kind is no longer registered — a real session is not silently dropped', () => {
    const twin = buildRuntimeTwin(mkInput());
    // `decision` and `connector` appear on sessions but on no registration.
    const decision = twin.execution.kinds.find((k) => k.kind === 'decision')!;
    expect(decision).toEqual({ kind: 'decision', active: 0, historical: 2, failed: 1 });
    const connector = twin.execution.kinds.find((k) => k.kind === 'connector')!;
    expect(connector).toEqual({ kind: 'connector', active: 1, historical: 0, failed: 0 });
  });

  it('keeps a registered kind with no sessions at all, at zero', () => {
    const twin = buildRuntimeTwin(mkInput());
    expect(twin.execution.kinds.find((k) => k.kind === 'worker')).toEqual({
      kind: 'worker',
      active: 0,
      historical: 0,
      failed: 0,
    });
  });

  it('counts only the `failed` state as failed — not every non-completed state', () => {
    const twin = buildRuntimeTwin(
      mkInput({
        execution: {
          registeredKinds: ['task'],
          active: [],
          history: [
            mkSession({ id: 'x1', kind: 'task', state: 'failed' }),
            mkSession({ id: 'x2', kind: 'task', state: 'cancelled' }),
            mkSession({ id: 'x3', kind: 'task', state: 'interrupted' }),
            mkSession({ id: 'x4', kind: 'task', state: 'completed' }),
          ],
          stats: STATS,
        },
      }),
    );
    expect(twin.execution.kinds).toEqual([{ kind: 'task', active: 0, historical: 4, failed: 1 }]);
  });

  it('sorts the registered-kind list too, without mutating the caller’s array', () => {
    const registeredKinds: ExecutionKind[] = ['worker', 'automation'];
    const twin = buildRuntimeTwin(
      mkInput({
        execution: { registeredKinds, active: [], history: [], stats: STATS },
      }),
    );
    expect(twin.execution.registeredKinds).toEqual(['automation', 'worker']);
    expect(registeredKinds).toEqual(['worker', 'automation']);
  });
});

describe('execution — the row lists are bounded views, newest first', () => {
  const many = (n: number, prefix: string) =>
    Array.from({ length: n }, (_, i) => mkSession({ id: `${prefix}${i}`, kind: 'task' }));

  it('bounds both the active and the recent list at twelve rows', () => {
    const twin = buildRuntimeTwin(
      mkInput({
        execution: {
          registeredKinds: ['task'],
          active: many(15, 'a'),
          history: many(15, 'h'),
          stats: STATS,
        },
      }),
    );
    expect(twin.execution.active).toHaveLength(12);
    expect(twin.execution.recent).toHaveLength(12);
    // The counts report the TRUE totals; only the rows are bounded.
    expect(twin.execution.activeCount).toBe(15);
    expect(twin.execution.historyCount).toBe(15);
  });

  it('takes the newest twelve history entries and reverses them — the tail is the newest slice', () => {
    const twin = buildRuntimeTwin(
      mkInput({
        execution: {
          registeredKinds: ['task'],
          active: [],
          history: many(15, 'h'),
          stats: STATS,
        },
      }),
    );
    // history is h0..h14; the newest twelve are h3..h14, newest first.
    expect(twin.execution.recent.map((r) => r.id)).toEqual([
      'h14', 'h13', 'h12', 'h11', 'h10', 'h9', 'h8', 'h7', 'h6', 'h5', 'h4', 'h3',
    ]);
  });

  it('takes the FIRST twelve active sessions — active order is the engine’s, not re-sorted', () => {
    const twin = buildRuntimeTwin(
      mkInput({
        execution: { registeredKinds: ['task'], active: many(15, 'a'), history: [], stats: STATS },
      }),
    );
    expect(twin.execution.active.map((r) => r.id)).toEqual([
      'a0', 'a1', 'a2', 'a3', 'a4', 'a5', 'a6', 'a7', 'a8', 'a9', 'a10', 'a11',
    ]);
  });

  it('projects only the six row fields, dropping steps, results and errors from the view', () => {
    const twin = buildRuntimeTwin(
      mkInput({
        execution: {
          registeredKinds: ['task'],
          active: [],
          history: [
            mkSession({
              id: 'h1',
              kind: 'task',
              state: 'failed',
              error: 'boom',
              result: { secret: true },
              resultSummary: 'failed hard',
            }),
          ],
          stats: STATS,
        },
      }),
    );
    expect(twin.execution.recent[0]).toEqual({
      id: 'h1',
      kind: 'task',
      label: 'session h1',
      state: 'failed',
      startedAt: '2026-07-31T12:00:00.000Z',
      durationMs: 5_000,
    });
  });

  it('carries the engine’s statistics through verbatim — Stage 13 recomputes no execution metric', () => {
    const twin = buildRuntimeTwin(mkInput());
    expect(twin.execution.stats).toEqual(STATS);
  });
});

describe('execution — an unreadable engine reports nothing, never a healthy-looking zero', () => {
  it('sets available:false and stats:null rather than composing a zeroed ExecutionStats', () => {
    const twin = buildRuntimeTwin(mkInput({ execution: null }));
    expect(twin.execution.available).toBe(false);
    // The distinction that matters: a zeroed stats block would read as "the
    // engine ran nothing", which is a claim. null makes no claim at all.
    expect(twin.execution.stats).toBeNull();
    expect(twin.execution.kinds).toEqual([]);
    expect(twin.execution.active).toEqual([]);
    expect(twin.execution.recent).toEqual([]);
    expect(twin.execution.registeredKinds).toEqual([]);
  });

  it('sets available:true only when the engine was actually read', () => {
    expect(buildRuntimeTwin(mkInput()).execution.available).toBe(true);
  });
});

describe('supervisor — rows come from the policy map the supervisor actually reported', () => {
  it('derives one row per key of status.policies, sorted by localeCompare', () => {
    const twin = buildRuntimeTwin(mkInput());
    expect(twin.supervisor.rows.map((r) => r.subsystem)).toEqual([
      'automation',
      'backend',
      'platform',
      'runtime',
      'voice',
    ]);
  });

  it('reads the subsystem list from the reported map, not from a hard-coded constant', () => {
    // A supervisor reporting a narrower policy map must yield a narrower view.
    // The cast is deliberate: the point of the lock is that the function trusts
    // the object it was handed rather than a compile-time list.
    const policies = { runtime: 'automatic', voice: 'manual' } as unknown as Record<
      SupervisedSubsystem,
      RecoveryPolicy
    >;
    const twin = buildRuntimeTwin(
      mkInput({ supervisor: { status: mkStatus({ policies }), history: [] } }),
    );
    expect(twin.supervisor.rows.map((r) => r.subsystem)).toEqual(['runtime', 'voice']);
  });

  it('carries each subsystem’s policy through verbatim', () => {
    const twin = buildRuntimeTwin(mkInput());
    const byId = new Map(twin.supervisor.rows.map((r) => [r.subsystem, r]));
    expect(byId.get('runtime')!.policy).toBe('automatic');
    expect(byId.get('platform')!.policy).toBe('manual');
    expect(byId.get('voice')!.policy).toBe('disabled');
  });

  it('marks a subsystem recovering only when the supervisor says it is', () => {
    const twin = buildRuntimeTwin(
      mkInput({
        supervisor: { status: mkStatus({ recovering: ['platform'] }), history: [] },
      }),
    );
    const byId = new Map(twin.supervisor.rows.map((r) => [r.subsystem, r]));
    expect(byId.get('platform')!.recovering).toBe(true);
    expect(byId.get('runtime')!.recovering).toBe(false);
  });

  it('counts recoveries per subsystem and failures as the records that did NOT succeed', () => {
    const twin = buildRuntimeTwin(
      mkInput({
        supervisor: {
          status: mkStatus(),
          history: [
            mkRecord({ id: 'r1', subsystem: 'runtime', ok: true }),
            mkRecord({ id: 'r2', subsystem: 'runtime', ok: false }),
            mkRecord({ id: 'r3', subsystem: 'runtime', ok: false }),
            mkRecord({ id: 'r4', subsystem: 'voice', ok: true }),
          ],
        },
      }),
    );
    const byId = new Map(twin.supervisor.rows.map((r) => [r.subsystem, r]));
    expect(byId.get('runtime')!.recoveries).toBe(3);
    expect(byId.get('runtime')!.failures).toBe(2);
    expect(byId.get('voice')!.recoveries).toBe(1);
    expect(byId.get('voice')!.failures).toBe(0);
    expect(byId.get('backend')!.recoveries).toBe(0);
    expect(byId.get('backend')!.lastAt).toBeNull();
    expect(twin.supervisor.historyCount).toBe(4);
  });

  it('takes the LAST matching record as lastAt — append order, never timestamp arithmetic', () => {
    const twin = buildRuntimeTwin(
      mkInput({
        supervisor: {
          status: mkStatus(),
          history: [
            mkRecord({ id: 'r1', subsystem: 'runtime', startedAt: '2026-07-31T23:00:00.000Z' }),
            // Appended later, but stamped EARLIER. The supervisor's history is
            // append-only, so its order is authoritative and Stage 13 does not
            // second-guess it by sorting on the timestamp.
            mkRecord({ id: 'r2', subsystem: 'runtime', startedAt: '2026-07-31T01:00:00.000Z' }),
          ],
        },
      }),
    );
    const runtime = twin.supervisor.rows.find((r) => r.subsystem === 'runtime')!;
    expect(runtime.lastAt).toBe('2026-07-31T01:00:00.000Z');
  });

  it('carries the supervisor status through verbatim', () => {
    const status = mkStatus({ recoveryCount: 9, recentFailures: 2 });
    const twin = buildRuntimeTwin(mkInput({ supervisor: { status, history: [] } }));
    expect(twin.supervisor.status).toEqual(status);
  });

  it('reports an unreadable supervisor as unavailable with a null status', () => {
    const twin = buildRuntimeTwin(mkInput({ supervisor: null }));
    expect(twin.supervisor).toEqual({
      available: false,
      status: null,
      rows: [],
      historyCount: 0,
    });
  });
});

describe('the view’s own contract', () => {
  it('restates only the runtime and execution surfaces — the other views own the rest', () => {
    const twin = buildRuntimeTwin(mkInput());
    expect(twin.surfaces.map((s) => s.id).sort()).toEqual(['execute-engine', 'runtime-supervisor']);
    for (const s of twin.surfaces) {
      expect(['runtime-surface', 'execution-surface']).toContain(s.kind);
    }
  });

  it('projects every failure it was handed as a declared unavailability', () => {
    const twin = buildRuntimeTwin(
      mkInput({
        execution: null,
        failures: { 'execute-engine': 'read threw', 'runtime-supervisor': 'not started' },
      }),
    );
    expect(twin.unavailable).toEqual([
      { system: 'execute-engine', reason: 'read threw' },
      { system: 'runtime-supervisor', reason: 'not started' },
    ]);
  });

  it('stamps the caller’s time and carries the disclosure', () => {
    const twin = buildRuntimeTwin(mkInput());
    expect(twin.generatedAt).toBe(NOW);
    expect(twin.disclosure).toBe(RUNTIME_TWIN_DISCLOSURE);
    expect(twin.disclosure).toContain('reset with the process');
  });

  it('is deterministic — the same input composes byte-identical output', () => {
    expect(buildRuntimeTwin(mkInput())).toEqual(buildRuntimeTwin(mkInput()));
  });
});
