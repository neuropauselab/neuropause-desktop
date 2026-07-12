/**
 * P5 — Increment 3: the Google Workspace adapters (Gmail, Drive, People, Tasks).
 * Pure-node, fake HttpClient — mappers + the delta/full-sync/token-reset flows. No Electron, no network.
 */
import { describe, expect, it } from 'vitest';
import type { SyncContext } from '../adapterSdk';
import { HttpError, type HttpRequestOptions, type HttpResponse } from '../http';
import { gmailAdapter, mapMessage } from './gmail';
import { googleDriveAdapter, mapFile } from './googleDrive';
import { googlePeopleAdapter, mapPerson } from './googlePeople';
import { googleTasksAdapter, mapTask, mapTaskList } from './googleTasks';

const NOW = '2026-07-12T00:00:00.000Z';
const base = (connectorId: string) => ({ connectorId, accountId: 'a1', now: NOW } as const);
const ok = (data: unknown): HttpResponse<unknown> => ({ data, headers: {}, status: 200 });

/** ctx whose http routes by url; a route may throw (→ rejected getJson). */
function routed(
  connectorId: string,
  handler: (url: string, opts?: HttpRequestOptions) => HttpResponse<unknown>,
  cursor: string | null = null,
): SyncContext {
  const http = {
    getJson: (url: string, opts?: HttpRequestOptions) => {
      try {
        return Promise.resolve(handler(url, opts));
      } catch (err) {
        return Promise.reject(err);
      }
    },
  } as unknown as SyncContext['http'];
  return { ...base(connectorId), http, cursor };
}
/** ctx whose http always rejects (expired-token paths). */
function rejecting(connectorId: string, err: Error, cursor: string | null): SyncContext {
  const http = { getJson: () => Promise.reject(err) } as unknown as SyncContext['http'];
  return { ...base(connectorId), http, cursor };
}
/** ctx for pure mappers (http never called). */
const pureCtx = (connectorId: string): SyncContext =>
  ({ ...base(connectorId), http: undefined as never, cursor: null });

const resource = (adapter: { resources: Array<{ id: string; pull: (c: SyncContext) => Promise<unknown> }> }, id: string) =>
  adapter.resources.find((r) => r.id === id)!;

// ─────────────────────────── Gmail ───────────────────────────
describe('Gmail', () => {
  it('maps a message with header + label + thread + internalDate', () => {
    const e = mapMessage(pureCtx('gmail'), {
      id: 'm1',
      threadId: 't1',
      labelIds: ['INBOX', 'UNREAD'],
      snippet: 'hello there',
      internalDate: String(Date.parse('2026-07-01T10:00:00Z')),
      payload: { headers: [{ name: 'Subject', value: 'Hi' }, { name: 'From', value: 'a@b.com' }] },
    });
    expect(e.kind).toBe('message');
    expect(e.id).toBe('gmail:a1:message:m1');
    expect(e.title).toBe('Hi');
    expect(e.author).toBe('a@b.com');
    expect(e.status).toBe('unread');
    expect(e.parentId).toBe('gmail:a1:conversation:t1');
    expect(e.timestamp).toBe('2026-07-01T10:00:00.000Z');
    expect(e.body).toBe('hello there');
  });

  it('INIT captures the historyId baseline, enumerates, then switches to incremental', async () => {
    const msg = { id: 'm1', threadId: 't1', labelIds: ['INBOX'], snippet: 's', internalDate: '1700000000000', payload: { headers: [{ name: 'Subject', value: 'Hi' }] } };
    const ctx = routed('gmail', (url) => {
      if (url.includes('/profile')) return ok({ historyId: 'H1' });
      if (url.includes('/messages/')) return ok(msg);
      if (url.endsWith('/messages')) return ok({ messages: [{ id: 'm1' }] });
      throw new Error(`unexpected ${url}`);
    });
    const page = await resource(gmailAdapter, 'messages').pull(ctx) as { entities: unknown[]; cursor: string; hasMore: boolean };
    expect(page.entities).toHaveLength(1);
    expect(page.hasMore).toBe(false);
    expect(JSON.parse(page.cursor)).toEqual({ historyId: 'H1' });
  });

  it('recovers from an expired historyId (404) with a full resync', async () => {
    const ctx = rejecting('gmail', new HttpError(404, 'Not Found', false), JSON.stringify({ historyId: 'STALE' }));
    const page = await resource(gmailAdapter, 'messages').pull(ctx) as { entities: unknown[]; cursor: string | null; hasMore: boolean };
    expect(page.entities).toEqual([]);
    expect(page.cursor).toBeNull(); // → next pull re-runs INIT
    expect(page.hasMore).toBe(true);
  });

  it('incremental history re-fetches messages whose labels changed (read/unread refresh)', async () => {
    const msg = { id: 'm9', threadId: 't9', labelIds: ['INBOX'], snippet: 's', internalDate: '1700000000000', payload: { headers: [{ name: 'Subject', value: 'Re' }] } };
    const ctx = routed('gmail', (url) => {
      if (url.includes('/messages/')) return ok(msg);
      if (url.includes('/history')) return ok({ history: [{ id: 'h1', labelsRemoved: [{ message: { id: 'm9' } }] }], historyId: 'H2' });
      throw new Error(`unexpected ${url}`);
    }, JSON.stringify({ historyId: 'H1' }));
    const page = await resource(gmailAdapter, 'messages').pull(ctx) as { entities: Array<{ sourceId: string }>; cursor: string };
    expect(page.entities).toHaveLength(1); // the label-changed message was re-fetched, not ignored
    expect(page.entities[0]!.sourceId).toBe('m9');
    expect(JSON.parse(page.cursor)).toEqual({ historyId: 'H2' });
  });
});

