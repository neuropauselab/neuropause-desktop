/**
 * P11 — Cloud Control Plane: pure presentation mappings (labels, tones, icons) for the control
 * plane view. No React, no I/O — unit-tested under Node.
 */
import type { OpsTone } from '@renderer/operations/lib';
import type { IconName } from '@renderer/components/ui/Icon';
import type {
  ControlPlaneHealth,
  ControlPlaneSubsystemId,
  DataResidency,
  DeploymentGate,
  RegionReplication,
  TenantStatus,
  TenantTier,
} from '@neuropause/shared';

export function healthTone(h: ControlPlaneHealth): OpsTone {
  return h === 'healthy' ? 'green' : h === 'degraded' ? 'orange' : 'red';
}

export function healthLabel(h: ControlPlaneHealth): string {
  return h === 'healthy' ? 'Healthy' : h === 'degraded' ? 'Degraded' : 'Down';
}

export function gateTone(g: DeploymentGate): OpsTone {
  return g === 'ok' ? 'green' : g === 'degraded' ? 'orange' : 'red';
}

export function gateLabel(g: DeploymentGate): string {
  return g === 'ok' ? 'Promotable' : g === 'degraded' ? 'Degraded' : 'Blocked';
}

export function tierTone(t: TenantTier): OpsTone {
  return t === 'enterprise' ? 'purple' : t === 'business' ? 'blue' : 'gray';
}

export function tierLabel(t: TenantTier): string {
  return t.charAt(0).toUpperCase() + t.slice(1);
}

export function statusTone(s: TenantStatus): OpsTone {
  return s === 'active' ? 'green' : s === 'provisioning' ? 'orange' : 'red';
}

export function replicationTone(r: RegionReplication): OpsTone {
  return r === 'in_sync' ? 'green' : r === 'lagging' ? 'orange' : r === 'failed' ? 'red' : 'gray';
}

export function replicationLabel(r: RegionReplication): string {
  return r === 'in_sync' ? 'In sync' : r === 'lagging' ? 'Lagging' : r === 'failed' ? 'Failed' : 'None';
}

const SUBSYSTEM_ICON: Record<ControlPlaneSubsystemId, IconName> = {
  tenancy: 'grid',
  api: 'server',
  sync: 'refresh',
  identity: 'lock',
  federation: 'globe',
  recovery: 'shield',
};
export function subsystemIcon(id: ControlPlaneSubsystemId): IconName {
  return SUBSYSTEM_ICON[id];
}

export function residencyLabel(r: DataResidency): string {
  return r === 'us' ? 'US' : r === 'eu' ? 'EU' : 'APAC';
}

export function utilizationTone(pct: number): OpsTone {
  return pct >= 90 ? 'red' : pct >= 70 ? 'orange' : 'green';
}
