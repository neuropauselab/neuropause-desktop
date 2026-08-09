/**
 * Medical Device Pack — the import path, against the REAL Data Plane and the
 * REAL synthetic dataset shipped in `examples/medical-device`.
 *
 * The risk this covers is specific. The Data Plane writes imported rows
 * straight to a record store, deliberately, so a bulk load cannot be blocked by
 * a per-record hook. For every other module that is fine. For a lot it is not:
 * a row arrives with a lot number and a quantity and none of the invariants the
 * pack depends on — no tenant, no counters, a status the state machine may not
 * recognise, and a product named by code rather than by record.
 *
 * So the row becomes a lot in `onChange`, which the framework runs over every
 * imported record. If that ever stops working, imported batches sit in the
 * store looking real and answering traces with nothing, which is the worst
 * failure this feature can have. These tests are what stands between that and
 * a green build.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import {
  DEVICE_LOTS_MODULE_ID,
  DEVICE_PRODUCTS_MODULE_ID,
  deviceLotFromRecord,
  lotRemaining,
  normalizeProductCode,
} from '@neuropause/shared';
import { entityById } from '../dataPlane/ontology';
import { RELATIONSHIPS } from '../dataPlane/relationshipModel';
import { parseFile } from '../dataPlane/parsers';
import type { EnterpriseModule } from '../enterprise/framework';
import { createDeviceLotModule, importedLotPatch } from './deviceLotModule';
import { createDeviceProductModule } from './deviceProductModule';
import { TraceService } from './traceService';
import { TraceEdgeStore } from './traceStore';

const T0 = '2026-08-09T00:00:00.000Z';
const HERE = dirname(fileURLToPath(import.meta.url));
const DATASET = resolve(HERE, '../../../../../examples/medical-device');

let dir: string;
let products: EnterpriseModule;
let lots: EnterpriseModule;
let edges: TraceEdgeStore;
let trace: TraceService;

const tenantId = (): string => 'default';

const productIdForCode = (code: string): string => {
  const wanted = normalizeProductCode(code);
  if (!wanted) return '';
  return (
    products.store
      .list()
      .find(
        (r) =>
          String(r.metadata?.tenantId ?? '') === tenantId() &&
          normalizeProductCode(String(r.fields.productCode ?? '')) === wanted,
      )?.id ?? ''
  );
};

beforeEach(async () => {
  dir = join(tmpdir(), `np-md-import-${randomUUID()}`);
  await fs.mkdir(dir, { recursive: true });
  products = createDeviceProductModule(join(dir, 'p.json'), { tenantId });
  edges = new TraceEdgeStore(join(dir, 'trace.json'));
  lots = createDeviceLotModule(join(dir, 'l.json'), () => T0, {
    tenantId,
    productIdForCode,
    recordEdge: ({ kind, lotId, lotNumber, targetId, quantity, unit, at }) => {
      const lotRef = { type: 'lot' as const, id: lotId, label: lotNumber };
      const target =
        kind === 'lot_of_product'
          ? { type: 'product' as const, id: targetId, label: targetId }
          : kind === 'lot_stored_in'
            ? { type: 'warehouse' as const, id: targetId, label: targetId }
            : kind === 'lot_supplied_by'
              ? { type: 'supplier' as const, id: targetId, label: targetId }
              : { type: 'manufacturing_order' as const, id: targetId, label: targetId };
      const from = kind === 'mo_produced_lot' ? target : lotRef;
      const to = kind === 'mo_produced_lot' ? lotRef : target;
      edges.record({ tenantId: tenantId(), kind, from, to, quantity, unit, at });
    },
  });
  trace = new TraceService({ lots, products, edges, tenantId, authorize: () => undefined });
  await Promise.all([products.store.load(), lots.store.load(), edges.load()]);
});

afterEach(async () => {
  await new Promise((r) => setTimeout(r, 25));
  await fs.rm(dir, { recursive: true, force: true }).catch(() => undefined);
});

/** Read one of the shipped synthetic files through the REAL parser. */
async function readDataset(file: string): Promise<Record<string, string>[]> {
  const buffer = await fs.readFile(join(DATASET, file));
  const parsed = parseFile(file, buffer);
  const table = parsed.tables[0];
  if (!table) throw new Error(`No table parsed from ${file}: ${parsed.unsupportedReason ?? 'no tables'}`);
  return table.rows.map((row) => {
    const record: Record<string, string> = {};
    table.headers.forEach((h, i) => {
      record[h] = String(row[i] ?? '');
    });
    return record;
  });
}

