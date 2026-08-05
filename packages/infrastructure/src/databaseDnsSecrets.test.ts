import { describe, it, expect } from 'vitest';
import { ManualClock } from '@neuropause/cloud-core';
import { createEnterpriseRuntime } from '@neuropause/runtime';
import { createSecurityPlatform } from '@neuropause/security';
import { createDeploymentFoundation } from '@neuropause/deploy';
import { createInfrastructurePlatform } from './platform';
import { NO_INFRA_DATA } from './constants';

describe('E4, E5, E10 — database, DNS/networking, secrets activation', () => {
  it('databases are never fabricated healthy', async () => {
    const clock = new ManualClock(1000);
    const rt = createEnterpriseRuntime({ clock });
    const infra = createInfrastructurePlatform(rt, { clock });
    const db = await infra.databases().register({ engine: 'postgresql', name: 'nems-primary' });
    expect(db.health).toBe('unknown');
    expect(infra.databases().healthyCount()).toBe(0);
    expect(infra.databases().connectionHealth(db.id).health).toBe(NO_INFRA_DATA);
  });

  it('DNS/TLS/load-balancers are represented — nothing resolved, issued, or provisioned', async () => {
    const clock = new ManualClock(1000);
    const rt = createEnterpriseRuntime({ clock });
    const infra = createInfrastructurePlatform(rt, { clock });
    await infra.dns().registerDomain({ domain: 'app.nems.example.com', subdomains: ['api', 'admin'] });
    const tls = await infra.dns().registerTls({ domain: 'app.nems.example.com' });
    await infra.dns().registerLoadBalancer({ name: 'nems-edge-lb' });
    expect(tls.issued).toBe(false); // never issued without a real CA
    expect(infra.dns().issuedCertificates()).toBe(0);
    expect(infra.dns().topology().subdomains).toBe(2);
  });

  it('secrets REUSE key rotation and expose reference names only', async () => {
    const clock = new ManualClock(1000);
    const rt = createEnterpriseRuntime({ clock });
    const sec = createSecurityPlatform(rt);
    const dep = createDeploymentFoundation(rt, { clock });
    const infra = createInfrastructurePlatform(rt, { clock, security: sec, deploy: dep });
    await infra.secrets().integrate('hashicorp-vault');
    const rot = await infra.secrets().rotateKey('tenant-1');
    expect(rot.reusedSecurity).toBe(true);
    expect(typeof rot.version).toBe('number');
    const inv = infra.secrets().credentialInventory();
    expect(inv).toEqual(expect.arrayContaining(['DATABASE_URL', 'JWT_SIGNING_KEY']));
    expect(inv.every((r) => !r.includes('REPLACE'))).toBe(true); // names only, never values
  });
});