// ─────────────────────────── Drive ───────────────────────────
describe('Google Drive', () => {
  it('maps a file (folder detection + parent link)', () => {
    const folder = mapFile(pureCtx('google-drive'), { id: 'd1', name: 'Docs', mimeType: 'application/vnd.google-apps.folder' });
    expect(folder.metadata.isFolder).toBe(true);
    const file = mapFile(pureCtx('google-drive'), {
      id: 'f1', name: 'Plan.docx', mimeType: 'application/vnd.google-apps.document', modifiedTime: '2026-06-01T00:00:00Z',
      webViewLink: 'https://drive/f1', parents: ['d1'], trashed: false, owners: [{ emailAddress: 'me@x.com' }], size: '123',
    });
    expect(file.kind).toBe('file');
    expect(file.containerId).toBe('google-drive:a1:file:d1');
    expect(file.author).toBe('me@x.com');
    expect(file.metadata.size).toBe(123);
  });

  it('INIT captures a startPageToken baseline then switches to the changes feed', async () => {
    const ctx = routed('google-drive', (url) => {
      if (url.endsWith('/changes/startPageToken')) return ok({ startPageToken: 'S1' });
      if (url.endsWith('/files')) return ok({ files: [{ id: 'f1', name: 'A' }] });
      throw new Error(`unexpected ${url}`);
    });
    const page = await resource(googleDriveAdapter, 'files').pull(ctx) as { entities: unknown[]; cursor: string; hasMore: boolean };
    expect(page.entities).toHaveLength(1);
    expect(page.hasMore).toBe(false);
    expect(JSON.parse(page.cursor)).toEqual({ phase: 'changes', pageToken: 'S1' });
  });

  it('the changes feed soft-deletes removed files and advances the token', async () => {
    const ctx = routed('google-drive', () => ok({ changes: [{ fileId: 'f2', removed: true }, { fileId: 'f3', file: { id: 'f3', name: 'C' } }], newStartPageToken: 'S2' }),
      JSON.stringify({ phase: 'changes', pageToken: 'S1' }));
    const page = await resource(googleDriveAdapter, 'files').pull(ctx) as { entities: unknown[]; deletedSourceIds: string[]; cursor: string; hasMore: boolean };
    expect(page.deletedSourceIds).toEqual(['f2']);
    expect(page.entities).toHaveLength(1);
    expect(JSON.parse(page.cursor)).toEqual({ phase: 'changes', pageToken: 'S2' });
  });

  it('an expired change token (410) restarts a full INIT', async () => {
    const ctx = rejecting('google-drive', new HttpError(410, 'Gone', false), JSON.stringify({ phase: 'changes', pageToken: 'STALE' }));
    const page = await resource(googleDriveAdapter, 'files').pull(ctx) as { cursor: string | null; hasMore: boolean };
    expect(page.cursor).toBeNull();
    expect(page.hasMore).toBe(true);
  });
});

