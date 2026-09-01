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
 * Called at boot (per tenant), on tenant activation, and reused implicitly by the
 * GL posting seam as a self-healing safety net. Ordering-independent: stock
 * activity can never suppress finance-account initialization, because control is
 * seeded (empty-only) before stock.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ERP Session 15 — EXPLICIT CONCURRENCY SAFETY.
 *
 * Before this session, concurrent initialization was safe ONLY as an emergent
 * property: each underlying ensure has a single `await store.load()` followed by
 * a fully SYNCHRONOUS check-then-create loop (read `count()`/existing-set →
 * `create` → `emit`, none of which await), so on the one Node event loop the
 * first caller past `load()` ran its whole create loop to completion before any
 * other caller resumed. True today — and one inserted `await` between the
 * existence check and the `create` away from silently false. "Do not assume
 * synchronous behavior is permanently safe."
 *
 * The guarantee is now EXPLICIT and independent of that: `ensureCanonicalChart`
 * runs behind a tenant-keyed SINGLE-FLIGHT latch (`coalesceCanonicalInit`). For
 * one tenant, N concurrent attempts execute the init body EXACTLY ONCE and all
 * share its outcome; different tenants use different keys and never block or
 * reuse each other's work. The only invariant that must stay synchronous is now
 * two lines inside the latch (the `existing` check → `set`), pinned by test —
 * not the whole multi-account seed. The empty-only / skip-existing guards remain
 * the SEQUENTIAL (idempotent) half; the latch is the CONCURRENT half.
 *
 * In-memory and per-process by design: this product is single-process,
 * single-event-loop (one store instance per module, JSON-file backed), so a
 * process-local latch is the whole boundary — no distributed lock, no infra
 * dependency. The latch key is the ledger store's OWN resolved tenant scope, so
 * the key and the account writes can never target different tenants, in every
 * path (session / boot fan-out / companion / sandbox), without importing the
 * `activeTenantScope` composition root.
 */
import { LEDGER_ACCOUNTS_MODULE_ID } from '@neuropause/shared';
import type { EnterpriseModuleActionContext } from '../../framework';
import { seedControlAccountsIfEmpty } from './glPosting';
import { ensureStockAccounts } from '../../../erp/stockAccounts';

/**
 * In-flight canonical-chart initialization, keyed by tenant id.
 *
 * TENANT ONLY, not tenant+workspace — the chart of accounts is an
 * organization-level registry (the boot fan-out seeds it tenant-wide, workspace
 * `''`), so a per-workspace key would let one tenant's two workspaces each run a
 * redundant init and, worse, would stop a session-path posting (workspace `W`)
 * from coalescing onto the tenant-wide boot init. Same reasoning as
 * `TenantDedupe`'s tenant-only key.
 */
const inFlightByTenant = new Map<string, Promise<void>>();

/**
 * Tenant-keyed single-flight coalescer. Exported so the concurrency guarantee is
 * unit-testable in isolation from the store.
 *
 * INVARIANT (pinned): the read of `existing` and the `set` of the new promise
 * MUST remain synchronous with respect to each other — nothing may `await`
 * between them, or two concurrent callers could both miss `existing` and both
 * start `run`. This is the ONLY synchronous critical section the design now
 * depends on, and it is two lines long.
 *
 * FAILURE SAFETY: the key is deleted in `finally`, so a run that throws leaves
 * NOTHING behind — the next call starts a fresh init. A failed initialization is
 * always retryable; it can never poison a tenant. Coalesced callers share the
 * in-flight promise, so they all observe the same success OR the same failure.
 */
export function coalesceCanonicalInit(tenantId: string, run: () => Promise<void>): Promise<void> {
  const existing = inFlightByTenant.get(tenantId);
  if (existing) return existing;
  const promise = (async () => {
    try {
      await run();
    } finally {
      inFlightByTenant.delete(tenantId);
    }
  })();
  inFlightByTenant.set(tenantId, promise);
  return promise;
}

/** Test-only: drop any in-flight entries. Never called at runtime. */
export function __resetCanonicalChartLatchForTests(): void {
  inFlightByTenant.clear();
}

export async function ensureCanonicalChart(ctx: EnterpriseModuleActionContext): Promise<void> {
  const accounts = ctx.moduleFor(LEDGER_ACCOUNTS_MODULE_ID);
  if (!accounts) return;

  // The latch key is the store's OWN resolved boundary, so it is provably the
  // same tenant the account writes will land in — no separately resolved scope
  // that could drift. An unresolved scope means DENY: the store would refuse
  // every write anyway, so there is nothing to initialize, and we must NOT
  // coalesce distinct unresolved callers under one shared empty key.
  const tenantId = accounts.store.resolvedScope()?.tenantId ?? '';
  if (!tenantId) return;

  return coalesceCanonicalInit(tenantId, async () => {
    // Control accounts FIRST, on the empty chart (respects a customized chart via
    // the empty-only seed), then the stock accounts (ensure-missing). Seeding
    // control before stock is what prevents stock activity from ever suppressing
    // the finance control accounts on a fresh install.
    await seedControlAccountsIfEmpty(ctx);
    await ensureStockAccounts(ctx);
  });
}
