import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  ACCOUNTING_PERIODS_MODULE_ID,
  JOURNAL_ENTRIES_MODULE_ID,
  LEDGER_ACCOUNTS_MODULE_ID,
  glDateInClosedPeriod,
  glJournalEntryFromRecord,
  glPeriodBounds,
  glPeriodFromRecord,
  glPeriodKeyForDate,
  type EnterpriseEntity,
} from '@neuropause/shared';
import type { EnterpriseModule, EnterpriseModuleActionContext } from '../../framework';
import { createAccountingPeriodModule } from './accountingPeriodModule';
import { createLedgerAccountModule } from './ledgerAccountModule';
import { createJournalEntryModule } from './journalEntryModule';

const T0 = '2026-08-05T00:00:00.000Z';

describe('period key + bounds (pure)', () => {
  it('derives YYYY-MM keys and month bounds', () => {
    expect(glPeriodKeyForDate('2026-08-05')).toBe('2026-08');
    expect(glPeriodKeyForDate('2026-08-05T10:00:00Z')).toBe('2026-08');
    expect(glPeriodKeyForDate('nope')).toBe('');
    expect(glPeriodBounds('2026-02')).toEqual({ startDate: '2026-02-01', endDate: '2026-02-28' });
    expect(glPeriodBounds('2028-02')).toEqual({ startDate: '2028-02-01', endDate: '2028-02-29' });
    expect(glPeriodBounds('2026-12')).toEqual({ startDate: '2026-12-01', endDate: '2026-12-31' });
  });
});

describe('Accounting Periods module + the journal close guard', () => {
  let dir: string;
  let accounts: EnterpriseModule;
  let journal: EnterpriseModule;
  let periods: EnterpriseModule;
  let ctx: EnterpriseModuleActionContext;

  const createAccount = (code: string, cls: string): void => {
    const v = accounts.hooks.validate({ fields: { code, name: code, class: cls, currency: 'USD' } });
    expect(v.ok).toBe(true);
    if (v.ok) accounts.store.create({ title: code, fields: v.values, actor: 't@np', now: T0 });
  };

  const draftEntry = (entryNumber: string, entryDate: string): EnterpriseEntity => {
    const v = journal.hooks.validate({
      fields: {
        entryNumber,
        entryDate,
        lines: '[{"account":"1000","debit":10,"credit":0},{"account":"4000","debit":0,"credit":10}]',
        status: 'draft',
      },
    });
    expect(v.ok, JSON.stringify('errors' in v ? v.errors : {})).toBe(true);
    if (!v.ok) throw new Error('unreachable');
    return journal.store.create({ title: entryNumber, fields: v.values, actor: 't@np', now: T0 });
  };

  const createPeriod = (periodKey: string): EnterpriseEntity => {
    const v = periods.hooks.validate({ fields: { periodKey } });
    expect(v.ok, JSON.stringify('errors' in v ? v.errors : {})).toBe(true);
    if (!v.ok) throw new Error('unreachable');
    return periods.store.create({ title: periodKey, fields: v.values, actor: 't@np', now: T0 });
  };

  beforeEach(async () => {
    dir = join(tmpdir(), `np-glperiods-${randomUUID()}`);
    await fs.mkdir(dir, { recursive: true });
    accounts = createLedgerAccountModule(join(dir, 'accounts.json'));
    journal = createJournalEntryModule(join(dir, 'journal.json'), accounts.store);
    periods = createAccountingPeriodModule(join(dir, 'periods.json'));
    await Promise.all([accounts.store.load(), journal.store.load(), periods.store.load()]);
    createAccount('1000', 'asset');
    createAccount('4000', 'revenue');
    ctx = {
      actor: () => 't@np',
      now: () => T0,
      authorize: () => undefined,
      moduleFor: (id: string) =>
        id === LEDGER_ACCOUNTS_MODULE_ID
          ? accounts
          : id === JOURNAL_ENTRIES_MODULE_ID
            ? journal
            : id === ACCOUNTING_PERIODS_MODULE_ID
              ? periods
              : null,
      emit: () => undefined,
    };
  });

  afterEach(async () => {
    await Promise.all([accounts.store.flush(), journal.store.flush(), periods.store.flush()]);
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('stamps bounds + label from the key, rejects bad keys and forged closedAt', () => {
    const rec = createPeriod('2026-08');
    expect(rec.fields.startDate).toBe('2026-08-01');
    expect(rec.fields.endDate).toBe('2026-08-31');
    expect(rec.fields.label).toBe('August 2026');
    expect(rec.fields.status).toBe('open');
    expect(periods.hooks.validate({ fields: { periodKey: '2026-13' } }).ok).toBe(false);
    expect(periods.hooks.validate({ fields: { periodKey: 'Q3-2026' } }).ok).toBe(false);
    expect(periods.hooks.validate({ fields: { periodKey: '2026-08', closedAt: T0 } }).ok).toBe(false);
  });

  it('close/reopen are guarded transitions that stamp and clear the audit fields', async () => {
    const rec = createPeriod('2026-08');
    const closed = await periods.hooks.runAction!('close', rec, ctx);
    expect(closed.ok).toBe(true);
    const view = glPeriodFromRecord(periods.store.get(rec.id)!);
    expect(view.closed).toBe(true);
    expect(view.closedAt).toBe(T0);
    expect(view.closedBy).toBe('t@np');
    expect((await periods.hooks.runAction!('close', periods.store.get(rec.id)!, ctx)).ok).toBe(false);
    // Closed periods are immutable through the validated update path.
    expect(periods.hooks.validate({ fields: { ...periods.store.get(rec.id)!.fields } }).ok).toBe(false);
    const reopened = await periods.hooks.runAction!('reopen', periods.store.get(rec.id)!, ctx);
    expect(reopened.ok).toBe(true);
    expect(glPeriodFromRecord(periods.store.get(rec.id)!).closed).toBe(false);
    expect(glDateInClosedPeriod('2026-08-15', [glPeriodFromRecord(periods.store.get(rec.id)!)])).toBe(false);
  });

  it('posting into a closed period is refused; the entry stays a draft', async () => {
    const rec = createPeriod('2026-07');
    await periods.hooks.runAction!('close', rec, ctx);
    const je = draftEntry('JE-1', '2026-07-20');
    const result = await journal.hooks.runAction!('post', je, ctx);
    expect(result.ok).toBe(false);
    expect(String(result.message)).toContain('2026-07 is closed');
    expect(glJournalEntryFromRecord(journal.store.get(je.id)!).posted).toBe(false);
    // Reopen → the same entry posts.
    await periods.hooks.runAction!('reopen', periods.store.get(rec.id)!, ctx);
    const retry = await journal.hooks.runAction!('post', journal.store.get(je.id)!, ctx);
    expect(retry.ok, JSON.stringify(retry)).toBe(true);
  });

  it('posting into a month with no period record auto-creates it OPEN and stamps the booked date', async () => {
    const je = draftEntry('JE-2', '');
    const result = await journal.hooks.runAction!('post', je, ctx);
    expect(result.ok, JSON.stringify(result)).toBe(true);
    const posted = journal.store.get(je.id)!;
    expect(posted.fields.entryDate).toBe('2026-08-05'); // stamped from now()
    const auto = periods.store.list().map(glPeriodFromRecord).find((p) => p.periodKey === '2026-08');
    expect(auto).toBeDefined();
    expect(auto!.closed).toBe(false);
  });
});
