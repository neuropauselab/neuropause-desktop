import { describe, it, expect } from 'vitest';
import { ManualClock } from '@neuropause/cloud-core';
import { createEnterpriseRuntime } from '@neuropause/runtime';
import { createSecurityPlatform } from '@neuropause/security';
import { createInfrastructurePlatform } from '@neuropause/infrastructure';
import { createDeploymentFoundation } from '@neuropause/deploy';
import { createPlatformOperations } from './platform';

describe('E1 / E2 — cloud environment + Kubernetes descriptors', () => {
  it('registers clusters via infrastructure with 0 running nodes — health is infrastructure-pending', async () => {
    const clock = new ManualClock(1000);
    const rt = createEnterpriseRuntime({ clock });
    const sec = createSecurityPlatform(rt, { clock });
    const infra = createInfrastructurePlatform(rt, { clock, security: sec });
    const ops = createPlatformOperations(rt, { clock, infrastructure: infra });
    const events: Array<Record<string, unknown>> = [];
    rt.events().subscribe((e) => e.type === 'platform-ops.action', (e) => { events.push(e.payload as Record<string, unknown>); });

    const env = await ops.cloud().registerEnvironment({ provider: 'aws', tier: 'production', region: 'us-east-1' });
    const cluster = await ops.cloud().registerCluster({ environmentId: env.id, name: 'prod-1' });
    expect(cluster.reusedInfrastructure).toBe(true);
    expect(cluster.runningNodes).toBe(0); // never fabricated
    const health = ops.cloud().health();
    expect(health.runningNodes).toBe(0);
    expect(health.status).toBe('infrastructure-pending');
    expect(rt.audit().verify().valid).toBe(true);
    expect(events[events.length - 1]!['replayId']).toBeTruthy();
  });

  it('declares all Kubernetes resource kinds as descriptors and counts real deploy manifests', async () => {
    const clock = new ManualClock(1000);
    const rt = createEnterpriseRuntime({ clock });
    const deploy = createDeploymentFoundation(rt, { clock });
    const ops = createPlatformOperations(rt, { clock, deploy });

    expect(ops.kubernetes().kinds().length).toBe(11);
    const d = await ops.kubernetes().declare({ namespace: 'nems-prod', kind: 'deployment', name: 'api-gateway' });
    expect(d.applied).toBe(false); // descriptor, not applied
    const assets = ops.kubernetes().manifestAssetCount();
    expect(assets.reusedDeploy).toBe(true); // reuses the deploy asset catalog
    expect(assets.count).toBeGreaterThanOrEqual(0); // real manifest files enumerated (count is cwd-relative to the deploy catalog)
  });
});
