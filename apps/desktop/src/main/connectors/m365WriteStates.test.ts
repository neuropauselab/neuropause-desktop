import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AccountSyncState } from '../unified/sync/syncStateStore';
import { deriveWriteStates } from './m365WriteStates';
import type { ActionRecord } from './actionRecord';

vi.mock('electron', () => ({ app: { getPath: () => '/tmp' } }));

// A minimal ActionRecord fixture (the S34a source of truth).
const rec = (over: Partial<ActionRecord> = {}): ActionRecord => ({
  id: `act_${Math.abs(hash(over.transitionId ?? 't'))}`,
  at: over.at ?? '2026-08-18T12:00:00.000Z',
  requestId: over.requestId ?? 'req:1',
  transitionId: over.transitionId ?? 'm365-send:1',
  actor: over.actor ?? 'user-owner',
  tenantId: over.tenantId ?? 'tenant-A',
  connectorId: 'microsoft-entra',
  accountId: 'acct-1',
  actionId: over.actionId ?? 'mail.send',
  recipients: { to: ['bob@example.com'], cc: [], bcc: [] },
  subjectFingerprint: 'abc',
  bodyFingerprint: 'def',
  verdict: over.verdict ?? 'ALLOW',
  executed: over.executed ?? true,
  outcome: over.outcome ?? 'ACKNOWLEDGED',
  admissionRef: over.transitionId ?? 'm365-send:1',
  verification: over.verification ?? null,
});
function hash(s: string): number { let h = 0; for (const c of s) h = (h * 31 + c.charCodeAt(0)) | 0; return h; }

describe('S19 · deriveWriteStates (five states, one source of truth)', () => {
  it('an ACKNOWLEDGED send counts through the funnel; externally-observed stays 0 until verification', () => {
    const s = deriveWriteStates([rec({ transitionId: 't1', outcome: 'ACKNOWLEDGED', verdict: 'ALLOW', executed: true })]);
    expect(s).toMatchObject({ requested: 1, authorized: 1, executed: 1, providerAcknowledged: 1, externallyObserved: 0 });
    expect(s.lastAt).toBe('2026-08-18T12:00:00.000Z');
  });

  it('externally-observed counts ONLY on a VERIFIED_SUCCESS verification terminal', () => {
    const verified = rec({ transitionId: 't2', verification: { terminal: 'VERIFIED_SUCCESS', internetMessageId: '<a@h>', at: 'x' } });
    const failed = rec({ transitionId: 't3', verification: { terminal: 'VERIFIED_FAILED', internetMessageId: null, at: 'x' } });
    expect(deriveWriteStates([verified]).externallyObserved).toBe(1);
    expect(deriveWriteStates([failed]).externallyObserved).toBe(0); // a failed verification is never "observed success"
  });

  it('the states NEST — a DENIED send is requested but not authorized/executed/acknowledged', () => {
    const s = deriveWriteStates([rec({ transitionId: 't4', verdict: 'DENY', executed: false, outcome: 'DENIED' })]);
    expect(s).toMatchObject({ requested: 1, authorized: 0, executed: 0, providerAcknowledged: 0, externallyObserved: 0 });
  });

  it('lastAt is the most recent record time', () => {
    const s = deriveWriteStates([
      rec({ transitionId: 'a', at: '2026-08-18T10:00:00.000Z' }),
      rec({ transitionId: 'b', at: '2026-08-18T14:00:00.000Z' }),
      rec({ transitionId: 'c', at: '2026-08-18T12:00:00.000Z' }),
    ]);
    expect(s.lastAt).toBe('2026-08-18T14:00:00.000Z');
  });
});

describe('S19 · F-5 REGRESSION — an ACKNOWLEDGED governed send that bypassed the executor', () => {
  it('the OLD sync-snapshot counter reads 0 / never (the bug), because the governed send never called recordRun', () => {
    // A governed mail.send returns via mapSendOutcome and never touches SyncStateStore,
    // so the account's write metrics stay UNSET. This is exactly the projection the panel
    // renders (M365WritePanel: `writeCount ?? 0` and `lastWriteAt ? … : 'never'`).
    const s = {} as AccountSyncState; // no recordRun ever ran for a governed send
    expect(s.writeCount ?? 0).toBe(0); // "Writes" → 0
    expect(s.lastWriteAt ?? null).toBeNull(); // "Last write" → never
  });

  it('the NEW five-state reader counts the SAME acknowledged send TRUTHFULLY (derived from the record it wrote)', () => {
    // The governed send DID write an ActionRecord (FG-5 observer). Derive from that source of truth.
    const s = deriveWriteStates([rec({ transitionId: 'm365-send:s15', outcome: 'ACKNOWLEDGED', verdict: 'ALLOW', executed: true })]);
    expect(s.requested).toBe(1);
    expect(s.authorized).toBe(1);
    expect(s.executed).toBe(1);
    expect(s.providerAcknowledged).toBe(1);
    // Honest: not externally-observed until S16 feeds recordVerification.
    expect(s.externallyObserved).toBe(0);
  });
});

describe('S19 · store-backed reader — every number derives from the ActionRecord store', () => {
  let dir: string;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'np-m365-writes-')); });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('m365WriteStates reads the tenant\'s records and derives the five states, tenant-isolated', async () => {
    const { actionRecord } = await import('./actionRecord');
    const { m365WriteStates } = await import('./m365WriteStates');
    actionRecord.useDirForTests(dir);
    const gsr = (o: { semanticOutcome: string; verdict: string; executed: boolean; transitionId: string }) =>
      ({ outcome: { transitionId: o.transitionId, requestId: `req:${o.transitionId}`, verdict: o.verdict, executed: o.executed }, semanticOutcome: o.semanticOutcome, effectCalls: 1, providerAck: true }) as never;
    const req = () => ({ connectorId: 'microsoft-entra', accountId: 'a', actionId: 'mail.send', params: { to: ['x@e.com'], subject: 's', body: 'b' } });
    await actionRecord.observe(req(), gsr({ semanticOutcome: 'ACKNOWLEDGED', verdict: 'ALLOW', executed: true, transitionId: 't-a' }), { actor: 'user-owner', tenantId: 'tenant-A' });
    await actionRecord.observe(req(), gsr({ semanticOutcome: 'DENIED', verdict: 'DENY', executed: false, transitionId: 't-d' }), { actor: 'user-owner', tenantId: 'tenant-A' });
    await actionRecord.observe(req(), gsr({ semanticOutcome: 'ACKNOWLEDGED', verdict: 'ALLOW', executed: true, transitionId: 't-b' }), { actor: 'spy', tenantId: 'tenant-B' });

    const a = await m365WriteStates('tenant-A');
    expect(a).toMatchObject({ requested: 2, authorized: 1, executed: 1, providerAcknowledged: 1, externallyObserved: 0 });
    // Tenant isolation — B's acknowledged send never counts for A.
    const b = await m365WriteStates('tenant-B');
    expect(b).toMatchObject({ requested: 1, providerAcknowledged: 1 });
  });
});
