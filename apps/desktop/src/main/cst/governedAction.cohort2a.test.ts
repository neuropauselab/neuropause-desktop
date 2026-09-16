/**
 * P13C H-FINDING-4 Cohort 2A — governance controls for the three externally-visible / notification-
 * capable actions (calendar.create, calendar.update, teams.createChannel), routed through the SAME
 * governedAction adapter + durable store as Cohort 1, at the conservative C3/IRREVERSIBLE tier.
 *
 * These tests exercise `governedAction` with stub `WriteAction.run` (no live Graph). They prove
 * governance BEFORE the provider effect, canonical identity, single-process restart-durable single
 * use, and concurrency — never Microsoft Graph's external-notification behavior or effect success.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  governedAction,
  createGovernedActionPorts,
  GOVERNED_ACTION_COHORT1,
  GOVERNED_ACTION_COHORT2A,
  type GovernedActionArgs,
} from './governedAction';
import { DurableIdempotencyStore } from './durableIdempotencyStore';
import { NetworkError, HttpError, type HttpClient, type RateGate } from '../unified/sync/http';
import { type WriteAction, type WriteDomain } from '../connectors/m365/actionSdk';

const RATE = {} as unknown as RateGate;
const okHttp = { postJson: async () => ({ data: { id: 'x' }, headers: {}, status: 201 }), patchJson: async () => ({ data: { id: 'x' }, headers: {}, status: 200 }) } as unknown as HttpClient;

/** Real Cohort-2A action shapes (id/domain/scopes), with an injected run for counting. */
const SPECS: Record<string, { domain: WriteDomain; scopes: string[] }> = {
  'calendar.create': { domain: 'calendar', scopes: ['Calendars.ReadWrite'] },
  'calendar.update': { domain: 'calendar', scopes: ['Calendars.ReadWrite'] },
  'teams.createChannel': { domain: 'teams', scopes: ['Channel.Create'] },
};

function stub(id: string, run: WriteAction['run']): WriteAction {
  const s = SPECS[id];
  return { id, label: id, domain: s.domain, scopes: s.scopes, mutates: true, run };
}

function baseArgs(id: string, state: { calls: number }, over: Partial<GovernedActionArgs> = {}): GovernedActionArgs {
  const s = SPECS[id];
  return {
    action: stub(id, async () => {
      state.calls += 1;
      return { ok: true, summary: `${id} ok` };
    }),
    connectorId: 'microsoft-entra',
    accountId: 'acct-1',
    params: id === 'teams.createChannel' ? { teamId: 't1', displayName: 'General' } : { subject: 'Sync', start: '2026-07-12T09:00:00', end: '2026-07-12T09:30:00' },
    confirmed: true,
    tenantId: 'org-test',
    actorId: 'user-1',
    ownsAccount: true,
    grantedScopes: s.scopes,
    getToken: async () => 'tok',
    makeHttp: () => okHttp,
    rate: RATE,
    now: () => '2026-01-01T00:00:00.000Z',
    ports: createGovernedActionPorts(),
    ...over,
  };
}

const IDS = ['calendar.create', 'calendar.update', 'teams.createChannel'];

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'nps-2a-')); });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

describe('Cohort 2A — membership / routing set', () => {
  it('contains exactly the three externally-visible actions', () => {
    expect([...GOVERNED_ACTION_COHORT2A].sort()).toEqual(['calendar.create', 'calendar.update', 'teams.createChannel']);
  });
  it('does NOT include Cohort-1, mail.send, or any Cohort-2B (reversible internal) action', () => {
    for (const id of ['mail.send', 'calendar.invite', 'drive.share', 'calendar.delete']) expect(GOVERNED_ACTION_COHORT2A.has(id)).toBe(false);
    // Cohort 2B stays OUT of the new branch → still routes to the existing executor.
    for (const id of ['mail.saveDraft', 'mail.move', 'mail.markRead', 'mail.restore', 'mail.addAttachment', 'drive.upload', 'drive.rename', 'drive.move', 'drive.createFolder', 'drive.restoreVersion', 'contacts.create', 'contacts.update']) {
      expect(GOVERNED_ACTION_COHORT2A.has(id)).toBe(false);
      expect(GOVERNED_ACTION_COHORT1.has(id)).toBe(false);
    }
  });
});

describe('Cohort 2A — governed execution (valid ⇒ effect exactly once)', () => {
  it.each(IDS)('%s: valid + confirmed ⇒ ACKNOWLEDGED, action.run once', async (id) => {
    const s = { calls: 0 };
    const g = await governedAction(baseArgs(id, s));
    expect(g.semanticOutcome).toBe('ACKNOWLEDGED');
    expect(g.effectCalls).toBe(1);
    expect(s.calls).toBe(1);
  });
});

describe('Cohort 2A — denial-before-effect (effect unreachable; action.run = 0)', () => {
  it.each(IDS)('%s: unconfirmed ⇒ HOLD, effect 0', async (id) => {
    const s = { calls: 0 };
    const g = await governedAction(baseArgs(id, s, { confirmed: false }));
    expect(g.semanticOutcome).toBe('HOLD');
    expect(g.effectCalls).toBe(0);
    expect(s.calls).toBe(0);
  });
  it('unauthorized account ⇒ DENIED, effect 0', async () => {
    const s = { calls: 0 };
    const g = await governedAction(baseArgs('calendar.create', s, { ownsAccount: false }));
    expect(g.semanticOutcome).toBe('DENIED');
    expect(g.effectCalls).toBe(0);
    expect(s.calls).toBe(0);
  });
  it('missing scope ⇒ DENIED, effect 0', async () => {
    const g = await governedAction(baseArgs('teams.createChannel', { calls: 0 }, { grantedScopes: ['Channel.ReadBasic.All'] }));
    expect(g.semanticOutcome).toBe('DENIED');
    expect(g.effectCalls).toBe(0);
  });
  it('missing token ⇒ DENIED, effect 0', async () => {
    const g = await governedAction(baseArgs('calendar.update', { calls: 0 }, { getToken: async () => null }));
    expect(g.semanticOutcome).toBe('DENIED');
    expect(g.effectCalls).toBe(0);
  });
  it('missing authoritative actor ⇒ DENIED, effect 0 (no fallback identity)', async () => {
    const s = { calls: 0 };
    const g = await governedAction(baseArgs('calendar.create', s, { actorId: '' }));
    expect(g.semanticOutcome).toBe('DENIED');
    expect(g.effectCalls).toBe(0);
    expect(s.calls).toBe(0);
  });
});

