/**
 * P13C H-FINDING-4 Cohort 2B-i — governance controls for the nine REVERSIBLE internal M365 IPC write
 * actions, routed through the SAME governedAction adapter + durable store as Cohort 1/2A, but with an
 * HONEST per-action REVERSIBLE class (not the conservative IRREVERSIBLE used for the externally-
 * communicative cohorts).
 *
 * Exercises `governedAction` with stub `WriteAction.run` (no live Graph). Proves the reversibility
 * model, membership + the Cohort-2B-ii boundary, governance before effect, canonical identity, single-
 * process restart-durable single-use, concurrency, and Profile-A failure semantics. Never claims Graph
 * effect success, provider idempotency, or verification.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  governedAction,
  createGovernedActionPorts,
  reversibilityForAction,
  GOVERNED_ACTION_COHORT1,
  GOVERNED_ACTION_COHORT2A,
  GOVERNED_ACTION_COHORT2B_I,
  type GovernedActionArgs,
} from './governedAction';
import { DurableIdempotencyStore } from './durableIdempotencyStore';
import { NetworkError, HttpError, type HttpClient, type RateGate } from '../unified/sync/http';
import { type WriteAction, type WriteDomain } from '../connectors/m365/actionSdk';

const RATE = {} as unknown as RateGate;
const okHttp = {} as unknown as HttpClient; // the stub run ignores http

const SPECS: Record<string, { domain: WriteDomain; scopes: string[]; params: Record<string, unknown> }> = {
  'mail.saveDraft': { domain: 'mail', scopes: ['Mail.ReadWrite'], params: { subject: 'Notes', body: 'hi' } },
  'mail.move': { domain: 'mail', scopes: ['Mail.ReadWrite'], params: { messageId: 'm1', destinationId: 'archive' } },
  'mail.markRead': { domain: 'mail', scopes: ['Mail.ReadWrite'], params: { messageId: 'm1', isRead: true } },
  'mail.restore': { domain: 'mail', scopes: ['Mail.ReadWrite'], params: { messageId: 'm1', destinationId: 'inbox' } },
  'mail.addAttachment': { domain: 'mail', scopes: ['Mail.ReadWrite'], params: { messageId: 'm1', name: 'a.txt', contentBytes: 'aGk=' } },
  'drive.rename': { domain: 'drive', scopes: ['Files.ReadWrite'], params: { itemId: 'i1', name: 'new.txt' } },
  'drive.move': { domain: 'drive', scopes: ['Files.ReadWrite'], params: { itemId: 'i1', parentId: 'p2' } },
  'drive.createFolder': { domain: 'drive', scopes: ['Files.ReadWrite'], params: { name: 'Docs', parentId: 'root' } },
  'contacts.create': { domain: 'contacts', scopes: ['Contacts.ReadWrite'], params: { givenName: 'Ada', emails: ['ada@x.com'] } },
};
const IDS = Object.keys(SPECS);

function stub(id: string, run: WriteAction['run']): WriteAction {
  const s = SPECS[id];
  return { id, label: id, domain: s.domain, scopes: s.scopes, mutates: true, run };
}

function baseArgs(id: string, state: { calls: number }, over: Partial<GovernedActionArgs> = {}): GovernedActionArgs {
  const s = SPECS[id];
  return {
    action: stub(id, async () => { state.calls += 1; return { ok: true, summary: `${id} ok` }; }),
    connectorId: 'microsoft-entra',
    accountId: 'acct-1',
    params: s.params,
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

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'nps-2bi-')); });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

describe('Cohort 2B-i — reversibility model (honest per-action)', () => {
  it.each(IDS)('%s is classified REVERSIBLE', (id) => {
    expect(reversibilityForAction(id)).toBe('REVERSIBLE');
  });
  it('default is IRREVERSIBLE — Cohort-1/2A/mail.send behavior unchanged', () => {
    for (const id of ['mail.send', 'calendar.invite', 'drive.share', 'calendar.create', 'teams.createChannel']) {
      expect(reversibilityForAction(id)).toBe('IRREVERSIBLE');
    }
  });
  it('Cohort-2B-ii classification: drive.upload / drive.restoreVersion IRREVERSIBLE, contacts.update DIFFICULT_TO_REVERSE', () => {
    // drive.* use the conservative IRREVERSIBLE default (version recovery not repo-provable);
    // contacts.update is DIFFICULT_TO_REVERSE (source-proven no version history) as of Cohort-2B-ii.
    expect(reversibilityForAction('drive.upload')).toBe('IRREVERSIBLE');
    expect(reversibilityForAction('drive.restoreVersion')).toBe('IRREVERSIBLE');
    expect(reversibilityForAction('contacts.update')).toBe('DIFFICULT_TO_REVERSE');
  });
});

describe('Cohort 2B-i — membership + Cohort-2B-ii boundary', () => {
  it('contains exactly the nine reversible actions', () => {
    expect([...GOVERNED_ACTION_COHORT2B_I].sort()).toEqual([...IDS].sort());
  });
  it('BOUNDARY: drive.upload / drive.restoreVersion / contacts.update are OUTSIDE every governed set', () => {
    for (const id of ['drive.upload', 'drive.restoreVersion', 'contacts.update']) {
      expect(GOVERNED_ACTION_COHORT2B_I.has(id)).toBe(false);
      expect(GOVERNED_ACTION_COHORT2A.has(id)).toBe(false);
      expect(GOVERNED_ACTION_COHORT1.has(id)).toBe(false);
    }
  });
  it('does not overlap Cohort-1 or Cohort-2A', () => {
    for (const id of IDS) {
      expect(GOVERNED_ACTION_COHORT1.has(id)).toBe(false);
      expect(GOVERNED_ACTION_COHORT2A.has(id)).toBe(false);
    }
  });
});

describe('Cohort 2B-i — governed execution (valid ⇒ effect once)', () => {
  it.each(IDS)('%s: valid + confirmed ⇒ ACKNOWLEDGED, action.run once', async (id) => {
    const s = { calls: 0 };
    const g = await governedAction(baseArgs(id, s));
    expect(g.semanticOutcome).toBe('ACKNOWLEDGED');
    expect(g.effectCalls).toBe(1);
    expect(s.calls).toBe(1);
  });
});

describe('Cohort 2B-i — denial-before-effect (effect unreachable; action.run = 0)', () => {
  it.each(IDS)('%s: unconfirmed ⇒ HOLD, effect 0', async (id) => {
    const s = { calls: 0 };
    const g = await governedAction(baseArgs(id, s, { confirmed: false }));
    expect(g.semanticOutcome).toBe('HOLD');
    expect(g.effectCalls).toBe(0);
    expect(s.calls).toBe(0);
  });
  it.each(IDS)('%s: unauthorized / missing scope / missing token / missing actor / non-canonical ⇒ DENIED, effect 0', async (id) => {
    const denials: Array<Partial<GovernedActionArgs>> = [
      { ownsAccount: false },
      { grantedScopes: [] },
      { getToken: async () => null },
      { actorId: '' },
      { params: { bad: () => undefined } as unknown as Record<string, unknown> },
    ];
    for (const over of denials) {
      const s = { calls: 0 };
      const g = await governedAction(baseArgs(id, s, over));
      expect(g.semanticOutcome).toBe('DENIED');
      expect(g.effectCalls).toBe(0);
      expect(s.calls).toBe(0);
    }
  });
});

describe('Cohort 2B-i — canonical identity (reversibility is NOT part of it)', () => {
  it('reordered object keys ⇒ same identity ⇒ second suppressed', async () => {
    const s = { calls: 0 };
    const ports = createGovernedActionPorts();
    await governedAction(baseArgs('mail.move', s, { ports, params: { messageId: 'm1', destinationId: 'archive' } }));
    const second = await governedAction(baseArgs('mail.move', s, { ports, params: { destinationId: 'archive', messageId: 'm1' } }));
    expect(s.calls).toBe(1);
    expect(second.effectCalls).toBe(0);
  });
  it.each([
    ['mail.move', { messageId: 'm1', destinationId: 'a' }, { messageId: 'm1', destinationId: 'b' }],
    ['mail.markRead', { messageId: 'm1', isRead: true }, { messageId: 'm1', isRead: false }],
    ['drive.rename', { itemId: 'i1', name: 'x' }, { itemId: 'i1', name: 'y' }],
    ['drive.move', { itemId: 'i1', parentId: 'p1' }, { itemId: 'i1', parentId: 'p2' }],
    ['drive.createFolder', { name: 'A', parentId: 'root' }, { name: 'B', parentId: 'root' }],
  ] as const)('%s: a materially different consequential param ⇒ different identity ⇒ both execute', async (id, p1, p2) => {
    const s = { calls: 0 };
    const ports = createGovernedActionPorts();
    await governedAction(baseArgs(id, s, { ports, params: p1 }));
    await governedAction(baseArgs(id, s, { ports, params: p2 }));
    expect(s.calls).toBe(2);
  });
});

describe('Cohort 2B-i — restart durability (committed durable store) + concurrency', () => {
  it.each(IDS)('%s: admit + RESTART + exact replay ⇒ no second effect', async (id) => {
    const s = { calls: 0 };
    const path = join(dir, 'm365-governed-actions.json');
    const first = await governedAction(baseArgs(id, s, { ports: createGovernedActionPorts(new DurableIdempotencyStore(path)) }));
    expect(first.semanticOutcome).toBe('ACKNOWLEDGED');
    expect(s.calls).toBe(1);
    const replay = await governedAction(baseArgs(id, s, { ports: createGovernedActionPorts(new DurableIdempotencyStore(path)) }));
    expect(s.calls).toBe(1);
    expect(replay.effectCalls).toBe(0);
  });
  it('UNKNOWN (NetworkError) + RESTART + replay ⇒ reconcile/HOLD, never re-executes', async () => {
    const s = { calls: 0 };
    const path = join(dir, 'm365-governed-actions.json');
    const first = await governedAction(baseArgs('drive.rename', s, {
      ports: createGovernedActionPorts(new DurableIdempotencyStore(path)),
      action: stub('drive.rename', async () => { s.calls += 1; throw new NetworkError('aborted'); }),
    }));
    expect(first.semanticOutcome).toBe('UNKNOWN');
    expect(s.calls).toBe(1);
    const replay = await governedAction(baseArgs('drive.rename', s, { ports: createGovernedActionPorts(new DurableIdempotencyStore(path)) }));
    expect(s.calls).toBe(1);
    expect(replay.effectCalls).toBe(0);
  });
  it('concurrent identical requests ⇒ exactly one effect', async () => {
    const s = { calls: 0 };
    const ports = createGovernedActionPorts();
    await Promise.all([governedAction(baseArgs('contacts.create', s, { ports })), governedAction(baseArgs('contacts.create', s, { ports }))]);
    expect(s.calls).toBe(1);
  });
});

describe('Cohort 2B-i — failure semantics (Profile A)', () => {
  it('HttpError ⇒ EXECUTION_FAILED; NetworkError ⇒ UNKNOWN (no blind retry); never VERIFIED_SUCCESS', async () => {
    const http = await governedAction(baseArgs('mail.saveDraft', { calls: 0 }, { action: stub('mail.saveDraft', async () => { throw new HttpError('400', 400); }) }));
    expect(http.semanticOutcome).toBe('EXECUTION_FAILED');
    let n = 0;
    const net = await governedAction(baseArgs('mail.saveDraft', { calls: 0 }, { action: stub('mail.saveDraft', async () => { n += 1; throw new NetworkError('t'); }) }));
    expect(net.semanticOutcome).toBe('UNKNOWN');
    expect(n).toBe(1);
    expect(net.semanticOutcome).not.toBe('VERIFIED_SUCCESS');
  });
});
