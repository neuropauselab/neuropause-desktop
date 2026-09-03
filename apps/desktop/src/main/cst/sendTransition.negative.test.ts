/**
 * P13C Phase H — negative controls for the M365 SEND governed transition (Profile A).
 *
 * Two layers, no live account and NO real email:
 *   1. Adapter layer — inject a stub `WriteAction.run` to drive every governance and
 *      transport outcome, asserting the domain classification, the at-most-once
 *      external effect, and that VERIFIED_SUCCESS is unreachable.
 *   2. Real-send propagation — the REAL `mail.send` action with a fake HttpClient,
 *      proving the typed transport error (NetworkError vs HttpError) reaches the
 *      adapter intact (the H9 / H-FINDING-1 correctness property that
 *      M365Executor.execute would have destroyed).
 */
import { describe, it, expect } from 'vitest';
import { governedSend, createGovernedSendPorts, type GovernedSendArgs } from './sendTransition';
import { AuthError, HttpError, NetworkError, RateLimitError, type HttpClient, type RateGate } from '../unified/sync/http';
import { ActionInputError, type WriteAction } from '../connectors/m365/actionSdk';
import { ALL_M365_ACTIONS } from '../connectors/m365';

const RATE = {} as unknown as RateGate;
const okHttp = { postJson: async () => ({ data: {}, headers: {}, status: 202 }) } as unknown as HttpClient;

/** A stub send action whose run is injected; counts its own invocations. */
function stubAction(run: WriteAction['run']): WriteAction {
  return { id: 'mail.send', label: 'Send email', domain: 'mail', scopes: ['Mail.Send'], mutates: true, run };
}

function baseArgs(over: Partial<GovernedSendArgs> = {}): GovernedSendArgs {
  return {
    connectorId: 'm365',
    accountId: 'acct-1',
    action: stubAction(async () => ({ ok: true, summary: 'Sent "Hi" to 1 recipient(s)' })),
    params: { to: ['a@example.com'], subject: 'Hi', body: 'yo' },
    confirmed: true,
    tenantId: 'org-test',
    actorId: 'sender@np.example',
    policyVersion: 'm365-send-policy-1',
    ownsAccount: true,
    grantedScopes: ['Mail.Send'],
    getToken: async () => 'tok',
    makeHttp: () => okHttp,
    rate: RATE,
    now: () => '2026-01-01T00:00:00.000Z',
    ports: createGovernedSendPorts(),
    ...over,
  };
}

describe('M365 send — governance refusals (no external effect)', () => {
  it('H-B: unconfirmed C3 ⇒ HOLD; effect never runs', async () => {
    let calls = 0;
    const g = await governedSend(baseArgs({ confirmed: false, action: stubAction(async () => { calls++; return { ok: true, summary: '' }; }) }));
    expect(g.semanticOutcome).toBe('HOLD');
    expect(g.outcome.executed).toBe(false);
    expect(g.effectCalls).toBe(0);
    expect(calls).toBe(0);
    expect(g.providerAck).toBe(false);
  });

  it('H-C: unauthorized (does not own account) ⇒ DENIED; effect never runs', async () => {
    let calls = 0;
    const g = await governedSend(baseArgs({ ownsAccount: false, action: stubAction(async () => { calls++; return { ok: true, summary: '' }; }) }));
    expect(g.semanticOutcome).toBe('DENIED');
    expect(g.effectCalls).toBe(0);
    expect(calls).toBe(0);
  });

  it('H-D: missing Graph scope ⇒ DENIED; effect never runs', async () => {
    const g = await governedSend(baseArgs({ grantedScopes: ['Mail.Read'] }));
    expect(g.semanticOutcome).toBe('DENIED');
    expect(g.effectCalls).toBe(0);
  });

  it('H-E: stale/absent authorization (no valid token) ⇒ DENIED; effect never runs', async () => {
    const g = await governedSend(baseArgs({ getToken: async () => null }));
    expect(g.semanticOutcome).toBe('DENIED');
    expect(g.effectCalls).toBe(0);
  });

  it('H-O: missing authoritative actor identity ⇒ DENIED; effect never runs (no fallback actor)', async () => {
    let calls = 0;
    const g = await governedSend(baseArgs({ actorId: '', action: stubAction(async () => { calls++; return { ok: true, summary: '' }; }) }));
    expect(g.semanticOutcome).toBe('DENIED');
    expect(g.effectCalls).toBe(0);
    expect(calls).toBe(0);
  });
});

