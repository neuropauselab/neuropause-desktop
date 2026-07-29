/**
 * SaaS connector adapters (NCEA 13.0, Phase 2). Real request construction,
 * response parsing, and pagination for enterprise connectors, built to run on the
 * existing Connector SDK (no duplicate connector runtime). GitHub and Slack are
 * implemented concretely as the reference adapters; the rest of the catalogue is
 * enumerated in the Integration Matrix with its auth + pagination + webhook
 * scheme. All of this is ADAPTER-VERIFIED (request/parse/paginate to the byte
 * against fakes); LIVE calls need OAuth tokens + network (INFRA-PENDING).
 */
import type { HttpClient, HttpRequest, HttpResponse } from './http';

// ── pagination strategies ────────────────────────────────────────────────────

/** GitHub-style `Link: <url>; rel="next"` — returns the next URL or undefined. */
export function parseLinkHeaderNext(link: string | undefined): string | undefined {
  if (!link) return undefined;
  for (const part of link.split(',')) {
    const m = part.match(/<([^>]+)>\s*;\s*rel="?next"?/);
    if (m) return m[1];
  }
  return undefined;
}

/** Read a dotted path (e.g. `response_metadata.next_cursor`) from a JSON object. */
export function readPath(json: unknown, path: string): string | undefined {
  let cur: unknown = json;
  for (const key of path.split('.')) {
    if (cur && typeof cur === 'object' && key in (cur as Record<string, unknown>)) cur = (cur as Record<string, unknown>)[key];
    else return undefined;
  }
  return typeof cur === 'string' && cur.length ? cur : undefined;
}

export interface Page<T> {
  items: T[];
  nextCursor?: string;
  nextUrl?: string;
}

// ── GitHub ───────────────────────────────────────────────────────────────────

export interface Repo {
  id: number;
  name: string;
  fullName: string;
  private: boolean;
}

export const github = {
  base: 'https://api.github.com',
  headers(token: string): Record<string, string> {
    return { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' };
  },
  listReposRequest(token: string, opts: { perPage?: number; page?: number } = {}): HttpRequest {
    const u = new URL(`${this.base}/user/repos`);
    u.searchParams.set('per_page', String(opts.perPage ?? 30));
    if (opts.page) u.searchParams.set('page', String(opts.page));
    return { method: 'GET', url: u.toString(), headers: this.headers(token) };
  },
  parseRepos(res: HttpResponse): Page<Repo> {
    const rows = JSON.parse(res.body) as Array<{ id: number; name: string; full_name: string; private: boolean }>;
    return {
      items: rows.map((r) => ({ id: r.id, name: r.name, fullName: r.full_name, private: r.private })),
      ...(parseLinkHeaderNext(res.headers['link']) ? { nextUrl: parseLinkHeaderNext(res.headers['link']) } : {}),
    };
  },
};

// ── Slack ──────────────────────────────────────────────────────────────────

export interface Channel {
  id: string;
  name: string;
}

export const slack = {
  base: 'https://slack.com/api',
  headers(token: string): Record<string, string> {
    return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json; charset=utf-8' };
  },
  listChannelsRequest(token: string, opts: { limit?: number; cursor?: string } = {}): HttpRequest {
    const u = new URL(`${this.base}/conversations.list`);
    u.searchParams.set('limit', String(opts.limit ?? 100));
    if (opts.cursor) u.searchParams.set('cursor', opts.cursor);
    return { method: 'GET', url: u.toString(), headers: this.headers(token) };
  },
  parseChannels(res: HttpResponse): Page<Channel> {
    const j = JSON.parse(res.body) as { ok: boolean; error?: string; channels?: Channel[]; response_metadata?: { next_cursor?: string } };
    if (!j.ok) throw new Error(`slack error: ${j.error}`);
    const next = readPath(j, 'response_metadata.next_cursor');
    return { items: (j.channels ?? []).map((c) => ({ id: c.id, name: c.name })), ...(next ? { nextCursor: next } : {}) };
  },
  /** A MUTATING action — its connector permission gate + governance apply upstream. */
  postMessageRequest(token: string, channel: string, text: string): HttpRequest {
    return { method: 'POST', url: `${this.base}/chat.postMessage`, headers: this.headers(token), body: JSON.stringify({ channel, text }) };
  },
};

/**
 * Drain a cursor-paginated endpoint fully via the HttpClient (bounded by maxPages).
 * Generic over the request builder + page parser — reused by every cursor connector.
 */
export async function drainCursor<T>(
  http: HttpClient,
  buildRequest: (cursor?: string) => HttpRequest,
  parse: (res: HttpResponse) => Page<T>,
  maxPages = 50,
): Promise<T[]> {
  const items: T[] = [];
  let cursor: string | undefined;
  for (let i = 0; i < maxPages; i++) {
    const res = await http.send(buildRequest(cursor));
    const page = parse(res);
    items.push(...page.items);
    if (!page.nextCursor) break;
    cursor = page.nextCursor;
  }
  return items;
}
