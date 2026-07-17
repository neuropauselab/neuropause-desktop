/**
 * Intent Experience Program v2.0 — Intent Home: pure presentation mappings (tones, labels, icons) for the
 * intent-native home. No React, no I/O — unit-tested under Node. All mappings are over REAL enum values
 * (IntentBand, StrategyStatus, GoalCategory, IntentRole); nothing here fabricates data.
 */
import type { OpsTone } from '@renderer/operations/lib';
import type { IconName } from '@renderer/components/ui/Icon';
import type { GoalCategory, IntentBand, IntentRole, StrategyStatus } from '@neuropause/shared';

export function bandTone(b: IntentBand): OpsTone {
  return b === 'healthy' ? 'green' : b === 'watch' ? 'blue' : b === 'at-risk' ? 'orange' : 'red';
}

export function bandLabel(b: IntentBand): string {
  return b === 'healthy' ? 'Healthy' : b === 'watch' ? 'Watch' : b === 'at-risk' ? 'At risk' : 'Critical';
}

/** Real goal status → human label. */
export function statusLabel(s: StrategyStatus): string {
  return s === 'off_track' ? 'Off track' : s === 'at_risk' ? 'At risk' : 'On track';
}

/** Real goal status → tone (off-track worst; on-track healthy). */
export function statusTone(s: StrategyStatus): OpsTone {
  return s === 'off_track' ? 'red' : s === 'at_risk' ? 'orange' : 'green';
}

const ROLE_ICON: Record<IntentRole, IconName> = {
  founder: 'sparkles',
  ceo: 'command',
  cto: 'grid',
  cfo: 'store',
  coo: 'pulse',
  sales: 'analytics',
  marketing: 'lightbulb',
  hr: 'shield',
  legal: 'lock',
  operations: 'package',
};
export function roleIcon(r: IntentRole): IconName {
  return ROLE_ICON[r] ?? 'sparkles';
}

const CATEGORY_ICON: Record<GoalCategory, IconName> = {
  financial: 'store',
  operational: 'pulse',
  security: 'shield',
  growth: 'arrow-up',
  compliance: 'lock',
  workforce: 'command',
  infrastructure: 'grid',
};
export function categoryIcon(c: GoalCategory): IconName {
  return CATEGORY_ICON[c] ?? 'grid';
}

export function categoryLabel(c: GoalCategory): string {
  return c.charAt(0).toUpperCase() + c.slice(1);
}

/** A whole-number percent for display. */
export function pctText(fraction: number): string {
  return `${Math.round(fraction * 100)}%`;
}
