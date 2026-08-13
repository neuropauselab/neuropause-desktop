/**
 * Medical Device Pack — the services, against REAL stores on a temp directory.
 *
 * Nothing is mocked below the service boundary: the product module, the lot
 * module, the trace edge store and the inventory ledger are the same objects
 * the app wires at boot. That matters — the defects this layer can have are
 * exactly the ones a mock hides: a write that lands in the wrong tenant, a
 * quantity that reconciles in memory but not on disk, an edge that is recorded
 * twice when an operation is retried.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  DEVICE_LOTS_MODULE_ID,
  DEVICE_PRODUCTS_MODULE_ID,
  LOT_MERGE_UNSUPPORTED_REASON,
  PRODUCTS_MODULE_ID,
  STOCK_MOVEMENTS_MODULE_ID,
  deviceLotFromRecord,
  type EnterprisePermission,
} from '@neuropause/shared';
import type { EnterpriseModule, EnterpriseModuleActionContext } from '../enterprise/framework';
import { createProductModule } from '../enterprise/modules/inventory/productModule';
import { createStockMovementModule } from '../enterprise/modules/inventory/stockMovementModule';
import { createDeviceLotModule, LOT_DIRECT_WRITE_REFUSAL } from './deviceLotModule';
import { createDeviceProductModule } from './deviceProductModule';
import { LotService } from './lotService';
import { TraceService } from './traceService';
import { TraceEdgeStore } from './traceStore';

const T0 = '2026-08-09T00:00:00.000Z';

interface Harness {
  dir: string;
  deviceProducts: EnterpriseModule;
  deviceLots: EnterpriseModule;
  edges: TraceEdgeStore;
  lots: LotService;
  trace: TraceService;
  audits: { action: string; target: string; summary: string }[];
  tenant: { id: string };
  granted: Set<string>;
  inventoryProducts: EnterpriseModule;
  movements: EnterpriseModule;
}

async function harness(): Promise<Harness> {
  const dir = join(tmpdir(), `np-md-${randomUUID()}`);
  await fs.mkdir(dir, { recursive: true });
  const tenant = { id: 'tenant-a' };
  const granted = new Set<string>([
    'medicalDevice:product.read',
    'medicalDevice:product.write',
    'medicalDevice:lot.read',
    'medicalDevice:lot.write',
    'medicalDevice:traceability.read',
    'inventory:read',
    'inventory:manage',
  ]);
  const authorize = (permission: EnterprisePermission): void => {
    if (!granted.has(permission)) throw new Error(`Missing permission: ${permission}`);
  };

  const deviceProducts = createDeviceProductModule(join(dir, 'md-products.json'), {
    tenantId: () => tenant.id,
  });
  const deviceLots = createDeviceLotModule(join(dir, 'md-lots.json'), () => T0);
  const edges = new TraceEdgeStore(join(dir, 'trace.json'));
  const inventoryProducts = createProductModule(join(dir, 'inv-products.json'));
  const movements = createStockMovementModule(join(dir, 'inv-movements.json'));

  await Promise.all([
    deviceProducts.store.load(),
    deviceLots.store.load(),
    edges.load(),
    inventoryProducts.store.load(),
    movements.store.load(),
  ]);

  const modules: Record<string, EnterpriseModule> = {
    [DEVICE_PRODUCTS_MODULE_ID]: deviceProducts,
    [DEVICE_LOTS_MODULE_ID]: deviceLots,
    [PRODUCTS_MODULE_ID]: inventoryProducts,
    [STOCK_MOVEMENTS_MODULE_ID]: movements,
  };
  const actionCtx = {
    actor: () => 'tester',
    now: () => T0,
    authorize,
    moduleFor: (id: string) => modules[id] ?? null,
    emit: () => undefined,
  } as unknown as EnterpriseModuleActionContext;

  const audits: { action: string; target: string; summary: string }[] = [];
  let seq = 0;
  const lots = new LotService({
    lots: deviceLots,
    products: deviceProducts,
    edges,
    tenantId: () => tenant.id,
    actor: () => 'tester',
    now: () => T0,
    authorize,
    audit: (e) => audits.push(e),
    moduleContext: () => actionCtx,
    nextMovementNumber: () => `MV-${++seq}`,
  });
  const trace = new TraceService({
    lots: deviceLots,
    products: deviceProducts,
    edges,
    tenantId: () => tenant.id,
    authorize,
  });

  return {
    dir,
    deviceProducts,
    deviceLots,
    edges,
    lots,
    trace,
    audits,
    tenant,
    granted,
    inventoryProducts,
    movements,
  };
}

/** Create a device product the way the generic CRUD handler would. */
function createProduct(
  h: Harness,
  fields: Record<string, string | number | boolean | null>,
): { id: string } {
  const v = h.deviceProducts.hooks.validate({ fields });
  if (!v.ok) throw new Error(`product invalid: ${JSON.stringify(v.errors)}`);
  const record = h.deviceProducts.store.create({
    title: String(fields.productName ?? ''),
    fields: v.values,
    metadata: { tenantId: h.tenant.id },
    actor: 'tester',
    now: T0,
  });
  return { id: record.id };
}

