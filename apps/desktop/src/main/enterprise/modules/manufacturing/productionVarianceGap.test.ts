/**
 * ERP Session 5 — production actual-cost + variance: RED-GAP REPRODUCTION.
 *
 * Executable proof of the gap and its root cause:
 *   1. A production run (consumption + output) posted the way production posts it
 *      today — through the real manufacturingMovements seam, WITHOUT a unitCost —
 *      produces ZERO WIP / finished-goods / variance GL entries. The seam #1 GL
 *      bridge is starved of cost, so nothing posts.
 *   2. Root cause pinned: the SAME movements, given a real unitCost, DO post WIP
 *      (Dr 1350 / Cr 1300) — so the bridge works; the movements are uncosted.
 *   3. The variance LOGIC already exists (`deriveProductionCompletionPosting`
 *      emits a 5910 line when accumulated WIP ≠ standard) — it is simply never
 *      called per order with real numbers. No per-order variance settlement runs.
 *
 * See certification/ERP-SESSION5-PRODUCTION-VARIANCE-DECISION.md — closing this
 * requires a system-wide cost-basis decision (all domain movements are uncosted),
 * so no semantic code is changed here.
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
  JOURNAL_ENTRIES_MODULE_ID,
  PRODUCTION_ORDERS_MODULE_ID,
  type EnterprisePermission,
  type PlatformEventInput,
} from '@neuropause/shared';
import { EnterpriseModuleRegistry, buildModuleHandlers, createLifecycleEmitter } from '../../framework/moduleRegistry';
import type { EnterpriseModuleActionContext } from '../../framework';
import { createProductModule } from '../inventory/productModule';
import { createStockMovementModule } from '../inventory/stockMovementModule';
import { createJournalEntryModule } from '../finance/journalEntryModule';
import { createLedgerAccountModule } from '../finance/ledgerAccountModule';
import { postConsumption, postOutput } from './manufacturingMovements';
import { STOCK_ACCOUNTS, deriveProductionCompletionPosting } from '../../../erp/postingRules';

const T0 = '2026-08-31T12:00:00.000Z';
const paths: string[] = [];
const tmp = (tag: string): string => {
  const p = join(tmpdir(), `np-${tag}-${randomUUID()}.json`);
  paths.push(p);
  return p;
};

interface Rec { publish: PlatformEventInput[]; audit: { action: string }[]; broadcast: { channel: string }[]; authorized: EnterprisePermission[] }
let rec: Rec;
let scope: { tenantId: string; workspaceId: string } | null;
let registry: EnterpriseModuleRegistry;
let ctx: EnterpriseModuleActionContext;

function spyCtx() {
  return {
    authorize: (p: EnterprisePermission) => rec.authorized.push(p),
    audit: (e: { action: string; target: string; summary: string }) => rec.audit.push(e),
    publish: (i: PlatformEventInput) => rec.publish.push(i),
    broadcast: (channel: string) => rec.broadcast.push({ channel }),
    notify: () => undefined,
    actor: () => 'operator@np.dev',
    now: () => T0,
  };
}

beforeEach(() => {
  rec = { publish: [], audit: [], broadcast: [], authorized: [] };
  scope = { tenantId: 'tenant-A', workspaceId: 'ws-A' };
  registry = new EnterpriseModuleRegistry();
  const accounts = createLedgerAccountModule(tmp('acct'));
  for (const m of [
    createProductModule(tmp('prod')),
    createStockMovementModule(tmp('mv')),
    accounts,
    createJournalEntryModule(tmp('jrnl'), accounts.store),
  ]) registry.register(m);
  registry.bindScope(() => scope);
  buildModuleHandlers(registry, spyCtx());
  ctx = createLifecycleEmitter(registry, spyCtx()).actionCtx;
});
afterEach(async () => {
  for (const p of paths.splice(0)) await fs.rm(p, { force: true }).catch(() => undefined);
});

function journalLines(): { account: string; debit: number; credit: number }[] {
  return registry.get(JOURNAL_ENTRIES_MODULE_ID)!.store
    .list()
    .flatMap((e) => JSON.parse(String(e.fields.lines ?? '[]')) as { account: string; debit: number; credit: number }[]);
}

describe('Session 5 RED gap — a production run posts no WIP / variance GL today', () => {
  it('consumption + output posted the production way (no unitCost) post NOTHING to the GL', async () => {
    // Consume 3 + 2 of a component, yield 5 finished goods — the way production does it.
    await postConsumption(ctx, { movementNumber: 'MV-MO1-C1', product: 'RM-1', warehouse: 'WH-1', quantity: 3, referenceModule: PRODUCTION_ORDERS_MODULE_ID, referenceRecord: 'ord-1', reason: 'MO-1' });
    await postConsumption(ctx, { movementNumber: 'MV-MO1-C2', product: 'RM-1', warehouse: 'WH-1', quantity: 2, referenceModule: PRODUCTION_ORDERS_MODULE_ID, referenceRecord: 'ord-1', reason: 'MO-1' });
    await postOutput(ctx, { movementNumber: 'MV-MO1-O1', product: 'FG-1', warehouse: 'WH-1', quantity: 5, referenceModule: PRODUCTION_ORDERS_MODULE_ID, referenceRecord: 'ord-1', reason: 'MO-1' });

    // THE GAP: no WIP (1350), no finished goods (1360), no variance (5900/5910).
    const lines = journalLines();
    expect(lines.filter((l) => l.account === STOCK_ACCOUNTS.wip)).toHaveLength(0);
    expect(lines.filter((l) => l.account === STOCK_ACCOUNTS.finishedGoods)).toHaveLength(0);
    expect(lines.filter((l) => l.account === STOCK_ACCOUNTS.productionVariance)).toHaveLength(0);
    expect(lines.filter((l) => l.account === STOCK_ACCOUNTS.materialVariance)).toHaveLength(0);
  });

  it('root cause — the same consumption WITH a unitCost DOES post WIP (bridge works; movements are uncosted)', async () => {
    await postConsumption(ctx, { movementNumber: 'MV-MO2-C1', product: 'RM-1', warehouse: 'WH-1', quantity: 3, unitCost: 5, referenceModule: PRODUCTION_ORDERS_MODULE_ID, referenceRecord: 'ord-2', reason: 'MO-2' });
    const wip = journalLines().filter((l) => l.account === STOCK_ACCOUNTS.wip);
    expect(wip).toHaveLength(1);
    expect(wip[0].debit).toBe(15); // 3 × 5 — the bridge posts when cost is supplied
  });

  it('variance logic EXISTS but is never fed — deriveProductionCompletionPosting books 5910 on a WIP≠standard case', () => {
    // WIP accumulated 23, standard cost of output 20 → 3 unfavourable production variance.
    const d = deriveProductionCompletionPosting({ productionOrderId: 'ord-3', wipAccumulated: 23, standardCostOfOutput: 20 });
    expect(d.ok).toBe(true);
    if (!d.ok) return;
    const v = d.lines.find((l) => l.account === STOCK_ACCOUNTS.productionVariance);
    expect(v?.debit).toBe(3); // Dr 5910 3 (unfavourable) — the logic is correct, nothing calls it per order
    expect(d.lines.find((l) => l.account === STOCK_ACCOUNTS.wip)?.credit).toBe(23); // WIP settled
  });
});
