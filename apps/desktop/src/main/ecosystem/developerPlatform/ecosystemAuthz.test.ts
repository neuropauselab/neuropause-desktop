/**
 * P12 — Ecosystem RBAC tests. Locks the "no unguarded ecosystem channel" invariant: every
 * invokable ecosystem channel (the existing ecosystem:* surface + the P12 ecosystem:devplatform.*
 * layer) must carry a real developer:* permission, and the annotator must stamp requireAuth +
 * permission.
 */
import { describe, expect, it } from 'vitest';
import type { IpcChannelName } from '@neuropause/shared';
import { ALL_ENTERPRISE_PERMISSIONS, IpcChannel, RUNTIME_INVOKABLE_CHANNELS } from '@neuropause/shared';
import { ECOSYSTEM_CHANNEL_PERMISSIONS, withEcosystemAuthz } from './ecosystemAuthz';

describe('ECOSYSTEM_CHANNEL_PERMISSIONS', () => {
  const ecosystemInvokable = RUNTIME_INVOKABLE_CHANNELS.filter((c) => c.startsWith('ecosystem:'));

  it('classifies every invokable ecosystem channel — none unguarded', () => {
    const map = new Set<string>(Object.keys(ECOSYSTEM_CHANNEL_PERMISSIONS));
    for (const channel of ecosystemInvokable) {
      expect(map.has(channel), `unguarded ecosystem channel: ${channel}`).toBe(true);
    }
    // And the map references no non-existent / non-ecosystem channel.
    const known = new Set<string>(ecosystemInvokable);
    for (const c of map) expect(known.has(c), `stale mapping: ${c}`).toBe(true);
  });

  it('uses only real developer permission scopes', () => {
    const valid = new Set<string>(ALL_ENTERPRISE_PERMISSIONS);
    for (const p of Object.values(ECOSYSTEM_CHANNEL_PERMISSIONS)) {
      expect(p).toMatch(/^developer:/);
      expect(valid.has(p as string)).toBe(true);
    }
  });

  it('maps reads to developer:read and mutations to developer:manage', () => {
    expect(ECOSYSTEM_CHANNEL_PERMISSIONS[IpcChannel.EcosystemDeveloperDashboard]).toBe('developer:read');
    expect(ECOSYSTEM_CHANNEL_PERMISSIONS[IpcChannel.DevPlatformOverview]).toBe('developer:read');
    expect(ECOSYSTEM_CHANNEL_PERMISSIONS[IpcChannel.EcosystemKeysCreate]).toBe('developer:manage');
    expect(ECOSYSTEM_CHANNEL_PERMISSIONS[IpcChannel.EcosystemListingPublish]).toBe('developer:manage');
    expect(ECOSYSTEM_CHANNEL_PERMISSIONS[IpcChannel.EcosystemOAuthToken]).toBe('developer:manage');
  });
});

describe('withEcosystemAuthz', () => {
  it('annotates handlers with permission + requireAuth, preserving audit', () => {
    const out = withEcosystemAuthz([
      { channel: IpcChannel.EcosystemDeveloperDashboard as IpcChannelName },
      { channel: IpcChannel.EcosystemKeysCreate as IpcChannelName, audit: true },
    ]);
    expect(out[0]).toMatchObject({ permission: 'developer:read', requireAuth: true });
    expect(out[1]).toMatchObject({ permission: 'developer:manage', requireAuth: true, audit: true });
  });

  it('throws at composition time for an unclassified channel', () => {
    expect(() => withEcosystemAuthz([{ channel: IpcChannel.MemoryRecall as IpcChannelName }])).toThrowError(
      /no permission classification/,
    );
  });
});
