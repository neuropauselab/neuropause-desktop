import { describe, it, expect } from 'vitest';
import { ManualClock } from '@neuropause/cloud-core';
import { createEnterpriseRuntime } from '@neuropause/runtime';
import { createFederationPlatform } from '@neuropause/federation';
import { createDeploymentFoundation } from '@neuropause/deploy';
import { createInfrastructurePlatform } from './platform';

describe('E1–E3 — activation runtime, cluster activation, cloud activation', () => {
  it('never activates without a verified real-infrastructure proof', async () => {
    const clock = new ManualClock(1000);
    const rt = createEnterpriseRuntime({ clock });
    const infra = createInfrastructurePlatform(rt, { clock });
    const rec = await infra.activation().register({ name: 'prod-cluster', kind: 'cluster', environment: 'production' });
    expect(rec.status).toBe('pending');
    await infra.activation().requestActivation(rec.id);
    await expect(infra.activation().confirmActivation(rec.id, { verified: false, evidenceRef: '' })).rejects.toThrow(/refusing to fabricate/);
    const active = await infra.activation().confirmActivation(rec.id, { verified: true, evidenceRef: 'kubectl-get-nodes-ok' });
    expect(active.status).toBe('active'); // only with a real proof
    expect(infra.activation().activeCount()).toBe(1);
  });

  it('clusters are represented with 0 running nodes and REUSE federation', async () => {
    const clock = new ManualClock(1000);
    const rt = createEnterpriseRuntime({ clock });
    const fed = createFederationPlatform(rt, { clock });
    const dep = createDeploymentFoundation(rt, { clock });
    const infra = createInfrastructurePlatform(rt, { clock, federation: fed, deploy: dep });
    const cluster = await infra.clusters().registerCluster({ name: 'nems-prod', env: 'production', region: 'eu-west-1', nodesDeclared: 5 });
    expect(cluster.nodesRunning).toBe(0); // never fabricated
    expect(cluster.reusedFederation).toBe(true);
    expect(cluster.manifestKinds).toEqual(expect.arrayContaining(['Deployment', 'StatefulSet']));
    expect(infra.clusters().runningNodeCount()).toBe(0);
  });

  it('cloud accounts are represented — nothing provisioned', async () => {
    const clock = new ManualClock(1000);
    const rt = createEnterpriseRuntime({ clock });
    const infra = createInfrastructurePlatform(rt, { clock });
    await infra.adapters().seed();
    const acct = await infra.cloud().registerAccount({ provider: 'aws', name: 'nems-prod-account' });
    infra.cloud().addRegion(acct.id, 'us-east-1', ['us-east-1a', 'us-east-1b']);
    infra.cloud().addNetwork(acct.id, 'vpc-nems', ['subnet-a', 'subnet-b']);
    expect(infra.cloud().get(acct.id)!.regions).toContain('us-east-1');
    expect(infra.cloud().inventory().adapterProviders).toEqual(expect.arrayContaining(['AWS', 'Azure', 'Google Cloud']));
  });
});
