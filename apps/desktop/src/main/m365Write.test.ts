import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { PlatformEventInput } from '@neuropause/shared';
import { SyncStateStore } from './unified/sync/syncStateStore';
import type { RateGate } from './unified/sync/http';
import { mailActions } from './connectors/m365/mail';
import { calendarActions } from './connectors/m365/calendar';
import { driveActions } from './connectors/m365/drive';
import { teamsActions } from './connectors/m365/teams';
import { contactActions, detectDuplicates } from './connectors/m365/contacts';
import { ALL_M365_ACTIONS } from './connectors/m365';
import { M365Executor } from './connectors/m365/executor';
import type { WriteAction, WriteActionContext } from './connectors/m365/actionSdk';

/* ── a recording fake HttpClient (no network) ─────────────────────────────── */

interface Call {
  method: string;
  url: string;
  body?: unknown;
}
function fakeHttp(canned: Record<string, unknown> = {}): { http: WriteActionContext['http']; calls: Call[] } {
  const calls: Call[] = [];
  const ok = (url: string, data: unknown): { data: unknown; headers: Record<string, string>; status: number } => ({
    data: data ?? canned[url] ?? {},
    headers: { 'x-ratelimit-remaining': '99' },
    status: 200,
  });
  const http = {
    getJson: (url: string) => { calls.push({ method: 'GET', url }); return Promise.resolve(ok(url, canned[url] ?? {})); },
    postJson: (url: string, body: unknown) => { calls.push({ method: 'POST', url, body }); return Promise.resolve(ok(url, canned[url] ?? { id: 'new-id' })); },
    patchJson: (url: string, body: unknown) => { calls.push({ method: 'PATCH', url, body }); return Promise.resolve(ok(url, canned[url] ?? { id: 'patched' })); },
    deleteJson: (url: string) => { calls.push({ method: 'DELETE', url }); return Promise.resolve(ok(url, null)); },
    sendBinary: (method: string, url: string) => { calls.push({ method, url }); return Promise.resolve(ok(url, { id: 'up', size: 3 })); },
    getBinary: (url: string) => { calls.push({ method: 'GET', url }); return Promise.resolve({ bytes: new Uint8Array([1, 2, 3]), headers: {}, status: 200 }); },
  } as unknown as WriteActionContext['http'];
  return { http, calls };
}

function ctxWith(http: WriteActionContext['http']): WriteActionContext {
  return { connectorId: 'microsoft-entra', accountId: 'acct', http, now: '2026-07-11T00:00:00.000Z' };
}
function action(id: string): WriteAction {
  const a = ALL_M365_ACTIONS.find((x) => x.id === id);
  if (!a) throw new Error(`no action ${id}`);
  return a;
}

describe('M365 write actions — catalog + Graph mapping (no mocks: real endpoint shapes)', () => {
  it('exposes every domain with correct mutates flags', () => {
    const ids = ALL_M365_ACTIONS.map((a) => a.id);
    expect(ids).toEqual(expect.arrayContaining(['mail.send', 'calendar.create', 'drive.upload', 'teams.sendChannelMessage', 'contacts.create']));
    expect(action('mail.send').mutates).toBe(true);
    expect(action('mail.send').scopes).toContain('Mail.Send');
    expect(action('contacts.search').mutates).toBe(false);
    expect(action('teams.listChannelMembers').mutates).toBe(false);
    expect(action('mail.downloadAttachment').mutates).toBe(false);
  });

  it('mail.send → POST /me/sendMail with the recipients', async () => {
    const { http, calls } = fakeHttp();
    const r = await mailActions.find((a) => a.id === 'mail.send')!.run(ctxWith(http), { to: ['a@b.com'], subject: 'Hi', body: 'hello' });
    expect(r.ok).toBe(true);
    expect(calls[0].method).toBe('POST');
    expect(calls[0].url).toBe('https://graph.microsoft.com/v1.0/me/sendMail');
    const body = calls[0].body as { message: { toRecipients: Array<{ emailAddress: { address: string } }> } };
    expect(body.message.toRecipients[0].emailAddress.address).toBe('a@b.com');
  });

  it('mail.markRead → PATCH; mail.delete → DELETE', async () => {
    const { http, calls } = fakeHttp();
    await mailActions.find((a) => a.id === 'mail.markRead')!.run(ctxWith(http), { messageId: 'm1', isRead: false });
    expect(calls[0]).toMatchObject({ method: 'PATCH', url: 'https://graph.microsoft.com/v1.0/me/messages/m1' });
    expect(calls[0].body).toMatchObject({ isRead: false });
    await mailActions.find((a) => a.id === 'mail.delete')!.run(ctxWith(http), { messageId: 'm2' });
    expect(calls[1]).toMatchObject({ method: 'DELETE', url: 'https://graph.microsoft.com/v1.0/me/messages/m2' });
  });

  it('calendar.create → POST /me/events; calendar.respond → the accept action', async () => {
    const { http, calls } = fakeHttp();
    await calendarActions.find((a) => a.id === 'calendar.create')!.run(ctxWith(http), { subject: 'Sync', start: '2026-07-12T09:00:00', end: '2026-07-12T09:30:00', isOnlineMeeting: true });
    expect(calls[0]).toMatchObject({ method: 'POST', url: 'https://graph.microsoft.com/v1.0/me/events' });
    expect(calls[0].body).toMatchObject({ isOnlineMeeting: true, onlineMeetingProvider: 'teamsForBusiness' });
    await calendarActions.find((a) => a.id === 'calendar.respond')!.run(ctxWith(http), { eventId: 'e1', response: 'accept' });
    expect(calls[1].url).toBe('https://graph.microsoft.com/v1.0/me/events/e1/accept');
  });

  it('drive.upload (small) → PUT content; drive.share → createLink', async () => {
    const { http, calls } = fakeHttp();
    await driveActions.find((a) => a.id === 'drive.upload')!.run(ctxWith(http), { path: 'docs/a.txt', contentBytes: Buffer.from('hi').toString('base64') });
    expect(calls[0]).toMatchObject({ method: 'PUT', url: 'https://graph.microsoft.com/v1.0/me/drive/root:/docs/a.txt:/content' });
    await driveActions.find((a) => a.id === 'drive.share')!.run(ctxWith(http), { itemId: 'i1', linkType: 'view', scope: 'anonymous' });
    expect(calls[1].url).toBe('https://graph.microsoft.com/v1.0/me/drive/items/i1/createLink');
  });

  it('teams.sendChannelMessage → the channel messages endpoint; contacts.create → /me/contacts', async () => {
    const { http, calls } = fakeHttp();
    await teamsActions.find((a) => a.id === 'teams.sendChannelMessage')!.run(ctxWith(http), { teamId: 't1', channelId: 'c1', content: 'hello team' });
    expect(calls[0].url).toBe('https://graph.microsoft.com/v1.0/teams/t1/channels/c1/messages');
    await contactActions.find((a) => a.id === 'contacts.create')!.run(ctxWith(http), { givenName: 'Ada', emails: ['ada@x.com'] });
    expect(calls[1]).toMatchObject({ method: 'POST', url: 'https://graph.microsoft.com/v1.0/me/contacts' });
  });

  it('detectDuplicates groups deterministically by email then name', () => {
    const dupes = detectDuplicates([
      { id: '1', displayName: 'Ada', emailAddresses: [{ address: 'ADA@x.com' }] },
      { id: '2', displayName: 'Ada L.', emailAddresses: [{ address: 'ada@x.com' }] },
      { id: '3', displayName: 'Grace' },
      { id: '4', displayName: 'grace' },
    ]);
    expect(dupes.find((g) => g.key === 'email:ada@x.com')?.ids.sort()).toEqual(['1', '2']);
    expect(dupes.find((g) => g.key === 'name:grace')?.ids.sort()).toEqual(['3', '4']);
  });
});

