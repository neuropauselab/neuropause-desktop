/**
 * S109 (H3) — domain event-log tamper-evidence (harvested from persistence/eventStore.ts,
 * strengthened to a hash chain). Proves the live log DETECTS every tamper class, fail-closed,
 * tenant-isolated, without a second event store and without mutating historical events.
 */
import { describe, it, expect } from 'vitest';
import { DomainEventLog, computeEventChain, verifyEventChain, canonicalEvent } from './domainEventLog';
import type { DomainEvent } from './domainCommand';

const T = 'tenant-A';
const T2 = 'tenant-B';

function ev(over: Partial<DomainEvent> = {}): Omit<DomainEvent, 'eventId'> {
  return { tenantId: T, type: 'PurchaseOrderApproved' as DomainEvent['type'], detail: { poId: 'PO-1', amount: 100 }, ...over } as Omit<DomainEvent, 'eventId'>;
}

function seed(log: DomainEventLog, tenant = T, n = 3): DomainEvent[] {
  const out: DomainEvent[] = [];
  for (let i = 0; i < n; i += 1) out.push(log.append(ev({ tenantId: tenant, detail: { poId: `PO-${i}`, amount: (i + 1) * 100 } })));
  return out;
}

describe('H3 — reproduce: an untampered stream verifies', () => {
  it('append maintains a chain; live verifyIntegrity is ok; head is stable', () => {
    const log = new DomainEventLog();
    seed(log);
    const v = log.verifyIntegrity(T);
    expect(v.ok).toBe(true);
    expect(v.length).toBe(3);
    expect(v.head).toBe(log.integrityHead(T));
    // chain grows one per event; deterministic (recompute matches)
    expect([...log.chain(T)]).toEqual(computeEventChain(T, log.list(T)));
  });

  it('the same append returns the SAME frozen event shape as before (producers unaffected)', () => {
    const log = new DomainEventLog();
    const e = log.append(ev());
    expect(e.eventId).toMatch(/^evt_/);
    expect(e.detail).toEqual({ poId: 'PO-1', amount: 100 });
    expect(Object.isFrozen(e)).toBe(true);
  });
});

describe('H3 — adversarial: every tamper class is DETECTED (fail-closed)', () => {
  it('MODIFIED historical event → hash-mismatch at its index', () => {
    const log = new DomainEventLog();
    const events = seed(log);
    const chain = log.chain(T);
    const tampered = events.map((e, i) => (i === 1 ? ({ ...e, detail: { poId: 'PO-1', amount: 999999 } } as DomainEvent) : e));
    const v = verifyEventChain(T, tampered, chain);
    expect(v.ok).toBe(false);
    expect(v.firstDivergenceIndex).toBe(1);
  });

  it('REORDERED events → detected', () => {
    const log = new DomainEventLog();
    const events = seed(log);
    const chain = log.chain(T);
    const reordered = [events[0]!, events[2]!, events[1]!];
    expect(verifyEventChain(T, reordered, chain).ok).toBe(false);
  });

  it('REMOVED event → length-mismatch', () => {
    const log = new DomainEventLog();
    const events = seed(log);
    const chain = log.chain(T);
    const v = verifyEventChain(T, [events[0]!, events[2]!], chain);
    expect(v.ok).toBe(false);
    expect(v.reason).toMatch(/length-mismatch/);
  });

  it('DUPLICATED event → detected (length + hash)', () => {
    const log = new DomainEventLog();
    const events = seed(log);
    const chain = log.chain(T);
    expect(verifyEventChain(T, [events[0]!, events[0]!, events[1]!, events[2]!], chain).ok).toBe(false);
  });

  it('FORGED hash in the chain metadata → detected', () => {
    const log = new DomainEventLog();
    const events = seed(log);
    const forged = [...log.chain(T)];
    forged[2] = 'deadbeef'.repeat(8);
    expect(verifyEventChain(T, events, forged).ok).toBe(false);
  });

  it('CORRUPTED integrity metadata (wrong length / junk) → fail closed, no throw', () => {
    const log = new DomainEventLog();
    const events = seed(log);
    expect(verifyEventChain(T, events, []).ok).toBe(false);
    expect(verifyEventChain(T, events, ['x']).ok).toBe(false);
    // @ts-expect-error deliberately passing a non-array to prove fail-closed
    expect(verifyEventChain(T, events, null).ok).toBe(false);
  });

  it('CROSS-TENANT substitution → detected (canonical + genesis bind the tenant)', () => {
    const log = new DomainEventLog();
    const aEvents = seed(log, T, 3);
    const aChain = log.chain(T);
    const bEvent = log.append(ev({ tenantId: T2, detail: { poId: 'PO-B', amount: 42 } }));
    // splice tenant B's event into tenant A's stream position 1
    const spliced = [aEvents[0]!, bEvent, aEvents[2]!];
    expect(verifyEventChain(T, spliced, aChain).ok).toBe(false);
    // and B's own stream verifies independently (isolation preserved)
    expect(log.verifyIntegrity(T2).ok).toBe(true);
    // A's real stream still verifies (untouched by B)
    expect(log.verifyIntegrity(T).ok).toBe(true);
  });

  it('REPLAY at the log layer: two identical-detail appends get distinct ids → distinct chain positions, still verifies', () => {
    const log = new DomainEventLog();
    const a = log.append(ev({ detail: { poId: 'PO-X', amount: 5 } }));
    const b = log.append(ev({ detail: { poId: 'PO-X', amount: 5 } }));
    expect(a.eventId).not.toBe(b.eventId);
    expect(canonicalEvent(a)).not.toBe(canonicalEvent(b)); // distinct ids ⇒ distinct canonical
    expect(log.verifyIntegrity(T).ok).toBe(true); // not a false corruption
    expect(log.chain(T).length).toBe(2);
  });

  it('verification is READ-ONLY: it never mutates events or the chain', () => {
    const log = new DomainEventLog();
    seed(log);
    const before = { list: log.list(T).length, head: log.integrityHead(T), chain: [...log.chain(T)] };
    log.verifyIntegrity(T);
    verifyEventChain(T, log.list(T), log.chain(T));
    expect(log.list(T).length).toBe(before.list);
    expect(log.integrityHead(T)).toBe(before.head);
    expect([...log.chain(T)]).toEqual(before.chain);
  });
});

describe('H3 — tenant isolation of the chain', () => {
  it('each tenant has an independent chain; clear() resets both', () => {
    const log = new DomainEventLog();
    seed(log, T, 2);
    seed(log, T2, 4);
    expect(log.chain(T).length).toBe(2);
    expect(log.chain(T2).length).toBe(4);
    expect(log.integrityHead(T)).not.toBe(log.integrityHead(T2));
    log.clear();
    expect(log.chain(T).length).toBe(0);
    expect(log.integrityHead(T)).toBeNull();
  });
});
