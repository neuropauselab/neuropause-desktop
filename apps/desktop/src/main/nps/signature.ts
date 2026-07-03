/**
 * Digital signature verification for packages, using Ed25519 from Node's crypto
 * module (no third-party dependency). Publishers sign the package digest with a
 * private key; the host verifies against a trusted public key registered for
 * that key id.
 *
 * The crypto here is real and complete. What is intentionally minimal for now
 * is the *trust store*: until publishers ship signed artifacts, no real public
 * keys are registered, so verification of unsigned releases returns a clear,
 * policy-driven result rather than a hard failure. This is the seam that
 * activates the moment a real signing pipeline exists.
 */
import { createPrivateKey, createPublicKey, generateKeyPairSync, sign, verify } from 'node:crypto';

export interface SignatureResult {
  verified: boolean;
  /** 'ok' | 'no_signature' | 'no_trusted_key' | 'bad_signature' | 'error' */
  reason: string;
}

/** key id -> PEM public key. Populated when a real signing pipeline is wired. */
const trustStore = new Map<string, string>();

export function registerTrustedKey(keyId: string, publicKeyPem: string): void {
  trustStore.set(keyId, publicKeyPem);
}

export function hasTrustedKey(keyId: string): boolean {
  return trustStore.has(keyId);
}

/**
 * Verifies a detached Ed25519 signature over `data`.
 * @param data the signed bytes (typically the package digest)
 * @param signatureB64 base64 detached signature
 * @param keyId the publisher key id the release claims
 */
export function verifySignature(
  data: Buffer | Uint8Array,
  signatureB64: string | null,
  keyId: string | null,
): SignatureResult {
  if (!signatureB64) return { verified: false, reason: 'no_signature' };
  if (!keyId || !trustStore.has(keyId)) return { verified: false, reason: 'no_trusted_key' };
  try {
    const pub = createPublicKey(trustStore.get(keyId) as string);
    const ok = verify(null, Buffer.from(data), pub, Buffer.from(signatureB64, 'base64'));
    return { verified: ok, reason: ok ? 'ok' : 'bad_signature' };
  } catch {
    return { verified: false, reason: 'error' };
  }
}

/* ── Signing helpers (used by the Developer SDK signing tool in Part B) ── */

export interface KeyPairPem {
  publicKeyPem: string;
  privateKeyPem: string;
}

export function generateSigningKeyPair(): KeyPairPem {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  return {
    publicKeyPem: publicKey.export({ type: 'spki', format: 'pem' }).toString(),
    privateKeyPem: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
  };
}

export function signData(data: Buffer | Uint8Array, privateKeyPem: string): string {
  const key = createPrivateKey(privateKeyPem);
  return sign(null, Buffer.from(data), key).toString('base64');
}
