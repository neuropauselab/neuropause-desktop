import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { GovernedSendResult } from '../cst/sendTransition';

vi.mock('electron', () => ({ app: { getPath: () => '/tmp' } }));

import { actionRecord, type ActionRecord } from './actionRecord';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'np-action-record-'));
  actionRecord.useDirForTests(dir);
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

// A GovernedSendResult fixture — observe reads outcome fields defensively.
const gsr = (over: {
  semanticOutcome?: string;
  verdict?: string;
  executed?: boolean;
  transitionId?: string;
  requestId?: string;
}): GovernedSendResult =>
  ({
    outcome: {
      transitionId: over.transitionId ?? 'm365-send:abc',
      requestId: over.requestId ?? 'req:abc:1',
      verdict: over.verdict ?? 'ALLOW',
      executed: over.executed ?? true,
    },
    semanticOutcome: over.semanticOutcome ?? 'ACKNOWLEDGED',
    effectCalls: 1,
    providerAck: true,
  }) as unknown as GovernedSendResult;

const req = (over: Partial<{ to: unknown; cc: unknown; bcc: unknown; subject: string; body: string }> = {}) => ({
  connectorId: 'conn-1',
  accountId: 'acct-1',
  actionId: 'mail.send',
  params: { to: over.to ?? ['bob@example.com'], cc: over.cc, bcc: over.bcc, subject: over.subject ?? 'Q3', body: over.body ?? 'numbers' },
});

const ctx = (over: Partial<{ actor: string; tenantId: string }> = {}) => ({ actor: over.actor ?? 'user-owner', tenantId: over.tenantId ?? 'tenant-A' });

describe('S34a · action record — observer contract (condition 1)', () => {
  it('T-1 · never throws / never blocks even when persistence fails (evidence gap logged)', async () => {
    actionRecord.useDirForTests('/nonexistent/np-should-not-exist/deep');
    // Must resolve, not reject — the send is never affected by an emit failure.
    await expect(actionRecord.observe(req(), gsr({}), ctx())).resolves.toBeUndefined();
  });
});

describe('S34a · action record — terminal coverage (condition 2)', () => {
  it('T-2 · every governed terminal yields a record with the right outcome/verdict/executed', async () => {
    const terminals: { semanticOutcome: string; verdict: string; executed: boolean; transitionId: string }[] = [
      { semanticOutcome: 'ACKNOWLEDGED', verdict: 'ALLOW', executed: true, transitionId: 't-ack' },
      { semanticOutcome: 'DENIED', verdict: 'DENY', executed: false, transitionId: 't-deny' },
      { semanticOutcome: 'HOLD', verdict: 'HOLD', executed: false, transitionId: 't-hold' },
      { semanticOutcome: 'ESCALATE', verdict: 'ESCALATE', executed: false, transitionId: 't-esc' },
      { semanticOutcome: 'EXECUTION_FAILED', verdict: 'ALLOW', executed: true, transitionId: 't-fail' },
      { semanticOutcome: 'UNKNOWN', verdict: 'ALLOW', executed: true, transitionId: 't-unk' },
    ];
    for (const t of terminals) await actionRecord.observe(req(), gsr(t), ctx());
    const all = await actionRecord.query({ tenantId: 'tenant-A' });
    expect(all).toHaveLength(terminals.length);
    for (const t of terminals) {
      const rec = all.find((r) => r.transitionId === t.transitionId) as ActionRecord;
      expect(rec.outcome).toBe(t.semanticOutcome);
      expect(rec.verdict).toBe(t.verdict);
      expect(rec.executed).toBe(t.executed);
    }
  });
});

