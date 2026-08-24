/**
 * SEAM-B.9 / GATE-R.3 — THE JOURNAL COMPOSITION-ROOT PIN.
 *
 * This file executes the REAL production composition file
 * `journalEntryModuleInstance.ts` — the exact singleton that frozen
 * `enterprise/index.ts:132` imports and `:1264` registers — against a
 * throwaway temp userData dir. It is a COMPOSITION TEST in the §13 hierarchy:
 * it proves the production CONSTRUCTION graph (durable idempotency file +
 * ActionRecord evidence observer + governed kernel), NOT the Electron runtime
 * boundary. The runtime level (real app boot, real registry, real dispatch)
 * remains unexecuted — see the B.9 evidence document. Labeled accordingly:
 * NON-RUNTIME, NON-PRODUCTION-DATA evidence.
 *
 * Contrast with `reconciliation/compositionRoot.test.ts`: that root is blocked
 * (its graph pulls frozen `enterprise/index.ts`, unimportable under vitest).
 * THIS root's import graph was measured free of `enterprise/index` — the
 * journal instance graph is electron + shared + framework + module files —
 * so this composition root IS executable, with `electron` mocked at the
 * platform boundary only (the established `firstRealSendGuard.test.ts`
 * pattern; the mock substitutes `app.getPath`, nothing else).
 *
 * §2 #17: everything below the electron mock is the real path — the real
 * singleton, the real DurableIdempotencyStore over its production-named file,
 * the real ActionRecord store, the real read-back over persisted bytes.
 */
import { describe, it, expect, beforeAll, vi } from 'vitest';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

// The temp userData the mocked electron returns. vi.hoisted so the mock
// factory can reference it; built from process.env only (no imports are
// available inside the hoisted block).
const USERDATA = vi.hoisted(() =>
  `${process.env.TMPDIR ?? '/tmp'}/np-b9-root-${process.pid}-${Date.now()}`.replace(/\/+/g, '/'),
);
vi.mock('electron', () => ({ app: { getPath: () => USERDATA } }));

import { app } from 'electron';
import { JOURNAL_ENTRIES_MODULE_ID, type EnterpriseEntity } from '@neuropause/shared';
import type { EnterpriseModuleActionContext } from '../../framework';
// THE PRODUCTION COMPOSITION FILES — the same singletons enterprise/index.ts registers.
import { journalEntryModule } from './journalEntryModuleInstance';
import { ledgerAccountModule } from './ledgerAccountModuleInstance';
import { createActionRecordReader } from '../../../connectors/actionRecord';
import { readBackFromDisk } from '../../../reconciliation/readBack';
import { awaitingVerification } from '../../../reconciliation/readBackReconciler';
import { governedJournalPost } from './journalPostTransition';

const T0 = '2026-08-24T09:00:00.000Z';
const ACTOR = 'b9@np.test';

function buildCtx(actor: () => string | null): EnterpriseModuleActionContext {
  return {
    actor,
    now: () => T0,
    authorize: () => undefined,
    moduleFor: (id: string) =>
      id === JOURNAL_ENTRIES_MODULE_ID
        ? journalEntryModule
        : id === ledgerAccountModule.descriptor.id
          ? ledgerAccountModule
          : null,
    emit: () => undefined,
  };
}

const BALANCED = [
  { account: '1000', debit: 100, credit: 0 },
  { account: '4000', debit: 0, credit: 100 },
];

function draftEntry(entryNumber: string): EnterpriseEntity {
  const v = journalEntryModule.hooks.validate({
    fields: { entryNumber, memo: 'b9', lines: JSON.stringify(BALANCED), status: 'draft' },
  });
  if (!v.ok) throw new Error(JSON.stringify(v.errors));
  return journalEntryModule.store.create({ title: entryNumber, fields: v.values, actor: ACTOR, now: T0 });
}

/** The disk truth, read through a FRESH reader — never the live singleton (§22). */
async function diskRows(wsKey: string) {
  return createActionRecordReader(USERDATA).query({ tenantId: wsKey });
}

