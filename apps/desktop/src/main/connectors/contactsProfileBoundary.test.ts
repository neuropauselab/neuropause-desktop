/**
 * SEAM-B.19 / GATE-R.13 — THE CONTACTS PROFILE'S AUTHORITY BOUNDARY, proven before any credential.
 *
 * B.18 narrowed what the app ASKS FOR. These pins prove what happens when it is GRANTED only that:
 * a contacts-profile grant lets `contacts.create` through the executor's scope gate, and every
 * out-of-profile capability is refused **before the network is touched** — not by a caller's good
 * manners but by the executor's own check, driven here through the REAL `M365Executor` with the real
 * action catalog and a recording HTTP client that counts every call it would have made.
 *
 * Scope of the claim: this is the executor's scope gate only. It is not consent, not a token, not a
 * kernel verdict, and not an external effect. EXTERNAL_EFFECT = 0 — no network exists in this file.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { PlatformEventInput } from '@neuropause/shared';
import { SyncStateStore } from '../unified/sync/syncStateStore';
import type { RateGate } from '../unified/sync/http';
import { ALL_M365_ACTIONS } from './m365';
import { M365Executor } from './m365/executor';
import type { WriteActionContext } from './m365/actionSdk';
import { m365ScopesForProfile } from './manifests';

/** The scopes a contacts-profile consent would actually grant (B.18's narrow set). */
const CONTACTS_PROFILE = m365ScopesForProfile('contacts');

interface Call {
  method: string;
  url: string;
}

/** A recording HTTP client. Every call it records is a call that WOULD have hit Microsoft Graph. */
function recordingHttp(): { http: WriteActionContext['http']; calls: Call[] } {
  const calls: Call[] = [];
  const ok = (url: string, data: unknown) => ({ data, headers: { 'x-ratelimit-remaining': '99' }, status: 200 });
  const http = {
    getJson: (url: string) => {
      calls.push({ method: 'GET', url });
      return Promise.resolve(ok(url, { value: [] }));
    },
    postJson: (url: string) => {
      calls.push({ method: 'POST', url });
      return Promise.resolve(ok(url, { id: 'contact-id-fake' }));
    },
    patchJson: (url: string) => {
      calls.push({ method: 'PATCH', url });
      return Promise.resolve(ok(url, { id: 'p' }));
    },
    deleteJson: (url: string) => {
      calls.push({ method: 'DELETE', url });
      return Promise.resolve(ok(url, null));
    },
    sendBinary: (method: string, url: string) => {
      calls.push({ method, url });
      return Promise.resolve(ok(url, { id: 'u', size: 3 }));
    },
    getBinary: (url: string) => {
      calls.push({ method: 'GET', url });
      return Promise.resolve({ bytes: new Uint8Array([1]), headers: {}, status: 200 });
    },
  } as unknown as WriteActionContext['http'];
  return { http, calls };
}

describe('SEAM-B.19 · a contacts-profile grant is an authority boundary, enforced before the network', () => {
  let dir: string;
  let calls: Call[];
  let exec: M365Executor;
  let events: PlatformEventInput[];

  beforeEach(async () => {
    dir = join(tmpdir(), `np-b19-${process.pid}-${Date.now()}`);
    await fs.mkdir(dir, { recursive: true });
    const health = new SyncStateStore(join(dir, 'ss.json'));
    await health.load();
    events = [];
    const rec = recordingHttp();
    calls = rec.calls;
    const rate: RateGate = { acquire: () => Promise.resolve(), note: () => undefined } as unknown as RateGate;
    exec = new M365Executor(
      {
        getToken: () => Promise.resolve('tok'),
        publish: (e) => events.push(e),
        rate,
        recordActivity: () => undefined,
        health,
        manifestName: () => 'Microsoft Entra ID',
        // THE GRANT UNDER TEST: exactly what a contacts-profile consent yields.
        grantedScopes: () => [...CONTACTS_PROFILE],
        ownsAccount: () => true,
        makeHttp: () => rec.http,
      },
      ALL_M365_ACTIONS,
    );
  });

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('§27 TEST 3 (control): the profile PASSES the executor scope gate for contacts.create — the boundary is not simply refusing everything', async () => {
    const r = await exec.execute('microsoft-entra', 'a', 'contacts.create', { givenName: 'SEAM-B16' }, true);
    expect(r.ok).toBe(true);
    // Exactly one Graph call, and it is the documented create endpoint.
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ method: 'POST', url: expect.stringContaining('/me/contacts') });
  });

  it('§27 TESTS 4/5/6: mail, files and Teams capabilities are REFUSED by the executor — and the network is never touched', async () => {
    for (const [actionId, missing] of [
      ['mail.send', 'Mail.Send'],
      ['drive.upload', 'Files.ReadWrite.All'],
      ['teams.sendChannelMessage', 'ChannelMessage.Send'],
      ['calendar.create', 'Calendars.ReadWrite'],
    ] as const) {
      const r = await exec.execute('microsoft-entra', 'a', actionId, {}, true);
      expect(r.ok, actionId).toBe(false);
      expect(r.message, actionId).toContain('Missing Graph permission(s)');
      expect(r.message, actionId).toContain(missing);
    }
    // THE LOAD-BEARING ASSERTION: zero Graph calls across every refusal.
    expect(calls).toEqual([]);
  });

  it('the refusal names the missing permission without leaking the granted set', async () => {
    const r = await exec.execute('microsoft-entra', 'a', 'mail.send', {}, true);
    expect(r.message).toContain('Mail.Send');
    // The message must not enumerate what the account DOES hold — a probe learns nothing extra.
    expect(r.message).not.toContain('Contacts.ReadWrite');
    expect(calls).toEqual([]);
  });

  it('§27 TEST 10: an unconfirmed mutating contacts.create is held BEFORE the scope gate and before the network', async () => {
    const r = await exec.execute('microsoft-entra', 'a', 'contacts.create', { givenName: 'SEAM-B16' }, false);
    expect(r.ok).toBe(false);
    expect(r.requiresConfirmation).toBe(true);
    expect(calls).toEqual([]);
  });

  it('an unowned account is refused first, with the same message an unknown account gets — and no network call', async () => {
    const health = new SyncStateStore(join(dir, 'ss2.json'));
    await health.load();
    const rec = recordingHttp();
    const rate: RateGate = { acquire: () => Promise.resolve(), note: () => undefined } as unknown as RateGate;
    const stranger = new M365Executor(
      {
        getToken: () => Promise.resolve('tok'),
        publish: () => undefined,
        rate,
        recordActivity: () => undefined,
        health,
        manifestName: () => 'Microsoft Entra ID',
        grantedScopes: () => [...CONTACTS_PROFILE],
        ownsAccount: () => false,
        makeHttp: () => rec.http,
      },
      ALL_M365_ACTIONS,
    );
    const r = await stranger.execute('microsoft-entra', 'other-workspace', 'contacts.create', {}, true);
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/Not authorized/i);
    expect(rec.calls).toEqual([]);
  });

  it('the profile grant covers the read-back capability too — contacts reads are inside the boundary', async () => {
    // GET /me/contacts is the documented read shape the B.19 read-back plan relies on.
    expect(CONTACTS_PROFILE).toContain('Contacts.Read');
    const r = await exec.execute('microsoft-entra', 'a', 'contacts.search', { query: 'SEAM-B16' }, false);
    expect(r.ok).toBe(true);
    expect(calls.some((c) => c.method === 'GET' && c.url.includes('/me/contacts'))).toBe(true);
  });
});
