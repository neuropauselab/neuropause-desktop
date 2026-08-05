import { describe, it, expect } from 'vitest';
import { ManualClock } from '@neuropause/cloud-core';
import { createEnterpriseRuntime } from '@neuropause/runtime';
import { createProductionPlatform } from '@neuropause/production';
import { createOperationsPlatform } from '@neuropause/operations';
import { createReliabilityPlatform } from './platform';
import { RELIABILITY_MATRIX, reliabilityReadiness, EXPECTED_ADAPTERS, EXPECTED_INFRA_PENDING } from './evidence';

// Capabilities that are external, business-data, or infrastructure — must NEVER be classified live.
const ADAPTER_OR_DATA = /External|Cloud monitoring|customer workloads|incident history|Operational trends|performance baselines|compliance audit evidence|production clusters|Production-scale|Multi-region|DR sites|penetration-test targets/;

describe('E14 / E15 / E17 / E18 / E19 + evidence — diagnostics, observability, sdk, governance, docs, honesty', () => {
  it('diagnostics REUSE production; observability validation is REAL (metrics round-trip + audit)', async () => {
    const clock = new ManualClock(1000);
    const rt = createEnterpriseRuntime({ clock });
    const prod = createProductionPlatform(rt, { clock });
    const ops = createOperationsPlatform(rt, { clock });
    const rel = createReliabilityPlatform(rt, { clock, production: prod, operations: ops });

    const bundle = await rel.diagnostics().createBundle({ org: 'acme' });
    expect(bundle.reusedProduction).toBe(true);

    const obs = await rel.observabilityValidation().validate();
    expect(obs.metricsRoundTrip).toBe(true);
    expect(obs.auditChainValid).toBe(true);
    expect(obs.valid).toBe(true);
  });

  it('documentation generates 9 guides and REUSES production docs for overlapping kinds', async () => {
    const clock = new ManualClock(1000);
    const rt = createEnterpriseRuntime({ clock });
    const prod = createProductionPlatform(rt, { clock });
    const rel = createReliabilityPlatform(rt, { clock, production: prod });
    expect(rel.documentation().guideKinds().length).toBe(9);
    expect((await rel.documentation().generate('security-hardening')).reusedProduction).toBe(true);
    expect((await rel.documentation().generate('validation-strategy')).reusedProduction).toBe(false);
  });

  it('the SDK exposes typed descriptors + copy-pasteable samples', () => {
    const clock = new ManualClock(1000);
    const rt = createEnterpriseRuntime({ clock });
    const rel = createReliabilityPlatform(rt, { clock });
    expect(rel.sdk().count()).toBeGreaterThanOrEqual(10);
    expect(rel.sdk().sample('performance')).toContain('createReliabilityPlatform');
  });

  it('every operation is audited on the ONE chain with a replay id', async () => {
    const clock = new ManualClock(1000);
    const rt = createEnterpriseRuntime({ clock });
    const rel = createReliabilityPlatform(rt, { clock });
    const events: Array<Record<string, unknown>> = [];
    rt.events().subscribe((e) => e.type === 'reliability.action', (e) => { events.push(e.payload as Record<string, unknown>); });

    const suite = rel.validation().register({ name: 's', kind: 'security' });
    await rel.validation().run(suite.id, () => ({ passed: true, checks: [] }));
    expect(rel.governance().verify()).toBe(true);
    expect(rt.audit().verify().valid).toBe(true);
    const last = events[events.length - 1]!;
    expect(last['replayId']).toBeTruthy();
    expect(last['org']).toBeTruthy();
  });

  it('NEVER promotes evidence incorrectly — only in-process runtimes are live-verified', () => {
    const nonLiveClassifiedLive = RELIABILITY_MATRIX.filter((m) => m.level === 'live-verified' && ADAPTER_OR_DATA.test(m.capability));
    expect(nonLiveClassifiedLive).toHaveLength(0);

    const r = reliabilityReadiness();
    expect(r.total).toBe(RELIABILITY_MATRIX.length);
    expect(r.liveVerified).toBe(17);
    expect(r.adapterVerified).toBe(EXPECTED_ADAPTERS); // 6
    expect(r.businessDataPending).toBe(5);
    expect(r.infrastructurePending).toBe(EXPECTED_INFRA_PENDING); // 5
  });
});
