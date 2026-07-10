import { describe, expect, it } from 'vitest';
import {
  INTEGRATION_SYNC_MODES,
  INTEGRATION_AUTH_KINDS,
  isIntegrationSyncMode,
  isIntegrationAuthKind,
  isOAuthKind,
} from '@neuropause/shared';

describe('integrationSdk — vocabulary guards', () => {
  it('recognizes valid sync modes', () => {
    expect(isIntegrationSyncMode('incremental')).toBe(true);
    expect(isIntegrationSyncMode('nope')).toBe(false);
    expect(INTEGRATION_SYNC_MODES).toContain('webhook');
    expect(INTEGRATION_SYNC_MODES).toHaveLength(6);
  });

  it('recognizes valid auth kinds and OAuth kinds', () => {
    expect(isIntegrationAuthKind('api_key')).toBe(true);
    expect(isIntegrationAuthKind('nope')).toBe(false);
    expect(isOAuthKind('oauth2_pkce')).toBe(true);
    expect(isOAuthKind('oauth2_confidential')).toBe(true);
    expect(isOAuthKind('api_key')).toBe(false);
    expect(INTEGRATION_AUTH_KINDS).toContain('certificate');
  });
});
