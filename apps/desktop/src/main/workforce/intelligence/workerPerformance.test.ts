import { describe, expect, it } from 'vitest';
import { workerPerformance } from './workerPerformance';
import type { Job, JobStatus } from '@neuropause/shared';

function job(over: Partial<Job> & { workerId: string; status: JobStatus }): Job {
  return {
    id: Math.random().toString(36).slice(2),
    workerRole: 'analyst',
    skillId: 'skill-1',
    input: {},
    requestedBy: 'user-1',
    summary: null,
    evidence: [],
    proposals: [],
    logs: [],
    error: null,
    grounded: true,
    createdAt: '2026-01-01T00:00:00Z',
    startedAt: '2026-01-01T00:00:01Z',
    finishedAt: '2026-01-01T00:00:02Z',
    durationMs: 1000,
    ...over,
  };
}

describe('workerPerformance', () => {
  it('returns [] for no jobs', () => {
    expect(workerPerformance([])).toEqual([]);
  });

  it('counts outcomes per worker and computes success rate over decided jobs', () => {
    const perf = workerPerformance([
      job({ workerId: 'w1', status: 'succeeded' }),
      job({ workerId: 'w1', status: 'succeeded' }),
      job({ workerId: 'w1', status: 'failed' }),
      job({ workerId: 'w1', status: 'running' }), // in-flight, excluded from rate
    ]);
    expect(perf).toHaveLength(1);
    const w = perf[0];
    expect(w).toMatchObject({ workerId: 'w1', total: 4, succeeded: 2, failed: 1, inFlight: 1 });
    expect(w.successRate).toBe(0.6667); // 2 / (2+1)
  });

  it('separates workers and sorts by total volume', () => {
    const perf = workerPerformance([
      job({ workerId: 'busy', status: 'succeeded' }),
      job({ workerId: 'busy', status: 'succeeded' }),
      job({ workerId: 'quiet', status: 'succeeded' }),
    ]);
    expect(perf.map((p) => p.workerId)).toEqual(['busy', 'quiet']);
  });

  it('computes avg and p50 duration over terminated jobs only', () => {
    const perf = workerPerformance([
      job({ workerId: 'w', status: 'succeeded', durationMs: 100 }),
      job({ workerId: 'w', status: 'succeeded', durationMs: 200 }),
      job({ workerId: 'w', status: 'failed', durationMs: 300 }),
      job({ workerId: 'w', status: 'running', durationMs: null }), // excluded
    ]);
    expect(perf[0].avgDurationMs).toBe(200); // (100+200+300)/3
    expect(perf[0].p50DurationMs).toBe(200);
  });

  it('handles an even number of durations for the median', () => {
    const perf = workerPerformance([
      job({ workerId: 'w', status: 'succeeded', durationMs: 10 }),
      job({ workerId: 'w', status: 'succeeded', durationMs: 20 }),
      job({ workerId: 'w', status: 'succeeded', durationMs: 30 }),
      job({ workerId: 'w', status: 'succeeded', durationMs: 40 }),
    ]);
    expect(perf[0].p50DurationMs).toBe(25); // (20+30)/2
  });

  it('tracks ungrounded rate over terminated jobs', () => {
    const perf = workerPerformance([
      job({ workerId: 'w', status: 'succeeded', grounded: true }),
      job({ workerId: 'w', status: 'failed', grounded: false }),
      job({ workerId: 'w', status: 'running', grounded: false }), // not terminated → not counted
    ]);
    expect(perf[0].ungroundedRate).toBe(0.5); // 1 ungrounded of 2 terminated
  });

  it('reports the latest finishedAt as lastActiveAt', () => {
    const perf = workerPerformance([
      job({ workerId: 'w', status: 'succeeded', finishedAt: '2026-01-01T00:00:02Z' }),
      job({ workerId: 'w', status: 'succeeded', finishedAt: '2026-03-01T00:00:02Z' }),
      job({ workerId: 'w', status: 'running', finishedAt: null }),
    ]);
    expect(perf[0].lastActiveAt).toBe('2026-03-01T00:00:02Z');
  });

  it('success rate is 0 when nothing has terminated (all in-flight)', () => {
    const perf = workerPerformance([
      job({ workerId: 'w', status: 'running' }),
      job({ workerId: 'w', status: 'queued' }),
    ]);
    expect(perf[0]).toMatchObject({ successRate: 0, avgDurationMs: null, p50DurationMs: null, inFlight: 2 });
  });
});
