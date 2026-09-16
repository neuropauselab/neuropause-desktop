/**
 * SEAM-B.8 / GATE-R.2 — JOURNAL-B8 pins: the journal DRAFT → POSTED transition
 * crosses the sanctioned CST kernel, and governance is LOAD-BEARING (§56):
 * when the kernel refuses, the write does not happen — with every domain guard
 * already satisfied, so nothing but governance explains the absence.
 *
 * §2 #17 — pinned against the REAL path: the module pins drive the real
 * `createJournalEntryModule` over real temp-dir stores through the real
 * `runAction('post')`; the evidence pins write through the REAL ActionRecord
 * store and read it back (§2 #29: observe the store, never the promise).
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { JOURNAL_ENTRIES_MODULE_ID, LEDGER_ACCOUNTS_MODULE_ID, type EnterpriseEntity } from '@neuropause/shared';
import type { EnterpriseModule, EnterpriseModuleActionContext } from '../../framework';
import { EnterpriseRecordStore } from '../../framework';
import { JOURNAL_ENTRY_KIND } from '@neuropause/shared';
import { actionRecord } from '../../../connectors/actionRecord';
import { DurableIdempotencyStore } from '../../../cst/durableIdempotencyStore';
import { awaitingVerification } from '../../../reconciliation/readBackReconciler';
import { createLedgerAccountModule } from './ledgerAccountModule';
import { createJournalEntryModule, type JournalPostOutcomeEvent } from './journalEntryModule';
import {
  JOURNAL_POST_POLICY_VERSION,
  createJournalPostPorts,
  governedJournalPost,
  type GovernedJournalPostArgs,
} from './journalPostTransition';
import { recordJournalPostEvidence } from './journalPostEvidence';

const T0 = '2026-08-24T00:00:00.000Z';

/* ─────────────────────────── adapter-level pins ─────────────────────────── */

describe('JOURNAL-B8 · governedJournalPost (the adapter against the real kernel)', () => {
  /** A tiny world the effect/observe close over — the store stand-in for adapter pins. */
  function world(rev = 3) {
    const w = { posted: false, rev, effectCalls: 0 };
    const args = (over: Partial<GovernedJournalPostArgs> = {}): GovernedJournalPostArgs => ({
      entryId: 'je-1',
      entryNumber: 'JE-0001',
      tenantId: 'org-1',
      actorId: 'user@np.test',
      expectedRev: rev,
      policyVersion: JOURNAL_POST_POLICY_VERSION,
      effect: async () => {
        w.effectCalls += 1;
        if (w.rev !== rev || w.posted) return { accepted: false, wrote: false, stale: true };
        w.posted = true;
        w.rev = rev + 1;
        return { accepted: true, wrote: true, stale: false };
      },
      observe: () => ({ posted: w.posted, rev: w.rev }),
      ...over,
    });
    return { w, args };
  }

  it('JOURNAL-B8-01: a granted, approved post reaches VERIFIED_SUCCESS through the kernel', async () => {
    const { w, args } = world();
    const r = await governedJournalPost(args());
    expect(r.semanticOutcome).toBe('VERIFIED_SUCCESS');
    expect(r.outcome.verdict).toBe('ALLOW');
    expect(r.outcome.executed).toBe(true);
    expect(r.outcome.outcomeClass).toBe('VERIFIED_SUCCESS');
    // SEAM-B.9: the id is unique PER ATTEMPT (entry:rev prefix + attempt suffix).
    expect(r.transitionId).toMatch(/^journal-post:je-1:3:/);
    expect(w.posted).toBe(true);
    expect(w.rev).toBe(4);
  });

  it('JOURNAL-B8-02 (fail-closed actor): an empty actor is refused BEFORE the effect runs', async () => {
    const { w, args } = world();
    const r = await governedJournalPost(args({ actorId: '' }));
    expect(['HOLD', 'DENY']).toContain(r.semanticOutcome);
    expect(r.outcome.executed).toBe(false);
    expect(w.effectCalls).toBe(0); // the write closure never ran
    expect(w.posted).toBe(false);
  });

  it('JOURNAL-B8-03 (§2 #14): a LYING executor is caught — claimed success the store does not show is DEVIATION, never VERIFIED_SUCCESS', async () => {
    const { args } = world();
    const r = await governedJournalPost(
      args({
        effect: async () => ({ accepted: true, wrote: true, stale: false }), // claims it wrote
        observe: () => ({ posted: false, rev: 3 }), // the store says otherwise
      }),
    );
    expect(r.outcome.executed).toBe(true);
    expect(r.semanticOutcome).toBe('DEVIATION');
    expect(r.outcome.outcomeClass).not.toBe('VERIFIED_SUCCESS');
  });

  it('JOURNAL-B8-04 (§30 non-vacuous): posted-looking state at the WRONG revision fails verification', async () => {
    const { args } = world();
    const r = await governedJournalPost(
      args({
        effect: async () => ({ accepted: true, wrote: true, stale: false }),
        observe: () => ({ posted: true, rev: 5 }), // expected 3 + 1 = 4
      }),
    );
    expect(r.semanticOutcome).toBe('DEVIATION');
  });

  it('JOURNAL-B8-05: an UNOBSERVABLE post-state is UNKNOWN — never success (§2 #9)', async () => {
    const { args } = world();
    const r = await governedJournalPost(
      args({
        effect: async () => ({ accepted: true, wrote: true, stale: false }),
        observe: () => null,
      }),
    );
    expect(r.semanticOutcome).toBe('UNKNOWN');
  });

  it('JOURNAL-B8-06: a LOST revision CAS is STALE_RESOURCE — the winner\'s posted world never verifies the loser', async () => {
    const { args } = world();
    const r = await governedJournalPost(
      args({
        effect: async () => ({ accepted: false, wrote: false, stale: true }),
        observe: () => ({ posted: true, rev: 4 }), // posted — but by the OTHER writer
      }),
    );
    expect(r.semanticOutcome).toBe('STALE_RESOURCE');
    expect(r.semanticOutcome).not.toBe('VERIFIED_SUCCESS');
  });

  it('JOURNAL-B8-07 (at-most-once): a replay of a completed post is duplicate-suppressed — the effect runs exactly once', async () => {
    const { w, args } = world();
    const ports = createJournalPostPorts();
    const first = await governedJournalPost(args({ ports }));
    expect(first.semanticOutcome).toBe('VERIFIED_SUCCESS');
    const second = await governedJournalPost(args({ ports }));
    expect(second.outcome.duplicateSuppressed).toBe(true);
    expect(w.effectCalls).toBe(1);
    expect(w.rev).toBe(4); // one write, ever
  });

  it('JOURNAL-B8-08 (restart durability): the durable idempotency file suppresses a replay in a NEW process lifetime', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'np-jpost-idem-'));
    const file = join(dir, 'journal-post-transitions.json');
    const { w, args } = world();
    const first = await governedJournalPost(args({ ports: createJournalPostPorts(new DurableIdempotencyStore(file)) }));
    expect(first.semanticOutcome).toBe('VERIFIED_SUCCESS');
    // A fresh DurableIdempotencyStore over the same file = the restarted process.
    const second = await governedJournalPost(args({ ports: createJournalPostPorts(new DurableIdempotencyStore(file)) }));
    expect(second.outcome.duplicateSuppressed).toBe(true);
    expect(w.effectCalls).toBe(1);
  });
});

