import type { Job, JobStatus } from '@neuropause/shared';
export function job(over: Partial<Job> & { workerId: string; status: JobStatus }): Job {
  return {
    id: Math.random().toString(36).slice(2),
    workerRole: 'research', skillId: 'skill-1', input: {}, requestedBy: 'user-1',
    summary: null, evidence: [], proposals: [], logs: [], error: null, grounded: true,
    createdAt: '2026-01-01T00:00:00Z', startedAt: '2026-01-01T00:00:01Z',
    finishedAt: '2026-01-01T00:00:02Z', durationMs: 1000, ...over,
  };
}
