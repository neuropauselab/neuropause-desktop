import { describe, it, expect } from 'vitest';
import { ManualClock } from '@neuropause/cloud-core';
import { createEnterpriseRuntime } from '@neuropause/runtime';
import { createReliabilityPlatform } from '@neuropause/reliability';
import { createCustomerDeploymentPlatform, type CustomerDeploymentPlatform } from './platform';
import { CUSTOMER_DEPLOYMENT_MATRIX, deploymentReadiness, EXPECTED_ADAPTERS, EXPECTED_INFRA_PENDING } from './evidence';
import { RELIFE_ORTHO_PROFILE } from './constants';

// Capabilities that are external, business-data, or infrastructure — must NEVER be classified live.
const ADAPTER_OR_DATA = /Identity providers|ERP|CRM|\bHR\b|Finance|Manufacturing|Healthcare|Collaboration|Customer production|AI usage|Adoption|Business KPIs|Customer networking|VPN|certificates|databases/;

async function newDeployment(cd: CustomerDeploymentPlatform): Promise<string> {
  const customer = await cd.runtime().registerCustomer({ name: 'Acme' });
  const tenant = await cd.runtime().createTenant({ customerId: customer.id, name: 'acme' });
  const env = await cd.runtime().createEnvironment({ tenantId: tenant.id, tier: 'pilot' });
  return (await cd.runtime().createDeployment({ customerId: customer.id, tenantId: tenant.id, environmentId: env.id })).id;
}

describe('E15 / E16 / E17 + evidence — governance, runbooks, pilot profile, honesty invariant', () => {
  it('audits every deployment operation on the ONE chain with a replay id', async () => {
    const clock = new ManualClock(1000);
    const rt = createEnterpriseRuntime({ clock });
    const cd = createCustomerDeploymentPlatform(rt, { clock });
    const events: Array<Record<string, unknown>> = [];
    rt.events().subscribe((e) => e.type === 'deployment.action', (e) => { events.push(e.payload as Record<string, unknown>); });
    await newDeployment(cd);
    expect(cd.governance().verify()).toBe(true);
    expect(rt.audit().verify().valid).toBe(true);
    const last = events[events.length - 1]!;
    expect(last['replayId']).toBeTruthy();
    expect(last['epic']).toBeTruthy();
  });

  it('generates seven runbooks and REUSES reliability docs for the overlapping guides', async () => {
    const clock = new ManualClock(1000);
    const rt = createEnterpriseRuntime({ clock });
    const reliability = createReliabilityPlatform(rt, { clock });
    const cd = createCustomerDeploymentPlatform(rt, { clock, reliability });
    expect(cd.runbooks().guideKinds().length).toBe(7);
    expect((await cd.runbooks().generate('deployment')).reusedReliability).toBe(true);
    expect((await cd.runbooks().generate('administrator')).reusedReliability).toBe(false);
  });

  it('represents Relife Ortho as a data-only pilot profile (not hard-coded logic)', async () => {
    const clock = new ManualClock(1000);
    const rt = createEnterpriseRuntime({ clock });
    const cd = createCustomerDeploymentPlatform(rt, { clock });
    const deploymentId = await newDeployment(cd);
    expect(cd.profiles().some((p) => p.key === 'relife-ortho')).toBe(true);
    const applied = await cd.pilotProfile().apply({ deploymentId, profileKey: RELIFE_ORTHO_PROFILE.key });
    expect(applied.dataOnly).toBe(true);
    expect(applied.businessModules).toContain('manufacturing');
    expect(cd.sdk().count()).toBeGreaterThanOrEqual(12);
  });

  it('NEVER promotes evidence incorrectly — only in-process runtimes are live-verified', () => {
    const nonLiveClassifiedLive = CUSTOMER_DEPLOYMENT_MATRIX.filter((m) => m.level === 'live-verified' && ADAPTER_OR_DATA.test(m.capability));
    expect(nonLiveClassifiedLive).toHaveLength(0);

    const r = deploymentReadiness();
    expect(r.total).toBe(CUSTOMER_DEPLOYMENT_MATRIX.length);
    expect(r.liveVerified).toBe(19);
    expect(r.adapterVerified).toBe(EXPECTED_ADAPTERS); // 8
    expect(r.businessDataPending).toBe(5);
    expect(r.infrastructurePending).toBe(EXPECTED_INFRA_PENDING); // 5
  });
});
