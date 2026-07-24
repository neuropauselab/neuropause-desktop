import { describe, it, expect, beforeEach } from 'vitest';
import {
  generateSigningKeyPair,
  signData,
  registerTrustedKey,
  verifySignature,
  setAllowUnsignedInstalls,
  installAllowedForSignature,
} from './signature';

/**
 * TD-2 (GA blocker) regression: marketplace package install is fail-closed.
 * Previously an *unsigned* artifact bypassed the signature gate entirely and
 * installed. Now: a valid signature from a trusted key installs; an unsigned
 * artifact is refused unless the dev/demo policy explicitly permits it; and a
 * tampered or untrusted-key signature is ALWAYS refused, even in permissive mode.
 */

const data = Buffer.from('package-digest-bytes-v1');

describe('package signature policy (TD-2 GA blocker — fail closed)', () => {
  beforeEach(() => setAllowUnsignedInstalls(false)); // reset to the secure default

  it('accepts an install with a valid signature from a trusted key', () => {
    const { publicKeyPem, privateKeyPem } = generateSigningKeyPair();
    registerTrustedKey('pub-valid', publicKeyPem);
    const sig = signData(data, privateKeyPem);
    const result = verifySignature(data, sig, 'pub-valid');
    expect(result.verified).toBe(true);
    expect(result.reason).toBe('ok');
    expect(installAllowedForSignature(result)).toBe(true);
  });

  it('REFUSES an unsigned package by default (the TD-2 fix)', () => {
    const result = verifySignature(data, null, null);
    expect(result.reason).toBe('no_signature');
    expect(installAllowedForSignature(result)).toBe(false);
  });

  it('allows an unsigned package ONLY when the dev policy explicitly permits it', () => {
    const result = verifySignature(data, null, null);
    expect(installAllowedForSignature(result)).toBe(false); // default: refused
    setAllowUnsignedInstalls(true);
    expect(installAllowedForSignature(result)).toBe(true); // dev opt-in
  });

  it('ALWAYS refuses a tampered (present-but-invalid) signature, even in permissive mode', () => {
    const { publicKeyPem, privateKeyPem } = generateSigningKeyPair();
    registerTrustedKey('pub-tamper', publicKeyPem);
    const sig = signData(data, privateKeyPem);
    const tampered = Buffer.from('different-package-bytes'); // digest no longer matches the signature
    const result = verifySignature(tampered, sig, 'pub-tamper');
    expect(result.reason).toBe('bad_signature');
    setAllowUnsignedInstalls(true); // even with the dev escape hatch on
    expect(installAllowedForSignature(result)).toBe(false);
  });

  it('ALWAYS refuses a signature from an untrusted (unregistered) key', () => {
    const { privateKeyPem } = generateSigningKeyPair(); // deliberately NOT registered
    const sig = signData(data, privateKeyPem);
    const result = verifySignature(data, sig, 'unknown-publisher');
    expect(result.reason).toBe('no_trusted_key');
    setAllowUnsignedInstalls(true);
    expect(installAllowedForSignature(result)).toBe(false);
  });
});
