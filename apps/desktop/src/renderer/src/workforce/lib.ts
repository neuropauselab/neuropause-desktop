/**
 * AI Workforce UI helpers — status → {label, tone} maps and formatters. Reuses
 * the Operations tone system so colours stay consistent across the app. Pure and
 * dependency-free; the provider and every panel share these.
 */
import type {
  ApprovalDecision,
  JobStatus,
  RiskLevel,
  VerdictDecision,
  WorkerHealthState,
  WorkerLifecycle,
  WorkerRole,
  WorkflowRunStatus,
} from '@neuropause/shared';
import type { IconName } from '@renderer/components/ui/Icon';
import { type OpsTone } from '@renderer/operations/lib';

export { DOT_BG, TEXT_TONE, TINT_TONE, type OpsTone } from '@renderer/operations/lib';

export interface Meta {
  label: string;
  tone: OpsTone;
}

export function lifecycleMeta(s: WorkerLifecycle): Meta {
  switch (s) {
    case 'running':
      return { label: 'Running', tone: 'blue' };
    case 'idle':
      return { label: 'Idle', tone: 'green' };
    case 'paused':
      return { label: 'Paused', tone: 'orange' };
    case 'registered':
      return { label: 'Registered', tone: 'gray' };
    case 'stopped':
      return { label: 'Stopped', tone: 'gray' };
    case 'errored':
      return { label: 'Errored', tone: 'red' };
    default:
      return { label: s, tone: 'gray' };
  }
}

export function healthMeta(h: WorkerHealthState): Meta {
  switch (h) {
    case 'healthy':
      return { label: 'Healthy', tone: 'green' };
    case 'degraded':
      return { label: 'Degraded', tone: 'orange' };
    case 'unhealthy':
      return { label: 'Unhealthy', tone: 'red' };
    default:
      return { label: 'Unknown', tone: 'gray' };
  }
}

export function jobStatusMeta(s: JobStatus): Meta {
  switch (s) {
    case 'queued':
      return { label: 'Queued', tone: 'gray' };
    case 'running':
      return { label: 'Running', tone: 'blue' };
    case 'awaiting_approval':
      return { label: 'Awaiting approval', tone: 'orange' };
    case 'succeeded':
      return { label: 'Succeeded', tone: 'green' };
    case 'failed':
      return { label: 'Failed', tone: 'red' };
    case 'cancelled':
      return { label: 'Cancelled', tone: 'gray' };
    default:
      return { label: s, tone: 'gray' };
  }
}

export function workflowStatusMeta(s: WorkflowRunStatus | JobStatus | 'pending' | 'skipped'): Meta {
  switch (s) {
    case 'pending':
      return { label: 'Pending', tone: 'gray' };
    case 'skipped':
      return { label: 'Skipped', tone: 'gray' };
    default:
      return jobStatusMeta(s as JobStatus);
  }
}

export function riskMeta(r: RiskLevel): Meta {
  switch (r) {
    case 'low':
      return { label: 'Low', tone: 'green' };
    case 'medium':
      return { label: 'Medium', tone: 'orange' };
    case 'high':
      return { label: 'High', tone: 'red' };
    case 'critical':
      return { label: 'Critical', tone: 'red' };
    default:
      return { label: r, tone: 'gray' };
  }
}

export function decisionMeta(d: VerdictDecision): Meta {
  switch (d) {
    case 'allow':
      return { label: 'Allowed', tone: 'green' };
    case 'require_approval':
      return { label: 'Needs approval', tone: 'orange' };
    case 'deny':
      return { label: 'Denied', tone: 'red' };
    default:
      return { label: d, tone: 'gray' };
  }
}

export function approvalMeta(d: ApprovalDecision): Meta {
  return d === 'approved' ? { label: 'Approved', tone: 'green' } : { label: 'Rejected', tone: 'red' };
}

/** Trust score health: floor/penalty design means <0.4 is shaky, ≥0.6 earns autonomy. */
export function trustTone(score: number): OpsTone {
  if (score >= 0.6) return 'green';
  if (score >= 0.4) return 'orange';
  return 'red';
}

const ROLE_ICONS: Record<WorkerRole, IconName> = {
  founder: 'bolt',
  research: 'beaker',
  engineering: 'code',
  marketing: 'sparkles',
  sales: 'activity',
  finance: 'gauge',
  legal: 'shield',
  operations: 'pulse',
  support: 'bell',
};

export function roleIcon(role: WorkerRole): IconName {
  return ROLE_ICONS[role] ?? 'cpu';
}

const ROLE_TINT: Record<WorkerRole, OpsTone> = {
  founder: 'accent',
  research: 'purple',
  engineering: 'blue',
  marketing: 'orange',
  sales: 'green',
  finance: 'accent',
  legal: 'blue',
  operations: 'purple',
  support: 'orange',
};

export function roleTone(role: WorkerRole): OpsTone {
  return ROLE_TINT[role] ?? 'gray';
}

/* ── formatters ──────────────────────────────────────────────────────────── */

export function formatTrust(score: number): string {
  return `${Math.round(score * 100)}%`;
}

export function formatPct(n: number): string {
  return `${Math.round(n * 100)}%`;
}

export function formatMs(ms: number | null): string {
  if (ms === null) return '—';
  if (ms < 1) return '<1 ms';
  if (ms < 1000) return `${Math.round(ms)} ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)} s`;
  return `${(ms / 60_000).toFixed(1)} min`;
}

export function relativeTime(iso: string | null): string {
  if (!iso) return '—';
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '—';
  const diff = Date.now() - then;
  if (diff < 0) return 'just now';
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day < 30) return `${day}d ago`;
  return new Date(iso).toLocaleDateString();
}

export function titleCase(s: string): string {
  return s.replace(/(^|[\s_-])([a-z])/g, (_, sep, ch) => `${sep === '_' || sep === '-' ? ' ' : sep}${ch.toUpperCase()}`);
}

/** The six surfaces of the AI Workforce experience. */
export type WorkforceTab = 'mission' | 'workers' | 'approvals' | 'studio' | 'analytics' | 'executive';

/** Count the proposals on a job that still await a human decision. */
export function pendingApprovalCount(proposals: { verdict: { decision: string }; approval: unknown }[]): number {
  return proposals.filter((p) => p.verdict.decision === 'require_approval' && !p.approval).length;
}
