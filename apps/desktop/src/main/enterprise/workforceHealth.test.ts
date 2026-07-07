import { describe, expect, it } from 'vitest';
import type { WorkerHealthState } from '@neuropause/shared';
import { summarizeWorkforceHealth, type WorkerHealthLike } from './workforceHealth';

function worker(
  state: WorkerHealthState,
  successRate: number,
  jobsRun: number,
  jobsFailed = 0,
): WorkerHealthLike {
  return { health: { state, successRate, jobsRun, jobsFailed } };
}

describe('summarizeWorkforceHealth', () => {
  it('returns an empty, unknown summary for no workers', () => {
    const s = summarizeWorkforceHealth([]);
    expect(s.totalWorkers).toBe(0);
    expect(s.healthy).toBe(0);
    expect(s.meanSuccessRate).toBe(1);
    expect(s.totalJobsRun).toBe(0);
    expect(s.state).toBe('unknown');
  });

  it('counts workers by health state', () => {
    const s = summarizeWorkforceHealth([
      worker('healthy', 1, 10),
      worker('healthy', 0.9, 10),
      worker('degraded', 0.7, 10),
      worker('unhealthy', 0.2, 10),
      worker('unknown', 1, 0),
    ]);
    expect(s.totalWorkers).toBe(5);
    expect(s.healthy).toBe(2);
    expect(s.degraded).toBe(1);
    expect(s.unhealthy).toBe(1);
    expect(s.unknown).toBe(1);
  });

  it('is unhealthy overall if any worker is unhealthy', () => {
    const s = summarizeWorkforceHealth([worker('healthy', 1, 5), worker('unhealthy', 0.2, 5)]);
    expect(s.state).toBe('unhealthy');
  });

  it('is degraded overall if any worker is degraded and none unhealthy', () => {
    const s = summarizeWorkforceHealth([worker('healthy', 1, 5), worker('degraded', 0.7, 5)]);
    expect(s.state).toBe('degraded');
  });

  it('is healthy overall when all workers are healthy', () => {
    const s = summarizeWorkforceHealth([worker('healthy', 1, 5), worker('healthy', 0.95, 5)]);
    expect(s.state).toBe('healthy');
  });

  it('averages success rate only over workers that have run jobs', () => {
    const s = summarizeWorkforceHealth([
      worker('healthy', 1, 4),
      worker('degraded', 0.5, 4),
      worker('unknown', 1, 0),
    ]);
    expect(s.meanSuccessRate).toBe(0.75);
  });

  it('aggregates job counts across all workers', () => {
    const s = summarizeWorkforceHealth([worker('healthy', 1, 10, 0), worker('degraded', 0.6, 5, 2)]);
    expect(s.totalJobsRun).toBe(15);
    expect(s.totalJobsFailed).toBe(2);
  });

  it('rolls up to unhealthy when the active mean falls below 0.5', () => {
    const s = summarizeWorkforceHealth([worker('degraded', 0.4, 5), worker('degraded', 0.45, 5)]);
    expect(s.meanSuccessRate).toBeLessThan(0.5);
    expect(s.state).toBe('unhealthy');
  });
});