/** Write a row into a store the way the Data Plane importer does: no hooks. */
function importRow(module: EnterpriseModule, title: string, fields: Record<string, string | number>): string {
  return module.store.create({ title, fields, actor: 'importer', now: T0 }).id;
}

/** Replay an imported record through the module lifecycle, as the framework does. */
async function replay(module: EnterpriseModule, recordId: string): Promise<void> {
  const record = module.store.get(recordId);
  if (!record) throw new Error('record vanished');
  await module.hooks.onChange?.(
    { action: 'created', record },
    {
      actor: () => 'importer',
      now: () => T0,
      authorize: () => undefined,
      moduleFor: () => null,
      emit: () => undefined,
      correlationId: 'import-1',
    },
  );
}

/* ── the shipped dataset ──────────────────────────────────────────────────── */

describe('The synthetic dataset that ships with the pack', () => {
  it('exists, parses, and is unmistakably marked as invented', async () => {
    const productRows = await readDataset('synthetic-products.csv');
    const lotRows = await readDataset('synthetic-lots.csv');
    expect(productRows.length).toBeGreaterThan(50);
    expect(lotRows.length).toBeGreaterThan(200);
    // Every identifier is prefixed so an invented row can never be mistaken for
    // a real one if the file is imported into a workspace holding real records.
    for (const row of productRows) {
      expect(row['Product Code']).toMatch(/^SYN-/);
      expect(row['Product Name']).toMatch(/^SYNTHETIC /);
    }
    for (const row of lotRows) {
      expect(row['Lot Number']).toMatch(/^SYN-LOT-/);
      expect(row['Product Code']).toMatch(/^SYN-/);
    }
  });

  it('exercises the states the Lot Center has views for', async () => {
    const statuses = new Set((await readDataset('synthetic-lots.csv')).map((r) => r.Status));
    expect(statuses).toContain('released');
    expect(statuses).toContain('quarantined');
    expect(statuses).toContain('blocked');
  });

  it('contains lots with NO expiry — the common real case, and the one a naive UI gets wrong', async () => {
    const rows = await readDataset('synthetic-lots.csv');
    expect(rows.some((r) => r['Expiry Date'] === '')).toBe(true);
    expect(rows.some((r) => r['Expiry Date'] !== '')).toBe(true);
  });
});

/* ── the ontology + relationship declarations ─────────────────────────────── */

