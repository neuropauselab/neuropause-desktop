import { describe, it, expect } from 'vitest';
import { ManualClock } from '@neuropause/cloud-core';
import { createEnterpriseRuntime } from '@neuropause/runtime';
import { createExecutionPlatform } from '@neuropause/execution';
import { createDeploymentFoundation } from '@neuropause/deploy';
import { createInfrastructurePlatform } from './platform';
import { INFRA_MATRIX, infraReadiness, EXPECTED_ADAPTERS, EXPECTED_INFRA_PENDING } from './evidence';

const INFRA_NAMES = /not provisioned|not deployed|not configured|not issued/i;
const ADAPTER_NAMES = /^(AWS|Azure|Google Cloud|DigitalOcean|Hetzner|VMware|Vault|Entra ID|Google Workspace|Okta)$/;

describe('E16, E18, E21 — infra security, governance, honesty boundary & reuse', () => {
  it('infrastructure security enforces a real baseline policy set; scans are represented', async () => {
    const clock = new ManualClock(1000);
    const rt = createEnterpriseRuntime({ clock });
    const dep = createDeploymentFoundation(rt, { clock });
    const infra = createInfrastructurePlatform(rt, { clock, deploy: dep });
    const policies = await infra.infraSecurity().enforceBaseline();
    expect(policies.length).toBe(6);
    const scan = await infra.infraSecurity().scanImage({ image: 'ghcr.io/neuropause/nems:latest' });
    expect(scan.status).toBe('pending-scan'); // represented, not really scanned
    expect(infra.infraSecurity().podSecurityStandard()).toMatch(/restricted/);
  });

  it('every infrastructure action is audited on the ONE chain with evidence + a replay id', async () => {
    const clock = new ManualClock(1000);
    const rt = createEnterpriseRuntime({ clock });
    const infra = createInfrastructurePlatform(rt, { clock });
    const events: Array<Record<string, unknown>> = [];
    rt.events().subscribe((e) => e.type === 'infrastructure.action', (e) => { events.push(e.payload as Record<string, unknown>); });

    await infra.dns().registerDomain({ domain: 'app.nems.example.com' });
    expect(infra.governance().count()).toBeGreaterThan(0);
    expect(infra.governance().verify()).toBe(true);
    expect(rt.audit().verify().valid).toBe(true);
    const last = events[events.length - 1]!;
    expect(last['replayId']).toBeTruthy();
    expect(last).toHaveProperty('evidence');
    expect(last['epic']).toBeTruthy();
  });

  it('seeds the 10 provider adapters and reuses the Wave 5 connector count', async () => {
    const clock = new ManualClock(1000);
    const rt = createEnterpriseRuntime({ clock });
    const exec = createExecutionPlatform(rt, { clock });
    const infra = createInfrastructurePlatform(rt, { clock, execution: exec });
    await infra.adapters().seed();
    expect(infra.adapters().count()).toBe(EXPECTED_ADAPTERS);
    expect(infra.reusedConnectorCount()).toBe(22);
  });

  it('never promotes evidence incorrectly — no infrastructure or adapter is classified live', () => {
    const liveInfra = INFRA_MATRIX.filter((m) => m.level === 'live-verified' && INFRA_NAMES.test(m.capability));
    expect(liveInfra).toHaveLength(0);
    const liveAdapters = INFRA_MATRIX.filter((m) => m.level === 'live-verified' && ADAPTER_NAMES.test(m.capability));
    expect(liveAdapters).toHaveLength(0);

    const r = infraReadiness();
    expect(r.total).toBe(INFRA_MATRIX.length);
    expect(r.liveVerified).toBe(10);
    expect(r.adapterVerified).toBe(EXPECTED_ADAPTERS); // 10
    expect(r.businessDataPending).toBe(6);
    expect(r.infrastructurePending).toBe(EXPECTED_INFRA_PENDING); // 6
  });
});
