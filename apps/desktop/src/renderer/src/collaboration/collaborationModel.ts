/**
 * Enterprise Collaboration Workspace v1.0 — the collaboration model (pure data; no React, no I/O; tested).
 *
 * The Collaboration workspace is a REUSE-ONLY LENS over already-real services — cross-org delegated
 * approvals (federation), governance approval chains + the executive approvals snapshot (enterprise),
 * the workspace/team directory (enterprise + cloud), the system audit/activity feed (enterprise), and the
 * per-user personalization document (favorites / recents / saved views). It creates NO messaging platform,
 * presence service, comment store, task engine, or co-editing runtime, and duplicates nothing — every
 * action is a deep-link into the EXISTING surface. This file only labels/tones/summarizes that real data
 * and records — honestly — the social-collaboration capabilities the platform does NOT have, so the
 * workspace never fabricates them. Pure + deterministic (the clock is injected, never read here).
 */
import type {
  CloudTeam,
  DelegatedApprovalStatus,
  PersonalizationState,
  WorkspaceSummary,
} from '@neuropause/shared';
import type { IconName } from '@renderer/components/ui/Icon';
import type { OpsTone } from '@renderer/operations/lib';

/** The renderer section id this workspace mounts as (wired by the coordinator, not here). */
export const COLLABORATION_SECTION_ID = 'collaboration';

/* ── status → tone maps (reuse the ops tone system) ──────────────────────────── */

/** The delegated-approval lifecycle → tone: approved reads green, rejected red, pending amber. */
export function approvalStatusTone(s: DelegatedApprovalStatus): OpsTone {
  return s === 'approved' ? 'green' : s === 'rejected' ? 'red' : 'orange';
}

/**
 * Generic keyword tone for the varying status strings collaboration data carries (approval status, audit
 * actions, workspace/team state). Honest and defensive: negatives are checked FIRST because they often
 * embed a positive substring ("inactive" ⊃ "active", "disabled" ⊃ "enabled", "rejected" ⊃ … ) which must
 * never read green; neutral/absent states read gray; only genuine positives read green. Never invents.
 */
export function collaborationStateTone(raw: string | null | undefined): OpsTone {
  const s = (raw ?? '').toLowerCase();
  if (/(reject|decline|fail|blocked|revoked|expired|error|offline|suspended)/.test(s)) return 'red';
  if (/(pending|await|invited|draft|stale|review|warn|degrad)/.test(s)) return 'orange';
  if (/(inactive|disabled|closed|archived|none|empty)/.test(s)) return 'gray';
  if (/(approved|active|healthy|online|enabled|resolved|open|ok|accepted)/.test(s)) return 'green';
  return 'gray';
}

/* ── the honest collaboration-gap catalog (verified ABSENT in-app; never fabricated) ── */

/** How a gap is unbuildable today: it needs a new subsystem, or specifically a realtime one. */
export type CollaborationGapKind = 'not-built' | 'realtime';
export interface CollaborationGap {
  area: string;
  capability: string;
  kind: CollaborationGapKind;
  reason: string;
}

/**
 * Social-collaboration capabilities the platform does NOT have — each verified ABSENT from source (no
 * store, no entity, no IPC channel) and shown as an honest, labeled gap row. This is Approvals + a
 * Workspace/Team directory + a system activity feed + personal items — it is NOT a messaging platform, so
 * the features people expect from one are named here and never faked.
 */
export const COLLABORATION_GAPS: CollaborationGap[] = [
  { area: 'Records', capability: 'Comments on records', kind: 'not-built', reason: 'No comment entity or per-record thread store exists, and no IPC channel exposes record-level discussion.' },
  { area: 'Presence', capability: 'Presence (who’s online)', kind: 'realtime', reason: 'No realtime presence service exists — the app has no websocket heartbeat or session-presence signal, so who-is-online cannot be shown.' },
  { area: 'Discussion', capability: 'Discussions & threads', kind: 'not-built', reason: 'No threaded-conversation store or discussion entity exists anywhere in the platform.' },
  { area: 'Discussion', capability: 'Mentions (@user)', kind: 'not-built', reason: 'No @-mention parsing, mention index, or mention inbox exists; audit actors are recorded but not addressable.' },
  { area: 'Tasks', capability: 'Native tasks & assignments', kind: 'not-built', reason: 'No first-class human task/assignment entity exists — “jobs” are AI-worker jobs, not assignable to-dos.' },
  { area: 'Documents', capability: 'Shared / co-edited documents', kind: 'not-built', reason: 'No CRDT/OT co-editing engine exists; documents are connector-sourced and read-only in-app.' },
];

