/**
 * Procurement ↔ Finance → FW-5 Budget Controls — the pure commitment engine
 * and the cross-module proof: PO approval consults the named Finance budget,
 * counting already-committed POs, honoring the budget's off/warn/block
 * policy, refusing dangling references, and staying byte-identical for
 * uncontrolled orders.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { evaluateBudgetControl } from '@neuropause/shared';
import { createBudgetModule } from '../finance/budgetModule';
import { createJournalEntryModule } from '../finance/journalEntryModule';
import { createLedgerAccountModule } from '../finance/ledgerAccountModule';
import { createPurchaseOrderModule } from './purchaseOrderModule';
import type { EnterpriseModule, EnterpriseModuleActionContext } from '../../framework';

const T0 = '2026-08-06T00:00:00.000Z';

// ── Pure engine ────────────────────────────────────────────────────────────

describe('Budget-control engine (pure)', () => {
  const budget = (id: string, amount: number, policy?: string) => ({
    id, status: 'active', fields: { budgetName: 'Q3 Components', budgetAmount: amount, ...(policy ? { commitmentPolicy: policy } : {}) },
  });
  const po = (id: string, status: string, total: number, budgetRef = 'b1') => ({
    id, status: 'active', fields: { status, total, budgetRef },
  });

  it('uncontrolled and dangling references behave honestly', () => {
    const none = evaluateBudgetControl({ orderId: 'p1', orderTotal: 100, budgetRef: '', budgets: [], purchaseOrders: [] });
    expect(none.allowed).toBe(true);
    expect(none.controlled).toBe(false);
    const dangling = evaluateBudgetControl({ orderId: 'p1', orderTotal: 100, budgetRef: 'ghost', budgets: [], purchaseOrders: [] });
    expect(dangling.allowed).toBe(false); // a broken control never silently opens
    expect(dangling.note).toContain('not found');
  });

  it('counts committed POs (approved/sent/received), excluding drafts, cancelled, other budgets, and itself', () => {
    const orders = [
      po('p0', 'approved', 400),
      po('p2', 'sent', 300),
      po('p3', 'draft', 999),      // not committed
      po('p4', 'cancelled', 999),  // not committed
      po('p5', 'approved', 999, 'OTHER'), // different budget
      po('SELF', 'approved', 999), // the order being approved — excluded by id
    ];
    const d = evaluateBudgetControl({ orderId: 'SELF', orderTotal: 200, budgetRef: 'b1', budgets: [budget('b1', 1000, 'warn')], purchaseOrders: orders });
    expect(d.committedAmount).toBe(700);
    expect(d.projectedAmount).toBe(900);
    expect(d.overBy).toBe(0);
    expect(d.allowed).toBe(true);
    expect(d.note).toContain('Within budget');
  });

  it('off ignores, warn allows with the overrun stated, block refuses with the numbers', () => {
    const orders = [po('p0', 'approved', 900)];
    const mk = (policy: string) =>
      evaluateBudgetControl({ orderId: 'px', orderTotal: 200, budgetRef: 'b1', budgets: [budget('b1', 1000, policy)], purchaseOrders: orders });
    expect(mk('off').allowed).toBe(true);
    expect(mk('off').note).toContain('informational');
    const warn = mk('warn');
    expect(warn.allowed).toBe(true);
    expect(warn.overBy).toBe(100);
    expect(warn.note).toContain('Over budget');
    expect(warn.note).toContain('WARN');
    const block = mk('block');
    expect(block.allowed).toBe(false);
    expect(block.note).toContain('BLOCK');
    // Unknown policy defaults to warn — never silently off.
    const weird = evaluateBudgetControl({ orderId: 'px', orderTotal: 200, budgetRef: 'b1', budgets: [budget('b1', 1000, 'yolo')], purchaseOrders: orders });
    expect(weird.policy).toBe('warn');
  });
});

// ── Cross-module integration ───────────────────────────────────────────────

describe('PO approval gated by a Finance budget', () => {
  let dir: string;
  let accounts: EnterpriseModule;
  let journal: EnterpriseModule;
  let budgets: EnterpriseModule;
  let pos: EnterpriseModule;

  const ctx = (): EnterpriseModuleActionContext =>
    ({ actor: () => 'buyer', now: () => T0, emit: () => {}, moduleFor: () => null }) as unknown as EnterpriseModuleActionContext;

  const createVia = (mod: EnterpriseModule, fields: Record<string, unknown>, title: string) => {
    const v = mod.hooks.validate({ fields });
    if (!v.ok) throw new Error(JSON.stringify(v.errors));
    return mod.store.create({ title, fields: v.values, actor: 't', now: T0 });
  };

  beforeEach(async () => {
    dir = join(tmpdir(), `np-bc-${randomUUID()}`);
    await fs.mkdir(dir, { recursive: true });
    accounts = createLedgerAccountModule(join(dir, 'accounts.json'));
    journal = createJournalEntryModule(join(dir, 'journal.json'), accounts.store);
    budgets = createBudgetModule(join(dir, 'budgets.json'), journal.store, accounts.store);
    await Promise.all([accounts.store.load(), journal.store.load()]);
    await budgets.store.load();
    pos = createPurchaseOrderModule(join(dir, 'pos.json'), undefined, budgets.store);
    await pos.store.load();
    // The budget's account code must resolve to exactly one ledger account.
    createVia(accounts, { code: '5000', name: 'Components Expense', class: 'expense', currency: 'USD' }, '5000 · Components Expense');
  });
  afterEach(async () => {
    await new Promise((r) => setTimeout(r, 25));
    try {
      await fs.rm(dir, { recursive: true, force: true });
    } catch {
      await new Promise((r) => setTimeout(r, 100));
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  const mkBudget = (amount: number, policy: string) =>
    createVia(budgets, { budgetName: 'Q3 Components', periodKey: '2026-08', accountCode: '5000', budgetAmount: amount, commitmentPolicy: policy }, 'Q3 Components');
  const mkPo = (poNumber: string, subtotal: number, budgetRef: string) =>
    createVia(pos, { poNumber, supplier: 'Acme', subtotal, budgetRef }, poNumber);

  it('BLOCK: first PO within approves (check stamped); the one that busts the budget refuses with numbers', async () => {
    const b = mkBudget(1000, 'block');
    const po1 = mkPo('PO-1', 700, b.id);
    const ok = await pos.hooks.runAction!('approve', pos.store.get(po1.id)!, ctx());
    expect(ok.ok, ok.ok ? '' : ok.error).toBe(true);
    expect(String(pos.store.get(po1.id)!.fields.status)).toBe('approved');
    expect(String(pos.store.get(po1.id)!.fields.budgetCheck)).toContain('Within budget');
    const po2 = mkPo('PO-2', 400, b.id); // 700 committed + 400 = 1100 > 1000
    const refused = await pos.hooks.runAction!('approve', pos.store.get(po2.id)!, ctx());
    expect(refused.ok).toBe(false);
    expect(refused.error).toContain('Over budget');
    expect(refused.error).toContain('BLOCK');
    expect(String(pos.store.get(po2.id)!.fields.status)).toBe('draft'); // unchanged
  });

  it('WARN: the overrun approves but is stamped and said out loud', async () => {
    const b = mkBudget(1000, 'warn');
    mkPo('PO-1', 700, b.id);
    await pos.hooks.runAction!('approve', pos.store.get(pos.store.list()[0].id)!, ctx());
    const po2 = mkPo('PO-2', 400, b.id);
    const res = await pos.hooks.runAction!('approve', pos.store.get(po2.id)!, ctx());
    expect(res.ok).toBe(true);
    expect(res.message).toContain('WARN');
    expect(String(pos.store.get(po2.id)!.fields.status)).toBe('approved');
    expect(String(pos.store.get(po2.id)!.fields.budgetCheck)).toContain('Over budget');
  });

  it('no budgetRef = uncontrolled approval, exactly as before FW-5', async () => {
    const po1 = mkPo('PO-9', 5000, '');
    const res = await pos.hooks.runAction!('approve', pos.store.get(po1.id)!, ctx());
    expect(res.ok).toBe(true);
    expect(String(pos.store.get(po1.id)!.fields.budgetCheck ?? '')).toBe('');
  });

  it('a dangling budgetRef refuses approval loudly', async () => {
    const po1 = mkPo('PO-X', 100, 'ghost-budget');
    const res = await pos.hooks.runAction!('approve', pos.store.get(po1.id)!, ctx());
    expect(res.ok).toBe(false);
    expect(res.error).toContain('not found');
  });
});
