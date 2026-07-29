import { describe, it, expect } from 'vitest';
import { ManualClock } from '@neuropause/cloud-core';
import { createEnterpriseRuntime } from '@neuropause/runtime';
import { createReliabilityPlatform } from './platform';

describe('E10 / E11 / E12 / E13 / E16 — reliability math, SLOs, readiness, RC gate, scoring', () => {
  it('computes REAL availability / MTTR / MTBF from recorded incidents', async () => {
    const clock = new ManualClock(0);
    const rt = createEnterpriseRuntime({ clock });
    const rel = createReliabilityPlatform(rt, { clock });
    await rel.reliabilityEngineering().recordIncident({ service: 'api', detectedAt: 0, resolvedAt: 100 });
    await rel.reliabilityEngineering().recordIncident({ service: 'api', detectedAt: 1000, resolvedAt: 1300 });

    const stats = rel.reliabilityEngineering().stats('api', 10_000);
    expect(stats.incidents).toBe(2);
    expect(stats.downtimeMs).toBe(400);
    expect(stats.availability).toBeCloseTo(0.96, 5);
    expect(stats.mttrMs).toBe(200);
    expect(stats.mtbfMs).toBe(4800);
    expect(rel.reliabilityEngineering().timeline('api')).toHaveLength(2);
  });

  it('computes a REAL error budget and derives status from the numbers', async () => {
    const clock = new ManualClock(1000);
    const rt = createEnterpriseRuntime({ clock });
    const rel = createReliabilityPlatform(rt, { clock });
    const slo = await rel.slo().define({ name: 'api-availability', kind: 'availability', target: 0.99, windowMs: 100_000 });
    const healthy = rel.slo().errorBudget(slo.id, 400);
    expect(healthy.budgetMs).toBe(1000);
    expect(healthy.remainingMs).toBe(600);
    expect(healthy.status).toBe('healthy');
    const breached = rel.slo().errorBudget(slo.id, 1200);
    expect(breached.status).toBe('breached');
  });

  it('tracks operational readiness completeness honestly', async () => {
    const clock = new ManualClock(1000);
    const rt = createEnterpriseRuntime({ clock });
    const rel = createReliabilityPlatform(rt, { clock });
    await rel.operationalReadiness().add({ kind: 'runbook', name: 'db-failover' });
    const comp = rel.operationalReadiness().completeness();
    expect(comp.total).toBe(6);
    expect(comp.present).toBe(1);
    expect(comp.missing).toContain('playbook');
  });

  it('gates a release candidate but NEVER declares GA', async () => {
    const clock = new ManualClock(1000);
    const rt = createEnterpriseRuntime({ clock });
    const rel = createReliabilityPlatform(rt, { clock });
    const rc = await rel.releaseCandidate().evaluate({
      version: '1.0.0-rc.1',
      gates: [
        { name: 'validation', passed: true },
        { name: 'security', passed: true },
        { name: 'recovery', passed: true },
      ],
    });
    expect(rc.decision).toBe('rc-approved');
    expect(rc.ga).toBe(false);

    const blocked = await rel.releaseCandidate().evaluate({ version: '1.0.0-rc.2', gates: [{ name: 'validation', passed: false }] });
    expect(blocked.decision).toBe('rc-blocked');
    expect(blocked.ga).toBe(false);
  });

  it('scores production readiness with the top band being release-candidate, not GA', async () => {
    const clock = new ManualClock(1000);
    const rt = createEnterpriseRuntime({ clock });
    const rel = createReliabilityPlatform(rt, { clock });
    const score = await rel.readinessScoring().score({
      validation: { passed: 10, failed: 0 },
      securityFindings: 0,
      recovery: { recovered: 3, total: 3 },
      operationalCompleteness: 1,
      complianceCoverage: 1,
    });
    expect(score.overall).toBe(100);
    expect(score.band).toBe('ready-for-rc');
    expect(score.ga).toBe(false);
  });
});
