import { describe, it, expect, beforeEach } from 'vitest';
import { createEnterpriseRuntime } from '@neuropause/runtime';
import { ManualClock } from '@neuropause/cloud-core';
import { createSecurityPlatform, type SecurityPlatform } from './platform';
import { totpCode, pkceVerifier, pkceChallenge, verifyPkce, generatePasskey } from './authn';

function platform(clock: ManualClock): SecurityPlatform {
  return createSecurityPlatform(createEnterpriseRuntime({ clock }), { clock });
}

describe('Authentication factors (real crypto — VERIFIED)', () => {
  let clock: ManualClock;
  let p: SecurityPlatform;
  beforeEach(() => {
    clock = new ManualClock(1_700_000_000_000);
    p = platform(clock);
  });

  it('TOTP: verifies a code now and rejects it once the window passes', async () => {
    const { secret } = await p.authentication().enrollTotp('usr_1');
    const code = totpCode(secret, clock.now());
    expect(await p.authentication().verifyMfa('usr_1', code)).toBe(true);
    clock.advance(120_000); // beyond the ±1 step window
    expect(await p.authentication().verifyMfa('usr_1', code)).toBe(false);
  });

  it('PKCE: S256 challenge verifies only for its verifier', () => {
    const v = pkceVerifier();
    const c = pkceChallenge(v);
    expect(verifyPkce(v, c)).toBe(true);
    expect(verifyPkce(pkceVerifier(), c)).toBe(false);
  });

  it('recovery codes are single-use', async () => {
    const codes = await p.authentication().generateRecoveryCodes('usr_1', 3);
    expect(await p.authentication().useRecoveryCode('usr_1', codes[0]!)).toBe(true);
    expect(await p.authentication().useRecoveryCode('usr_1', codes[0]!)).toBe(false); // reused
    expect(await p.authentication().useRecoveryCode('usr_1', 'bogus')).toBe(false);
  });

  it('API tokens hash at rest, verify, and revoke', async () => {
    const { token } = await p.authentication().issueToken('usr_1', 'ci');
    expect(p.authentication().verifyToken(token)).toBe('usr_1');
    await p.authentication().revokeToken(token);
    expect(p.authentication().verifyToken(token)).toBeUndefined();
  });

  it('magic links are single-use and expire', async () => {
    const { token } = await p.authentication().issueMagicLink('usr_1', 1000);
    expect(p.authentication().verifyMagicLink(token)).toBe('usr_1');
    expect(p.authentication().verifyMagicLink(token)).toBeUndefined(); // single use
    const later = await p.authentication().issueMagicLink('usr_1', 1000);
    clock.advance(2000);
    expect(p.authentication().verifyMagicLink(later.token)).toBeUndefined(); // expired
  });

  it('WebAuthn: verifies an Ed25519 assertion over the challenge', async () => {
    const key = generatePasskey();
    p.authentication().registerPasskey('usr_1', key.publicKeyPem);
    const challenge = p.authentication().newChallenge('usr_1');
    expect(await p.authentication().verifyAssertion('usr_1', challenge, key.sign(challenge))).toBe(true);
    const challenge2 = p.authentication().newChallenge('usr_1');
    expect(await p.authentication().verifyAssertion('usr_1', challenge2, key.sign('wrong'))).toBe(false);
  });
});

describe('Session management — idle + absolute timeout, rotation, revocation', () => {
  it('enforces both timeouts, rotates, and revokes', async () => {
    const clock = new ManualClock(0);
    const p = createSecurityPlatform(createEnterpriseRuntime({ clock }), { clock, sessionPolicy: { idleTimeoutMs: 1000, absoluteTimeoutMs: 5000 } });
    const s = await p.sessions().create({ identityId: 'usr_1', tenant: 'acme' });
    expect(p.sessions().validate(s.id).valid).toBe(true);
    clock.advance(1500); // idle window exceeded
    expect(p.sessions().validate(s.id).reason).toBe('idle-timeout');

    const s2 = await p.sessions().create({ identityId: 'usr_1', tenant: 'acme' });
    for (let i = 0; i < 5; i++) {
      clock.advance(900);
      expect(p.sessions().validate(s2.id).valid).toBe(true); // keep sliding the idle window; stays valid
    }
    clock.advance(600); // cross the absolute cap while still inside the idle window
    expect(p.sessions().validate(s2.id).reason).toBe('absolute-timeout'); // absolute cap hit

    const s3 = await p.sessions().create({ identityId: 'usr_1', tenant: 'acme' });
    const rotated = await p.sessions().rotate(s3.id);
    expect(p.sessions().validate(s3.id).reason).toBe('revoked'); // old id dead
    expect(p.sessions().validate(rotated.id).valid).toBe(true);
    await p.sessions().revoke(rotated.id);
    expect(p.sessions().validate(rotated.id).reason).toBe('revoked');
  });
});
