/**
 * S126 — evidence trace / correlation timeline (pure, deterministic). Proves exact-match correlation
 * over the SAME committed-command + delivered-event shapes: chronological ordering, exact-match filtering,
 * honest no-correlation state, bounding, and that neither raw payloads nor error text nor secrets leak.
 */
import { describe, it, expect } from 'vitest';
import type { CommittedCommand } from '../platform/command/durableCommandJournal';
import type { DeliveredEventRecord } from '../platform/command/deliveredEventLog';
import { composeEvidenceTrace, MAX_TRACE_ENTRIES, boundTraceLimit } from './evidenceTrace';

function cmd(over: Partial<{ id: string; commandType: string; status: string; correlationId: string; committedAt: string; aggregateId: string; lastError: string }> = {}): CommittedCommand {
  return {
    id: over.id ?? `tx_${Math.random()}`,
    tenantId: 'tenant-A',
    idempotencyKey: `idem-${over.id ?? '1'}`,
    commandType: over.commandType ?? 'CreateSalesOrder',
    result: { secretField: 'SECRET-RESULT-PAYLOAD' },
    event: { actor: 'op@np.dev', aggregateId: over.aggregateId ?? 'so-1', type: 'sales.order.created', correlationId: over.correlationId ?? 'corr-1' } as never,
    outbox: { status: over.status ?? 'DELIVERED', attempts: 1, ...(over.lastError ? { lastError: over.lastError } : {}) },
    committedAt: over.committedAt ?? '2026-09-05T00:00:01.000Z',
  } as unknown as CommittedCommand;
}
function del(over: Partial<{ id: string; type: string; correlationId: string; deliveredAt: string; aggregateId: string }> = {}): DeliveredEventRecord {
  return {
    id: over.id ?? `ev_${Math.random()}`,
    tenantId: 'tenant-A',
    type: over.type ?? 'sales.order.created',
    aggregateId: over.aggregateId ?? 'so-1',
    correlationId: over.correlationId ?? 'corr-1',
    eventAt: '2026-09-05T00:00:00.000Z',
    deliveredAt: over.deliveredAt ?? '2026-09-05T00:00:05.000Z',
  };
}

describe('S126 · evidence trace (pure)', () => {
  it('composes an exact-correlation trace chronologically (command then its delivery)', () => {
    const cmds = [cmd({ id: 'tx1', correlationId: 'corr-1', committedAt: '2026-09-05T00:00:01.000Z' })];
    const dels = [del({ id: 'ev1', correlationId: 'corr-1', deliveredAt: '2026-09-05T00:00:05.000Z' })];
    const t = composeEvidenceTrace(cmds, dels, 'corr-1');
    expect(t.found).toBe(true);
    expect(t.counts).toEqual({ command: 1, delivered: 1, total: 2 });
    expect(t.entries.map((e) => e.source)).toEqual(['command-journal', 'delivered-events']); // 01s before 05s
    expect(t.inboundCorrelatable).toBe(false);
  });

  it('EXACT match only — a different correlationId is not included (no fuzzy inference)', () => {
    const cmds = [cmd({ id: 'a', correlationId: 'corr-1' }), cmd({ id: 'b', correlationId: 'corr-2' })];
    const t = composeEvidenceTrace(cmds, [], 'corr-1');
    expect(t.entries.map((e) => e.id)).toEqual(['a']);
  });

  it('temporally adjacent records with different correlationIds are NOT linked', () => {
    const cmds = [
      cmd({ id: 'a', correlationId: 'corr-1', committedAt: '2026-09-05T00:00:01.000Z' }),
      cmd({ id: 'b', correlationId: 'corr-2', committedAt: '2026-09-05T00:00:01.500Z' }), // adjacent in time
    ];
    const t = composeEvidenceTrace(cmds, [], 'corr-1');
    expect(t.counts.total).toBe(1);
    expect(t.entries[0].id).toBe('a');
  });

  it('blank correlationId ⇒ honest no-identifier state (found:false, note), never a fuzzy match', () => {
    const t = composeEvidenceTrace([cmd({ correlationId: 'corr-1' })], [], '   ');
    expect(t.found).toBe(false);
    expect(t.counts.total).toBe(0);
    expect(typeof t.note).toBe('string');
  });

  it('non-matching correlationId ⇒ found:false, zero entries, no throw', () => {
    const t = composeEvidenceTrace([cmd({ correlationId: 'corr-1' })], [], 'corr-NOPE');
    expect(t.found).toBe(false);
    expect(t.entries).toEqual([]);
  });

  it('NEVER exposes raw result payloads, raw outbox error text, or secrets', () => {
    const cmds = [cmd({ id: 'a', correlationId: 'corr-1', lastError: 'BEARER sk-LEAK in error' })];
    const t = composeEvidenceTrace(cmds, [], 'corr-1');
    const blob = JSON.stringify(t).toLowerCase();
    for (const forbidden of ['secret', 'bearer', 'sk-leak', 'secret-result-payload', 'password', 'token', 'rawbody']) {
      expect(blob).not.toContain(forbidden);
    }
  });

  it('is bounded by the caller limit', () => {
    const cmds = Array.from({ length: 250 }, (_, i) => cmd({ id: `c${i}`, correlationId: 'corr-1', committedAt: `2026-09-05T00:00:${String(i % 60).padStart(2, '0')}.000Z` }));
    const t = composeEvidenceTrace(cmds, [], 'corr-1', { limit: 10 });
    expect(t.entries.length).toBe(10);
    expect(t.bounded).toBe(true);
    expect(t.counts.command).toBe(250); // counts reflect all matches; entries are bounded
  });

  it('hostile correlationId is treated as an opaque exact key (matches nothing, no throw)', () => {
    const cmds = [cmd({ correlationId: 'corr-1' })];
    expect(() => composeEvidenceTrace(cmds, [], "'; DROP TABLE--")).not.toThrow();
    expect(composeEvidenceTrace(cmds, [], "'; DROP TABLE--").found).toBe(false);
  });

  it('boundTraceLimit clamps junk to default and caps at max', () => {
    expect(boundTraceLimit('junk')).toBeGreaterThan(0);
    expect(boundTraceLimit(-1)).toBeGreaterThan(0);
    expect(boundTraceLimit(99999)).toBe(MAX_TRACE_ENTRIES);
  });
});

