/**
 * Phase 6 — ensure the stock/production control accounts exist before posting.
 *
 * The journal resolves every line to exactly one Chart of Accounts record and
 * REJECTS an entry whose account is missing or ambiguous. The seeded control
 * chart covers cash/receivable/payable/revenue only, so inventory, GRNI, COGS,
 * WIP, finished goods and the variance accounts must be created before the
 * first stock posting — otherwise the entry is silently refused and stock never
 * reaches the books.
 *
 * This mirrors the existing `ensureFxAccount` / payroll account-ensuring
 * pattern: idempotent, additive, and it never overwrites an account an operator
 * has already defined (remapping the chart stays possible).
 */
import { LEDGER_ACCOUNTS_MODULE_ID, type GlAccountClass } from '@neuropause/shared';
import type { EnterpriseModuleActionContext } from '../enterprise/framework/enterpriseModule';
import { STOCK_ACCOUNTS } from './postingRules';

interface StockAccountDef {
  code: string;
  name: string;
  accountClass: GlAccountClass;
}

/** Every account the stock/production posting rules can touch. */
export const STOCK_ACCOUNT_DEFS: readonly StockAccountDef[] = [
  { code: STOCK_ACCOUNTS.inventory, name: 'Inventory', accountClass: 'asset' },
  { code: STOCK_ACCOUNTS.wip, name: 'Work In Progress', accountClass: 'asset' },
  { code: STOCK_ACCOUNTS.finishedGoods, name: 'Finished Goods', accountClass: 'asset' },
  { code: STOCK_ACCOUNTS.grni, name: 'Goods Received Not Invoiced', accountClass: 'liability' },
  { code: STOCK_ACCOUNTS.accountsPayable, name: 'Accounts Payable', accountClass: 'liability' },
  { code: STOCK_ACCOUNTS.cogs, name: 'Cost of Goods Sold', accountClass: 'expense' },
  { code: STOCK_ACCOUNTS.inventoryAdjustment, name: 'Inventory Adjustments', accountClass: 'expense' },
  { code: STOCK_ACCOUNTS.materialVariance, name: 'Material Usage Variance', accountClass: 'expense' },
  { code: STOCK_ACCOUNTS.productionVariance, name: 'Production Variance', accountClass: 'expense' },
];

/**
 * Create any missing stock account. Safe to call before every posting: it loads
 * the chart, skips codes that already exist, and does nothing when the ledger
 * module is not wired.
 */
export async function ensureStockAccounts(ctx: EnterpriseModuleActionContext): Promise<void> {
  const accounts = ctx.moduleFor(LEDGER_ACCOUNTS_MODULE_ID);
  if (!accounts) return;
  await accounts.store.load();

  const existing = new Set(
    accounts.store
      .list()
      .filter((r) => r.status !== 'deleted')
      .map((r) => String(r.fields.code ?? '')),
  );

  for (const def of STOCK_ACCOUNT_DEFS) {
    if (existing.has(def.code)) continue;
    const v = accounts.hooks.validate({
      fields: { code: def.code, name: def.name, class: def.accountClass, currency: 'USD' },
    });
    if (!v.ok) continue;
    const record = accounts.store.create({
      title: def.code,
      fields: v.values,
      actor: 'system:erp-stock',
      now: ctx.now(),
    });
    ctx.emit(accounts, 'created', record);
    existing.add(def.code);
  }
}
