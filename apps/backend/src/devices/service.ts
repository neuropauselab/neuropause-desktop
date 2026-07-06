/**
 * Device trust service. Pure orchestration over a DeviceRepository, fully
 * testable with the in-memory repo. Authorization reuses the organizations
 * membership check via the injected getMemberRole — no auth/org logic is
 * duplicated here. Plan-based device limits (Module 3) are intentionally NOT in
 * this increment; this covers registration, listing, heartbeat, and revoke.
 */
import { DeviceError, type Device, type DeviceRepository, type RegisterDeviceInput } from './types';

export interface DeviceServiceDeps {
  repo: DeviceRepository;
  /** Reused from the organizations module; returns the caller's role or null. */
  getMemberRole: (orgId: string, userId: string) => Promise<string | null>;
}

async function assertMember(
  deps: DeviceServiceDeps,
  orgId: string,
  userId: string,
): Promise<string> {
  const role = await deps.getMemberRole(orgId, userId);
  if (!role) throw new DeviceError('forbidden', 'You are not a member of this organization.');
  return role;
}

function isManager(role: string): boolean {
  return role === 'owner' || role === 'admin';
}

export async function registerDevice(
  deps: DeviceServiceDeps,
  input: RegisterDeviceInput,
): Promise<Device> {
  await assertMember(deps, input.orgId, input.userId);
  return deps.repo.upsert(input);
}

export async function listDevices(
  deps: DeviceServiceDeps,
  orgId: string,
  userId: string,
): Promise<Device[]> {
  await assertMember(deps, orgId, userId);
  return deps.repo.listByOrg(orgId);
}

export async function heartbeatDevice(
  deps: DeviceServiceDeps,
  input: { orgId: string; deviceId: string; userId: string; appVersion: string },
): Promise<Device> {
  await assertMember(deps, input.orgId, input.userId);
  const device = await deps.repo.touch(
    input.orgId,
    input.deviceId,
    input.appVersion,
    new Date().toISOString(),
  );
  if (!device) throw new DeviceError('not_found', 'Device is not registered.');
  return device;
}

export async function revokeDevice(
  deps: DeviceServiceDeps,
  input: { orgId: string; deviceId: string; userId: string },
): Promise<Device> {
  const role = await assertMember(deps, input.orgId, input.userId);
  if (!isManager(role)) {
    throw new DeviceError('forbidden', 'Only owners and admins can revoke devices.');
  }
  const device = await deps.repo.setTrust(input.orgId, input.deviceId, 'revoked');
  if (!device) throw new DeviceError('not_found', 'Device not found.');
  return device;
}

export async function removeDevice(
  deps: DeviceServiceDeps,
  input: { orgId: string; deviceId: string; userId: string },
): Promise<void> {
  const role = await assertMember(deps, input.orgId, input.userId);
  if (!isManager(role)) {
    throw new DeviceError('forbidden', 'Only owners and admins can remove devices.');
  }
  await deps.repo.remove(input.orgId, input.deviceId);
}
