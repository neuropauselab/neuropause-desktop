/**
 * NP-015 — THE TEMPORAL MODEL (ARCHITECTURE-SPEC §14; NP-012 §3 ruling slice 3
 * of 6, operator 20 Aug 2026). Three timestamps join the evidence record —
 * `request_time`, `event_time`, `effect_time` — under one discipline:
 *
 *   A TIME WE WERE NOT TOLD IS ABSENT, NOT APPROXIMATED.
 *
 * These pins exist to make that discipline breakable-on-purpose: every one of
 * them fails if a future change derives a timestamp from our own clock, from
 * the verification time, or from the polling window. §14's warning is the
 * point — distinguishing these instants is what stops "A happened before B"
 * from silently becoming "A caused B".
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

vi.mock('electron', () => ({ app: { getPath: () => '/tmp' } }));

import { actionRecord, requestTimeFrom } from './connectors/actionRecord';
import { fingerprint, verifyEffect, type SentItem, type VerificationTarget, type VerifyDeps } from './verification/verifyEffect';
import type { GovernedSendResult } from './cst/sendTransition';

/* ─────────────────── request_time: read, never re-clocked ─────────────────── */

describe('request_time — read out of the kernel-minted requestId', () => {
  it('reads a trailing ISO instant verbatim, past the colons in both the idem and the stamp', () => {
    // The production shape: `req:<idem>:<ISO>` — note BOTH halves carry colons.
    expect(requestTimeFrom('req:m365-send:acct-1:2026-08-18T12:23:44.512Z')).toBe('2026-08-18T12:23:44.512Z');
    expect(requestTimeFrom('req:idem:2026-08-18T12:23:44+05:30')).toBe('2026-08-18T12:23:44+05:30');
  });

  it('answers NULL for every id that carries no parseable instant — a guess is never better than an absence', () => {
    expect(requestTimeFrom('req:abc:1')).toBeNull();               // epoch/counter clock port
    expect(requestTimeFrom('req:abc:1755518624512')).toBeNull();   // epoch millis
    expect(requestTimeFrom('legacy-request-id')).toBeNull();       // pre-stamp id
    expect(requestTimeFrom('req:abc:2026-13-45T99:99:99Z')).toBeNull(); // shaped but not a real instant
    expect(requestTimeFrom('')).toBeNull();
  });

  it('does NOT fall back to the current clock — the same id yields the same answer, forever', () => {
    const a = requestTimeFrom('req:abc:not-a-time');
    const b = requestTimeFrom('req:abc:not-a-time');
    expect(a).toBeNull();
    expect(b).toBeNull();
  });
});

/* ─────────────────── effect_time: the provider's stamp only ─────────────────── */

describe('effect_time — carried verbatim from the corroborated read-back row', () => {
  const NOW = Date.parse('2026-08-18T13:25:54.000Z');
  const PROVIDER_SENT_AT = '2026-08-18T12:23:44.512Z'; // the provider's own stamp — deliberately NOT our clock
  const target: VerificationTarget = {
    internetMessageId: '<msg-123@np>', recipient: 'neuropause033@gmail.com',
    subjectFingerprint: fingerprint('NeuroPause S15 first real send'),
    bodyFingerprint: fingerprint('the demo is friday'),
    sentAtWindow: { fromMs: NOW - 7_200_000, toMs: NOW + 7_200_000 }, // ±2h: the send precedes its verification
  };
  const matching: SentItem = {
    internetMessageId: '<msg-123@np>', toRecipients: ['neuropause033@gmail.com'],
    subject: 'NeuroPause S15 first real send', bodyPreview: 'the demo is Friday',
    sentDateTime: PROVIDER_SENT_AT,
  };
  const deps = (over: Partial<VerifyDeps> = {}): VerifyDeps => ({
    readSentItems: () => Promise.resolve([]), readInbox: () => Promise.resolve([]),
    now: () => NOW, sleep: () => Promise.resolve(), backoffMs: [0, 0], ...over,
  });

  it('a corroborated match carries the PROVIDER\'s instant — not our clock, not the window', async () => {
    const r = await verifyEffect(target, deps({ readSentItems: () => Promise.resolve([matching]) }));
    expect(r.state).toBe('VERIFIED_SUCCESS');
    expect(r.observedEffectAt).toBe(PROVIDER_SENT_AT);
    expect(r.observedEffectAt).not.toBe(new Date(NOW).toISOString()); // never the verification time
  });

  it('HOLD carries NO effect time — nothing was observed, so nothing is stated', async () => {
    const r = await verifyEffect(target, deps());
    expect(r.state).toBe('HOLD');
    expect(r.observedEffectAt).toBeNull();
  });

  it('a BOUNCE carries no effect time either — a verified failure is not an effect', async () => {
    const r = await verifyEffect(target, deps({
      readInbox: () => Promise.resolve([{
        from: 'postmaster@outlook.com',
        subject: 'Undeliverable: NeuroPause S15 first real send',
        bodyPreview: 'Your message to neuropause033@gmail.com could not be delivered. SMTP 550 5.1.1 unknown recipient',
        receivedDateTime: new Date(NOW).toISOString(),
      }]),
    }));
    expect(r.state).toBe('VERIFY_FAILED');
    expect(r.observedEffectAt).toBeNull();
  });

  it('a row with no parseable instant CANNOT corroborate — so a VERIFIED_SUCCESS always carries a real provider time', async () => {
    // The timestamp window is part of the corroboration tuple, not decoration:
    // a row we cannot time is a row we cannot verify. This is why effect_time
    // can never be null on a success — there is no such success to reach.
    const noStamp: SentItem = { ...matching, sentDateTime: '' };
    const r = await verifyEffect(target, deps({ readSentItems: () => Promise.resolve([noStamp]) }));
    expect(r.state).toBe('HOLD');
    expect(r.observedEffectAt).toBeNull();
  });
});

