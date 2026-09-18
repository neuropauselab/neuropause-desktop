import { describe, it, expect, vi, beforeEach } from 'vitest';
import { generateKeyPairSync, sign } from 'node:crypto';

// Mock Redis for challenge nonce storage. `eval` mirrors the atomic
// compare-and-delete Lua script used by consumeChallenge: synchronous over the
// map, so it is atomic with respect to concurrent async callers exactly as the
// real script is atomic within Redis.
const redisStore = new Map<string, string>();
vi.mock('../cache/redis', () => ({
  redis: {
    async get(key: string): Promise<string | null> {
      return redisStore.get(key) ?? null;
    },
    async set(key: string, value: string): Promise<string> {
      redisStore.set(key, value);
      return 'OK';
    },
    async del(key: string): Promise<number> {
      return redisStore.delete(key) ? 1 : 0;
    },
    async eval(_script: string, _numKeys: number, key: string, expected: string): Promise<number> {
      if (redisStore.get(key) === expected) {
        redisStore.delete(key);
        return 1;
      }
      return 0;
    },
  },
}));

vi.mock('../config/logger', () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

import {
  issueChallenge,
  consumeChallenge,
  enrollmentKeyDecision,
  verifyDeviceSignature,
} from './challenge';

/** Helper: generate an Ed25519 keypair and return base64url-encoded raw keys. */
function generateTestKeypair() {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const rawPub = publicKey.export({ type: 'spki', format: 'der' }).subarray(12); // strip SPKI prefix
  return {
    publicKeyB64: rawPub.toString('base64url'),
    privateKey,
  };
}

describe('device challenge / proof-of-possession', () => {
  beforeEach(() => {
    redisStore.clear();
  });

  it('issueChallenge returns a nonce and stores it for the device', async () => {
    const nonce = await issueChallenge('device-1');
    expect(typeof nonce).toBe('string');
    expect(nonce.length).toBeGreaterThan(10);
  });

  it('consumeChallenge succeeds for the correct device and consumes the nonce', async () => {
    const nonce = await issueChallenge('device-1');
    expect(await consumeChallenge(nonce, 'device-1')).toBe(true);
    // Second consumption fails (replay protection).
    expect(await consumeChallenge(nonce, 'device-1')).toBe(false);
  });

  it('consumeChallenge fails for a different device', async () => {
    const nonce = await issueChallenge('device-1');
    expect(await consumeChallenge(nonce, 'device-2')).toBe(false);
  });

  it('consumeChallenge fails for an unknown nonce', async () => {
    expect(await consumeChallenge('bogus-nonce', 'device-1')).toBe(false);
  });

  it('concurrent consumption of the same nonce admits at most one caller (replay-by-race)', async () => {
    const nonce = await issueChallenge('device-1');
    const results = await Promise.all([
      consumeChallenge(nonce, 'device-1'),
      consumeChallenge(nonce, 'device-1'),
      consumeChallenge(nonce, 'device-1'),
    ]);
    expect(results.filter(Boolean)).toHaveLength(1);
  });

  it('verifyDeviceSignature accepts a valid Ed25519 signature', () => {
    const { publicKeyB64, privateKey } = generateTestKeypair();
    const nonce = 'test-challenge-nonce';
    const signature = sign(null, Buffer.from(nonce), privateKey);
    const sigB64 = signature.toString('base64url');

    expect(verifyDeviceSignature(publicKeyB64, sigB64, nonce)).toBe(true);
  });

  it('verifyDeviceSignature rejects a wrong key', () => {
    const { privateKey } = generateTestKeypair();
    const { publicKeyB64: otherPub } = generateTestKeypair(); // different key
    const nonce = 'test-nonce';
    const signature = sign(null, Buffer.from(nonce), privateKey);
    const sigB64 = signature.toString('base64url');

    expect(verifyDeviceSignature(otherPub, sigB64, nonce)).toBe(false);
  });

  it('verifyDeviceSignature rejects a wrong nonce (replay)', () => {
    const { publicKeyB64, privateKey } = generateTestKeypair();
    const nonce = 'correct-nonce';
    const signature = sign(null, Buffer.from(nonce), privateKey);
    const sigB64 = signature.toString('base64url');

    expect(verifyDeviceSignature(publicKeyB64, sigB64, 'wrong-nonce')).toBe(false);
  });

  it('verifyDeviceSignature rejects a truncated signature', () => {
    const { publicKeyB64 } = generateTestKeypair();
    expect(verifyDeviceSignature(publicKeyB64, 'dG9vc2hvcnQ', 'nonce')).toBe(false);
  });

  it('verifyDeviceSignature rejects a truncated public key', () => {
    expect(verifyDeviceSignature('dG9vc2hvcnQ', 'c2lnbmF0dXJl'.repeat(6), 'nonce')).toBe(false);
  });

  describe('enrollment key binding (NP-RELEASE-044 §4 — VERSIONED_DEVICE_ENROLLMENT)', () => {
    it('first enrollment (no stored key) => enroll (TOFU under authenticated member)', () => {
      expect(enrollmentKeyDecision(null, 'key-A')).toBe('enroll');
      expect(enrollmentKeyDecision(undefined, 'key-A')).toBe('enroll');
    });

    it('legacy row (NULL key) => enroll — the RE-ENROLLMENT_REQUIRED path, never UUID-only trust', () => {
      expect(enrollmentKeyDecision(null, 'key-A')).toBe('enroll');
    });

    it('re-registration with the enrolled key => match (possession of the enrolled credential)', () => {
      expect(enrollmentKeyDecision('key-A', 'key-A')).toBe('match');
    });

    it('re-registration with a DIFFERENT key => mismatch (refused; rotation is a governed remove + re-enroll)', () => {
      expect(enrollmentKeyDecision('key-A', 'key-B')).toBe('mismatch');
    });
  });
});