describe('S34a · action record — no content copy + actor verbatim (condition 3)', () => {
  it('T-3 · stores fingerprints (not subject/body), a local: actor verbatim, and an admission reference', async () => {
    await actionRecord.observe(
      req({ subject: 'Secret Q3 merger plan', body: 'strictly confidential deal terms' }),
      gsr({ transitionId: 'm365-send:xyz' }),
      ctx({ actor: 'local:9f3c-device' }),
    );
    const [rec] = await actionRecord.query({ tenantId: 'tenant-A' });
    // The record has fingerprints, NOT the content.
    expect(rec.subjectFingerprint).toMatch(/^[0-9a-f]{16}$/);
    expect(rec.subjectFingerprint).not.toContain('merger');
    expect(rec.admissionRef).toBe('m365-send:xyz');
    // The local: actor is stored VERBATIM, never stripped (D-12).
    expect(rec.actor).toBe('local:9f3c-device');
    // The PERSISTED file contains no copy of the subject/body text.
    const raw = readFileSync(join(dir, 'action-records.json'), 'utf8');
    expect(raw).not.toContain('Secret Q3 merger plan');
    expect(raw).not.toContain('strictly confidential deal terms');
  });
});

describe('S34a · action record — verification + query', () => {
  it('T-4 · a verification terminal attaches to the same record by transitionId', async () => {
    await actionRecord.observe(req(), gsr({ transitionId: 't-verify' }), ctx());
    await actionRecord.recordVerification('tenant-A', 't-verify', { terminal: 'VERIFIED_SUCCESS', internetMessageId: '<id@host>', at: '2026-08-18T13:25:54Z' });
    const [rec] = await actionRecord.query({ tenantId: 'tenant-A', transitionId: 't-verify' });
    expect(rec.verification?.terminal).toBe('VERIFIED_SUCCESS');
    expect(rec.verification?.internetMessageId).toBe('<id@host>');
  });

  it('answers "what happened to the email I sent?" by recipient — tenant-isolated', async () => {
    await actionRecord.observe(req({ to: ['alice@example.com'] }), gsr({ transitionId: 't-A' }), ctx({ tenantId: 'tenant-A' }));
    await actionRecord.observe(req({ to: ['spy@other.com'] }), gsr({ transitionId: 't-B' }), ctx({ tenantId: 'tenant-B' }));
    const forAlice = await actionRecord.query({ tenantId: 'tenant-A', recipient: 'alice@example.com' });
    expect(forAlice).toHaveLength(1);
    expect(forAlice[0].outcome).toBe('ACKNOWLEDGED');
    // Cross-tenant read is impossible — tenant-A's query never sees tenant-B's record.
    expect(await actionRecord.query({ tenantId: 'tenant-A', recipient: 'spy@other.com' })).toHaveLength(0);
    expect(existsSync(join(dir, 'action-records.json'))).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// S34a CLOSING PROOF — the eight + query proof + observer invariant
// ─────────────────────────────────────────────────────────────────────────────
describe('S34a · CLOSING PROOF', () => {
  it('1 · NORMAL — a governed send produces a record with the correct requestId/transitionId chain', async () => {
    await actionRecord.observe(req(), gsr({ transitionId: 'm365-send:norm', requestId: 'req:norm:7' }), ctx());
    const [rec] = await actionRecord.query({ tenantId: 'tenant-A', transitionId: 'm365-send:norm' });
    expect(rec.requestId).toBe('req:norm:7');
    expect(rec.transitionId).toBe('m365-send:norm');
    expect(rec.admissionRef).toBe('m365-send:norm'); // the reference IS the transition
  });

  it('2 · OBSERVER FAILURE — the handler pattern (void observe().catch) never changes the send result', async () => {
    // Mirror the frozen call site: void observe(...).catch(); return result;
    let sendResult = 'ACKNOWLEDGED';
    actionRecord.useDirForTests('/nonexistent/np/deep'); // force a persist failure
    void actionRecord.observe(req(), gsr({}), ctx()).catch(() => {
      sendResult = 'CORRUPTED';
    });
    // synchronous continuation — the send's result is returned regardless of the emit
    expect(sendResult).toBe('ACKNOWLEDGED');
    await new Promise((r) => setTimeout(r, 5)); // let the emit settle
    expect(sendResult).toBe('ACKNOWLEDGED'); // emit failure logged a gap, never touched the result
  });

  it('3 · EVERY TERMINAL exercised — incl. VERIFIED_SUCCESS and VERIFIED_FAILED, never a false success', async () => {
    await actionRecord.observe(req(), gsr({ transitionId: 't-vs' }), ctx());
    await actionRecord.recordVerification('tenant-A', 't-vs', { terminal: 'VERIFIED_SUCCESS', internetMessageId: '<a@h>', at: '2026-08-18T13:00:00Z' });
    await actionRecord.observe(req(), gsr({ transitionId: 't-vf' }), ctx());
    await actionRecord.recordVerification('tenant-A', 't-vf', { terminal: 'VERIFIED_FAILED', internetMessageId: null, at: '2026-08-18T13:00:00Z' });
    const vs = (await actionRecord.query({ tenantId: 'tenant-A', transitionId: 't-vs' }))[0];
    const vf = (await actionRecord.query({ tenantId: 'tenant-A', transitionId: 't-vf' }))[0];
    expect(vs.verification?.terminal).toBe('VERIFIED_SUCCESS');
    expect(vf.verification?.terminal).toBe('VERIFIED_FAILED');
    // UNKNOWN never auto-promotes: an observed UNKNOWN outcome stays UNKNOWN with no verification.
    await actionRecord.observe(req(), gsr({ semanticOutcome: 'UNKNOWN', transitionId: 't-u2' }), ctx());
    expect((await actionRecord.query({ tenantId: 'tenant-A', transitionId: 't-u2' }))[0].verification).toBeNull();
  });

  it('3b · NO_ACTOR terminal — a null actor is recorded as DENIED with an empty actor, never a false success', async () => {
    // governedSend with a null actor DENIES; the record captures actor='' + outcome DENIED.
    await actionRecord.observe(req(), gsr({ semanticOutcome: 'DENIED', verdict: 'DENY', executed: false, transitionId: 't-noactor' }), ctx({ actor: '' }));
    const [rec] = await actionRecord.query({ tenantId: 'tenant-A', transitionId: 't-noactor' });
    expect(rec.actor).toBe('');
    expect(rec.outcome).toBe('DENIED');
    expect(rec.executed).toBe(false);
  });

  it('4 · VERIFICATION ATTACHMENT — attaches to the EXISTING record; an unknown transition creates NO new record', async () => {
    await actionRecord.observe(req(), gsr({ transitionId: 't-exist' }), ctx());
    const before = (await actionRecord.query({ tenantId: 'tenant-A' })).length;
    await actionRecord.recordVerification('tenant-A', 't-DOES-NOT-EXIST', { terminal: 'VERIFIED_SUCCESS', internetMessageId: null, at: 'x' });
    const after = await actionRecord.query({ tenantId: 'tenant-A' });
    expect(after).toHaveLength(before); // no phantom record was created
  });

  it('7 · LOCAL ACTOR INTEGRITY — local:<id> persists as the exact string through store AND query', async () => {
    await actionRecord.observe(req(), gsr({ transitionId: 't-local' }), ctx({ actor: 'local:9f3c-abc-def' }));
    const [rec] = await actionRecord.query({ tenantId: 'tenant-A', transitionId: 't-local' });
    expect(rec.actor).toBe('local:9f3c-abc-def'); // no prefix stripping, no normalization
  });

  it('QUERY PROOF — the full chain is answerable from the store alone (no raw logs)', async () => {
    await actionRecord.observe(
      req({ to: ['dest@example.com'], subject: 'Q3 board update' }),
      gsr({ transitionId: 'm365-send:full', requestId: 'req:full:9', verdict: 'ALLOW', executed: true, semanticOutcome: 'ACKNOWLEDGED' }),
      ctx({ actor: 'user-owner', tenantId: 'tenant-A' }),
    );
    await actionRecord.recordVerification('tenant-A', 'm365-send:full', { terminal: 'VERIFIED_SUCCESS', internetMessageId: '<pn2@host>', at: '2026-08-18T13:25:54Z' });
    const [rec] = await actionRecord.query({ tenantId: 'tenant-A', recipient: 'dest@example.com' });
    // request → actor → tenant → connector/account → verdict → outcome → 202 → verification → evidence ref
    expect(rec.requestId).toBe('req:full:9');
    expect(rec.actor).toBe('user-owner');
    expect(rec.tenantId).toBe('tenant-A');
    expect(rec.connectorId).toBe('conn-1');
    expect(rec.accountId).toBe('acct-1');
    expect(rec.actionId).toBe('mail.send');
    expect(rec.verdict).toBe('ALLOW');
    expect(rec.executed).toBe(true);
    expect(rec.outcome).toBe('ACKNOWLEDGED');
    expect(rec.verification?.terminal).toBe('VERIFIED_SUCCESS');
    expect(rec.verification?.internetMessageId).toBe('<pn2@host>');
    expect(rec.admissionRef).toBe('m365-send:full');
  });

  it('INVARIANT — the record layer is an OBSERVER: no value-import back into governance/execution', () => {
    const src = readFileSync(join(__dirname, 'actionRecord.ts'), 'utf8');
    // The only cst reference is a TYPE import (erased at runtime); no value import from governance/execution.
    const valueImports = src.match(/^import\s+(?!type\b)[^;]*from\s+'[^']*'/gm) ?? [];
    for (const line of valueImports) {
      expect(line).not.toMatch(/cst\/|governance|executor|governedSend|governedAction|boundDecisionClaim|CstKernel/);
    }
    // The cst import that DOES exist is type-only.
    expect(src).toMatch(/import type \{ GovernedSendResult \} from '\.\.\/cst\/sendTransition'/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// NP-FG-001 · M6 — confirmedAt: the confirmation instant is EVIDENCE ONLY.
// Captured at the human's qualifying "Confirm send" gesture, carried verbatim
// request → record → disk; absent means ABSENT (a recorded gap, never "now",
// never "", never back-filled from any neighbouring time or the clock here).
// ─────────────────────────────────────────────────────────────────────────────
describe('NP-FG-001 · M6 — confirmedAt (T1-T10)', () => {
  /** The panel-shaped execute request with a confirmation instant attached. */
  const reqWithConfirmedAt = (confirmedAt?: string) => ({
    ...req(),
    ...(confirmedAt === undefined ? {} : { confirmedAt }),
  });

  /** A full, contract-valid execute payload (real ids the schema accepts). */
  const validPayload = (over: Record<string, unknown> = {}) => ({
    connectorId: 'microsoft-entra',
    accountId: 'acct-1',
    actionId: 'mail.send',
    params: { to: ['bob@example.com'], subject: 'Q3', body: 'numbers' },
    confirmed: true,
    ...over,
  });

  /** Raw persisted row by transitionId — the disk, not our in-memory object. */
  const rawRow = (transitionId: string): Record<string, unknown> => {
    const raw = JSON.parse(readFileSync(join(dir, 'action-records.json'), 'utf8'));
    return raw.records.find((r: { transitionId: string }) => r.transitionId === transitionId);
  };

  it('T1 · a valid timestamp is retained exactly — in the query result AND in the raw persisted file', async () => {
    const stamp = '2026-09-03T21:07:11.000Z';
    await actionRecord.observe(reqWithConfirmedAt(stamp), gsr({ transitionId: 't-m6-t1' }), ctx());
    const [rec] = await actionRecord.query({ tenantId: 'tenant-A', transitionId: 't-m6-t1' });
    // VALUE equality through the real query path…
    expect(rec.confirmedAt).toBe(stamp);
    // …and byte-for-byte on disk, read raw rather than trusting memory.
    expect(rawRow('t-m6-t1').confirmedAt).toBe(stamp);
  });

  it('T2 · an absent timestamp remains absent — the key is genuinely missing on disk, not "" / null', async () => {
    await actionRecord.observe(req(), gsr({ transitionId: 't-m6-t2' }), ctx());
    const [rec] = await actionRecord.query({ tenantId: 'tenant-A', transitionId: 't-m6-t2' });
    expect(rec.confirmedAt).toBeUndefined();
    const row = rawRow('t-m6-t2');
    expect('confirmedAt' in row).toBe(false); // ABSENT, not present-as-empty
    expect(row.confirmedAt).not.toBe('');
    expect(row.confirmedAt).not.toBeNull();
  });

  it('T3 · malformed input becomes absent THROUGH THE REAL CONTRACT PATH (soft-fail, parse still succeeds)', async () => {
    const { M365ActionExecuteRequest } = await import('@neuropause/shared');
    // A malformed instant must not reject the whole send — it soft-fails to undefined.
    const prose = M365ActionExecuteRequest.safeParse(validPayload({ confirmedAt: 'five minutes ago' }));
    expect(prose.success).toBe(true);
    if (prose.success) expect(prose.data.confirmedAt).toBeUndefined();
    const numeric = M365ActionExecuteRequest.safeParse(validPayload({ confirmedAt: 12345 }));
    expect(numeric.success).toBe(true);
    if (numeric.success) expect(numeric.data.confirmedAt).toBeUndefined();
    // And a request arriving WITHOUT the field (what the soft-fail hands onward) stores absence.
    await actionRecord.observe(req(), gsr({ transitionId: 't-m6-t3' }), ctx());
    expect('confirmedAt' in rawRow('t-m6-t3')).toBe(false);
  });

  it('T4 · an empty-string input becomes absent — contract soft-fails "" AND the store drops a direct ""', async () => {
    const { M365ActionExecuteRequest } = await import('@neuropause/shared');
    // The contract soft-fails '' to undefined ('' is not a datetime).
    const r = M365ActionExecuteRequest.safeParse(validPayload({ confirmedAt: '' }));
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.confirmedAt).toBeUndefined();
    // Defense in depth: a '' supplied DIRECTLY to the store still becomes key-absence.
    await actionRecord.observe(reqWithConfirmedAt(''), gsr({ transitionId: 't-m6-t4' }), ctx());
    const [rec] = await actionRecord.query({ tenantId: 'tenant-A', transitionId: 't-m6-t4' });
    expect(rec.confirmedAt).toBeUndefined();
    expect('confirmedAt' in rawRow('t-m6-t4')).toBe(false);
  });

  it('T5 · `confirmed` (the consent boolean) remains independent — a refusal stores honestly with no confirmedAt, and nothing gates on it', async () => {
    // A DENY row with no confirmation instant is still recorded exactly as a DENY.
    await actionRecord.observe(
      req(),
      gsr({ semanticOutcome: 'DENIED', verdict: 'DENY', executed: false, transitionId: 't-m6-t5' }),
      ctx(),
    );
    const [deny] = await actionRecord.query({ tenantId: 'tenant-A', transitionId: 't-m6-t5' });
    expect(deny.verdict).toBe('DENY');
    expect(deny.executed).toBe(false);
    expect(deny.outcome).toBe('DENIED');
    expect(deny.confirmedAt).toBeUndefined();
    // And a confirmedAt PRESENT on a refusal changes nothing about the verdict chain.
    await actionRecord.observe(
      reqWithConfirmedAt('2026-09-03T21:00:00Z'),
      gsr({ semanticOutcome: 'DENIED', verdict: 'DENY', executed: false, transitionId: 't-m6-t5b' }),
      ctx(),
    );
    const [denyStamped] = await actionRecord.query({ tenantId: 'tenant-A', transitionId: 't-m6-t5b' });
    expect(denyStamped.verdict).toBe('DENY');
    expect(denyStamped.executed).toBe(false);
    expect(denyStamped.outcome).toBe('DENIED');
    // Structural: nothing in the store reads confirmedAt for gating — outside the ActionRecord
    // construction spread and the interface docs, no decision path mentions it (same source-scan
    // idiom as the OBSERVER invariant above).
    const src = readFileSync(join(__dirname, 'actionRecord.ts'), 'utf8');
    const queryMethod = src.slice(src.indexOf('async query('));
    expect(queryMethod).not.toContain('confirmedAt');
    const verification = src.slice(src.indexOf('async recordVerification('), src.indexOf('async query('));
    expect(verification).not.toContain('confirmedAt');
  });

  it('T6 · confirmed=true with no timestamp remains valid — parse succeeds, observe succeeds, record has no confirmedAt', async () => {
    const { M365ActionExecuteRequest } = await import('@neuropause/shared');
    const parsed = M365ActionExecuteRequest.safeParse(validPayload()); // confirmed: true, no confirmedAt
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.confirmed).toBe(true);
      expect(parsed.data.confirmedAt).toBeUndefined();
    }
    await expect(actionRecord.observe(req(), gsr({ transitionId: 't-m6-t6' }), ctx())).resolves.toBeUndefined();
    const [rec] = await actionRecord.query({ tenantId: 'tenant-A', transitionId: 't-m6-t6' });
    expect(rec.executed).toBe(true); // the send is intact…
    expect(rec.confirmedAt).toBeUndefined(); // …and the missing instant is a recorded gap.
    expect('confirmedAt' in rawRow('t-m6-t6')).toBe(false);
  });

  it('T7 · confirmed=true plus timestamp preserves BOTH independently — every pre-existing column is exactly what it was', async () => {
    const stamp = '2026-09-03T21:30:00Z';
    const outcome = { requestId: 'req:M6IDEM:1787228221628', verdict: 'ALLOW', executed: true, semanticOutcome: 'ACKNOWLEDGED' };
    await actionRecord.observe(req(), gsr({ ...outcome, transitionId: 't-m6-t7-base' }), ctx());
    await actionRecord.observe(reqWithConfirmedAt(stamp), gsr({ ...outcome, transitionId: 't-m6-t7' }), ctx());
    const [base] = await actionRecord.query({ tenantId: 'tenant-A', transitionId: 't-m6-t7-base' });
    const [rec] = await actionRecord.query({ tenantId: 'tenant-A', transitionId: 't-m6-t7' });
    // The instant is carried…
    expect(rec.confirmedAt).toBe(stamp);
    // …while the verdict chain is untouched by its presence.
    expect(rec.verdict).toBe('ALLOW');
    expect(rec.executed).toBe(true);
    expect(rec.outcome).toBe('ACKNOWLEDGED');
    // Column-for-column: the ONLY key the stamped record adds over the identical
    // unstamped one is confirmedAt (id/at/transitionId/admissionRef necessarily differ per row).
    const perRow = new Set(['id', 'at', 'transitionId', 'admissionRef', 'confirmedAt']);
    const added = Object.keys(rec).filter((k) => !(k in base));
    expect(added).toEqual(['confirmedAt']);
    for (const k of Object.keys(base).filter((k) => !perRow.has(k))) {
      expect((rec as unknown as Record<string, unknown>)[k]).toEqual((base as unknown as Record<string, unknown>)[k]);
    }
  });

  it('T8 · no synthetic timestamp is EVER generated — structurally and behaviorally', async () => {
    // Structural pin (this file's own source-scan idiom): the confirmedAt spread in
    // actionRecord.ts contains no clock read — no Date.now(), no new Date().
    const src = readFileSync(join(__dirname, 'actionRecord.ts'), 'utf8');
    const spread = /\.\.\.\(typeof request\.confirmedAt === 'string' && request\.confirmedAt\.length > 0\s*\?\s*\{ confirmedAt: request\.confirmedAt \}\s*:\s*\{\}\)/.exec(src);
    expect(spread).not.toBeNull();
    expect(spread?.[0]).not.toMatch(/Date\.now|new Date/);
    // Behavioral: absent in, absent out — even when at/requestTime/eventTime are ALL populated,
    // none of them leaks into confirmedAt.
    await actionRecord.observe(
      req(),
      gsr({ transitionId: 't-m6-t8', requestId: 'req:M6IDEM:1787228221628' }), // epoch stamp ⇒ requestTime populated
      { ...ctx(), eventTime: '2026-09-03T20:00:00Z' },
    );
    const [rec] = await actionRecord.query({ tenantId: 'tenant-A', transitionId: 't-m6-t8' });
    expect(rec.at).toBeTruthy();
    expect(rec.requestTime).toBe('2026-08-20T12:17:01.628Z'); // read from the kernel's epoch stamp
    expect(rec.eventTime).toBe('2026-09-03T20:00:00Z');
    expect(rec.confirmedAt).toBeUndefined();
    expect('confirmedAt' in rawRow('t-m6-t8')).toBe(false);
  });

  it('T9 · an offset-bearing timestamp remains exact — parse → observe → disk re-read, byte-identical', async () => {
    const stamp = '2026-09-03T22:46:00+05:30';
    const { M365ActionExecuteRequest } = await import('@neuropause/shared');
    // The real contract accepts the offset form and preserves it verbatim.
    const parsed = M365ActionExecuteRequest.safeParse(validPayload({ confirmedAt: stamp }));
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(parsed.data.confirmedAt).toBe(stamp);
    // Carry the PARSED value onward, exactly as the handler would.
    await actionRecord.observe(reqWithConfirmedAt(parsed.data.confirmedAt), gsr({ transitionId: 't-m6-t9' }), ctx());
    // Force a genuine re-read from disk rather than trusting the in-memory cache.
    actionRecord.useDirForTests(dir);
    const [rec] = await actionRecord.query({ tenantId: 'tenant-A', transitionId: 't-m6-t9' });
    expect(rec.confirmedAt).toBe(stamp); // never normalized to Z, never re-rendered
    expect(rawRow('t-m6-t9').confirmedAt).toBe(stamp);
    expect(readFileSync(join(dir, 'action-records.json'), 'utf8')).toContain('"2026-09-03T22:46:00+05:30"');
  });

  it('T10 · legacy calls without confirmedAt remain compatible — a pre-M6-shaped request flows through unchanged', async () => {
    // Exactly the object shape every pre-M6 caller sent: no confirmedAt key, no correlationId key.
    const legacy = {
      connectorId: 'conn-1',
      accountId: 'acct-1',
      actionId: 'mail.send',
      params: { to: ['bob@example.com'], subject: 'Q3', body: 'numbers' },
    };
    await expect(actionRecord.observe(legacy, gsr({ transitionId: 't-m6-t10' }), ctx())).resolves.toBeUndefined();
    const [rec] = await actionRecord.query({ tenantId: 'tenant-A', transitionId: 't-m6-t10' });
    // The chain records exactly as it always did…
    expect(rec.connectorId).toBe('conn-1');
    expect(rec.accountId).toBe('acct-1');
    expect(rec.actionId).toBe('mail.send');
    expect(rec.recipients.to).toEqual(['bob@example.com']);
    expect(rec.outcome).toBe('ACKNOWLEDGED');
    // …and no M6 field was invented for it.
    expect('confirmedAt' in rawRow('t-m6-t10')).toBe(false);
    // The pre-M6 CONTRACT caller parses unchanged too.
    const { M365ActionExecuteRequest } = await import('@neuropause/shared');
    expect(() =>
      M365ActionExecuteRequest.parse({ connectorId: 'microsoft-entra', accountId: 'a', actionId: 'mail.send' }),
    ).not.toThrow();
  });
});