/* ─────────────────── module-level pins (the real post door) ─────────────────── */

describe('JOURNAL-B8 · runAction("post") — governance is LOAD-BEARING at the one write door', () => {
  let dir: string;
  let accounts: EnterpriseModule;
  let journal: EnterpriseModule;
  let outcomes: JournalPostOutcomeEvent[];
  let ctx: EnterpriseModuleActionContext;

  const createAccount = (code: string, name: string, cls: string): EnterpriseEntity => {
    const v = accounts.hooks.validate({ fields: { code, name, class: cls, currency: 'USD' } });
    if (!v.ok) throw new Error(JSON.stringify(v.errors));
    return accounts.store.create({ title: code, fields: v.values, actor: 't@np', now: T0 });
  };

  const draftEntry = (entryNumber: string, lines: unknown): EnterpriseEntity => {
    const v = journal.hooks.validate({
      fields: { entryNumber, memo: 'test', lines: JSON.stringify(lines), status: 'draft' },
    });
    if (!v.ok) throw new Error(JSON.stringify(v.errors));
    return journal.store.create({ title: entryNumber, fields: v.values, actor: 't@np', now: T0 });
  };

  const BALANCED = [
    { account: '1000', debit: 100, credit: 0 },
    { account: '4000', debit: 0, credit: 100 },
  ];

  function buildCtx(actor: () => string | null): EnterpriseModuleActionContext {
    return {
      actor,
      now: () => T0,
      authorize: () => undefined,
      moduleFor: (id: string) =>
        id === LEDGER_ACCOUNTS_MODULE_ID ? accounts : id === JOURNAL_ENTRIES_MODULE_ID ? journal : null,
      emit: () => undefined,
    };
  }

  beforeEach(async () => {
    dir = join(tmpdir(), `np-jpost-${randomUUID()}`);
    await fs.mkdir(dir, { recursive: true });
    accounts = createLedgerAccountModule(join(dir, 'accounts.json'));
    outcomes = [];
    journal = createJournalEntryModule(join(dir, 'journal.json'), accounts.store, {
      onOutcome: (ev) => {
        outcomes.push(ev);
      },
    });
    await accounts.store.load();
    await journal.store.load();
    createAccount('1000', 'Cash', 'asset');
    createAccount('4000', 'Revenue', 'revenue');
    ctx = buildCtx(() => 't@np');
  });

  afterEach(async () => {
    await accounts.store.flush();
    await journal.store.flush();
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('JOURNAL-B8-10: a governed post succeeds end-to-end — kernel evidence attached, rev advances by exactly one', async () => {
    const rec = draftEntry('JE-0001', BALANCED);
    const draftRev = rec.rev;
    const result = await journal.hooks.runAction!('post', rec, ctx);
    expect(result.ok, result.message ?? result.error).toBe(true);
    expect(result.message).toBe('Journal entry JE-0001 posted (balanced 100).');
    const row = journal.store.get(rec.id)!;
    expect(String(row.fields.status)).toBe('posted');
    expect(String(row.fields.postedAt)).toBe(T0);
    expect(row.rev).toBe(draftRev + 1);
    // The kernel actually ran and verified — not a bypass with a green message.
    expect(outcomes).toHaveLength(1);
    expect(outcomes[0].result.outcome.verdict).toBe('ALLOW');
    expect(outcomes[0].result.outcome.executed).toBe(true);
    expect(outcomes[0].result.semanticOutcome).toBe('VERIFIED_SUCCESS');
    // SEAM-B.9: per-attempt id — the entry:rev prefix is stable, the suffix is the attempt.
    expect(outcomes[0].result.transitionId).toMatch(new RegExp(`^journal-post:${rec.id}:${draftRev}:`));
    expect(outcomes[0].postedAt).toBe(T0);
  });

  it('JOURNAL-B8-11 (§56 THE LOAD-BEARING TEST): every domain guard satisfied, governance refuses, THE WRITE DOES NOT HAPPEN', async () => {
    const rec = draftEntry('JE-0002', BALANCED);
    const draftRev = rec.rev;
    // Same entry, same accounts, same balance — the ONLY difference is that no
    // session actor exists, so no approval can be minted and the kernel refuses.
    const result = await journal.hooks.runAction!('post', rec, buildCtx(() => null));
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/refused by governance \((HOLD|DENY):/);
    const row = journal.store.get(rec.id)!;
    expect(row.fields.postedAt ?? '').toBe(''); // nothing was written (null and '' are both the absent form)
    expect(String(row.fields.status)).toBe('draft');
    expect(row.rev).toBe(draftRev); // not even a revision tick
    expect(outcomes).toHaveLength(1);
    expect(outcomes[0].result.outcome.executed).toBe(false);
    // The SAME entry posts fine with an actor — proving the refusal above was
    // governance and nothing else.
    const retry = await journal.hooks.runAction!('post', rec, ctx);
    expect(retry.ok).toBe(true);
  });

  it('JOURNAL-B8-12: domain guards refuse BEFORE the kernel — an unbalanced entry never reaches governance', async () => {
    const rec = draftEntry('JE-0003', [
      { account: '1000', debit: 100, credit: 0 },
      { account: '4000', debit: 0, credit: 90 },
    ]);
    const result = await journal.hooks.runAction!('post', rec, ctx);
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/Unbalanced entry/);
    expect(outcomes).toHaveLength(0); // guard order preserved: no kernel run, no evidence row
  });

  it('JOURNAL-B8-13: a second post is refused by the fresh already-posted check without a second kernel run', async () => {
    const rec = draftEntry('JE-0004', BALANCED);
    await journal.hooks.runAction!('post', rec, ctx);
    const again = await journal.hooks.runAction!('post', journal.store.get(rec.id)!, ctx);
    expect(again.ok).toBe(false);
    expect(again.message).toBe('JE-0004 is already posted.');
    expect(outcomes).toHaveLength(1);
  });

  it('JOURNAL-B8-14 (concurrency): two simultaneous posts of one draft produce EXACTLY ONE write', async () => {
    const rec = draftEntry('JE-0005', BALANCED);
    const draftRev = rec.rev;
    const [a, b] = await Promise.all([
      journal.hooks.runAction!('post', rec, ctx),
      journal.hooks.runAction!('post', rec, ctx),
    ]);
    const row = journal.store.get(rec.id)!;
    expect(String(row.fields.status)).toBe('posted');
    expect(row.rev).toBe(draftRev + 1); // exactly one write, ever
    expect([a, b].some((r) => r.ok)).toBe(true);
    // The loser reported an honest non-success or an idempotent replay — never a second write.
  });

  it('JOURNAL-B8-15: the posted row survives a restart (flush → fresh store over the same file)', async () => {
    const rec = draftEntry('JE-0006', BALANCED);
    await journal.hooks.runAction!('post', rec, ctx);
    await journal.store.flush();
    const reopened = new EnterpriseRecordStore(join(dir, 'journal.json'), JOURNAL_ENTRIES_MODULE_ID, JOURNAL_ENTRY_KIND);
    await reopened.load();
    const row = reopened.get(rec.id)!;
    expect(String(row.fields.status)).toBe('posted');
    expect(String(row.fields.postedAt)).toBe(T0);
  });

  it('JOURNAL-B8-16: an evidence-observer failure NEVER blocks or alters the post (§2 #19/#29)', async () => {
    journal = createJournalEntryModule(join(dir, 'journal2.json'), accounts.store, {
      onOutcome: () => {
        throw new Error('observer down');
      },
    });
    await journal.store.load();
    const rec = draftEntry('JE-0007', BALANCED);
    const result = await journal.hooks.runAction!('post', rec, ctx);
    expect(result.ok).toBe(true);
    expect(String(journal.store.get(rec.id)!.fields.status)).toBe('posted');
  });
});

/* ─────────────── evidence pins (the REAL ActionRecord store) ─────────────── */

describe('JOURNAL-B8 · recordJournalPostEvidence — durable evidence, read back from the store', () => {
  const WS = 'ws-jpost-evidence';

  beforeEach(() => {
    actionRecord.useDirForTests(mkdtempSync(join(tmpdir(), 'np-jpost-ar-')));
  });

  function event(over: Partial<JournalPostOutcomeEvent> = {}): JournalPostOutcomeEvent {
    return {
      entryId: 'je-ev-1',
      entryNumber: 'JE-0100',
      actor: 'user@np.test',
      tenantId: 'org-1',
      workspaceId: WS,
      expectedRev: 2,
      postedAt: T0,
      result: {
        semanticOutcome: 'VERIFIED_SUCCESS',
        transitionId: 'journal-post:je-ev-1:2',
        requestId: 'req:abc:123',
        outcome: {
          transitionId: 'journal-post:je-ev-1:2',
          verdict: 'ALLOW',
          executed: true,
        } as unknown as JournalPostOutcomeEvent['result']['outcome'],
      },
      ...over,
    };
  }

  it('JOURNAL-B8-20: a verified post lands ONE durable row with an attached VERIFIED_SUCCESS terminal and the row\'s own effect time', async () => {
    await recordJournalPostEvidence(event());
    const rows = await actionRecord.query({ tenantId: WS, transitionId: 'journal-post:je-ev-1:2' });
    expect(rows).toHaveLength(1);
    expect(rows[0].actionId).toBe('journal.post');
    expect(rows[0].connectorId).toBe('enterprise:finance-journal-entries');
    expect(rows[0].actor).toBe('user@np.test');
    expect(rows[0].verdict).toBe('ALLOW');
    expect(rows[0].executed).toBe(true);
    expect(rows[0].outcome).toBe('VERIFIED_SUCCESS');
    expect(rows[0].verification?.terminal).toBe('VERIFIED_SUCCESS');
    expect(rows[0].verification?.effectTime).toBe(T0); // the durable row's stamped instant, verbatim
    expect(rows[0].verification?.provenance?.oracle).toBe('enterpriseRecordStore:finance-journal-entries');
  });

  it('JOURNAL-B8-21: a governance refusal lands as evidence WITHOUT a verification terminal — a refusal is not a verified failure (§2 #19)', async () => {
    await recordJournalPostEvidence(
      event({
        postedAt: null,
        result: {
          semanticOutcome: 'HOLD',
          transitionId: 'journal-post:je-ev-2:2',
          requestId: 'req:def:456',
          outcome: {
            transitionId: 'journal-post:je-ev-2:2',
            verdict: 'HOLD',
            executed: false,
          } as unknown as JournalPostOutcomeEvent['result']['outcome'],
        },
      }),
    );
    const rows = await actionRecord.query({ tenantId: WS, transitionId: 'journal-post:je-ev-2:2' });
    expect(rows).toHaveLength(1);
    expect(rows[0].executed).toBe(false);
    expect(rows[0].verification).toBeNull();
  });

  it('JOURNAL-B8-22 (§2 #27, consumer-derived): journal rows are INVISIBLE to the M365 reconciler — the real predicate says so', async () => {
    await recordJournalPostEvidence(event());
    const rows = await actionRecord.query({ tenantId: WS });
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(awaitingVerification(row)).toBe(false);
    }
  });
});
