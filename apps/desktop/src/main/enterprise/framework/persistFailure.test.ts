/**
 * A failed background write must be logged, never unhandled.
 *
 * WHY THIS TEST EXISTS. `schedulePersist` deliberately does NOT await the write
 * it starts — that is what makes writes coalesce instead of forming a queue. The
 * consequence is that anything the writer throws has no caller left to catch it,
 * so it becomes an unhandled promise rejection. `EnterpriseRecordStore` was the
 * only store in the codebase whose background writer had no catch;
 * `AppendOnlyJsonStore`, `MemoryStore` and `GraphStore` all have one.
 *
 * It surfaced as a flake — a store persisting in the background while its temp
 * directory was removed underneath it, which macOS reports as EINVAL on rename
 * and Linux as ENOENT — and it turned a fully passing 6,833-test run into a
 * non-zero exit. In production the same shape is a transient disk fault taking
 * down the main process, at a moment when the app is already unhappy.
 *
 * The test does not wait for that race. It removes the directory deliberately,
 * which is the same condition with the timing removed.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { EnterpriseRecordStore } from './enterpriseRecordStore';
import { TEST_TENANT_SCOPE } from '../../tenancy/testScope';

describe('EnterpriseRecordStore — background write failures', () => {
  let dir: string;

  beforeEach(async () => {
    dir = join(tmpdir(), `np-persistfail-${randomUUID()}`);
    await fs.mkdir(dir, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('does not produce an unhandled rejection when the write target disappears', async () => {
    const store = new EnterpriseRecordStore(join(dir, 'customers.json'), 'crm', 'customer');
    store.bindScope(() => TEST_TENANT_SCOPE);
    await store.load();

    const rejections: unknown[] = [];
    const onRejection = (err: unknown): void => {
      rejections.push(err);
    };
    process.on('unhandledRejection', onRejection);

    try {
      // The directory vanishes underneath the store — teardown, an external
      // process, a removed volume. The next write cannot land.
      await fs.rm(dir, { recursive: true, force: true });

      store.create({ title: 'Northwind', fields: { name: 'Northwind' }, actor: 'a@example.com' });

      // `flush()` must still resolve rather than reject: a caller awaiting
      // durability learns the writer finished, and the failure is in the log.
      await expect(store.flush()).resolves.toBeUndefined();

      // Give the microtask queue a turn so any stray rejection would surface.
      await new Promise((r) => setTimeout(r, 10));
      expect(rejections).toEqual([]);
    } finally {
      process.off('unhandledRejection', onRejection);
    }
  });

  it('keeps serving reads from memory after a write failure', async () => {
    const store = new EnterpriseRecordStore(join(dir, 'customers.json'), 'crm', 'customer');
    store.bindScope(() => TEST_TENANT_SCOPE);
    await store.load();
    await fs.rm(dir, { recursive: true, force: true });

    const created = store.create({ title: 'Contoso', fields: { name: 'Contoso' }, actor: 'a@example.com' });
    await store.flush();

    /**
     * The record is still there. Durability failed; correctness did not. That
     * distinction is the reason the write is fail-quiet rather than fail-loud:
     * an ERP write that threw because a background flush lost a disk would undo
     * work the user had already been told succeeded.
     */
    expect(store.get(created.id)?.title).toBe('Contoso');
    expect(store.list({ limit: 10 }).map((r) => r.id)).toContain(created.id);
  });
});
