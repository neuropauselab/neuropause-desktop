import { describe, expect, it } from 'vitest';
import type { GraphMessage } from '@neuropause/shared';
import { m365Resources, mapMessage, mapEvent, mapDriveItem, mapContact, mapTeam } from './unified/sync/adapters/m365';
import type { SyncContext } from './unified/sync/adapterSdk';
import { AuthError, HttpError } from './unified/sync/http';
import { makeUnifiedId } from './unified/ids';

const NOW = '2026-07-10T00:00:00.000Z';
const BASE = { tenantId: 'org-test', connectorId: 'microsoft-entra', accountId: 'acct-1', now: NOW } as const;

function stubCtx(response: unknown, cursor: string | null = null): SyncContext {
  const http = {
    getJson: () => Promise.resolve({ data: response, headers: {}, status: 200 }),
    postJson: () => Promise.reject(new Error('unused')),
  } as unknown as SyncContext['http'];
  return { ...BASE, http, cursor };
}

function errCtx(status: number): SyncContext {
  // Mirror the real http client's taxonomy: 401/403 → AuthError (NOT HttpError); other 4xx/5xx → HttpError.
  const err =
    status === 401 || status === 403
      ? new AuthError(`HTTP ${status}`, status)
      : new HttpError(status, 'err', status >= 500);
  const http = {
    getJson: () => Promise.reject(err),
    postJson: () => Promise.reject(new Error('unused')),
  } as unknown as SyncContext['http'];
  return { ...BASE, http, cursor: null };
}

const res = (id: string) => m365Resources.find((r) => r.id === id)!;

describe('m365Adapter — mappers', () => {
  it('maps a message to a message entity with a deterministic id', () => {
    const e = mapMessage(stubCtx({}), {
      id: 'm1',
      subject: 'Hi',
      from: { emailAddress: { address: 'a@b.com' } },
      receivedDateTime: '2026-07-01T00:00:00Z',
    } as GraphMessage);
    expect(e.kind).toBe('message');
    expect(e.id).toBe(makeUnifiedId('org-test', 'microsoft-entra', 'acct-1', 'message', 'm1'));
    expect(e.title).toBe('Hi');
    expect(e.author).toBe('a@b.com');
    expect(e.metadata.module).toBe('outlook');
  });

  it('maps event/drive/contact/team to the right UDM kinds', () => {
    expect(mapEvent(stubCtx({}), { id: 'e1', subject: 'S', start: { dateTime: '2026-07-10T09:00:00' } }).kind).toBe('calendar_event');
    expect(mapDriveItem(stubCtx({}), { id: 'd1', name: 'f.txt' }).kind).toBe('file');
    expect(mapContact(stubCtx({}), { id: 'c1', displayName: 'C' }).kind).toBe('contact');
    expect(mapTeam(stubCtx({}), { id: 't1', displayName: 'T' }).kind).toBe('workspace');
  });
});

describe('m365Adapter — resources + graceful degradation', () => {
  it('registers all five modules', () => {
    expect(m365Resources.map((r) => r.id)).toEqual(['mail', 'calendar', 'drive', 'contacts', 'teams']);
  });

  it('pulls mail via delta and captures the deltaLink', async () => {
    const page = await res('mail').pull(
      stubCtx({ value: [{ id: 'm1', subject: 'A', from: { emailAddress: { address: 'x@y.com' } } }], '@odata.deltaLink': 'D' }),
    );
    expect(page.entities.map((e) => e.sourceId)).toEqual(['m1']);
    expect(page.hasMore).toBe(false);
    expect(JSON.parse(page.cursor as string)).toEqual({ delta: 'D' });
  });

  it('skips the OneDrive root and reports deleted items', async () => {
    const page = await res('drive').pull(
      stubCtx({
        value: [
          { id: 'root', name: 'root' },
          { id: 'f1', name: 'a.txt', parentReference: { id: 'root', path: '/drive/root:' } },
          { id: 'f2', deleted: { state: 'deleted' } },
        ],
        '@odata.deltaLink': 'D',
      }),
    );
    expect(page.entities.map((e) => e.sourceId)).toEqual(['f1']);
    expect(page.deletedSourceIds).toEqual(['f2']);
  });

  it('gracefully skips a module that returns 403 (unlicensed) and tags it unauthorized', async () => {
    const page = await res('mail').pull(errCtx(403));
    expect(page.entities).toEqual([]);
    expect(page.hasMore).toBe(false);
    expect(page.degraded?.kind).toBe('unauthorized');
    expect(page.degraded?.reason).toContain('403');
  });

  it('gracefully skips 404 (mailbox/OneDrive not provisioned) and tags it unprovisioned', async () => {
    const drive = await res('drive').pull(errCtx(404));
    expect(drive.entities).toEqual([]);
    expect(drive.degraded?.kind).toBe('unprovisioned');
    expect((await res('teams').pull(errCtx(403))).degraded?.kind).toBe('unauthorized');
  });

  it('propagates genuinely retryable errors (e.g. 500)', async () => {
    await expect(res('teams').pull(errCtx(500))).rejects.toBeInstanceOf(HttpError);
  });

  it('propagates a 401 (token rejected) instead of masking it as a per-module gap', async () => {
    // 401 is account-wide (reconnect required) — it must NOT be swallowed like a 403 module-permission gap.
    await expect(res('mail').pull(errCtx(401))).rejects.toBeInstanceOf(AuthError);
  });

  it('degrades the real 403 path where the http client raises AuthError, not HttpError', async () => {
    // Regression guard for the P2.3c bug: a 403 arrives as AuthError; graceful() must still degrade it.
    const err = await res('mail')
      .pull(errCtx(403))
      .then(() => null)
      .catch((e) => e);
    expect(err).toBeNull(); // did NOT throw — it degraded
    const page = await res('mail').pull(errCtx(403));
    expect(page.degraded).toEqual({
      kind: 'unauthorized',
      reason: 'Missing Graph permission or module not licensed (403)',
    });
  });
});
