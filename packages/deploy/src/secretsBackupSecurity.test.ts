import { describe, it, expect } from 'vitest';
import { ManualClock } from '@neuropause/cloud-core';
import { createEnterpriseRuntime } from '@neuropause/runtime';
import { createSecurityPlatform } from '@neuropause/security';
import { createProductionPlatform } from '@neuropause/production';
import { createDeploymentFoundation } from './platform';

describe('E7, E11, E14 — secrets, backup foundation, security bootstrap', () => {
  it('secrets exposes rotation policies + references only — never a value — and REUSES key rotation', async () => {
    const clock = new ManualClock(1000);
    const rt = createEnterpriseRuntime({ clock });
    const sec = createSecurityPlatform(rt);
    const prod = createProductionPlatform(rt, { clock, security: sec });
    const df = createDeploymentFoundation(rt, { clock, production: prod });

    expect(df.secrets().backend()).toBe('vault');
    expect(df.secrets().rotationPolicies().length).toBe(6);
    const refs = df.secrets().references();
    expect(refs).toEqual(expect.arrayContaining(['DATABASE_URL', 'JWT_SIGNING_KEY', 'ENCRYPTION_KEY']));
    // references are key NAMES only — no value is ever returned
    expect(refs.every((r) => !r.includes('REPLACE_ME'))).toBe(true);

    const rot = await df.secrets().rotate('tenant-1');
    expect(rot.reusedSecurity).toBe(true);
    expect(typeof rot.version).toBe('number');
  });

  it('backup foundation REUSES production backups and never claims success until validated', async () => {
    const clock = new ManualClock(1000);
    const rt = createEnterpriseRuntime({ clock });
    const prod = createProductionPlatform(rt, { clock });
    const df = createDeploymentFoundation(rt, { clock, production: prod });
    const job = await df.backups().createJob({ kind: 'database', target: 'nems-db' });
    expect(job.reusedProduction).toBe(true);
    expect(job.restoreValidated).toBe(false); // never fabricated
    const res = await df.backups().validateRestore(job.id);
    expect(res.valid).toBe(true);
    expect(df.backups().policies().retentionDays).toBe(30);
  });

  it('security bootstrap reads real posture, edge, and container security', () => {
    const clock = new ManualClock(1000);
    const rt = createEnterpriseRuntime({ clock });
    const df = createDeploymentFoundation(rt, { clock });
    const posture = df.security().posture('production');
    expect(posture.hsts).toBe(true);
    expect(posture.mfaRequired).toBe(true);
    expect(df.security().edgeFeatures()).toEqual(expect.arrayContaining(['tls', 'hsts', 'csp']));
    expect(df.security().containerSecurity()).toEqual({ runAsNonRoot: true, nonRootUser: true });
  });
});
