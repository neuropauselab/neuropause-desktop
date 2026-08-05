import { describe, it, expect } from 'vitest';
import { ManualClock } from '@neuropause/cloud-core';
import { createEnterpriseRuntime } from '@neuropause/runtime';
import { createSecurityPlatform } from '@neuropause/security';
import { createInfrastructurePlatform } from '@neuropause/infrastructure';
import { createProductionPlatform } from '@neuropause/production';
import { createPlatformOperations } from './platform';
import { TARGET_DOMAIN } from './constants';

describe('E3 / E5 — databases + networking', () => {
  it('registers databases via infrastructure with UNKNOWN health, and validates backups via production', async () => {
    const clock = new ManualClock(1000);
    const rt = createEnterpriseRuntime({ clock });
    const sec = createSecurityPlatform(rt, { clock });
    const infra = createInfrastructurePlatform(rt, { clock, security: sec });
    const prod = createProductionPlatform(rt, { clock });
    const ops = createPlatformOperations(rt, { clock, infrastructure: infra, production: prod });

    const db = await ops.databases().register({ engine: 'postgresql', name: 'nems-primary', replicas: 2 });
    expect(db.reusedInfrastructure).toBe(true);
    expect(db.health).toBe('unknown'); // never fabricated healthy
    expect(ops.databases().connectionHealth(db.id).live).toBe(false);

    const backup = await ops.databases().validateBackup(db.id);
    expect(backup.reusedProduction).toBe(true);
    expect(backup.restoreValidated).toBe(true); // production record-integrity check
  });

  it('reports the target domain as NOT live and TLS as not issued', async () => {
    const clock = new ManualClock(1000);
    const rt = createEnterpriseRuntime({ clock });
    const sec = createSecurityPlatform(rt, { clock });
    const infra = createInfrastructurePlatform(rt, { clock, security: sec });
    const ops = createPlatformOperations(rt, { clock, infrastructure: infra });

    await ops.networking().declare({ component: 'dns', detail: `${TARGET_DOMAIN} A record` });
    const status = ops.networking().domainStatus();
    expect(status.domain).toBe(TARGET_DOMAIN);
    expect(status.live).toBe(false); // the domain is NOT live
    expect(status.tlsIssued).toBe(false); // no real certificate issued
    expect(status.dnsConfigured).toBe(true); // a descriptor exists, but that is not "live"
  });
});