/* ─────────────────── the record: four instants, each from its own source ─────────────────── */

describe('the evidence record carries each instant from its own source', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'np015-temporal-'));
    actionRecord.useDirForTests(dir);
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  const gsr = (requestId: string): GovernedSendResult => ({
    outcome: { transitionId: 't-np015', requestId, verdict: 'ALLOW', executed: true },
    semanticOutcome: 'ACKNOWLEDGED', effectCalls: 1, providerAck: true,
  } as unknown as GovernedSendResult);

  const request = { connectorId: 'microsoft-entra', accountId: 'acct-1', actionId: 'mail.send', params: { to: ['op@example.com'], subject: 'Q3', body: 'numbers' } };

  it('request_time comes from the kernel stamp; event_time is honestly null on the governed send path; record_time is our write', async () => {
    await actionRecord.observe(request, gsr('req:m365-send:acct-1:2026-08-18T12:20:00.000Z'), { actor: 'local:x', tenantId: 'tenant-A' });
    const [rec] = await actionRecord.query({ tenantId: 'tenant-A', transitionId: 't-np015' });

    expect(rec.requestTime).toBe('2026-08-18T12:20:00.000Z');
    // The send path observed no occasioning event — and says so, rather than reusing the request's time.
    expect(rec.eventTime).toBeNull();
    expect(rec.eventTime).not.toBe(rec.requestTime);
    // record_time is OUR write instant, and is a different concept from both.
    expect(Number.isFinite(Date.parse(rec.at))).toBe(true);
    expect(rec.at).not.toBe(rec.requestTime);
  });

  it('an unstamped requestId stores NULL — the observer never invents a request time', async () => {
    await actionRecord.observe(request, gsr('req:legacy:1'), { actor: 'local:x', tenantId: 'tenant-A' });
    const [rec] = await actionRecord.query({ tenantId: 'tenant-A', transitionId: 't-np015' });
    expect(rec.requestTime).toBeNull();
  });

  it('a caller that DID observe an event supplies event_time, and it is stored verbatim', async () => {
    await actionRecord.observe(request, gsr('req:m365-send:acct-1:2026-08-18T12:20:00.000Z'), {
      actor: 'local:x', tenantId: 'tenant-A', eventTime: '2026-08-18T09:00:00.000Z',
    });
    const [rec] = await actionRecord.query({ tenantId: 'tenant-A', transitionId: 't-np015' });
    expect(rec.eventTime).toBe('2026-08-18T09:00:00.000Z');
    // …and it stays DISTINCT from the request that followed it: precedence is recorded, causation is not claimed.
    expect(Date.parse(rec.eventTime as string)).toBeLessThan(Date.parse(rec.requestTime as string));
  });

  it('effect_time attaches to the verification, distinct from the verification time itself', async () => {
    await actionRecord.observe(request, gsr('req:m365-send:acct-1:2026-08-18T12:20:00.000Z'), { actor: 'local:x', tenantId: 'tenant-A' });
    await actionRecord.recordVerification('t-np015', {
      terminal: 'VERIFIED_SUCCESS', internetMessageId: '<msg-123@np>',
      at: '2026-08-18T13:25:54.000Z',            // when the ORACLE RAN
      effectTime: '2026-08-18T12:23:44.512Z',    // when the PROVIDER says it happened
      provenance: { source: 's16VerifyRun', method: 'corroborated-read-back', oracle: 'm365ReadBack:sentItems+inbox' },
    });
    const [rec] = await actionRecord.query({ tenantId: 'tenant-A', transitionId: 't-np015' });
    expect(rec.verification?.effectTime).toBe('2026-08-18T12:23:44.512Z');
    expect(rec.verification?.at).toBe('2026-08-18T13:25:54.000Z');
    expect(rec.verification?.effectTime).not.toBe(rec.verification?.at);
    // The full ordering the model exists to preserve: request → effect → verification → record.
    expect(Date.parse(rec.requestTime as string)).toBeLessThan(Date.parse(rec.verification?.effectTime as string));
    expect(Date.parse(rec.verification?.effectTime as string)).toBeLessThan(Date.parse(rec.verification?.at as string));
  });

  it('a HOLD verification stores effect_time NULL — an unobserved effect has no time', async () => {
    await actionRecord.observe(request, gsr('req:m365-send:acct-1:2026-08-18T12:20:00.000Z'), { actor: 'local:x', tenantId: 'tenant-A' });
    await actionRecord.recordVerification('t-np015', {
      terminal: 'HOLD', internetMessageId: null, at: '2026-08-18T13:25:54.000Z', effectTime: null,
    });
    const [rec] = await actionRecord.query({ tenantId: 'tenant-A', transitionId: 't-np015' });
    expect(rec.verification?.terminal).toBe('HOLD');
    expect(rec.verification?.effectTime).toBeNull();
  });

  it('the PRODUCTION caller passes the oracle\'s instant through untouched (source-pinned)', () => {
    const src = readFileSync(join(__dirname, 'e2e', 's16VerifyRun.ts'), 'utf8');
    expect(src).toContain('effectTime: result.observedEffectAt');
    // It must NOT re-clock: no `new Date()` on the effectTime line.
    expect(src).not.toMatch(/effectTime:\s*new Date\(/);
  });
});
