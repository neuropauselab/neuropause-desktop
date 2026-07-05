import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ExecutionSession } from '@neuropause/shared';
import { ExecutionStore } from './executionStore';

function session(over: Partial<ExecutionSession>): ExecutionSession {
  return {
    id: 'e1',
    kind: 'task',
    label: 'Task',
    state: 'completed',
    steps: [],
    currentStep: -1,
    startedAt: '2026-01-10T00:00:00.000Z',
    completedAt: '2026-01-10T00:00:01.000Z',
    durationMs: 1000,
    error: null,
    resultSummary: null,
    result: null,
    ...over,
  };
}

describe('ExecutionStore (V5.8)', () => {
  let dir: string;
  let path: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'np-exec-'));
    path = join(dir, 'executions.json');
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('saves a session and reloads it from a fresh store (survives restart)', async () => {
    const store = new ExecutionStore(path);
    await store.save(session({ id: 'a', resultSummary: 'done' }));
    // A brand-new store instance = an app restart.
    const reloaded = new ExecutionStore(path);
    const all = reloaded.loadAllSync();
    expect(all).toHaveLength(1);
    expect(all[0]).toMatchObject({ id: 'a', resultSummary: 'done' });
  });

  it('upserts by id rather than duplicating', async () => {
    const store = new ExecutionStore(path);
    await store.save(session({ id: 'a', state: 'running' }));
    await store.save(session({ id: 'a', state: 'completed' }));
    const all = store.loadAllSync();
    expect(all).toHaveLength(1);
    expect(all[0].state).toBe('completed');
  });

  it('survives concurrent saves without a temp-file race', async () => {
    const store = new ExecutionStore(path);
    await Promise.all(Array.from({ length: 25 }, (_, i) => store.save(session({ id: `s${i}` }))));
    const reloaded = new ExecutionStore(path);
    expect(reloaded.loadAllSync().length).toBe(25);
  });

  it('archives sessions older than the retention window', async () => {
    const store = new ExecutionStore(path);
    const nowMs = Date.parse('2026-02-01T00:00:00.000Z');
    await store.save(session({ id: 'old', completedAt: '2026-01-01T00:00:00.000Z' }));
    await store.save(session({ id: 'new', completedAt: '2026-01-31T00:00:00.000Z' }));
    const pruned = await store.archiveOlderThan(7 * 86_400_000, nowMs);
    expect(pruned).toBe(1);
    const remaining = store.loadAllSync();
    expect(remaining.map((s) => s.id)).toEqual(['new']);
  });

  it('treats retention <= 0 as unlimited (no pruning)', async () => {
    const store = new ExecutionStore(path);
    await store.save(session({ id: 'x', completedAt: '2020-01-01T00:00:00.000Z' }));
    const pruned = await store.archiveOlderThan(0, Date.now());
    expect(pruned).toBe(0);
    expect(store.loadAllSync()).toHaveLength(1);
  });
});
