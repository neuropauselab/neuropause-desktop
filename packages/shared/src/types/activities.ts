/**
 * CRM → Activities — the sales activity stream (calls, emails, meetings, tasks,
 * notes) domain types + pure deterministic logic.
 *
 * An Activity is a typed *projection* of the framework's flat
 * `EnterpriseEntity` — the Enterprise Module Framework owns persistence, CRUD,
 * RBAC, audit, timeline, and UI. This file adds the activity-specific typing
 * and the DETERMINISTIC rules: the marker-derived open/completed/cancelled
 * status, the overdue/due-soon health clock, and the next-action logic.
 *
 * Design: ONE module covers the whole stream — `activityType` distinguishes a
 * logged call from a scheduled meeting from a to-do task — because they share
 * the identical lifecycle (open → completed/cancelled via marker-stamping
 * actions) and the identical CRM linkage (lead / opportunity / customer refs).
 * Activities are the events that drive the staleness clocks the Lead,
 * Opportunity, and Contact health rules already read (`updatedAt`-based):
 * logging or completing an activity touches its related records.
 *
 * Pure (no I/O), so it is shared by the backend hooks and the tests.
 */
import type { EnterpriseEntity, EnterpriseRiskLevel } from './enterpriseModule';

/** The kind of interaction (or work item) an activity records. */
export type ActivityType = 'call' | 'email' | 'meeting' | 'task' | 'note';
export const ACTIVITY_TYPES: readonly ActivityType[] = ['call', 'email', 'meeting', 'task', 'note'];

/** Marker-derived lifecycle state — never user-set, always from the markers. */
export type ActivityStatus = 'open' | 'completed' | 'cancelled';

export type ActivityPriority = 'low' | 'medium' | 'high';

/** The Activities module id + record kind (the framework store key). */
export const ACTIVITIES_MODULE_ID = 'crm-activities';
export const ACTIVITY_KIND = 'crmActivity';

const TYPE_LABELS: Record<ActivityType, string> = {
  call: 'Call',
  email: 'Email',
  meeting: 'Meeting',
  task: 'Task',
  note: 'Note',
};

export function activityTypeLabel(type: ActivityType): string {
  return TYPE_LABELS[type] ?? type;
}

/** A typed view over an activity record's flat fields (+ envelope timestamps). */
export interface CrmActivity {
  id: string;
  subject: string;
  activityType: ActivityType;
  direction: 'inbound' | 'outbound' | '';
  relatedLeadRef: string;
  relatedOpportunityRef: string;
  relatedCustomerRef: string;
  scheduledFor: string | null;
  durationMinutes: number;
  dueDate: string | null;
  priority: ActivityPriority;
  assignedTo: string;
  completedAt: string | null;
  cancelledAt: string | null;
  outcome: string;
  createdAt: string;
  updatedAt: string;
}

function str(v: unknown): string {
  return v === null || v === undefined ? '' : String(v);
}
function num(v: unknown): number {
  return typeof v === 'number' ? v : Number(str(v)) || 0;
}
function asType(v: unknown): ActivityType {
  const s = str(v);
  return (ACTIVITY_TYPES as readonly string[]).includes(s) ? (s as ActivityType) : 'task';
}
function asPriority(v: unknown): ActivityPriority {
  const s = str(v);
  return s === 'low' || s === 'high' ? s : 'medium';
}
function asDirection(v: unknown): 'inbound' | 'outbound' | '' {
  const s = str(v);
  return s === 'inbound' || s === 'outbound' ? s : '';
}

