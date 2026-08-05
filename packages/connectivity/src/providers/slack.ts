/**
 * Module 7 — Slack connector. Slack Web API adapter over the transport seam. Covers
 * channels, messages, threads, mentions (search), files, and reactions. Slack returns
 * `{ ok: false, error }` on failure — the adapter surfaces that as an error.
 */
import type { HttpClient } from '@neuropause/integrations';
import { HttpConnector, pickArray, str, num, type TransportOptions } from '../httpConnector';

export interface SlackChannel { id: string; name: string; }
export interface SlackMessage { ts: string; text: string; user: string; }
export interface SlackFile { id: string; name: string; mimetype: string; }
export interface SlackReaction { name: string; count: number; }

function ensureOk(json: unknown): Record<string, unknown> {
  const j = (json ?? {}) as Record<string, unknown>;
  if (j.ok === false) throw new Error(`slack error: ${str(j.error) || 'unknown'}`);
  return j;
}

export class SlackConnector extends HttpConnector {
  constructor(http: HttpClient, opts: Partial<TransportOptions> & { token?: string } = {}) {
    super(http, { baseUrl: opts.baseUrl ?? 'https://slack.com/api', ...opts });
  }

  listChannels(opts: { limit?: number } = {}): Promise<SlackChannel[]> {
    return this.listMapped('/conversations.list', (j) => (pickArray('channels')(ensureOk(j))), (r) => ({ id: str(r.id), name: str(r.name) }), { limit: opts.limit ?? 200 });
  }
  listMessages(channel: string, opts: { limit?: number } = {}): Promise<SlackMessage[]> {
    return this.listMapped('/conversations.history', (j) => (pickArray('messages')(ensureOk(j))), (r) => ({ ts: str(r.ts), text: str(r.text), user: str(r.user) }), { channel, limit: opts.limit ?? 100 });
  }
  listThread(channel: string, ts: string): Promise<SlackMessage[]> {
    return this.listMapped('/conversations.replies', (j) => (pickArray('messages')(ensureOk(j))), (r) => ({ ts: str(r.ts), text: str(r.text), user: str(r.user) }), { channel, ts });
  }
  mentions(query: string): Promise<SlackMessage[]> {
    return this.listMapped('/search.messages', (j) => (pickArray('matches')((ensureOk(j).messages as Record<string, unknown>) ?? {})), (r) => ({ ts: str(r.ts), text: str(r.text), user: str(r.user) }), { query });
  }
  listFiles(opts: { channel?: string } = {}): Promise<SlackFile[]> {
    return this.listMapped('/files.list', (j) => (pickArray('files')(ensureOk(j))), (r) => ({ id: str(r.id), name: str(r.name), mimetype: str(r.mimetype) }), { ...(opts.channel ? { channel: opts.channel } : {}) });
  }
  async reactions(channel: string, timestamp: string): Promise<SlackReaction[]> {
    const j = ensureOk(await this.t.getJson<unknown>('/reactions.get', { channel, timestamp }));
    const message = (j.message as Record<string, unknown>) ?? {};
    return ((message.reactions as Array<Record<string, unknown>>) ?? []).map((r) => ({ name: str(r.name), count: num(r.count) }));
  }
}
