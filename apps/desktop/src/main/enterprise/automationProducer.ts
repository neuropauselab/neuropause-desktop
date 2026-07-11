/**
 * Automation event producer (V4.8).
 *
 * Bridges the platform event bus to the automation runner: subscribes to the
 * event types that can trigger automations, maps each PlatformEvent to the
 * runner's AutomationEvent shape, and calls dispatch — making saved rules fire
 * automatically. dispatch() remains the single execution entry point; no
 * execution logic is duplicated here (this is pure mapping + fan-out).
 */
import type { PlatformEvent, PlatformEventType } from '@neuropause/shared';
import { createLogger } from '../logger';
import type { AutomationEvent, AutomationRunner } from './automationRunner';
import type { AutomationTriggerSource } from '@neuropause/shared';

const log = createLogger('automation-producer');

/** Platform event types that can drive automations. */
export const AUTOMATION_TRIGGER_EVENT_TYPES: PlatformEventType[] = [
  'connector.connected',
  'connector.disconnected',
  'connector.sync_completed',
  'connector.sync_failed',
  'connector.error',
  'connector.online',
  'connector.offline',
  'connector.conflict_detected',
  // P2.5 — a completed connector write (e.g. a confirmed Microsoft 365 send) can drive downstream automations.
  'connector.write_completed',
  'knowledge.entity_created',
  'knowledge.entity_updated',
  // P2.5 — ERP business-record lifecycle events are first-class automation triggers (cross-system automation:
  // a new order / status change / conversion can fan out to notifications, drafts, and downstream workflows).
  'enterprise.record.created',
  'enterprise.record.updated',
  'enterprise.record.status_changed',
  'enterprise.record.deleted',
  'enterprise.record.converted',
  'workspace.opened',
  'workspace.closed',
  'runtime.health_changed',
];

/** Which automation trigger source a platform event type maps to. Pure. */
export function sourceForEventType(type: PlatformEventType): AutomationTriggerSource {
  if (type.startsWith('connector.')) return 'connector';
  // knowledge / workspace / enterprise-record lifecycle are all "activity" triggers.
  return 'activity';
}

/**
 * Map a PlatformEvent to the runner's AutomationEvent. The event name is the
 * platform type; the connector id comes from the resource; conditions evaluate
 * against a payload built from the resource + flat metadata. Pure.
 */
export function toAutomationEvent(evt: PlatformEvent): AutomationEvent {
  const source = sourceForEventType(evt.type);
  const payload: Record<string, unknown> = {
    ...(evt.metadata ?? {}),
    type: evt.type,
    category: evt.category,
    priority: evt.priority,
  };
  if (evt.resource) {
    payload.resourceType = evt.resource.type;
    payload.resourceId = evt.resource.id;
    payload.resourceName = evt.resource.name;
  }
  return {
    source,
    connectorId: source === 'connector' ? (evt.resource?.id ?? undefined) : undefined,
    event: evt.type,
    payload,
  };
}

export interface AutomationProducerDeps {
  /** Subscribe to a set of platform event types. */
  on: (
    types: PlatformEventType[],
    handler: (evt: PlatformEvent) => void,
  ) => { dispose: () => void };
  /** The runner whose dispatch is the single execution entry point. */
  runner: AutomationRunner;
}

/**
 * Wire the producer: subscribe to trigger event types and dispatch each mapped
 * event to the runner. Returns the subscription handle. Dispatch failures are
 * logged and swallowed so one bad rule never breaks the event bus.
 */
export function wireAutomationProducers(deps: AutomationProducerDeps): { dispose: () => void } {
  const sub = deps.on(AUTOMATION_TRIGGER_EVENT_TYPES, (evt) => {
    const automationEvent = toAutomationEvent(evt);
    deps.runner
      .dispatch(automationEvent)
      .then((records) => {
        if (records.length > 0) {
          log.info('automations fired', {
            event: evt.type,
            fired: records.length,
            ok: records.filter((r) => r.ok).length,
          });
        }
      })
      .catch((err) =>
        log.warn('automation dispatch failed', { event: evt.type, err: String(err) }),
      );
  });
  log.info('Automation event producers wired', { types: AUTOMATION_TRIGGER_EVENT_TYPES.length });
  return sub;
}