let h: Harness;
beforeEach(async () => {
  h = await harness();
});
afterEach(async () => {
  // Every store writes atomically (tmp file + rename). A sleep here was a
  // GUESS that the write had drained — it held on an idle machine and lost the
  // race under a full parallel run, deleting the directory out from under an
  // in-flight rename. The result was an unhandled ENOENT rejection that failed
  // the whole suite while every test still reported green, which is the worst
  // shape a flake can take: no failing test to point at.
  //
  // Each store exposes `flush()`, which resolves when its write queue is
  // actually empty. Awaiting that is deterministic, and faster than the sleep.
  await Promise.all([
    h.deviceProducts.store.flush(),
    h.deviceLots.store.flush(),
    h.inventoryProducts.store.flush(),
    h.movements.store.flush(),
    h.edges.flush(),
  ]);
  await fs.rm(h.dir, { recursive: true, force: true }).catch(() => undefined);
});

/* ── product ──────────────────────────────────────────────────────────────── */

describe('Product module', () => {
  it('creates a product and derives its title from the product name', () => {
    const { id } = createProduct(h, { productCode: 'TR-1001', productName: '4.5mm Cortical Screw' });
    expect(h.deviceProducts.store.get(id)?.title).toBe('4.5mm Cortical Screw');
  });

  it('refuses a duplicate product code across case, spaces, dots and dashes', () => {
    createProduct(h, { productCode: 'TR-1001', productName: 'Screw' });
    for (const code of ['TR-1001', 'tr-1001', 'TR 1001', 'tr.1001', 'TR1001']) {
      const v = h.deviceProducts.hooks.validate({ fields: { productCode: code, productName: 'Other' } });
      expect(v.ok, `"${code}" should collide`).toBe(false);
    }
  });

  it('a product does not collide with ITSELF when an unrelated field is edited', () => {
    // Without the record id on the validate input, every edit of an existing
    // product would be refused for duplicating its own code.
    const { id } = createProduct(h, { productCode: 'TR-1001', productName: 'Screw' });
    const v = h.deviceProducts.hooks.validate({
      recordId: id,
      fields: { productCode: 'TR-1001', productName: 'Screw', material: 'titanium_alloy' },
    });
    expect(v.ok).toBe(true);
  });

  it('refuses regulatory metadata that is not a JSON object, and says what to type', () => {
    const v = h.deviceProducts.hooks.validate({
      fields: { productCode: 'X-1', productName: 'X', regulatoryMetadata: 'class IIb' },
    });
    expect(v.ok).toBe(false);
    expect((v as { errors: Record<string, string> }).errors.regulatoryMetadata).toContain('JSON object');
  });

  it('refuses serial tracking without batch tracking', () => {
    const v = h.deviceProducts.hooks.validate({
      fields: { productCode: 'X-1', productName: 'X', serialTracked: true, batchLotTracked: false },
    });
    expect(v.ok).toBe(false);
    expect((v as { errors: Record<string, string> }).errors.serialTracked).toContain('recalled by batch');
  });

  it('a product code used in ANOTHER tenant is not a collision', () => {
    createProduct(h, { productCode: 'TR-1001', productName: 'Screw' });
    h.tenant.id = 'tenant-b';
    const v = h.deviceProducts.hooks.validate({ fields: { productCode: 'TR-1001', productName: 'Screw' } });
    expect(v.ok).toBe(true);
  });
});

/* ── lot writes are service-only ──────────────────────────────────────────── */

describe('Lot write path', () => {
  it('refuses a generic record write, naming where to go instead', () => {
    const v = h.deviceLots.hooks.validate({ fields: { lotNumber: 'LOT-X', quantity: 999 } });
    expect(v.ok).toBe(false);
    expect((v as { errors: Record<string, string> }).errors._).toBe(LOT_DIRECT_WRITE_REFUSAL);
  });
});

