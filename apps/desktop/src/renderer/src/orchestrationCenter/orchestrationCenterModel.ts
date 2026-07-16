/**
 * P17 — Global Orchestration Center: pure presentation mappings (tones, labels, icons) for the Global
 * Orchestration dashboard. No React, no I/O — unit-tested under Node.
 */
import type { OpsTone } from '@renderer/operations/lib';
import type { IconName } from '@renderer/components/ui/Icon';
import type { OrchestrationBand } from '@neuropause/shared';

export function bandTone(b: OrchestrationBand): OpsTone {
  return b === 'healthy' ? 'green' : b === 'watch' ? 'blue' : b === 'at-risk' ? 'orange' : 'red';
}

export function bandLabel(b: OrchestrationBand): string {
  return b === 'healthy' ? 'Healthy' : b === 'watch' ? 'Watch' : b === 'at-risk' ? 'At risk' : 'Critical';
}

const ORCHESTRATOR_ICON: Record<string, IconName> = {
  global: 'command',
  goal: 'checklist',
  workforce: 'cpu',
  cloud: 'server',
  knowledge: 'sparkles',
  marketplace: 'store',
  federation: 'globe',
  deployment: 'layers',
  operations: 'pulse',
};
export function orchestratorIcon(id: string): IconName {
  return ORCHESTRATOR_ICON[id] ?? 'grid';
}

const FLOW_ICON: Record<string, IconName> = {
  goal: 'checklist',
  worker: 'cpu',
  knowledge: 'sparkles',
  cloud: 'server',
  marketplace: 'store',
  federation: 'globe',
};
export function flowIcon(id: string): IconName {
  return FLOW_ICON[id] ?? 'arrow-right';
}

export function pct(fraction: number): string {
  return `${Math.round(fraction * 100)}%`;
}
