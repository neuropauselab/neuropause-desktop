/**
 * P8.2 — Workforce diagnostics summary (pure fold). Locks availability, execution
 * rate, failure rate, avg duration, approvals, and status escalation.
 */
import { describe, expect, it } from 'vitest';
import type { GovernanceVerdict, Job, JobProposal, WorkerSummary, WorkforceHealthInput } from '@neuropause/shared';
import { workforceDiagnosticsSummary } from './workforceDiagnostics';

const NOW = Date.parse('2026-07-15T00:00:00.000Z');

function mkWorker(id: string, over: Partial<WorkerSummary> = {}): WorkerSummary {
  return {
    id,
    name: id,
    role: 'operations',
    version: '1.0.0',
    lifecycle: 'idle',
    healthState: 'healthy',
    trustScore: 0.8,
    skillCount: 1,
    builtIn: true,
    ...over,
  };
}

function mkHealth(id: string, over: Partial<WorkforceHealthInput> = {}): WorkforceHealthInput {
  return { id, name: id, state: 'healthy', successRate: 1, jobsRun: 3, jobsFailed: 0, ...over };
}

function mkJob(over: Partial<Job> = {}): Job {
  return {
    id: 'j',
    workerId: 'w',
    workerRole: 'operations',
    skillId: 's',
    status: 'succeeded',
    input: {},
    requestedBy: 'system',
    summary: null,
    evidence: [],
    proposals: [],
    logs: [],
    error: null,
    grounded: true,
    createdAt: '2026-07-14T23:00:00.000Z',
    startedAt: '2026-07-14T23:00:00.000Z',
    finishedAt: '2026-07-14T23:59:00.000Z',
    durationMs: 100,
    ...over,
  };
}

const pendingProposal: JobProposal = {
  id: 'p1',
  title: 'Send',
  summary: 's',
  sideEffects: true,
  risk: 'medium',
  evidence: [],
  payload: {},
  verdict: { decision: 'require_approval' } as GovernanceVerdict,
  approval: null,
};

describe('workforceDiagnosticsSummary', () => {
  it('computes availability, rates, and avg duration from live state', () => {
    const s = workforceDiagnosticsSummary({
      workers: [mkWorker('a'), mkWorker('b', { lifecycle: 'paused' }), mkWorker('c', { lifecycle: 'stopped' })],
      health: [mkHealth('a'), mkHealth('b')],
      jobs: [
        mkJob({ id: '1', status: 'succeeded', durationMs: 100, finishedAt: new Date(NOW - 60_000).toISOString() }),
        mkJob({ id: '2', status: 'failed', durationMs: 300, finishedAt: new Date(NOW - 120_000).toISOString() }),
      ],
      queued: 3,
      nowMs: NOW,
    });
    expect(s.totalWorkers).toBe(3);
    expect(s.available).toBe(1); // b paused, c stopped are unavailable
    expect(s.unavailable).toBe(2);
    expect(s.queued).toBe(3);
    expect(s.avgDurationMs).toBe(200); // (100 + 300) / 2
    expect(s.execPerMin).toBe(0.2); // 2 finished in the 10-min window
    // one succeeded, one failed → 50% success
    expect(s.successRatePct).toBe(50);
    expect(s.failureRatePct).toBe(50);
  });

  it('escalates status: healthy fleet → ok, all-unavailable → down', () => {
    const ok = workforceDiagnosticsSummary({ workers: [mkWorker('a')], health: [mkHealth('a')], jobs: [], queued: 0, nowMs: NOW });
    expect(ok.status).toBe('ok');

    const down = workforceDiagnosticsSummary({
      workers: [mkWorker('a', { lifecycle: 'errored' })],
      health: [mkHealth('a', { state: 'healthy' })],
      jobs: [],
      queued: 0,
      nowMs: NOW,
    });
    expect(down.status).toBe('down'); // workers exist but none available
  });

  it('degrades an ok fleet on a large backlog', () => {
    const s = workforceDiagnosticsSummary({ workers: [mkWorker('a')], health: [mkHealth('a')], jobs: [], queued: 25, nowMs: NOW });
    expect(s.status).toBe('degraded');
  });

  it('counts pending approvals and the oldest wait', () => {
    const parkedAt = new Date(NOW - 2 * 3_600_000).toISOString(); // 2h ago
    const s = workforceDiagnosticsSummary({
      workers: [mkWorker('a')],
      health: [mkHealth('a')],
      jobs: [mkJob({ id: '1', status: 'awaiting_approval', startedAt: parkedAt, finishedAt: null, durationMs: null, proposals: [pendingProposal] })],
      queued: 0,
      nowMs: NOW,
    });
    expect(s.pendingApprovals).toBe(1);
    expect(s.oldestApprovalWaitMs).toBe(2 * 3_600_000);
  });

  it('reports 0% failure (not 100) when no jobs have been decided', () => {
    const s = workforceDiagnosticsSummary({
      workers: [mkWorker('a')],
      health: [mkHealth('a', { jobsRun: 0 })],
      jobs: [mkJob({ id: '1', status: 'queued', finishedAt: null, durationMs: null })],
      queued: 1,
      nowMs: NOW,
    });
    expect(s.failureRatePct).toBe(0);
  });

  it('uses the accurate stored total when the jobs sample is capped', () => {
    const s = workforceDiagnosticsSummary({
      workers: [mkWorker('a')],
      health: [mkHealth('a')],
      jobs: [mkJob({ id: '1' })],
      queued: 0,
      storedJobs: 1500,
      nowMs: NOW,
    });
    expect(s.totalJobs).toBe(1500);
    expect(s.detail).toContain('1500 jobs');
  });

  it('is stable on an empty workforce', () => {
    const s = workforceDiagnosticsSummary({ workers: [], health: [], jobs: [], queued: 0, nowMs: NOW });
    expect(s.status).toBe('unknown');
    expect(s.totalWorkers).toBe(0);
    expect(s.avgDurationMs).toBe(0);
    expect(s.execPerMin).toBe(0);
    expect(s.failureRatePct).toBe(0);
    expect(s.detail).toContain('0 worker(s)');
  });
});
