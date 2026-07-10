import { describe, expect, it } from 'vitest';
import {
  validateIntegrationProfile,
  supportsSyncMode,
  defaultSyncMode,
  objectsForSyncMode,
  describeRateLimit,
  unsupportedSyncModes,
  type EnterpriseIntegrationProfile,
} from '@neuropause/shared';

function profile(over: Partial<EnterpriseIntegrationProfile> = {}): EnterpriseIntegrationProfile {
  return {
    connectorId: 'entra',
    version: '1.0.0',
    authKinds: ['oauth2_confidential'],
    scopes: ['User.Read.All'],
    syncModes: ['full', 'incremental'],
    rateLimit: { requestsPerInterval: 10, intervalMs: 1000 },
    webhook: { supported: false, events: [] },
    healthChecks: [{ id: 'conn', label: 'Connectivity', kind: 'connectivity' }],
    supportedObjects: [
      { id: 'user', label: 'Users', kind: 'contact', syncModes: ['full', 'incremental'] },
      { id: 'group', label: 'Groups', kind: 'label', syncModes: ['full'] },
    ],
    docsUrl: 'https://docs',
    iconId: 'entra',
    ...over,
  };
}

describe('integrationManifest — validation', () => {
  it('accepts a valid profile', () => {
    expect(validateIntegrationProfile(profile())).toEqual({ ok: true, errors: [] });
  });

  it('flags missing id/version/modes', () => {
    const v = validateIntegrationProfile(profile({ connectorId: '', version: '', syncModes: [] }));
    expect(v.ok).toBe(false);
    expect(v.errors).toContain('connectorId is required');
    expect(v.errors).toContain('version is required');
    expect(v.errors).toContain('at least one syncMode is required');
  });

  it('flags an object declaring a mode the connector does not offer', () => {
    const v = validateIntegrationProfile(
      profile({ supportedObjects: [{ id: 'x', label: 'X', kind: 'contact', syncModes: ['delta'] }] }),
    );
    expect(v.ok).toBe(false);
    expect(v.errors.some((e) => e.includes('not offered'))).toBe(true);
  });

  it('flags duplicate object ids + bad rate limit + webhook without events', () => {
    const v = validateIntegrationProfile(
      profile({
        supportedObjects: [
          { id: 'dup', label: 'A', kind: 'contact', syncModes: ['full'] },
          { id: 'dup', label: 'B', kind: 'contact', syncModes: ['full'] },
        ],
        rateLimit: { requestsPerInterval: 0, intervalMs: 0 },
        webhook: { supported: true, events: [] },
      }),
    );
    expect(v.errors).toContain('duplicate supportedObject id: dup');
    expect(v.errors).toContain('rateLimit.requestsPerInterval must be > 0');
    expect(v.errors).toContain('rateLimit.intervalMs must be > 0');
    expect(v.errors).toContain('webhook.supported requires at least one event');
  });
});

describe('integrationManifest — queries', () => {
  it('supportsSyncMode + defaultSyncMode prefers incremental', () => {
    const p = profile();
    expect(supportsSyncMode(p, 'incremental')).toBe(true);
    expect(supportsSyncMode(p, 'webhook')).toBe(false);
    expect(defaultSyncMode(p)).toBe('incremental');
    expect(defaultSyncMode(profile({ syncModes: ['manual', 'full'] }))).toBe('full');
    expect(defaultSyncMode(profile({ syncModes: ['manual'] }))).toBe('manual');
  });

  it('objectsForSyncMode filters by mode', () => {
    expect(objectsForSyncMode(profile(), 'incremental').map((o) => o.id)).toEqual(['user']);
    expect(objectsForSyncMode(profile(), 'full').map((o) => o.id)).toEqual(['user', 'group']);
  });

  it('describeRateLimit + unsupportedSyncModes', () => {
    expect(describeRateLimit({ requestsPerInterval: 10, intervalMs: 1000 })).toBe('10 req / second');
    expect(describeRateLimit({ requestsPerInterval: 100, intervalMs: 60_000, burst: 20 })).toBe('100 req / 60s, burst 20');
    expect(describeRateLimit(null)).toBe('No documented rate limit');
    expect(unsupportedSyncModes(profile())).toContain('webhook');
    expect(unsupportedSyncModes(profile())).not.toContain('full');
  });
});
