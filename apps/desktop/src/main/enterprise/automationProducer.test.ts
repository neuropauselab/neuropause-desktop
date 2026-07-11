import { describe, expect, it, vi } from 'vitest';
import type { PlatformEvent } from '@neuropause/shared';
import {
  AUTOMATION_TRIGGER_EVENT_TYPES,
  sourceForEventType,
  toAutomationEvent,
  wireAutomationProducers,
} from './automationProducer';
import type { AutomationRunner } from './automationRunner';

function platformEvent(over: Partial<PlatformEvent> = {}): PlatformEvent {
  return {
    id: 'evt:1',
    type: 'connector.sync_completed',
    category: 'connector',
    version: 1,
    priority: 'normal',
    timestamp: '2026-01-10T00:00:00.000Z',
    source: 'connectors',
    actor: { kind: 'system', id: null },
    resource: { type: 'connector', id: 'gmail', name: 'Gmail' },
    ...over,
  } as PlatformEvent;
}

describe('sourceForEventType (V4.8)', () => {
  it('maps connector.* to connector', () => {
    expect(sourceForEventType('connector.sync_completed')).toBe('connector');
  });
  it('maps knowledge/workspace to activity', () => {
    expect(sourceForEventType('knowledge.entity_created')).toBe('activity');
    expect(sourceForEventType('workspace.opened')).toBe('activity');
  });
  it('P2.5 — maps connector.write_completed to connector and ERP record events to activity', () => {
    expect(sourceForEventType('connector.write_completed')).toBe('connector');
    expect(sourceForEventType('enterprise.record.created')).toBe('activity');
    expect(sourceForEventType('enterprise.record.status_changed')).toBe('activity');
    expect(sourceForEventType('enterprise.record.converted')).toBe('activity');
  });
});

describe('AUTOMATION_TRIGGER_EVENT_TYPES (P2.5)', () => {
  it('includes ERP record lifecycle + connector.write_completed as cross-system triggers', () => {
    for (const t of [
      'connector.write_completed',
      'enterprise.record.created',
      'enterprise.record.updated',
      'enterprise.record.status_changed',
      'enterprise.record.deleted',
      'enterprise.record.converted',
    ] as const) {
      expect(AUTOMATION_TRIGGER_EVENT_TYPES).toContain(t);
    }
  });

  it('an ERP record event maps into an activity trigger keyed on the event type', () => {
    const e = toAutomationEvent(
      platformEvent({
        type: 'enterprise.record.created',
        category: 'enterprise',
        resource: { type: 'sales-orders', id: 'so_1', name: 'SO-1' },
        metadata: { total: 50000 },
      }),
    );
    expect(e.source).toBe('activity');
    expect(e.connectorId).toBeUndefined();
    expect(e.event).toBe('enterprise.record.created');
    expect(e.payload.resourceType).toBe('sales-orders');
    expect(e.payload.total).toBe(50000);
  });
});

describe('toAutomationEvent (V4.8)', () => {
  it('maps a connector event with resource + metadata into the runner shape', () => {
    const e = toAutomationEvent(
      platformEvent({ metadata: { from: 'investor@x.com', subject: 'Q3' } }),
    );
    expect(e.source).toBe('connector');
    expect(e.connectorId).toBe('gmail');
    expect(e.event).toBe('connector.sync_completed');
    expect(e.payload.from).toBe('investor@x.com');
    expect(e.payload.resourceId).toBe('gmail');
    expect(e.payload.type).toBe('connector.sync_completed');
  });

  it('activity events carry no connectorId', () => {
    const e = toAutomationEvent(
      platformEvent({ type: 'workspace.opened', category: 'session', resource: null }),
    );
    expect(e.source).toBe('activity');
    expect(e.connectorId).toBeUndefined();
  });
});

describe('wireAutomationProducers (V4.8)', () => {
  it('subscribes to the trigger types and dispatches mapped events to the runner', async () => {
    let captured: ((evt: PlatformEvent) => void) | null = null;
    const on = vi.fn((_types, handler) => {
      captured = handler;
      return { dispose: vi.fn() };
    });
    const dispatch = vi.fn().mockResolvedValue([]);
    const runner = { dispatch } as unknown as AutomationRunner;

    wireAutomationProducers({ on, runner });
    expect(on).toHaveBeenCalledOnce();
    expect(on.mock.calls[0][0]).toEqual(AUTOMATION_TRIGGER_EVENT_TYPES);

    // Simulate the bus delivering an event.
    captured!(platformEvent());
    await Promise.resolve();
    expect(dispatch).toHaveBeenCalledOnce();
    const passed = dispatch.mock.calls[0][0];
    expect(passed.source).toBe('connector');
    expect(passed.connectorId).toBe('gmail');
  });

  it('swallows dispatch errors so the bus is never broken', async () => {
    let captured: ((evt: PlatformEvent) => void) | null = null;
    const on = vi.fn((_types, handler) => {
      captured = handler;
      return { dispose: vi.fn() };
    });
    const runner = {
      dispatch: vi.fn().mockRejectedValue(new Error('boom')),
    } as unknown as AutomationRunner;

    wireAutomationProducers({ on, runner });
    expect(() => captured!(platformEvent())).not.toThrow();
    await Promise.resolve();
  });
});
