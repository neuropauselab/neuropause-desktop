/**
 * P19 — Autonomous Operations Center: pure presentation mappings (tones, labels, icons) for the Autonomous
 * Enterprise Operations dashboard. No React, no I/O — unit-tested under Node.
 */
import type { OpsTone } from '@renderer/operations/lib';
import type { IconName } from '@renderer/components/ui/Icon';
import type { MonitorDimension, OpsBand, OpsRisk, OpsRecoveryKind, PlanCategory } from '@neuropause/shared';

export function bandTone(b: OpsBand): OpsTone {
  return b === 'healthy' ? 'green' : b === 'watch' ? 'blue' : b === 'at-risk' ? 'orange' : 'red';
}

export function bandLabel(b: OpsBand): string {
  return b === 'healthy' ? 'Healthy' : b === 'watch' ? 'Watch' : b === 'at-risk' ? 'At risk' : 'Critical';
}

export function riskTone(r: OpsRisk): OpsTone {
  return r === 'critical' ? 'red' : r === 'high' ? 'orange' : r === 'medium' ? 'blue' : 'green';
}

export function riskLabel(r: OpsRisk): string {
  return r.charAt(0).toUpperCase() + r.slice(1);
}

const MODULE_ICON: Record<string, IconName> = {
  'execution-coordinator': 'command',
  'recovery-manager': 'refresh',
  'optimization-manager': 'lightbulb',
  'incident-manager': 'shield',
  'approval-coordinator': 'lock',
  monitoring: 'pulse',
  'operational-analytics': 'analytics',
};
export function moduleIcon(id: string): IconName {
  return MODULE_ICON[id] ?? 'grid';
}

const CATEGORY_ICON: Record<PlanCategory, IconName> = {
  execution: 'command',
  recovery: 'refresh',
  optimization: 'lightbulb',
  maintenance: 'grid',
  capacity: 'analytics',
  operational: 'grid',
};
export function categoryIcon(c: PlanCategory): IconName {
  return CATEGORY_ICON[c] ?? 'grid';
}

const RECOVERY_ICON: Record<OpsRecoveryKind, IconName> = {
  rollback: 'refresh',
  retry: 'refresh',
  failover: 'command',
  escalation: 'shield',
  alternative: 'grid',
};
export function recoveryIcon(k: OpsRecoveryKind): IconName {
  return RECOVERY_ICON[k] ?? 'grid';
}

const DIMENSION_ICON: Record<MonitorDimension, IconName> = {
  execution: 'command',
  health: 'pulse',
  capacity: 'analytics',
  costs: 'store',
  security: 'shield',
  compliance: 'lock',
  sla: 'globe',
};
export function dimensionIcon(d: MonitorDimension): IconName {
  return DIMENSION_ICON[d] ?? 'grid';
}

/** The auto-execution posture badge: policy-permitted (green) vs approval-required (amber). */
export function autoExecTone(autoExecutable: boolean): OpsTone {
  return autoExecutable ? 'green' : 'orange';
}
export function autoExecLabel(autoExecutable: boolean): string {
  return autoExecutable ? 'Policy-permitted' : 'Approval required';
}

export function pct(fraction: number): string {
  return `${Math.round(fraction * 100)}%`;
}
