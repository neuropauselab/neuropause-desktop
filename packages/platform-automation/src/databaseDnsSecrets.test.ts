import { describe, it, expect } from 'vitest';
import { ManualClock } from '@neuropause/cloud-core';
import { createEnterpriseRuntime } from '@neuropause/runtime';
import { createPlatformAutomation } from './platform';

describe('E4 / E5 / E6 — database, DNS/TLS, and secrets automation', () => {
  it('generates database descriptors without provisioning anything', async () => {
    const clock = new ManualClock(1000);
    const rt = createEnterpriseRuntime({ clock });
    const pa = createPlatformAutomation(rt, { clock });

    const desc = pa.database().descriptor('production');
    expect(desc.provisioned).toBe(false); // never auto-provisioned
    expect((desc.postgresql as { version: string }).version).toBe('16');
    expect((desc.redis as { version: string }).version).toBe('7');
    const artifact = await pa.database().generateAll('production');
    expect(artifact.content).toContain('scripts/backup-db.sh'); // reuses the existing backup script
    expect(artifact.content).toContain('kind: CronJob');
  });

  it('generates DNS + cert-manager descriptors that publish/issue nothing', async () => {
    const clock = new ManualClock(1000);
    const rt = createEnterpriseRuntime({ clock });
    const pa = createPlatformAutomation(rt, { clock });

    const dns = pa.dnsTls().dnsRecords({ host: 'api.example.com', target: '203.0.113.10' });
    expect(dns.published).toBe(false);
    const artifact = await pa.dnsTls().generateAll({ host: 'api.example.com', target: '203.0.113.10', email: 'ops@example.com' });
    expect(artifact.content).toContain('ClusterIssuer');
    expect(artifact.content).toContain('kind: Certificate');
    expect(pa.dnsTls().verificationCommands('api.example.com').some((c) => c.startsWith('dig'))).toBe(true);
  });

  it('generates a SecretStore per backend and NEVER emits a secret value', async () => {
    const clock = new ManualClock(1000);
    const rt = createEnterpriseRuntime({ clock });
    const pa = createPlatformAutomation(rt, { clock });

    for (const backend of pa.secrets().backends()) {
      const artifact = await pa.secrets().generateAll(backend);
      expect(artifact.content).toContain('kind: SecretStore');
      // references only — remoteRef keys, never inline secret material
      expect(artifact.content).not.toMatch(/JWT_ACCESS_SECRET:\s*["']?[A-Za-z0-9+/]{16,}/);
    }
    const rotation = pa.secrets().rotationPolicy();
    expect(Array.isArray(rotation.rotation)).toBe(true);
  });
});
