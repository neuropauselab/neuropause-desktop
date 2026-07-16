/**
 * P20 — Commercial Center: pure presentation mappings (tones, labels, icons) for the NeuroPause Platform v2
 * commercial dashboard. No React, no I/O — unit-tested under Node.
 */
import type { OpsTone } from '@renderer/operations/lib';
import type { IconName } from '@renderer/components/ui/Icon';
import type { CommercialBand, CommercialSegment, DeploymentModeId, PriceModel } from '@neuropause/shared';

export function bandTone(b: CommercialBand): OpsTone {
  return b === 'healthy' ? 'green' : b === 'watch' ? 'blue' : b === 'at-risk' ? 'orange' : 'red';
}

export function bandLabel(b: CommercialBand): string {
  return b === 'healthy' ? 'Healthy' : b === 'watch' ? 'Watch' : b === 'at-risk' ? 'At risk' : 'Critical';
}

export function segmentTone(s: CommercialSegment): OpsTone {
  return s === 'self_serve' ? 'green' : s === 'sales_assisted' ? 'blue' : 'purple';
}
export function segmentLabel(s: CommercialSegment): string {
  return s === 'self_serve' ? 'Self-serve' : s === 'sales_assisted' ? 'Sales-assisted' : 'Special';
}

export function priceModelLabel(p: PriceModel): string {
  return p === 'free' ? 'Free' : p === 'per_seat' ? 'Per seat' : p === 'annual_contract' ? 'Annual contract' : 'Custom';
}

const MODULE_ICON: Record<string, IconName> = {
  'subscription-management': 'sparkles',
  'license-management': 'lock',
  'billing-center': 'store',
  'usage-metering': 'analytics',
  deployment: 'globe',
  'customer-success': 'pulse',
  'product-analytics': 'grid',
  'release-center': 'refresh',
  'organization-admin': 'shield',
};
export function moduleIcon(id: string): IconName {
  return MODULE_ICON[id] ?? 'grid';
}

const MODE_ICON: Record<DeploymentModeId, IconName> = {
  cloud_saas: 'globe',
  private_cloud: 'shield',
  hybrid: 'command',
  on_premises: 'store',
  air_gapped: 'lock',
};
export function modeIcon(id: DeploymentModeId): IconName {
  return MODE_ICON[id] ?? 'globe';
}

export function pct(fraction: number): string {
  return `${Math.round(fraction * 100)}%`;
}
