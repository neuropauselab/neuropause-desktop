/**
 * SEAM-22 · SLICE 1 — pins for the independent read-back surface (§20–§21).
 *
 * §2 #17: pinned against the REAL path — every row is written through the real
 * `ActionRecordStore` API (observe / observeGovernance / recordVerification)
 * onto a real temp-dir file; nothing under test is mocked and no row shape is
 * hand-built more generously than production writes it.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { actionRecord } from '../connectors/actionRecord';
import type { GovernedSendResult } from '../cst/sendTransition';
import { readBack, reconstructReadBack } from './readBack';

const WS = 'ws-readback-a';
const OTHER_WS = 'ws-readback-b';

function freshDir(): string {
  return mkdtempSync(join(tmpdir(), 'np-readback-'));
}

/** A result shaped exactly as the observer reads one (semanticOutcome + outcome + FG-12 requestId). */
function sendResult(over: {
  transitionId: string;
  verdict?: string;
  executed?: boolean;
  semanticOutcome?: string;
  requestId?: string;
}): GovernedSendResult {
  return {
    ...(over.requestId !== undefined ? { requestId: over.requestId } : {}),
    semanticOutcome: over.semanticOutcome ?? 'ACKNOWLEDGED',
    outcome: {
      transitionId: over.transitionId,
      verdict: over.verdict ?? 'ALLOW',
      executed: over.executed ?? true,
    },
  } as unknown as GovernedSendResult;
}

function sendRequest(correlationId?: string) {
  return {
    connectorId: 'microsoft-entra',
    accountId: 'acct-1',
    actionId: 'mail.send',
    params: { to: 'to@example.com', subject: 'S', body: 'B' },
    ...(correlationId !== undefined ? { correlationId } : {}),
  };
}

