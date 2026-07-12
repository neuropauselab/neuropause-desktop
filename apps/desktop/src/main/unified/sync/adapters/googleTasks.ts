/**
 * Google Tasks adapter. Two resources:
 *   task_lists → `project` (the container)
 *   tasks      → `task`, linked to its list; incremental via an `updatedMin` high-water per list
 *                (the Tasks API has no delta/sync token). Completed/deleted tasks are surfaced with
 *                showHidden/showCompleted/showDeleted so tombstones (`deleted=true`) become soft-deletes.
 *
 * The `tasks` resource walks lists one per page, keeping a per-list high-water in a composite cursor —
 * the same bounded, resumable pattern as the Slack messages resource. No engine change.
 */
import type { UnifiedEntity } from '@neuropause/shared';
import type { ConnectorAdapter, SyncContext, SyncPage } from '../adapterSdk';
import { makeEntity } from '../adapterSdk';
import { makeUnifiedId } from '../../ids';
import { HttpError } from '../http';
import { maxIso, parseJsonCursor, toJsonCursor, truncate } from './util';

const TASKS = 'https://tasks.googleapis.com/tasks/v1';

interface TaskList {
  id: string;
  title?: string;
  updated?: string;
}
interface Task {
  id: string;
  title?: string;
  notes?: string;
  status?: string; // 'needsAction' | 'completed'
  due?: string;
  completed?: string;
  updated?: string;
  parent?: string;
  position?: string;
  deleted?: boolean;
  hidden?: boolean;
  webViewLink?: string;
}
interface ListsResp {
  items?: TaskList[];
  nextPageToken?: string;
}
interface TasksResp {
  items?: Task[];
  nextPageToken?: string;
}

export function mapTaskList(ctx: SyncContext, l: TaskList): UnifiedEntity {
  return makeEntity({
    connectorId: ctx.connectorId,
    accountId: ctx.accountId,
    kind: 'project',
    sourceId: l.id,
    now: ctx.now,
    title: l.title || '(untitled list)',
    url: null,
    createdAt: l.updated ?? ctx.now,
    updatedAt: l.updated ?? ctx.now,
    metadata: { kind: 'task_list' },
  });
}

export function mapTask(ctx: SyncContext, listId: string, t: Task): UnifiedEntity {
  const when = t.updated ?? ctx.now;
  return makeEntity({
    connectorId: ctx.connectorId,
    accountId: ctx.accountId,
    kind: 'task',
    sourceId: t.id,
    now: ctx.now,
    title: t.title || '(untitled task)',
    url: t.webViewLink ?? null,
    createdAt: when,
    updatedAt: when,
    body: truncate(t.notes, 500),
    status: t.status === 'completed' ? 'completed' : 'open',
    timestamp: t.due ?? null,
    endTimestamp: t.completed ?? null,
    parentId: t.parent ? makeUnifiedId(ctx.connectorId, ctx.accountId, 'task', t.parent) : null,
    containerId: makeUnifiedId(ctx.connectorId, ctx.accountId, 'project', listId),
    metadata: {
      listId,
      completed: t.status === 'completed',
      due: t.due ?? null,
      hidden: t.hidden ?? false,
      parent: t.parent ?? null,
    },
  });
}

async function pullTaskLists(ctx: SyncContext): Promise<SyncPage> {
  const c = parseJsonCursor<{ page?: string }>(ctx.cursor);
  const resp = await ctx.http.getJson<ListsResp>(`${TASKS}/users/@me/lists`, {
    query: { maxResults: 100, pageToken: c?.page },
  });
  const entities = (resp.data.items ?? []).map((l) => mapTaskList(ctx, l));
  const next = resp.data.nextPageToken;
  return { entities, cursor: next ? toJsonCursor({ page: next }) : null, hasMore: Boolean(next) };
}

/**
 * Cursor for the `tasks` walk. `hw` is the COMMITTED per-list high-water (used as `updatedMin` for the
 * next drain of that list). While a list is being drained across pages, `updatedMin` is held CONSTANT at
 * the committed `hw[listId]` (the Tasks API returns tasks in position order, not `updated` order, so a
 * moving `updatedMin` would drop later-page tasks); the new high-water accumulates in `phw` and is
 * committed to `hw` only when the list is fully drained.
 */