// ─────────────────────────── People ───────────────────────────
describe('Google People', () => {
  it('maps a person to a contact', () => {
    const e = mapPerson(pureCtx('google-people'), {
      resourceName: 'people/c1', names: [{ displayName: 'Ada' }], emailAddresses: [{ value: 'ada@x.com' }],
      organizations: [{ name: 'Acme', title: 'CTO' }],
    });
    expect(e.kind).toBe('contact');
    expect(e.id).toBe('google-people:a1:contact:people/c1');
    expect(e.title).toBe('Ada');
    expect(e.author).toBe('ada@x.com');
    expect(e.metadata.organization).toBe('Acme');
    expect(e.metadata.jobTitle).toBe('CTO');
  });

  it('lists connections, soft-deletes tombstones, and captures the sync token', async () => {
    const ctx = routed('google-people', () => ok({
      connections: [{ resourceName: 'people/c1', names: [{ displayName: 'Ada' }] }, { resourceName: 'people/c2', metadata: { deleted: true } }],
      nextSyncToken: 'ST',
    }));
    const page = await resource(googlePeopleAdapter, 'connections').pull(ctx) as { entities: unknown[]; deletedSourceIds: string[]; cursor: string; hasMore: boolean };
    expect(page.entities).toHaveLength(1);
    expect(page.deletedSourceIds).toEqual(['people/c2']);
    expect(JSON.parse(page.cursor)).toEqual({ sync: 'ST' });
  });

  it('recovers from an expired sync token (410) with a full resync', async () => {
    let first = true;
    const http = {
      getJson: () => {
        if (first) { first = false; return Promise.reject(new HttpError(410, 'Gone', false)); }
        return Promise.resolve(ok({ connections: [{ resourceName: 'people/c1', names: [{ displayName: 'Ada' }] }], nextSyncToken: 'FRESH' }));
      },
    } as unknown as SyncContext['http'];
    const ctx: SyncContext = { ...base('google-people'), http, cursor: JSON.stringify({ sync: 'STALE' }) };
    const page = await resource(googlePeopleAdapter, 'connections').pull(ctx) as { entities: unknown[]; cursor: string };
    expect(page.entities).toHaveLength(1);
    expect(JSON.parse(page.cursor)).toEqual({ sync: 'FRESH' });
  });
});