describe('M365 send — external outcomes (effect runs exactly once)', () => {
  it('H-A/H-H: authorized + confirmed + 202 ⇒ ACKNOWLEDGED (NOT verified); effect once', async () => {
    const g = await governedSend(baseArgs());
    expect(g.semanticOutcome).toBe('ACKNOWLEDGED');
    expect(g.effectCalls).toBe(1);
    expect(g.providerAck).toBe(true);
    // Structural: a Profile-A ack is NEVER a verified success.
    expect(g.semanticOutcome).not.toBe('VERIFIED_SUCCESS');
  });

  it('H-G: provider definite rejection (HttpError) ⇒ EXECUTION_FAILED; effect once', async () => {
    const g = await governedSend(baseArgs({ action: stubAction(async () => { throw new HttpError('HTTP 400', 400); }) }));
    expect(g.semanticOutcome).toBe('EXECUTION_FAILED');
    expect(g.effectCalls).toBe(1);
    expect(g.providerAck).toBe(false);
  });

  it('H-G2: rate-limit rejection ⇒ EXECUTION_FAILED (definite, no send)', async () => {
    const g = await governedSend(baseArgs({ action: stubAction(async () => { throw new RateLimitError('429'); }) }));
    expect(g.semanticOutcome).toBe('EXECUTION_FAILED');
    expect(g.effectCalls).toBe(1);
  });

  it('H-G3: auth rejection at send ⇒ EXECUTION_FAILED', async () => {
    const g = await governedSend(baseArgs({ action: stubAction(async () => { throw new AuthError('403', 403); }) }));
    expect(g.semanticOutcome).toBe('EXECUTION_FAILED');
  });

  it('H-G4: pre-send input validation error ⇒ EXECUTION_FAILED (nothing transmitted)', async () => {
    const g = await governedSend(baseArgs({ action: stubAction(async () => { throw new ActionInputError('bad recipients'); }) }));
    expect(g.semanticOutcome).toBe('EXECUTION_FAILED');
  });

  it('H-J (FLAGSHIP): lost response after transmission ⇒ UNKNOWN; effect once; NO retry; not failure, not verified', async () => {
    let calls = 0;
    const g = await governedSend(baseArgs({
      action: stubAction(async () => { calls++; throw new NetworkError('request aborted (timeout)'); }),
    }));
    // Epistemic: the outcome is UNKNOWN — the send MAY have happened.
    expect(g.semanticOutcome).toBe('UNKNOWN');
    expect(g.semanticOutcome).not.toBe('EXECUTION_FAILED');
    expect(g.semanticOutcome).not.toBe('VERIFIED_SUCCESS');
    // Consequence control: the external effect was attempted EXACTLY ONCE and NOT retried.
    expect(g.effectCalls).toBe(1);
    expect(calls).toBe(1); // the transport was invoked exactly once — no second send
  });

  it('H-I: VERIFIED_SUCCESS is never produced by any path (Profile A)', async () => {
    const outcomes = await Promise.all([
      governedSend(baseArgs()),
      governedSend(baseArgs({ action: stubAction(async () => { throw new NetworkError('t'); }) })),
      governedSend(baseArgs({ action: stubAction(async () => { throw new HttpError('500', 500); }) })),
      governedSend(baseArgs({ confirmed: false })),
      governedSend(baseArgs({ ownsAccount: false })),
    ]);
    for (const g of outcomes) expect(g.semanticOutcome).not.toBe('VERIFIED_SUCCESS');
  });
});

describe('M365 send — idempotency (NeuroPause boundary, NOT provider-enforced)', () => {
  // H-FINDING-2 (honest, recorded): in Profile A the FIRST send is only ACKNOWLEDGED
  // (its completion is unobservable), so the kernel cannot treat a replay as a
  // confirmed VERIFIED_NOOP. Instead it HOLDs the replay for reconciliation — it
  // neither re-sends (effectCalls 0, no duplicate email) NOR fabricates a no-op it
  // cannot prove. That is the strongest HONEST outcome: consequence control preserved
  // (no second external effect) without overclaiming. (Under Profile B, an
  // authoritatively-confirmed prior send could instead yield VERIFIED_NOOP.)
  it('H-F/H-K: replay of the SAME message ⇒ HOLD for reconciliation, NO second external effect', async () => {
    let calls = 0;
    const ports = createGovernedSendPorts();
    const action = stubAction(async () => { calls++; return { ok: true, summary: 'Sent' }; });
    const first = await governedSend(baseArgs({ ports, action }));
    const second = await governedSend(baseArgs({ ports, action }));
    expect(first.semanticOutcome).toBe('ACKNOWLEDGED');
    expect(first.effectCalls).toBe(1);
    // The replay does NOT send again and does NOT fabricate a NOOP it cannot confirm.
    expect(second.effectCalls).toBe(0);
    expect(second.semanticOutcome).toBe('HOLD');
    expect(second.semanticOutcome).not.toBe('VERIFIED_SUCCESS');
    expect(calls).toBe(1); // exactly one external send across both governed calls
  });
});

describe('M365 send — real mail.send propagates the typed transport error (H9 / H-FINDING-1)', () => {
  const mailSend = ALL_M365_ACTIONS.find((a) => a.id === 'mail.send') as WriteAction;

  it('real send + 202 ⇒ ACKNOWLEDGED', async () => {
    const g = await governedSend(baseArgs({ action: mailSend, makeHttp: () => okHttp }));
    expect(g.semanticOutcome).toBe('ACKNOWLEDGED');
    expect(g.effectCalls).toBe(1);
  });

  it('real send + NetworkError ⇒ UNKNOWN (the typed error survives to the adapter)', async () => {
    const netHttp = { postJson: async () => { throw new NetworkError('aborted'); } } as unknown as HttpClient;
    const g = await governedSend(baseArgs({ action: mailSend, makeHttp: () => netHttp }));
    expect(g.semanticOutcome).toBe('UNKNOWN');
    expect(g.effectCalls).toBe(1);
  });

  it('real send + HttpError ⇒ EXECUTION_FAILED (not conflated with UNKNOWN)', async () => {
    const errHttp = { postJson: async () => { throw new HttpError('HTTP 400', 400); } } as unknown as HttpClient;
    const g = await governedSend(baseArgs({ action: mailSend, makeHttp: () => errHttp }));
    expect(g.semanticOutcome).toBe('EXECUTION_FAILED');
    expect(g.effectCalls).toBe(1);
  });
});
