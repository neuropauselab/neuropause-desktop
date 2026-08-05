import { describe, it, expect } from 'vitest';
import { isErr, isOk } from '../../lib/result';
import { hasSecretKey } from './syncSchema';
import { SyncEngine } from './syncEngine';
import { vvCompare, vvMerge } from './versionVector';

function envelope(over: Partial<Record<string, unknown>> = {}) {
  return {
    kind: 'timeline',
    entityId: 'tl_1',
    deviceId: 'dev_a',
    vv: { dev_a: 1 },
    updatedAt: 100,
    state: { title: 'Standup', items: [{ text: 'ship it' }] },
    ...over,
  };
}

describe('Principle 5 — state, never secrets (schema-enforced)', () => {
  it('accepts clean state', () => {
    const engine = new SyncEngine();
    const res = engine.push(envelope());
    expect(isOk(res)).toBe(true);
  });

  it('REJECTS a top-level secret-like field', () => {
    const engine = new SyncEngine();
    const res = engine.push(envelope({ state: { title: 'x', apiKey: 'sk-leak' } }));
    expect(isErr(res)).toBe(true);
    if (isErr(res)) {
      expect(res.error.code).toBe('secret_rejected');
      expect(res.error.issues.join(' ')).toContain('apiKey');
    }
  });

  it('REJECTS a nested secret (recursive)', () => {
    const engine = new SyncEngine();
    const res = engine.push(envelope({ state: { config: { deep: { accessToken: 'abc' } } } }));
    expect(isErr(res)).toBe(true);
    if (isErr(res)) expect(res.error.code).toBe('secret_rejected');
  });

  it('REJECTS a secret inside an array', () => {
    const engine = new SyncEngine();
    const res = engine.push(envelope({ state: { creds: [{ password: 'p' }] } }));
    expect(isErr(res)).toBe(true);
  });

  it('REJECTS a never-syncable kind at the type boundary', () => {
    const engine = new SyncEngine();
    const res = engine.push(envelope({ kind: 'provider_key' }));
    expect(isErr(res)).toBe(true);
    if (isErr(res)) expect(res.error.code).toBe('invalid');
  });

  it('hasSecretKey reports the offending path', () => {
    expect(hasSecretKey({ a: { b: { token: 1 } } })).toBe('a.b.token');
    expect(hasSecretKey({ a: 1, b: 'ok' })).toBeNull();
  });
});

describe('SyncEngine — version-vector convergence', () => {
  it('stores first write, then accepts a dominating update', () => {
    const engine = new SyncEngine();
    engine.push(envelope());
    const res = engine.push(envelope({ vv: { dev_a: 2 }, updatedAt: 200, state: { title: 'v2' } }));
    expect(isOk(res)).toBe(true);
    if (isOk(res)) {
      expect(res.value.accepted).toBe(true);
      expect(res.value.conflictResolved).toBe(false);
      expect((res.value.record.state as { title: string }).title).toBe('v2');
    }
  });

  it('rejects a stale (dominated) update', () => {
    const engine = new SyncEngine();
    engine.push(envelope({ vv: { dev_a: 5 }, updatedAt: 500 }));
    const res = engine.push(envelope({ vv: { dev_a: 2 }, updatedAt: 200 }));
    if (isOk(res)) {
      expect(res.value.accepted).toBe(false);
      expect(res.value.reason).toBe('stale');
    }
  });

  it('resolves concurrent updates LWW and merges the vector', () => {
    const engine = new SyncEngine();
    engine.push(envelope({ deviceId: 'dev_a', vv: { dev_a: 1 }, updatedAt: 100, state: { title: 'A' } }));
    const res = engine.push(
      envelope({ deviceId: 'dev_b', vv: { dev_b: 1 }, updatedAt: 150, state: { title: 'B' } }),
    );
    expect(isOk(res)).toBe(true);
    if (isOk(res)) {
      expect(res.value.conflictResolved).toBe(true);
      expect((res.value.record.state as { title: string }).title).toBe('B'); // higher updatedAt wins
      expect(res.value.record.vv).toEqual({ dev_a: 1, dev_b: 1 });
    }
  });

  it('pull returns records updated at/after a cursor', () => {
    const engine = new SyncEngine();
    engine.push(envelope({ entityId: 'tl_old', updatedAt: 50 }));
    engine.push(envelope({ entityId: 'tl_new', updatedAt: 300 }));
    const recent = engine.pull(100);
    expect(recent.map((r) => r.entityId)).toEqual(['tl_new']);
  });
});

describe('versionVector', () => {
  it('compares and merges', () => {
    expect(vvCompare({ a: 1 }, { a: 1 })).toBe('equal');
    expect(vvCompare({ a: 2 }, { a: 1 })).toBe('dominates');
    expect(vvCompare({ a: 1 }, { a: 2 })).toBe('dominated');
    expect(vvCompare({ a: 1 }, { b: 1 })).toBe('concurrent');
    expect(vvMerge({ a: 1, b: 3 }, { a: 2 })).toEqual({ a: 2, b: 3 });
  });
});
