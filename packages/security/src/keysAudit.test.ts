import { describe, it, expect } from 'vitest';
import { createEnterpriseRuntime } from '@neuropause/runtime';
import { ManualClock } from '@neuropause/cloud-core';
import { createSecurityPlatform } from './platform';
import { KeyManager, LocalKeyProvider, hmacSigner, ed25519Signer } from './keys';

describe('Secret & Key Management — real AES-256-GCM envelope encryption (VERIFIED)', () => {
  it('encrypts and decrypts round-trip, with a fresh DEK per message', () => {
    const km = new KeyManager(new LocalKeyProvider());
    const env = km.encrypt('acme', 'super-secret-value');
    expect(km.decrypt('acme', env)).toBe('super-secret-value');
    // fresh random DEK + IV each call ⇒ ciphertext differs for identical plaintext
    const env2 = km.encrypt('acme', 'super-secret-value');
    expect(env2.ciphertext).not.toBe(env.ciphertext);
    expect(km.decrypt('acme', env2)).toBe('super-secret-value');
  });

  it('rotates the KEK and re-wraps an existing envelope without touching the data', () => {
    const km = new KeyManager(new LocalKeyProvider());
    const env1 = km.encrypt('acme', 'ledger-row');
    expect(env1.keyVersion).toBe(1);
    const v2 = km.rotate('acme');
    expect(v2).toBe(2);
    const rewrapped = km.rewrap('acme', env1);
    expect(rewrapped.keyVersion).toBe(2);
    expect(km.decrypt('acme', rewrapped)).toBe('ledger-row');
    // the pre-rotation envelope still decrypts while v1 remains active
    expect(km.decrypt('acme', env1)).toBe('ledger-row');
  });

  it('a revoked key version cannot decrypt', () => {
    const km = new KeyManager(new LocalKeyProvider());
    const env1 = km.encrypt('acme', 'classified');
    km.rotate('acme'); // v2 becomes current
    const migrated = km.rewrap('acme', env1); // move to v2 before revoking v1
    km.revoke('acme', 1);
    expect(() => km.decrypt('acme', env1)).toThrow(/revoked/);
    // the migrated envelope under v2 still opens
    expect(km.decrypt('acme', migrated)).toBe('classified');
  });

  it('is per-tenant isolated: one tenant cannot open another tenant envelope', () => {
    const km = new KeyManager(new LocalKeyProvider());
    const envA = km.encrypt('tenant-a', 'a-only');
    // tenant-b has a different KEK ⇒ GCM auth tag fails to verify
    expect(() => km.decrypt('tenant-b', envA)).toThrow();
    expect(km.providerKind()).toBe('local');
  });
});

describe('Signers — real HMAC-SHA256 and Ed25519 (VERIFIED)', () => {
  it('HMAC signer signs and verifies, rejecting tampered data', () => {
    const s = hmacSigner('shared-secret');
    expect(s.algorithm).toBe('HMAC-SHA256');
    const sig = s.sign('payload');
    expect(s.verify('payload', sig)).toBe(true);
    expect(s.verify('payload-tampered', sig)).toBe(false);
  });

  it('Ed25519 signer produces asymmetric signatures with a public key', () => {
    const s = ed25519Signer();
    expect(s.algorithm).toBe('Ed25519');
    expect(s.publicKeyPem).toContain('BEGIN PUBLIC KEY');
    const sig = s.sign('governed-action');
    expect(s.verify('governed-action', sig)).toBe(true);
    expect(s.verify('forged-action', sig)).toBe(false);
    // a garbage signature is rejected, not thrown
    expect(s.verify('governed-action', 'not-base64!!')).toBe(false);
  });
});

describe('Audit & Governance — signed, hash-chained, tamper-evident (VERIFIED)', () => {
  it('appends signed events to the ONE runtime chain and verifies chain + signatures', async () => {
    const clock = new ManualClock(0);
    const p = createSecurityPlatform(createEnterpriseRuntime({ clock }), { clock });
    const u = await p.identity().register({ type: 'user', displayName: 'A', tenant: 'acme' });
    await p.identity().activate(u.id);
    const v = p.audit().verify();
    expect(v.chainValid).toBe(true);
    expect(v.signaturesValid).toBe(true);
    expect(v.valid).toBe(true);
    // every event carries a signature over (id:dataHash)
    for (const e of p.audit().events()) expect(p.audit().verifyEvent(e)).toBe(true);
  });

  it('detects tampering: mutating an event breaks its signature', async () => {
    const clock = new ManualClock(0);
    const p = createSecurityPlatform(createEnterpriseRuntime({ clock }), { clock });
    await p.identity().register({ type: 'user', displayName: 'A', tenant: 'acme' });
    const target = p.audit().events()[0]!;
    (target as { dataHash: string }).dataHash = 'deadbeefdeadbeef';
    expect(p.audit().verifyEvent(target)).toBe(false);
    const v = p.audit().verify();
    expect(v.signaturesValid).toBe(false);
    expect(v.valid).toBe(false);
  });

  it('supports an HMAC signer as the audit signer (swappable)', async () => {
    const clock = new ManualClock(0);
    const p = createSecurityPlatform(createEnterpriseRuntime({ clock }), { clock, signer: hmacSigner('audit-key') });
    await p.identity().register({ type: 'service-account', displayName: 'svc', tenant: 'acme' });
    expect(p.audit().verify().valid).toBe(true);
  });
});
