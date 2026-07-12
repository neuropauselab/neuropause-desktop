/**
 * P5 — Increment 3: the Google Workspace connector FAMILY (Gmail, Drive, People, Tasks service resources
 * on one `google-workspace` connector). Pure-node, fake HttpClient — mappers + delta/full-sync/reset flows
 * (entities namespaced under `google-workspace`), plus family graceful-degradation + capability discovery.
 */
import { describe, expect, it } from 'vitest';
import type { SyncContext } from '../adapterSdk';
import { AuthError, HttpError, type HttpRequestOptions, type HttpResponse } from '../http';
import { gmailResources, mapMessage } from './gmail';
import { googleDriveResources, mapFile } from './googleDrive';
import { googlePeopleResources, mapPerson } from './googlePeople';
import { googleTasksResources, mapTask, mapTaskList } from './googleTasks';
import { googleServiceAvailability, googleWorkspaceAdapter } from './googleWorkspace';

const WS = 'google-workspace';
const NOW = '2026-07-12T00:00:00.000Z';
const base = { connectorId: WS, accountId: 'a1', now: NOW } as const;
const ok = (data: unknown): HttpResponse<unknown> => ({ data, headers: {}, status: 200 });

/** ctx whose http routes by url; a route may throw (→ rejected getJson). */
function routed(handler: (url: string, opts?: HttpRequestOptions) => HttpResponse<unknown>, cursor: string | null = null): SyncContext {
  const http = {
    getJson: (url: string, opts?: HttpRequestOptions) => {
      try {
        return Promise.resolve(handler(url, opts));
      } catch (err) {
        return Promise.reject(err);
      }
    },
  } as unknown as SyncContext['http'];
  return { ...base, http, cursor };
}
/** ctx whose http always rejects (expired-token paths). */
function rejecting(err: Error, cursor: string | null): SyncContext {
  const http = { getJson: () => Promise.reject(err) } as unknown as SyncContext['http'];
  return { ...base, http, cursor };
}
const pureCtx: SyncContext = { ...base, http: undefined as never, cursor: null };

const gmailR = gmailResources.find((r) => r.id === 'gmail')!;
const driveR = googleDriveResources.find((r) => r.id === 'drive')!;
const peopleR = googlePeopleResources.find((r) => r.id === 'people')!;
const tasksR = googleTasksResources.find((r) => r.id === 'tasks')!;

// ─────────────────────────── Gmail ───────────────────────────
describe('Gmail', () => {
  it('maps a message with header + label + thread + internalDate (namespaced under google-workspace)', () => {
    const e = mapMessage(pureCtx, {
      id: 'm1',
      threadId: 't1',
      labelIds: ['INBOX', 'UNREAD'],
      snippet: 'hello there',
      internalDate: String(Date.parse('2026-07-01T10:00:00Z')),
      payload: { headers: [{ name: 'Subject', value: 'Hi' }, { name: 'From', value: 'a@b.com' }] },
    });
    expect(e.kind).toBe('message');
    expect(e.id).toBe('google-workspace:a1:message:m1');
    expect(e.title).toBe('Hi');
    expect(e.author).toBe('a@b.com');
    expect(e.status).toBe('unread');
    expect(e.parentId).toBe('google-workspace:a1:conversation:t1');
    expect(e.timestamp).toBe('2026-07-01T10:00:00.000Z');
    expect(e.body).toBe('hello there');
  });

  it('INIT captures the historyId baseline, enumerates, then switches to incremental', async () => {
    const msg = { id: 'm1', threadId: 't1', labelIds: ['INBOX'], snippet: 's', internalDate: '1700000000000', payload: { headers: [{ name: 'Subject', value: 'Hi' }] } };
    const ctx = routed((url) => {
      if (url.includes('/profile')) return ok({ historyId: 'H1' });
      if (url.includes('/messages/')) return ok(msg);
      if (url.endsWith('/messages')) return ok({ messages: [{ id: 'm1' }] });
      throw new Error(`unexpected ${url}`);
    });
    const page = await gmailR.pull(ctx);
    expect(page.entities).toHaveLength(1);
    expect(page.hasMore).toBe(false);
    expect(JSON.parse(page.cursor as string)).toEqual({ historyId: 'H1' });
  });

  it('recovers from an expired historyId (404) with a full resync', async () => {
    const ctx = rejecting(new HttpError(404, 'Not Found', false), JSON.stringify({ historyId: 'STALE' }));
    const page = await gmailR.pull(ctx);
    expect(page.entities).toEqual([]);
    expect(page.cursor).toBeNull(); // → next pull re-runs INIT
    expect(page.hasMore).toBe(true);
  });

  it('incremental history re-fetches messages whose labels changed (read/unread refresh)', async () => {
    const msg = { id: 'm9', threadId: 't9', labelIds: ['INBOX'], snippet: 's', internalDate: '1700000000000', payload: { headers: [{ name: 'Subject', value: 'Re' }] } };
    const ctx = routed((url) => {
      if (url.includes('/messages/')) return ok(msg);
      if (url.includes('/history')) return ok({ history: [{ id: 'h1', labelsRemoved: [{ message: { id: 'm9' } }] }], historyId: 'H2' });
      throw new Error(`unexpected ${url}`);
    }, JSON.stringify({ historyId: 'H1' }));
    const page = await gmailR.pull(ctx);
    expect(page.entities.map((e) => e.sourceId)).toEqual(['m9']);
    expect(JSON.parse(page.cursor as string)).toEqual({ historyId: 'H2' });
  });
});

