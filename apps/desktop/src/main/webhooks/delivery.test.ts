/** P3.0 Increment 4 — pure delivery-state tests (attempt folding, due selection). */
import { describe, expect, it } from 'vitest';
import type { WebhookDelivery } from '@neuropause/shared';
import { applyAttemptResult, dueDeliveries, selectEvictions } from './delivery';
import { WEBHOOK_MAX_ATTEMPTS } from './retry';

function delivery(over: Partial<WebhookDelivery> = {}): WebhookDelivery {
  return {
    id: 'd1', webhookId: 'wh1', eventId: 'e1', eventType: 'enterprise.record.created',
    status: 'pending', attempts: 0, lastStatusCode: null, lastError: null,
    nextAttemptAt: '2026-01-01T00:00:00.000Z', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
    ...over,
  };
}

describe('selectEvictions (outbox hard cap)', () => {
  const row = (id: string, status: 'delivered' | 'dead' | 'pending' | 'failed', createdAt: string) => ({ id, status, createdAt });

  it('evicts nothing at or under the cap', () => {
    expect(selectEvictions([row('a', 'pending', '1')], 5)).toEqual([]);
  });

  it('evicts terminal rows oldest-first before any non-terminal row', () => {
    const rows = [
      row('old-pending', 'pending', '2026-01-01'),
      row('new-delivered', 'delivered', '2026-01-03'),
      row('old-dead', 'dead', '2026-01-02'),
    ];
    // cap 2 → evict exactly 1: the oldest terminal (old-dead), never the pending row.
    expect(selectEvictions(rows, 2)).toEqual(['old-dead']);
  });

  it('falls through to the oldest non-terminal rows when a backlog is still over cap', () => {
    const rows = [
      row('p1', 'pending', '2026-01-01'),
      row('p2', 'failed', '2026-01-02'),
      row('p3', 'pending', '2026-01-03'),
    ];
    // cap 1, no terminal rows → evict the 2 oldest non-terminal (p1, p2).
    expect(selectEvictions(rows, 1)).toEqual(['p1', 'p2']);
  });

  /**
   * THE CAP IS PER OWNER. P13C ROUND 10 — NEW-H2.
   *
   * The three cases above all carry ONE owner and stayed green through the whole
   * finding, because a single-owner fixture cannot distinguish "the newest N" from
   * "the newest N of MINE". Sorted install-wide, terminal-first put a quiet
   * tenant's DEAD-LETTERED rows at the very front of the eviction order — the
   * dead-letter queue is what `deadLetters()` reads and what `replay()` re-sends,
   * so the deletion took evidence rather than history.
   *
   * The end-to-end proof over the real store, its file and its stats is
   * `tenancy/round10InboxWebhookRetention.test.ts`.
   */
  const owned = (
    id: string,
    status: 'delivered' | 'dead' | 'pending' | 'failed',
    createdAt: string,
    tenantId: string,
  ) => ({ id, status, createdAt, tenantId, workspaceId: null });

  it('charges each owner its own budget: a flood evicts only the flooder\'s rows', () => {
    const rows = [
      // B: two rows, one of them dead-lettered and the OLDEST row in the whole set.
      owned('b-dead', 'dead', '2026-01-01', 'org-b'),
      owned('b-pending', 'pending', '2026-01-02', 'org-b'),
      // A: four rows, all newer than B's.
      owned('a1', 'pending', '2026-01-03', 'org-a'),
      owned('a2', 'delivered', '2026-01-04', 'org-a'),
      owned('a3', 'pending', '2026-01-05', 'org-a'),
      owned('a4', 'pending', '2026-01-06', 'org-a'),
    ];
    // Install-wide with cap 2 this returned ['b-dead','a2','b-pending','a1'] — B wiped out.
    // Per owner with cap 2: B is at cap and loses nothing; A sheds its 2 by its own rule
    // (terminal first, then oldest non-terminal).
    const evicted = selectEvictions(rows, 2);
    expect(evicted.sort()).toEqual(['a1', 'a2']);
    expect(evicted).not.toContain('b-dead');
    expect(evicted).not.toContain('b-pending');
  });

  it('an unowned row has its own budget and is not evicted by an owned flood', () => {
    const rows = [
      row('legacy', 'dead', '2026-01-01'), // pre-ownership row: no tenantId at all
      owned('a1', 'pending', '2026-01-02', 'org-a'),
      owned('a2', 'pending', '2026-01-03', 'org-a'),
      owned('a3', 'pending', '2026-01-04', 'org-a'),
    ];
    expect(selectEvictions(rows, 1)).toEqual(['a1', 'a2']);
  });

  it('returns nothing when every owner is at or under cap, however many owners there are', () => {
    const rows = [
      owned('a1', 'pending', '2026-01-01', 'org-a'),
      owned('a2', 'pending', '2026-01-02', 'org-a'),
      owned('b1', 'dead', '2026-01-03', 'org-b'),
      owned('b2', 'pending', '2026-01-04', 'org-b'),
      owned('c1', 'pending', '2026-01-05', 'org-c'),
    ];
    // Five rows over a cap of 2: the install-wide version evicted three of them.
    expect(selectEvictions(rows, 2)).toEqual([]);
  });
});

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
