/**
 * P11 — Cloud RBAC tests. Locks the "no unguarded cloud channel" invariant: every invokable
 * cloud channel (the existing cloud:* / livesync:* surface + the P11 cloud:cp.* layer) must carry
 * a real cloud:* permission, and the annotator must stamp requireAuth + permission.
 */
import { describe, expect, it } from 'vitest';
import type { IpcChannelName } from '@neuropause/shared';
import { ALL_ENTERPRISE_PERMISSIONS, IpcChannel, RUNTIME_INVOKABLE_CHANNELS } from '@neuropause/shared';
import { CLOUD_CHANNEL_PERMISSIONS, withCloudAuthz } from './cloudAuthz';

describe('CLOUD_CHANNEL_PERMISSIONS', () => {
  const cloudInvokable = RUNTIME_INVOKABLE_CHANNELS.filter(
    (c) => c.startsWith('cloud:') || c.startsWith('livesync:'),
  );

  it('classifies every invokable cloud channel — none unguarded', () => {
    const map = new Set<string>(Object.keys(CLOUD_CHANNEL_PERMISSIONS));
    for (const channel of cloudInvokable) {
      expect(map.has(channel), `unguarded cloud channel: ${channel}`).toBe(true);
    }
    // And the map references no non-existent / non-cloud channel.
    const known = new Set<string>(cloudInvokable);
    for (const c of map) expect(known.has(c), `stale mapping: ${c}`).toBe(true);
  });

  it('uses only real cloud permission scopes', () => {
    const valid = new Set<string>(ALL_ENTERPRISE_PERMISSIONS);
    for (const p of Object.values(CLOUD_CHANNEL_PERMISSIONS)) {
      expect(p).toMatch(/^cloud:/);
      expect(valid.has(p as string)).toBe(true);
    }
  });

  it('maps reads to cloud:read and mutations to cloud:manage', () => {
    expect(CLOUD_CHANNEL_PERMISSIONS[IpcChannel.CloudTenants]).toBe('cloud:read');
    expect(CLOUD_CHANNEL_PERMISSIONS[IpcChannel.ControlPlaneOverview]).toBe('cloud:read');
    expect(CLOUD_CHANNEL_PERMISSIONS[IpcChannel.CloudCreateTenant]).toBe('cloud:manage');
    expect(CLOUD_CHANNEL_PERMISSIONS[IpcChannel.CloudSetTenantStatus]).toBe('cloud:manage');
    expect(CLOUD_CHANNEL_PERMISSIONS[IpcChannel.CloudDeleteWebhook]).toBe('cloud:manage');
  });
});

describe('withCloudAuthz', () => {
  it('annotates handlers with permission + requireAuth, preserving audit', () => {
    const out = withCloudAuthz([
      { channel: IpcChannel.CloudTenants as IpcChannelName },
      { channel: IpcChannel.CloudCreateTenant as IpcChannelName, audit: true },
    ]);
    expect(out[0]).toMatchObject({ permission: 'cloud:read', requireAuth: true });
    expect(out[1]).toMatchObject({ permission: 'cloud:manage', requireAuth: true, audit: true });
  });

  it('throws at composition time for an unclassified channel', () => {
    expect(() => withCloudAuthz([{ channel: IpcChannel.MemoryRecall as IpcChannelName }])).toThrowError(
      /no permission classification/,
    );
  });
});
