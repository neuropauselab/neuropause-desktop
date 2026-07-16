/**
 * P16 — Knowledge Fabric Center: pure presentation mappings (tones, labels, icons) for the Knowledge
 * Explorer. No React, no I/O — unit-tested under Node.
 */
import type { OpsTone } from '@renderer/operations/lib';
import type { IconName } from '@renderer/components/ui/Icon';
import type { FabricBand, FabricExplanationKind, FabricSourceCategory } from '@neuropause/shared';

export function bandTone(b: FabricBand): OpsTone {
  return b === 'healthy' ? 'green' : b === 'watch' ? 'blue' : b === 'at-risk' ? 'orange' : 'red';
}

export function bandLabel(b: FabricBand): string {
  return b === 'healthy' ? 'Healthy' : b === 'watch' ? 'Watch' : b === 'at-risk' ? 'At risk' : 'Critical';
}

const SOURCE_ICON: Record<FabricSourceCategory, IconName> = {
  graph: 'grid',
  signal: 'pulse',
  catalog: 'store',
  operational: 'server',
  intelligence: 'sparkles',
  corpus: 'memory',
};
export function sourceIcon(category: FabricSourceCategory): IconName {
  return SOURCE_ICON[category];
}

const EXPLANATION_ICON: Record<FabricExplanationKind, IconName> = {
  recommendation: 'lightbulb',
  goal: 'star',
  decision: 'checklist',
  optimization: 'bolt',
  reasoning: 'cpu',
  simulation: 'beaker',
  twin: 'layers',
  kpi: 'analytics',
};
export function explanationIcon(kind: FabricExplanationKind): IconName {
  return EXPLANATION_ICON[kind];
}

const REF_ICON: Record<string, IconName> = {
  entity: 'database',
  signal: 'pulse',
  incident: 'shield',
  industry: 'package',
  cloud: 'server',
  connector: 'connectors',
  workforce: 'cpu',
  strategy: 'sparkles',
  federation: 'globe',
  domain: 'grid',
  catalog: 'store',
  other: 'dot',
};
export function refIcon(kind: string): IconName {
  return REF_ICON[kind] ?? 'dot';
}

const LINEAGE_ICON: Record<string, IconName> = {
  origin: 'plus',
  transformation: 'refresh',
  usage: 'activity',
  consumers: 'arrow-right',
};
export function lineageIcon(stage: string): IconName {
  return LINEAGE_ICON[stage] ?? 'clock';
}

export function pct(fraction: number): string {
  return `${Math.round(fraction * 100)}%`;
}
