/**
 * P3.0 Increment 3 — HS256 JWT tests: round-trip, wrong-secret + tamper rejection,
 * expiry, and malformed input (never throws).
 */
import { describe, expect, it } from 'vitest';
import { signJwt, verifyJwt } from './jwt';

const SECRET = 'test-signing-secret-0123456789';

describe('signJwt / verifyJwt', () => {
  it('round-trips claims with a valid signature', () => {
    const token = signJwt({ sub: 'dev1', scopes: ['records:read'], exp: 9_999_999_999 }, SECRET);
    const claims = verifyJwt(token, SECRET, 1_000);
    expect(claims?.sub).toBe('dev1');
    expect(claims?.scopes).toEqual(['records:read']);
  });

  it('rejects a wrong secret', () => {
    const token = signJwt({ sub: 'dev1', exp: 9_999_999_999 }, SECRET);
    expect(verifyJwt(token, 'a-different-secret', 1_000)).toBeNull();
  });

  it('rejects a tampered payload (signature no longer matches)', () => {
    const token = signJwt({ sub: 'dev1', exp: 9_999_999_999 }, SECRET);
    const [header, , sig] = token.split('.');
    const forgedPayload = Buffer.from(JSON.stringify({ sub: 'admin', exp: 9_999_999_999 }), 'utf8').toString('base64url');
    expect(verifyJwt(`${header}.${forgedPayload}.${sig}`, SECRET, 1_000)).toBeNull();
  });

  it('rejects expired and malformed tokens without throwing', () => {
    const expired = signJwt({ sub: 'dev1', exp: 100 }, SECRET); // exp = 100s
    expect(verifyJwt(expired, SECRET, 200_000)).toBeNull(); // now = 200s
    expect(verifyJwt(expired, SECRET, 50_000)).not.toBeNull(); // now = 50s (still valid)
    expect(verifyJwt('not.a.jwt.token', SECRET, 1_000)).toBeNull();
    expect(verifyJwt('only-one-part', SECRET, 1_000)).toBeNull();
  });
});
