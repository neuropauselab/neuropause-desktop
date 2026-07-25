import { describe, it, expect } from 'vitest';
import { AuditChain, auditGenesis, auditStep, AUDIT_CHAIN_ALGO } from './auditChain';

/**
 * The shared tamper-evident audit-chain primitive (REP v2.0 — one canonical
 * integrity implementation for every governance/audit log). These tests prove the
 * chain mechanics independently of any consumer.
 */
interface E {
  id: string;
  v: string;
}
const canon = (e: E) => JSON.stringify({ id: e.id, v: e.v });
const e = (i: number): E => ({ id: `e${i}`, v: `val${i}` });

describe('auditChain primitive', () => {
  it('genesis is deterministic and namespace-scoped', () => {
    expect(auditGenesis('a')).toBe(auditGenesis('a'));
    expect(auditGenesis('a')).not.toBe(auditGenesis('b'));
    expect(auditGenesis('a')).toHaveLength(64); // sha256 hex
  });

  it('append builds a verifiable chain', () => {
    const c = new AuditChain<E>(canon, 'test');
    const entries: E[] = [];
    for (let i = 0; i < 5; i++) {
      entries.push(e(i));
      c.append(e(i));
    }
    const r = c.verify(entries);
    expect(r.ok).toBe(true);
    expect(r.algo).toBe(AUDIT_CHAIN_ALGO);
    expect(r.totalAppended).toBe(5);
    expect(r.dropped).toBe(0);
  });

  it('detects a mutated entry', () => {
    const c = new AuditChain<E>(canon, 'test');
    const entries = [e(0), e(1), e(2)];
    entries.forEach((x) => c.append(x));
    expect(c.verify(entries).ok).toBe(true);
    const tampered = [e(0), { id: 'e1', v: 'FORGED' }, e(2)];
    expect(c.verify(tampered).ok).toBe(false);
  });

  it('dropOldest checkpoints the base so the retained tail still verifies', () => {
    const c = new AuditChain<E>(canon, 'test');
    const all: E[] = [];
    for (let i = 0; i < 6; i++) {
      all.push(e(i));
      c.append(e(i));
    }
    // Rotate out the oldest 3.
    const retained = [...all];
    for (let i = 0; i < 3; i++) {
      c.dropOldest(retained[0]);
      retained.shift();
    }
    const r = c.verify(retained);
    expect(r.ok).toBe(true);
    expect(r.dropped).toBe(3);
    expect(r.retained).toBe(3);
    expect(r.totalAppended).toBe(6);
    // Verifying against the full set (as if nothing was dropped) must FAIL.
    expect(c.verify(all).ok).toBe(false);
  });

  it('snapshot / restore round-trips the chain state', () => {
    const c = new AuditChain<E>(canon, 'test');
    const entries = [e(0), e(1), e(2), e(3)];
    entries.forEach((x) => c.append(x));
    const snap = c.snapshot();

    const c2 = new AuditChain<E>(canon, 'test');
    expect(c2.restore(snap)).toBe(true);
    expect(c2.verify(entries).ok).toBe(true);
    expect(c2.totalAppended).toBe(4);
  });

  it('restore rejects an incompatible / missing snapshot', () => {
    const c = new AuditChain<E>(canon, 'test');
    expect(c.restore(undefined)).toBe(false);
    expect(c.restore({ algo: 'other', base: 'x', head: 'y', dropped: 0, totalAppended: 0 })).toBe(false);
  });

  it('rebuild derives a valid chain from entries (legacy upgrade)', () => {
    const c = new AuditChain<E>(canon, 'test');
    const entries = [e(0), e(1), e(2)];
    c.rebuild(entries);
    expect(c.verify(entries).ok).toBe(true);
    expect(c.totalAppended).toBe(3);
    expect(c.droppedCount).toBe(0);
  });

  it('auditStep is order-sensitive', () => {
    const g = auditGenesis('x');
    expect(auditStep(auditStep(g, 'a'), 'b')).not.toBe(auditStep(auditStep(g, 'b'), 'a'));
  });
});
