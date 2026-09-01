/**
 * ERP Session 13 — the ONE authoritative canonical-chart initializer.
 *
 * Ensures every finance CONTROL account (cash / AR / AP 2000 / Tax Payable 2100 /
 * Operating Expenses 5000 / Revenue 4000 / GST 1200 / fixed-asset control) AND
 * every inventory/production STOCK account (Inventory 1300 / WIP 1350 / FG 1360 /
 * GRNI 2150 / COGS 5050 / PPV 5920 / variances) exists — idempotently
 * (create-missing, never overwrite or renumber). Both underlying ensures read
 * the FROZEN canonical chart constants; no chart-surface change and no new
 * account numbers.
 *
 * Called at boot (per active tenant) so the full chart is ready before
 * transactions begin, and reused implicitly by the GL posting seam
 * (`applyGlDerivedEntries` → `ensureControlAccounts`) as a self-healing safety
 * net. Ordering-independent: stock activity can never suppress finance-account
 * initialization, because ensuring is create-missing rather than seed-if-empty.
 */
import type { EnterpriseModuleActionContext } from '../../framework';
import { seedControlAccountsIfEmpty } from './glPosting';
import { ensureStockAccounts } from '../../../erp/stockAccounts';

export async function ensureCanonicalChart(ctx: EnterpriseModuleActionContext): Promise<void> {
  // Control accounts FIRST, on the empty chart (respects a customized chart via
  // the empty-only seed), then the stock accounts (ensure-missing, the
  // established stock policy). Ordering matters: seeding control before stock at
  // boot is exactly what prevents stock activity from ever suppressing the
  // finance control accounts on a fresh install.
  await seedControlAccountsIfEmpty(ctx);
  await ensureStockAccounts(ctx);
}