// ─────────────────────────── Drive ───────────────────────────
describe('Google Drive', () => {
  it('maps a file (folder detection + parent link)', () => {
    const folder = mapFile(pureCtx, { id: 'd1', name: 'Docs', mimeType: 'application/vnd.google-apps.folder' });
    expect(folder.metadata.isFolder).toBe(true);
    const file = mapFile(pureCtx, {
      id: 'f1', name: 'Plan.docx', mimeType: 'application/vnd.google-apps.document', modifiedTime: '2026-06-01T00:00:00Z',
      webViewLink: 'https://drive/f1', parents: ['d1'], trashed: false, owners: [{ emailAddress: 'me@x.com' }], size: '123',
    });
    expect(file.kind).toBe('file');
    expect(file.containerId).toBe('google-workspace:a1:file:d1');
    expect(file.author).toBe('me@x.com');
    expect(file.metadata.size).toBe(123);
  });

  it('INIT captures a startPageToken baseline then switches to the changes feed', async () => {
    const ctx = routed((url) => {
      if (url.endsWith('/changes/startPageToken')) return ok({ startPageToken: 'S1' });
      if (url.endsWith('/files')) return ok({ files: [{ id: 'f1', name: 'A' }] });
      throw new Error(`unexpected ${url}`);
    });
    const page = await driveR.pull(ctx);
    expect(page.entities).toHaveLength(1);
    expect(page.hasMore).toBe(false);
    expect(JSON.parse(page.cursor as string)).toEqual({ phase: 'changes', pageToken: 'S1' });
  });

  it('the changes feed soft-deletes removed files and advances the token', async () => {
    const ctx = routed(() => ok({ changes: [{ fileId: 'f2', removed: true }, { fileId: 'f3', file: { id: 'f3', name: 'C' } }], newStartPageToken: 'S2' }),
      JSON.stringify({ phase: 'changes', pageToken: 'S1' }));
    const page = await driveR.pull(ctx);
    expect(page.deletedSourceIds).toEqual(['f2']);
    expect(page.entities).toHaveLength(1);
    expect(JSON.parse(page.cursor as string)).toEqual({ phase: 'changes', pageToken: 'S2' });
  });

  it('an expired change token (410) restarts a full INIT', async () => {
    const ctx = rejecting(new HttpError(410, 'Gone', false), JSON.stringify({ phase: 'changes', pageToken: 'STALE' }));
    const page = await driveR.pull(ctx);
    expect(page.cursor).toBeNull();
    expect(page.hasMore).toBe(true);
  });
});

// ─────────────────────────── People ───────────────────────────
describe('Google People', () => {
  it('maps a person to a contact', () => {
    const e = mapPerson(pureCtx, {
      resourceName: 'people/c1', names: [{ displayName: 'Ada' }], emailAddresses: [{ value: 'ada@x.com' }],
      organizations: [{ name: 'Acme', title: 'CTO' }],
    });
    expect(e.kind).toBe('contact');
    expect(e.id).toBe('google-workspace:a1:contact:people/c1');
    expect(e.title).toBe('Ada');
    expect(e.metadata.organization).toBe('Acme');
  });

  it('lists connections, soft-deletes tombstones, and captures the sync token', async () => {
    const ctx = routed(() => ok({
      connections: [{ resourceName: 'people/c1', names: [{ displayName: 'Ada' }] }, { resourceName: 'people/c2', metadata: { deleted: true } }],
      nextSyncToken: 'ST',
    }));
    const page = await peopleR.pull(ctx);
    expect(page.entities).toHaveLength(1);
    expect(page.deletedSourceIds).toEqual(['people/c2']);
    expect(JSON.parse(page.cursor as string)).toEqual({ sync: 'ST' });
  });

  it('recovers from an expired sync token (410) with a full resync', async () => {
    let first = true;
    const http = {
      getJson: () => {
        if (first) { first = false; return Promise.reject(new HttpError(410, 'Gone', false)); }
        return Promise.resolve(ok({ connections: [{ resourceName: 'people/c1', names: [{ displayName: 'Ada' }] }], nextSyncToken: 'FRESH' }));
      },
    } as unknown as SyncContext['http'];
    const ctx: SyncContext = { ...base, http, cursor: JSON.stringify({ sync: 'STALE' }) };
    const page = await peopleR.pull(ctx);
    expect(page.entities).toHaveLength(1);
    expect(JSON.parse(page.cursor as string)).toEqual({ sync: 'FRESH' });
  });
});