describe('JOURNAL-B9 · the production composition root, executed (COMPOSITION level — not runtime)', () => {
  let draft: EnterpriseEntity;
  let draftRev: number;
  let wsKey: string;

  beforeAll(async () => {
    mkdirSync(USERDATA, { recursive: true });
    await ledgerAccountModule.store.load();
    await journalEntryModule.store.load();
    for (const [code, name, cls] of [
      ['1000', 'Cash', 'asset'],
      ['4000', 'Revenue', 'revenue'],
    ] as const) {
      const v = ledgerAccountModule.hooks.validate({ fields: { code, name, class: cls, currency: 'USD' } });
      if (!v.ok) throw new Error(JSON.stringify(v.errors));
      ledgerAccountModule.store.create({ title: code, fields: v.values, actor: ACTOR, now: T0 });
    }
    draft = draftEntry('JE-B9-01');
    draftRev = draft.rev;
    // The evidence key is whatever the row actually carries (F-P45: a WORKSPACE id).
    wsKey = draft.workspaceId ?? '';
  });

  it('JOURNAL-B9-01: the production instance constructs against the platform boundary — same userData, right module', () => {
    expect(app.getPath('userData')).toBe(USERDATA);
    expect(journalEntryModule.descriptor.id).toBe(JOURNAL_ENTRIES_MODULE_ID);
    expect(typeof journalEntryModule.hooks.runAction).toBe('function');
  });

  it('JOURNAL-B9-02 (§17, through the production instance): domain guards satisfied, no actor — governance refuses, NOTHING is written', async () => {
    const result = await journalEntryModule.hooks.runAction!('post', draft, buildCtx(() => null));
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/refused by governance \((HOLD|DENY):/);
    const row = journalEntryModule.store.get(draft.id)!;
    expect(row.fields.postedAt ?? '').toBe('');
    expect(String(row.fields.status)).toBe('draft');
    expect(row.rev).toBe(draftRev);
    // The refusal is durable evidence — one row, not executed, NO terminal.
    // MEASURED (B.9): an empty actor is refused at the POLICY stage — DENY
    // AUTHORIZATION_FAILURE (empty grant set), which fires BEFORE the approval
    // stage's HOLD. Stricter than B.8's "HOLD APPROVAL_REQUIRED" phrasing.
    const rows = (await diskRows(wsKey)).filter((r) => r.actionId === 'journal.post');
    expect(rows).toHaveLength(1);
    expect(rows[0].executed).toBe(false);
    expect(rows[0].outcome).toBe('DENY');
    expect(rows[0].verdict).toBe('DENY');
    expect(rows[0].verification).toBeNull();
  });

  it('JOURNAL-B9-03 (§18): the same entry posts with an actor — exactly one revision advance', async () => {
    const result = await journalEntryModule.hooks.runAction!('post', draft, buildCtx(() => ACTOR));
    expect(result.ok, result.message ?? result.error).toBe(true);
    const row = journalEntryModule.store.get(draft.id)!;
    expect(String(row.fields.status)).toBe('posted');
    expect(String(row.fields.postedAt)).toBe(T0);
    expect(row.rev).toBe(draftRev + 1);
  });

  it('JOURNAL-B9-04 (§6/§7 load-bearing): the DURABLE idempotency file exists at the production-named path with a DONE intent', () => {
    const file = join(USERDATA, 'journal-post-transitions.json');
    expect(existsSync(file)).toBe(true);
    const parsed = JSON.parse(readFileSync(file, 'utf8')) as {
      version: number;
      records: Record<string, { state: string }>;
    };
    const states = Object.values(parsed.records).map((r) => r.state);
    expect(states).toContain('DONE');
    // In-memory default ports would have left NO file — this is the §6 distinction.
  });

  it('JOURNAL-B9-05 (§8): the successful post landed ONE evidence row with its OWN terminal — and the refusal row kept NONE', async () => {
    const rows = (await diskRows(wsKey)).filter((r) => r.actionId === 'journal.post');
    expect(rows).toHaveLength(2); // the refusal + the success — separate attempts, separate rows
    const success = rows.filter((r) => r.outcome === 'VERIFIED_SUCCESS');
    const refusal = rows.filter((r) => r.outcome === 'DENY');
    expect(success).toHaveLength(1);
    expect(refusal).toHaveLength(1);
    // The terminal belongs to the attempt that earned it — never to the refusal.
    expect(success[0].verification?.terminal).toBe('VERIFIED_SUCCESS');
    expect(success[0].verification?.effectTime).toBe(T0);
    expect(success[0].verification?.provenance?.oracle).toBe('enterpriseRecordStore:finance-journal-entries');
    expect(success[0].actor).toBe(ACTOR);
    expect(success[0].connectorId).toBe('enterprise:finance-journal-entries');
    expect(refusal[0].verification).toBeNull();
    // Attempts must be distinguishable in evidence: distinct transition ids.
    expect(success[0].transitionId).not.toBe(refusal[0].transitionId);
  });

  it('JOURNAL-B9-06 (§22): the canonical read-back reconstructs VERIFIED_SUCCESS from persisted bytes via a fresh reader', async () => {
    const rows = (await diskRows(wsKey)).filter((r) => r.actionId === 'journal.post' && r.outcome === 'VERIFIED_SUCCESS');
    const report = await readBackFromDisk(USERDATA, wsKey, { transitionId: rows[0].transitionId });
    expect(report.matches).toBe(1);
    expect(report.rows[0].finalStatus).toBe('VERIFIED_SUCCESS');
  });

  it('JOURNAL-B9-07 (§20 at the door): a repeat post is refused without a second write or a second kernel run', async () => {
    const again = await journalEntryModule.hooks.runAction!('post', journalEntryModule.store.get(draft.id)!, buildCtx(() => ACTOR));
    expect(again.ok).toBe(false);
    expect(again.message).toBe('JE-B9-01 is already posted.');
    expect(journalEntryModule.store.get(draft.id)!.rev).toBe(draftRev + 1);
    const rows = (await diskRows(wsKey)).filter((r) => r.actionId === 'journal.post');
    expect(rows).toHaveLength(2); // no third evidence row — the door refused before the kernel
  });

  it('JOURNAL-B9-08 (§9, consumer-derived §2 #27): every journal row is invisible to the M365 reconciler — the REAL predicate says so', async () => {
    const rows = await diskRows(wsKey);
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) expect(awaitingVerification(row)).toBe(false);
  });

  it('JOURNAL-B9-09 (§26): the policy-version LABEL grants nothing — a permissive-sounding label still refuses without an actor', async () => {
    let effectRan = 0;
    const r = await governedJournalPost({
      entryId: 'je-label',
      entryNumber: 'JE-LABEL',
      tenantId: 'org-x',
      actorId: '',
      expectedRev: 1,
      policyVersion: 'totally-permissive-policy-9000',
      effect: async () => {
        effectRan += 1;
        return { accepted: true, wrote: true, stale: false };
      },
      observe: () => ({ posted: true, rev: 2 }),
    });
    expect(['HOLD', 'DENY']).toContain(r.semanticOutcome);
    expect(effectRan).toBe(0);
  });
});
