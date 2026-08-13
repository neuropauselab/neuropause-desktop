/**
 * P10 — Federation RBAC tests. Locks the "no unguarded federation channel" invariant: every
 * invokable federation channel (the existing fed:* surface + the P10 federation:* layer) must
 * carry a real federation:* permission, and the annotator must stamp requireAuth + permission.
 */
import { describe, expect, it } from 'vitest';
import type { IpcChannelName } from '@neuropause/shared';
import { isPlatformOnlyPermission, ALL_ENTERPRISE_PERMISSIONS, IpcChannel, RUNTIME_INVOKABLE_CHANNELS } from '@neuropause/shared';
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

  /**
   * P13C ROUND 10 — NEW-F5. THIS ASSERTION USED TO BE `toMatch(/^federation:/)`.
   *
   * That encoded the assumption the finding was made of: that a channel in the
   * federation family must take a federation permission. Three of them —
   * `FedCreateBackup`, `FedRunValidation`, `FedCheckReplication` — act on ONE
   * install-wide `drStore` with no per-tenant rows, and `federation:manage` is an
   * ordinary organization permission that anyone can grant themselves by creating
   * an organization. The naming family is not the authority axis.
   *
   * Strengthened rather than relaxed: every permission must still be real, AND
   * the install-wide mutating channels must be platform-only, which the old
   * assertion actively forbade.
   */
  it('uses only real enterprise permission scopes', () => {
    const valid = new Set<string>(ALL_ENTERPRISE_PERMISSIONS);
    for (const p of Object.values(FEDERATION_CHANNEL_PERMISSIONS)) {
      expect(valid.has(p as string), `${p} is not a real permission`).toBe(true);
      expect(
        p!.startsWith('federation:') || isPlatformOnlyPermission(p!),
        `${p} is neither a federation scope nor a platform-only one`,
      ).toBe(true);
    }
  });

  it('the install-wide disaster-recovery writes require PLATFORM authority', () => {
    // The resource is one machine's backups, replication topology and continuity
    // posture. An organization role over it is a self-service grant across every
    // tenant — Round 9's F19 class, which drStore's own reason had described in
    // prose since Round 4 without anything being able to check it.
    for (const channel of [
      IpcChannel.FedCreateBackup,
      IpcChannel.FedRunValidation,
      IpcChannel.FedCheckReplication,
    ]) {
      expect(isPlatformOnlyPermission(FEDERATION_CHANNEL_PERMISSIONS[channel]!)).toBe(true);
    }
    // An Owner holding every ORGANIZATION permission is still refused.
    const orgOwner = ALL_ENTERPRISE_PERMISSIONS.filter((x) => !isPlatformOnlyPermission(x));
    expect(orgOwner.length).toBeGreaterThan(30);
    expect(orgOwner).not.toContain(FEDERATION_CHANNEL_PERMISSIONS[IpcChannel.FedCreateBackup]);
    // The READS did not move — seeing the posture is a member's business.
    expect(FEDERATION_CHANNEL_PERMISSIONS[IpcChannel.FedBackups]).toBe('federation:read');
    expect(FEDERATION_CHANNEL_PERMISSIONS[IpcChannel.FedContinuity]).toBe('federation:read');
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