describe('S127 · evidence trace + delivery posture (exact txId join)', () => {
  it('a command entry joins its delivery posture by EXACT txId', () => {
    const cmds = [cmd({ id: 'tx1', correlationId: 'corr-1', status: 'RETRYABLE' })];
    const deliveryByTxId = new Map([['tx1', { state: 'RETRYING' as const, attempts: 3, deliveredAt: undefined }]]);
    const t = composeEvidenceTrace(cmds, [], 'corr-1', { deliveryByTxId });
    const e = t.entries.find((x) => x.id === 'tx1')!;
    expect(e.delivery).toMatchObject({ state: 'RETRYING', linked: true, attempts: 3 });
  });

  it('a command txId absent from the delivery map is honestly NOT_LINKED (no fuzzy join)', () => {
    const cmds = [cmd({ id: 'tx1', correlationId: 'corr-1' })];
    const deliveryByTxId = new Map([['tx-OTHER', { state: 'DELIVERED' as const, attempts: 1 }]]);
    const t = composeEvidenceTrace(cmds, [], 'corr-1', { deliveryByTxId });
    expect(t.entries.find((x) => x.id === 'tx1')!.delivery).toMatchObject({ state: 'NOT_LINKED', linked: false });
  });

  it('a delivered-sink entry (event id, not a txId) is always NOT_LINKED', () => {
    const dels = [del({ id: 'ev1', correlationId: 'corr-1' })];
    // even if the delivery map happened to contain the event id, delivered entries never join.
    const deliveryByTxId = new Map([['ev1', { state: 'DELIVERED' as const, attempts: 1 }]]);
    const t = composeEvidenceTrace([], dels, 'corr-1', { deliveryByTxId });
    expect(t.entries.find((x) => x.id === 'ev1')!.delivery).toMatchObject({ state: 'NOT_LINKED', linked: false });
  });

  it('no delivery evidence supplied ⇒ command entries are UNAVAILABLE (not fabricated)', () => {
    const cmds = [cmd({ id: 'tx1', correlationId: 'corr-1' })];
    const t = composeEvidenceTrace(cmds, [], 'corr-1'); // no deliveryByTxId
    expect(t.entries.find((x) => x.id === 'tx1')!.delivery).toMatchObject({ state: 'UNAVAILABLE', linked: false });
  });

  it('delivery posture adds no credential/secret material to the trace', () => {
    const cmds = [cmd({ id: 'tx1', correlationId: 'corr-1', lastError: 'BEARER sk-LEAK' })];
    const deliveryByTxId = new Map([['tx1', { state: 'DELIVERED' as const, attempts: 1, deliveredAt: '2026-09-05T00:00:05.000Z' }]]);
    const blob = JSON.stringify(composeEvidenceTrace(cmds, [], 'corr-1', { deliveryByTxId })).toLowerCase();
    for (const forbidden of ['secret', 'bearer', 'sk-leak', 'password', 'token', 'rawbody']) {
      expect(blob).not.toContain(forbidden);
    }
  });
});