describe('Data Command Center wiring', () => {
  it('routes both canonical entities to the modules that exist', () => {
    expect(entityById('medical_device_product')?.moduleId).toBe(DEVICE_PRODUCTS_MODULE_ID);
    expect(entityById('medical_device_lot')?.moduleId).toBe(DEVICE_LOTS_MODULE_ID);
  });

  it('treats a batch as high-risk, so it is never imported without a person saying so', () => {
    // A lot is the unit a recall is executed in. Auto-importing one is the
    // single worst default this feature could ship with.
    expect(entityById('medical_device_lot')?.risk).toBe('high');
  });

  it('maps the header names a manufacturer’s spreadsheet actually uses', () => {
    const lot = entityById('medical_device_lot');
    const synonyms = (key: string): readonly string[] =>
      lot?.fields.find((f) => f.key === key)?.synonyms ?? [];
    expect(synonyms('lotNumber')).toEqual(expect.arrayContaining(['batch no', 'lot number', 'batch code']));
    expect(synonyms('expiryDate')).toEqual(expect.arrayContaining(['use by', 'exp date']));
    expect(synonyms('productCode')).toEqual(expect.arrayContaining(['cat no', 'part number']));
  });

  it('declares the lot references the engine can resolve, and none it cannot', () => {
    const declared = RELATIONSHIPS.filter((r) => r.fromModuleId === DEVICE_LOTS_MODULE_ID);
    expect(declared.map((r) => r.key).sort()).toEqual([
      'mdLot.manufacturingOrder',
      'mdLot.product',
      'mdLot.supplier',
      'mdLot.warehouse',
    ]);
    // None allows a similarity proposal: a lot's product is identified by an
    // exact catalogue code, and "close enough" is the wrong answer to "which
    // device is this batch?".
    for (const rel of declared) expect(rel.allowNameProposal).toBeUndefined();
  });

  it('every declared lot reference names a field that exists on both sides', () => {
    const descriptorFields = (moduleId: string): string[] => {
      if (moduleId === DEVICE_LOTS_MODULE_ID) return lots.descriptor.fields.map((f) => f.key);
      if (moduleId === DEVICE_PRODUCTS_MODULE_ID) return products.descriptor.fields.map((f) => f.key);
      return [];
    };
    for (const rel of RELATIONSHIPS.filter((r) => r.fromModuleId === DEVICE_LOTS_MODULE_ID)) {
      expect(descriptorFields(DEVICE_LOTS_MODULE_ID)).toContain(rel.field);
    }
    const productRel = RELATIONSHIPS.find((r) => r.key === 'mdLot.product');
    for (const key of productRel?.keyFields ?? []) {
      expect(descriptorFields(DEVICE_PRODUCTS_MODULE_ID)).toContain(key);
    }
  });
});

/* ── the normalization that makes an imported row a real lot ──────────────── */

describe('Imported lot normalization', () => {
  it('fills in exactly what is missing, and nothing that is not', () => {
    const record = {
      id: 'r1',
      fields: {
        lotNumber: 'L',
        quantity: 10,
        status: 'released',
        consumedQuantity: 3,
        splitQuantity: 0,
        unit: 'kg',
        productId: 'p1',
      },
      metadata: { tenantId: 'default' },
    } as never;
    // A complete record needs no patch — so this never fights the service that
    // owns the invariants.
    expect(importedLotPatch(record, 'default', () => 'p1')).toBeNull();
  });

  it('replaces a status the state machine cannot interpret', () => {
    // An uninterpretable status makes every later transition check meaningless.
    const record = {
      id: 'r1',
      fields: { lotNumber: 'L', quantity: 10, status: 'AWAITING QC', consumedQuantity: 0, splitQuantity: 0, unit: 'u', productId: 'p' },
      metadata: { tenantId: 'default' },
    } as never;
    expect(importedLotPatch(record, 'default', () => 'p')?.status).toBe('created');
  });

  it('initialises missing or negative counters', () => {
    const record = {
      id: 'r1',
      fields: { lotNumber: 'L', quantity: 10, status: 'created', consumedQuantity: -4, unit: 'u', productId: 'p' },
      metadata: { tenantId: 'default' },
    } as never;
    const patch = importedLotPatch(record, 'default', () => 'p');
    expect(patch?.consumedQuantity).toBe(0);
    expect(patch?.splitQuantity).toBe(0);
  });

  it('resolves the product from its code, and leaves the code alone when it cannot', () => {
    const record = {
      id: 'r1',
      fields: { lotNumber: 'L', productCode: 'TR-1001', quantity: 1, status: 'created', consumedQuantity: 0, splitQuantity: 0, unit: 'u' },
      metadata: { tenantId: 'default' },
    } as never;
    expect(importedLotPatch(record, 'default', () => 'prod-9')?.productId).toBe('prod-9');
    // Unresolved is a legitimate state — the reference parks in the relationship
    // queue rather than being invented.
    expect(importedLotPatch(record, 'default', () => '')?.productId).toBeUndefined();
  });
});

