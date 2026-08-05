import { describe, it, expect } from 'vitest';
import { AuditChain, deriveAuditId, verifyChain, type AuditEntry } from './auditChain';

const input = (over: Partial<AuditEntry> = {}) => ({
  actor: 'usr_1',
  action: 'device.enrolled',
  target: 'dev_1',
  deviceId: 'dev_a',
  at: 1000,
  dataHash: 'abc',
  ...over,
});

describe('deriveAuditId', () => {
  it('is deterministic and content-sensitive', () => {
    expect(deriveAuditId(null, input())).toBe(deriveAuditId(null, input()));
    expect(deriveAuditId(null, input())).not.toBe(deriveAuditId(null, input({ action: 'other' })));
    expect(deriveAuditId('aud_prev', input())).not.toBe(deriveAuditId(null, input()));
  });
});

describe('AuditChain', () => {
  it('links entries and updates the head', () => {
    const chain = new AuditChain();
    const a = chain.append(input());
    const b = chain.append(input({ action: 'device.trusted' }));
    expect(a.prevId).toBeNull();
    expect(b.prevId).toBe(a.auditId);
    expect(chain.provenance()).toEqual([a.auditId, b.auditId]);
  });

  it('verifies a clean multi-device chain', () => {
    const chain = new AuditChain();
    chain.append(input({ deviceId: 'dev_a' }));
    chain.append(input({ deviceId: 'dev_b', action: 'sync.pushed' }));
    chain.append(input({ deviceId: 'dev_c', action: 'approval.granted' }));
    expect(chain.verify()).toEqual({ valid: true, brokenAt: null });
  });

  it('detects a tampered field (hash mismatch)', () => {
    const chain = new AuditChain();
    chain.append(input());
    chain.append(input({ action: 'sync.pushed' }));
    const entries = chain.list();
    entries[1] = { ...entries[1], action: 'sync.SILENTLY_CHANGED' };
    const res = verifyChain(entries);
    expect(res.valid).toBe(false);
    expect(res.brokenAt).toBe(1);
    expect(res.reason).toContain('tampered');
  });

  it('detects a broken link (removed entry)', () => {
    const chain = new AuditChain();
    chain.append(input());
    chain.append(input({ action: 'b' }));
    chain.append(input({ action: 'c' }));
    const entries = chain.list();
    entries.splice(1, 1); // drop the middle entry
    const res = verifyChain(entries);
    expect(res.valid).toBe(false);
    expect(res.reason).toBe('broken link');
  });

  it('exposes secret-free refs (hash only, no payload)', () => {
    const chain = new AuditChain();
    chain.append(input({ dataHash: 'deadbeef' }));
    const refs = chain.toRefs();
    expect(refs[0]).toMatchObject({ prevId: null, hash: 'deadbeef' });
    expect(refs[0].auditId.startsWith('aud_')).toBe(true);
  });
});
