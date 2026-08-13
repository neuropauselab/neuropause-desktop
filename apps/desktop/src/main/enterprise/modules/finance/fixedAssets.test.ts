import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  FIXED_ASSETS_MODULE_ID,
  JOURNAL_ENTRIES_MODULE_ID,
  LEDGER_ACCOUNTS_MODULE_ID,
  faDisposalLines,
  glAccountFromRecord,
  nextDepreciation,
  nextPeriodKey,
  straightLineSchedule,
  fixedAssetFromRecord,
  type EnterpriseEntity,
} from '@neuropause/shared';
import type { EnterpriseModule, EnterpriseModuleActionContext } from '../../framework';
import { createLedgerAccountModule } from './ledgerAccountModule';
import { createJournalEntryModule } from './journalEntryModule';
import { createFixedAssetModule } from './fixedAssetModule';

const T0 = '2026-08-05T00:00:00.000Z';

describe('straight-line schedule (pure, exact totals)', () => {
  it('spreads cost−salvage with the final month absorbing the remainder', () => {
    const s = straightLineSchedule({ acquisitionCost: 1000, salvageValue: 100, usefulLifeMonths: 7 });
    expect(s).toHaveLength(7);
    expect(s[0]).toBe(128.57);
    expect(Math.round(s.reduce((a, b) => a + b, 0) * 100) / 100).toBe(900); // exact
    expect(s[6]).toBe(128.58); // remainder month
    expect(straightLineSchedule({ acquisitionCost: 100, salvageValue: 100, usefulLifeMonths: 5 })).toEqual([0, 0, 0, 0, 0]);
    expect(straightLineSchedule({ acquisitionCost: 100, salvageValue: 0, usefulLifeMonths: 0 })).toEqual([]);
  });
  it('nextPeriodKey walks months and starts at acquisition', () => {
    expect(nextPeriodKey('', '2026-08-15')).toBe('2026-08');
    expect(nextPeriodKey('2026-08', '')).toBe('2026-09');
    expect(nextPeriodKey('2026-12', '')).toBe('2027-01');
  });
  it('faDisposalLines books the exact gain or loss and always balances', () => {
    const loss = faDisposalLines({ acquisitionCost: 1000, accumulatedDepreciation: 600, proceeds: 300 });
    const balance = (lines: { debit: number; credit: number }[]) =>
      Math.round(lines.reduce((s, l) => s + l.debit - l.credit, 0) * 100);
    expect(balance(loss)).toBe(0);
    expect(loss.find((l) => l.account === '5200')?.debit).toBe(100); // 400 book − 300 proceeds
    const gain = faDisposalLines({ acquisitionCost: 1000, accumulatedDepreciation: 600, proceeds: 550 });
    expect(balance(gain)).toBe(0);
    expect(gain.find((l) => l.account === '4100')?.credit).toBe(150);
  });
});

