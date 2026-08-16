/**
 * P13C H-FINDING-4 (Option A, Cohort 1) — negative + positive controls for the parameterized
 * governed-action CST adapter. No live account, no real Graph call: a stub `WriteAction.run` drives
 * every governance and transport outcome. Every denial asserts BOTH the verdict AND that the effect
 * was unreachable (`effectCalls === 0` and the injected action's own counter === 0).
 *
 * Durability: process-lifetime idempotency only. Restart-durable single-use is NOT covered (Node-20
 * limit) and NOT claimed here.
 */
import { describe, it, expect } from 'vitest';
import {
  governedAction,
  createGovernedActionPorts,
  GOVERNED_ACTION_COHORT1,
  type GovernedActionArgs,
} from './governedAction';
import { AuthError, HttpError, NetworkError, RateLimitError, type HttpClient, type RateGate } from '../unified/sync/http';
import { ActionInputError, type WriteAction } from '../connectors/m365/actionSdk';

const RATE = {} as unknown as RateGate;
const okHttp = { deleteJson: async () => ({ data: {}, headers: {}, status: 204 }) } as unknown as HttpClient;

/** A stub Cohort-1 action (calendar.delete) whose run is injected + counts its own invocations. */
function stubAction(run: WriteAction['run'], id = 'calendar.delete'): WriteAction {
  return { id, label: 'Delete meeting', domain: 'calendar', scopes: ['Calendars.ReadWrite'], mutates: true, run };
}

function baseArgs(over: Partial<GovernedActionArgs> = {}): GovernedActionArgs {
  return {
    action: stubAction(async () => ({ ok: true, summary: 'Deleted meeting e1' })),
    connectorId: 'microsoft-entra',
    accountId: 'acct-1',
    params: { eventId: 'e1' },
    confirmed: true,
    tenantId: 'org-test',
    actorId: 'user-1',
    ownsAccount: true,
    grantedScopes: ['Calendars.ReadWrite'],
    getToken: async () => 'tok',
    makeHttp: () => okHttp,
    rate: RATE,
    now: () => '2026-01-01T00:00:00.000Z',
    ports: createGovernedActionPorts(),
    ...over,
  };
}

describe('governedAction — Cohort-1 membership', () => {
  it('includes the high-consequence non-mail.send actions and EXCLUDES mail.send', () => {
    for (const id of ['mail.reply', 'mail.forward', 'calendar.invite', 'teams.sendChannelMessage', 'drive.delete', 'drive.share', 'contacts.delete']) {
      expect(GOVERNED_ACTION_COHORT1.has(id)).toBe(true);
    }
    expect(GOVERNED_ACTION_COHORT1.has('mail.send')).toBe(false);
    // Read-only actions are never in the cohort.
    expect(GOVERNED_ACTION_COHORT1.has('contacts.search')).toBe(false);
  });
});

describe('governedAction — governance refusals (DENY/HOLD before effect; effectCalls = 0)', () => {
  it('unconfirmed (C3 needs approval) ⇒ HOLD; effect never runs', async () => {
    let calls = 0;
    const g = await governedAction(baseArgs({ confirmed: false, action: stubAction(async () => { calls++; return { ok: true, summary: '' }; }) }));
    expect(g.semanticOutcome).toBe('HOLD');
    expect(g.effectCalls).toBe(0);
    expect(calls).toBe(0);
  });

  it('unauthorized (does not own account) ⇒ DENIED; effect never runs', async () => {
    let calls = 0;
    const g = await governedAction(baseArgs({ ownsAccount: false, action: stubAction(async () => { calls++; return { ok: true, summary: '' }; }) }));
    expect(g.semanticOutcome).toBe('DENIED');
    expect(g.effectCalls).toBe(0);
    expect(calls).toBe(0);
  });

  it('missing Graph scope ⇒ DENIED; effect never runs', async () => {
    const g = await governedAction(baseArgs({ grantedScopes: ['Calendars.Read'] }));
    expect(g.semanticOutcome).toBe('DENIED');
    expect(g.effectCalls).toBe(0);
  });

  it('no valid token ⇒ DENIED; effect never runs', async () => {
    const g = await governedAction(baseArgs({ getToken: async () => null }));
    expect(g.semanticOutcome).toBe('DENIED');
    expect(g.effectCalls).toBe(0);
  });

  it('missing authoritative actor identity ⇒ DENIED; effect never runs (no fallback actor)', async () => {
    let calls = 0;
    const g = await governedAction(baseArgs({ actorId: '', action: stubAction(async () => { calls++; return { ok: true, summary: '' }; }) }));
    expect(g.semanticOutcome).toBe('DENIED');
    expect(g.effectCalls).toBe(0);
    expect(calls).toBe(0);
  });

  it('non-canonicalizable consequential params ⇒ DENIED before the kernel; effect never runs', async () => {
    let calls = 0;
    const g = await governedAction(baseArgs({
      params: { eventId: 'e1', bad: () => undefined } as unknown as Record<string, unknown>,
      action: stubAction(async () => { calls++; return { ok: true, summary: '' }; }),
    }));
    expect(g.semanticOutcome).toBe('DENIED');
    expect(g.outcome).toBeNull(); // denied before the kernel ran
    expect(g.effectCalls).toBe(0);
    expect(calls).toBe(0);
  });
});

