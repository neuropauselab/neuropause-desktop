/**
 * Finance → FW-9 Declining-Balance Depreciation — the pure written-down-value
 * schedule (declining amounts, salvage clamp, exact final-month termination),
 * the method dispatch (an asset that never chose a method is straight-line,
 * byte-identically as before), the module's rate guard, and the integration
 * proof: capitalize → post two declining months through the real GL seam with
 * the amounts, accumulated total, and idempotent journal entries all exact.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  FIXED_ASSETS_MODULE_ID,
  JOURNAL_ENTRIES_MODULE_ID,
  LEDGER_ACCOUNTS_MODULE_ID,
  decliningBalanceSchedule,
  depreciationSchedule,
  straightLineSchedule,
  type EnterpriseEntity,
} from '@neuropause/shared';
import type { EnterpriseModule, EnterpriseModuleActionContext } from '../../framework';
import { createLedgerAccountModule } from './ledgerAccountModule';
import { createJournalEntryModule } from './journalEntryModule';
import { createFixedAssetModule } from './fixedAssetModule';

const T0 = '2026-08-07T00:00:00.000Z';
const sum = (xs: number[]) => Math.round(xs.reduce((a, b) => a + b, 0) * 100) / 100;

describe('declining-balance schedule (pure, exact termination)', () => {
  it('depreciates the month-start book value at the annual rate, amounts strictly declining', () => {
    // 1200 over 12 months at 100%/yr → 8.333…%/month of a shrinking base.
    const s = decliningBalanceSchedule({ acquisitionCost: 1200, salvageValue: 0, usefulLifeMonths: 12, annualRatePct: 100 });
    expect(s).toHaveLength(12);
    expect(s[0]).toBe(100); // 1200 × 100%/12
    expect(s[1]).toBe(91.67); // 1100 × 100%/12
    expect(s[2]).toBe(84.03); // 1008.33 × 100%/12
    for (let i = 1; i < s.length - 1; i++) expect(s[i]).toBeLessThan(s[i - 1]); // declining, front-loaded
    expect(sum(s)).toBe(1200); // exact — the final month closes the book to salvage
    expect(s[11]).toBeGreaterThan(s[10]); // the visible, deliberate terminal sweep
  });

  it('never breaches salvage even at aggressive rates; degenerate inputs stay honest', () => {
    const s = decliningBalanceSchedule({ acquisitionCost: 1000, salvageValue: 200, usefulLifeMonths: 6, annualRatePct: 300 });
    expect(s[0]).toBe(250); // 25%/month of 1000
    let bv = 1000;
    for (const m of s) {
      bv = Math.round((bv - m) * 100) / 100;
      expect(bv).toBeGreaterThanOrEqual(200); // the clamp
    }
    expect(bv).toBe(200); // and the terminal exactness
    expect(sum(s)).toBe(800);
    expect(decliningBalanceSchedule({ acquisitionCost: 100, salvageValue: 100, usefulLifeMonths: 4, annualRatePct: 40 })).toEqual([0, 0, 0, 0]);
    expect(decliningBalanceSchedule({ acquisitionCost: 100, salvageValue: 0, usefulLifeMonths: 0, annualRatePct: 40 })).toEqual([]);
  });

  it('method dispatch: no method (or straight_line) = the straight-line schedule byte-identically', () => {
    const base = { acquisitionCost: 900, salvageValue: 0, usefulLifeMonths: 7 };
    expect(depreciationSchedule(base)).toEqual(straightLineSchedule(base));
    expect(depreciationSchedule({ ...base, depreciationMethod: 'straight_line' })).toEqual(straightLineSchedule(base));
    const db = depreciationSchedule({ ...base, depreciationMethod: 'declining_balance', decliningRatePct: 60 });
    expect(db).not.toEqual(straightLineSchedule(base));
    expect(sum(db)).toBe(900); // both methods share the exact-total contract
  });
});

describe('Fixed Assets module with declining balance over real stores', () => {
  let dir: string;
  let accounts: EnterpriseModule;
  let journal: EnterpriseModule;
  let assets: EnterpriseModule;
  let ctx: EnterpriseModuleActionContext;

  beforeEach(async () => {
    dir = join(tmpdir(), `np-fadb-${randomUUID()}`);
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
    } as unknown as EnterpriseModuleActionContext;
  });
  afterEach(async () => {
    await Promise.all([accounts.store.flush(), journal.store.flush(), assets.store.flush()]);
    await new Promise((r) => setTimeout(r, 25));
    try {
      await fs.rm(dir, { recursive: true, force: true });
    } catch {
      await new Promise((r) => setTimeout(r, 100));
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it('guards: declining balance without a sane rate refuses; straight-line needs none', () => {
    const base = { assetNumber: 'FA-1', assetName: 'Lathe', acquisitionCost: 1200, acquisitionDate: '2026-08-01', usefulLifeMonths: 12 };
    expect(assets.hooks.validate({ fields: { ...base, depreciationMethod: 'declining_balance' } }).ok).toBe(false);
    expect(assets.hooks.validate({ fields: { ...base, depreciationMethod: 'declining_balance', decliningRatePct: 0 } }).ok).toBe(false);
    expect(assets.hooks.validate({ fields: { ...base, depreciationMethod: 'declining_balance', decliningRatePct: 101 } }).ok).toBe(false);
    expect(assets.hooks.validate({ fields: { ...base, depreciationMethod: 'declining_balance', decliningRatePct: 40 } }).ok).toBe(true);
    expect(assets.hooks.validate({ fields: base }).ok).toBe(true); // straight-line default, no rate
  });

  it('capitalize → two declining months post exactly (100 then 91.67), journal entries idempotent by period', async () => {
    const v = assets.hooks.validate({
      fields: {
        assetNumber: 'FA-DB1', assetName: 'CNC Mill', acquisitionCost: 1200, acquisitionDate: '2026-08-01',
        usefulLifeMonths: 12, salvageValue: 0, depreciationMethod: 'declining_balance', decliningRatePct: 100,
      },
    });
    expect(v.ok, JSON.stringify('errors' in v ? v.errors : {})).toBe(true);
    if (!v.ok) throw new Error('unreachable');
    const rec = assets.store.create({ title: 'FA-DB1', fields: v.values, actor: 't', now: T0 });
    await assets.hooks.runAction!('capitalize', assets.store.get(rec.id)!, ctx);
    const m1 = await assets.hooks.runAction!('postDepreciation', assets.store.get(rec.id)!, ctx);
    expect(m1.ok, JSON.stringify(m1)).toBe(true);
    expect(m1.message).toContain('2026-08');
    expect(m1.message).toContain('100');
    const m2 = await assets.hooks.runAction!('postDepreciation', assets.store.get(rec.id)!, ctx);
    expect(m2.ok).toBe(true);
    expect(m2.message).toContain('2026-09');
    expect(m2.message).toContain('91.67');
    const after = assets.store.get(rec.id)!;
    expect(Number(after.fields.accumulatedDepreciation)).toBe(191.67);
    expect(Number(after.fields.bookValue)).toBe(1008.33);
    expect(String(after.fields.depreciatedThroughPeriod)).toBe('2026-09');
    // Real, distinct journal entries per period through the shared GL seam.
    const entries = journal.store.list().map((r) => String(r.fields.entryNumber));
    expect(entries).toContain('JE-FA-FA-DB1-DEP-2026-08');
    expect(entries).toContain('JE-FA-FA-DB1-DEP-2026-09');
  });

  it('a legacy asset with NO method field depreciates straight-line exactly as before FW-9', async () => {
    // Created around the validate hook (as pre-FW-9 data would be on disk).
    const rec = assets.store.create({
      title: 'FA-OLD',
      fields: {
        assetNumber: 'FA-OLD', assetName: 'Legacy Press', acquisitionCost: 600, acquisitionDate: '2026-08-01',
        usefulLifeMonths: 6, salvageValue: 0, status: 'draft', accumulatedDepreciation: 0, bookValue: 600, depreciatedThroughPeriod: '',
      } as EnterpriseEntity['fields'],
      actor: 't', now: T0,
    });
    await assets.hooks.runAction!('capitalize', assets.store.get(rec.id)!, ctx);
    const m1 = await assets.hooks.runAction!('postDepreciation', assets.store.get(rec.id)!, ctx);
    const m2 = await assets.hooks.runAction!('postDepreciation', assets.store.get(rec.id)!, ctx);
    expect(m1.ok && m2.ok).toBe(true);
    // Straight-line 600/6 = 100 BOTH months — no decline, the pre-FW-9 arithmetic.
    expect(m1.message).toContain('100');
    expect(m2.message).toContain('100');
    expect(Number(assets.store.get(rec.id)!.fields.accumulatedDepreciation)).toBe(200);
  });
});
