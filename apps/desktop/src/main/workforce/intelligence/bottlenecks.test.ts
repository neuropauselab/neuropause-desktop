import { describe, expect, it } from 'vitest';
import { detectBottlenecks } from './bottlenecks';
import { job } from './_jobFixture';

describe('detectBottlenecks', () => {
  it('flags a worker with a high failure rate (above default 0.4, min sample 3)', () => {
    const jobs = [
      job({ workerId: 'flaky', status: 'failed' }),
      job({ workerId: 'flaky', status: 'failed' }),
      job({ workerId: 'flaky', status: 'succeeded' }),
    ];
    const b = detectBottlenecks(jobs);
    const worker = b.find((x) => x.scope === 'worker' && x.kind === 'high_failure');
    expect(worker).toBeTruthy();
    expect(worker?.key).toBe('flaky');
    expect(worker?.value).toBeCloseTo(0.6667, 3);
  });

  it('does not flag failure below the minimum sample size', () => {
    const b = detectBottlenecks([job({ workerId: 'w', status: 'failed' })]); // only 1 decided
    expect(b.filter((x) => x.kind === 'high_failure')).toEqual([]);
  });

  it('flags a backlog when in-flight jobs reach the threshold', () => {
    const jobs = Array.from({ length: 5 }, () => job({ workerId: 'busy', status: 'running' }));
    const b = detectBottlenecks(jobs);
    expect(b.some((x) => x.kind === 'backlog' && x.key === 'busy' && x.value === 5)).toBe(true);
  });

  it('flags an ungrounded-heavy skill', () => {
    const jobs = [
      job({ workerId: 'w', skillId: 'blind', status: 'succeeded', grounded: false }),
      job({ workerId: 'w', skillId: 'blind', status: 'succeeded', grounded: false }),
      job({ workerId: 'w', skillId: 'blind', status: 'failed', grounded: false }),
    ];
    const b = detectBottlenecks(jobs);
    expect(b.some((x) => x.scope === 'skill' && x.kind === 'ungrounded' && x.key === 'blind')).toBe(true);
  });

  it('returns [] for a healthy workforce', () => {
    const jobs = [
      job({ workerId: 'w', status: 'succeeded' }),
      job({ workerId: 'w', status: 'succeeded' }),
      job({ workerId: 'w', status: 'succeeded' }),
    ];
    expect(detectBottlenecks(jobs)).toEqual([]);
  });
});
