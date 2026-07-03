/**
 * Notion adapter. Maps the workspace into the UDM:
 *   pages      → document
 *   databases  → project
 *
 * Both stream from POST /v1/search sorted by `last_edited_time` (descending).
 * The cursor carries Notion's pagination cursor plus the query baseline and a
 * high-water mark; the loop stops once it reaches records at or older than the
 * baseline, finalizing to the newest edit so the next run is incremental. Page
 * parent/container links are emitted as Unified Identifiers.
 */
import type { ConnectorId, UnifiedEntity } from '@neuropause/shared';
import type { ConnectorAdapter, SyncContext, SyncPage } from '../adapterSdk';
import { makeEntity } from '../adapterSdk';
import { makeUnifiedId } from '../../ids';
import { parseJsonCursor, toJsonCursor } from './util';

const NOTION = 'https://api.notion.com';

interface NotionText {
  plain_text: string;
}

interface NotionPage {
  id: string;
  url: string;
  created_time: string;
  last_edited_time: string;
  archived: boolean;
  parent: { type: string; database_id?: string; page_id?: string };
  properties: Record<string, { type: string; title?: NotionText[] }>;
  last_edited_by?: { id: string };
}

interface NotionDatabase {
  id: string;
  url: string;
  created_time: string;
  last_edited_time: string;
  archived: boolean;
  title: NotionText[];
}

interface NotionSearchResp<T> {
  results: T[];
  next_cursor: string | null;
  has_more: boolean;
}

interface NotionCursor {
  start?: string;
  base?: string | null;
  hw?: string | null;
}

function pageTitle(p: NotionPage): string {
  for (const prop of Object.values(p.properties ?? {})) {
    if (prop.type === 'title' && prop.title) {
      const text = prop.title.map((t) => t.plain_text).join('');
      if (text) return text;
    }
  }
  return '(untitled)';
}

function ref(connectorId: ConnectorId, accountId: string, kind: 'document' | 'project', id?: string): string | null {
  return id ? makeUnifiedId(connectorId, accountId, kind, id) : null;
}

export function mapPage(ctx: SyncContext, p: NotionPage): UnifiedEntity {
  return makeEntity({
    connectorId: ctx.connectorId,
    accountId: ctx.accountId,
    kind: 'document',
    sourceId: p.id,
    now: ctx.now,
    title: pageTitle(p),
    url: p.url,
    createdAt: p.created_time,
    updatedAt: p.last_edited_time,
    status: p.archived ? 'archived' : 'active',
    author: p.last_edited_by?.id ?? null,
    containerId: ref(ctx.connectorId, ctx.accountId, 'project', p.parent?.database_id),
    parentId: ref(ctx.connectorId, ctx.accountId, 'document', p.parent?.page_id),
    metadata: { parentType: p.parent?.type ?? null, archived: p.archived },
  });
}

export function mapDatabase(ctx: SyncContext, d: NotionDatabase): UnifiedEntity {
  return makeEntity({
    connectorId: ctx.connectorId,
    accountId: ctx.accountId,
    kind: 'project',
    sourceId: d.id,
    now: ctx.now,
    title: d.title?.map((t) => t.plain_text).join('') || '(untitled database)',
    url: d.url,
    createdAt: d.created_time,
    updatedAt: d.last_edited_time,
    status: d.archived ? 'archived' : 'active',
    metadata: { archived: d.archived },
  });
}

async function searchPull<T extends { last_edited_time: string }>(
  ctx: SyncContext,
  objectType: 'page' | 'database',
  map: (ctx: SyncContext, r: T) => UnifiedEntity,
): Promise<SyncPage> {
  const c = parseJsonCursor<NotionCursor>(ctx.cursor);
  const resuming = c?.start != null;
  const start = resuming ? c?.start : undefined;
  const base = resuming ? (c?.base ?? null) : (c?.hw ?? null);
  let hw = resuming ? (c?.hw ?? null) : null;

  const resp = await ctx.http.postJson<NotionSearchResp<T>>(`${NOTION}/v1/search`, {
    filter: { property: 'object', value: objectType },
    sort: { direction: 'descending', timestamp: 'last_edited_time' },
    page_size: 100,
    start_cursor: start,
  });

  const results = resp.data.results ?? [];
  const entities: UnifiedEntity[] = [];
  let hitCutoff = false;
  for (const r of results) {
    if (base && r.last_edited_time <= base) {
      hitCutoff = true;
      break;
    }
    entities.push(map(ctx, r));
  }
  if (hw === null && results.length > 0) hw = results[0]!.last_edited_time;

  const more = resp.data.has_more && !hitCutoff && resp.data.next_cursor != null;
  const cursor = more
    ? toJsonCursor({ start: resp.data.next_cursor, base, hw })
    : toJsonCursor({ hw: hw ?? base ?? null });
  return { entities, cursor, hasMore: more };
}

export const notionAdapter: ConnectorAdapter = {
  connectorId: 'notion',
  baseHeaders: { 'Notion-Version': '2022-06-28' },
  resources: [
    { id: 'pages', label: 'Pages', kind: 'document', pull: (ctx) => searchPull<NotionPage>(ctx, 'page', mapPage) },
    { id: 'databases', label: 'Databases', kind: 'project', pull: (ctx) => searchPull<NotionDatabase>(ctx, 'database', mapDatabase) },
  ],
};
