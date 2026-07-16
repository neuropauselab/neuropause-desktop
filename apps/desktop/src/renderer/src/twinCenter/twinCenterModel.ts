/**
 * P15 — Digital Twin Center: pure presentation mappings (tones, labels, icons) for the enterprise
 * digital-twin view. No React, no I/O — unit-tested under Node.
 */
import type { OpsTone } from '@renderer/operations/lib';
import type { IconName } from '@renderer/components/ui/Icon';
import type { ExecutiveTwinId, TwinBand, TwinDomainId, TwinReplayKind } from '@neuropause/shared';

export function bandTone(b: TwinBand | 'unknown'): OpsTone {
  return b === 'healthy' ? 'green' : b === 'watch' ? 'blue' : b === 'at-risk' ? 'orange' : b === 'critical' ? 'red' : 'gray';
}

export function bandLabel(b: TwinBand | 'unknown'): string {
  return b === 'healthy' ? 'Healthy' : b === 'watch' ? 'Watch' : b === 'at-risk' ? 'At risk' : b === 'critical' ? 'Critical' : 'Unknown';
}

/** Timeline event priority → tone (for replay frames). */
export function priorityTone(p: string): OpsTone {
  return p === 'critical' ? 'red' : p === 'high' ? 'orange' : p === 'normal' ? 'gray' : 'gray';
}

const DOMAIN_ICON: Record<TwinDomainId, IconName> = {
  enterprise: 'grid',
  organization: 'user',
  infrastructure: 'server',
  workforce: 'cpu',
  application: 'code',
  connector: 'connectors',
  marketplace: 'store',
  federation: 'globe',
  strategy: 'sparkles',
};
export function domainIcon(id: TwinDomainId): IconName {
  return DOMAIN_ICON[id];
}

const REPLAY_ICON: Record<TwinReplayKind, IconName> = {
  historical: 'clock',
  incident: 'shield',
  deployment: 'server',
  change: 'refresh',
  federation: 'globe',
  worker: 'cpu',
};
export function replayIcon(k: TwinReplayKind): IconName {
  return REPLAY_ICON[k];
}

const EXEC_ICON: Record<ExecutiveTwinId, IconName> = {
  executive: 'star',
  operations: 'pulse',
  business: 'analytics',
  strategy: 'sparkles',
  risk: 'shield',
  compliance: 'checklist',
};
export function execTwinIcon(id: ExecutiveTwinId): IconName {
  return EXEC_ICON[id];
}

export function pct(fraction: number): string {
  return `${Math.round(fraction * 100)}%`;
}
