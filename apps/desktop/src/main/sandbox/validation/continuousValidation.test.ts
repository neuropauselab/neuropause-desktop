/** AI Sandbox S6 — continuous validation contract (certify, regression, trend, cadence). */
import { describe, expect, it } from 'vitest';
import {
  cadenceDue,
  certifyLevel,
  classifyRegression,
  computeTrend,
  runStatusFrom,
  worstSeverity,
  type StageResult,
} from '@neuropause/shared';

const stage = (status: StageResult['status']): StageResult => ({ id: 's', name: 's', kind: 'scenario', status, durationMs: 1, summary: '', metrics: {} });

describe('certifyLevel + runStatusFrom', () => {
  it('fails on security failures or failed stages, warns on regression', () => {
    expect(certifyLevel({ stages: [stage('pass')], regression: null, securityFailures: 0 })).toBe('pass');
    expect(certifyLevel({ stages: [stage('pass')], regression: null, securityFailures: 1 })).toBe('fail');
    expect(certifyLevel({ stages: [stage('fail')], regression: null, securityFailures: 0 })).toBe('fail');
    expect(certifyLevel({ stages: [stage('warn')], regression: null, securityFailures: 0 })).toBe('warning');
    expect(certifyLevel({ stages: [stage('pass')], regression: { findings: [], regressed: true, worst: 'minor', summary: '' }, securityFailures: 0 })).toBe('warning');
  });

  it('rolls stage statuses into a run status', () => {
    expect(runStatusFrom([stage('pass'), stage('pass')])).toBe('passed');
    expect(runStatusFrom([stage('pass'), stage('warn')])).toBe('warning');
    expect(runStatusFrom([stage('pass'), stage('fail')])).toBe('failed');
    expect(runStatusFrom([stage('error')])).toBe('error');
    expect(runStatusFrom([])).toBe('error');
  });
});

describe('regression classification', () => {
  it('classifies latency regression by severity, ignores noise', () => {
    expect(classifyRegression('latency', 'p95', 102, 100)).toBeNull(); // within 5%
    expect(classifyRegression('latency', 'p95', 112, 100)?.severity).toBe('minor'); // +12%
    expect(classifyRegression('latency', 'p95', 130, 100)?.severity).toBe('major'); // +30%
    expect(classifyRegression('latency', 'p95', 160, 100)?.severity).toBe('critical'); // +60%
    expect(classifyRegression('latency', 'p95', 100, null)).toBeNull();
    expect(worstSeverity([{ kind: 'latency', metric: 'x', current: 1, baseline: 1, deltaPct: 1, severity: 'minor', detail: '' }, { kind: 'memory', metric: 'y', current: 1, baseline: 1, deltaPct: 1, severity: 'critical', detail: '' }])).toBe('critical');
  });
});

describe('trend + cadence', () => {
  it('computes trend from pass rates', () => {
    expect(computeTrend([80, 90, 100])).toBe('improving');
    expect(computeTrend([100, 90, 80])).toBe('declining');
    expect(computeTrend([90, 91, 90])).toBe('stable');
    expect(computeTrend([90])).toBe('stable');
  });

  it('evaluates nightly + weekly cadence due windows', () => {
    // nightly at 02:00 (120), not yet run today
    expect(cadenceDue({ kind: 'nightly', atMinutes: 120 }, 120, 3, '2026-01-01', '2026-01-02')).toBe(true);
    expect(cadenceDue({ kind: 'nightly', atMinutes: 120 }, 121, 3, '2026-01-01', '2026-01-02')).toBe(false); // wrong minute
    expect(cadenceDue({ kind: 'nightly', atMinutes: 120 }, 120, 3, '2026-01-02', '2026-01-02')).toBe(false); // already ran today
    // weekly Monday(1) at 03:00
    expect(cadenceDue({ kind: 'weekly', dayOfWeek: 1, atMinutes: 180 }, 180, 1, '', '2026-01-05')).toBe(true);
    expect(cadenceDue({ kind: 'weekly', dayOfWeek: 1, atMinutes: 180 }, 180, 2, '', '2026-01-06')).toBe(false); // wrong day
    expect(cadenceDue({ kind: 'manual' }, 120, 1, '', 'x')).toBe(false);
  });
});