describe('SEAM-22 · independent read-back (§20–§21)', () => {
  beforeEach(() => {
    actionRecord.useDirForTests(freshDir());
  });

  it('reconstructs the FULL chain to VERIFIED_SUCCESS from persisted evidence only', async () => {
    const requestId = 'req:idem-1:2026-08-23T10:00:00Z';
    await actionRecord.observe(sendRequest(), sendResult({ transitionId: 't-full', requestId }), {
      actor: 'local:abc',
      tenantId: WS,
    });
    await actionRecord.recordVerification(WS, 't-full', {
      terminal: 'VERIFIED_SUCCESS',
      internetMessageId: '<mid@example>',
      at: '2026-08-23T10:05:00Z',
      effectTime: '2026-08-23T10:00:04Z',
      provenance: { source: 'test', method: 'corroborated-match', oracle: 'm365ReadBack:sentItems+inbox' },
    });

    const report = await readBack(WS, { transitionId: 't-full' });
    expect(report.matches).toBe(1);
    const row = report.rows[0];
    expect(row.finalStatus).toBe('VERIFIED_SUCCESS');
    expect(row.states).toEqual({
      requested: true,
      authorized: true,
      executed: true,
      providerAcknowledged: true,
      externallyObserved: true,
    });
    // §14 timeline — verbatim from evidence, never re-clocked.
    expect(row.timeline.requestTime).toBe('2026-08-23T10:00:00Z'); // parsed from the kernel-minted requestId
    expect(row.timeline.verificationTime).toBe('2026-08-23T10:05:00Z');
    expect(row.timeline.effectTime).toBe('2026-08-23T10:00:04Z');
    expect(row.timeline.eventTime).toBeNull(); // NP-015: null on the production path, never fabricated
    expect(row.deviation).toBeNull();
    expect(row.actor).toBe('local:abc'); // verbatim, never stripped (D-12)
  });

  it('acknowledged-but-unverified is PROVIDER_ACKNOWLEDGED — submission is never verification (§2 #14)', async () => {
    await actionRecord.observe(sendRequest(), sendResult({ transitionId: 't-ack' }), { actor: 'a', tenantId: WS });
    const report = await readBack(WS, { transitionId: 't-ack' });
    expect(report.rows[0].finalStatus).toBe('PROVIDER_ACKNOWLEDGED');
    expect(report.rows[0].states.externallyObserved).toBe(false);
  });

  it('CATCHES A FALSE SUCCESS (§21): acknowledged outcome + failure verification ⇒ VERIFIED_FAILURE', async () => {
    await actionRecord.observe(sendRequest(), sendResult({ transitionId: 't-false' }), { actor: 'a', tenantId: WS });
    await actionRecord.recordVerification(WS, 't-false', {
      terminal: 'VERIFY_FAILED',
      internetMessageId: null,
      at: '2026-08-23T10:06:00Z',
      effectTime: null,
    });
    const row = (await readBack(WS, { transitionId: 't-false' })).rows[0];
    // The execute-path claim (ACKNOWLEDGED) is contradicted by independent evidence.
    expect(row.outcome).toBe('ACKNOWLEDGED');
    expect(row.finalStatus).toBe('VERIFIED_FAILURE');
    expect(row.deviation).toBe('VERIFY_FAILED');
  });

  it('a success-LOOKING outcome string is never trusted — classification goes only through the D-16 authority', async () => {
    await actionRecord.observe(
      sendRequest(),
      sendResult({ transitionId: 't-lookalike', semanticOutcome: 'VERIFIED_SUCCESS' }),
      { actor: 'a', tenantId: WS },
    );
    const row = (await readBack(WS, { transitionId: 't-lookalike' })).rows[0];
    // No verification object exists, so no success may be claimed regardless of the outcome string.
    expect(row.verification).toBeNull();
    expect(row.finalStatus).not.toBe('VERIFIED_SUCCESS');
    expect(row.states.externallyObserved).toBe(false);
  });

  it('a governance DENY row reads REFUSED with NO funnel rungs (Route A / §2 #19)', async () => {
    await actionRecord.observeGovernance(
      { connectorId: 'microsoft-entra', accountId: 'acct-1', actionId: 'mail.send', params: { to: 'x@y.z' } },
      'DENY',
      { actor: 'local:abc', tenantId: WS },
    );
    const report = await readBack(WS, { transitionId: '' }); // governance rows carry the established absent form
    expect(report.rows[0].finalStatus).toBe('REFUSED');
    expect(report.rows[0].states).toEqual({
      requested: false,
      authorized: false,
      executed: false,
      providerAcknowledged: false,
      externallyObserved: false,
    });
  });

  it('a recorded gate SKIP reads GATE_NOT_EVALUATED — a skip is not a refusal', async () => {
    await actionRecord.observeGovernance(
      { connectorId: 'microsoft-entra', accountId: 'acct-1', actionId: 'mail.send' },
      'NOT_EVALUATED',
      { actor: 'a', tenantId: WS },
    );
    const report = await readBack(WS, { transitionId: '' });
    expect(report.rows[0].finalStatus).toBe('GATE_NOT_EVALUATED');
  });

  it('UNKNOWN outcome stays UNKNOWN; an unresolved verification terminal stays UNKNOWN (§2 #9)', async () => {
    await actionRecord.observe(
      sendRequest(),
      sendResult({ transitionId: 't-unknown', semanticOutcome: 'UNKNOWN', executed: true }),
      { actor: 'a', tenantId: WS },
    );
    expect((await readBack(WS, { transitionId: 't-unknown' })).rows[0].finalStatus).toBe('UNKNOWN');

    await actionRecord.observe(sendRequest(), sendResult({ transitionId: 't-hold' }), { actor: 'a', tenantId: WS });
    await actionRecord.recordVerification(WS, 't-hold', {
      terminal: 'HOLD',
      internetMessageId: null,
      at: '2026-08-23T10:07:00Z',
      effectTime: null,
    });
    // Verification attempted and unresolved: never promoted past UNKNOWN, however confident the ack looked.
    expect((await readBack(WS, { transitionId: 't-hold' })).rows[0].finalStatus).toBe('UNKNOWN');
  });

  it('is tenant-scoped: another scope key sees zero rows', async () => {
    await actionRecord.observe(sendRequest(), sendResult({ transitionId: 't-iso' }), { actor: 'a', tenantId: WS });
    expect((await readBack(OTHER_WS, { transitionId: 't-iso' })).matches).toBe(0);
  });

  it('matches by FG-14 correlationId, verbatim', async () => {
    await actionRecord.observe(sendRequest('asst_epi-1'), sendResult({ transitionId: 't-c1' }), {
      actor: 'a',
      tenantId: WS,
    });
    await actionRecord.observe(sendRequest('asst_epi-2'), sendResult({ transitionId: 't-c2' }), {
      actor: 'a',
      tenantId: WS,
    });
    const report = await readBack(WS, { correlationId: 'asst_epi-1' });
    expect(report.matches).toBe(1);
    expect(report.rows[0].transitionId).toBe('t-c1');
  });

  it('refuses an empty ref — a listing is not a read-back (deny-by-default)', async () => {
    await actionRecord.observe(sendRequest(), sendResult({ transitionId: 't-any' }), { actor: 'a', tenantId: WS });
    expect((await readBack(WS, {})).matches).toBe(0);
  });

  it('is INDEPENDENT of in-process state: reconstructs from the persisted file after a memory reset (§21)', async () => {
    const dir = freshDir();
    actionRecord.useDirForTests(dir);
    await actionRecord.observe(sendRequest(), sendResult({ transitionId: 't-durable' }), { actor: 'a', tenantId: WS });
    await actionRecord.recordVerification(WS, 't-durable', {
      terminal: 'VERIFIED_SUCCESS',
      internetMessageId: '<m@x>',
      at: '2026-08-23T11:00:00Z',
      effectTime: null,
    });
    // Reset the in-memory cache; the next read must come from the persisted bytes.
    actionRecord.useDirForTests(dir);
    const report = await readBack(WS, { transitionId: 't-durable' });
    expect(report.matches).toBe(1);
    expect(report.rows[0].finalStatus).toBe('VERIFIED_SUCCESS');
  });

  it('states its evidence limits: the NOT_PERSISTED fields are named, never fabricated', async () => {
    const report = reconstructReadBack([], { requestId: 'r' });
    expect(report.notPersisted).toContain('relationship');
    expect(report.notPersisted).toContain('purpose');
    expect(report.notPersisted).toContain('policyVersion');
    expect(report.notPersisted.some((f) => f.startsWith('approval'))).toBe(true);
    expect(report.notPersisted.some((f) => f.startsWith('claim'))).toBe(true);
  });
});
