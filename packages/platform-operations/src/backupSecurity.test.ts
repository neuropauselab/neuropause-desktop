import { describe, it, expect } from 'vitest';
import { ManualClock } from '@neuropause/cloud-core';
import { createEnterpriseRuntime } from '@neuropause/runtime';
import { createSecurityPlatform } from '@neuropause/security';
import { createInfrastructurePlatform } from '@neuropause/infrastructure';
import { createProductionPlatform } from '@neuropause/production';
import { createReliabilityPlatform } from '@neuropause/reliability';
import { createPlatformOperations } from './platform';

describe('E12 / E13 — backup & recovery + production security', () => {
  it('backs up via production and validates DR via the reused reliability recovery engine', async () => {
    const clock = new ManualClock(1000);
    const rt = createEnterpriseRuntime({ clock });
    const prod = createProductionPlatform(rt, { clock });
    const reliability = createReliabilityPlatform(rt, { clock, production: prod });
    const ops = createPlatformOperations(rt, { clock, production: prod, reliability });

    const backup = await ops.backupRecovery().backup({ targetId: 'nems-primary', kind: 'database' });
    expect(backup.reusedProduction).toBe(true);
    expect(backup.restoreValidated).toBe(true);
    const dr = await ops.backupRecovery().validateDisasterRecovery({ targetId: 'nems-primary' });
    expect(dr.reusedReliability).toBe(true);
    expect(dr.recovered).toBe(true);
  });

  it('rotates a REAL key via security and never issues certificates without a real issuance', async () => {
    const clock = new ManualClock(1000);
    const rt = createEnterpriseRuntime({ clock });
    const sec = createSecurityPlatform(rt, { clock });
    const infra = createInfrastructurePlatform(rt, { clock, security: sec });
    const ops = createPlatformOperations(rt, { clock, security: sec, infrastructure: infra });

    const vault = await ops.security().integrateVault();
    expect(vault.reusedInfrastructure).toBe(true);
    const rot1 = await ops.security().rotateSecret('acme');
    const rot2 = await ops.security().rotateSecret('acme');
    expect(rot1.reusedSecurity).toBe(true);
    expect(rot2.version!).toBeGreaterThan(rot1.version!); // real key-version bump

    expect(ops.security().certificateLifecycle().issued).toBe(0); // no cert issued
    expect(ops.security().containerVerification().verified).toBe(false); // infra-pending
    expect(ops.security().runtimePolicy().enforced).toBe(false);
  });
});