describe('governedAction — external outcomes (effect runs exactly once, never verified)', () => {
  it('authorized + confirmed + provider ack ⇒ ACKNOWLEDGED (NOT verified); effect once', async () => {
    const g = await governedAction(baseArgs());
    expect(g.semanticOutcome).toBe('ACKNOWLEDGED');
    expect(g.effectCalls).toBe(1);
    expect(g.semanticOutcome).not.toBe('VERIFIED_SUCCESS');
  });

  it('provider definite rejection (HttpError) ⇒ EXECUTION_FAILED; effect once', async () => {
    const g = await governedAction(baseArgs({ action: stubAction(async () => { throw new HttpError('HTTP 400', 400); }) }));
    expect(g.semanticOutcome).toBe('EXECUTION_FAILED');
    expect(g.effectCalls).toBe(1);
  });

  it('auth / rate-limit / input rejection ⇒ EXECUTION_FAILED', async () => {
    for (const err of [new AuthError('403', 403), new RateLimitError('429'), new ActionInputError('bad')]) {
      const g = await governedAction(baseArgs({ action: stubAction(async () => { throw err; }) }));
      expect(g.semanticOutcome).toBe('EXECUTION_FAILED');
      expect(g.effectCalls).toBe(1);
    }
  });

  it('lost response after transmission (NetworkError) ⇒ UNKNOWN; effect once; NO retry; never verified', async () => {
    let calls = 0;
    const g = await governedAction(baseArgs({ action: stubAction(async () => { calls++; throw new NetworkError('aborted'); }) }));
    expect(g.semanticOutcome).toBe('UNKNOWN');
    expect(g.semanticOutcome).not.toBe('EXECUTION_FAILED');
    expect(g.effectCalls).toBe(1);
    expect(calls).toBe(1); // transport invoked exactly once — no second effect
  });
});

describe('governedAction — deterministic identity, replay, concurrency (process-lifetime)', () => {
  it('exact replay ⇒ HOLD (reconciliation), NO second external effect', async () => {
    let calls = 0;
    const ports = createGovernedActionPorts();
    const action = stubAction(async () => { calls++; return { ok: true, summary: 'Deleted' }; });
    const first = await governedAction(baseArgs({ ports, action }));
    const second = await governedAction(baseArgs({ ports, action }));
    expect(first.semanticOutcome).toBe('ACKNOWLEDGED');
    expect(first.effectCalls).toBe(1);
    expect(second.effectCalls).toBe(0);
    expect(second.semanticOutcome).toBe('HOLD');
    expect(calls).toBe(1); // exactly one external effect across both governed calls
  });

  it('REORDERED object keys ⇒ SAME idempotency identity ⇒ second suppressed (no second effect)', async () => {
    let calls = 0;
    const ports = createGovernedActionPorts();
    const action = stubAction(async () => { calls++; return { ok: true, summary: 'Shared' }; }, 'drive.share');
    const a = stubAction(action.run, 'drive.share');
    (a as { domain: string }).domain = 'drive';
    (a as { scopes: string[] }).scopes = ['Files.ReadWrite'];
    const p1 = { itemId: 'i1', linkType: 'view', scope: 'anonymous' };
    const p2 = { scope: 'anonymous', linkType: 'view', itemId: 'i1' }; // same content, reordered keys
    const first = await governedAction(baseArgs({ ports, action: a, params: p1, grantedScopes: ['Files.ReadWrite'] }));
    const second = await governedAction(baseArgs({ ports, action: a, params: p2, grantedScopes: ['Files.ReadWrite'] }));
    expect(first.effectCalls).toBe(1);
    expect(second.effectCalls).toBe(0); // canonicalization makes reordered keys the same identity
    expect(calls).toBe(1);
  });

  it('DIFFERENT consequential params ⇒ DIFFERENT identity ⇒ both execute independently', async () => {
    let calls = 0;
    const ports = createGovernedActionPorts();
    const action = stubAction(async () => { calls++; return { ok: true, summary: 'Deleted' }; });
    const first = await governedAction(baseArgs({ ports, action, params: { eventId: 'e1' } }));
    const second = await governedAction(baseArgs({ ports, action, params: { eventId: 'e2' } }));
    expect(first.effectCalls).toBe(1);
    expect(second.effectCalls).toBe(1); // distinct events are distinct governed actions
    expect(calls).toBe(2);
  });

  it('concurrent duplicate submissions ⇒ at most ONE external effect (atomic admission)', async () => {
    let calls = 0;
    const ports = createGovernedActionPorts();
    const action = stubAction(async () => { calls++; return { ok: true, summary: 'Deleted' }; });
    await Promise.all([
      governedAction(baseArgs({ ports, action })),
      governedAction(baseArgs({ ports, action })),
    ]);
    expect(calls).toBe(1); // the CST atomic claim admits exactly one
  });
});
