/** P3.0 Increment 4 — pure delivery-state tests (attempt folding, due selection). */
import { describe, expect, it } from 'vitest';
import type { WebhookDelivery } from '@neuropause/shared';
import { applyAttemptResult, dueDeliveries } from './delivery';
import { WEBHOOK_MAX_ATTEMPTS } from './retry';

function delivery(over: Partial<WebhookDelivery> = {}): WebhookDelivery {
  return {
    id: 'd1', webhookId: 'wh1', eventId: 'e1', eventType: 'enterprise.record.created',
    status: 'pending', attempts: 0, lastStatusCode: null, lastError: null,
    nextAttemptAt: '2026-01-01T00:00:00.000Z', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
    ...over,
  };
}

describe('applyAttemptResult', () => {
  it('marks delivered on success', () => {
    const d = applyAttemptResult(delivery(), { ok: true, statusCode: 200, error: null }, 1000);
    expect(d.status).toBe('delivered');
    expect(d.attempts).toBe(1);
    expect(d.nextAttemptAt).toBeNull();
  });

  it('schedules a retry on the first failure', () => {
    const d = applyAttemptResult(delivery(), { ok: false, statusCode: 500, error: 'HTTP 500' }, 1_000_000);
    expect(d.status).toBe('failed');
    expect(d.attempts).toBe(1);
    expect(d.lastStatusCode).toBe(500);
    expect(Date.parse(d.nextAttemptAt!)).toBeGreaterThan(1_000_000); // backoff in the future
  });

  it('dead-letters once the schedule is exhausted', () => {
    const d = applyAttemptResult(delivery({ attempts: WEBHOOK_MAX_ATTEMPTS - 1 }), { ok: false, statusCode: 503, error: 'x' }, 0);
    expect(d.status).toBe('dead');
    expect(d.attempts).toBe(WEBHOOK_MAX_ATTEMPTS);
    expect(d.nextAttemptAt).toBeNull();
  });
});

describe('dueDeliveries', () => {
  it('selects pending/failed rows whose next attempt is due', () => {
    const list = [
      delivery({ id: 'a', status: 'pending', nextAttemptAt: '2026-01-01T00:00:00.000Z' }),
      delivery({ id: 'b', status: 'failed', nextAttemptAt: '2030-01-01T00:00:00.000Z' }), // future
      delivery({ id: 'c', status: 'delivered', nextAttemptAt: null }),
      delivery({ id: 'd', status: 'dead', nextAttemptAt: null }),
    ];
    const due = dueDeliveries(list, Date.parse('2026-06-01T00:00:00.000Z'));
    expect(due.map((x) => x.id)).toEqual(['a']);
  });
});
