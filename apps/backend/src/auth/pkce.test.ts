import { describe, expect, it } from 'vitest';
import { createPkcePair, hashToken, randomToken, sha256Base64url, verifyPkce } from './pkce';

describe('pkce', () => {
  it('produces a verifier whose S256 challenge matches', () => {
    const { verifier, challenge } = createPkcePair();
    expect(challenge).toBe(sha256Base64url(verifier));
    expect(verifyPkce(verifier, challenge)).toBe(true);
  });

  it('rejects a mismatched verifier', () => {
    const { challenge } = createPkcePair();
    expect(verifyPkce('not-the-verifier', challenge)).toBe(false);
  });

  it('emits url-safe tokens with no padding', () => {
    const token = randomToken(32);
    expect(token).not.toMatch(/[+/=]/);
  });

  it('hashes tokens deterministically', () => {
    expect(hashToken('abc')).toBe(hashToken('abc'));
    expect(hashToken('abc')).not.toBe(hashToken('abd'));
  });
});
