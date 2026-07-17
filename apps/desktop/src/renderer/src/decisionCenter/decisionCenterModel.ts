/**
 * Experience Program v1.0 — Decision Center: pure presentation mappings (tones, labels, icons) for the
 * decision-first home. No React, no I/O — unit-tested under Node.
 */
import type { OpsTone } from '@renderer/operations/lib';
import type { IconName } from '@renderer/components/ui/Icon';
import type { DecisionKind, DisclosureLevelId, ExperienceBand, ExperienceRole } from '@neuropause/shared';

export function bandTone(b: ExperienceBand): OpsTone {
  return b === 'healthy' ? 'green' : b === 'watch' ? 'blue' : b === 'at-risk' ? 'orange' : 'red';
}

export function bandLabel(b: ExperienceBand): string {
  return b === 'healthy' ? 'Healthy' : b === 'watch' ? 'Watch' : b === 'at-risk' ? 'At risk' : 'Critical';
}

const ROLE_ICON: Record<ExperienceRole, IconName> = {
  founder: 'sparkles',
  ceo: 'command',
  cto: 'grid',
  cfo: 'store',
  coo: 'pulse',
  sales: 'analytics',
  marketing: 'lightbulb',
  hr: 'shield',
};
export function roleIcon(r: ExperienceRole): IconName {
  return ROLE_ICON[r] ?? 'sparkles';
}

const KIND_ICON: Record<DecisionKind, IconName> = {
  decision: 'sparkles',
  approval: 'lock',
  risk: 'shield',
  optimization: 'lightbulb',
};
export function kindIcon(k: DecisionKind): IconName {
  return KIND_ICON[k] ?? 'sparkles';
}

const DISCLOSURE_ICON: Record<DisclosureLevelId, IconName> = {
  executive: 'sparkles',
  management: 'grid',
  specialist: 'command',
};
export function disclosureIcon(l: DisclosureLevelId): IconName {
  return DISCLOSURE_ICON[l] ?? 'grid';
}

const MODULE_ICON: Record<string, IconName> = {
  twin: 'layers',
  knowledge: 'analytics',
  operations: 'pulse',
  workforce: 'command',
  connectors: 'globe',
  marketplace: 'store',
};
export function moduleIcon(id: string): IconName {
  return MODULE_ICON[id] ?? 'grid';
}

export function pct(fraction: number): string {
  return `${Math.round(fraction * 100)}%`;
}