/* ── lot creation ─────────────────────────────────────────────────────────── */

describe('Lot creation', () => {
  it('creates a lot, stamps the tenant and records its context edges', async () => {
    const product = createProduct(h, { productCode: 'TR-1001', productName: 'Screw' });
    const result = await h.lots.createLot({
      lotNumber: 'LOT-001',
      productId: product.id,
      quantity: 100,
      unit: 'pcs',
      warehouseId: 'WH-01',
      supplierId: 'SUP-1',
    });
    expect(result.ok).toBe(true);
    expect(result.lot?.remaining).toBe(100);
    expect(result.lot?.status).toBe('created');
    const kinds = h.edges.forTenant('tenant-a').map((e) => e.kind);
    expect(kinds).toEqual(expect.arrayContaining(['lot_of_product', 'lot_supplied_by', 'lot_stored_in']));
    expect(h.audits.map((a) => a.action)).toContain('medicalDevice.lot.created');
  });

  it('refuses a lot for a product that is not batch/lot tracked', async () => {
    const product = createProduct(h, {
      productCode: 'IN-1',
      productName: 'Instrument',
      batchLotTracked: false,
    });
    const result = await h.lots.createLot({ lotNumber: 'L1', productId: product.id, quantity: 1 });
    expect(result.ok).toBe(false);
    expect(result.error).toContain('Batch / Lot Tracked');
  });

  it('refuses a duplicate lot number', async () => {
    const product = createProduct(h, { productCode: 'TR-1001', productName: 'Screw' });
    await h.lots.createLot({ lotNumber: 'LOT-001', productId: product.id, quantity: 10 });
    const again = await h.lots.createLot({ lotNumber: 'lot-001', productId: product.id, quantity: 5 });
    expect(again.ok).toBe(false);
    expect(again.error).toContain('already exists');
  });

  it('refuses an unknown product and a zero quantity', async () => {
    expect((await h.lots.createLot({ lotNumber: 'L', productId: 'nope', quantity: 1 })).ok).toBe(false);
    const product = createProduct(h, { productCode: 'TR-1001', productName: 'Screw' });
    expect((await h.lots.createLot({ lotNumber: 'L', productId: product.id, quantity: 0 })).ok).toBe(false);
    expect((await h.lots.createLot({ lotNumber: 'L', productId: product.id, quantity: -5 })).ok).toBe(false);
  });

  it('refuses an expiry that precedes manufacture', async () => {
    const product = createProduct(h, { productCode: 'TR-1001', productName: 'Screw' });
    const result = await h.lots.createLot({
      lotNumber: 'L',
      productId: product.id,
      quantity: 1,
      manufactureDate: '2026-05-01',
      expiryDate: '2026-01-01',
    });
    expect(result.ok).toBe(false);
    expect(result.error).toContain('before the manufacture date');
  });

  it('a lot with no expiry is created without complaint', async () => {
    const product = createProduct(h, { productCode: 'TR-1001', productName: 'Screw' });
    const result = await h.lots.createLot({ lotNumber: 'L', productId: product.id, quantity: 1 });
    expect(result.ok).toBe(true);
    expect(result.lot?.expired).toBe(false);
  });
});

/* ── tenant isolation ─────────────────────────────────────────────────────── */

describe('Tenant isolation', () => {
  it('a lot created in one tenant is invisible in another', async () => {
    const product = createProduct(h, { productCode: 'TR-1001', productName: 'Screw' });
    const created = await h.lots.createLot({ lotNumber: 'LOT-001', productId: product.id, quantity: 10 });
    expect(created.ok).toBe(true);
    h.tenant.id = 'tenant-b';
    expect(await h.lots.allLots()).toEqual([]);
    expect(await h.lots.lotById(created.lot!.id)).toBeNull();
  });

  it('a lot cannot be created against another tenant’s product, and the refusal does not confirm it exists', async () => {
    const product = createProduct(h, { productCode: 'TR-1001', productName: 'Screw' });
    h.tenant.id = 'tenant-b';
    const result = await h.lots.createLot({ lotNumber: 'L', productId: product.id, quantity: 1 });
    expect(result.ok).toBe(false);
    expect(result.error).toBe('That product does not exist. Choose a product from the catalogue.');
  });

  it('a traceability answer never crosses tenants', async () => {
    const product = createProduct(h, { productCode: 'TR-1001', productName: 'Screw' });
    const lot = await h.lots.createLot({
      lotNumber: 'LOT-001',
      productId: product.id,
      quantity: 10,
      warehouseId: 'WH-01',
    });
    h.tenant.id = 'tenant-b';
    const view = await h.trace.forward('lot', lot.lot!.id);
    expect(view.result.steps).toEqual([]);
    expect(view.scopeNote).toContain('nothing has been recorded yet');
  });
});

