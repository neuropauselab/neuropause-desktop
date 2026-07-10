import { afterEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { PersonalizationStore } from './personalizationStore';

const T = '2026-07-10T00:00:00.000Z';
const paths: string[] = [];
function tmp(): string {
  const p = join(tmpdir(), `np-pers-${randomUUID()}.json`);
  paths.push(p);
  return p;
}
afterEach(async () => {
  for (const p of paths.splice(0)) await fs.rm(p, { force: true }).catch(() => undefined);
});

describe('PersonalizationStore — actor-scoped persistence', () => {
  it('isolates actors, applies deterministic ops, and persists across a reload', async () => {
    const path = tmp();
    const store = new PersonalizationStore(path);
    await store.load();

    store.toggleFavorite('a@np.dev', { id: 'tab:trust', label: 'Trust', tab: 'trust' }, T);
    store.pushRecent('a@np.dev', { id: 'tab:executive', label: 'Executive', tab: 'executive' }, T);
    const afterView = store.saveView('a@np.dev', { id: 'v1', label: 'Overdue', tab: 'trust', query: 'overdue' }, T);
    expect(afterView.favorites.map((f) => f.id)).toEqual(['tab:trust']);
    expect(afterView.recents.map((r) => r.id)).toEqual(['tab:executive']);
    expect(afterView.savedViews.map((v) => v.id)).toEqual(['v1']);

    // A second actor is fully isolated from the first.
    store.toggleFavorite('b@np.dev', { id: 'tab:relationship', label: 'Rel', tab: 'relationship' }, T);
    expect(store.forActor('a@np.dev').favorites.map((f) => f.id)).toEqual(['tab:trust']);
    expect(store.forActor('b@np.dev').favorites.map((f) => f.id)).toEqual(['tab:relationship']);
    await store.flush();

    // Reopen from disk → the persisted state is loaded + normalized.
    const reopened = new PersonalizationStore(path);
    await reopened.load();
    expect(reopened.forActor('a@np.dev').favorites.map((f) => f.id)).toEqual(['tab:trust']);
    expect(reopened.forActor('a@np.dev').savedViews.map((v) => v.id)).toEqual(['v1']);
    expect(reopened.forActor('b@np.dev').favorites.map((f) => f.id)).toEqual(['tab:relationship']);
    expect(reopened.forActor('unknown@np.dev').favorites).toEqual([]); // unknown actor → empty, never a throw

    // Toggling a favorite off and deleting a view also persist.
    reopened.toggleFavorite('a@np.dev', { id: 'tab:trust', label: 'Trust', tab: 'trust' }, T);
    reopened.deleteView('a@np.dev', 'v1');
    expect(reopened.forActor('a@np.dev').favorites).toEqual([]);
    expect(reopened.forActor('a@np.dev').savedViews).toEqual([]);
    await reopened.flush();
  });

  it('generates a view id when none is supplied and renames deterministically', async () => {
    const store = new PersonalizationStore(tmp());
    await store.load();
    const s = store.saveView('a', { label: 'My view', tab: 'trust' }, T);
    expect(s.savedViews).toHaveLength(1);
    const id = s.savedViews[0].id;
    expect(id).toMatch(/^sv_/);
    const renamed = store.renameView('a', id, 'Renamed');
    expect(renamed.savedViews[0].label).toBe('Renamed');
  });

  it('survives a corrupt/missing file by starting empty', async () => {
    const path = tmp();
    await fs.writeFile(path, 'not json at all');
    const store = new PersonalizationStore(path);
    await store.load();
    expect(store.forActor('a').favorites).toEqual([]);
    // and can still write afterwards
    store.toggleFavorite('a', { id: 'x', label: 'X', tab: 'trust' }, T);
    expect(store.forActor('a').favorites.map((f) => f.id)).toEqual(['x']);
  });
});
