import { describe, it, expect } from 'vitest';
import { ManualClock } from '@neuropause/cloud-core';
import { createEnterpriseRuntime } from '@neuropause/runtime';
import { createProductionPlatform } from '@neuropause/production';
import { createDeploymentFoundation } from '@neuropause/deploy';
import { createInfrastructurePlatform } from './platform';

describe('E15, E11, E17, E19 — logging, certificates, disaster recovery, documentation', () => {
  it('logging stores searchable streams and keeps the audit chain valid', () => {
    const clock = new ManualClock(1000);
    const rt = createEnterpriseRuntime({ clock });
    const infra = createInfrastructurePlatform(rt, { clock });
    infra.logging().log({ stream: 'application', level: 'info', message: 'api started' });
    infra.logging().log({ stream: 'security', level: 'warn', message: 'failed login' });
    expect(infra.logging().search({ stream: 'application' })).toHaveLength(1);
    expect(infra.logging().auditChainValid()).toBe(true);
    expect(infra.logging().streams().length).toBe(8);
  });

  it('certificates do a real expiry check and are never issued without a CA', async () => {
    const clock = new ManualClock(1000);
    const rt = createEnterpriseRuntime({ clock });
    const infra = createInfrastructurePlatform(rt, { clock });
    await infra.certificates().registerCertificate({ name: 'edge', domain: 'app.nems.example.com', expiresAt: clock.now() + 1000 });
    expect(infra.certificates().expiring(5000)).toHaveLength(1); // real expiry check
    expect(infra.certificates().issuedCount()).toBe(0);
    expect(infra.certificates().rotationPlan(5000)).toHaveLength(1);
  });

  it('disaster recovery REUSES production DR + the Sprint-1 backup validation', async () => {
    const clock = new ManualClock(1000);
    const rt = createEnterpriseRuntime({ clock });
    const prod = createProductionPlatform(rt, { clock });
    const dep = createDeploymentFoundation(rt, { clock, production: prod });
    const infra = createInfrastructurePlatform(rt, { clock, production: prod, deploy: dep });
    const plan = await infra.disasterRecovery().createPlan({ name: 'primary-dr', drRegion: 'eu-west', rpoMinutes: 15, rtoMinutes: 60 });
    expect(plan.reusedProduction).toBe(true);
    const res = await infra.disasterRecovery().validateBackup(plan.id);
    expect(res.valid).toBe(true);
  });

  it('documentation generates 11 guides and REUSES production docs for overlapping kinds', async () => {
    const clock = new ManualClock(1000);
    const rt = createEnterpriseRuntime({ clock });
    const prod = createProductionPlatform(rt, { clock });
    const infra = createInfrastructurePlatform(rt, { clock, production: prod });
    expect(infra.documentation().guideKinds().length).toBe(11);
    const sec = await infra.documentation().generate('security');
    expect(sec.reusedProduction).toBe(true);
    const cloud = await infra.documentation().generate('cloud');
    expect(cloud.reusedProduction).toBe(false);
  });
});
