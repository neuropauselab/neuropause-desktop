import { describe, expect, it, vi } from 'vitest';
import { runMemoryBackfill, type MemoryBackfillDeps, type BackfillBatchResult } from './memoryBackfill';
import type { MemoryItem } from '@neuropause/shared';

function item(id: string, content: string, over: Partial<MemoryItem> = {}): MemoryItem {
  return {
    id,
    kind: 'context',
    origin: 'projected',
    title: id,
    content,
    connectorId: null,
    source: 'manual',
    entityRefs: [],
    tags: [],
    occurredAt: null,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    evidence: null,
    metadata: {} as MemoryItem['metadata'],
    ...over,
  };
}

const ok = (n: number): BackfillBatchResult => ({ processed: n, embedded: n, skipped: 0, failed: 0 });

function deps(over: Partial<MemoryBackfillDeps> = {}): MemoryBackfillDeps {
  return {
    listItems: () => [item('a', 'alpha'), item('b', 'beta')],
    getOrgId: () => 'org-1',
    backfill: vi.fn(async (_org, mems) => ok(mems.length)),
    ...over,
  };
}

describe('runMemoryBackfill', () => {
  it('no-ops when there is no active org (personal memory never leaves)', async () => {
    const backfill = vi.fn(async () => ok(0));
    const out = await runMemoryBackfill(deps({ getOrgId: () => undefined, backfill }));
    expect(out).toMatchObject({ orgId: null, total: 0, skippedReason: 'no_active_org' });
    expect(backfill).not.toHaveBeenCalled();
  });

  it('maps id→memoryId and content, and posts to the active org', async () => {
    const backfill = vi.fn(async (_org: string, mems: Array<{ memoryId: string; content: string }>) => ok(mems.length));
    await runMemoryBackfill(deps({ backfill }));
    expect(backfill).toHaveBeenCalledWith('org-1', [
      { memoryId: 'a', content: 'alpha' },
      { memoryId: 'b', content: 'beta' },
    ]);
  });

  it('excludes tombstoned and empty-content memories', async () => {
    const backfill = vi.fn(async (_o: string, mems: Array<{ memoryId: string }>) => ok(mems.length));
    await runMemoryBackfill(
      deps({
        listItems: () => [
          item('keep', 'real content'),
          item('dead', 'x', { sync: { deleted: true } as MemoryItem['sync'] }),
          item('blank', '   '),
        ],
        backfill,
      }),
    );
    expect(backfill.mock.calls[0][1].map((m) => (m as { memoryId: string }).memoryId)).toEqual(['keep']);
  });

  it('batches by batchSize and aggregates results across batches', async () => {
    const items = ['a', 'b', 'c', 'd', 'e'].map((id) => item(id, id));
    const sizes: number[] = [];
    const backfill = vi.fn(async (_o: string, mems: unknown[]) => {
      sizes.push(mems.length);
      return ok(mems.length);
    });
    const out = await runMemoryBackfill(deps({ listItems: () => items, backfill, batchSize: 2 }));
    expect(sizes).toEqual([2, 2, 1]); // 5 items, batch 2
    expect(out).toMatchObject({ total: 5, processed: 5, embedded: 5, batches: 3 });
  });

  it('reports progress after each batch', async () => {
    const items = ['a', 'b', 'c'].map((id) => item(id, id));
    const progress: number[] = [];
    await runMemoryBackfill(
      deps({ listItems: () => items, batchSize: 1, onProgress: (p) => progress.push(p.sent) }),
    );
    expect(progress).toEqual([1, 2, 3]);
  });

  it('surfaces failures reported by the backend', async () => {
    const backfill = vi.fn(async () => ({ processed: 2, embedded: 1, skipped: 0, failed: 1 }));
    const out = await runMemoryBackfill(deps({ backfill }));
    expect(out).toMatchObject({ embedded: 1, failed: 1 });
  });
});