/* ── lifecycle + quantity ─────────────────────────────────────────────────── */

describe('Lot lifecycle and quantity', () => {
  const seed = async (quantity = 100): Promise<string> => {
    const product = createProduct(h, { productCode: 'TR-1001', productName: 'Screw' });
    const created = await h.lots.createLot({
      lotNumber: 'LOT-001',
      productId: product.id,
      quantity,
      warehouseId: 'WH-01',
    });
    return created.lot!.id;
  };

  it('walks created → quarantined → released and audits each step', async () => {
    const id = await seed();
    expect((await h.lots.transition(id, 'quarantined')).ok).toBe(true);
    expect((await h.lots.transition(id, 'released')).ok).toBe(true);
    const statusAudits = h.audits.filter((a) => a.action === 'medicalDevice.lot.status_changed');
    expect(statusAudits).toHaveLength(2);
    expect(statusAudits[1]!.summary).toContain('Quarantined → Released');
  });

  it('refuses an illegal transition', async () => {
    const id = await seed();
    await h.lots.transition(id, 'blocked');
    const result = await h.lots.transition(id, 'consumed');
    expect(result.ok).toBe(false);
    expect(result.error).toContain('cannot go from Blocked to Consumed');
  });

  it('refuses to mark a lot consumed while material remains', async () => {
    // Otherwise the status silently disagrees with the arithmetic, and the
    // quantity is evidence, not a display value.
    const id = await seed();
    await h.lots.transition(id, 'released');
    const result = await h.lots.transition(id, 'consumed');
    expect(result.ok).toBe(false);
    expect(result.error).toContain('still has 100');
  });

  it('consumption moves the lot to partially consumed, then consumed', async () => {
    const id = await seed();
    await h.lots.transition(id, 'released');
    const first = await h.lots.consume({ lotId: id, quantity: 40 });
    expect(first.lot?.status).toBe('partially_consumed');
    expect(first.lot?.remaining).toBe(60);
    const second = await h.lots.consume({ lotId: id, quantity: 60 });
    expect(second.lot?.status).toBe('consumed');
    expect(second.lot?.remaining).toBe(0);
  });

  it('refuses over-consumption and double consumption', async () => {
    const id = await seed(50);
    await h.lots.transition(id, 'released');
    expect((await h.lots.consume({ lotId: id, quantity: 60 })).ok).toBe(false);
    await h.lots.consume({ lotId: id, quantity: 50 });
    const again = await h.lots.consume({ lotId: id, quantity: 50 });
    expect(again.ok).toBe(false);
    expect(again.error).toContain('consumed lot');
  });

  it('refuses to consume or ship from a quarantined, blocked or recalled lot', async () => {
    // The single most important refusal in the service: material that is not
    // released must not be able to reach a patient by either route.
    const product = createProduct(h, { productCode: 'GATE-1', productName: 'Gated' });
    for (const status of ['quarantined', 'blocked', 'recalled'] as const) {
      const created = await h.lots.createLot({
        lotNumber: `GATE-${status}`,
        productId: product.id,
        quantity: 10,
      });
      const id = created.lot!.id;
      expect((await h.lots.transition(id, status)).ok).toBe(true);
      expect((await h.lots.consume({ lotId: id, quantity: 1 })).ok).toBe(false);
      expect(
        (await h.lots.recordShipment({ lotId: id, shipmentId: `SH-${status}`, quantity: 1 })).ok,
      ).toBe(false);
    }
  });

  it('quantity survives a reload from disk', async () => {
    const id = await seed();
    await h.lots.transition(id, 'released');
    await h.lots.consume({ lotId: id, quantity: 25 });
    await h.deviceLots.store.flush();
    const reloaded = deviceLotFromRecord(h.deviceLots.store.get(id)!);
    expect(reloaded.consumedQuantity).toBe(25);
    expect(reloaded.quantity).toBe(100);
  });
});

/* ── split and merge ──────────────────────────────────────────────────────── */

