/**
 * P8.2 — Workforce RBAC classification invariant + annotator.
 */
import { describe, expect, it } from 'vitest';
import { ALL_ENTERPRISE_PERMISSIONS, EmptyRequest, IpcChannel, RUNTIME_INVOKABLE_CHANNELS } from '@neuropause/shared';
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
