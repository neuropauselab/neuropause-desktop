import { describe, expect, it } from 'vitest';
import { createMemoryDeviceRepository } from './memoryRepository';
import {
  heartbeatDevice,
  listDevices,
  registerDevice,
  removeDevice,
  revokeDevice,
  type DeviceServiceDeps,
} from './service';
import type { DomainEvent, DomainEventPublisher } from '../platform/events';

function deps(role: string | null): DeviceServiceDeps {
  return {
    repo: createMemoryDeviceRepository(),
    getMemberRole: async () => role,
  };
}

const base = {
  orgId: '11111111-1111-1111-1111-111111111111',
  deviceId: 'dev-1',
  userId: 'user-1',
  name: 'Saurabh’s MacBook',
  platform: 'desktop',
  os: 'darwin',
  arch: 'arm64',
  appVersion: '1.0.0-rc.1',
};

describe('device service (V6.5)', () => {
  it('registers a device for a member', async () => {
    const d = deps('member');
    const device = await registerDevice(d, base);
    expect(device.trustStatus).toBe('trusted');
    expect(device.deviceId).toBe('dev-1');
    expect(await listDevices(d, base.orgId, base.userId)).toHaveLength(1);
  });

  it('rejects registration from a non-member', async () => {
    await expect(registerDevice(deps(null), base)).rejects.toMatchObject({ code: 'forbidden' });
  });

  it('re-registration upserts (no duplicate) and preserves registeredAt', async () => {
    const d = deps('member');
    const first = await registerDevice(d, base);
    await new Promise((r) => setTimeout(r, 5));
    const second = await registerDevice(d, { ...base, appVersion: '1.0.1' });
    const list = await listDevices(d, base.orgId, base.userId);
    expect(list).toHaveLength(1);
    expect(second.registeredAt).toBe(first.registeredAt);
    expect(second.appVersion).toBe('1.0.1');
  });

  it('heartbeat updates version + fails for an unregistered device', async () => {
    const d = deps('member');
    await registerDevice(d, base);
    const beat = await heartbeatDevice(d, {
      orgId: base.orgId,
      deviceId: base.deviceId,
      userId: base.userId,
      appVersion: '1.0.2',
    });
    expect(beat.appVersion).toBe('1.0.2');
    await expect(
      heartbeatDevice(d, {
        orgId: base.orgId,
        deviceId: 'ghost',
        userId: base.userId,
        appVersion: '1.0.2',
      }),
    ).rejects.toMatchObject({ code: 'not_found' });
  });

  it('only owners/admins can revoke or remove', async () => {
    const member = deps('member');
    await registerDevice(member, base);
    await expect(
      revokeDevice(member, { orgId: base.orgId, deviceId: base.deviceId, userId: base.userId }),
    ).rejects.toMatchObject({ code: 'forbidden' });

    const admin = deps('admin');
    await registerDevice(admin, base);
    const revoked = await revokeDevice(admin, {
      orgId: base.orgId,
      deviceId: base.deviceId,
      userId: base.userId,
    });
    expect(revoked.trustStatus).toBe('revoked');
    await removeDevice(admin, { orgId: base.orgId, deviceId: base.deviceId, userId: base.userId });
    expect(await listDevices(admin, base.orgId, base.userId)).toHaveLength(0);
  });

  it('emits a device.registered domain event when a platform publisher is wired', async () => {
    const events: DomainEvent[] = [];
    const publish: DomainEventPublisher = {
      async publish(e) {
        events.push(e);
      },
    };
    const d: DeviceServiceDeps = { ...deps('member'), publish };
    await registerDevice(d, base);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      type: 'device.registered',
      topic: 'devices',
      partitionKey: base.orgId,
      payload: { deviceId: 'dev-1', orgId: base.orgId },
    });
  });

  it('does NOT require a publisher (backward compatible)', async () => {
    // no publish wired — registration still succeeds unchanged
    const device = await registerDevice(deps('member'), base);
    expect(device.deviceId).toBe('dev-1');
  });
});

describe('NP-GLOBAL-PUBLIC-LAUNCH-002 §20 — revoked devices fail closed', () => {
  const owner = deps('owner');
  it('a revoked device is refused on heartbeat and on re-registration (403 device_revoked)', async () => {
    await registerDevice(owner, base);
    await revokeDevice(owner, { orgId: base.orgId, deviceId: base.deviceId, userId: base.userId });
    await expect(heartbeatDevice(owner, { orgId: base.orgId, deviceId: base.deviceId, userId: base.userId, appVersion: '1.0.0-rc.30' })).rejects.toMatchObject({ code: 'revoked' });
    await expect(registerDevice(owner, base)).rejects.toMatchObject({ code: 'revoked' });
    const rows = await listDevices(owner, base.orgId, base.userId);
    expect(rows[0].trustStatus).toBe('revoked');
  });
  it('a different user cannot rebind an existing device id (403 forbidden)', async () => {
    const d = deps('member');
    await registerDevice(d, base);
    await expect(registerDevice(d, { ...base, userId: 'user-2' })).rejects.toMatchObject({ code: 'forbidden' });
    await expect(heartbeatDevice(d, { orgId: base.orgId, deviceId: base.deviceId, userId: 'user-2', appVersion: 'x' })).rejects.toMatchObject({ code: 'forbidden' });
  });
  it('positive control: a trusted device still registers and heartbeats', async () => {
    const d = deps('member');
    await registerDevice(d, base);
    const hb = await heartbeatDevice(d, { orgId: base.orgId, deviceId: base.deviceId, userId: base.userId, appVersion: '1.0.0-rc.30' });
    expect(hb.trustStatus).toBe('trusted');
  });
});
