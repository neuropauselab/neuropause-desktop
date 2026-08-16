/**
 * P13C H-FINDING-4 (Option C) — DurableIdempotencyStore: single-process restart durability.
 *
 * "Restart" is modelled faithfully: a FRESH store instance is constructed from the SAME file path,
 * so it shares NO in-memory state with the first — it recovers only what was persisted to disk.
 * This is the correct single-process-restart model (new process = new memory + hydrate from file);
 * it is NOT object reuse (which would share the in-memory map). True OS-process spawning is
 * unnecessary because the file is the ONLY channel between instances.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { IdempotencyKey } from '@neuropause/cst/dist/src/types.js';
import { DurableIdempotencyStore, DurableStoreError } from './durableIdempotencyStore';

const K = (s: string): IdempotencyKey => s as unknown as IdempotencyKey;

let dir: string;
let path: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'nps-durable-idem-'));
  path = join(dir, 'store.json');
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('DurableIdempotencyStore — persistence + restart hydration', () => {
  it('acquire returns fresh IN_FLIGHT and persists it across a restart (fresh instance)', () => {
    const a = new DurableIdempotencyStore(path);
    expect(a.acquire(K('k1'))).toEqual({ fresh: true, state: 'IN_FLIGHT' });
    // Restart: a brand-new instance from the same file hydrates the durable intent.
    const b = new DurableIdempotencyStore(path);
    expect(b.acquire(K('k1'))).toEqual({ fresh: false, state: 'IN_FLIGHT' });
  });

  it('complete persists DONE + the full outcome; a fresh instance replays it', () => {
    const a = new DurableIdempotencyStore(path);
    a.acquire(K('k1'));
    a.complete(K('k1'), { executed: true, verification: 'UNKNOWN' });
    const b = new DurableIdempotencyStore(path);
    expect(b.acquire(K('k1'))).toEqual({ fresh: false, state: 'DONE', outcome: { executed: true, verification: 'UNKNOWN' } });
  });

  it('release removes an IN_FLIGHT intent durably (a fresh instance no longer sees it)', () => {
    const a = new DurableIdempotencyStore(path);
    a.acquire(K('k1'));
    a.release(K('k1'));
    const b = new DurableIdempotencyStore(path);
    expect(b.acquire(K('k1'))).toEqual({ fresh: true, state: 'IN_FLIGHT' }); // gone → fresh again
  });

  it('release does NOT remove a DONE intent (single-use is permanent across restart)', () => {
    const a = new DurableIdempotencyStore(path);
    a.acquire(K('k1'));
    a.complete(K('k1'), { ok: true });
    a.release(K('k1')); // no-op on DONE
    const b = new DurableIdempotencyStore(path);
    expect(b.acquire(K('k1')).state).toBe('DONE');
  });

  it('same key twice within one instance → second is not fresh', () => {
    const a = new DurableIdempotencyStore(path);
    expect(a.acquire(K('k1')).fresh).toBe(true);
    expect(a.acquire(K('k1')).fresh).toBe(false);
  });
});

describe('DurableIdempotencyStore — fail-closed on missing / corrupt persistence', () => {
  it('missing file ⇒ a fresh empty store (nothing consumed yet)', () => {
    const a = new DurableIdempotencyStore(join(dir, 'does-not-exist.json'));
    expect(a.acquire(K('k1'))).toEqual({ fresh: true, state: 'IN_FLIGHT' });
  });

  it('corrupt JSON ⇒ throws on construction (NEVER silently reset to empty)', () => {
    writeFileSync(path, 'this is not json {{{');
    expect(() => new DurableIdempotencyStore(path)).toThrow(DurableStoreError);
  });

  it('valid JSON but unexpected shape ⇒ throws on construction', () => {
    writeFileSync(path, JSON.stringify({ version: 2, records: {} }));
    expect(() => new DurableIdempotencyStore(path)).toThrow(DurableStoreError);
  });

  it('valid shape but an invalid record ⇒ throws on construction', () => {
    writeFileSync(path, JSON.stringify({ version: 1, records: { k1: { state: 'BOGUS' } } }));
    expect(() => new DurableIdempotencyStore(path)).toThrow(DurableStoreError);
  });

  it('persistence failure at acquire ⇒ rolls back the reservation and rethrows (no admission)', () => {
    const store = new DurableIdempotencyStore(path); // dir exists, file absent → fresh construction
    chmodSync(dir, 0o500); // make the directory unwritable ⇒ the temp write fails
    try {
      expect(() => store.acquire(K('k1'))).toThrow();
    } finally {
      chmodSync(dir, 0o700); // restore so cleanup + the rollback assertion can write
    }
    // Rolled back: no phantom admission — the same key acquires FRESH once writability returns.
    expect(store.acquire(K('k1'))).toEqual({ fresh: true, state: 'IN_FLIGHT' });
  });

  it('unreadable persisted store (parent is a file) ⇒ throws on construction (fail closed)', () => {
    const asFile = join(dir, 'afile2');
    writeFileSync(asFile, 'x');
    expect(() => new DurableIdempotencyStore(join(asFile, 'store.json'))).toThrow(DurableStoreError);
  });
});