describe('Lot split', () => {
  const seedReleased = async (): Promise<string> => {
    const product = createProduct(h, { productCode: 'TR-1001', productName: 'Screw' });
    const created = await h.lots.createLot({
      lotNumber: 'LOT-001',
      productId: product.id,
      quantity: 100,
      warehouseId: 'WH-01',
    });
    await h.lots.transition(created.lot!.id, 'released');
    return created.lot!.id;
  };

  it('splits 100 into 60 + 40 and conserves the total', async () => {
    const id = await seedReleased();
    const result = await h.lots.split(id, [
      { lotNumber: 'LOT-001-A', quantity: 60 },
      { lotNumber: 'LOT-001-B', quantity: 40 },
    ]);
    expect(result.ok).toBe(true);
    expect(result.created).toHaveLength(2);
    expect(result.lot?.remaining).toBe(0);
    expect(result.lot?.status).toBe('exhausted');
    const childTotal = result.created!.reduce((n, c) => n + c.quantity, 0);
    expect(childTotal).toBe(100);
  });

  it('children inherit lineage, product and disposition', async () => {
    const id = await seedReleased();
    const result = await h.lots.split(id, [
      { lotNumber: 'A', quantity: 60 },
      { lotNumber: 'B', quantity: 40 },
    ]);
    for (const child of result.created!) {
      expect(child.parentLotId).toBe(id);
      expect(child.sourceLotId).toBe(id);
      expect(child.productCode).toBe('TR-1001');
      expect(child.status).toBe('released');
    }
  });

  it('splitting quarantined material never produces material that looks free to use', async () => {
    const product = createProduct(h, { productCode: 'TR-1001', productName: 'Screw' });
    const created = await h.lots.createLot({ lotNumber: 'Q1', productId: product.id, quantity: 100 });
    await h.lots.transition(created.lot!.id, 'quarantined');
    const result = await h.lots.split(created.lot!.id, [
      { lotNumber: 'Q1-A', quantity: 60 },
      { lotNumber: 'Q1-B', quantity: 40 },
    ]);
    // Refused outright: quarantined material is not drawable at all.
    expect(result.ok).toBe(false);
    expect(result.error).toContain('quarantined');
  });

  it('records a lineage edge per child, and the parent traces forward to them', async () => {
    const id = await seedReleased();
    await h.lots.split(id, [
      { lotNumber: 'A', quantity: 60 },
      { lotNumber: 'B', quantity: 40 },
    ]);
    const forward = await h.trace.forward('lot', id);
    expect(forward.result.byType.lot.map((l) => l.label)).toEqual(expect.arrayContaining(['A', 'B']));
  });

  it('refuses a child lot number that already exists', async () => {
    const id = await seedReleased();
    const product = h.deviceProducts.store.list()[0]!;
    await h.lots.createLot({ lotNumber: 'TAKEN', productId: product.id, quantity: 5 });
    const result = await h.lots.split(id, [
      { lotNumber: 'TAKEN', quantity: 10 },
      { lotNumber: 'FREE', quantity: 10 },
    ]);
    expect(result.ok).toBe(false);
    expect(result.error).toContain('already exists');
  });

  it('refuses a split larger than the lot, leaving the lot untouched', async () => {
    const id = await seedReleased();
    const before = await h.lots.lotById(id);
    const result = await h.lots.split(id, [
      { lotNumber: 'A', quantity: 90 },
      { lotNumber: 'B', quantity: 90 },
    ]);
    expect(result.ok).toBe(false);
    const after = await h.lots.lotById(id);
    expect(after).toEqual(before);
    expect((await h.lots.allLots()).map((l) => l.lotNumber)).toEqual(['LOT-001']);
  });
});

describe('Lot merge', () => {
  it('always refuses, explains why, and records the refusal', async () => {
    const result = await h.lots.merge(['a', 'b']);
    expect(result.ok).toBe(false);
    expect(result.error).toBe(LOT_MERGE_UNSUPPORTED_REASON);
    expect(h.audits.map((a) => a.action)).toContain('medicalDevice.lot.merge_refused');
  });
});

/* ── authorization ────────────────────────────────────────────────────────── */

