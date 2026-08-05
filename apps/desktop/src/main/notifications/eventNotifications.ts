/**
 * Event → Notification routing (Phase 6 Stage 5) — the PURE half of the
 * notification subsystem. Maps platform-bus events that warrant user attention
 * (approval parked, work finished/failed, connector unhealthy, risk signal)
 * into `IntelligenceItem`s for the EXISTING delivery engine, plus the
 * calendar-scan producer behind the `meeting-soon` source and a re-delivery
 * cooldown. No Electron, no singletons, no clock — everything injected, so this
 * file unit-tests in node exactly like the other `*Model`/pure modules.
 *
 * Honesty rules: every item is derived from a REAL event/entity that already
 * exists on the bus or in the UDM. Nothing is synthesized; unknown fields
 * degrade to generic wording, never to invented detail.
 */
import type {
  InboxNotification,
  IntelligenceItem,
  IntelligencePriority,
  PlatformEvent,
  PlatformEventType,
  UnifiedEntity,
} from '@neuropause/shared';

/** A routed notification: which source key it belongs to + the item to deliver. */
export interface RoutedNotification {
  sourceKey: string;
  item: IntelligenceItem;
}

/**
 * Every bus event type the notification subsystem listens for. Kept as one
 * exported list so the subscription and the router can never drift apart.
 */
export const NOTIFICATION_EVENT_TYPES: PlatformEventType[] = [
  // human decision parked
  'worker.job_awaiting_approval',
  // work finished / failed
  'worker.job_succeeded',
  'worker.job_failed',
  'automation.completed',
  'automation.failed',
  'workflow.completed',
  'workflow.failed',
  // connector health
  'connector.sync_failed',
  'connector.offline',
  'connector.reauth_required',
  'connector.error',
  // risk signals that exist on the bus today
  'runtime.supervisor.critical',
  'infrastructure.alert_raised',
  'infrastructure.failure_detected',
];

function metaStr(evt: PlatformEvent, key: string): string | null {
  const v = evt.metadata[key];
  return typeof v === 'string' && v.length > 0 ? v : null;
}

