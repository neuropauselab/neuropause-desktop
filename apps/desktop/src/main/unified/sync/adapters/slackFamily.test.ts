import { makeUnifiedId } from '../../ids';
/**
 * P5 — Increment 6: the Slack connector FAMILY (channels, messages, users, files on one `slack`
 * connector). Pure-node, fake HttpClient. Covers the family composition, the `ok:false` → typed-error
 * taxonomy that makes graceful degradation work, the per-channel wedge-prevention in `messages`, the new
 * users/files mappers + pulls (cursor + paged/high-water), and runtime capability discovery. The existing
 * mapChannel/mapMessage stay covered by adapters.test.ts.
 */
import { describe, expect, it } from 'vitest';
import type { SyncContext } from '../adapterSdk';
import { slackAdapter, slackServiceAvailability, mapFile, mapUser, SLACK_SERVICES } from './slack';
import { unixToIso } from './util';

const NOW = '2026-07-12T00:00:00.000Z';
const base = { tenantId: 'org-test', connectorId: 'slack', accountId: 'a1', now: NOW } as const;
const pureCtx: SyncContext = { ...base, http: undefined as never, cursor: null };

/** ctx whose http replays one Slack body (200 with {ok,...}) per call, routed by url. */
function routed(handler: (url: string) => unknown, cursor: string | null = null): SyncContext {
  const http = {
    getJson: (url: string) => Promise.resolve({ data: handler(url), headers: {}, status: 200 }),
  } as unknown as SyncContext['http'];
  return { ...base, http, cursor };
}

const conversationsR = slackAdapter.resources.find((r) => r.id === 'conversations')!;
const messagesR = slackAdapter.resources.find((r) => r.id === 'messages')!;
const usersR = slackAdapter.resources.find((r) => r.id === 'users')!;
const filesR = slackAdapter.resources.find((r) => r.id === 'files')!;

describe('Slack family — composition & graceful degradation', () => {
  it('is ONE connector with every service mounted as a resource', () => {
    expect(slackAdapter.connectorId).toBe('slack');
    expect(slackAdapter.resources.map((r) => r.id)).toEqual(['conversations', 'messages', 'users', 'files']);
  });

  it('a missing scope (ok:false missing_scope) degrades the SERVICE, not the family', async () => {
    const page = await usersR.pull(routed(() => ({ ok: false, error: 'missing_scope' })));
    expect(page.entities).toEqual([]);
    expect(page.degraded?.kind).toBe('unauthorized');
  });

  it('a not-found (ok:false channel_not_found) degrades as unprovisioned', async () => {
    const page = await conversationsR.pull(routed(() => ({ ok: false, error: 'channel_not_found' })));
    expect(page.degraded?.kind).toBe('unprovisioned');
  });

  it('reauth (ok:false invalid_auth) PROPAGATES connector-wide — never a per-service degrade', async () => {
    // A bare Error would silently kill the family; the typed AuthError re-throws through graceful so the
    // connector flips to reauth_required instead.
    await expect(usersR.pull(routed(() => ({ ok: false, error: 'invalid_auth' })))).rejects.toThrow();
  });
});

describe('Slack messages — per-channel wedge prevention', () => {
  it('a channel the bot cannot read is SKIPPED and the queue advances — one bad channel never wedges the walk', async () => {
    // Pre-built queue [Cbad, Cok] at idx 0; Cbad returns not_in_channel. The internal skip must advance
    // idx WITHOUT degrading (graceful would freeze the cursor at idx 0 → retry Cbad forever).
    const ctx = routed(() => ({ ok: false, error: 'not_in_channel' }), JSON.stringify({ hw: {}, queue: ['Cbad', 'Cok'], idx: 0 }));
    const page = await messagesR.pull(ctx);
    expect(page.entities).toEqual([]);
    expect(page.degraded).toBeUndefined(); // skipped internally, not a service failure
    expect(page.hasMore).toBe(true);
    expect(JSON.parse(page.cursor as string)).toMatchObject({ idx: 1 });
  });

  it('but a missing channels scope on the QUEUE-BUILD degrades the whole messages service', async () => {
    const page = await messagesR.pull(routed(() => ({ ok: false, error: 'missing_scope' })));
    expect(page.degraded?.kind).toBe('unauthorized');
  });

  it('reads a channel and advances its per-channel high-water', async () => {
    const ctx = routed(() => ({ ok: true, messages: [{ ts: '1700000001.000100', text: 'hi', user: 'U1' }] }), JSON.stringify({ hw: {}, queue: ['C1'], idx: 0 }));
    const page = await messagesR.pull(ctx);
    expect(page.entities.map((e) => e.sourceId)).toEqual(['C1:1700000001.000100']);
    expect((JSON.parse(page.cursor as string) as { hw: Record<string, string> }).hw.C1).toBe('1700000001.000100');
  });

  it('pages a >100-message burst through next_cursor and commits the high-water ONLY on drain (no message loss)', async () => {
    // Page 1: newest-first, has_more + next_cursor → stay on the channel; hold the newest as pending;
    // do NOT advance the high-water yet (else the un-fetched older-but-new messages would be leapfrogged).
    const ctx1 = routed(
      () => ({ ok: true, messages: [{ ts: '1700000200.0002' }, { ts: '1700000100.0001' }], has_more: true, response_metadata: { next_cursor: 'PG2' } }),
      JSON.stringify({ hw: {}, queue: ['C1'], idx: 0 }),
    );
    const p1 = await messagesR.pull(ctx1);
    expect(p1.entities).toHaveLength(2);
    expect(p1.hasMore).toBe(true);
    const cur1 = JSON.parse(p1.cursor as string) as { idx: number; mcur: string; pending: string; hw: Record<string, string> };
    expect(cur1.idx).toBe(0); // still draining C1
    expect(cur1.mcur).toBe('PG2'); // carries Slack's own cursor
    expect(cur1.pending).toBe('1700000200.0002'); // newest held
    expect(cur1.hw.C1).toBeUndefined(); // high-water NOT advanced mid-drain

    // Page 2: last page (no next_cursor) → commit the newest ts as the high-water, advance past C1.
    const ctx2 = routed(() => ({ ok: true, messages: [{ ts: '1700000050.0000' }], has_more: false }), p1.cursor);
    const p2 = await messagesR.pull(ctx2);
    expect(p2.hasMore).toBe(false);
    expect((JSON.parse(p2.cursor as string) as { hw: Record<string, string> }).hw.C1).toBe('1700000200.0002');
  });
});