// ─────────────────────────── Tasks ───────────────────────────
describe('Google Tasks', () => {
  it('maps a task list to a project and a task to its list', () => {
    const list = mapTaskList(pureCtx('google-tasks'), { id: 'L1', title: 'Work' });
    expect(list.kind).toBe('project');
    expect(list.id).toBe('google-tasks:a1:project:L1');
    const task = mapTask(pureCtx('google-tasks'), 'L1', { id: 't1', title: 'Ship it', status: 'completed', updated: '2026-07-01T00:00:00Z' });
    expect(task.kind).toBe('task');
    expect(task.status).toBe('completed');
    expect(task.containerId).toBe('google-tasks:a1:project:L1');
  });

  it('walks a list, keeps a per-list high-water, and tombstones deleted tasks', async () => {
    const ctx = routed('google-tasks', (url) => {
      if (url.endsWith('/tasks')) return ok({ items: [{ id: 't1', updated: '2026-07-01T00:00:00Z' }, { id: 't2', deleted: true, updated: '2026-07-02T00:00:00Z' }] });
      if (url.endsWith('/lists')) return ok({ items: [{ id: 'L1', title: 'Work' }] });
      throw new Error(`unexpected ${url}`);
    });
    const page = await resource(googleTasksAdapter, 'tasks').pull(ctx) as { entities: unknown[]; deletedSourceIds: string[]; cursor: string; hasMore: boolean };
    expect(page.entities).toHaveLength(1);
    expect(page.deletedSourceIds).toEqual(['t2']);
    expect(page.hasMore).toBe(false);
    const c = JSON.parse(page.cursor) as { hw: Record<string, string>; queue?: unknown };
    expect(c.hw.L1).toBe('2026-07-02T00:00:00Z'); // committed high-water = latest updated
    expect(c.queue).toBeUndefined(); // walk finished → re-walks next run (no every-other-run no-op)
  });

  it('skips a deleted list (404) instead of wedging the whole connector', async () => {
    const ctx = routed(
      'google-tasks',
      (url) => {
        if (url.endsWith('/lists/L2/tasks')) throw new HttpError(404, 'Not Found', false);
        throw new Error(`unexpected ${url}`);
      },
      JSON.stringify({ hw: {}, queue: ['L1', 'L2'], idx: 1 }),
    );
    const page = await resource(googleTasksAdapter, 'tasks').pull(ctx) as { entities: unknown[]; cursor: string; hasMore: boolean };
    expect(page.entities).toEqual([]); // the 404 was swallowed, not thrown
    expect(page.hasMore).toBe(false); // idx advanced to 2 == queue.length
    expect((JSON.parse(page.cursor) as { idx: number }).idx).toBe(2);
  });

  it('holds updatedMin constant across a list’s pages and commits the high-water only on drain', async () => {
    const seen: Array<string | undefined> = [];
    let call = 0;
    const ctx = routed(
      'google-tasks',
      (url, opts) => {
        if (!url.endsWith('/tasks')) throw new Error(`unexpected ${url}`);
        seen.push(opts?.query?.updatedMin as string | undefined);
        call += 1;
        if (call === 1) return ok({ items: [{ id: 't1', updated: '2026-07-05T00:00:00Z' }], nextPageToken: 'P2' });
        return ok({ items: [{ id: 't2', updated: '2026-06-01T00:00:00Z' }] }); // older task, on page 2
      },
      JSON.stringify({ hw: { L1: '2026-05-01T00:00:00Z' }, queue: ['L1'], idx: 0 }),
    );
    const p1 = await resource(googleTasksAdapter, 'tasks').pull(ctx) as { cursor: string; hasMore: boolean };
    expect(p1.hasMore).toBe(true);
    const c1 = JSON.parse(p1.cursor) as { page: string; phw: string };
    expect(c1.page).toBe('P2');
    expect(c1.phw).toBe('2026-07-05T00:00:00Z'); // accumulated, NOT yet committed to hw

    const p2 = await resource(googleTasksAdapter, 'tasks').pull({ ...ctx, cursor: p1.cursor }) as { entities: unknown[]; cursor: string };
    // both pages requested updatedMin = the ORIGINAL committed hw — never the advanced value (no dropped tasks)
    expect(seen).toEqual(['2026-05-01T00:00:00Z', '2026-05-01T00:00:00Z']);
    expect(p2.entities).toHaveLength(1); // the older page-2 task is still included
    expect((JSON.parse(p2.cursor) as { hw: Record<string, string> }).hw.L1).toBe('2026-07-05T00:00:00Z');
  });
});

describe('registration', () => {
  it('each Google adapter declares its connectorId + resources', () => {
    expect(gmailAdapter.connectorId).toBe('gmail');
    expect(googleDriveAdapter.connectorId).toBe('google-drive');
    expect(googlePeopleAdapter.connectorId).toBe('google-people');
    expect(googleTasksAdapter.connectorId).toBe('google-tasks');
    expect(googleTasksAdapter.resources.map((r) => r.id)).toEqual(['task_lists', 'tasks']);
  });
});
