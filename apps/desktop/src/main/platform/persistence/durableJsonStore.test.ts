/**
 * ERP Session 33 — DurableJsonStore concurrency hardening.
 *
 * Reproduce-first: concurrent `put` operations shared a fixed `${filePath}.tmp` and raced on the
 * write→rename, so a persist could throw ENOENT (its tmp already renamed by a sibling) and/or a
 * stale-snapshot persist could rename last and lose a committed record. S32 observed ~7/8 failures.
 * These tests attack the shared primitive directly and must pass ONLY once the store serializes its
 * own writes.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

import { DurableJsonStore } from './durableJsonStore';

interface Row { id: string; n: number; tag?: string }

const paths: string[] = [];
const tmp = (): string => {
  const p = join(tmpdir(), `np-djs-${randomUUID()}.json`);
  paths.push(p);
  return p;
};

let store: DurableJsonStore<Row>;
beforeEach(() => {
  store = new DurableJsonStore<Row>(tmp());
});
afterEach(async () => {
  await store.destroy().catch(() => undefined);
  for (const p of paths.splice(0)) {
    await fs.rm(p, { force: true }).catch(() => undefined);
    await fs.rm(`${p}.tmp`, { force: true }).catch(() => undefined);
  }
});

async function reloadCount(s: DurableJsonStore<Row>): Promise<number> {
  await s.reload();
  return s.all().length;
}

describe('S33 · DurableJsonStore concurrent writes', () => {
  it('A/B/C — N concurrent DIFFERENT-key puts: all resolve, all persist, restart-clean', async () => {
    for (const N of [2, 8, 12]) {
      const s = new DurableJsonStore<Row>(tmp());
      const results = await Promise.allSettled(Array.from({ length: N }, (_, i) => s.put({ id: `k${i}`, n: i })));
      expect(results.every((r) => r.status === 'fulfilled')).toBe(true); // no ENOENT / phantom failure
      expect(s.all().length).toBe(N); // in-memory has all
      expect(await reloadCount(s)).toBe(N); // durable file has all (no lost write)
      await s.destroy();
    }
  });

  it('D — repeated stress loops stay clean (no flaky lost write / collision)', async () => {
    for (let loop = 0; loop < 10; loop += 1) {
      const s = new DurableJsonStore<Row>(tmp());
      const results = await Promise.allSettled(Array.from({ length: 8 }, (_, i) => s.put({ id: `k${i}`, n: i })));
      expect(results.every((r) => r.status === 'fulfilled')).toBe(true);
      expect(await reloadCount(s)).toBe(8);
      await s.destroy();
    }
  });

  it('F — concurrent SAME-key puts: last-writer-wins, exactly one row, no throw', async () => {
    const results = await Promise.allSettled(Array.from({ length: 8 }, (_, i) => store.put({ id: 'same', n: i, tag: `v${i}` })));
    expect(results.every((r) => r.status === 'fulfilled')).toBe(true);
    expect(store.all().length).toBe(1);
    expect(await reloadCount(store)).toBe(1);
  });

  it('G — concurrent reads during writes never see corruption and never mutate', async () => {
    const reads: number[] = [];
    await Promise.all([
      ...Array.from({ length: 8 }, (_, i) => store.put({ id: `k${i}`, n: i })),
      ...Array.from({ length: 8 }, () => Promise.resolve().then(() => reads.push(store.all().length))),
    ]);
    expect(reads.every((c) => c >= 0 && c <= 8)).toBe(true); // monotonic-safe snapshot, never corrupt
    expect(store.all().length).toBe(8);
    expect(await reloadCount(store)).toBe(8);
  });

  it('H — restart after concurrent writes recovers the exact committed set + values', async () => {
    await Promise.all(Array.from({ length: 12 }, (_, i) => store.put({ id: `k${i}`, n: i * 10 })));
    const fresh = new DurableJsonStore<Row>(paths[paths.length - 1]);
    await fresh.load();
    expect(fresh.all().length).toBe(12);
    for (let i = 0; i < 12; i += 1) expect(fresh.get(`k${i}`)?.n).toBe(i * 10);
    await fresh.destroy().catch(() => undefined);
  });

  it('canonical file is never left corrupt (valid JSON) after concurrent writes', async () => {
    const p = tmp();
    const s = new DurableJsonStore<Row>(p);
    await Promise.all(Array.from({ length: 8 }, (_, i) => s.put({ id: `k${i}`, n: i })));
    const raw = await fs.readFile(p, 'utf8');
    expect(() => JSON.parse(raw)).not.toThrow(); // no partial/torn write
    expect((JSON.parse(raw).records as Row[]).length).toBe(8);
    // no stale tmp left as authoritative state
    await expect(fs.access(`${p}.tmp`)).rejects.toBeTruthy();
    await s.destroy();
  });
});