/* ── executor: confirmation gate + scope validation + audited fan-out ─────── */

describe('M365Executor — confirmation gate, scope validation, audit + health', () => {
  let dir: string;
  const rate: RateGate = { acquire: () => Promise.resolve(), penalize: () => undefined };
  beforeEach(async () => {
    dir = join(tmpdir(), `nps-m365-${Math.random().toString(36).slice(2)}`);
    await fs.mkdir(dir, { recursive: true });
  });
  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  async function build(granted: string[]): Promise<{ exec: M365Executor; events: PlatformEventInput[]; health: SyncStateStore }> {
    const health = new SyncStateStore(join(dir, 'ss.json'));
    await health.load();
    const events: PlatformEventInput[] = [];
    const exec = new M365Executor(
      {
        getToken: () => Promise.resolve('tok'),
        publish: (e) => events.push(e),
        rate,
        recordActivity: () => undefined,
        health,
        manifestName: () => 'Microsoft Entra ID',
        grantedScopes: () => granted,
        makeHttp: () => fakeHttp().http,
      },
      ALL_M365_ACTIONS,
    );
    return { exec, events, health };
  }

  it('refuses an unknown action', async () => {
    const { exec } = await build([]);
    expect(await exec.execute('microsoft-entra', 'a', 'mail.nope', {}, true)).toMatchObject({ ok: false });
  });

  it('refuses a mutating action without explicit confirmation', async () => {
    const { exec, events } = await build(['Mail.Send']);
    const r = await exec.execute('microsoft-entra', 'a', 'mail.send', { to: ['x@y.com'] }, false);
    expect(r).toMatchObject({ ok: false, requiresConfirmation: true });
    expect(events).toHaveLength(0); // nothing published, nothing sent
  });

  it('fails closed when the required Graph scope is not granted', async () => {
    const { exec } = await build([]); // no scopes
    const r = await exec.execute('microsoft-entra', 'a', 'mail.send', { to: ['x@y.com'], subject: 'Hi' }, true);
    expect(r.ok).toBe(false);
    expect(r.message).toContain('Missing Graph permission');
  });

  it('executes a confirmed, scoped write and records the audit events + write-health', async () => {
    const { exec, events, health } = await build(['Mail.Send']);
    const r = await exec.execute('microsoft-entra', 'a', 'mail.send', { to: ['x@y.com'], subject: 'Hi', body: 'yo' }, true);
    expect(r.ok).toBe(true);
    const types = events.map((e) => e.type);
    expect(types).toContain('connector.write_started');
    expect(types).toContain('connector.write_completed');
    const st = health.get('microsoft-entra', 'a');
    expect(st.writeCount).toBe(1);
    expect(st.lastWriteAction).toBe('mail.send');
    expect(st.failedWrites ?? 0).toBe(0);
  });

  it('runs a read helper (non-mutating) without confirmation', async () => {
    const { exec } = await build(['Contacts.Read']);
    const r = await exec.execute('microsoft-entra', 'a', 'contacts.search', { query: 'ada' }, false);
    expect(r.ok).toBe(true);
  });
});