/** Project a framework record into a typed activity. */
export function activityFromRecord(record: EnterpriseEntity): CrmActivity {
  const f = record.fields;
  return {
    id: record.id,
    subject: str(f.subject) || record.title,
    activityType: asType(f.activityType),
    direction: asDirection(f.direction),
    relatedLeadRef: str(f.relatedLeadRef),
    relatedOpportunityRef: str(f.relatedOpportunityRef),
    relatedCustomerRef: str(f.relatedCustomerRef),
    scheduledFor: str(f.scheduledFor) || null,
    durationMinutes: num(f.durationMinutes),
    dueDate: str(f.dueDate) || null,
    priority: asPriority(f.priority),
    assignedTo: str(f.assignedTo),
    completedAt: str(f.completedAt) || null,
    cancelledAt: str(f.cancelledAt) || null,
    outcome: str(f.outcome),
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

/** The marker-derived status — completion wins over cancellation, both over open. */
export function activityStatusOf(activity: CrmActivity): ActivityStatus {
  if (activity.completedAt) return 'completed';
  if (activity.cancelledAt) return 'cancelled';
  return 'open';
}

export interface ActivityHealth {
  level: EnterpriseRiskLevel;
  reason: string;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Deterministic schedule health. Closed activities are quiet history; an open
 * activity past its due date (tasks) or scheduled time (meetings/calls) is
 * high risk; anything due within 2 days is medium; the rest are low.
 */
export function assessActivityHealth(activity: CrmActivity, nowMs: number): ActivityHealth {
  const status = activityStatusOf(activity);
  if (status === 'completed') return { level: 'low', reason: 'Completed.' };
  if (status === 'cancelled') return { level: 'low', reason: 'Cancelled.' };

  const anchor = activity.dueDate ?? activity.scheduledFor;
  const anchorMs = anchor ? Date.parse(anchor) : NaN;
  if (Number.isFinite(anchorMs)) {
    if (anchorMs < nowMs) {
      const daysLate = Math.max(1, Math.round((nowMs - anchorMs) / DAY_MS));
      const what = activity.dueDate ? 'past due' : 'past its scheduled time';
      return { level: 'high', reason: `Open and ${what} by ${daysLate} day${daysLate === 1 ? '' : 's'}.` };
    }
    if (anchorMs - nowMs <= 2 * DAY_MS) {
      return { level: 'medium', reason: 'Coming up within 2 days.' };
    }
  }
  return { level: 'low', reason: 'Open — on schedule.' };
}

/** The next best action for an activity, given its state. Deterministic. */
export function activityNextAction(activity: CrmActivity, health: ActivityHealth): string {
  const status = activityStatusOf(activity);
  if (status === 'completed') return 'No action — completed.';
  if (status === 'cancelled') return 'No action — cancelled.';
  if (health.level === 'high') return 'Overdue — complete it or cancel it, today.';
  switch (activity.activityType) {
    case 'meeting':
      return 'Prepare the agenda and confirm attendees.';
    case 'call':
      return 'Make the call and record the outcome.';
    case 'email':
      return 'Send the email and record the outcome.';
    case 'task':
      return 'Work the task to done.';
    default:
      return 'Review and file the note.';
  }
}

function labelLower(type: ActivityType): string {
  return activityTypeLabel(type).toLowerCase();
}

/** Deterministic summary — the no-model fallback. */
export function activitySummaryFallback(
  activity: CrmActivity,
  health: ActivityHealth,
): { summary: string; executiveExplanation: string } {
  const status = activityStatusOf(activity);
  const when = activity.dueDate
    ? ` due ${activity.dueDate}`
    : activity.scheduledFor
      ? ` scheduled ${activity.scheduledFor}`
      : '';
  const who = activity.assignedTo ? ` for ${activity.assignedTo}` : '';
  const summary =
    `${activity.subject} is a ${status} ${labelLower(activity.activityType)}${when}${who}. ` +
    `${health.reason} Next: ${activityNextAction(activity, health).toLowerCase()}`;
  const executiveExplanation =
    status === 'open'
      ? health.level === 'high'
        ? `An overdue ${labelLower(activity.activityType)} is stalling this relationship — clear it.`
        : `Open ${labelLower(activity.activityType)} on the board; risk is ${health.level}.`
      : `${activityTypeLabel(activity.activityType)} ${status} — activity history preserved.`;
  return { summary, executiveExplanation };
}