describe('Fixed Assets module over real stores', () => {
  let dir: string;
  let accounts: EnterpriseModule;
  let journal: EnterpriseModule;
  let assets: EnterpriseModule;
  let ctx: EnterpriseModuleActionContext;

  beforeEach(async () => {
    dir = join(tmpdir(), `np-fa-${randomUUID()}`);
    await fs.mkdir(dir, { recursive: true });
    accounts = createLedgerAccountModule(join(dir, 'accounts.json'));
    journal = createJournalEntryModule(join(dir, 'journal.json'), accounts.store);
    assets = createFixedAssetModule(join(dir, 'assets.json'));
    await Promise.all([accounts.store.load(), journal.store.load(), assets.store.load()]);
    ctx = {
      actor: () => 't@np',
      now: () => T0,
      authorize: () => undefined,
      moduleFor: (id: string) =>
        id === LEDGER_ACCOUNTS_MODULE_ID ? accounts
        : id === JOURNAL_ENTRIES_MODULE_ID ? journal
        : id === FIXED_ASSETS_MODULE_ID ? assets
        : null,
      emit: () => undefined,
    };
  });

  afterEach(async () => {
    await Promise.all([accounts.store.flush(), journal.store.flush(), assets.store.flush()]);
    await fs.rm(dir, { recursive: true, force: true });
  });

  const balanceOf = (code: string): number => {
    const holder = accounts.store.list().find((r) => String(r.fields.code) === code);
    return holder ? glAccountFromRecord(holder).balance : 0;
  };

  const draftAsset = (fields: Record<string, unknown>): EnterpriseEntity => {
    const v = assets.hooks.validate({
      fields: { assetNumber: 'FA-1', assetName: 'CNC', acquisitionCost: 1200, acquisitionDate: '2026-08-01', usefulLifeMonths: 12, salvageValue: 0, status: 'draft', ...fields },
    });
    expect(v.ok, JSON.stringify('errors' in v ? v.errors : {})).toBe(true);
    if (!v.ok) throw new Error('unreachable');
    return assets.store.create({ title: 'FA-1', fields: v.values, actor: 't@np', now: T0 });
  };

  it('refuses bad drafts and forged status', () => {
    expect(assets.hooks.validate({ fields: { assetNumber: 'X', assetName: 'X', acquisitionCost: 0, acquisitionDate: '2026-08-01', usefulLifeMonths: 12 } }).ok).toBe(false);
    expect(assets.hooks.validate({ fields: { assetNumber: 'X', assetName: 'X', acquisitionCost: 100, acquisitionDate: '2026-08-01', usefulLifeMonths: 12, salvageValue: 100 } }).ok).toBe(false);
    const rec = draftAsset({});
    expect(rec.fields.status).toBe('draft');
    expect(fixedAssetFromRecord(rec).status).toBe('draft');
  });

  it('capitalize books the asset, depreciation walks the schedule idempotently, statements integrate', async () => {
    const rec = draftAsset({});
    const cap = await assets.hooks.runAction!('capitalize', rec, ctx);
    expect(cap.ok, JSON.stringify(cap)).toBe(true);
    expect(balanceOf('1500')).toBe(1200);
    expect(balanceOf('1000')).toBe(-1200);
    // Capitalized assets are immutable through the validated path.
    expect(assets.hooks.validate({ fields: { ...assets.store.get(rec.id)!.fields } }).ok).toBe(false);
    // Post two months: 100 each (1200/12).
    await assets.hooks.runAction!('postDepreciation', assets.store.get(rec.id)!, ctx);
    await assets.hooks.runAction!('postDepreciation', assets.store.get(rec.id)!, ctx);
    const after = fixedAssetFromRecord(assets.store.get(rec.id)!);
    expect(after.accumulatedDepreciation).toBe(200);
    expect(after.bookValue).toBe(1000);
    expect(after.depreciatedThroughPeriod).toBe('2026-09');
    expect(balanceOf('5100')).toBe(200); // expense
    expect(balanceOf('1590')).toBe(-200); // contra-asset carries credit balance
    // The idempotency key: re-posting the SAME period cannot double-book —
    // the journal refuses the duplicate entry number even if state was stale.
    expect(journal.store.list().filter((r) => String(r.fields.entryNumber).startsWith('JE-FA-FA-1-DEP')).length).toBe(2);
  });

  it('cannot depreciate a draft, past the schedule, or after disposal; disposal books the exact loss', async () => {
    const rec = draftAsset({ acquisitionCost: 300, usefulLifeMonths: 3, assetNumber: 'FA-2' });
    expect((await assets.hooks.runAction!('postDepreciation', rec, ctx)).ok).toBe(false);
    await assets.hooks.runAction!('capitalize', rec, ctx);
    for (let i = 0; i < 3; i++) await assets.hooks.runAction!('postDepreciation', assets.store.get(rec.id)!, ctx);
    const done = await assets.hooks.runAction!('postDepreciation', assets.store.get(rec.id)!, ctx);
    expect(done.ok).toBe(false);
    expect(String(done.message)).toContain('Schedule complete');
    expect(fixedAssetFromRecord(assets.store.get(rec.id)!).bookValue).toBe(0);
    // Fully depreciated, sold for 50 → pure gain.
    assets.store.update(rec.id, { fields: { disposalProceeds: 50 }, actor: 't@np', now: T0 });
    const disp = await assets.hooks.runAction!('dispose', assets.store.get(rec.id)!, ctx);
    expect(disp.ok, JSON.stringify(disp)).toBe(true);
    expect(balanceOf('1500')).toBe(0); // cost removed
    expect(balanceOf('1590')).toBe(0); // accumulated cleared
    expect(balanceOf('4100')).toBe(50); // gain
    expect((await assets.hooks.runAction!('postDepreciation', assets.store.get(rec.id)!, ctx)).ok).toBe(false);
    expect((await assets.hooks.runAction!('dispose', assets.store.get(rec.id)!, ctx)).ok).toBe(false);
  });

  it('nextDepreciation reasons honestly', () => {
    const rec = draftAsset({ assetNumber: 'FA-3' });
    const draft = nextDepreciation(fixedAssetFromRecord(rec));
    expect(draft.ok).toBe(false);
    expect(draft.reason).toContain('not capitalized');
  });
});
