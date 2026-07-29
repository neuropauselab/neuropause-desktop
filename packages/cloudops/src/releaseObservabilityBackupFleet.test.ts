import { describe, it, expect, beforeAll } from 'vitest';
import { ManualClock } from '@neuropause/cloud-core';
import { createEnterpriseRuntime, type EnterpriseRuntime } from '@neuropause/runtime';
import { createExecutionPlatform } from '@neuropause/execution';
import { createFederationPlatform } from '@neuropause/federation';
import { createCloudOpsPlatform, type CloudOpsPlatform } from './platform';
import { CLOUDOPS_MATRIX } from './evidence';

describe('Modules 8,10,11,12,13 — Release, Observability, Backup/DR, Fleet, Dashboards + honesty', () => {
  let runtime: EnterpriseRuntime;
  let ops: CloudOpsPlatform;
  let clock: ManualClock;
  let envId: string;
  let depId: string;

  beforeAll(async () => {
    clock = new ManualClock(1000);
    runtime = createEnterpriseRuntime({ clock });
    ops = createCloudOpsPlatform(runtime, { clock });
    envId = (await ops.environments().create({ tier: 'production', name: 'prod' })).id;
    depId = (await ops.deployments().register({ name: 'api', kind: 'api', environmentId: envId })).id;
  });

  it('validates release workflows and HITL-gates production approval', async () => {
    const canary = await ops.release().plan({ deploymentId: depId, strategy: 'canary', production: true });
    expect(ops.release().validate(canary.id).valid).toBe(true);
    // reused Wave 4 HITL gate: an AI-initiated production approval is refused
    await expect(ops.release().approve(canary.id, { actor: 'ai', aiInitiated: true })).rejects.toThrow(/human/);
    const approved = await ops.release().approve(canary.id, { actor: 'alice' });
    expect(approved.approved).toBe(true);
    // a malformed workflow (never reaches weight 100) fails validation
    const bad = await ops.release().plan({ deploymentId: depId, strategy: 'rolling', steps: [{ name: 'x', weight: 50, gate: 'auto' }] });
    expect(ops.release().validate(bad.id).valid).toBe(false);
  });

  it('registers observability descriptors (no live telemetry)', async () => {
    await ops.observability().register({ backend: 'prometheus', signal: 'metrics', name: 'api' });
    await ops.observability().register({ backend: 'grafana', signal: 'dashboards', name: 'api' });
    const r = ops.observability().list()[0]!;
    expect(r.evidence).toBe('adapter-verified');
    expect(r.note).toContain('INFRA-PENDING');
    expect(ops.observability().overview().note).toContain('no live telemetry');
    expect(ops.observability().byBackend('prometheus').length).toBe(1);
  });

  it('represents backup & DR plans with RPO/RTO (simulation only)', async () => {
    const b = await ops.backups().backup('nightly', depId, 60);
    expect(b.rpoMinutes).toBe(60);
    const f = await ops.backups().failover('dr', depId, 15);
    expect(f.note).toContain('INFRA-PENDING'); // failover execution is never claimed
    expect(ops.backups().objectives(f.id).rtoMinutes).toBe(15);
    expect(ops.backups().byTarget(depId).length).toBe(2);
  });

  it('builds a unified fleet inventory reusing the Wave 6 federation platform', async () => {
    const fed = createFederationPlatform(runtime, { clock });
    const orgA = (await fed.registerOrganization({ name: 'Acme' })).id;
    const region = await fed.registerRegion({ name: 'us-east', provider: 'aws' });
    await fed.registerCluster({ regionId: region.id, name: 'prod' });

    const ops2 = createCloudOpsPlatform(runtime, { clock, federation: fed });
    await ops2.cloud().register({ provider: 'aws', name: 'acct' });
    const env2 = await ops2.environments().create({ tier: 'production', name: 'prod' });
    await ops2.deployments().register({ name: 'app', kind: 'application', environmentId: env2.id });

    const inv = ops2.fleet().inventory();
    expect(inv.organizations).toBeGreaterThanOrEqual(1);
    expect(inv.regions).toBe(1);
    expect(inv.clusters).toBe(1);
    expect(inv.clouds).toBe(1);
    expect(inv.applications).toBe(1);
    expect(inv.note).toContain('descriptors');
    expect(orgA).toBeTruthy();

    // dashboards compose from the live registries + evidence readiness
    const dash = ops2.dashboards().build('SRE');
    expect(dash.focus).toContain('observability');
    expect(dash.panels.fleetInventory.regions).toBe(1);
    expect(dash.panels.infrastructureReadiness.infraPending).toBeGreaterThan(0);
  });

  it('reuses the Wave 5 execution connector count', async () => {
    const exec = createExecutionPlatform(runtime, { clock });
    const ops3 = createCloudOpsPlatform(runtime, { clock, execution: exec });
    expect(ops3.reusedConnectorCount()).toBe(22);
  });

  it('keeps the honesty boundary — nothing infra-pending is marked live-verified', () => {
    const fabricated = CLOUDOPS_MATRIX.filter(
      (m) => m.level === 'live-verified' && /real (kubernetes|apply)|reconciliation|live (prometheus|grafana|metric|telemetry|secret)|production failover|disaster recovery execution|multi-region/i.test(m.capability),
    );
    expect(fabricated.length).toBe(0);
    const r = ops.readiness();
    expect(r.infraPending).toBeGreaterThan(0);
    expect(r.adapterVerified).toBeGreaterThan(0);
    expect(r.liveVerified).toBeGreaterThan(0);
  });
});
