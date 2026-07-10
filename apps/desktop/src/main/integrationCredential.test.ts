import { describe, expect, it } from 'vitest';
import {
  isCredentialExpired,
  credentialExpiresInMs,
  credentialNeedsRotation,
  credentialAuthState,
  validateCredentialMeta,
  redactSecret,
  credentialsFromTokens,
  credentialAuthKind,
  type IntegrationCredentialMeta,
} from '@neuropause/shared';

const NOW = 1_000_000_000_000;

function meta(over: Partial<IntegrationCredentialMeta> = {}): IntegrationCredentialMeta {
  return {
    kind: 'oauth_access',
    connectorId: 'c',
    accountId: 'a',
    expiresAt: NOW + 3_600_000,
    issuedAt: NOW,
    scopes: ['s'],
    rotationIntervalMs: null,
    lastRotatedAt: null,
    fingerprint: null,
    ...over,
  };
}

describe('integrationCredential — expiry + rotation', () => {
  it('tracks expiry', () => {
    expect(isCredentialExpired(meta({ expiresAt: NOW - 1 }), NOW)).toBe(true);
    expect(isCredentialExpired(meta({ expiresAt: NOW + 1 }), NOW)).toBe(false);
    expect(isCredentialExpired(meta({ expiresAt: null }), NOW)).toBe(false);
    expect(credentialExpiresInMs(meta({ expiresAt: NOW + 5000 }), NOW)).toBe(5000);
    expect(credentialExpiresInMs(meta({ expiresAt: null }), NOW)).toBeNull();
  });

  it('classifies auth state with skew', () => {
    expect(credentialAuthState(meta({ expiresAt: null }), NOW)).toBe('authorized');
    expect(credentialAuthState(meta({ expiresAt: NOW - 1 }), NOW)).toBe('reauth_required');
    expect(credentialAuthState(meta({ expiresAt: NOW + 30_000 }), NOW)).toBe('expiring');
    expect(credentialAuthState(meta({ expiresAt: NOW + 3_600_000 }), NOW)).toBe('authorized');
  });

  it('schedules rotation', () => {
    expect(credentialNeedsRotation(meta({ rotationIntervalMs: null }), NOW)).toBe(false);
    expect(credentialNeedsRotation(meta({ rotationIntervalMs: 1000, lastRotatedAt: NOW - 2000 }), NOW)).toBe(true);
    expect(credentialNeedsRotation(meta({ rotationIntervalMs: 1000, lastRotatedAt: NOW - 500 }), NOW)).toBe(false);
    expect(credentialNeedsRotation(meta({ rotationIntervalMs: 1000, lastRotatedAt: null, issuedAt: null }), NOW)).toBe(true);
  });
});

describe('integrationCredential — validation + redaction + projection', () => {
  it('validates metadata', () => {
    expect(validateCredentialMeta(meta()).ok).toBe(true);
    expect(validateCredentialMeta(meta({ connectorId: '', rotationIntervalMs: -1 })).errors.length).toBeGreaterThan(0);
  });

  it('never returns plaintext', () => {
    expect(redactSecret('sk_live_abcdef1234')).toBe('••••1234');
    expect(redactSecret('short')).toBe('••••');
    expect(redactSecret(null)).toBe('••••');
    expect(redactSecret('sk_live_abcdef1234')).not.toContain('abcdef');
  });

  it('projects metadata from vault tokens without copying secrets', () => {
    const creds = credentialsFromTokens('c', 'a', {
      accessToken: 'ATSECRET',
      refreshToken: 'RTSECRET',
      expiresAt: NOW + 1000,
      scopes: ['x'],
      tokenType: 'Bearer',
    });
    expect(creds.map((c) => c.kind)).toEqual(['oauth_access', 'oauth_refresh']);
    expect(creds[0].expiresAt).toBe(NOW + 1000);
    const serialized = JSON.stringify(creds);
    expect(serialized).not.toContain('ATSECRET');
    expect(serialized).not.toContain('RTSECRET');
    const single = credentialsFromTokens('c', 'a', {
      accessToken: 'AT',
      refreshToken: null,
      expiresAt: null,
      scopes: [],
      tokenType: 'Bearer',
    });
    expect(single).toHaveLength(1);
  });

  it('maps credential kind to auth kind', () => {
    expect(credentialAuthKind('api_key')).toBe('api_key');
    expect(credentialAuthKind('certificate')).toBe('certificate');
    expect(credentialAuthKind('oauth_access')).toBe('oauth2_pkce');
  });
});
