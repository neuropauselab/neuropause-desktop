import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  activeBomFor,
  explodeBom,
  serializeBomComponents,
  type BillOfMaterials,
} from '@neuropause/shared';
import type { EnterpriseModule } from '../../framework';
import { createBomModule } from './bomModule';
import { createProductModule } from '../inventory/productModule';
import { createBomExplosionModule } from './bomExplosionModule';

const T0 = '2026-08-06T00:00:00.000Z';

const bom = (over: Partial<BillOfMaterials>): BillOfMaterials =>
  ({
    id: 'b1', bomNumber: 'BOM-1', product: 'FG-1', outputQuantity: 1, yield: 100, waste: 0,
    revision: 'A', components: [], status: 'active', notes: '', createdAt: T0, updatedAt: T0, ...over,
  }) as BillOfMaterials;

describe('BOM explosion engine (pure) — recursion, cycles, cost rollup', () => {
  it('explodes sub-assemblies, aggregates purchased leaves, and rolls up cost', () => {
    const boms = [
      bom({ components: [{ sku: 'SUB-1', quantity: 2, waste: 0, alternative: '' }, { sku: 'RM-1', quantity: 3, waste: 0, alternative: '' }] }),
      bom({ id: 'b2', bomNumber: 'BOM-2', product: 'SUB-1', components: [{ sku: 'RM-1', quantity: 4, waste: 0, alternative: '' }, { sku: 'RM-2', quantity: 1, waste: 0, alternative: '' }] }),
    ];
    const products = [
      { sku: 'RM-1', standardCost: 2 },
      { sku: 'RM-2', standardCost: 10 },
    ] as Parameters<typeof explodeBom>[1];
    const x = explodeBom(boms, products, 'FG-1', 5);
    expect(x.maxLevel).toBe(2);
    // RM-1: direct 5×3 = 15, via SUB-1 (5×2=10) × 4 = 40 → 55 total.
    const rm1 = x.requirements.find((r) => r.sku === 'RM-1')!;
    expect(rm1.totalQuantity).toBe(55);
    expect(rm1.cost).toBe(110);
    const rm2 = x.requirements.find((r) => r.sku === 'RM-2')!;
    expect(rm2.totalQuantity).toBe(10);
    expect(x.totalMaterialCost).toBe(210);
    expect(x.cycles).toEqual([]);
    expect(x.rows.find((r) => r.sku === 'SUB-1')?.subassembly).toBe(true);
  });

  it('detects cycles, stops the branch, and picks the greatest active revision', () => {
    const boms = [
      bom({ components: [{ sku: 'SUB-1', quantity: 1, waste: 0, alternative: '' }] }),
      bom({ id: 'b2', bomNumber: 'BOM-2', product: 'SUB-1', components: [{ sku: 'FG-1', quantity: 1, waste: 0, alternative: '' }] }),
      bom({ id: 'b3', bomNumber: 'BOM-3', revision: 'B', components: [{ sku: 'RM-9', quantity: 1, waste: 0, alternative: '' }] }),
    ];
    expect(activeBomFor(boms, 'FG-1')?.revision).toBe('B'); // greatest revision wins
    const x = explodeBom(boms.slice(0, 2), [], 'FG-1', 1);
    expect(x.cycles.length).toBe(1);
    expect(x.cycles[0]).toContain('FG-1 > SUB-1 > FG-1');
    expect(x.rows.find((r) => r.cycle)).toBeTruthy();
  });
});

describe('BOM Explosions over real stores — generation gates and immutability', () => {
  let dir: string;
  let boms: EnterpriseModule;
  let products: EnterpriseModule;
  let explosions: EnterpriseModule;

  beforeEach(async () => {
    dir = join(tmpdir(), `np-bx-${randomUUID()}`);
    await fs.mkdir(dir, { recursive: true });
    boms = createBomModule(join(dir, 'boms.json'));
    products = createProductModule(join(dir, 'products.json'));
    explosions = createBomExplosionModule(join(dir, 'explosions.json'), boms.store, products.store);
    await Promise.all([boms.store.load(), products.store.load(), explosions.store.load()]);
    products.store.create({ title: 'Raw', fields: { sku: 'RM-1', name: 'Raw', standardCost: 2 }, actor: 't@np', now: T0 });
    boms.store.create({
      title: 'BOM-1',
      fields: {
        bomNumber: 'BOM-1', product: 'FG-1', outputQuantity: 1, yield: 100, waste: 0, revision: 'A',
        status: 'active', components: serializeBomComponents([{ sku: 'RM-1', quantity: 3, waste: 0, alternative: '' }]),
      },
      actor: 't@np', now: T0,
    });
  });

  afterEach(async () => {
    await Promise.all([boms.store.flush(), products.store.flush(), explosions.store.flush()]);
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('generates from real stores, refuses roots without an active BOM, freezes after', () => {
    const v = explosions.hooks.validate({ fields: { rootProduct: 'FG-1', quantity: 5 } });
    expect(v.ok, JSON.stringify('errors' in v ? v.errors : {})).toBe(true);
    if (!v.ok) throw new Error('unreachable');
    expect(v.values.reportNumber).toBe('BX-FG-1-1');
    expect(v.values.totalMaterialCost).toBe(30); // 5×3 × 2
    const reqs = JSON.parse(String(v.values.requirements));
    expect(reqs[0]).toMatchObject({ sku: 'RM-1', totalQuantity: 15 });
    expect(explosions.hooks.validate({ fields: { rootProduct: 'GHOST', quantity: 1 } }).ok).toBe(false);
    const rec = explosions.store.create({ title: String(v.values.reportNumber), fields: v.values, actor: 't@np', now: T0 });
    const edit = explosions.hooks.validate({ fields: { ...explosions.store.get(rec.id)!.fields, quantity: 9 } });
    expect(edit.ok).toBe(false);
    if (!edit.ok) expect(JSON.stringify(edit.errors)).toContain('immutable');
  });
});
