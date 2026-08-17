/**
 * P13C H-FINDING-4 Cohort 2B-ii — governance controls for the three OVERWRITE / partially-reversible
 * M365 IPC write actions (drive.upload, drive.restoreVersion, contacts.update), routed through the SAME
 * governedAction adapter + durable store as Cohort 1/2A/2B-i, at the CONSERVATIVE reversibility tier
 * (drive.upload / drive.restoreVersion → IRREVERSIBLE by default; contacts.update → DIFFICULT_TO_REVERSE).
 *
 * Exercises `governedAction` with stub `WriteAction.run` (no live Graph). Proves the classification,
 * membership, governance before effect, canonical identity, single-process restart-durable single use,
 * concurrency, and Profile-A failure semantics. HONESTY: it does NOT claim the overwrite/loss is
 * reversible, that OneDrive retains versions, or that Graph executed — governance authorizes the caller's
 * inputs + confirmation; it does not observe server-side pre-state.
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
  GOVERNED_ACTION_COHORT2B_II,
  type GovernedActionArgs,
} from './governedAction';
import { DurableIdempotencyStore } from './durableIdempotencyStore';
import { NetworkError, HttpError, type HttpClient, type RateGate } from '../unified/sync/http';
import { type WriteAction, type WriteDomain } from '../connectors/m365/actionSdk';

const RATE = {} as unknown as RateGate;
const okHttp = {} as unknown as HttpClient; // stub run ignores http

const SPECS: Record<string, { domain: WriteDomain; scopes: string[]; params: Record<string, unknown> }> = {
  'drive.upload': { domain: 'drive', scopes: ['Files.ReadWrite'], params: { path: 'docs/a.txt', contentBytes: 'aGk=', contentType: 'text/plain' } },
  'drive.restoreVersion': { domain: 'drive', scopes: ['Files.ReadWrite'], params: { itemId: 'i1', versionId: 'v2' } },
  'contacts.update': { domain: 'contacts', scopes: ['Contacts.ReadWrite'], params: { contactId: 'c1', givenName: 'Ada' } },
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
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'nps-2bii-')); });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

describe('Cohort 2B-ii — membership + boundary (A)', () => {
  it('contains exactly the three overwrite/partially-reversible actions', () => {
    expect([...GOVERNED_ACTION_COHORT2B_II].sort()).toEqual(['contacts.update', 'drive.restoreVersion', 'drive.upload']);
  });
  it('the three are now governed (in a governed set) and NOT in Cohort-1/2A/2B-i', () => {
    for (const id of IDS) {
      expect(GOVERNED_ACTION_COHORT2B_II.has(id)).toBe(true);
      expect(GOVERNED_ACTION_COHORT1.has(id)).toBe(false);
      expect(GOVERNED_ACTION_COHORT2A.has(id)).toBe(false);
      expect(GOVERNED_ACTION_COHORT2B_I.has(id)).toBe(false);
    }
  });
  it('no unrelated action entered the cohort', () => {
    for (const id of ['mail.send', 'drive.delete', 'drive.rename', 'contacts.create', 'calendar.create']) {
      expect(GOVERNED_ACTION_COHORT2B_II.has(id)).toBe(false);
    }
  });
});

describe('Cohort 2B-ii — conservative classification (B)', () => {
  it('drive.upload → IRREVERSIBLE; drive.restoreVersion → IRREVERSIBLE; contacts.update → DIFFICULT_TO_REVERSE', () => {
    expect(reversibilityForAction('drive.upload')).toBe('IRREVERSIBLE');
    expect(reversibilityForAction('drive.restoreVersion')).toBe('IRREVERSIBLE');
    expect(reversibilityForAction('contacts.update')).toBe('DIFFICULT_TO_REVERSE');
  });
  it('does NOT over-claim reversibility (not REVERSIBLE, not PARTIALLY_REVERSIBLE)', () => {
    for (const id of IDS) {
      const rev = reversibilityForAction(id);
      expect(rev).not.toBe('REVERSIBLE');
      expect(rev).not.toBe('PARTIALLY_REVERSIBLE');
    }
  });
  it('existing cohort classifications unchanged', () => {
    // 2B-i stays REVERSIBLE; Cohort-1/2A/mail.send stay IRREVERSIBLE (default).
    expect(reversibilityForAction('mail.saveDraft')).toBe('REVERSIBLE');
    expect(reversibilityForAction('drive.rename')).toBe('REVERSIBLE');
    expect(reversibilityForAction('contacts.create')).toBe('REVERSIBLE');
    expect(reversibilityForAction('mail.send')).toBe('IRREVERSIBLE');
    expect(reversibilityForAction('calendar.create')).toBe('IRREVERSIBLE');
  });
});

describe('Cohort 2B-ii — governed execution (valid ⇒ effect once) (C)', () => {
  it.each(IDS)('%s: valid + confirmed ⇒ ACKNOWLEDGED, action.run once', async (id) => {
    const s = { calls: 0 };
    const g = await governedAction(baseArgs(id, s));
    expect(g.semanticOutcome).toBe('ACKNOWLEDGED');
    expect(g.effectCalls).toBe(1);
    expect(s.calls).toBe(1);
  });
});

describe('Cohort 2B-ii — denial-before-effect (D/E) — effect unreachable', () => {
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

describe('Cohort 2B-ii — canonical identity (F)', () => {
  it('reordered object keys ⇒ same identity ⇒ suppressed', async () => {
    const s = { calls: 0 };
    const ports = createGovernedActionPorts();
    await governedAction(baseArgs('contacts.update', s, { ports, params: { contactId: 'c1', givenName: 'Ada' } }));
    const second = await governedAction(baseArgs('contacts.update', s, { ports, params: { givenName: 'Ada', contactId: 'c1' } }));
    expect(s.calls).toBe(1);
    expect(second.effectCalls).toBe(0);
  });
  it.each([
    ['drive.upload', { path: 'a.txt', contentBytes: 'aGk=' }, { path: 'b.txt', contentBytes: 'aGk=' }], // different path
    ['drive.upload', { path: 'a.txt', contentBytes: 'aGk=' }, { path: 'a.txt', contentBytes: 'Ym8=' }], // different content
    ['drive.restoreVersion', { itemId: 'i1', versionId: 'v1' }, { itemId: 'i1', versionId: 'v2' }],       // different version
    ['drive.restoreVersion', { itemId: 'i1', versionId: 'v1' }, { itemId: 'i2', versionId: 'v1' }],       // different item
    ['contacts.update', { contactId: 'c1', givenName: 'A' }, { contactId: 'c1', givenName: 'B' }],        // different field value
    ['contacts.update', { contactId: 'c1', givenName: 'A' }, { contactId: 'c2', givenName: 'A' }],        // different contact
  ] as const)('%s: materially different consequential params ⇒ different identity ⇒ both execute', async (id, p1, p2) => {
    const s = { calls: 0 };
    const ports = createGovernedActionPorts();
    await governedAction(baseArgs(id, s, { ports, params: p1 }));
    await governedAction(baseArgs(id, s, { ports, params: p2 }));
    expect(s.calls).toBe(2);
  });
});

describe('Cohort 2B-ii — restart durability (I) + UNKNOWN (J) + concurrency (H)', () => {
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
  it.each(IDS)('%s: UNKNOWN (NetworkError) + RESTART + replay ⇒ reconcile/HOLD, never re-executes (no blind overwrite)', async (id) => {
    const s = { calls: 0 };
    const path = join(dir, 'm365-governed-actions.json');
    const first = await governedAction(baseArgs(id, s, {
      ports: createGovernedActionPorts(new DurableIdempotencyStore(path)),
      action: stub(id, async () => { s.calls += 1; throw new NetworkError('aborted'); }),
    }));
    expect(first.semanticOutcome).toBe('UNKNOWN');
    expect(s.calls).toBe(1);
    const replay = await governedAction(baseArgs(id, s, { ports: createGovernedActionPorts(new DurableIdempotencyStore(path)) }));
    expect(s.calls).toBe(1);
    expect(replay.effectCalls).toBe(0);
  });
  it('concurrent identical drive.upload ⇒ exactly one effect', async () => {
    const s = { calls: 0 };
    const ports = createGovernedActionPorts();
    await Promise.all([governedAction(baseArgs('drive.upload', s, { ports })), governedAction(baseArgs('drive.upload', s, { ports }))]);
    expect(s.calls).toBe(1);
  });
});

describe('Cohort 2B-ii — failure semantics (K) + consequence honesty (L)', () => {
  it('HttpError ⇒ EXECUTION_FAILED; NetworkError ⇒ UNKNOWN; never VERIFIED_SUCCESS', async () => {
    const http = await governedAction(baseArgs('drive.upload', { calls: 0 }, { action: stub('drive.upload', async () => { throw new HttpError('409', 409); }) }));
    expect(http.semanticOutcome).toBe('EXECUTION_FAILED');
    let n = 0;
    const net = await governedAction(baseArgs('drive.upload', { calls: 0 }, { action: stub('drive.upload', async () => { n += 1; throw new NetworkError('t'); }) }));
    expect(net.semanticOutcome).toBe('UNKNOWN');
    expect(n).toBe(1);
    expect(net.semanticOutcome).not.toBe('VERIFIED_SUCCESS');
  });
  it('consequence honesty: identity captures the caller inputs but NOT server-side overwrite/occupancy', async () => {
    // Two uploads to the SAME path with the SAME content share an identity (a re-upload is suppressed);
    // whether that path was occupied (overwrite vs create) is server-side and is NOT part of identity.
    const s = { calls: 0 };
    const ports = createGovernedActionPorts();
    await governedAction(baseArgs('drive.upload', s, { ports, params: { path: 'x.txt', contentBytes: 'aGk=' } }));
    const dup = await governedAction(baseArgs('drive.upload', s, { ports, params: { path: 'x.txt', contentBytes: 'aGk=' } }));
    expect(s.calls).toBe(1);
    expect(dup.effectCalls).toBe(0);
    // The classification is honest (not reversible); governance does not assert Graph executed or is recoverable.
    expect(reversibilityForAction('drive.upload')).toBe('IRREVERSIBLE');
    expect(reversibilityForAction('contacts.update')).toBe('DIFFICULT_TO_REVERSE');
  });
});
