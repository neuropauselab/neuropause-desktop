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
});
