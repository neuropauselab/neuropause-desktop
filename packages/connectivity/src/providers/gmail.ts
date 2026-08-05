/**
 * Module 5 — Gmail connector. Gmail REST v1 adapter over the transport seam. Covers
 * inbox/messages, labels, threads, unread, drafts, and attachment metadata.
 */
import type { HttpClient } from '@neuropause/integrations';
import { HttpConnector, pickArray, str, type TransportOptions } from '../httpConnector';

export interface GmailMessageRef { id: string; threadId: string; }
export interface GmailLabel { id: string; name: string; type: string; }
export interface GmailThread { id: string; snippet: string; }
export interface GmailDraft { id: string; messageId: string; }
export interface GmailAttachment { filename: string; mimeType: string; attachmentId: string; }

const rec = (row: Record<string, unknown>, key: string): Record<string, unknown> => (row[key] as Record<string, unknown>) ?? {};

export class GmailConnector extends HttpConnector {
  constructor(http: HttpClient, opts: Partial<TransportOptions> & { token?: string } = {}) {
    super(http, { baseUrl: opts.baseUrl ?? 'https://gmail.googleapis.com/gmail/v1', ...opts });
  }

  listMessages(userId = 'me', opts: { q?: string; maxResults?: number } = {}): Promise<GmailMessageRef[]> {
    return this.listMapped(`/users/${userId}/messages`, pickArray('messages'), (r) => ({ id: str(r.id), threadId: str(r.threadId) }), { ...(opts.q ? { q: opts.q } : {}), maxResults: opts.maxResults ?? 100 });
  }
  unread(userId = 'me'): Promise<GmailMessageRef[]> {
    return this.listMessages(userId, { q: 'is:unread' });
  }
  listLabels(userId = 'me'): Promise<GmailLabel[]> {
    return this.listMapped(`/users/${userId}/labels`, pickArray('labels'), (r) => ({ id: str(r.id), name: str(r.name), type: str(r.type) }));
  }
  listThreads(userId = 'me'): Promise<GmailThread[]> {
    return this.listMapped(`/users/${userId}/threads`, pickArray('threads'), (r) => ({ id: str(r.id), snippet: str(r.snippet) }));
  }
  listDrafts(userId = 'me'): Promise<GmailDraft[]> {
    return this.listMapped(`/users/${userId}/drafts`, pickArray('drafts'), (r) => ({ id: str(r.id), messageId: str(rec(r, 'message').id) }));
  }
  async attachments(userId = 'me', messageId: string): Promise<GmailAttachment[]> {
    const msg = await this.t.getJson<{ payload?: { parts?: Array<Record<string, unknown>> } }>(`/users/${userId}/messages/${messageId}`);
    const parts = msg.payload?.parts ?? [];
    return parts
      .filter((p) => str(p.filename) !== '')
      .map((p) => ({ filename: str(p.filename), mimeType: str(p.mimeType), attachmentId: str(rec(p, 'body').attachmentId) }));
  }
}
