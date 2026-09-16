/**
 * S83 — Budget-Variance Intelligence. Two layers:
 *   1. the PURE aggregation model (portfolio totals + health counts + deterministic ordering);
 *   2. the GOVERNED snapshot module through the REAL buildModuleHandlers path over REAL
 *      ledger-account + journal + budget stores — RBAC, tenant isolation, immutability,
 *      deterministic regeneration, source read-only, no-GL-mutation, and the reuse of the
 *      canonical `deriveBudgetActuals` variance (no re-implemented math).
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import {
  IpcChannel,
  glAccountFromRecord,
  type BudgetActuals,
  type EnterpriseEntity,
  type EnterprisePermission,
  type PlatformEventInput,
  type TenantScope,
} from '@neuropause/shared';
import { EnterpriseModuleRegistry, buildModuleHandlers } from '../../framework';
import { createLedgerAccountModule } from './ledgerAccountModule';
import { createJournalEntryModule } from './journalEntryModule';
import { createBudgetModule } from './budgetModule';
import { createBudgetVarianceModule } from './budgetVarianceModule';
import { deriveBudgetVarianceSnapshot, type BudgetVarianceInput } from './budgetVarianceModel';
import { TEST_TENANT_SCOPE, OTHER_TENANT_SCOPE } from '../../../tenancy/testScope';

const actuals = (a: Partial<BudgetActuals>): BudgetActuals => ({
  actualAmount: 0, variance: 0, variancePercent: 0, health: 'no-actuals', hasActivity: false, ...a,
});
const inp = (o: Partial<BudgetVarianceInput> & { budgetId: string; actuals: BudgetActuals }): BudgetVarianceInput => ({
  budgetName: o.budgetName ?? o.budgetId, periodKey: o.periodKey ?? '2026-08',
  accountCode: o.accountCode ?? '5000', budgetAmount: o.budgetAmount ?? 100, ...o,
});

// ─────────────────────────────────────────────────────────────────────────────
// 1. PURE MODEL
// ─────────────────────────────────────────────────────────────────────────────
describe('S83 pure model — variance-register aggregation', () => {
  it('totals + health counts roll up across budgets', () => {
    const snap = deriveBudgetVarianceSnapshot([
      inp({ budgetId: 'b1', accountCode: '5000', budgetAmount: 500, actuals: actuals({ actualAmount: 900, variance: 400, variancePercent: 80, health: 'over', hasActivity: true }) }),
      inp({ budgetId: 'b2', accountCode: '5100', budgetAmount: 800, actuals: actuals({ actualAmount: 780, variance: -20, variancePercent: -2.5, health: 'on-track', hasActivity: true }) }),
      inp({ budgetId: 'b3', accountCode: '4000', budgetAmount: 600, actuals: actuals({ actualAmount: 400, variance: -200, variancePercent: -33, health: 'under', hasActivity: true }) }),
      inp({ budgetId: 'b4', accountCode: '5200', budgetAmount: 300, actuals: actuals({}) }), // no activity
    ], '2026-08-31');
    expect(snap.budgetCount).toBe(4);
    expect(snap.totalBudget).toBe(2200);
    expect(snap.totalActual).toBe(2080);
    expect(snap.totalVariance).toBe(180); // 400 - 20 - 200 + 0
    expect(snap).toMatchObject({ overCount: 1, onTrackCount: 1, underCount: 1, noActualsCount: 1 });
  });

  it('empty in → honestly empty out', () => {
    expect(deriveBudgetVarianceSnapshot([], '2026-08-31')).toMatchObject({ budgetCount: 0, totalBudget: 0, totalVariance: 0, rows: [] });
  });

  it('zero-budget row is passed through verbatim (variancePercent 0 — no invented division)', () => {
    const snap = deriveBudgetVarianceSnapshot([
      inp({ budgetId: 'z', budgetAmount: 0, actuals: actuals({ actualAmount: 50, variance: 50, variancePercent: 0, health: 'over', hasActivity: true }) }),
    ], '2026-08-31');
    expect(snap.rows[0]).toMatchObject({ budgetAmount: 0, actualAmount: 50, variancePercent: 0, variance: 50 });
  });

  it('deterministic ordering (period → account → id) makes regeneration byte-identical', () => {
    const set = [
      inp({ budgetId: 'b-z', periodKey: '2026-09', accountCode: '5000', actuals: actuals({}) }),
      inp({ budgetId: 'b-a', periodKey: '2026-08', accountCode: '5100', actuals: actuals({}) }),
      inp({ budgetId: 'b-m', periodKey: '2026-08', accountCode: '5000', actuals: actuals({}) }),
    ];
    const a = JSON.stringify(deriveBudgetVarianceSnapshot(set, '2026-09-01').rows);
    const b = JSON.stringify(deriveBudgetVarianceSnapshot([...set].reverse(), '2026-09-01').rows);
    expect(a).toBe(b);
    expect(deriveBudgetVarianceSnapshot(set, '2026-09-01').rows.map((r) => `${r.periodKey}/${r.accountCode}`))
      .toEqual(['2026-08/5000', '2026-08/5100', '2026-09/5000']);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. GOVERNED SNAPSHOT MODULE (real ledger + journal + budget stores)
// ─────────────────────────────────────────────────────────────────────────────
describe('S83 governed budget-variance snapshot', () => {
  const T0 = '2026-08-10T00:00:00.000Z';
  const paths: string[] = [];
  let rec: { authorized: EnterprisePermission[]; publish: PlatformEventInput[] };
  let registry: EnterpriseModuleRegistry;
  let handlers: ReturnType<typeof buildModuleHandlers>;
  let accountsStore: EnterpriseRecordStoreLike;
  let journalStore: EnterpriseRecordStoreLike;
  let budgetStore: EnterpriseRecordStoreLike;
  let scope: TenantScope;

  type EnterpriseRecordStoreLike = { list: () => EnterpriseEntity[] };

  function tmp(tag: string): string {
    const p = join(tmpdir(), `np-s83-${tag}-${randomUUID()}.json`);
    paths.push(p);
    return p;
  }
  function spyCtx() {
    return {
      authorize: (p: EnterprisePermission) => rec.authorized.push(p),
      audit: () => undefined,
      publish: (i: PlatformEventInput) => rec.publish.push(i),
      broadcast: () => undefined,
      notify: () => undefined,
      actor: () => 'tester@np.dev',
      now: () => T0,
    };
  }

  beforeEach(() => {
    rec = { authorized: [], publish: [] };
    const accounts = createLedgerAccountModule(tmp('acct'));
    const journal = createJournalEntryModule(tmp('jrnl'), accounts.store);
    const budgets = createBudgetModule(tmp('bud'), journal.store, accounts.store);
    const variance = createBudgetVarianceModule(tmp('var'), budgets.store, journal.store, accounts.store);
    accountsStore = accounts.store;
    journalStore = journal.store;
    budgetStore = budgets.store;
    registry = new EnterpriseModuleRegistry();
    for (const m of [accounts, journal, budgets, variance]) registry.register(m);
    scope = TEST_TENANT_SCOPE;
    registry.bindScope(() => scope);
    handlers = buildModuleHandlers(registry, spyCtx());
  });
  afterEach(async () => {
    for (const p of paths.splice(0)) await fs.rm(p, { force: true }).catch(() => undefined);
  });

  function handler(channel: string): (p: unknown) => unknown | Promise<unknown> {
    const def = handlers.find((d) => d.channel === channel);
    if (!def) throw new Error(`no handler for ${channel}`);
    return def.handler;
  }
  const create = async (moduleId: string, fields: Record<string, unknown>) =>
    (await handler(IpcChannel.EnterpriseModuleCreate)({ moduleId, fields })) as { ok: boolean; record?: EnterpriseEntity; errors?: Record<string, string> };
  const act = async (moduleId: string, id: string, action: string) =>
    (await handler(IpcChannel.EnterpriseModuleAction)({ moduleId, id, action })) as { ok: boolean };
  const list = async (moduleId: string) => (await handler(IpcChannel.EnterpriseModuleList)({ moduleId })) as EnterpriseEntity[];

  /** Post a journal entry (Dr/Cr) into the books in period 2026-08. */
  async function postJournal(entryNumber: string, lines: { account: string; debit: number; credit: number }[]) {
    const je = await create('finance-journal-entries', { entryNumber, entryDate: '2026-08-05', lines: JSON.stringify(lines), status: 'draft' });
    expect(je.ok).toBe(true);
    expect((await act('finance-journal-entries', je.record!.id, 'post')).ok).toBe(true);
  }
  async function seedBooks() {
    for (const a of [
      { code: '5000', name: 'Opex', class: 'expense' },
      { code: '4000', name: 'Sales', class: 'revenue' },
      { code: '1000', name: 'Cash', class: 'asset' },
    ]) expect((await create('finance-ledger-accounts', { ...a, currency: 'USD' })).ok).toBe(true);
  }

  it('RBAC — generating a snapshot authorizes operations:manage; listing authorizes operations:read', async () => {
    await seedBooks();
    rec.authorized.length = 0;
    await create('finance-budget-variance', { asOfDate: '2026-08-31' });
    expect(rec.authorized).toContain('operations:manage');
    rec.authorized.length = 0;
    await list('finance-budget-variance');
    expect(rec.authorized).toEqual(['operations:read']);
  });

  it('empty (no budgets) → an honest empty snapshot', async () => {
    await seedBooks();
    const res = await create('finance-budget-variance', { asOfDate: '2026-08-31' });
    expect(res.ok).toBe(true);
    expect(Number(res.record?.fields.budgetCount)).toBe(0);
    expect(String(res.record?.fields.note)).toMatch(/empty, not fabricated/);
  });

  it('variance arithmetic + favorable/unfavorable reuse deriveBudgetActuals (expense over / revenue under)', async () => {
    await seedBooks();
    await create('finance-budgets', { budgetName: 'Opex Aug', periodKey: '2026-08', accountCode: '5000', budgetAmount: 500 });
    await create('finance-budgets', { budgetName: 'Sales Aug', periodKey: '2026-08', accountCode: '4000', budgetAmount: 600 });
    await postJournal('JE-1', [{ account: '5000', debit: 900, credit: 0 }, { account: '1000', debit: 0, credit: 900 }]); // opex 900 > 500 → over
    await postJournal('JE-2', [{ account: '1000', debit: 400, credit: 0 }, { account: '4000', debit: 0, credit: 400 }]); // revenue 400 < 600 → under

    const res = await create('finance-budget-variance', { asOfDate: '2026-08-31' });
    const rows = JSON.parse(String(res.record?.fields.rows)) as Array<Record<string, unknown>>;
    const opex = rows.find((r) => r.accountCode === '5000')!;
    const sales = rows.find((r) => r.accountCode === '4000')!;
    expect(opex).toMatchObject({ budgetAmount: 500, actualAmount: 900, variance: 400, health: 'over' });
    expect(sales).toMatchObject({ budgetAmount: 600, actualAmount: 400, health: 'under' });
    expect(Number(res.record?.fields.overCount)).toBe(1);
    expect(Number(res.record?.fields.underCount)).toBe(1);
    expect(Number(res.record?.fields.totalBudget)).toBe(1100);
    expect(Number(res.record?.fields.totalActual)).toBe(1300);
  });

  it('a budget with no posted activity is no-actuals (actual 0), never fabricated', async () => {
    await seedBooks();
    await create('finance-budgets', { budgetName: 'Idle', periodKey: '2026-08', accountCode: '5000', budgetAmount: 500 });
    const res = await create('finance-budget-variance', { asOfDate: '2026-08-31' });
    const row = (JSON.parse(String(res.record?.fields.rows)) as Array<Record<string, unknown>>)[0];
    expect(row).toMatchObject({ actualAmount: 0, health: 'no-actuals' });
    expect(Number(res.record?.fields.noActualsCount)).toBe(1);
  });

  it('deterministic regeneration — same books + same as-of ⇒ byte-identical rows', async () => {
    await seedBooks();
    await create('finance-budgets', { budgetName: 'Opex Aug', periodKey: '2026-08', accountCode: '5000', budgetAmount: 500 });
    await postJournal('JE-1', [{ account: '5000', debit: 900, credit: 0 }, { account: '1000', debit: 0, credit: 900 }]);
    const a = await create('finance-budget-variance', { asOfDate: '2026-08-31' });
    const b = await create('finance-budget-variance', { asOfDate: '2026-08-31' });
    expect(String(b.record?.fields.rows)).toBe(String(a.record?.fields.rows));
  });

  it('snapshots are immutable — a generated report cannot be regenerated in place', async () => {
    await seedBooks();
    const res = await create('finance-budget-variance', { asOfDate: '2026-08-31' });
    const upd = (await handler(IpcChannel.EnterpriseModuleUpdate)({ moduleId: 'finance-budget-variance', id: res.record?.id, fields: { totalVariance: 9999 } })) as { ok: boolean };
    expect(upd.ok).toBe(false);
  });

  it('READ-ONLY + no-GL-mutation — books are byte-identical after the snapshot', async () => {
    await seedBooks();
    await create('finance-budgets', { budgetName: 'Opex Aug', periodKey: '2026-08', accountCode: '5000', budgetAmount: 500 });
    await postJournal('JE-1', [{ account: '5000', debit: 900, credit: 0 }, { account: '1000', debit: 0, credit: 900 }]);
    const before = {
      accounts: JSON.stringify(accountsStore.list()),
      journal: JSON.stringify(journalStore.list()),
      budgets: JSON.stringify(budgetStore.list()),
      balance5000: glAccountFromRecord(accountsStore.list().find((r) => String(r.fields.code) === '5000')!).balance,
    };
    await create('finance-budget-variance', { asOfDate: '2026-08-31' });
    await create('finance-budget-variance', { asOfDate: '2026-09-30' });
    expect(JSON.stringify(accountsStore.list())).toBe(before.accounts);
    expect(JSON.stringify(journalStore.list())).toBe(before.journal);
    expect(JSON.stringify(budgetStore.list())).toBe(before.budgets);
    expect(glAccountFromRecord(accountsStore.list().find((r) => String(r.fields.code) === '5000')!).balance).toBe(before.balance5000);
  });

  it('a budget whose account does not resolve is OMITTED, never faked', async () => {
    await seedBooks();
    await create('finance-budgets', { budgetName: 'Good', periodKey: '2026-08', accountCode: '5000', budgetAmount: 500 });
    // Force an unresolvable account by creating a duplicate 5000 (accountClassFor requires exactly one).
    await create('finance-ledger-accounts', { code: '5000', name: 'Opex Dup', class: 'expense', currency: 'USD' });
    const res = await create('finance-budget-variance', { asOfDate: '2026-08-31' });
    expect(res.ok).toBe(true);
    expect(Number(res.record?.fields.budgetCount)).toBe(0); // the one budget's account is now ambiguous → omitted
  });

  it('NO_TENANT fail-closed — generation denies when no scope is bound', async () => {
    await seedBooks();
    scope = null as unknown as TenantScope;
    const res = await create('finance-budget-variance', { asOfDate: '2026-08-31' }).catch(() => ({ ok: false }));
    expect(res.ok).toBe(false);
  });

  it('TENANT ISOLATION — a snapshot sees only the acting tenant’s budgets', async () => {
    scope = TEST_TENANT_SCOPE;
    await seedBooks();
    await create('finance-budgets', { budgetName: 'Opex Aug', periodKey: '2026-08', accountCode: '5000', budgetAmount: 500 });
    const aSnap = await create('finance-budget-variance', { asOfDate: '2026-08-31' });
    expect(Number(aSnap.record?.fields.budgetCount)).toBe(1);

    scope = OTHER_TENANT_SCOPE;
    const bSnap = await create('finance-budget-variance', { asOfDate: '2026-08-31' });
    expect(Number(bSnap.record?.fields.budgetCount)).toBe(0); // B has no books/budgets
    expect((await list('finance-budget-variance')).every((r) => r.id !== aSnap.record?.id)).toBe(true);

    scope = TEST_TENANT_SCOPE;
    expect((await list('finance-budget-variance')).some((r) => r.id === aSnap.record?.id)).toBe(true);
  });
});
