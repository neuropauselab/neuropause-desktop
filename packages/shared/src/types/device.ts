/**
 * Shared device-trust types (V6.5). The renderer and desktop main use these; the
 * backend's devices module mirrors the same shape. A device is one installation
 * scoped to an org.
 */
export type DeviceTrustStatus = 'trusted' | 'blocked' | 'revoked';

export interface Device {
  orgId: string;
  deviceId: string;
  userId: string;
  name: string;
  platform: string;
  os: string;
  arch: string;
  appVersion: string;
  trustStatus: DeviceTrustStatus;
  lastSeen: string;
  registeredAt: string;
}
