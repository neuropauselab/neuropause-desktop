import { describe, it, expect } from 'vitest';
import { ManualClock } from '@neuropause/cloud-core';
import { createEnterpriseRuntime } from '@neuropause/runtime';
import { createCloudOpsPlatform } from '@neuropause/cloudops';
import { createProductionPlatform } from './platform';

describe('M4–M6 — zero-downtime upgrade, backup, disaster recovery', () => {
  it('upgrade strategies produce honest step + rollback plans, shifting no real traffic', async () => {
    const clock = new ManualClock(1000);
    const rt = createEnterpriseRuntime({ clock });
    const prod = createProductionPlatform(rt, { clock });
    const canary = await prod.upgrades().plan({ strategy: 'canary', environmentId: 'e1', fromVersion: '1.0.0', toVersion: '1.1.0', canaryPercent: 5 });
    expect(canary.canaryPercent).toBe(5);
    expect(canary.rollbackSteps.length).toBeGreaterThan(0);
    expect(canary.note).toMatch(/not here/);
  });

  it('backups are never marked restorable until a real integrity check runs', async () => {
    const clock = new ManualClock(1000);
    const rt = createEnterpriseRuntime({ clock });
    const prod = createProductionPlatform(rt, { clock });
    const snap = await prod.backups().createBackup({ kind: 'database', targetId: 'db-1' });
    expect(snap.restoreValidated).toBe(false); // no fabricated success
    const result = await prod.backups().validateRestore(snap.id);
    expect(result.valid).toBe(true);
    expect(prod.backups().get(snap.id)!.restoreValidated).toBe(true);
    expect(prod.backups().validatedCount()).toBe(1);
  });

  it('DR plans REUSE cloud-ops failover; drills validate plan structure, not real failover', async () => {
    const clock = new ManualClock(1000);
    const rt = createEnterpriseRuntime({ clock });
    const cloud = createCloudOpsPlatform(rt, { clock });
    const prod = createProductionPlatform(rt, { clock, cloudops: cloud });
    const plan = await prod.disasterRecovery().createPlan({ name: 'primary-dr', drRegion: 'eu-west', rpoMinutes: 15, rtoMinutes: 60 });
    expect(plan.reusedCloudOps).toBe(true);
    const drill = await prod.disasterRecovery().drill(plan.id);
    expect(drill.planValid).toBe(true);
    expect(drill.note).toMatch(/real failover requires configured DR infrastructure/);
  });
});
