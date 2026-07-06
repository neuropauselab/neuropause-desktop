/**
 * In-memory DeviceRepository — the reference implementation used by unit tests.
 * Upholds the same semantics the Postgres implementation must (one row per
 * (org, device), registeredAt preserved across re-registration). Isolated per
 * instance.
 */
import type { Device, DeviceRepository, DeviceTrustStatus, RegisterDeviceInput } from './types';

const key = (orgId: string, deviceId: string): string => `${orgId}:${deviceId}`;

export function createMemoryDeviceRepository(): DeviceRepository {
  const devices = new Map<string, Device>();
  const now = (): string => new Date().toISOString();

  return {
    async upsert(input: RegisterDeviceInput): Promise<Device> {
      const existing = devices.get(key(input.orgId, input.deviceId));
      const device: Device = {
        orgId: input.orgId,
        deviceId: input.deviceId,
        userId: input.userId,
        name: input.name,
        platform: input.platform,
        os: input.os,
        arch: input.arch,
        appVersion: input.appVersion,
        // Re-registration keeps the original trust status + registration time.
        trustStatus: existing?.trustStatus ?? 'trusted',
        registeredAt: existing?.registeredAt ?? now(),
        lastSeen: now(),
      };
      devices.set(key(input.orgId, input.deviceId), device);
      return { ...device };
    },

    async listByOrg(orgId: string): Promise<Device[]> {
      return [...devices.values()]
        .filter((d) => d.orgId === orgId)
        .sort((a, b) => Date.parse(b.lastSeen) - Date.parse(a.lastSeen))
        .map((d) => ({ ...d }));
    },

    async get(orgId: string, deviceId: string): Promise<Device | null> {
      const d = devices.get(key(orgId, deviceId));
      return d ? { ...d } : null;
    },

    async touch(
      orgId: string,
      deviceId: string,
      appVersion: string,
      lastSeen: string,
    ): Promise<Device | null> {
      const d = devices.get(key(orgId, deviceId));
      if (!d) return null;
      d.appVersion = appVersion;
      d.lastSeen = lastSeen;
      return { ...d };
    },

    async setTrust(
      orgId: string,
      deviceId: string,
      status: DeviceTrustStatus,
    ): Promise<Device | null> {
      const d = devices.get(key(orgId, deviceId));
      if (!d) return null;
      d.trustStatus = status;
      return { ...d };
    },

    async remove(orgId: string, deviceId: string): Promise<void> {
      devices.delete(key(orgId, deviceId));
    },
  };
}