/* ── a real import of the shipped dataset ─────────────────────────────────── */

describe('Importing the synthetic dataset end to end', () => {
  it('turns rows into traceable lots, whatever order they arrive in', async () => {
    const productRows = (await readDataset('synthetic-products.csv')).slice(0, 20);
    const lotRows = (await readDataset('synthetic-lots.csv')).filter((r) =>
      productRows.some((p) => p['Product Code'] === r['Product Code']),
    );
    expect(lotRows.length).toBeGreaterThan(0);

    // LOTS FIRST, deliberately. Import order must not matter.
    const lotIds = lotRows.map((row) =>
      importRow(lots, row['Lot Number']!, {
        lotNumber: row['Lot Number']!,
        productCode: row['Product Code']!,
        quantity: Number(row.Quantity),
        unit: row.Unit!,
        manufactureDate: row['Manufacture Date']!,
        expiryDate: row['Expiry Date']!,
        warehouseId: row.Warehouse!,
        manufacturingOrderId: row['Manufacturing Order']!,
        supplierId: row.Supplier!,
        status: row.Status!,
      }),
    );
    for (const id of lotIds) await replay(lots, id);

    // Every lot is tenant-stamped and arithmetically sound even though its
    // product does not exist yet.
    for (const id of lotIds) {
      const record = lots.store.get(id)!;
      expect(record.metadata.tenantId).toBe('default');
      const lot = deviceLotFromRecord(record);
      expect(lot.consumedQuantity).toBe(0);
      expect(lotRemaining(lot)).toBe(lot.quantity);
      expect(lot.productId).toBe(''); // parked: the product has not arrived
    }

    // Now the products arrive.
    for (const row of productRows) {
      const v = products.hooks.validate({
        fields: {
          productCode: row['Product Code']!,
          productName: row['Product Name']!,
          productFamily: row.Family!,
          category: row.Category!,
          material: row.Material!,
          sterileStatus: row.Sterility!,
          batchLotTracked: true,
          status: 'active',
        },
      });
      expect(v.ok, JSON.stringify(v)).toBe(true);
      products.store.create({
        title: row['Product Name']!,
        fields: v.values,
        metadata: { tenantId: 'default' },
        actor: 'importer',
        now: T0,
      });
    }

    // A second pass links what was parked — the same "retry pending" behaviour
    // the relationship engine gives every other imported reference.
    for (const id of lotIds) await replay(lots, id);
    for (const id of lotIds) {
      expect(deviceLotFromRecord(lots.store.get(id)!).productId).not.toBe('');
    }

    // And the lots are now traceable, from records rather than from names.
    const sample = lots.store.get(lotIds[0]!)!;
    const forward = await trace.forward('lot', sample.id);
    const warehouse = String(sample.fields.warehouseId ?? '');
    if (warehouse) expect(forward.result.byType.warehouse.map((w) => w.id)).toContain(warehouse);
    expect(forward.scopeNote).toContain('nothing here is inferred');
  });

  it('re-importing the same file does not double a lot’s destinations', async () => {
    const row = (await readDataset('synthetic-lots.csv'))[0]!;
    const fields = {
      lotNumber: row['Lot Number']!,
      productCode: row['Product Code']!,
      quantity: Number(row.Quantity),
      unit: row.Unit!,
      warehouseId: row.Warehouse!,
      supplierId: row.Supplier!,
      manufacturingOrderId: row['Manufacturing Order']!,
      status: row.Status!,
    };
    const id = importRow(lots, fields.lotNumber, fields);
    await replay(lots, id);
    const first = edges.count('default');
    await replay(lots, id);
    await replay(lots, id);
    expect(edges.count('default')).toBe(first);
  });
});
