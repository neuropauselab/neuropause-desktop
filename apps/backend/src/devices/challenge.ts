/**
 * Device proof-of-possession challenge: the server issues a random nonce,
 * the device signs it with its Ed25519 private key, and the server verifies
 * the signature against the device's registered public key.
 *
 * Nonces are single-use (Redis-backed) with a short TTL to prevent replay.
 */
import { randomBytes, createPublicKey, verify } from 'node:crypto';
import { redis } from '../cache/redis';
import { logger } from '../config/logger';

const CHALLENGE_PREFIX = 'devchallenge:';
const CHALLENGE_TTL = 120; // seconds

/**
 * Issues a fresh challenge nonce for a device. The nonce is stored in Redis
 * with a short TTL and deleted on first use.
 */
export async function issueChallenge(deviceId: string): Promise<string> {
  const nonce = randomBytes(32).toString('base64url');
  await redis.set(`${CHALLENGE_PREFIX}${nonce}`, deviceId, 'EX', CHALLENGE_TTL);
  return nonce;
}

/**
 * Atomic compare-and-delete: returns 1 only if the key existed AND its value
 * matched the expected deviceId, deleting it in the same atomic step. This
 * closes the GET→DEL race where two concurrent requests presenting the same
 * nonce could both observe it before either deleted it (replay-by-race).
 */
const CONSUME_SCRIPT = `
if redis.call('GET', KEYS[1]) == ARGV[1] then
  return redis.call('DEL', KEYS[1])
else
  return 0
end`;

/**
 * Consumes a challenge nonce: verifies it was issued for the given deviceId,
 * then deletes it so it cannot be replayed. Atomic — concurrent presentations
 * of the same nonce admit at most one caller.
 * Returns true if the nonce was valid and is now consumed; false otherwise.
 */
export async function consumeChallenge(nonce: string, deviceId: string): Promise<boolean> {
  const key = `${CHALLENGE_PREFIX}${nonce}`;
  const result = await redis.eval(CONSUME_SCRIPT, 1, key, deviceId);
  return result === 1;
}

/**
 * VERSIONED_DEVICE_ENROLLMENT (NP-RELEASE-044 §4) — how a public key becomes
 * bound to (org, device):
 *
 *   FIRST ENROLLMENT (no stored key): trust-on-first-use under an
 *     authenticated user with org membership — the supplied key, proven by the
 *     challenge signature, becomes the enrolled credential.
 *   RE-REGISTRATION (stored key present): the supplied key MUST equal the
 *     enrolled key; the challenge signature then proves possession of the
 *     ENROLLED credential, not merely of some key. A mismatch is refused —
 *     key rotation is not a silent re-register; it requires an owner/admin
 *     removing the device (governed) and the device re-enrolling.
 *   LEGACY ROW (stored key NULL — pre-PoP client): the next registration is
 *     the RE-ENROLLMENT_REQUIRED path: it TOFU-binds the supplied key exactly
 *     like a first enrollment. UUID-only trust is never restored.
 */
export type EnrollmentKeyDecision = 'enroll' | 'match' | 'mismatch';

export function enrollmentKeyDecision(
  storedKey: string | null | undefined,
  suppliedKey: string,
): EnrollmentKeyDecision {
  if (!storedKey) return 'enroll';
  return storedKey === suppliedKey ? 'match' : 'mismatch';
}

/**
 * Verifies an Ed25519 signature over a nonce using the device's public key.
 * @param publicKeyB64 Base64url-encoded Ed25519 public key (raw 32 bytes).
 * @param signatureB64 Base64url-encoded Ed25519 signature (64 bytes).
 * @param nonce The challenge nonce that was signed.
 * @returns true if the signature is valid.
 */
export function verifyDeviceSignature(
  publicKeyB64: string,
  signatureB64: string,
  nonce: string,
): boolean {
  try {
    const pubKeyDer = Buffer.from(publicKeyB64, 'base64url');
    if (pubKeyDer.length !== 32) return false;

    // Wrap the raw 32-byte Ed25519 public key in SPKI format for Node's crypto.
    // Ed25519 SPKI = fixed 12-byte prefix + 32-byte raw key.
    const spkiPrefix = Buffer.from('302a300506032b6570032100', 'hex');
    const spki = Buffer.concat([spkiPrefix, pubKeyDer]);
    const key = createPublicKey({ key: spki, format: 'der', type: 'spki' });

    const signature = Buffer.from(signatureB64, 'base64url');
    if (signature.length !== 64) return false;

    return verify(null, Buffer.from(nonce), key, signature);
  } catch (err) {
    logger.warn({ err }, 'Device signature verification failed');
    return false;
  }
}
