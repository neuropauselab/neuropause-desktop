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
    await actionRecord.recordVerification('t-verify', { terminal: 'VERIFIED_SUCCESS', internetMessageId: '<id@host>', at: '2026-08-18T13:25:54Z' });
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
    await actionRecord.recordVerification('t-vs', { terminal: 'VERIFIED_SUCCESS', internetMessageId: '<a@h>', at: '2026-08-18T13:00:00Z' });
    await actionRecord.observe(req(), gsr({ transitionId: 't-vf' }), ctx());
    await actionRecord.recordVerification('t-vf', { terminal: 'VERIFIED_FAILED', internetMessageId: null, at: '2026-08-18T13:00:00Z' });
    const vs = (await actionRecord.query({ tenantId: 'tenant-A', transitionId: 't-vs' }))[0];
    const vf = (await actionRecord.query({ tenantId: 'tenant-A', transitionId: 't-vf' }))[0];
    expect(vs.verification?.terminal).toBe('VERIFIED_SUCCESS');
    expect(vf.verification?.terminal).toBe('VERIFIED_FAILED');
    // UNKNOWN never auto-promotes: an observed UNKNOWN outcome stays UNKNOWN with no verification.
    await actionRecord.observe(req(), gsr({ semanticOutcome: 'UNKNOWN', transitionId: 't-u2' }), ctx());
    expect((await actionRecord.query({ tenantId: 'tenant-A', transitionId: 't-u2' }))[0].verification).toBeNull();
  });

  it('4 · VERIFICATION ATTACHMENT — attaches to the EXISTING record; an unknown transition creates NO new record', async () => {
    await actionRecord.observe(req(), gsr({ transitionId: 't-exist' }), ctx());
    const before = (await actionRecord.query({ tenantId: 'tenant-A' })).length;
    await actionRecord.recordVerification('t-DOES-NOT-EXIST', { terminal: 'VERIFIED_SUCCESS', internetMessageId: null, at: 'x' });
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
    await actionRecord.recordVerification('m365-send:full', { terminal: 'VERIFIED_SUCCESS', internetMessageId: '<pn2@host>', at: '2026-08-18T13:25:54Z' });
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
