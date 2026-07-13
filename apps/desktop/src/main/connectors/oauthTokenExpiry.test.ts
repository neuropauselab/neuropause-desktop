/**
 * P5 — Increment 8: the access-token expiry synthesis that lets a provider which omits `expires_in` but
 * issues short-lived tokens (Salesforce) still participate in proactive refresh. `expires_in` always wins;
 * the manifest `accessTokenTtlSeconds` is the fallback; neither ⇒ null (every other connector unchanged).
 */
import { describe, expect, it } from 'vitest';
import { computeExpiresAt } from './oauthTokens';
import { MANIFEST_BY_ID } from './manifests';

const NOW = 1_700_000_000_000;

describe('computeExpiresAt — proactive-refresh arming for expires_in-less providers', () => {
  it('uses the provider expires_in when present (standard OAuth path)', () => {
    expect(computeExpiresAt(3600, null, NOW)).toBe(NOW + 3_600_000);
  });

  it('falls back to the manifest TTL when expires_in is absent (Salesforce)', () => {
    expect(computeExpiresAt(undefined, 600, NOW)).toBe(NOW + 600_000);
  });

  it('prefers expires_in even when a TTL is also configured', () => {
    expect(computeExpiresAt(120, 600, NOW)).toBe(NOW + 120_000);
  });

  it('stays null when neither is present — the pre-existing behavior for every other connector', () => {
    expect(computeExpiresAt(undefined, null, NOW)).toBeNull();
    expect(computeExpiresAt(undefined, 0, NOW)).toBeNull(); // a non-positive ttl never synthesizes
  });

  it('the Salesforce manifest carries a sub-sync-interval TTL so the token is refreshed each cycle', () => {
    const sf = MANIFEST_BY_ID['salesforce'];
    expect(sf?.oauth?.accessTokenTtlSeconds).toBe(600);
    // openid is required for the userinfo instance-resolution call; refresh_token for the proactive path.
    expect(sf?.oauth?.scopes).toEqual(expect.arrayContaining(['api', 'refresh_token', 'openid']));
  });
});
