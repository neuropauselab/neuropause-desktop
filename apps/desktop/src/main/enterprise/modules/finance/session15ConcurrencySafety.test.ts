/**
 * ERP Session 15 — EXPLICIT concurrency safety for canonical-chart initialization.
 *
 * Before this session, concurrent `ensureCanonicalChart` was safe only as an
 * EMERGENT property of a synchronous check-then-create loop. This session makes
 * the guarantee EXPLICIT via a tenant-keyed single-flight latch
 * (`coalesceCanonicalInit`): for one tenant, N concurrent attempts run the init
 * body exactly once; different tenants are independent; a failed init is
 * retryable and never poisons a tenant. These tests prove the guarantee holds
 * INDEPENDENTLY of whether the init body is synchronous — the load-bearing point
 * a mutation of the latch must break.
 *
 * The registry is bound to `resolveTenantScope(() => scope)` — the SAME
 * principal-aware resolver production binds via `activeTenantScope` — so a
 * captured background principal (`runAsPrincipal`) survives across awaits exactly
 * as it does under the boot fan-out, letting us test TRUE cross-tenant
 * concurrency rather than a scope flipped between synchronous batches.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

vi.mock('electron', () => ({
  app: { getPath: () => tmpdir() },
  safeStorage: {
    isEncryptionAvailable: () => false,
    encryptString: (s: string) => Buffer.from(s, 'utf8'),
    decryptString: (b: Buffer) => b.toString('utf8'),
  },
}));

import {
  IpcChannel,
  JOURNAL_ENTRIES_MODULE_ID,
  LEDGER_ACCOUNTS_MODULE_ID,
  type EnterpriseEntity,
  type EnterprisePermission,
  type PlatformEventInput,
  type TenantScope,
} from '@neuropause/shared';
import { EnterpriseModuleRegistry, buildModuleHandlers, createLifecycleEmitter } from '../../framework/moduleRegistry';
import type { EnterpriseModuleActionContext } from '../../framework';
import type { SecureHandlerDef } from '../../../ipc/secureBridge';
import { createProductModule } from '../inventory/productModule';
import { createStockMovementModule } from '../inventory/stockMovementModule';
import { createJournalEntryModule } from './journalEntryModule';
import { createLedgerAccountModule } from './ledgerAccountModule';
import { createPurchaseOrderModule } from '../procurement/purchaseOrderModule';
import { createGoodsReceiptModule } from '../procurement/goodsReceiptModule';
import { STOCK_ACCOUNTS } from '../../../erp/postingRules';
import { resolveTenantScope, runAsPrincipal, tenantPrincipal } from '../../../tenancy/backgroundPrincipal';
import {
  coalesceCanonicalInit,
  ensureCanonicalChart,
  __resetCanonicalChartLatchForTests,
} from './controlChart';

const paths: string[] = [];
const tmp = (tag: string): string => {
  const p = join(tmpdir(), `np-s15-${tag}-${randomUUID()}.json`);
  paths.push(p);
  return p;
};
const tick = (ms = 4): Promise<void> => new Promise((r) => setTimeout(r, ms));

// A representative slice of the canonical chart — control AND stock. "None
// missing" means every one of these is present exactly once after init.
const REQUIRED_CANONICAL = ['1000', '1100', '2000', '2100', '4000', '5000', '1200', '1300', '1350', '1360', '2150', '5050', '5920'];

interface Rec { authorized: EnterprisePermission[] }
let rec: Rec;
let scope: TenantScope | null;
let registry: EnterpriseModuleRegistry;
let handlers: SecureHandlerDef[];
let actionCtx: EnterpriseModuleActionContext;

function spyCtx() {
  return {
    authorize: (p: EnterprisePermission) => rec.authorized.push(p),
    audit: () => undefined,
    publish: (_i: PlatformEventInput) => undefined,
    broadcast: () => undefined,
    notify: () => undefined,
    actor: () => 'operator@np.dev',
    now: () => '2026-09-01T12:00:00.000Z',
  };
}

beforeEach(() => {
  __resetCanonicalChartLatchForTests();
  rec = { authorized: [] };
  scope = { tenantId: 'tenant-A', workspaceId: 'ws-A' };
  registry = new EnterpriseModuleRegistry();
  const accounts = createLedgerAccountModule(tmp('acct'));
  const pos = createPurchaseOrderModule(tmp('po'));
  for (const m of [
    createProductModule(tmp('prod')),
    createStockMovementModule(tmp('mv')),
    accounts,
    createJournalEntryModule(tmp('jrnl'), accounts.store),
    pos,
    createGoodsReceiptModule(tmp('gr')),
  ]) registry.register(m);
  // The SAME principal-aware resolver production uses (activeTenantScope), so a
  // captured principal survives across awaits — the boot fan-out's mechanism.
  registry.bindScope(() => resolveTenantScope(() => scope));
  handlers = buildModuleHandlers(registry, spyCtx());
  actionCtx = createLifecycleEmitter(registry, spyCtx()).actionCtx;
  // Deliberately NO chart seeding: every tenant here is fresh.
});
afterEach(async () => {
  __resetCanonicalChartLatchForTests();
  vi.restoreAllMocks();
  for (const p of paths.splice(0)) await fs.rm(p, { force: true }).catch(() => undefined);
});

function handler(channel: string): (p: unknown) => Promise<unknown> {
  const def = handlers.find((d) => d.channel === channel);
  if (!def) throw new Error(`no handler for ${channel}`);
  return def.handler as (p: unknown) => Promise<unknown>;
}
const createIn = (moduleId: string, fields: Record<string, unknown>) =>
  handler(IpcChannel.EnterpriseModuleCreate)({ moduleId, fields }) as Promise<{ ok: boolean; record?: EnterpriseEntity }>;
const act = (moduleId: string, id: string, action: string) =>
  handler(IpcChannel.EnterpriseModuleAction)({ moduleId, id, action }) as Promise<{ ok: boolean; message?: string }>;
const accountCodes = (): string[] =>
  registry.get(LEDGER_ACCOUNTS_MODULE_ID)!.store.list().filter((r) => r.status !== 'deleted').map((r) => String(r.fields.code));
const noDup = (codes: string[]): boolean => new Set(codes).size === codes.length;
const hasAllRequired = (codes: string[]): boolean => REQUIRED_CANONICAL.every((c) => codes.includes(c));
async function flushUntil(pred: () => boolean, ms = 800): Promise<void> {
  const start = Date.now();
  while (!pred() && Date.now() - start < ms) await new Promise((r) => setTimeout(r, 5));
}
const asTenant = <T>(tenantId: string, fn: () => T): T =>
  runAsPrincipal(tenantPrincipal({ jobId: 's15', scope: { tenantId, workspaceId: '' } })!, fn);

// ===========================================================================
// A · THE LATCH PRIMITIVE — the explicit guarantee, proven independent of
//     whether the init body is synchronous.
// ===========================================================================

describe('S15 · coalesceCanonicalInit (the explicit single-flight guarantee)', () => {
  it('N concurrent, one tenant → the init body runs EXACTLY ONCE even when it yields', async () => {
    let runs = 0;
    const body = async () => { await tick(); runs += 1; };
    await Promise.all(Array.from({ length: 100 }, () => coalesceCanonicalInit('T', body)));
    expect(runs).toBe(1); // 100 callers, one execution — synchronicity is NOT what protects this
  });

  it('different tenants run independently — once each, no cross-tenant coalescing', async () => {
    const runs: Record<string, number> = {};
    const body = (t: string) => async () => { await tick(); runs[t] = (runs[t] ?? 0) + 1; };
    await Promise.all([
      ...Array.from({ length: 30 }, () => coalesceCanonicalInit('A', body('A'))),
      ...Array.from({ length: 30 }, () => coalesceCanonicalInit('B', body('B'))),
      ...Array.from({ length: 30 }, () => coalesceCanonicalInit('C', body('C'))),
    ]);
    expect(runs).toEqual({ A: 1, B: 1, C: 1 });
  });

  it('a failed init rejects ALL coalesced callers and leaves nothing behind (retryable, not poisoned)', async () => {
    let attempts = 0;
    const failing = async () => { attempts += 1; await tick(); throw new Error('boom'); };
    const settled = await Promise.allSettled(Array.from({ length: 10 }, () => coalesceCanonicalInit('R', failing)));
    expect(attempts).toBe(1); // coalesced into a single attempt
    expect(settled.every((s) => s.status === 'rejected')).toBe(true); // all share the one failure
    let recovered = 0; // latch cleared in finally → a fresh init runs and succeeds
    await coalesceCanonicalInit('R', async () => { recovered += 1; });
    expect(recovered).toBe(1);
  });

  it('the key is cleared after completion — a later call re-runs (no permanent memo)', async () => {
    let runs = 0;
    await coalesceCanonicalInit('Z', async () => { runs += 1; });
    await coalesceCanonicalInit('Z', async () => { runs += 1; });
    expect(runs).toBe(2); // sequential, not concurrent — idempotency is the guards' job, not the latch's
  });
});

// ===========================================================================
// B · HIGH CONTENTION — ensureCanonicalChart through the real scoped store.
// ===========================================================================

describe('S15 · high-contention initialization', () => {
  for (const n of [10, 50, 100]) {
    it(`${n} concurrent calls → exactly one canonical set, none missing, no duplicates`, async () => {
      scope = { tenantId: `tenant-HC${n}`, workspaceId: `ws-HC${n}` };
      await Promise.all(Array.from({ length: n }, () => ensureCanonicalChart(actionCtx)));
      const codes = accountCodes();
      expect(noDup(codes)).toBe(true);
      expect(hasAllRequired(codes)).toBe(true);
      for (const c of REQUIRED_CANONICAL) expect(codes.filter((x) => x === c)).toHaveLength(1);
    });
  }

  it('sequential 3× → still one set (the empty-only / skip-existing guards, after the latch clears)', async () => {
    scope = { tenantId: 'tenant-SEQ', workspaceId: 'ws-SEQ' };
    await ensureCanonicalChart(actionCtx);
    const n = accountCodes().length;
    await ensureCanonicalChart(actionCtx);
    await ensureCanonicalChart(actionCtx);
    expect(accountCodes().length).toBe(n);
    expect(noDup(accountCodes())).toBe(true);
  });
});

// ===========================================================================
// C · FIRST TRANSACTION RACING INITIALIZATION — no partial chart observed.
// ===========================================================================

describe('S15 · first stock posting racing initialization', () => {
  it('100 concurrent inits + a first stock posting → complete chart, GRNI accrues, no duplicates', async () => {
    scope = { tenantId: 'tenant-RACE100', workspaceId: 'ws-RACE100' };
    await createIn('inventory-products', { sku: 'RC', name: 'RC', standardCost: 10 });
    const po = await createIn('procurement-orders', { poNumber: 'PO-RC', supplier: 'Acme', product: 'RC', warehouse: 'WH-1', quantity: 10, unitCost: 10, currency: 'USD' });
    const gr = await createIn('procurement-receipts', { grNumber: 'GR-RC', purchaseOrder: po.record!.id, supplier: 'Acme', product: 'RC', warehouse: 'WH-1', quantityOrdered: 10, quantityReceived: 10 });
    await Promise.all([
      ...Array.from({ length: 100 }, () => ensureCanonicalChart(actionCtx)),
      act('procurement-receipts', gr.record!.id, 'post'),
    ]);
    await flushUntil(() => bal(STOCK_ACCOUNTS.grni, 'credit') > 0);
    const codes = accountCodes();
    expect(noDup(codes)).toBe(true); // the posting never created a duplicate account against a partial chart
    expect(hasAllRequired(codes)).toBe(true);
    expect(bal(STOCK_ACCOUNTS.grni, 'credit')).toBe(100); // 10 @ 10 accrued to GRNI
  });
});

// ===========================================================================
// D · MULTI-TENANT CONTENTION — true concurrency via captured principals.
// ===========================================================================

describe('S15 · multi-tenant contention (A×50, B×50, C×50 concurrently)', () => {
  it('each tenant ends with exactly one independent canonical set; no cross-tenant leakage', async () => {
    const fireFor = (t: string) => asTenant(t, () => Promise.all(Array.from({ length: 50 }, () => ensureCanonicalChart(actionCtx))));
    await Promise.all([fireFor('mt-A'), fireFor('mt-B'), fireFor('mt-C')]);

    const perTenant = ['mt-A', 'mt-B', 'mt-C'].map((t) => ({ t, codes: asTenant(t, () => accountCodes()) }));
    for (const { codes } of perTenant) {
      expect(noDup(codes)).toBe(true); // one set, not two or three merged in
      expect(hasAllRequired(codes)).toBe(true);
    }
    // Independent AND identical in size — no tenant saw another's rows (that would
    // inflate the count) and none was starved (that would shrink it).
    const sizes = perTenant.map((p) => p.codes.length);
    expect(new Set(sizes).size).toBe(1);
    expect(sizes[0]).toBeGreaterThan(0);
  });

  it('an init requested under tenant A is invisible to tenant B; an unresolved scope initializes nothing', async () => {
    await asTenant('iso-A', () => ensureCanonicalChart(actionCtx));
    expect(asTenant('iso-A', () => accountCodes()).length).toBeGreaterThan(0);
    expect(asTenant('iso-B', () => accountCodes())).toHaveLength(0); // B never sees A's chart

    scope = null; // unresolved → DENY: nothing to initialize, no latch entry, no throw
    await expect(ensureCanonicalChart(actionCtx)).resolves.toBeUndefined();
    // and a real tenant afterward still initializes correctly (the null pass poisoned nothing)
    await asTenant('iso-C', () => ensureCanonicalChart(actionCtx));
    expect(hasAllRequired(asTenant('iso-C', () => accountCodes()))).toBe(true);
  });
});

// ===========================================================================
// E · FAILURE / RETRY at the integration layer.
// ===========================================================================

describe('S15 · initialization failure is retryable', () => {
  it('a throwing store.create rejects the init, clears the latch, and a later call seeds cleanly', async () => {
    scope = { tenantId: 'tenant-FAIL', workspaceId: 'ws-FAIL' };
    const store = registry.get(LEDGER_ACCOUNTS_MODULE_ID)!.store;
    const spy = vi.spyOn(store, 'create').mockImplementationOnce(() => {
      throw new Error('transient disk failure');
    });
    await expect(ensureCanonicalChart(actionCtx)).rejects.toThrow('transient disk failure');
    expect(accountCodes()).toHaveLength(0); // nothing half-committed observable
    spy.mockRestore();
    await ensureCanonicalChart(actionCtx); // retry after the transient failure
    expect(hasAllRequired(accountCodes())).toBe(true);
    expect(noDup(accountCodes())).toBe(true);
  });
});

function journalLines(): { account: string; debit: number; credit: number }[] {
  return registry
    .get(JOURNAL_ENTRIES_MODULE_ID)!
    .store.list()
    .flatMap((e) => JSON.parse(String(e.fields.lines ?? '[]')) as { account: string; debit: number; credit: number }[]);
}
function bal(account: string, side: 'debit' | 'credit'): number {
  return journalLines().filter((l) => l.account === account).reduce((n, l) => n + l[side], 0);
}
