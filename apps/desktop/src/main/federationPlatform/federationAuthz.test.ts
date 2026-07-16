/**
 * P10 — Federation RBAC tests. Locks the "no unguarded federation channel" invariant: every
 * invokable federation channel (the existing fed:* surface + the P10 federation:* layer) must
 * carry a real federation:* permission, and the annotator must stamp requireAuth + permission.
 */
import { describe, expect, it } from 'vitest';
import type { IpcChannelName } from '@neuropause/shared';
import { ALL_ENTERPRISE_PERMISSIONS, IpcChannel, RUNTIME_INVOKABLE_CHANNELS } from '@neuropause/shared';
import { FEDERATION_CHANNEL_PERMISSIONS, withFederationAuthz } from './federationAuthz';

describe('FEDERATION_CHANNEL_PERMISSIONS', () => {
  const federationInvokable = RUNTIME_INVOKABLE_CHANNELS.filter(
    (c) => c.startsWith('fed:') || c.startsWith('federation:'),
  );

  it('classifies every invokable federation channel — none unguarded', () => {
    const map = new Set<string>(Object.keys(FEDERATION_CHANNEL_PERMISSIONS));
    for (const channel of federationInvokable) {
      expect(map.has(channel), `unguarded federation channel: ${channel}`).toBe(true);
    }
    // And the map references no non-existent / non-federation channel.
    const known = new Set<string>(federationInvokable);
    for (const c of map) expect(known.has(c), `stale mapping: ${c}`).toBe(true);
  });

  it('uses only real federation permission scopes', () => {
    const valid = new Set<string>(ALL_ENTERPRISE_PERMISSIONS);
    for (const p of Object.values(FEDERATION_CHANNEL_PERMISSIONS)) {
      expect(p).toMatch(/^federation:/);
      expect(valid.has(p as string)).toBe(true);
    }
  });

  it('maps reads to federation:read, mutations to manage, approval resolution to approve', () => {
    expect(FEDERATION_CHANNEL_PERMISSIONS[IpcChannel.FedOrgs]).toBe('federation:read');
    expect(FEDERATION_CHANNEL_PERMISSIONS[IpcChannel.FederationGraph]).toBe('federation:read');
    expect(FEDERATION_CHANNEL_PERMISSIONS[IpcChannel.FedInviteOrg]).toBe('federation:manage');
    expect(FEDERATION_CHANNEL_PERMISSIONS[IpcChannel.FedInstallArtifact]).toBe('federation:manage');
    expect(FEDERATION_CHANNEL_PERMISSIONS[IpcChannel.FedResolveApproval]).toBe('federation:approve');
  });
});

describe('withFederationAuthz', () => {
  it('annotates handlers with permission + requireAuth, preserving audit', () => {
    const out = withFederationAuthz([
      { channel: IpcChannel.FedOrgs as IpcChannelName },
      { channel: IpcChannel.FedInviteOrg as IpcChannelName, audit: true },
    ]);
    expect(out[0]).toMatchObject({ permission: 'federation:read', requireAuth: true });
    expect(out[1]).toMatchObject({ permission: 'federation:manage', requireAuth: true, audit: true });
  });

  it('throws at composition time for an unclassified channel', () => {
    expect(() => withFederationAuthz([{ channel: IpcChannel.MemoryRecall as IpcChannelName }])).toThrowError(
      /no permission classification/,
    );
  });
});