describe('Cohort 2A — canonical identity', () => {
  it('reordered object keys ⇒ same identity ⇒ second suppressed (in-process)', async () => {
    const s = { calls: 0 };
    const ports = createGovernedActionPorts();
    const p1 = { subject: 'Sync', start: 's', end: 'e' };
    const p2 = { end: 'e', start: 's', subject: 'Sync' };
    await governedAction(baseArgs('calendar.create', s, { ports, params: p1 }));
    const second = await governedAction(baseArgs('calendar.create', s, { ports, params: p2 }));
    expect(s.calls).toBe(1);
    expect(second.effectCalls).toBe(0);
  });
  it('different consequential param ⇒ different identity ⇒ both execute', async () => {
    const s = { calls: 0 };
    const ports = createGovernedActionPorts();
    await governedAction(baseArgs('calendar.create', s, { ports, params: { subject: 'A' } }));
    await governedAction(baseArgs('calendar.create', s, { ports, params: { subject: 'B' } }));
    expect(s.calls).toBe(2);
  });
  it('calendar.create WITH attendees is governed before the effect (params include attendees)', async () => {
    const s = { calls: 0 };
    const g = await governedAction(baseArgs('calendar.create', s, { params: { subject: 'Review', start: 's', end: 'e', attendees: ['a@x.com', 'b@x.com'] } }));
    expect(g.semanticOutcome).toBe('ACKNOWLEDGED'); // governance ran; NOT a claim about Graph notification
    expect(s.calls).toBe(1);
    // A different attendee list is a DIFFERENT governed request.
    const s2 = { calls: 0 };
    const ports = createGovernedActionPorts();
    await governedAction(baseArgs('calendar.create', s2, { ports, params: { subject: 'Review', start: 's', end: 'e', attendees: ['a@x.com'] } }));
    await governedAction(baseArgs('calendar.create', s2, { ports, params: { subject: 'Review', start: 's', end: 'e', attendees: ['a@x.com', 'b@x.com'] } }));
    expect(s2.calls).toBe(2);
  });
});

describe('Cohort 2A — single-process restart durability (reuses the committed durable store)', () => {
  it.each(IDS)('%s: admit + RESTART + exact replay ⇒ no second effect', async (id) => {
    const s = { calls: 0 };
    const path = join(dir, 'm365-governed-actions.json');
    const first = await governedAction(baseArgs(id, s, { ports: createGovernedActionPorts(new DurableIdempotencyStore(path)) }));
    expect(first.semanticOutcome).toBe('ACKNOWLEDGED');
    expect(s.calls).toBe(1);
    // Fresh store from the same file = restart (new memory, hydrate from disk).
    const replay = await governedAction(baseArgs(id, s, { ports: createGovernedActionPorts(new DurableIdempotencyStore(path)) }));
    expect(s.calls).toBe(1);
    expect(replay.effectCalls).toBe(0);
  });

  it('calendar.update: RESTART after NetworkError (UNKNOWN) ⇒ reconcile/HOLD, never re-executes', async () => {
    const s = { calls: 0 };
    const path = join(dir, 'm365-governed-actions.json');
    const first = await governedAction(baseArgs('calendar.update', s, {
      ports: createGovernedActionPorts(new DurableIdempotencyStore(path)),
      action: stub('calendar.update', async () => { s.calls += 1; throw new NetworkError('aborted'); }),
    }));
    expect(first.semanticOutcome).toBe('UNKNOWN');
    expect(s.calls).toBe(1);
    const replay = await governedAction(baseArgs('calendar.update', s, { ports: createGovernedActionPorts(new DurableIdempotencyStore(path)) }));
    expect(s.calls).toBe(1);
    expect(replay.effectCalls).toBe(0);
  });
});

describe('Cohort 2A — concurrency + failure semantics', () => {
  it('concurrent identical requests ⇒ exactly one effect', async () => {
    const s = { calls: 0 };
    const ports = createGovernedActionPorts();
    await Promise.all([governedAction(baseArgs('teams.createChannel', s, { ports })), governedAction(baseArgs('teams.createChannel', s, { ports }))]);
    expect(s.calls).toBe(1);
  });
  it('HttpError ⇒ EXECUTION_FAILED (definite); NetworkError ⇒ UNKNOWN (no blind retry)', async () => {
    const http = await governedAction(baseArgs('calendar.create', { calls: 0 }, { action: stub('calendar.create', async () => { throw new HttpError('400', 400); }) }));
    expect(http.semanticOutcome).toBe('EXECUTION_FAILED');
    let n = 0;
    const net = await governedAction(baseArgs('calendar.create', { calls: 0 }, { action: stub('calendar.create', async () => { n += 1; throw new NetworkError('t'); }) }));
    expect(net.semanticOutcome).toBe('UNKNOWN');
    expect(n).toBe(1);
    expect(net.semanticOutcome).not.toBe('VERIFIED_SUCCESS');
  });
});
