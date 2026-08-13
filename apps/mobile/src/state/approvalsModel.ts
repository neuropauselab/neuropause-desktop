/**
 * Approvals view-model (Mobile M1-10) — PURE helpers for the Approval Center,
 * split from the screen so they unit-test in plain Node. Grouping, the
 * approve/reject "intent" resolver (what a given action needs before it can be
 * dispatched), and the status-tone → colour map all live here.
 */
import type { CompanionApprovalItem } from '@neuropause/shared';
import { colors } from '../theme/tokens';

export interface ApprovalGroup {
  moduleId: string;
  moduleTitle: string;
  items: CompanionApprovalItem[];
}

/** A stable composite key (record ids are only unique within a module). */
export function approvalKey(item: Pick<CompanionApprovalItem, 'moduleId' | 'id'>): string {
  return `${item.moduleId}:${item.id}`;
}

/** Group items by module, preserving first-seen order of both groups and items. */
export function groupByModule(items: CompanionApprovalItem[]): ApprovalGroup[] {
  const order: string[] = [];
  const byId = new Map<string, ApprovalGroup>();
  for (const item of items) {
    let group = byId.get(item.moduleId);
    if (!group) {
      group = { moduleId: item.moduleId, moduleTitle: item.moduleTitle, items: [] };
      byId.set(item.moduleId, group);
      order.push(item.moduleId);
    }
    group.items.push(item);
  }
  return order.map((id) => byId.get(id) as ApprovalGroup);
}

export type ActionKind = 'approve' | 'reject';

export interface ActIntent {
  /** The action is offered on this item at all. */
  available: boolean;
  /** The module action key to dispatch, or null when unavailable. */
  action: string | null;
  /** The module refuses the action unless a reason is supplied. */
  needsReason: boolean;
  /** needsReason AND the supplied reason is blank → the act must be blocked. */
  reasonMissing: boolean;
}

/** Resolve what acting on an item with a given kind requires right now. */
export function actIntent(item: CompanionApprovalItem, kind: ActionKind, reason = ''): ActIntent {
  const spec = kind === 'approve' ? item.approve : item.reject;
  if (!spec) {
    return { available: false, action: null, needsReason: false, reasonMissing: false };
  }
  const needsReason = spec.reasonRequired;
  return {
    available: true,
    action: spec.action,
    needsReason,
    reasonMissing: needsReason && reason.trim().length === 0,
  };
}

const TONE: Record<string, string> = {
  green: colors.bands.healthy,
  ok: colors.bands.healthy,
  teal: colors.bands.healthy,
  orange: colors.bands.watch,
  warn: colors.bands.watch,
  red: colors.danger,
  bad: colors.danger,
  pink: colors.bands.critical,
  blue: colors.accent,
  accent: colors.accent,
  purple: colors.categorical[6],
  gray: colors.muted,
  neutral: colors.muted,
  faint: colors.faint,
  ink: colors.ink,
};

/** Map a module status tone (green/orange/red/…) to a phone colour. */
export function statusToneColor(tone: string | null | undefined): string {
  return (tone && TONE[tone]) || colors.muted;
}