// ─────────────────────────── Tasks ───────────────────────────
describe('Google Tasks', () => {
  it('maps a task list to a project and a task to its list', () => {
    const list = mapTaskList(pureCtx, { id: 'L1', title: 'Work' });
    expect(list.kind).toBe('project');
    expect(list.id).toBe('google-workspace:a1:project:L1');
    const task = mapTask(pureCtx, 'L1', { id: 't1', title: 'Ship it', status: 'completed', updated: '2026-07-01T00:00:00Z' });
    expect(task.kind).toBe('task');
    expect(task.status).toBe('completed');
    expect(task.containerId).toBe('google-workspace:a1:project:L1');
  });

  it('walks a list, keeps a per-list high-water, and tombstones deleted tasks', async () => {
    const ctx = routed((url) => {
      if (url.endsWith('/tasks')) return ok({ items: [{ id: 't1', updated: '2026-07-01T00:00:00Z' }, { id: 't2', deleted: true, updated: '2026-07-02T00:00:00Z' }] });
      if (url.endsWith('/lists')) return ok({ items: [{ id: 'L1', title: 'Work' }] });
      throw new Error(`unexpected ${url}`);
    });
    const page = await tasksR.pull(ctx);
    expect(page.entities).toHaveLength(1);
    expect(page.deletedSourceIds).toEqual(['t2']);
    expect(page.hasMore).toBe(false);
    const c = JSON.parse(page.cursor as string) as { hw: Record<string, string>; queue?: unknown };
    expect(c.hw.L1).toBe('2026-07-02T00:00:00Z');
    expect(c.queue).toBeUndefined();
  });

  it('skips a deleted list (404) instead of wedging the whole connector', async () => {
    const ctx = routed(
      (url) => {
        if (url.endsWith('/lists/L2/tasks')) throw new HttpError(404, 'Not Found', false);
        throw new Error(`unexpected ${url}`);
      },
      JSON.stringify({ hw: {}, queue: ['L1', 'L2'], idx: 1 }),
    );
    const page = await tasksR.pull(ctx);
    expect(page.entities).toEqual([]);
    expect(page.hasMore).toBe(false);
    expect((JSON.parse(page.cursor as string) as { idx: number }).idx).toBe(2);
  });

  it('holds updatedMin constant across a list’s pages and commits the high-water only on drain', async () => {
    const seen: Array<string | undefined> = [];
    let call = 0;
    const ctx = routed(
      (url, opts) => {
        if (!url.endsWith('/tasks')) throw new Error(`unexpected ${url}`);
        seen.push(opts?.query?.updatedMin as string | undefined);
        call += 1;
        if (call === 1) return ok({ items: [{ id: 't1', updated: '2026-07-05T00:00:00Z' }], nextPageToken: 'P2' });
        return ok({ items: [{ id: 't2', updated: '2026-06-01T00:00:00Z' }] });
      },
      JSON.stringify({ hw: { L1: '2026-05-01T00:00:00Z' }, queue: ['L1'], idx: 0 }),
    );
    const p1 = await tasksR.pull(ctx);
    expect(p1.hasMore).toBe(true);
    const p2 = await tasksR.pull({ ...ctx, cursor: p1.cursor });
    expect(seen).toEqual(['2026-05-01T00:00:00Z', '2026-05-01T00:00:00Z']);
    expect(p2.entities).toHaveLength(1);
    expect((JSON.parse(p2.cursor as string) as { hw: Record<string, string> }).hw.L1).toBe('2026-07-05T00:00:00Z');
  });
});

// ─────────────────────── Family: composition, graceful, capability discovery ───────────────────────
describe('google-workspace family', () => {
  it('is ONE connector with every service mounted as a resource', () => {
    expect(googleWorkspaceAdapter.connectorId).toBe('google-workspace');
    expect(googleWorkspaceAdapter.resources.map((r) => r.id)).toEqual(
      expect.arrayContaining(['gmail', 'calendar', 'drive', 'people', 'task_lists', 'tasks']),
    );
  });

  it('graceful-wraps each service — an unauthorized service (403) degrades instead of failing the family', async () => {
    const gmailService = googleWorkspaceAdapter.resources.find((r) => r.id === 'gmail')!;
    const http = { getJson: () => Promise.reject(new AuthError('forbidden', 403)) } as unknown as SyncContext['http'];
    const page = await gmailService.pull({ ...base, http, cursor: null });
    expect(page.entities).toEqual([]);
    expect(page.degraded?.kind).toBe('unauthorized');
  });

  it('capability discovery: available services derive from granted scopes (runtime-driven, ✓/✗)', () => {
    const avail = googleServiceAvailability([
      'https://www.googleapis.com/auth/gmail.readonly',
      'https://www.googleapis.com/auth/drive.readonly',
    ]);
    const byId = Object.fromEntries(avail.map((s) => [s.id, s.available]));
    expect(byId.gmail).toBe(true);
    expect(byId.drive).toBe(true);
    expect(byId.docs).toBe(true); // Docs/Sheets/Slides surface via the Drive scope
    expect(byId.sheets).toBe(true);
    expect(byId.calendar).toBe(false); // not granted → ✗
    expect(byId.tasks).toBe(false);
  });
});
