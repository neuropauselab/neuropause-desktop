import { beforeEach, describe, expect, it } from 'vitest';
import type { SyncChange } from '@neuropause/shared';
import { createMemorySyncRepository } from './memoryRepository';
import type { SyncRepository } from './types';
import { pullChanges, pushChanges } from './service';

function change(over: Partial<SyncChange> = {}): SyncChange {
  return {
    entityType: 'org_prefs',
    entityId: 'prefs',
    orgId: 'org-1',
    version: 1,
    updatedAt: '2026-01-01T00:00:00.000Z',
    deleted: false,
    data: { theme: 'dark' },
    ...over,
  };
}

describe('pushChanges', () => {
  let repo: SyncRepository;
  beforeEach(() => {
    repo = createMemorySyncRepository();
  });

  it('applies a new change and advances the cursor', async () => {
    const res = await pushChanges(repo, 'org-1', 'devA', [change()]);
    expect(res.results[0].status).toBe('applied');
    expect(res.cursor).toBe(1);
    const stored = await repo.getRecord('org-1', 'org_prefs', 'prefs');
    expect(stored?.data).toEqual({ theme: 'dark' });
  });

  it('reports a stale change without changing state', async () => {
    await pushChanges(repo, 'org-1', 'devA', [change({ version: 3 })]);
    const res = await pushChanges(repo, 'org-1', 'devB', [change({ version: 2 })]);
    expect(res.results[0].status).toBe('stale');
    expect(res.results[0].serverVersion).toBe(3);
  });

  it('applies a strictly newer change over an existing one', async () => {
    await pushChanges(repo, 'org-1', 'devA', [change({ version: 1 })]);
    const res = await pushChanges(repo, 'org-1', 'devB', [
      change({ version: 2, data: { theme: 'light' } }),
    ]);
    expect(res.results[0].status).toBe('applied');
    const stored = await repo.getRecord('org-1', 'org_prefs', 'prefs');
    expect(stored?.data).toEqual({ theme: 'light' });
  });

  it('reports a conflict on an exact version+timestamp tie with differing data', async () => {
    await pushChanges(repo, 'org-1', 'devA', [change({ data: { theme: 'dark' } })]);
    const res = await pushChanges(repo, 'org-1', 'devB', [change({ data: { theme: 'light' } })]);
    expect(res.results[0].status).toBe('conflict');
  });

  it('applies a tombstone (deletion propagates)', async () => {
    await pushChanges(repo, 'org-1', 'devA', [change({ version: 1 })]);
    const res = await pushChanges(repo, 'org-1', 'devA', [
      change({ version: 2, deleted: true, data: null }),
    ]);
    expect(res.results[0].status).toBe('applied');
    const stored = await repo.getRecord('org-1', 'org_prefs', 'prefs');
    expect(stored?.deleted).toBe(true);
  });

  it('scopes the change to the route org even if the client claims another', async () => {
    await pushChanges(repo, 'org-1', 'devA', [change({ orgId: 'org-evil' })]);
    expect(await repo.getRecord('org-1', 'org_prefs', 'prefs')).not.toBeNull();
    expect(await repo.getRecord('org-evil', 'org_prefs', 'prefs')).toBeNull();
  });
});

describe('pullChanges', () => {
  let repo: SyncRepository;
  beforeEach(async () => {
    repo = createMemorySyncRepository();
    await pushChanges(repo, 'org-1', 'devA', [
      change({ entityId: 'prefs' }),
      change({ entityType: 'workspace_settings', entityId: 'ws-1', data: { layout: 'split' } }),
    ]);
  });

  it('returns changes above the cursor', async () => {
    const res = await pullChanges(repo, 'org-1', 0, { deviceId: 'devB' });
    expect(res.changes).toHaveLength(2);
    expect(res.cursor).toBe(2);
    expect(res.hasMore).toBe(false);
  });

  it('excludes the calling device to avoid echo', async () => {
    const res = await pullChanges(repo, 'org-1', 0, { deviceId: 'devA' });
    expect(res.changes).toHaveLength(0);
  });

  it('filters by entity type', async () => {
    const res = await pullChanges(repo, 'org-1', 0, {
      deviceId: 'devB',
      entityTypes: ['workspace_settings'],
    });
    expect(res.changes).toHaveLength(1);
    expect(res.changes[0].entityType).toBe('workspace_settings');
  });

  it('paginates with a limit and reports hasMore', async () => {
    const first = await pullChanges(repo, 'org-1', 0, { deviceId: 'devB', limit: 1 });
    expect(first.changes).toHaveLength(1);
    expect(first.hasMore).toBe(true);
    const second = await pullChanges(repo, 'org-1', first.cursor, { deviceId: 'devB', limit: 1 });
    expect(second.changes).toHaveLength(1);
    expect(second.hasMore).toBe(false);
    expect(second.changes[0].entityId).not.toBe(first.changes[0].entityId);
  });
});
