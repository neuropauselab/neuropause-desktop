/**
 * Device trust domain types. Mirrors the organizations module: a repository
 * interface with two implementations (in-memory for tests, Postgres for
 * production) and a typed DeviceError whose codes the router maps to HTTP.
 *
 * A device is one installation, scoped to (org, device_id): the same install
 * registered against two orgs is two rows. Membership is enforced in the service
 * via the injected getMemberRole (reusing the organizations membership check), so
 * this module never duplicates auth or org logic.
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

export interface RegisterDeviceInput {
  orgId: string;
  deviceId: string;
  userId: string;
  name: string;
  platform: string;
  os: string;
  arch: string;
  appVersion: string;
}

export interface DeviceRepository {
  /** Insert or update a device by (orgId, deviceId); preserves registeredAt. */
  upsert(input: RegisterDeviceInput): Promise<Device>;
  listByOrg(orgId: string): Promise<Device[]>;
  get(orgId: string, deviceId: string): Promise<Device | null>;
  /** Update lastSeen + appVersion; returns null if the device isn't registered. */
  touch(
    orgId: string,
    deviceId: string,
    appVersion: string,
    lastSeen: string,
  ): Promise<Device | null>;
  setTrust(orgId: string, deviceId: string, status: DeviceTrustStatus): Promise<Device | null>;
  remove(orgId: string, deviceId: string): Promise<void>;
}

export type DeviceErrorCode = 'forbidden' | 'not_found' | 'invalid';

export class DeviceError extends Error {
  readonly code: DeviceErrorCode;
  constructor(code: DeviceErrorCode, message: string) {
    super(message);
    this.name = 'DeviceError';
    this.code = code;
  }
}
