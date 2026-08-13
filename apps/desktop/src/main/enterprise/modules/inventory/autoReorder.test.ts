/**
 * Inventory ↔ Procurement → FW-6 Auto-Reordering — the pure replenishment
 * engine (open supply, min–max assessment, request numbering) and the
 * cross-module proof: a ledger movement that drops an opted-in product to its
 * reorder level drafts a purchase request through the Purchase Requests
 * module, exactly once (the draft is open supply), while opted-out products
 * and procurement-less environments behave exactly as before FW-6.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  PRODUCTS_MODULE_ID,
  PURCHASE_ORDERS_MODULE_ID,
  PURCHASE_REQUESTS_MODULE_ID,
  STOCK_MOVEMENTS_MODULE_ID,
  assessReorder,
  autoReorderRequestNumber,
  openSupplyForProduct,
  productFromRecord,
} from '@neuropause/shared';
import type { Product } from '@neuropause/shared';
import { createProductModule } from './productModule';
import { createStockMovementModule } from './stockMovementModule';
import { postStockMovement } from './postMovement';
import { REORDER_CHECK_ACTION } from './autoReorderSeam';
import { createPurchaseOrderModule } from '../procurement/purchaseOrderModule';
import { createPurchaseRequestModule } from '../procurement/purchaseRequestModule';
import type { EnterpriseModule, EnterpriseModuleActionContext } from '../../framework';

const T0 = '2026-08-07T00:00:00.000Z';

// ── Pure engine ────────────────────────────────────────────────────────────

const productOf = (over: Partial<Product>): Product => ({
  id: 'prod-1',
  sku: 'SKU-1',
  barcode: '',
  name: 'Widget',
  category: '',
  unit: 'unit',
  purchaseCost: 0,
  standardCost: 0,
  sellingPrice: 0,
  reorderLevel: 0,
  safetyStock: 0,
  maximumStock: 0,
  currentStock: 0,
  reservedStock: 0,
  availableStock: 0,
  status: 'active',
  ...over,
});

describe('Auto-reorder engine (pure)', () => {
  const pr = (id: string, status: string, quantity: number, product = 'SKU-1') => ({
    id, status: 'active', fields: { status, quantity, product },
  });
  const po = (id: string, status: string, quantity: number, product = 'SKU-1') => ({
    id, status: 'active', fields: { status, quantity, product },
  });

  it('open supply counts open PRs + open POs and nothing else', () => {
    const supply = openSupplyForProduct({
      sku: 'SKU-1',
      productId: 'prod-1',
      purchaseRequests: [
        pr('r1', 'draft', 5),
        pr('r2', 'approved', 3),
        pr('r3', 'rejected', 99), // dead paper
        pr('r4', 'ordered', 99), // its PO carries the supply now
        pr('r5', 'draft', 99, 'SKU-OTHER'), // different product
        { ...pr('r6', 'draft', 99), status: 'deleted' }, // deleted record
        pr('r7', 'pending', 2, 'prod-1'), // matched by record id
      ],
      purchaseOrders: [
        po('o1', 'sent', 4),
        po('o2', 'received', 99), // already in stock
        po('o3', 'cancelled', 99), // dead paper
      ],
    });
    expect(supply).toBe(14); // 5 + 3 + 2 + 4
  });

  it('assesses on the POSITION (available + on order), not bare on-hand', () => {
    const product = productOf({ availableStock: 4, reorderLevel: 10, maximumStock: 25 });
    const covered = assessReorder({ product, openSupply: 16 });
    expect(covered.triggered).toBe(false);
    expect(covered.position).toBe(20);
    expect(covered.note).toContain('No replenishment needed');
    const short = assessReorder({ product, openSupply: 0 });
    expect(short.triggered).toBe(true);
    expect(short.targetLevel).toBe(25);
    expect(short.suggestedQuantity).toBe(21); // to max: 25 − 4
    expect(short.note).toContain('order 21');
  });

  it('the target always exceeds the trigger — one draft closes the loop', () => {
    // No max, no safety: target = reorderLevel + 1, never reorderLevel itself.
    const bare = assessReorder({ product: productOf({ availableStock: 0, reorderLevel: 5 }), openSupply: 0 });
    expect(bare.triggered).toBe(true);
    expect(bare.targetLevel).toBe(6);
    expect(bare.suggestedQuantity).toBe(6);
    // After the draft, the position sits ABOVE the trigger → quiet.
    const after = assessReorder({ product: productOf({ availableStock: 0, reorderLevel: 5 }), openSupply: 6 });
    expect(after.triggered).toBe(false);
    // Safety stock raises the target; a misconfigured max below it never lowers it.
    const safety = assessReorder({
      product: productOf({ availableStock: 2, reorderLevel: 5, safetyStock: 4, maximumStock: 3 }),
      openSupply: 0,
    });
    expect(safety.targetLevel).toBe(9);
    expect(safety.suggestedQuantity).toBe(7);
  });

  it('inactive products and missing reorder levels never trigger — and say why', () => {
    const inactive = assessReorder({
      product: productOf({ status: 'inactive', availableStock: 0, reorderLevel: 5 }),
      openSupply: 0,
    });
    expect(inactive.triggered).toBe(false);
    expect(inactive.note).toContain('inactive');
    const noLevel = assessReorder({ product: productOf({ availableStock: 0 }), openSupply: 0 });
    expect(noLevel.triggered).toBe(false);
    expect(noLevel.note).toContain('no reorder level');
  });

  it('request numbering is deterministic per SKU and increments past the highest', () => {
    expect(autoReorderRequestNumber('SKU-1', [])).toBe('PR-AUTO-SKU-1-1');
    expect(autoReorderRequestNumber('SKU-1', ['PR-AUTO-SKU-1-1', 'PR-AUTO-SKU-1-7', 'PR-AUTO-SKU-2-9', 'PR-0001'])).toBe(
      'PR-AUTO-SKU-1-8',
    );
  });
});

// ── Cross-module integration ───────────────────────────────────────────────

describe('Movement-driven auto-reordering', () => {
  let dir: string;
  let products: EnterpriseModule;
  let movements: EnterpriseModule;
  let requests: EnterpriseModule;
  let orders: EnterpriseModule;

  const modules = (): Record<string, EnterpriseModule> => ({
    [PRODUCTS_MODULE_ID]: products,
    [STOCK_MOVEMENTS_MODULE_ID]: movements,
    [PURCHASE_REQUESTS_MODULE_ID]: requests,
    [PURCHASE_ORDERS_MODULE_ID]: orders,
  });
  const ctx = (only?: string[]): EnterpriseModuleActionContext =>
    ({
      actor: () => 'storekeeper',
      now: () => T0,
      authorize: () => undefined,
      emit: () => undefined,
      moduleFor: (id: string) => (only && !only.includes(id) ? null : (modules()[id] ?? null)),
    }) as unknown as EnterpriseModuleActionContext;

  const createVia = (mod: EnterpriseModule, fields: Record<string, unknown>, title: string) => {
    const v = mod.hooks.validate({ fields });
    if (!v.ok) throw new Error(JSON.stringify(v.errors));
    return mod.store.create({ title, fields: v.values, actor: 't', now: T0 });
  };
  let seq = 0;
  const post = (type: 'receive' | 'issue', quantity: number, c = ctx()) =>
    postStockMovement(c, {
      movementNumber: `MV-${++seq}`,
      type,
      product: 'SKU-1',
      warehouse: 'WH-01',
      quantity,
      referenceModule: 'test',
      referenceRecord: 'test',
    });

  beforeEach(async () => {
    dir = join(tmpdir(), `np-reorder-${randomUUID()}`);
    await fs.mkdir(dir, { recursive: true });
    products = createProductModule(join(dir, 'products.json'));
    movements = createStockMovementModule(join(dir, 'movements.json'));
    requests = createPurchaseRequestModule(join(dir, 'requests.json'));
    orders = createPurchaseOrderModule(join(dir, 'orders.json'));
    await Promise.all([products.store.load(), movements.store.load(), requests.store.load(), orders.store.load()]);
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

  it('a movement that hits the reorder level drafts ONE purchase request — the draft is open supply', async () => {
    createVia(
      products,
      { sku: 'SKU-1', name: 'Widget', reorderLevel: 10, maximumStock: 25, autoReorder: 'on' },
      'Widget',
    );
    await post('receive', 12);
    expect(requests.store.list()).toHaveLength(0); // 12 > 10 — quiet
    await post('issue', 3); // available 9 ≤ 10 → draft
    const drafted = requests.store.list();
    expect(drafted).toHaveLength(1);
    const req = drafted[0];
    expect(String(req.fields.requestNumber)).toBe('PR-AUTO-SKU-1-1');
    expect(String(req.fields.status)).toBe('draft');
    expect(String(req.fields.priority)).toBe('high'); // stock low, not exhausted
    expect(String(req.fields.requester)).toBe('auto-reorder');
    expect(Number(req.fields.quantity)).toBe(16); // to max: 25 − (9 + 0)
    expect(String(req.fields.reason)).toContain('position 9');
    // Next movement: position 8 + 16 on paper = 24 > 10 → NO duplicate.
    await post('issue', 1);
    expect(requests.store.list()).toHaveLength(1);
    // The product's derived stock stayed ledger-true throughout.
    const product = productFromRecord(products.store.list()[0]);
    expect(product.availableStock).toBe(8);
  });

  it('autoReorder off (the default) never drafts — pre-FW-6 behavior exactly', async () => {
    createVia(products, { sku: 'SKU-1', name: 'Widget', reorderLevel: 10, maximumStock: 25 }, 'Widget');
    await post('receive', 12);
    await post('issue', 5); // available 7 ≤ 10, but the product never opted in
    expect(requests.store.list()).toHaveLength(0);
  });

  it('no Procurement wired → the ledger and reconciliation still stand, nothing drafted', async () => {
    createVia(
      products,
      { sku: 'SKU-1', name: 'Widget', reorderLevel: 10, autoReorder: 'on' },
      'Widget',
    );
    const inventoryOnly = ctx([PRODUCTS_MODULE_ID, STOCK_MOVEMENTS_MODULE_ID]);
    await post('receive', 12, inventoryOnly);
    await post('issue', 5, inventoryOnly);
    expect(productFromRecord(products.store.list()[0]).availableStock).toBe(7);
    expect(requests.store.list()).toHaveLength(0);
  });

  it('manual Check Reorder: assesses regardless of the flag, urgent when exhausted, quiet when covered', async () => {
    createVia(products, { sku: 'SKU-1', name: 'Widget', reorderLevel: 5 }, 'Widget'); // flag off
    const record = () => products.store.list()[0];
    // Above the level → honest "no replenishment" message, nothing drafted.
    await post('receive', 8);
    const fine = await products.hooks.runAction!(REORDER_CHECK_ACTION, record(), ctx());
    expect(fine.ok).toBe(true);
    expect(fine.message).toContain('No replenishment needed');
    expect(requests.store.list()).toHaveLength(0);
    // Exhaust the stock → the human-invoked check drafts, marked urgent.
    await post('issue', 8);
    const drafted = await products.hooks.runAction!(REORDER_CHECK_ACTION, record(), ctx());
    expect(drafted.ok).toBe(true);
    expect(drafted.message).toContain('Drafted PR-AUTO-SKU-1-1');
    const req = requests.store.list()[0];
    expect(String(req.fields.priority)).toBe('urgent'); // available ≤ 0
    expect(String(req.fields.requester)).toBe('storekeeper'); // the human who asked
    expect(Number(req.fields.quantity)).toBe(6); // target reorderLevel + 1
    // Re-check: the draft covers the position → quiet, no duplicate.
    const again = await products.hooks.runAction!(REORDER_CHECK_ACTION, record(), ctx());
    expect(again.ok).toBe(true);
    expect(requests.store.list()).toHaveLength(1);
  });

  it('manual check without Procurement refuses loudly', async () => {
    createVia(products, { sku: 'SKU-1', name: 'Widget', reorderLevel: 5 }, 'Widget');
    const res = await products.hooks.runAction!(
      REORDER_CHECK_ACTION,
      products.store.list()[0],
      ctx([PRODUCTS_MODULE_ID, STOCK_MOVEMENTS_MODULE_ID]),
    );
    expect(res.ok).toBe(false);
    expect(res.error).toContain('not available');
  });
});
