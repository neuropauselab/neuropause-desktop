import { describe, it, expect } from 'vitest';
import { createPublicKey, verify } from 'node:crypto';
import { generateDeviceKeypair, signChallenge } from './deviceKeys';

/**
 * NP-047 / B HIGH-3 — client/server contract test. This mirrors the backend's
 * verifier (apps/backend/src/devices/challenge.ts verifyDeviceSignature)
 * byte-for-byte: raw 32-byte key re-wrapped in SPKI, signature over the utf8
 * nonce. If either side changes shape, this breaks here instead of as an
 * HTTP 400 on every registration in production.
 */
function serverVerify(publicKeyB64: string, signatureB64: string, nonce: string): boolean {
  const pubKeyRaw = Buffer.from(publicKeyB64, 'base64url');
  if (pubKeyRaw.length !== 32) return false;
  const spkiPrefix = Buffer.from('302a300506032b6570032100', 'hex');
  const key = createPublicKey({
    key: Buffer.concat([spkiPrefix, pubKeyRaw]),
    format: 'der',
    type: 'spki',
  });
  const signature = Buffer.from(signatureB64, 'base64url');
  if (signature.length !== 64) return false;
  return verify(null, Buffer.from(nonce), key, signature);
}

describe('deviceKeys — client side of the PoP contract', () => {
  it('generates a keypair whose public key is exactly 32 raw bytes, base64url', () => {
    const { publicKeyB64 } = generateDeviceKeypair();
    expect(Buffer.from(publicKeyB64, 'base64url')).toHaveLength(32);
    // Fits the backend schema: publicKey min 32 / max 128 chars.
    expect(publicKeyB64.length).toBeGreaterThanOrEqual(32);
    expect(publicKeyB64.length).toBeLessThanOrEqual(128);
  });

  it('signChallenge produces a signature the SERVER verifier accepts', () => {
    const { publicKeyB64, privateKeyPem } = generateDeviceKeypair();
    const nonce = 'c'.repeat(43); // shape of the server's 32-byte base64url nonce
    const sig = signChallenge(privateKeyPem, nonce);
    expect(serverVerify(publicKeyB64, sig, nonce)).toBe(true);
    // Fits the backend schema: challengeSignature min 64 / max 256 chars.
    expect(sig.length).toBeGreaterThanOrEqual(64);
    expect(sig.length).toBeLessThanOrEqual(256);
  });

  it('a different keypair does NOT verify (wrong key rejected server-side)', () => {
    const a = generateDeviceKeypair();
    const b = generateDeviceKeypair();
    const sig = signChallenge(a.privateKeyPem, 'nonce-x');
    expect(serverVerify(b.publicKeyB64, sig, 'nonce-x')).toBe(false);
  });

  it('a different nonce does NOT verify (replay rejected server-side)', () => {
    const { publicKeyB64, privateKeyPem } = generateDeviceKeypair();
    const sig = signChallenge(privateKeyPem, 'nonce-1');
    expect(serverVerify(publicKeyB64, sig, 'nonce-2')).toBe(false);
  });
});
