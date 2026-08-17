/**
 * NeuroPause OS — Wave 1 / Increment 2A. An AUTHORITATIVE M365 IPC OUTCOME_UNKNOWN becomes exactly one durable
 * hold through the EXISTING raiseHold/HoldStore seam — reason `verification_unavailable`, deduped by the CST
 * transition identity, evidence-only (no execution, no blind retry, no secrets). Pins the mapping, the real
 * store integration + dedup, and that only an UNKNOWN governed outcome (not ACKNOWLEDGED/DENIED) is the trigger.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { HoldStore } from './holdStore';
import { DecisionRecordStore } from './decisionService';
import { createHoldRaiser, type HoldRaiser } from './raiseHold';
import { buildM365UnknownHoldInput, type M365UnknownHoldContext } from './m365UnknownHold';
import {
  governedAction,
  createGovernedActionPorts,
  type GovernedActionArgs,
} from '../cst/governedAction';
import { NetworkError, type HttpClient, type RateGate } from '../unified/sync/http';
import { type WriteAction } from '../connectors/m365/actionSdk';
import { TEST_TENANT_SCOPE } from '../tenancy/testScope';

const CTX: M365UnknownHoldContext = {
  tenantId: 'org-A',
  actor: 'ada@example.com',
  connectorId: 'microsoft-entra',
  accountId: 'acct-1',
  actionId: 'mail.send',
  subject: 'm365-send:abc123',
  label: 'Send email (Microsoft 365)',
};

// ── Pure mapping ─────────────────────────────────────────────────────────────
describe('buildM365UnknownHoldInput — honest UNKNOWN→hold mapping', () => {
  it('uses reason verification_unavailable and preserves the reconstructable subject', () => {
    const input = buildM365UnknownHoldInput(CTX);
    expect(input.reason).toBe('verification_unavailable');
    expect(input.subject).toBe('m365-send:abc123'); // the CST transitionId → dedupe key
    expect(input.title).toBe(CTX.label);
    expect(input.requestedAction).toBe(CTX.label);
  });

  it('forbids blind retry and carries no secrets/params, only action + account labels', () => {
    const input = buildM365UnknownHoldInput(CTX);
    expect(input.resolution.toLowerCase()).toContain('do not blindly retry');
    expect(input.resolution.toLowerCase()).toContain('new governed decision');
    const blob = JSON.stringify(input);
    expect(blob).toContain('mail.send');
    expect(blob).toContain('microsoft-entra / acct-1');
    // No token/secret/body content is ever placed on the hold.
    expect(blob.toLowerCase()).not.toContain('token');
    expect(blob.toLowerCase()).not.toContain('password');
  });
});

// ── Real store integration + dedup ───────────────────────────────────────────
describe('M365 UNKNOWN → existing HoldStore (real raiseHold)', () => {
  let dir: string;
  let holds: HoldStore;
  let decisions: DecisionRecordStore;
  let audits: string[];
  let raise: HoldRaiser;

  beforeEach(async () => {
    dir = join(tmpdir(), `np-m365unk-${randomUUID()}`);
    await fs.mkdir(dir, { recursive: true });
    holds = new HoldStore(join(dir, 'h.json'));
    decisions = new DecisionRecordStore(join(dir, 'd.json'));
    // Holds are tenant-owned in production (holdStore.bindScope, runtimeCore) — bind a fixed test tenant so the
    // store has an authoritative owner (an unscoped store must refuse to record — proven by the store itself).
    holds.bindScope(() => TEST_TENANT_SCOPE);
    decisions.bindScope(() => TEST_TENANT_SCOPE);
    await Promise.all([holds.load(), decisions.load()]);
    audits = [];
    raise = createHoldRaiser({
      holds,
      decisions,
      actor: () => CTX.actor,
      audit: (action, target) => audits.push(`${action}|${target}`),
    });
  });
  afterEach(async () => {
    await Promise.all([holds.flush(), decisions.flush()]);
    await fs.rm(dir, { recursive: true, force: true }).catch(() => undefined);
  });

  it('creates exactly one open hold with the honest reason and records the decision + audit', () => {
    const hold = raise(buildM365UnknownHoldInput(CTX));
    expect(hold.reason).toBe('verification_unavailable');
    expect(hold.subject).toBe(CTX.subject);
    expect(hold.status).toBe('open');
    expect(hold.actor).toBe(CTX.actor);
    expect(holds.list().filter((h) => h.status === 'open')).toHaveLength(1);
    expect(audits.filter((a) => a.startsWith('hold.raised'))).toHaveLength(1);
  });

  it('the SAME UNKNOWN (same subject) dedupes to one hold — no uncontrolled duplicates', () => {
    const a = raise(buildM365UnknownHoldInput(CTX));
    const b = raise(buildM365UnknownHoldInput(CTX));
    expect(b.id).toBe(a.id); // per-subject idempotent open
    expect(holds.list().filter((h) => h.status === 'open')).toHaveLength(1);
    expect(audits.filter((x) => x.startsWith('hold.raised'))).toHaveLength(1);
  });

  it('a DIFFERENT consequential UNKNOWN (different subject) is a distinct hold', () => {
    raise(buildM365UnknownHoldInput(CTX));
    raise(buildM365UnknownHoldInput({ ...CTX, subject: 'm365-send:def456' }));
    expect(holds.list().filter((h) => h.status === 'open')).toHaveLength(2);
  });

  it('resolution records the disposition and executes nothing (evidence-only)', () => {
    const hold = raise(buildM365UnknownHoldInput(CTX));
    const resolved = holds.resolve(hold.id, 'cancelled', 'Reconciled: no effect found at Graph.');
    expect(resolved?.status).toBe('resolved');
    expect(resolved?.resolvedOutcome).toBe('cancelled');
    // No executor/effect is reachable from this path — resolving only records who cleared it and why.
    expect(holds.list().filter((h) => h.status === 'open')).toHaveLength(0);
  });
});

// ── The trigger: only a governed UNKNOWN outcome, with a reconstructable subject ──
describe('governedAction — UNKNOWN is the only trigger, transitionId is the stable subject', () => {
  const RATE = {} as unknown as RateGate;
  const okHttp = {} as unknown as HttpClient;
  function stub(run: WriteAction['run']): WriteAction {
    return { id: 'mail.reply', label: 'Reply', domain: 'mail', scopes: ['Mail.Send'], mutates: true, run };
  }
  function args(run: WriteAction['run']): GovernedActionArgs {
    return {
      action: stub(run),
      connectorId: 'microsoft-entra',
      accountId: 'acct-1',
      params: { messageId: 'm1', comment: 'hi' },
      confirmed: true,
      tenantId: 'org-A',
      actorId: 'ada@example.com',
      ownsAccount: true,
      grantedScopes: ['Mail.Send'],
      getToken: async () => 'tok',
      makeHttp: () => okHttp,
      rate: RATE,
      now: () => '2026-01-01T00:00:00.000Z',
      ports: createGovernedActionPorts(),
    };
  }

  it('NetworkError → semanticOutcome UNKNOWN, with a non-empty transitionId to use as the hold subject', async () => {
    const g = await governedAction(args(async () => { throw new NetworkError('aborted'); }));
    expect(g.semanticOutcome).toBe('UNKNOWN');
    expect(g.outcome?.transitionId).toBeTruthy();
    expect(String(g.outcome?.transitionId)).toContain('m365-action:');
  });

  it('two identical requests → the SAME transitionId (deterministic dedupe subject)', async () => {
    const g1 = await governedAction(args(async () => { throw new NetworkError('x'); }));
    const g2 = await governedAction(args(async () => { throw new NetworkError('x'); }));
    expect(String(g1.outcome?.transitionId)).toBe(String(g2.outcome?.transitionId));
  });

  it('a successful (ACKNOWLEDGED) outcome is NOT UNKNOWN → no hold would be raised', async () => {
    const g = await governedAction(args(async () => ({ ok: true, summary: 'sent' })));
    expect(g.semanticOutcome).not.toBe('UNKNOWN');
    expect(g.semanticOutcome).toBe('ACKNOWLEDGED');
  });
});
