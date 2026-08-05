import { describe, it, expect } from 'vitest';
import { ManualClock } from '@neuropause/cloud-core';
import { composeBackendRuntime, type DevicesRuntimeService } from './backendRuntime';

const base = {
  orgId: '11111111-1111-1111-1111-111111111111',
  deviceId: 'dev-1',
  userId: 'user-1',
  name: 'Mac',
  platform: 'desktop',
  os: 'darwin',
  arch: 'arm64',
  appVersion: '1.0.0-rc.1',
};

describe('backend runtime composition (NCEA 10.2C)', () => {
  it('composes backend services through one lifecycle + one event bus', async () => {
    const runtime = composeBackendRuntime(
      { getMemberRole: async () => 'member' },
      { clock: new ManualClock(0) },
    );
    const events: string[] = [];
    runtime.events().subscribe('device.*', (e) => void events.push(e.type));

    await runtime.start();
    expect(runtime.state()).toBe('ready');

    const devices = runtime.context().get<DevicesRuntimeService>('devices');
    const device = await devices.register(base);
    expect(device.deviceId).toBe('dev-1');
    // the real backend domain event reached the runtime's single bus:
    expect(events).toContain('device.registered');
    expect(runtime.health().services.map((s) => s.name)).toContain('devices');

    await runtime.stop();
    expect(runtime.state()).toBe('stopped');
  });

  it('still enforces membership via the real backend service', async () => {
    const runtime = composeBackendRuntime(
      { getMemberRole: async () => null },
      { clock: new ManualClock(0) },
    );
    await runtime.start();
    const devices = runtime.context().get<DevicesRuntimeService>('devices');
    await expect(devices.register(base)).rejects.toMatchObject({ code: 'forbidden' });
    await runtime.stop();
  });
});
