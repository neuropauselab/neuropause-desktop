/**
 * NeuroPause OS — Worker OUTCOME_UNKNOWN → durable hold (frozen gate).
 *
 * The worker/M365 executor now PRESERVES a NetworkError as UNKNOWN (transmitted, response lost) instead of
 * collapsing it into a generic failure, so the governed worker path can raise a durable, decisionId-correlated
 * reconciliation hold. Pins: NetworkError → `data.outcome:'UNKNOWN'` (ok:false, never success); HttpError stays a
 * plain failure; success stays ACKNOWLEDGED (ok:true) only; the raised hold carries the decisionId (correlating it
 * to the ExecutionSession) and dedupes; resolution executes nothing.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { M365Executor } from '../connectors/m365/executor';
import type { WriteAction } from '../connectors/m365/actionSdk';
import { NetworkError, HttpError, type HttpClient, type RateGate } from '../unified/sync/http';
import { HoldStore } from './holdStore';
import { DecisionRecordStore } from './decisionService';
import { createHoldRaiser, type HoldRaiser } from './raiseHold';
import { buildM365UnknownHoldInput } from './m365UnknownHold';
import { TEST_TENANT_SCOPE } from '../tenancy/testScope';

// ── Part A — the executor now surfaces UNKNOWN instead of collapsing it ───────
function executorWith(run: WriteAction['run']): M365Executor {
  const action: WriteAction = { id: 'mail.reply', label: 'Reply', domain: 'mail', scopes: ['Mail.Send'], mutates: true, run };
  const health = {
    get: () => ({}),
    recordRun: async () => undefined,
  } as unknown as ConstructorParameters<typeof M365Executor>[0]['health'];
  return new M365Executor(
    {
      getToken: async () => 'tok',
      publish: () => undefined,
      rate: {} as unknown as RateGate,
      recordActivity: () => undefined,
      health,
      manifestName: () => 'Microsoft 365',
      grantedScopes: () => ['Mail.Send'],
      ownsAccount: () => true,
      makeHttp: () => ({}) as unknown as HttpClient, // the stub run ignores http
    },
    [action],
  );
}
const CONN = 'microsoft-entra';
const ACCT = 'acct-1';

describe('M365Executor — NetworkError is preserved as UNKNOWN (not collapsed)', () => {
  it('NetworkError → ok:false with data.outcome UNKNOWN (never success)', async () => {
    const r = await executorWith(async () => { throw new NetworkError('aborted'); }).execute(CONN, ACCT, 'mail.reply', {}, true);
    expect(r.ok).toBe(false);
    expect(r.data?.outcome).toBe('UNKNOWN');
  });

  it('HttpError (definite provider rejection) stays a plain failure — no UNKNOWN', async () => {
    const r = await executorWith(async () => { throw new HttpError('409', 409); }).execute(CONN, ACCT, 'mail.reply', {}, true);
    expect(r.ok).toBe(false);
    expect(r.data?.outcome).toBeUndefined();
  });

  it('success stays ACKNOWLEDGED (ok:true) only — no UNKNOWN', async () => {
    const r = await executorWith(async () => ({ ok: true, summary: 'sent' })).execute(CONN, ACCT, 'mail.reply', {}, true);
    expect(r.ok).toBe(true);
    expect(r.data?.outcome).toBeUndefined();
  });
});

// ── Part B — the worker UNKNOWN hold correlates by decisionId ─────────────────
describe('worker UNKNOWN → durable hold, correlated by decisionId', () => {
  let dir: string;
  let holds: HoldStore;
  let decisions: DecisionRecordStore;
  let raise: HoldRaiser;
  const DECISION = 'req-abc';
  const ctx = () => ({
    tenantId: 'org-A',
    actor: null,
    connectorId: CONN,
    accountId: ACCT,
    actionId: 'mail.reply',
    subject: `m365-worker:${DECISION}`,
    label: 'Microsoft 365: mail.reply (worker)',
    decisionId: DECISION,
  });

  beforeEach(async () => {
    dir = join(tmpdir(), `np-wunk-${randomUUID()}`);
    await fs.mkdir(dir, { recursive: true });
    holds = new HoldStore(join(dir, 'h.json'));
    decisions = new DecisionRecordStore(join(dir, 'd.json'));
    holds.bindScope(() => TEST_TENANT_SCOPE);
    decisions.bindScope(() => TEST_TENANT_SCOPE);
    await Promise.all([holds.load(), decisions.load()]);
    raise = createHoldRaiser({ holds, decisions, actor: () => 'ada@example.com', audit: () => undefined });
  });
  afterEach(async () => {
    await Promise.all([holds.flush(), decisions.flush()]);
    await fs.rm(dir, { recursive: true, force: true }).catch(() => undefined);
  });

  it('raises one hold that carries the decisionId (correlates to the ExecutionSession) and the right reason', () => {
    const hold = raise(buildM365UnknownHoldInput(ctx()));
    expect(hold.reason).toBe('verification_unavailable');
    expect(hold.decisionId).toBe(DECISION); // ← ExecutionSession.decisionId ↔ HoldRecord.decisionId
    expect(hold.subject).toBe(`m365-worker:${DECISION}`);
    expect(hold.status).toBe('open');
    // The paired DecisionRecord links via holdId → completes ExecutionSession ↔ Hold ↔ DecisionRecord.
    expect(decisions.forSubject(hold.subject).some((r) => r.holdId === hold.id)).toBe(true);
  });

  it('the same UNKNOWN decision dedupes to one hold (no blind-retry pile-up)', () => {
    const a = raise(buildM365UnknownHoldInput(ctx()));
    const b = raise(buildM365UnknownHoldInput(ctx()));
    expect(b.id).toBe(a.id);
    expect(holds.list().filter((h) => h.status === 'open')).toHaveLength(1);
  });

  it('resolving the hold records the disposition and executes nothing', () => {
    const hold = raise(buildM365UnknownHoldInput(ctx()));
    const resolved = holds.resolve(hold.id, 'cancelled', 'Reconciled: no effect found at Graph.');
    expect(resolved?.status).toBe('resolved');
    expect(holds.list().filter((h) => h.status === 'open')).toHaveLength(0);
  });
});

// ── Part C — the builder threads decisionId only when present ─────────────────
describe('buildM365UnknownHoldInput — decisionId correlation is opt-in', () => {
  it('worker context (with decisionId) → output carries decisionId', () => {
    const input = buildM365UnknownHoldInput({ tenantId: 'org-A', actor: null, connectorId: CONN, accountId: ACCT, actionId: 'mail.reply', subject: 'm365-worker:x', label: 'w', decisionId: 'x' });
    expect(input.decisionId).toBe('x');
  });
  it('IPC context (no decisionId) → output has none (unchanged Increment-2A behavior)', () => {
    const input = buildM365UnknownHoldInput({ tenantId: 'org-A', actor: null, connectorId: CONN, accountId: ACCT, actionId: 'mail.send', subject: 'm365-send:y', label: 's' });
    expect(input.decisionId).toBeUndefined();
  });
});
