import { describe, it, expect } from 'vitest';
import { ManualClock } from '@neuropause/cloud-core';
import { createEnterpriseRuntime } from '@neuropause/runtime';
import { createSecurityPlatform } from '@neuropause/security';
import { createTrustPlatform } from './platform';

describe('E3 / E4 — secrets & key management + security policy', () => {
  it('stores secret REFERENCES only and rotates keys via the reused KeyManager', async () => {
    const clock = new ManualClock(1000);
    const rt = createEnterpriseRuntime({ clock });
    const security = createSecurityPlatform(rt, { clock });
    const tp = createTrustPlatform(rt, { clock, security });

    const secret = await tp.secrets().registerSecret({ name: 'sfdc-oauth', kind: 'oauth-token', reference: 'vault:acme/sfdc', store: 'HashiCorp Vault' });
    expect(secret.store).toBe('HashiCorp Vault');
    expect(secret.reference).toBe('vault:acme/sfdc'); // a reference, never a value

    const rotation = await tp.secrets().rotateEncryptionKey('acme');
    expect(rotation.reusedKeyManager).toBe(true);
    expect(typeof rotation.newVersion).toBe('number');
    expect(tp.secrets().currentKeyVersion('acme')).toBe(rotation.newVersion);

    const key = await tp.secrets().registerApiKey({ name: 'partner-api', reference: 'vault:acme/partner' });
    await tp.secrets().revokeApiKey(key.id);
    const cert = await tp.secrets().registerCertificate({ subject: 'app.neuropause033.com', reference: 'vault:acme/tls', expiresAt: clock.now() + 86_400_000 });
    expect(cert.subject).toBe('app.neuropause033.com');
    expect(tp.secrets().externalStores()).toContain('Azure Key Vault');
  });

  it('rotation is represented (never fabricated) when no KeyManager is wired in', async () => {
    const clock = new ManualClock(1000);
    const rt = createEnterpriseRuntime({ clock });
    const tp = createTrustPlatform(rt, { clock });
    const rotation = await tp.secrets().rotateEncryptionKey('acme');
    expect(rotation.reusedKeyManager).toBe(false);
    expect(rotation.newVersion).toBeNull();
  });

  it('evaluates passwords against the configured policy — a real check', async () => {
    const clock = new ManualClock(1000);
    const rt = createEnterpriseRuntime({ clock });
    const tp = createTrustPlatform(rt, { clock });

    await tp.securityPolicy().setPasswordPolicy({ minLength: 14 });
    await tp.securityPolicy().setMfaPolicy({ required: true, methods: ['webauthn'] });

    expect(tp.securityPolicy().evaluatePassword('short').ok).toBe(false);
    const strong = tp.securityPolicy().evaluatePassword('Str0ng-Passphrase!');
    expect(strong.ok).toBe(true);
    expect(strong.failures).toHaveLength(0);
    expect(tp.securityPolicy().snapshot().mfa.required).toBe(true);
  });
});
