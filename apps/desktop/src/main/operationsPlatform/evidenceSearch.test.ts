/**
 * S125 — operational evidence search (pure, deterministic). Proves the lexical/filter math over the SAME
 * committed-command + inbound-lineage shapes the operator already reads: AND-token matching, kind filter,
 * empty-query browse, bounding, ordering, hostile-query containment, and — critically — that neither the
 * match haystack nor the emitted result carries raw result payloads, raw outbox error text, or secrets.
 */
import { describe, it, expect } from 'vitest';
import type { CommittedCommand } from '../platform/command/durableCommandJournal';
import type { InboundLineageRow } from '../connectors/inbound/lineage';
import { searchOperationalEvidence, MAX_EVIDENCE_RESULTS, boundEvidenceLimit } from './evidenceSearch';

function cmd(over: Partial<{ id: string; commandType: string; status: string; actor: string; aggregateId: string; correlationId: string; committedAt: string; lastError: string }> = {}): CommittedCommand {
  return {
    id: over.id ?? `tx_${Math.random()}`,
    tenantId: 'tenant-A',
    idempotencyKey: `idem-${over.id ?? '1'}`,
    commandType: over.commandType ?? 'CreateSalesOrder',
    result: { secretField: 'SECRET-RESULT-PAYLOAD' },
    event: { actor: over.actor ?? 'op@np.dev', aggregateId: over.aggregateId ?? 'so-1', type: 'sales.order.created', correlationId: over.correlationId ?? 'corr-1' } as never,
    outbox: { status: over.status ?? 'DELIVERED', attempts: 1, ...(over.lastError ? { lastError: over.lastError } : {}) },
    committedAt: over.committedAt ?? '2026-09-05T00:00:01.000Z',
  } as unknown as CommittedCommand;
}
function row(connectorId: string, provider: string, receivedAt: number): InboundLineageRow {
  return { eventId: `${connectorId}-${receivedAt}`, connectorId, provider, verifiedSource: provider, receivedAt, tenantId: 'tenant-A', dedupeRef: null, credentialsPresent: false };
}

describe('S125 · operational evidence search (pure)', () => {
  it('empty query browses both kinds, bounded and ordered most-recent-first', () => {
    const cmds = [cmd({ id: 'a', committedAt: '2026-09-05T00:00:01.000Z' }), cmd({ id: 'b', committedAt: '2026-09-05T00:00:09.000Z' })];
    const lin = [row('github', 'github', 5000)];
    const r = searchOperationalEvidence(cmds, lin, '');
    expect(r.counts).toEqual({ command: 2, inbound: 1, total: 3 });
    expect(r.hits.length).toBe(3);
    // equal score (empty query) → timestamp desc: b (…09) before a (…01)
    const cmdHits = r.hits.filter((h) => h.kind === 'command').map((h) => h.id);
    expect(cmdHits).toEqual(['b', 'a']);
  });

  it('AND-token lexical match filters commands by safe fields', () => {
    const cmds = [cmd({ id: 'a', commandType: 'CreateSalesOrder', status: 'DELIVERED' }), cmd({ id: 'b', commandType: 'PostGoodsReceipt', status: 'RETRYABLE' })];
    // both tokens must appear (AND): 'createsalesorder' is only in a's commandType, 'delivered' only in a's status
    const r = searchOperationalEvidence(cmds, [], 'createsalesorder delivered');
    expect(r.hits.map((h) => h.id)).toEqual(['a']);
    // a single non-matching token drops everything
    expect(searchOperationalEvidence(cmds, [], 'createsalesorder retryable').hits.map((h) => h.id)).toEqual([]);
  });

  it('matches inbound lineage by connector/provider', () => {
    const r = searchOperationalEvidence([], [row('github', 'github', 1), row('slack', 'slack', 2)], 'slack');
    expect(r.hits.map((h) => h.connectorId)).toEqual(['slack']);
    expect(r.hits[0]).toMatchObject({ kind: 'inbound', source: 'connector-inbound', status: 'verified' });
  });

  it('kind filter narrows to one evidence kind', () => {
    const cmds = [cmd({ id: 'a' })];
    const lin = [row('github', 'github', 1)];
    expect(searchOperationalEvidence(cmds, lin, '', { kind: 'command' }).hits.every((h) => h.kind === 'command')).toBe(true);
    expect(searchOperationalEvidence(cmds, lin, '', { kind: 'inbound' }).hits.every((h) => h.kind === 'inbound')).toBe(true);
  });

  it('NEVER exposes raw result payloads, raw outbox error text, or secrets', () => {
    const cmds = [cmd({ id: 'a', lastError: 'BEARER sk-SECRETTOKEN leaked in error' })];
    const r = searchOperationalEvidence(cmds, [], '');
    const blob = JSON.stringify(r).toLowerCase();
    for (const forbidden of ['secret', 'bearer', 'sk-secrettoken', 'secret-result-payload', 'password', 'token', 'rawbody']) {
      expect(blob).not.toContain(forbidden);
    }
  });

  it('a query token that only appears in the raw error text does NOT match (error text is not searchable)', () => {
    const cmds = [cmd({ id: 'a', lastError: 'ECONNRESET-UNIQUE-STRING' })];
    const r = searchOperationalEvidence(cmds, [], 'econnreset-unique-string');
    expect(r.hits.length).toBe(0); // error text is excluded from the haystack
  });

  it('results are bounded by the caller limit', () => {
    const cmds = Array.from({ length: 60 }, (_, i) => cmd({ id: `c${i}` }));
    const r = searchOperationalEvidence(cmds, [], '', { limit: 10 });
    expect(r.hits.length).toBe(10);
    expect(r.bounded).toBe(true);
  });

  it('hostile / pathological query cannot escape the projection (bounded tokens, no throw)', () => {
    const huge = 'x '.repeat(10000);
    const cmds = [cmd({ id: 'a' })];
    expect(() => searchOperationalEvidence(cmds, [], huge)).not.toThrow();
    // a query with many non-matching tokens simply returns nothing, never errors
    expect(searchOperationalEvidence(cmds, [], 'zzz1 zzz2 zzz3 nope').hits.length).toBe(0);
  });

  it('boundEvidenceLimit clamps junk to the default and caps at the max', () => {
    expect(boundEvidenceLimit('junk')).toBeGreaterThan(0);
    expect(boundEvidenceLimit(-5)).toBeGreaterThan(0);
    expect(boundEvidenceLimit(9999)).toBe(MAX_EVIDENCE_RESULTS);
  });
});