interface TasksCursor {
  hw: Record<string, string>;
  queue?: string[];
  idx?: number;
  page?: string;
  /** Pending high-water for the current list drain; committed to `hw[listId]` when the list finishes. */
  phw?: string | null;
}

/** Every task-list id, following pagination (a user may have up to ~1000 lists). */
async function listAllTaskListIds(ctx: SyncContext): Promise<string[]> {
  const ids: string[] = [];
  let pageToken: string | undefined;
  do {
    const resp = await ctx.http.getJson<ListsResp>(`${TASKS}/users/@me/lists`, { query: { maxResults: 100, pageToken } });
    for (const l of resp.data.items ?? []) ids.push(l.id);
    pageToken = resp.data.nextPageToken;
  } while (pageToken);
  return ids;
}

async function pullTasks(ctx: SyncContext): Promise<SyncPage> {
  const c = parseJsonCursor<TasksCursor>(ctx.cursor) ?? { hw: {} };
  const hw = { ...(c.hw ?? {}) };
  const queue = c.queue ?? (await listAllTaskListIds(ctx));
  const idx = c.idx ?? 0;

  // Walk finished → drop queue/idx so the NEXT run re-walks from the start immediately (each drain is
  // cheap via the committed `updatedMin`). Keeping idx at the end would make every other run a no-op.
  if (queue.length === 0 || idx >= queue.length) {
    return { entities: [], cursor: toJsonCursor({ hw }), hasMore: false };
  }

  const listId = queue[idx]!;
  const since = hw[listId]; // held constant for this entire list drain

  let items: Task[] = [];
  let nextPage: string | undefined;
  try {
    const resp = await ctx.http.getJson<TasksResp>(`${TASKS}/lists/${listId}/tasks`, {
      query: {
        maxResults: 100,
        showCompleted: true,
        showHidden: true,
        showDeleted: true,
        updatedMin: since || undefined,
        pageToken: c.page,
      },
    });
    items = resp.data.items ?? [];
    nextPage = resp.data.nextPageToken;
  } catch (err) {
    // A deleted list (404) must not wedge the whole connector — skip it and continue with the next list.
    if (err instanceof HttpError && err.status === 404) {
      const nextIdx = idx + 1;
      return { entities: [], cursor: toJsonCursor({ hw, queue, idx: nextIdx }), hasMore: nextIdx < queue.length };
    }
    throw err;
  }

  const entities: UnifiedEntity[] = [];
  const deletedSourceIds: string[] = [];
  let pendingHw = c.phw ?? null;
  for (const t of items) {
    pendingHw = maxIso(pendingHw, t.updated ?? null);
    if (t.deleted) deletedSourceIds.push(t.id);
    else entities.push(mapTask(ctx, listId, t));
  }

  if (nextPage) {
    // Same list, next page: updatedMin stays constant (hw[listId] unchanged); carry the pending high-water.
    const cursor: TasksCursor = { hw, queue, idx, page: nextPage, phw: pendingHw };
    return { entities, deletedSourceIds, cursor: toJsonCursor(cursor), hasMore: true };
  }

  // List drained → commit its high-water, advance to the next list.
  if (pendingHw) {
    const merged = maxIso(hw[listId] ?? null, pendingHw);
    if (merged) hw[listId] = merged;
  }
  const nextIdx = idx + 1;
  const done = nextIdx >= queue.length;
  const cursor: TasksCursor = done ? { hw } : { hw, queue, idx: nextIdx };
  return { entities, deletedSourceIds, cursor: toJsonCursor(cursor), hasMore: !done };
}

export const googleTasksAdapter: ConnectorAdapter = {
  connectorId: 'google-tasks',
  resources: [
    { id: 'task_lists', label: 'Task lists', kind: 'project', pull: pullTaskLists },
    { id: 'tasks', label: 'Tasks', kind: 'task', pull: pullTasks },
  ],
};
