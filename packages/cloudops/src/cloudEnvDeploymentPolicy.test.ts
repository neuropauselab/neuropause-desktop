import { describe, it, expect, beforeAll } from 'vitest';
import { ManualClock } from '@neuropause/cloud-core';
import { createEnterpriseRuntime, type EnterpriseRuntime } from '@neuropause/runtime';
import { createCloudOpsPlatform, type CloudOpsPlatform } from './platform';

describe('Modules 1,2,3,9 — Cloud registry, Environments, Deployments, Policy engine, Governance', () => {
  let runtime: EnterpriseRuntime;
  let ops: CloudOpsPlatform;

  beforeAll(() => {
    const clock = new ManualClock(1000);
    runtime = createEnterpriseRuntime({ clock });
    ops = createCloudOpsPlatform(runtime, { clock });
  });

  it('registers cloud provider descriptors (adapter-verified, never connected)', async () => {
    const aws = await ops.cloud().register({ provider: 'aws', name: 'prod-account' });
    expect(aws.evidence).toBe('adapter-verified');
    expect(aws.note).toContain('INFRA-PENDING');
    await ops.cloud().register({ provider: 'kubernetes', name: 'prod-cluster' });
    expect(ops.cloud().count()).toBe(2);
    expect(ops.cloud().providers().sort()).toEqual(['aws', 'kubernetes']);
  });

  it('manages environment tiers with policies and secret references', async () => {
    const prod = await ops.environments().create({ tier: 'production', name: 'prod' });
    const staging = await ops.environments().create({ tier: 'staging', name: 'staging' });
    expect(ops.environments().count()).toBeGreaterThanOrEqual(2);
    expect(ops.environments().byTier('production').length).toBe(1);
    await ops.environments().attachSecretRef(prod.id, 'secref_x');
    expect(ops.environments().get(prod.id)!.secretRefs).toContain('secref_x');
    expect(staging.tier).toBe('staging');
  });

  it('registers deployable workloads with status/health/version', async () => {
    const env = await ops.environments().create({ tier: 'qa', name: 'qa' });
    const dep = await ops.deployments().register({ name: 'api', kind: 'api', environmentId: env.id });
    expect(dep.status).toBe('planned');
    expect(dep.health).toBe('unknown'); // no live probe — health is never fabricated
    await ops.deployments().setStatus(dep.id, 'validated');
    await ops.deployments().setVersion(dep.id, '1.2.0');
    expect(ops.deployments().get(dep.id)!.version).toBe('1.2.0');
    expect(ops.deployments().byEnvironment(env.id).length).toBe(1);
  });

  it('evaluates infrastructure policies in-process against manifests', async () => {
    const good = await ops.kubernetes().describe('Deployment', { name: 'web', namespace: 'apps', labels: { app: 'web', owner: 'team' } });
    const limits = await ops.policy().define({ kind: 'resource-limits', name: 'limits' });
    const sec = await ops.policy().define({ kind: 'security-context', name: 'nonroot' });
    const labels = await ops.policy().define({ kind: 'required-labels', name: 'labels', rule: { requiredLabels: ['app', 'owner'] } });
    const img = await ops.policy().define({ kind: 'image-policy', name: 'img', rule: { allowedRegistries: ['neuropause/'] } });
    expect(ops.policy().evaluate(limits.id, good).passed).toBe(true);
    expect(ops.policy().evaluate(sec.id, good).passed).toBe(true);
    expect(ops.policy().evaluate(labels.id, good).passed).toBe(true);
    expect(ops.policy().evaluate(img.id, good).passed).toBe(true);

    // a bad manifest: wrong registry + missing owner label
    const bad = await ops.kubernetes().describe('Deployment', { name: 'evil', namespace: 'apps', labels: { app: 'evil' }, image: 'dockerhub/evil:latest' });
    expect(ops.policy().evaluate(img.id, bad).passed).toBe(false);
    expect(ops.policy().evaluate(labels.id, bad).violations.length).toBeGreaterThan(0);
    expect(ops.policy().compliance(bad).passed).toBe(false);
    expect(ops.policy().compliance(good).passed).toBe(true);
  });

  it('governs every cloud operation with a replay id + evidence on the one audit chain', async () => {
    const events: Array<Record<string, unknown>> = [];
    runtime.events().subscribe((e) => e.type === 'cloudops.operation', (e) => {
      events.push(e.payload as Record<string, unknown>);
    });
    await ops.cloud().register({ provider: 'gcp', name: 'analytics' });
    expect(ops.governance().count()).toBeGreaterThan(0);
    expect(ops.governance().verify()).toBe(true);
    expect(runtime.audit().verify().valid).toBe(true);
    const last = events[events.length - 1];
    expect(last.replayId).toBeTruthy(); // replay id per operation
    expect(last.evidence).toBeTruthy();
  });
});
