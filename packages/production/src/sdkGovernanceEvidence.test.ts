import { describe, it, expect } from 'vitest';
import { ManualClock } from '@neuropause/cloud-core';
import { createEnterpriseRuntime } from '@neuropause/runtime';
import { createExecutionPlatform } from '@neuropause/execution';
import { createProductionPlatform } from './platform';
import { PRODUCTION_MATRIX, productionReadiness, EXPECTED_ADAPTERS, EXPECTED_INFRA_PENDING } from './evidence';

describe('M19, M21, M22 — SDK, governance, honesty boundary & reuse', () => {
  it('the SDK rejects an extension that reuses nothing (compose, do not fork)', async () => {
    const clock = new ManualClock(1000);
    const rt = createEnterpriseRuntime({ clock });
    const prod = createProductionPlatform(rt, { clock });
    await expect(prod.sdk().register({ kind: 'monitoring', name: 'rogue', reuses: [] })).rejects.toThrow(/reuse at least one/);
    const m = await prod.sdk().register({ kind: 'monitoring', name: 'Datadog Bridge', reuses: ['M8'] });
    expect(m.reuses).toEqual(['M8']);
  });

  it('every production action is audited on the ONE chain with evidence + a replay id', async () => {
    const clock = new ManualClock(1000);
    const rt = createEnterpriseRuntime({ clock });
    const prod = createProductionPlatform(rt, { clock });
    const events: Array<Record<string, unknown>> = [];
    rt.events().subscribe((e) => e.type === 'production.action', (e) => { events.push(e.payload as Record<string, unknown>); });

    await prod.runtime().registerEnvironment({ name: 'prod', org: 'o1', tier: 'production' });
    expect(prod.governance().count()).toBeGreaterThan(0);
    expect(prod.governance().verify()).toBe(true);
    expect(rt.audit().verify().valid).toBe(true);
    const last = events[events.length - 1]!;
    expect(last['replayId']).toBeTruthy();
    expect(last).toHaveProperty('evidence');
    expect(last['environment']).toBeTruthy();
  });

  it('seeds the deployment adapters as adapter-verified (represented, never provisioned)', async () => {
    const clock = new ManualClock(1000);
    const rt = createEnterpriseRuntime({ clock });
    const prod = createProductionPlatform(rt, { clock });
    await prod.adapters().seed();
    expect(prod.adapters().count()).toBe(EXPECTED_ADAPTERS);
    expect(prod.adapters().list().every((a) => a.evidence === 'adapter-verified' && !a.configured)).toBe(true);
  });

  it('reuses the Wave 5 execution connector count (does not duplicate connectors)', () => {
    const clock = new ManualClock(1000);
    const rt = createEnterpriseRuntime({ clock });
    const exec = createExecutionPlatform(rt, { clock });
    const prod = createProductionPlatform(rt, { clock, execution: exec });
    expect(prod.reusedConnectorCount()).toBe(22);
  });

  it('keeps the four-level honesty boundary — no infrastructure/data-pending cap is live-verified', () => {
    const live = PRODUCTION_MATRIX.filter((m) => m.level === 'live-verified' && /real HA|multi-region|production DR|global replication/i.test(m.capability));
    expect(live).toHaveLength(0);

    const infra = PRODUCTION_MATRIX.filter((m) => m.level === 'infrastructure-pending');
    expect(infra.length).toBe(EXPECTED_INFRA_PENDING); // real HA / multi-region failover / production DR / global replication

    const r = productionReadiness();
    expect(r.total).toBe(PRODUCTION_MATRIX.length);
    expect(r.liveVerified).toBeGreaterThan(0);
    expect(r.adapterVerified).toBe(EXPECTED_ADAPTERS);
    expect(r.businessDataPending).toBeGreaterThan(0);
    expect(r.infrastructurePending).toBe(4);
  });
});
