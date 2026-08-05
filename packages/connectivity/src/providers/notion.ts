/**
 * Module 9 — Notion connector. Notion API adapter over the transport seam. Covers
 * search, pages, databases, database queries, and block children. Requires the
 * Notion-Version header (set here); auth is a Bearer integration token.
 */
import type { HttpClient } from '@neuropause/integrations';
import { HttpConnector, pickArray, str, type TransportOptions } from '../httpConnector';

export interface NotionPage { id: string; title: string; url: string; }
export interface NotionDatabase { id: string; title: string; }
export interface NotionBlock { id: string; type: string; }

const rec = (row: Record<string, unknown>, key: string): Record<string, unknown> => (row[key] as Record<string, unknown>) ?? {};

/** Best-effort plain-text title from a Notion rich-text/title array. */
function titleOf(row: Record<string, unknown>): string {
  const props = rec(row, 'properties');
  for (const value of Object.values(props)) {
    const v = (value ?? {}) as Record<string, unknown>;
    const title = v.title as Array<Record<string, unknown>> | undefined;
    if (Array.isArray(title) && title.length) return str(title.map((t) => str(t.plain_text)).join(''));
  }
  const topTitle = row.title as Array<Record<string, unknown>> | undefined;
  if (Array.isArray(topTitle) && topTitle.length) return str(topTitle.map((t) => str(t.plain_text)).join(''));
  return '';
}

export class NotionConnector extends HttpConnector {
  constructor(http: HttpClient, opts: Partial<TransportOptions> & { token?: string } = {}) {
    super(http, { baseUrl: opts.baseUrl ?? 'https://api.notion.com/v1', headers: { 'Notion-Version': '2022-06-28' }, ...opts });
  }

  async search(query: string): Promise<NotionPage[]> {
    const res = await this.t.postJson<{ results?: Array<Record<string, unknown>> }>('/search', { query });
    return (res.results ?? []).map((r) => ({ id: str(r.id), title: titleOf(r), url: str(r.url) }));
  }
  async databases(): Promise<NotionDatabase[]> {
    const res = await this.t.postJson<{ results?: Array<Record<string, unknown>> }>('/search', { filter: { property: 'object', value: 'database' } });
    return (res.results ?? []).map((r) => ({ id: str(r.id), title: titleOf(r) }));
  }
  async queryDatabase(databaseId: string): Promise<NotionPage[]> {
    const res = await this.t.postJson<{ results?: Array<Record<string, unknown>> }>(`/databases/${databaseId}/query`, {});
    return (res.results ?? []).map((r) => ({ id: str(r.id), title: titleOf(r), url: str(r.url) }));
  }
  listBlocks(blockId: string): Promise<NotionBlock[]> {
    return this.listMapped(`/blocks/${blockId}/children`, pickArray('results'), (r) => ({ id: str(r.id), type: str(r.type) }));
  }
}
