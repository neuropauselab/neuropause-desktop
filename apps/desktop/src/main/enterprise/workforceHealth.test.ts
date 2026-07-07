import { describe, expect, it } from 'vitest';
import type { WorkerHealthState, WorkforceHealthInput } from '@neuropause/shared';
import type { ExecutiveKpi } from '@neuropause/shared';
import { summarizeWorkforceHealth, workforceHealthBand, workforceHealthKpi } from './workforceHealth';

// Compile-time: the KPI must be assignable to ExecutiveKpi (the composer spreads it into ExecutiveKpi[]).
const _kpiAssignable: ExecutiveKpi = workforceHealthKpi(summarizeWorkforceHealth([]));
void _kpiAssignable;

let seq = 0;
function w(
  state: WorkerHealthState,
  successRate: number,
  jobsRun: number,
  jobsFailed = 0,
): WorkforceHealthInput {
  seq += 1;
  return { id: `w${seq}`, name: `Worker ${seq}`, state, successRate, jobsRun, jobsFailed };
}

describe('summarizeWorkforceHealth', () => {
  it('returns an empty, unknown summary for no workers', () => {
    const s = summarizeWorkforceHealth([]);
    expect(s.totalWorkers).toBe(0);
    expect(s.meanSuccessRate).toBe(1);
    expect(s.totalJobsRun).toBe(0);
    expect(s.state).toBe('unknown');
  });

  it('counts workers by health state', () => {
    const s = summarizeWorkforceHealth([
      w('healthy', 1, 10),
      w('healthy', 0.9, 10),
      w('degraded', 0.7, 10),
      w('unhealthy', 0.2, 10),
      w('unknown', 1, 0),
    ]);
    expect(s.totalWorkers).toBe(5);
    expect(s.healthy).toBe(2);
    expect(s.degraded).toBe(1);
    expect(s.unhealthy).toBe(1);
    expect(s.unknown).toBe(1);
  });

  it('is unhealthy overall if any worker is unhealthy', () => {
    expect(summarizeWorkforceHealth([w('healthy', 1, 5), w('unhealthy', 0.2, 5)]).state).toBe(
      'unhealthy',
    );
  });

  it('is degraded overall if any worker is degraded and none unhealthy', () => {
    expect(summarizeWorkforceHealth([w('healthy', 1, 5), w('degraded', 0.7, 5)]).state).toBe(
      'degraded',
    );
  });

  it('is healthy overall when all workers are healthy', () => {
    expect(summarizeWorkforceHealth([w('healthy', 1, 5), w('healthy', 0.95, 5)]).state).toBe(
      'healthy',
    );
  });

  it('averages success rate only over workers that have run jobs', () => {
    const s = summarizeWorkforceHealth([w('healthy', 1, 4), w('degraded', 0.5, 4), w('unknown', 1, 0)]);
    expect(s.meanSuccessRate).toBe(0.75);
  });

  it('aggregates job counts across all workers', () => {
    const s = summarizeWorkforceHealth([w('healthy', 1, 10, 0), w('degraded', 0.6, 5, 2)]);
    expect(s.totalJobsRun).toBe(15);
    expect(s.totalJobsFailed).toBe(2);
  });

  it('rolls up to unhealthy when the active mean falls below 0.5', () => {
    const s = summarizeWorkforceHealth([w('degraded', 0.4, 5), w('degraded', 0.45, 5)]);
    expect(s.meanSuccessRate).toBeLessThan(0.5);
    expect(s.state).toBe('unhealthy');
  });
});

describe('workforceHealthBand', () => {
  it('maps workforce state to the KPI band vocabulary', () => {
    expect(workforceHealthBand('healthy')).toBe('healthy');
    expect(workforceHealthBand('degraded')).toBe('watch');
    expect(workforceHealthBand('unhealthy')).toBe('critical');
    expect(workforceHealthBand('unknown')).toBe('watch');
  });
});

describe('workforceHealthKpi', () => {
  it('builds a deep-linked KPI with a healthy/total + percent display', () => {
    const summary = summarizeWorkforceHealth([w('healthy', 1, 10), w('degraded', 0.6, 10)]);
    const kpi = workforceHealthKpi(summary);
    expect(kpi.key).toBe('workforce-health');
    expect(kpi.deepLink).toBe('ai-workforce');
    expect(kpi.value).toBe(Math.round(summary.meanSuccessRate * 100));
    expect(kpi.display).toContain('/2 healthy');
    expect(kpi.band).toBe(workforceHealthBand(summary.state));
  });

  it('shows "No workers" when the fleet is empty', () => {
    expect(workforceHealthKpi(summarizeWorkforceHealth([])).display).toBe('No workers');
  });
});