function metaNum(evt: PlatformEvent, key: string): number | null {
  const v = evt.metadata[key];
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

/** The subject id an event is about (resource id, else a well-known metadata id). */
function subjectId(evt: PlatformEvent): string {
  return (
    evt.resource?.id ??
    metaStr(evt, 'jobId') ??
    metaStr(evt, 'ruleId') ??
    metaStr(evt, 'connectorId') ??
    'system'
  );
}

/** The subject's display name (resource name, else its id). */
function subjectName(evt: PlatformEvent): string {
  return evt.resource?.name ?? evt.resource?.id ?? subjectId(evt);
}

function item(
  id: string,
  title: string,
  body: string,
  priority: IntelligencePriority,
  deepLink: string,
  evt: PlatformEvent,
): IntelligenceItem {
  return {
    id,
    title,
    body,
    priority,
    deepLink,
    producedAt: evt.timestamp,
    ...(evt.correlationId ? { correlationId: evt.correlationId } : {}),
  };
}

/**
 * Map one platform event to a notification, or null when the event type is not
 * one we notify on. Item ids are stable per SUBJECT (not per occurrence), so a
 * repeating condition replaces its inbox row instead of flooding the inbox.
 */
export function routeEvent(evt: PlatformEvent): RoutedNotification | null {
  switch (evt.type) {
    case 'worker.job_awaiting_approval': {
      const pending = metaNum(evt, 'pendingApprovals') ?? 1;
      const worker = metaStr(evt, 'workerId') ?? 'a worker';
      return {
        sourceKey: 'approval-needed',
        item: item(
          `approval:${subjectId(evt)}`,
          `Approval needed: ${subjectName(evt)}`,
          `${pending} proposal${pending === 1 ? '' : 's'} from ${worker} ${pending === 1 ? 'is' : 'are'} waiting for your decision.`,
          'high',
          'workforce',
          evt,
        ),
      };
    }
    case 'worker.job_succeeded':
      return {
        sourceKey: 'work-complete',
        item: item(
          `job-done:${subjectId(evt)}`,
          `Completed: ${subjectName(evt)}`,
          metaStr(evt, 'summary') ?? 'The job finished successfully.',
          'normal',
          'workforce',
          evt,
        ),
      };
    case 'worker.job_failed':
      return {
        sourceKey: 'work-failed',
        item: item(
          `job-failed:${subjectId(evt)}`,
          `Failed: ${subjectName(evt)}`,
          metaStr(evt, 'error') ?? 'The job failed.',
          'high',
          'workforce',
          evt,
        ),
      };
    case 'automation.completed':
    case 'workflow.completed':
      return {
        sourceKey: 'work-complete',
        item: item(
          `run-done:${subjectId(evt)}`,
          `Completed: ${subjectName(evt)}`,
          evt.type === 'automation.completed'
            ? 'The automation run finished.'
            : 'The workflow finished.',
          'normal',
          'automations',
          evt,
        ),
      };
    case 'automation.failed':
    case 'workflow.failed':
      return {
        sourceKey: 'work-failed',
        item: item(
          `run-failed:${subjectId(evt)}`,
          `Failed: ${subjectName(evt)}`,
          metaStr(evt, 'error') ??
            (evt.type === 'automation.failed' ? 'The automation run failed.' : 'The workflow failed.'),
          'high',
          'automations',
          evt,
        ),
      };
    case 'connector.sync_failed':
    case 'connector.offline':
    case 'connector.reauth_required':
    case 'connector.error': {
      const BODY: Partial<Record<PlatformEventType, string>> = {
        'connector.sync_failed': 'The last sync failed.',
        'connector.offline': 'The connector is offline.',
        'connector.reauth_required': 'The connection needs to be re-authorized.',
        'connector.error': 'The connector reported an error.',
      };
      return {
        sourceKey: 'connector-issue',
        item: item(
          `connector-issue:${subjectId(evt)}`,
          `Connector needs attention: ${subjectName(evt)}`,
          metaStr(evt, 'error') ?? BODY[evt.type] ?? 'The connector reported a problem.',
          'high',
          'connections',
          evt,
        ),
      };
    }
    case 'runtime.supervisor.critical':
    case 'infrastructure.alert_raised':
    case 'infrastructure.failure_detected':
      return {
        sourceKey: 'risk-signal',
        item: item(
          `risk:${evt.type}:${subjectId(evt)}`,
          `Risk signal: ${subjectName(evt)}`,
          metaStr(evt, 'message') ?? metaStr(evt, 'error') ?? `A ${evt.type} event was raised.`,
          evt.priority === 'critical' ? 'critical' : 'high',
          'mission-control',
          evt,
        ),
      };
    default:
      return null;
  }
}

/**
 * Re-delivery cooldown: the same item id is delivered at most once per window.
 * Guards against flapping conditions (a connector bouncing offline, a meeting
 * inside its reminder window on every scan) re-toasting the user every tick.
 * Bounded: entries older than the window are pruned on use.
 */
export class DeliveryCooldown {
  private readonly last = new Map<string, number>();

  constructor(private readonly windowMs: number) {}

  /** True (and records the delivery) when `id` has not fired within the window. */
  allow(id: string, nowMs: number): boolean {
    const prev = this.last.get(id);
    if (prev !== undefined && nowMs - prev < this.windowMs) return false;
    // opportunistic prune keeps the map bounded across long sessions
    if (this.last.size > 500) {
      for (const [k, t] of this.last) if (nowMs - t >= this.windowMs) this.last.delete(k);
    }
    this.last.set(id, nowMs);
    return true;
  }
}

/**
 * Map a delivered IntelligenceItem to its inbox record. Pure; `at` is the
 * delivery time supplied by the caller. The delivery engine stamps `sourceKey`
 * at deliver time; items that somehow arrive without one file under 'system'.
 */
export function toInboxNotification(item: IntelligenceItem, at: string): InboxNotification {
  return {
    id: item.id,
    title: item.title,
    body: item.body,
    priority: item.priority,
    sourceKey: item.sourceKey ?? 'system',
    deepLink: item.deepLink ?? null,
    at,
    read: false,
    ...(item.correlationId ? { correlationId: item.correlationId } : {}),
  };
}

/** How far ahead the meeting-soon scan looks (minutes). */
export const MEETING_SOON_WINDOW_MINUTES = 30;

/**
 * Producer behind the `meeting-soon` interval source: calendar entities that
 * START within the window (nowIso, nowIso + windowMinutes]. Pure — the caller
 * supplies the entities and the clock. Item ids include the start time, so a
 * rescheduled meeting notifies again while an unchanged one replaces itself.
 */
export function upcomingMeetingItems(
  entities: UnifiedEntity[],
  nowIso: string,
  windowMinutes: number = MEETING_SOON_WINDOW_MINUTES,
): IntelligenceItem[] {
  const nowMs = Date.parse(nowIso);
  if (!Number.isFinite(nowMs)) return [];
  const horizonMs = nowMs + windowMinutes * 60_000;
  const out: IntelligenceItem[] = [];
  for (const e of entities) {
    if (e.kind !== 'calendar_event' && e.kind !== 'event') continue;
    if (e.timestamp === null) continue;
    const startMs = Date.parse(e.timestamp);
    if (!Number.isFinite(startMs) || startMs <= nowMs || startMs > horizonMs) continue;
    const minutes = Math.max(1, Math.round((startMs - nowMs) / 60_000));
    out.push({
      id: `meeting-soon:${e.id}:${e.timestamp}`,
      title: `Starting soon: ${e.title}`,
      body: `Begins in about ${minutes} minute${minutes === 1 ? '' : 's'}.`,
      priority: 'high',
      deepLink: 'hub',
      producedAt: nowIso,
    });
  }
  out.sort((a, b) => a.id.localeCompare(b.id));
  return out;
}
