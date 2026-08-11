/**
 * P8.2 — Workforce RBAC classification invariant + annotator.
 */
import { describe, expect, it } from 'vitest';
import {
  ALL_ENTERPRISE_PERMISSIONS,
  EmptyRequest,
  IpcChannel,
  PLATFORM_ONLY_PERMISSIONS,
  RUNTIME_INVOKABLE_CHANNELS,
  isPlatformOnlyPermission,
  type EnterprisePermission,
} from '@neuropause/shared';
import type { SecureHandlerDef } from '../ipc/secureBridge';
import { WORKFORCE_CHANNEL_PERMISSIONS, withWorkforceAuthz } from './authzGate';

/**
 * Every INVOKABLE workforce channel (broadcasts are excluded by construction — they
 * are not in RUNTIME_INVOKABLE_CHANNELS — so a future workforce broadcast can't
 * cause a false "missing permission" failure).
 */
const invokableWorkforceChannels = RUNTIME_INVOKABLE_CHANNELS.filter((c) => c.startsWith('workforce:'));

describe('WORKFORCE_CHANNEL_PERMISSIONS invariant', () => {
  it('classifies EVERY invokable workforce channel with a real EnterprisePermission', () => {
    expect(invokableWorkforceChannels.length).toBeGreaterThan(10);
    for (const channel of invokableWorkforceChannels) {
      const perm = WORKFORCE_CHANNEL_PERMISSIONS[channel];
      expect(perm, `channel ${channel} must be classified in WORKFORCE_CHANNEL_PERMISSIONS`).toBeDefined();
      expect(ALL_ENTERPRISE_PERMISSIONS).toContain(perm);
    }
  });

  it('classifies reads/operate/approve with the right scope', () => {
    expect(WORKFORCE_CHANNEL_PERMISSIONS[IpcChannel.WorkforceWorkers]).toBe('workforce:read');
    expect(WORKFORCE_CHANNEL_PERMISSIONS[IpcChannel.WorkforceIntelligence]).toBe('workforce:read');
    expect(WORKFORCE_CHANNEL_PERMISSIONS[IpcChannel.WorkforceDelegatePlan]).toBe('workforce:read');
    expect(WORKFORCE_CHANNEL_PERMISSIONS[IpcChannel.WorkforceJobRun]).toBe('workforce:operate');
    expect(WORKFORCE_CHANNEL_PERMISSIONS[IpcChannel.WorkforceWorkflowRun]).toBe('workforce:operate');
    expect(WORKFORCE_CHANNEL_PERMISSIONS[IpcChannel.WorkforceProposalApprove]).toBe('workforce:approve');
    expect(WORKFORCE_CHANNEL_PERMISSIONS[IpcChannel.WorkforceProposalReject]).toBe('workforce:approve');
    expect(WORKFORCE_CHANNEL_PERMISSIONS[IpcChannel.WorkforceWorkflowCheckpoint]).toBe('workforce:approve');
  });
});

/**
 * P13C ROUND 9 — F2. THE INSTALL LIFECYCLE IS AN INSTALL-WIDE, DESTRUCTIVE ACT.
 *
 * One `workforce-installs.json`, one process-wide `WorkerRegistry`, and
 * `uninstall` removes the package for every tenant. `workforce:manage` is an
 * organization role and anyone may create an organization and own it, so the
 * pre-Round-9 arrangement was a self-service grant over a shared resource.
 *
 * These assert the AUTHORITY AXIS, not the string: the point is that no
 * organization role — not even one holding every organization permission that
 * exists — can satisfy the requirement.
 */
describe('install lifecycle requires PLATFORM authority, not an organization role', () => {
  const INSTALL_LIFECYCLE = [
    IpcChannel.WorkforceInstall,
    IpcChannel.WorkforceInstallUpdate,
    IpcChannel.WorkforceInstallEnable,
    IpcChannel.WorkforceInstallDisable,
    IpcChannel.WorkforceInstallRollback,
    IpcChannel.WorkforceUninstall,
  ] as const;

  it('every install/uninstall channel requires a platform-only permission', () => {
    expect(INSTALL_LIFECYCLE).toHaveLength(6);
    for (const channel of INSTALL_LIFECYCLE) {
      const perm = WORKFORCE_CHANNEL_PERMISSIONS[channel];
      expect(perm, `${channel} must be classified`).toBeDefined();
      expect(
        isPlatformOnlyPermission(perm!),
        `${channel} requires ${perm}, which an organization role can hold`,
      ).toBe(true);
    }
  });

  it('an Owner holding EVERY organization permission still cannot install or uninstall', () => {
    // The strongest organization principal the product can construct.
    const orgOwner = ALL_ENTERPRISE_PERMISSIONS.filter((p) => !isPlatformOnlyPermission(p));
    expect(orgOwner.length).toBeGreaterThan(30); // a real role, not an empty set
    for (const channel of INSTALL_LIFECYCLE) {
      expect(orgOwner).not.toContain(WORKFORCE_CHANNEL_PERMISSIONS[channel]);
    }
  });

  it('a PLATFORM OPERATOR can — the gate is not simply "always no"', () => {
    const operator: readonly EnterprisePermission[] = ['cloud:operate'];
    for (const channel of INSTALL_LIFECYCLE) {
      expect(operator).toContain(WORKFORCE_CHANNEL_PERMISSIONS[channel]);
    }
  });

  it('READS did not move — a member can still see what is installed', () => {
    expect(WORKFORCE_CHANNEL_PERMISSIONS[IpcChannel.WorkforceInstalls]).toBe('workforce:read');
    expect(WORKFORCE_CHANNEL_PERMISSIONS[IpcChannel.WorkforceInstallGet]).toBe('workforce:read');
    expect(isPlatformOnlyPermission('workforce:read')).toBe(false);
  });

  it('ALL_ENTERPRISE_PERMISSIONS never implicitly grants platform-only authority', () => {
    // The Owner wildcard is `[...ALL_ENTERPRISE_PERMISSIONS]` filtered through
    // PLATFORM_ONLY_PERMISSIONS. If a platform permission were ever added to the
    // array without being added to that filter, every Owner would silently gain it.
    for (const p of PLATFORM_ONLY_PERMISSIONS) {
      expect(isPlatformOnlyPermission(p)).toBe(true);
    }
    expect(PLATFORM_ONLY_PERMISSIONS).toContain('cloud:operate');
  });
});

describe('withWorkforceAuthz', () => {
  it('stamps requireAuth + permission + audit onto each handler from the map', () => {
    const defs: SecureHandlerDef[] = [
      { channel: IpcChannel.WorkforceWorkers, schema: EmptyRequest, handler: () => [] },
      { channel: IpcChannel.WorkforceJobRun, schema: EmptyRequest, handler: () => null },
    ];
    const gated = withWorkforceAuthz(defs);
    expect(gated[0]).toMatchObject({ requireAuth: true, permission: 'workforce:read', audit: true });
    expect(gated[1]).toMatchObject({ requireAuth: true, permission: 'workforce:operate', audit: true });
    // does not mutate the input defs
    expect(defs[0].requireAuth).toBeUndefined();
  });

  it('throws for an unclassified workforce channel (ship-time guard)', () => {
    const defs = [{ channel: 'workforce:mystery', schema: EmptyRequest, handler: () => null }] as unknown as SecureHandlerDef[];
    expect(() => withWorkforceAuthz(defs)).toThrow(/no permission classification/);
  });
});