describe('Authorization', () => {
  it('a reader cannot write a lot', async () => {
    const product = createProduct(h, { productCode: 'TR-1001', productName: 'Screw' });
    h.granted.delete('medicalDevice:lot.write');
    await expect(
      h.lots.createLot({ lotNumber: 'L', productId: product.id, quantity: 1 }),
    ).rejects.toThrow('Missing permission: medicalDevice:lot.write');
  });

  it('a lot writer without the traceability scope cannot run a trace', async () => {
    h.granted.delete('medicalDevice:traceability.read');
    await expect(h.trace.forward('lot', 'anything')).rejects.toThrow(
      'Missing permission: medicalDevice:traceability.read',
    );
  });

  it('a lot change still succeeds when the actor cannot post to the inventory ledger', async () => {
    // The batch record is the primary fact. A missing inventory right must not
    // be able to unwind it — but nor may it be reported as a successful posting.
    const product = createProduct(h, { productCode: 'TR-1001', productName: 'Screw' });
    h.granted.delete('inventory:manage');
    const result = await h.lots.createLot({
      lotNumber: 'L',
      productId: product.id,
      quantity: 5,
      warehouseId: 'WH-01',
    });
    expect(result.ok).toBe(true);
    expect(h.movements.store.list()).toHaveLength(0);
  });
});

/* ── inventory integration ────────────────────────────────────────────────── */

describe('Inventory integration', () => {
  it('posts to the EXISTING ledger when a matching inventory product exists', async () => {
    const invValidation = h.inventoryProducts.hooks.validate({
      fields: { sku: 'TR-1001', name: 'Screw', unit: 'pcs', status: 'active' },
    });
    expect(invValidation.ok).toBe(true);
    h.inventoryProducts.store.create({
      title: 'Screw',
      fields: invValidation.values,
      actor: 'tester',
      now: T0,
    });
    const product = createProduct(h, { productCode: 'TR-1001', productName: 'Screw' });
    await h.lots.createLot({
      lotNumber: 'LOT-001',
      productId: product.id,
      quantity: 100,
      warehouseId: 'WH-01',
    });
    const movements = h.movements.store.list();
    expect(movements).toHaveLength(1);
    expect(movements[0]!.fields.type).toBe('receive');
    expect(movements[0]!.fields.quantity).toBe(100);
    expect(movements[0]!.fields.referenceModule).toBe(DEVICE_LOTS_MODULE_ID);
  });

  it('never invents an inventory product to satisfy a lot', async () => {
    // A manufacturer may keep its device catalogue here and not in Inventory.
    // The ledger accepts the movement (it is an immutable journal and does not
    // gate on the product master), and the reconciler finds no product to
    // update — so the movement is recorded and NO phantom product is created.
    // Creating one would put an article into the inventory master that nobody
    // catalogued, which is exactly the silent-duplicate failure the relationship
    // engine refuses on the import side.
    const product = createProduct(h, { productCode: 'ONLY-MD', productName: 'Screw' });
    const result = await h.lots.createLot({
      lotNumber: 'LOT-001',
      productId: product.id,
      quantity: 10,
      warehouseId: 'WH-01',
    });
    expect(result.ok).toBe(true);
    expect(h.inventoryProducts.store.list()).toHaveLength(0);
    const movements = h.movements.store.list();
    expect(movements).toHaveLength(1);
    expect(movements[0]!.fields.product).toBe('ONLY-MD');
  });
});

/* ── traceability edges ───────────────────────────────────────────────────── */

describe('Traceability edge store', () => {
  it('is idempotent — a retried operation does not double a lot’s destinations', async () => {
    const product = createProduct(h, { productCode: 'TR-1001', productName: 'Screw' });
    const created = await h.lots.createLot({
      lotNumber: 'L',
      productId: product.id,
      quantity: 10,
      warehouseId: 'WH-01',
    });
    await h.lots.transition(created.lot!.id, 'released');
    await h.lots.recordShipment({ lotId: created.lot!.id, shipmentId: 'SH-1', quantity: 1, customerId: 'C-1' });
    const before = h.edges.count('tenant-a');
    // Re-record the same shipment edge directly: same identity, one row.
    h.edges.record({
      tenantId: 'tenant-a',
      kind: 'lot_shipped_in',
      from: { type: 'lot', id: created.lot!.id, label: 'L' },
      to: { type: 'shipment', id: 'SH-1', label: 'SH-1' },
      at: T0,
    });
    expect(h.edges.count('tenant-a')).toBe(before);
  });

  it('attaches provenance to an existing edge without overwriting evidence already there', () => {
    const ref = { type: 'lot' as const, id: 'l1', label: 'L1' };
    const wh = { type: 'warehouse' as const, id: 'WH-01', label: 'WH-01' };
    h.edges.record({ tenantId: 't', kind: 'lot_stored_in', from: ref, to: wh, at: T0 });
    h.edges.record({
      tenantId: 't',
      kind: 'lot_stored_in',
      from: ref,
      to: wh,
      at: T0,
      provenance: { planId: 'plan-1', provenanceId: 'prov-1' },
    });
    h.edges.record({
      tenantId: 't',
      kind: 'lot_stored_in',
      from: ref,
      to: wh,
      at: T0,
      provenance: { planId: 'plan-2', provenanceId: 'prov-2' },
    });
    const edges = h.edges.forTenant('t');
    expect(edges).toHaveLength(1);
    expect(edges[0]!.provenance).toEqual({ planId: 'plan-1', provenanceId: 'prov-1' });
  });
});

