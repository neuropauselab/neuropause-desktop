import { describe, it, expect } from 'vitest';
import { ManualClock } from '@neuropause/cloud-core';
import { createEnterpriseRuntime } from '@neuropause/runtime';
import { createReliabilityPlatform } from '@neuropause/reliability';
import { createProductionPlatform } from '@neuropause/production';
import { createCustomerDeploymentPlatform } from '@neuropause/customer-deployment';
import { createReleasePlatform } from './platform';
import { RELEASE_MATRIX, releaseReadiness, EXPECTED_ADAPTERS, EXPECTED_INFRA_PENDING } from './evidence';

// Capabilities that are external, business-data, or infrastructure — must NEVER be classified live.
const ADAPTER_OR_DATA = /GitHub Releases|Enterprise Repositories|Azure Marketplace|AWS Marketplace|Docker Registry|Customer Growth|Revenue|Renewals|Adoption|Expansion|Production Usage|Marketplace Publication|Customer Production|Regional Deployments|CDN/;

describe('E15 / E16 / E9 / E8 + evidence — governance, playbooks, docs, success, honesty invariant', () => {
  it('audits every release operation on the ONE chain with a replay id', async () => {
    const clock = new ManualClock(1000);
    const rt = createEnterpriseRuntime({ clock });
    const release = createReleasePlatform(rt, { clock });
    const events: Array<Record<string, unknown>> = [];
    rt.events().subscribe((e) => e.type === 'release.action', (e) => { events.push(e.payload as Record<string, unknown>); });
    await release.runtime().register({ version: '1.0.0' });
    expect(release.governance().verify()).toBe(true);
    expect(rt.audit().verify().valid).toBe(true);
    const last = events[events.length - 1]!;
    expect(last['replayId']).toBeTruthy();
    expect(last['releaseVersion']).toBe('1.0.0');
  });

  it('generates six operations playbooks and eleven guides (reusing reliability + production docs)', async () => {
    const clock = new ManualClock(1000);
    const rt = createEnterpriseRuntime({ clock });
    const reliability = createReliabilityPlatform(rt, { clock });
    const production = createProductionPlatform(rt, { clock });
    const release = createReleasePlatform(rt, { clock, reliability, production });

    expect(release.productionOps().kinds().length).toBe(6);
    expect((await release.productionOps().generate('incident')).steps.length).toBeGreaterThan(0);

    expect(release.documentation().guideKinds().length).toBe(11);
    expect((await release.documentation().generate('security-manual')).reusedReliability).toBe(true);
    expect((await release.documentation().generate('administrator')).reusedProduction).toBe(true);
    expect((await release.documentation().generate('user')).reusedProduction).toBe(true);
  });

  it('customer success scores only from REAL usage — null with no data', async () => {
    const clock = new ManualClock(1000);
    const rt = createEnterpriseRuntime({ clock });
    const customerDeployment = createCustomerDeploymentPlatform(rt, { clock });
    const release = createReleasePlatform(rt, { clock, customerDeployment });
    const customer = await customerDeployment.runtime().registerCustomer({ name: 'Acme' });
    const tenant = await customerDeployment.runtime().createTenant({ customerId: customer.id, name: 'acme' });
    const env = await customerDeployment.runtime().createEnvironment({ tenantId: tenant.id, tier: 'pilot' });
    const dep = await customerDeployment.runtime().createDeployment({ customerId: customer.id, tenantId: tenant.id, environmentId: env.id });

    const noData = await release.customerSuccess().snapshot({ deploymentId: dep.id });
    expect(noData.hasData).toBe(false);
    expect(noData.healthScore).toBeNull();
    const scored = await release.customerSuccess().snapshot({ deploymentId: dep.id, usage: { activeUsers: 90, provisionedUsers: 100, featuresUsed: 9, featuresAvailable: 10, milestonesHit: 5, milestonesTotal: 5 } });
    expect(scored.hasData).toBe(true);
    expect(scored.adoptionScore).toBe(90);
  });

  it('NEVER promotes evidence incorrectly — only in-process runtimes are live-verified', () => {
    const nonLiveClassifiedLive = RELEASE_MATRIX.filter((m) => m.level === 'live-verified' && ADAPTER_OR_DATA.test(m.capability));
    expect(nonLiveClassifiedLive).toHaveLength(0);

    const r = releaseReadiness();
    expect(r.total).toBe(RELEASE_MATRIX.length);
    expect(r.liveVerified).toBe(17);
    expect(r.adapterVerified).toBe(EXPECTED_ADAPTERS); // 5
    expect(r.businessDataPending).toBe(6);
    expect(r.infrastructurePending).toBe(EXPECTED_INFRA_PENDING); // 4
  });
});
