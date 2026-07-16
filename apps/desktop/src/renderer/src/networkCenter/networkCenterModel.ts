/**
 * P18 — Intelligence Network Center: pure presentation mappings (tones, labels, icons) for the Enterprise
 * Intelligence Network dashboard. No React, no I/O — unit-tested under Node.
 */
import type { OpsTone } from '@renderer/operations/lib';
import type { IconName } from '@renderer/components/ui/Icon';
import type { BenchmarkPosition, IntelNetworkBand, RegistryEntry } from '@neuropause/shared';

export function bandTone(b: IntelNetworkBand): OpsTone {
  return b === 'healthy' ? 'green' : b === 'watch' ? 'blue' : b === 'at-risk' ? 'orange' : 'red';
}

export function bandLabel(b: IntelNetworkBand): string {
  return b === 'healthy' ? 'Healthy' : b === 'watch' ? 'Watch' : b === 'at-risk' ? 'At risk' : 'Critical';
}

const MODULE_ICON: Record<string, IconName> = {
  'knowledge-exchange': 'sparkles',
  'recommendation-exchange': 'lightbulb',
  'benchmark-exchange': 'analytics',
  'insight-registry': 'package',
  'trust-exchange': 'shield',
  'org-intelligence': 'globe',
  'collective-intelligence': 'grid',
};
export function moduleIcon(id: string): IconName {
  return MODULE_ICON[id] ?? 'grid';
}

export function positionTone(p: BenchmarkPosition): OpsTone {
  return p === 'above' ? 'green' : p === 'below' ? 'orange' : 'gray';
}
export function positionIcon(p: BenchmarkPosition): IconName {
  return p === 'above' ? 'arrow-up' : p === 'below' ? 'chevron-down' : p === 'at' ? 'arrow-right' : 'dot';
}
export function positionLabel(p: BenchmarkPosition): string {
  return p === 'above' ? 'Above industry' : p === 'below' ? 'Below industry' : p === 'at' ? 'At industry' : 'Unbenchmarked';
}

const SOURCE_ICON: Record<RegistryEntry['source'], IconName> = {
  exchange: 'globe',
  pack: 'package',
  marketplace: 'store',
};
export function sourceIcon(source: RegistryEntry['source']): IconName {
  return SOURCE_ICON[source] ?? 'package';
}

export function pct(fraction: number): string {
  return `${Math.round(fraction * 100)}%`;
}