/* ── the charter's end-to-end scenario ────────────────────────────────────── */

describe('End-to-end: raw material → order → finished goods → warehouse → shipment → customer', () => {
  it('every relationship is recorded, and both traces answer from real records', async () => {
    const rawProduct = createProduct(h, {
      productCode: 'RM-TI64',
      productName: 'Ti-6Al-4V Bar Stock',
      category: 'raw_material',
      material: 'titanium_alloy',
    });
    const fgProduct = createProduct(h, {
      productCode: 'TR-1001',
      productName: '4.5mm Cortical Screw',
      productFamily: 'trauma',
      material: 'titanium_alloy',
    });

    // 1. Raw material lots.
    const rm1 = await h.lots.createLot({
      lotNumber: 'LOT-RM-001',
      productId: rawProduct.id,
      quantity: 40,
      unit: 'kg',
      warehouseId: 'WH-RAW',
      supplierId: 'SUP-TIMET',
    });
    const rm2 = await h.lots.createLot({
      lotNumber: 'LOT-RM-002',
      productId: rawProduct.id,
      quantity: 25,
      unit: 'kg',
      warehouseId: 'WH-RAW',
      supplierId: 'SUP-TIMET',
    });
    await h.lots.transition(rm1.lot!.id, 'released');
    await h.lots.transition(rm2.lot!.id, 'released');

    // 2. The manufacturing order consumes both.
    await h.lots.consume({ lotId: rm1.lot!.id, quantity: 30, manufacturingOrderId: 'MO-102' });
    await h.lots.consume({ lotId: rm2.lot!.id, quantity: 20, manufacturingOrderId: 'MO-102' });

    // 3. It produces a finished goods lot.
    const fg = await h.lots.createLot({
      lotNumber: 'LOT-FG-001',
      productId: fgProduct.id,
      quantity: 1_000,
      unit: 'pcs',
      manufacturingOrderId: 'MO-102',
    });
    await h.lots.transition(fg.lot!.id, 'quarantined');
    await h.lots.transition(fg.lot!.id, 'released');

    // 4. Warehouse, 5. shipment, 6. customer + order.
    await h.lots.moveToWarehouse(fg.lot!.id, 'WH-01');
    const shipped = await h.lots.recordShipment({
      lotId: fg.lot!.id,
      shipmentId: 'SH-3001',
      customerId: 'CUST-004',
      orderId: 'ORD-77',
      quantity: 400,
    });
    expect(shipped.ok).toBe(true);
    expect(shipped.lot?.remaining).toBe(600);

    // Forward from a RAW MATERIAL lot: where did this material end up?
    const forward = await h.trace.forward('lot', rm1.lot!.id);
    const forwardIds = forward.result.nodes.map((n) => n.id);
    expect(forwardIds).toContain('MO-102');
    expect(forwardIds).toContain(fg.lot!.id);
    expect(forward.result.byType.warehouse.map((w) => w.id)).toContain('WH-01');
    expect(forward.result.byType.shipment.map((s) => s.id)).toEqual(['SH-3001']);
    expect(forward.result.byType.customer.map((c) => c.id)).toEqual(['CUST-004']);
    expect(forward.result.byType.order.map((o) => o.id)).toEqual(['ORD-77']);
    expect(forward.scopeNote).toContain('nothing here is inferred');

    // Backward from the CUSTOMER: which raw materials reached them?
    const backward = await h.trace.backward('customer', 'CUST-004');
    const backIds = backward.result.nodes.map((n) => n.id);
    expect(backIds).toContain('SH-3001');
    expect(backIds).toContain(fg.lot!.id);
    expect(backIds).toContain('MO-102');
    expect(backIds).toContain(rm1.lot!.id);
    expect(backIds).toContain(rm2.lot!.id);

    // The labels are the live lot numbers, not whatever an edge recorded earlier.
    expect(backward.result.nodes.map((n) => n.label)).toEqual(
      expect.arrayContaining(['LOT-RM-001', 'LOT-RM-002', 'LOT-FG-001']),
    );

    // And the quantities still reconcile everywhere.
    for (const l of await h.lots.allLots()) {
      expect(l.quantity - l.consumedQuantity - l.splitQuantity).toBeGreaterThanOrEqual(0);
    }
  });
});

