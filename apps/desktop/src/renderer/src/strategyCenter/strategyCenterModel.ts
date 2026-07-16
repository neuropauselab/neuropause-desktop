/**
 * P14 — Strategy Center: pure presentation mappings (tones, labels, icons) for the autonomous
 * enterprise intelligence view. No React, no I/O — unit-tested under Node.
 */
import type { OpsTone } from '@renderer/operations/lib';
import type { IconName } from '@renderer/components/ui/Icon';
import type {
  GoalCategory,
  OptimizationArea,
  ReasoningDimension,
  StrategyBand,
  StrategyHorizon,
  StrategyPriority,
  StrategyStatus,
} from '@neuropause/shared';

export function statusTone(s: StrategyStatus): OpsTone {
  return s === 'on_track' ? 'green' : s === 'at_risk' ? 'orange' : 'red';
}

export function statusLabel(s: StrategyStatus): string {
  return s === 'on_track' ? 'On track' : s === 'at_risk' ? 'At risk' : 'Off track';
}

export function bandTone(b: StrategyBand): OpsTone {
  return b === 'healthy' ? 'green' : b === 'watch' ? 'blue' : b === 'at-risk' ? 'orange' : 'red';
}

export function priorityTone(p: StrategyPriority): OpsTone {
  return p === 'critical' ? 'red' : p === 'high' ? 'orange' : p === 'medium' ? 'blue' : 'gray';
}

export function priorityLabel(p: StrategyPriority): string {
  return p.charAt(0).toUpperCase() + p.slice(1);
}

/** An approval requirement's tone: governed (blue) vs ungoverned (orange — needs a chain configured). */
export function approvalTone(governed: boolean): OpsTone {
  return governed ? 'blue' : 'orange';
}

const CATEGORY_LABEL: Record<GoalCategory, string> = {
  financial: 'Financial',
  operational: 'Operational',
  security: 'Security',
  growth: 'Growth',
  compliance: 'Compliance',
  workforce: 'Workforce',
  infrastructure: 'Infrastructure',
};
export function categoryLabel(c: GoalCategory): string {
  return CATEGORY_LABEL[c];
}

const CATEGORY_ICON: Record<GoalCategory, IconName> = {
  financial: 'gauge',
  operational: 'pulse',
  security: 'shield',
  growth: 'analytics',
  compliance: 'checklist',
  workforce: 'cpu',
  infrastructure: 'server',
};
export function categoryIcon(c: GoalCategory): IconName {
  return CATEGORY_ICON[c];
}

const DIMENSION_LABEL: Record<ReasoningDimension, string> = {
  dependencies: 'Dependencies',
  risks: 'Risks',
  resources: 'Resources',
  costs: 'Costs',
  compliance: 'Compliance',
  performance: 'Performance',
};
export function dimensionLabel(d: ReasoningDimension): string {
  return DIMENSION_LABEL[d];
}

const AREA_LABEL: Record<OptimizationArea, string> = {
  resource: 'Resource',
  budget: 'Budget',
  cloud: 'Cloud',
  workforce: 'Workforce',
  connector: 'Connector',
  workflow: 'Workflow',
  execution: 'Execution',
};
export function areaLabel(a: OptimizationArea): string {
  return AREA_LABEL[a];
}

const HORIZON_LABEL: Record<StrategyHorizon, string> = {
  '30d': '30 days',
  '90d': '90 days',
  '180d': '180 days',
  '365d': '365 days',
  multi_year: 'Multi-year',
};
export function horizonLabel(h: StrategyHorizon): string {
  return HORIZON_LABEL[h];
}

export function pct(fraction: number): string {
  return `${Math.round(fraction * 100)}%`;
}
