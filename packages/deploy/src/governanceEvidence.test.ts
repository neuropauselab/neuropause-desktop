import { describe, it, expect } from 'vitest';
import { ManualClock } from '@neuropause/cloud-core';
import { createEnterpriseRuntime } from '@neuropause/runtime';
import { createExecutionPlatform } from '@neuropause/execution';
import { createDeploymentFoundation } from './platform';
import { DEPLOY_MATRIX, deployReadiness, EXPECTED_ADAPTERS, EXPECTED_INFRA_PENDING } from './evidence';

describe('Governance, adapters, reuse & the honesty boundary', () => {
  it('every deployment action is audited on the ONE chain with evidence + a replay id', async () => {
    const clock = new ManualClock(1000);
    const rt = createEnterpriseRuntime({ clock });
    const df = createDeploymentFoundation(rt, { clock });
    const events: Array<Record<string, unknown>> = [];
    rt.events().subscribe((e) => e.type === 'deploy.action', (e) => { events.push(e.payload as Record<string, unknown>); });

    await df.environments().register({ name: 'prod', environment: 'production', region: 'eu', cluster: 'c1', version: '0.0.0-preview.1' });
    expect(df.governance().count()).toBeGreaterThan(0);
    expect(df.governance().verify()).toBe(true);
    expect(rt.audit().verify().valid).toBe(true);
    const last = events[events.length - 1]!;
    expect(last['replayId']).toBeTruthy();
    expect(last).toHaveProperty('evidence');
    expect(last['epic']).toBeTruthy();
  });

  it('seeds the 9 infrastructure adapters as adapter-verified (represented, never provisioned)', async () => {
    const clock = new ManualClock(1000);
    const rt = createEnterpriseRuntime({ clock });
    const df = createDeploymentFoundation(rt, { clock });
    await df.adapters().seed();
    expect(df.adapters().count()).toBe(EXPECTED_ADAPTERS);
    expect(df.adapters().list().every((a) => a.evidence === 'adapter-verified' && !a.configured)).toBe(true);
  });

  it('reuses the Wave 5 execution connector count (does not duplicate connectors)', () => {
    const clock = new ManualClock(1000);
    const rt = createEnterpriseRuntime({ clock });
    const exec = createExecutionPlatform(rt, { clock });
    const df = createDeploymentFoundation(rt, { clock, execution: exec });
    expect(df.reusedConnectorCount()).toBe(22);
  });

  it('never classifies infrastructure as live — the four-level boundary holds', () => {
    const live = DEPLOY_MATRIX.filter((m) => m.level === 'live-verified' && /^Real /i.test(m.capability));
    expect(live).toHaveLength(0);

    const infra = DEPLOY_MATRIX.filter((m) => m.level === 'infrastructure-pending');
    expect(infra.length).toBe(EXPECTED_INFRA_PENDING); // real clusters/cloud/db/monitoring/dns/tls/lb

    // no external adapter is ever classified live
    const adaptersLive = DEPLOY_MATRIX.filter((m) => m.level === 'live-verified' && /^(AWS|Azure|Google Cloud|DigitalOcean|Hetzner|VMware|Kubernetes|MinIO|Vault)$/.test(m.capability));
    expect(adaptersLive).toHaveLength(0);

    const r = deployReadiness();
    expect(r.total).toBe(DEPLOY_MATRIX.length);
    expect(r.liveVerified).toBeGreaterThan(0);
    expect(r.adapterVerified).toBe(EXPECTED_ADAPTERS);
    expect(r.businessDataPending).toBeGreaterThan(0);
    expect(r.infrastructurePending).toBe(7);
  });
});