/* ── performance, on a realistic synthetic dataset ────────────────────────── */

describe('Performance on 1,000 lots / 10,000+ relationships', () => {
  it('answers a lookup and both traces without a pathological walk', async () => {
    const product = createProduct(h, { productCode: 'PERF-1', productName: 'Perf Product' });
    const lotIds: string[] = [];
    for (let i = 0; i < 1_000; i += 1) {
      const created = await h.lots.createLot({
        lotNumber: `PERF-LOT-${i}`,
        productId: product.id,
        quantity: 100,
        warehouseId: `WH-${i % 10}`,
      });
      lotIds.push(created.lot!.id);
    }
    // 1,000 lots already carry 2,000 context edges. Add a chain of manufacturing
    // and distribution edges to pass 10,000 relationships.
    for (let i = 0; i < 1_000; i += 1) {
      const lotRef = { type: 'lot' as const, id: lotIds[i]!, label: `PERF-LOT-${i}` };
      const mo = { type: 'manufacturing_order' as const, id: `MO-${i}`, label: `MO-${i}` };
      const ship = { type: 'shipment' as const, id: `SH-${i}`, label: `SH-${i}` };
      h.edges.record({ tenantId: 'tenant-a', kind: 'mo_produced_lot', from: mo, to: lotRef, at: T0 });
      if (i > 0) {
        h.edges.record({
          tenantId: 'tenant-a',
          kind: 'mo_consumed_lot',
          from: mo,
          to: { type: 'lot', id: lotIds[i - 1]!, label: `PERF-LOT-${i - 1}` },
          at: T0,
        });
      }
      const ship2 = { type: 'shipment' as const, id: `SH2-${i}`, label: `SH2-${i}` };
      for (const s of [ship, ship2]) {
        h.edges.record({ tenantId: 'tenant-a', kind: 'lot_shipped_in', from: lotRef, to: s, at: T0 });
        h.edges.record({
          tenantId: 'tenant-a',
          kind: 'shipment_to_customer',
          from: s,
          to: { type: 'customer', id: `CUST-${i % 50}`, label: `CUST-${i % 50}` },
          at: T0,
        });
        h.edges.record({
          tenantId: 'tenant-a',
          kind: 'shipment_for_order',
          from: s,
          to: { type: 'order', id: `ORD-${i}`, label: `ORD-${i}` },
          at: T0,
        });
      }
      h.edges.record({
        tenantId: 'tenant-a',
        kind: 'lot_supplied_by',
        from: lotRef,
        to: { type: 'supplier', id: `SUP-${i % 20}`, label: `SUP-${i % 20}` },
        at: T0,
      });
    }

    expect(await h.lots.allLots()).toHaveLength(1_000);
    expect(h.edges.count('tenant-a')).toBeGreaterThan(10_000);

    const lookupStart = performance.now();
    const found = await h.lots.lotById(lotIds[500]!);
    const lookupMs = performance.now() - lookupStart;
    expect(found?.lotNumber).toBe('PERF-LOT-500');

    const forwardStart = performance.now();
    const forward = await h.trace.forward('lot', lotIds[0]!);
    const forwardMs = performance.now() - forwardStart;

    const backwardStart = performance.now();
    const backward = await h.trace.backward('lot', lotIds[999]!);
    const backwardMs = performance.now() - backwardStart;

    // Deliberately loose bounds. This asserts the traversal is not accidentally
    // quadratic or unbounded; it is NOT a published benchmark, and the numbers
    // that would make one are not fabricated here.
    expect(lookupMs).toBeLessThan(500);
    expect(forwardMs).toBeLessThan(5_000);
    expect(backwardMs).toBeLessThan(5_000);
    expect(forward.result.truncated || forward.result.nodes.length > 1).toBe(true);
    expect(backward.result.nodes.length).toBeGreaterThan(1);
  }, 120_000);
});
