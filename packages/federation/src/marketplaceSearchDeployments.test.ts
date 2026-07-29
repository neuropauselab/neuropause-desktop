import { describe, it, expect, beforeAll } from 'vitest';
import { ManualClock } from '@neuropause/cloud-core';
import { createEnterpriseRuntime, type EnterpriseRuntime } from '@neuropause/runtime';
import { createExecutionPlatform } from '@neuropause/execution';
import { createFederationPlatform, type FederationPlatform } from './platform';
import { DEPLOYMENT_TARGETS } from './constants';
import { FEDERATION_MATRIX } from './evidence';

describe('Modules 4,5,6,9,10,11,13,14 — Deployments, Marketplace, Search, Observability, Analytics, Dashboards', () => {
  let runtime: EnterpriseRuntime;
  let fed: FederationPlatform;
  let orgA: string;
  let orgB: string;

  beforeAll(async () => {
    const clock = new ManualClock(1000);
    runtime = createEnterpriseRuntime({ clock });
    fed = createFederationPlatform(runtime, { clock });
    orgA = (await fed.registerOrganization({ name: 'Acme' })).id;
    orgB = (await fed.registerOrganization({ name: 'Globex' })).id;
  });

  it('publishes, searches, and installs marketplace listings (install is a copy, not distribution)', async () => {
    const l = await fed.publishListing({ kind: 'workflow', name: 'CI Pipeline', publisherOrg: orgA, description: 'ci automation' });
    expect(fed.marketplace().count()).toBe(1);
    expect(fed.marketplace().search('ci').length).toBe(1);
    const inst = await fed.marketplace().install(l.id, orgB);
    expect(inst.note).toContain('infra-pending'); // live distribution not claimed
    expect(fed.marketplace().get(l.id)!.installs).toBe(1);
  });

  it('searches globally across organizations, federations, and the marketplace', async () => {
    await fed.createFederation('Acme Alliance', orgA);
    const byOrg = await fed.searchGlobal('Acme');
    expect(byOrg.hits.some((h) => h.source === 'organizations')).toBe(true);
    expect(byOrg.hits.some((h) => h.source === 'federations')).toBe(true);
    const byMkt = await fed.searchGlobal('CI');
    expect(byMkt.hits.some((h) => h.source === 'marketplace')).toBe(true);
    expect(fed.search().sourceIds()).toEqual(expect.arrayContaining(['organizations', 'federations', 'exchange', 'marketplace']));
  });

  it('generates deployment descriptors for all seven targets — never applied', async () => {
    for (const t of DEPLOYMENT_TARGETS) await fed.describeDeployment(t, { name: 'nems' });
    expect(fed.listDeployments().length).toBe(7);
    const k8s = fed.listDeployments('kubernetes')[0];
    expect(k8s.spec.kind).toBe('Deployment');
    expect(k8s.evidence).toBe('adapter-verified');
    expect(k8s.note).toContain('INFRA-PENDING'); // real deployment not claimed
    const aws = fed.listDeployments('aws')[0];
    expect(aws.spec.kind).toBe('ecs-task-definition');
  });

  it('registers region/cluster descriptors and reports observability (not cloud metrics)', async () => {
    const region = await fed.registerRegion({ name: 'us-east', provider: 'aws', zones: ['a', 'b'], edgeNodes: ['e1'] });
    await fed.registerCluster({ regionId: region.id, name: 'prod', services: ['nems'] });
    const ov = fed.observability().overview();
    expect(ov.regions).toBe(1);
    expect(ov.clusters).toBe(1);
    expect(ov.deployments).toBe(7);
    expect(ov.note).toContain('DESCRIPTORS');
  });

  it('reports analytics + dashboards; reuses the Wave 5 execution connector count', async () => {
    const report = fed.analytics().report();
    expect(report.marketplaceListings).toBe(1);
    expect(Object.keys(report.deploymentInventory).length).toBe(7);
    expect(report.organizations).toBeGreaterThanOrEqual(2);
    const dash = fed.dashboards().build('Cloud Operations');
    expect(dash.panels.deployments.note).toContain('infra-pending');
    expect(dash.focus).toContain('regions');

    // reuse: with a Wave 5 execution platform, connector count is the real 22 universal connectors
    const clock = new ManualClock(1000);
    const rt2 = createEnterpriseRuntime({ clock });
    const exec = createExecutionPlatform(rt2, { clock });
    const fed2 = createFederationPlatform(rt2, { clock, execution: exec });
    expect(fed2.analytics().report().connectors).toBe(22);
  });

  it('keeps the honesty boundary — nothing infra-pending is marked live-verified', () => {
    const fabricated = FEDERATION_MATRIX.filter((m) => m.level === 'live-verified' && /real (kubernetes|aws|azure|gcp)|replication|failover|disaster|distribution/i.test(m.capability));
    expect(fabricated.length).toBe(0);
    expect(fed.readiness().infraPending).toBeGreaterThan(0);
    expect(fed.readiness().adapterVerified).toBeGreaterThan(0);
    expect(fed.readiness().liveVerified).toBeGreaterThan(0);
  });
});