/** Badge metadata for a gap kind. Both labels are honest "Requires … architecture" framings. */
export function collaborationGapKindMeta(k: CollaborationGapKind): { label: string; tone: OpsTone; icon: IconName } {
  return k === 'realtime'
    ? { label: 'Requires realtime architecture', tone: 'purple', icon: 'pulse' }
    : { label: 'Requires architecture', tone: 'gray', icon: 'info' };
}

/* ── formatters (pure; the clock is passed in, never read) ───────────────────── */

/** Humanize a duration in ms to the coarsest single unit (d/h/m/s). Non-positive / invalid → em dash. */
export function formatAgeMs(ms: number | null | undefined): string {
  if (ms == null || !Number.isFinite(ms) || ms <= 0) return '—';
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  const d = Math.floor(h / 24);
  if (d > 0) return `${d}d`;
  if (h > 0) return `${h}h`;
  if (m > 0) return `${m}m`;
  return `${s}s`;
}

/** Relative "… ago" label for an ISO timestamp given an injected now (ms). Unparseable input → ''. */
export function timeAgo(iso: string, nowMs: number): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return '';
  const diff = Math.max(0, nowMs - t);
  const s = Math.floor(diff / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

/* ── pure summaries over the real collaboration data ─────────────────────────── */

/** Age past which the oldest pending approval is treated as a red (stale) signal. */
export const STALE_APPROVAL_MS = 3 * 24 * 60 * 60 * 1000; // 3 days

export interface ApprovalCounts {
  /** Cross-org delegated approvals currently pending (federation). */
  delegatedPending: number;
  /** Enabled approval chains configured in governance (enterprise). */
  enabledChains: number;
  /** Job-level approvals pending, from the executive dashboard snapshot (enterprise). */
  jobPending: number;
  approvedRecently: number;
  rejectedRecently: number;
  /** Age of the oldest pending job approval, ms (null when none). */
  oldestPendingAgeMs: number | null;
}

export interface ApprovalSummary {
  totalPending: number;
  delegatedPending: number;
  jobPending: number;
  enabledChains: number;
  approvedRecently: number;
  rejectedRecently: number;
  oldestPendingLabel: string;
  /** green when nothing pends, red when the oldest pending item is stale, amber otherwise. */
  tone: OpsTone;
}

/** Fold the three real approval sources into one honest headline summary. Pure. */
export function summarizeApprovals(counts: ApprovalCounts): ApprovalSummary {
  const delegatedPending = Math.max(0, counts.delegatedPending);
  const jobPending = Math.max(0, counts.jobPending);
  const totalPending = delegatedPending + jobPending;
  const stale = counts.oldestPendingAgeMs != null && counts.oldestPendingAgeMs >= STALE_APPROVAL_MS;
  const tone: OpsTone = totalPending === 0 ? 'green' : stale ? 'red' : 'orange';
  return {
    totalPending,
    delegatedPending,
    jobPending,
    enabledChains: Math.max(0, counts.enabledChains),
    approvedRecently: Math.max(0, counts.approvedRecently),
    rejectedRecently: Math.max(0, counts.rejectedRecently),
    oldestPendingLabel: formatAgeMs(counts.oldestPendingAgeMs),
    tone,
  };
}

export interface WorkspaceDirectorySummary {
  workspaces: number;
  activeWorkspaces: number;
  teams: number;
  workspaceUsers: number;
  teamMembers: number;
}

/** Count the workspace + team directory (users/members summed across the real records). Pure. */
export function summarizeWorkspaces(workspaces: WorkspaceSummary[], teams: CloudTeam[]): WorkspaceDirectorySummary {
  return {
    workspaces: workspaces.length,
    activeWorkspaces: workspaces.filter((w) => w.active).length,
    teams: teams.length,
    workspaceUsers: workspaces.reduce((n, w) => n + (w.userCount ?? 0), 0),
    teamMembers: teams.reduce((n, t) => n + (t.memberCount ?? 0), 0),
  };
}

export interface MyItemsSummary {
  favorites: number;
  recents: number;
  savedViews: number;
  total: number;
}

/** Count the per-user personal items (favorites / recents / saved views). Pure; null-safe. */
export function summarizeMyItems(state: PersonalizationState | null): MyItemsSummary {
  const favorites = state?.favorites.length ?? 0;
  const recents = state?.recents.length ?? 0;
  const savedViews = state?.savedViews.length ?? 0;
  return { favorites, recents, savedViews, total: favorites + recents + savedViews };
}
