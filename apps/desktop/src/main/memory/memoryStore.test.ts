import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { MemoryItem } from '@neuropause/shared';
import { MemoryStore } from './memoryStore';

const NOW = '2026-01-01T00:00:00.000Z';

function projected(id: string, kind: string, title: string, content = title): MemoryItem {
  return {
    id: `mem:${id}`,
    kind: kind as never,
    origin: 'projected',
    title,
    content,
    connectorId: 'github',
    source: 'github',
    entityRefs: [id],
    tags: [],
    occurredAt: NOW,
    createdAt: NOW,
    updatedAt: NOW,
    evidence: { kind: 'document', id },
    metadata: {},
  };
}

describe('MemoryStore', () => {
  let dir: string;
  let path: string;
  const opened: MemoryStore[] = [];

  async function open(p: string): Promise<MemoryStore> {
    const store = new MemoryStore(p);
    await store.load();
    opened.push(store);
    return store;
  }

  beforeEach(async () => {
    dir = await fs.mkdtemp(join(tmpdir(), 'mem-'));
    path = join(dir, 'memory.json');
  });
  afterEach(async () => {
    await Promise.all(opened.map((s) => s.flush()));
    opened.length = 0;
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('remembers explicit items and recalls them by relevance', async () => {
    const store = await open(path);
    const a = store.remember({
      kind: 'decision',
      title: 'Adopt Postgres',
      content: 'We will use Postgres as the primary datastore for the platform',
    });
    store.remember({
      kind: 'note',
      title: 'Standup note',
      content: 'Frontend is blocked on the API',
    });

    expect(a.origin).toBe('explicit');
    expect(a.id.startsWith('mem:explicit:')).toBe(true);

    const res = store.recall({ text: 'postgres datastore' });
    expect(res.hits.length).toBeGreaterThan(0);
    expect(res.hits[0]?.item.id).toBe(a.id);
    expect(res.hits[0]?.score).toBeGreaterThan(0);
    expect(res.hits[0]?.score).toBeLessThanOrEqual(1);
    expect(res.retriever).toBe('lexical');
  });

  it('updates an item metadata, bumps updatedAt, and persists; returns null for unknown id', async () => {
    const store = await open(path);
    const a = store.remember({
      kind: 'decision',
      title: 'D',
      content: 'ship it',
      metadata: { pinned: false, status: 'open' },
    });

    const updated = store.update(
      a.id,
      { metadata: { pinned: true, status: 'resolved' } },
      '2026-07-01T00:00:00.000Z',
    );
    expect(updated?.metadata.pinned).toBe(true);
    expect(updated?.metadata.status).toBe('resolved');
    expect(updated?.updatedAt).toBe('2026-07-01T00:00:00.000Z');
    expect(store.update('nope', { metadata: { pinned: true } })).toBeNull();

    await store.flush();
    const reopened = await open(path);
    expect(reopened.get(a.id)?.metadata.pinned).toBe(true);
  });

  it('filters recall by kind, tag, and entity ref, and browses with no text', async () => {
    const store = await open(path);
    store.remember({
      kind: 'decision',
      title: 'D1',
      content: 'alpha',
      tags: ['arch'],
      entityRefs: ['proj1'],
    });
    store.remember({ kind: 'note', title: 'N1', content: 'alpha', tags: ['misc'] });

    expect(store.recall({ kinds: ['decision'] }).hits.length).toBe(1);
    expect(store.recall({ tag: 'arch' }).hits.length).toBe(1);
    expect(store.recall({ entityRef: 'proj1' }).hits.length).toBe(1);
    expect(store.recall({}).hits.length).toBe(2);
  });

  it('replaces the projected set but preserves explicit memories', async () => {
    const store = await open(path);
    const note = store.remember({ kind: 'note', title: 'Keep me', content: 'explicit knowledge' });

    const r1 = store.applyProjected(
      [projected('d1', 'document', 'Doc One'), projected('d2', 'document', 'Doc Two')],
      NOW,
    );
    expect(r1.added).toBe(2);
    expect(store.counts().total).toBe(3);

    const r2 = store.applyProjected(
      [projected('d1', 'document', 'Doc One'), projected('d3', 'document', 'Doc Three')],
      NOW,
    );
    expect(r2.removed).toBe(1);
    expect(store.get('mem:d2')).toBeNull();
    expect(store.get('mem:d3')).not.toBeNull();
    expect(store.get(note.id)).not.toBeNull();
    expect(store.counts().byOrigin.explicit).toBe(1);
    expect(store.counts().byOrigin.projected).toBe(2);
  });

  it('forgets items and persists across reloads (index rebuilt on load)', async () => {
    const store = await open(path);
    const a = store.remember({ kind: 'note', title: 'A', content: 'first memory' });
    store.remember({ kind: 'note', title: 'B', content: 'second memory' });
    expect(store.forget([a.id])).toBe(1);
    expect(store.counts().total).toBe(1);
    await store.flush();

    const reopened = await open(path);
    expect(reopened.counts().total).toBe(1);
    expect(reopened.get(a.id)).toBeNull();
    expect(reopened.recall({ text: 'second' }).hits.length).toBe(1);
  });
});
