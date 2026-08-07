/**
 * Phase 9 (certification fix) — the production-costing dangling-reference
 * guard. Certification found costing accepted any free-text production order;
 * with the order store injected (the peer-module pattern), a named order must
 * be REAL — by record id or order number — and omission stays valid.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createCostingModule } from './costingModule';
import { createProductionOrderModule } from './productionOrderModule';
import type { EnterpriseModule } from '../../framework';

let dir: string;
let orders: EnterpriseModule;
let costing: EnterpriseModule;

beforeEach(async () => {
  dir = join(tmpdir(), `np-costing-${randomUUID()}`);
  await fs.mkdir(dir, { recursive: true });
  orders = createProductionOrderModule(join(dir, 'orders.json'));
  await orders.store.load();
  costing = createCostingModule(join(dir, 'costing.json'), undefined, orders.store);
  await costing.store.load();
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

describe('costing production-order guard (Phase 9)', () => {
  it('refuses a dangling reference; accepts a real order by id or number; empty stays valid', async () => {
    const ghost = costing.hooks.validate({ fields: { costNumber: 'PC-1', productionOrder: 'MO-GHOST' } });
    expect(ghost.ok).toBe(false);
    if (!ghost.ok) expect(JSON.stringify(ghost.errors)).toContain('No production order');

    const ov = orders.hooks.validate({
      fields: { orderNumber: 'MO-1', bom: 'BOM-1', product: 'SKU-1', warehouse: 'WH-01', productionQuantity: 5 },
    });
    if (!ov.ok) throw new Error(JSON.stringify(ov.errors));
    const order = orders.store.create({ title: 'MO-1', fields: ov.values, actor: 't', now: '2026-08-07T00:00:00.000Z' });

    expect(costing.hooks.validate({ fields: { costNumber: 'PC-2', productionOrder: order.id } }).ok).toBe(true);
    expect(costing.hooks.validate({ fields: { costNumber: 'PC-3', productionOrder: 'MO-1' } }).ok).toBe(true);
    expect(costing.hooks.validate({ fields: { costNumber: 'PC-4' } }).ok).toBe(true); // omission valid
  });

  it('without the injected store, prior behavior is untouched (additive-optional proof)', async () => {
    const legacy = createCostingModule(join(dir, 'legacy.json'));
    await legacy.store.load();
    expect(legacy.hooks.validate({ fields: { costNumber: 'PC-9', productionOrder: 'ANYTHING' } }).ok).toBe(true);
  });
});
