/**
 * Tests for the shared cloud-sync core (@neuropause/shared). The logic lives in the
 * shared package so the desktop engine and this backend converge identically; the
 * tests run here because the backend has the vitest harness and is a first consumer.
 */
import { describe, expect, it } from 'vitest';
import {
  compareSyncRecords,
  isTombstone,
  nextSyncVersion,
  resolveSync,
  type SyncRecord,
} from '@neuropause/shared';

function rec(over: Partial<SyncRecord> = {}): SyncRecord {
  return {
    entityType: 'org_prefs',
    entityId: 'e1',
    orgId: 'org-1',
    version: 1,
    updatedAt: '2026-01-01T00:00:00.000Z',
    deleted: false,
    data: { theme: 'dark' },
    ...over,
  };
}

describe('compareSyncRecords', () => {
  it('orders by version first', () => {
    expect(compareSyncRecords(rec({ version: 1 }), rec({ version: 2 }))).toBe(-1);
    expect(compareSyncRecords(rec({ version: 3 }), rec({ version: 2 }))).toBe(1);
  });

  it('breaks version ties by updatedAt', () => {
    const a = rec({ version: 2, updatedAt: '2026-01-01T00:00:00.000Z' });
    const b = rec({ version: 2, updatedAt: '2026-01-02T00:00:00.000Z' });
    expect(compareSyncRecords(a, b)).toBe(-1);
  });

  it('returns 0 for identical version and timestamp', () => {
    expect(compareSyncRecords(rec(), rec())).toBe(0);
  });
});

describe('resolveSync', () => {
  it('applies the incoming change when there is no current record', () => {
    const inc = rec();
    expect(resolveSync(null, inc)).toEqual({ winner: inc, outcome: 'applied' });
  });

  it('applies a strictly newer incoming change', () => {
    const r = resolveSync(rec({ version: 1 }), rec({ version: 2 }));
    expect(r.outcome).toBe('applied');
    expect(r.winner.version).toBe(2);
  });

  it('ignores a stale incoming change', () => {
    const r = resolveSync(rec({ version: 3 }), rec({ version: 2 }));
    expect(r.outcome).toBe('ignored');
    expect(r.winner.version).toBe(3);
  });

  it('uses updatedAt to decide when versions match', () => {
    const cur = rec({ version: 2, updatedAt: '2026-01-01T00:00:00.000Z' });
    const inc = rec({ version: 2, updatedAt: '2026-06-01T00:00:00.000Z' });
    expect(resolveSync(cur, inc).outcome).toBe('applied');
  });

  it('flags an exact tie with differing data as a conflict and converges deterministically', () => {
    const a = rec({ data: { theme: 'dark' } });
    const b = rec({ data: { theme: 'light' } });
    const r1 = resolveSync(a, b);
    const r2 = resolveSync(b, a);
    expect(r1.outcome).toBe('conflict');
    expect(r2.outcome).toBe('conflict');
    expect(r1.winner.data).toEqual(r2.winner.data);
  });

  it('propagates tombstones as ordinary newer changes', () => {
    const r = resolveSync(rec({ version: 1 }), rec({ version: 2, deleted: true, data: null }));
    expect(r.outcome).toBe('applied');
    expect(isTombstone(r.winner)).toBe(true);
  });
});

describe('nextSyncVersion', () => {
  it('starts at 1 and increments from the current version', () => {
    expect(nextSyncVersion(null)).toBe(1);
    expect(nextSyncVersion(rec({ version: 4 }))).toBe(5);
  });
});