describe('Slack Users & Files', () => {
  it('maps a user to a contact with a REAL updated timestamp (no re-sync churn)', () => {
    const e = mapUser(pureCtx, { id: 'U1', name: 'ada', real_name: 'Ada L', updated: 1_700_000_000, profile: { email: 'ada@x.com', title: 'CTO' } });
    expect(e.kind).toBe('contact');
    expect(e.id).toBe(makeUnifiedId('org-test', 'slack', 'a1', 'contact', 'U1'));
    expect(e.title).toBe('Ada L');
    expect(e.author).toBe('ada@x.com');
    expect(e.updatedAt).toBe(unixToIso(1_700_000_000)); // stable across syncs, not ctx.now
  });

  it('a member with no `updated` (e.g. USLACKBOT, updated:0) uses a STABLE baseline, never the run clock', () => {
    const bot = { id: 'USLACKBOT', name: 'slackbot', updated: 0 };
    const early = mapUser({ ...pureCtx, now: '2026-01-01T00:00:00.000Z' }, bot);
    const late = mapUser({ ...pureCtx, now: '2026-12-31T00:00:00.000Z' }, bot);
    expect(early.updatedAt).toBe(late.updatedAt); // no churn on every full re-walk
  });

  it('maps a file to a file entity via its permalink', () => {
    const e = mapFile(pureCtx, { id: 'F1', created: 1_700_000_000, title: 'Plan', mimetype: 'application/pdf', size: 1234, permalink: 'https://slack/F1' });
    expect(e.kind).toBe('file');
    expect(e.id).toBe(makeUnifiedId('org-test', 'slack', 'a1', 'file', 'F1'));
    expect(e.url).toBe('https://slack/F1');
    expect(e.metadata.size).toBe(1234);
  });

  it('users: lists members, tombstones deleted, captures the cursor', async () => {
    const ctx = routed(() => ({ ok: true, members: [{ id: 'U1', name: 'ada', updated: 1 }, { id: 'U2', deleted: true }], response_metadata: { next_cursor: 'NX' } }));
    const page = await usersR.pull(ctx);
    expect(page.entities.map((e) => e.sourceId)).toEqual(['U1']);
    expect(page.deletedSourceIds).toEqual(['U2']);
    expect(page.hasMore).toBe(true);
    expect(JSON.parse(page.cursor as string)).toEqual({ cursor: 'NX' });
  });

  it('files: on drain, advances ts_from to the max created timestamp (incremental)', async () => {
    const ctx = routed(() => ({ ok: true, files: [{ id: 'F1', created: 1_700_000_000 }, { id: 'F2', created: 1_700_000_500 }], paging: { count: 100, total: 2, page: 1, pages: 1 } }));
    const page = await filesR.pull(ctx);
    expect(page.entities.map((e) => e.sourceId)).toEqual(['F1', 'F2']);
    expect(page.hasMore).toBe(false);
    expect(JSON.parse(page.cursor as string)).toEqual({ tsFrom: '1700000500' });
  });

  it('files: paginates when paging.pages > page, carrying the running high-water', async () => {
    const ctx = routed(() => ({ ok: true, files: [{ id: 'F1', created: 1_700_000_000 }], paging: { count: 100, total: 150, page: 1, pages: 2 } }));
    const page = await filesR.pull(ctx);
    expect(page.hasMore).toBe(true);
    expect(JSON.parse(page.cursor as string)).toMatchObject({ page: 2, maxTs: '1700000000' });
  });
});

describe('Slack capability discovery (runtime-driven, ✓/✗)', () => {
  it('available services derive from the granted BOT scopes', () => {
    const byId = Object.fromEntries(slackServiceAvailability(['channels:read', 'channels:history']).map((s) => [s.id, s.available]));
    expect(byId.conversations).toBe(true);
    expect(byId.messages).toBe(true);
    expect(byId.users).toBe(false); // users:read not granted → ✗
    expect(byId.files).toBe(false);
  });

  it('users:read + files:read unlock those services', () => {
    const byId = Object.fromEntries(slackServiceAvailability(['users:read', 'files:read']).map((s) => [s.id, s.available]));
    expect(byId.users).toBe(true);
    expect(byId.files).toBe(true);
    expect(byId.conversations).toBe(false);
  });

  it('the catalog ids match the adapter resource ids (so live counts appear per service)', () => {
    expect(SLACK_SERVICES.map((s) => s.id)).toEqual(slackAdapter.resources.map((r) => r.id));
  });
});
