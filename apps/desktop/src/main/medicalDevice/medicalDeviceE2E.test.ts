/**
 * Medical Device Pack — end-to-end through the REAL channel surface.
 *
 * This drives the same handler definitions the app registers, with the same Zod
 * schemas validating every payload, against real stores on a temp directory.
 * The core business services are NOT mocked — the lot service, the trace
 * service, the record stores and the inventory ledger are the real objects.
 *
 * What that buys: the renderer's calls are checked against the contracts they
 * actually cross. A payload the UI sends that the schema rejects, a handler
 * returning a shape the panel does not expect, or a channel wired to the wrong
 * service, fails here rather than on a device.
 *
 * What it does NOT do, stated plainly: it does not render React. The repository
 * has no DOM testing library, so pixel-level verification of the panels remains
 * DEVICE VISUAL VERIFICATION PENDING — see the traceability documentation.
 * Every judgement the panels make is nonetheless covered, by
 * `renderer/src/medicalDevices/medicalDevicesModel.test.ts`.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type {
  DeviceLotDetail,
  DeviceLotMutationResult,
  DeviceLotPage,
  DeviceProductDetail,
  DeviceProductListItem,
  DeviceTraceView,
  EnterpriseAuditEntry,
  EnterprisePermission,
  IpcChannelName,
  MedicalDevicePackView,
} from '@neuropause/shared';
import {
  DEVICE_LOTS_MODULE_ID,
  DEVICE_PRODUCTS_MODULE_ID,
  IpcChannel,
  PRODUCTS_MODULE_ID,
  STOCK_MOVEMENTS_MODULE_ID,
} from '@neuropause/shared';
import type { EnterpriseModule, EnterpriseModuleActionContext } from '../enterprise/framework';
import { buildModuleHandlers, EnterpriseModuleRegistry } from '../enterprise/framework';
import { createProductModule } from '../enterprise/modules/inventory/productModule';
import { createStockMovementModule } from '../enterprise/modules/inventory/stockMovementModule';
import { createDeviceLotModule } from './deviceLotModule';
import { createDeviceProductModule } from './deviceProductModule';
import { buildMedicalDeviceHandlers, registerMedicalDevicePack } from './index';
import { LotService } from './lotService';
import { TraceService } from './traceService';
import { TraceEdgeStore } from './traceStore';

const T0 = '2026-08-09T00:00:00.000Z';

interface App {
  dir: string;
  /** Invoke a channel exactly as the secure bridge would: validate, then run. */
  call: <T>(channel: IpcChannelName, payload: unknown) => Promise<T>;
  audits: EnterpriseAuditEntry[];
  movements: EnterpriseModule;
  inventoryProducts: EnterpriseModule;
  lotStore: EnterpriseModule;
  /** Resolves when every store's write queue is empty. See the afterEach below. */
  flush: () => Promise<void>;
}

async function boot(): Promise<App> {
  const dir = join(tmpdir(), `np-md-e2e-${randomUUID()}`);
  await fs.mkdir(dir, { recursive: true });
  const tenantId = (): string => 'default';
  const granted: EnterprisePermission[] = [
    'medicalDevice:product.read',
    'medicalDevice:product.write',
    'medicalDevice:lot.read',
    'medicalDevice:lot.write',
    'medicalDevice:traceability.read',
    'inventory:read',
    'inventory:manage',
  ];
  const authorize = (permission: EnterprisePermission): void => {
    if (!granted.includes(permission)) throw new Error(`Missing permission: ${permission}`);
  };
  const audits: EnterpriseAuditEntry[] = [];
  const audit = (e: { action: string; target: string; summary: string }): void => {
    audits.push({ id: `a${audits.length}`, at: T0, actor: 'operator', ...e } as EnterpriseAuditEntry);
  };

  const deviceProducts = createDeviceProductModule(join(dir, 'md-products.json'), { tenantId });
  const inventoryProducts = createProductModule(join(dir, 'inv-products.json'));
  const movements = createStockMovementModule(join(dir, 'inv-movements.json'));
  const edges = new TraceEdgeStore(join(dir, 'trace.json'));
  const deviceLots = createDeviceLotModule(join(dir, 'md-lots.json'), () => T0);

  await Promise.all([
    deviceProducts.store.load(),
    deviceLots.store.load(),
    inventoryProducts.store.load(),
    movements.store.load(),
    edges.load(),
  ]);

  // The REAL module registry + the REAL generic CRUD handlers: product writes in
  // this test take exactly the path the UI takes.
  const registry = new EnterpriseModuleRegistry();
  const ctx = {
    authorize,
    audit,
    broadcast: () => undefined,
    actor: () => 'operator',
    now: () => T0,
  };
  const moduleHandlers = buildModuleHandlers(registry, ctx);
  registry.register(deviceProducts);
  registry.register(deviceLots);
  registry.register(inventoryProducts);
  registry.register(movements);

  const actionCtx = {
    actor: () => 'operator',
    now: () => T0,
    authorize,
    moduleFor: (id: string) => registry.get(id),
    emit: () => undefined,
  } as unknown as EnterpriseModuleActionContext;

  const lotService = new LotService({
    lots: deviceLots,
    products: deviceProducts,
    edges,
    tenantId,
    actor: () => 'operator',
    now: () => T0,
    authorize,
    audit,
    moduleContext: () => actionCtx,
  });
  const traceService = new TraceService({ lots: deviceLots, products: deviceProducts, edges, tenantId, authorize });

  registerMedicalDevicePack();
  const mdHandlers = buildMedicalDeviceHandlers({
    products: deviceProducts,
    lots: deviceLots,
    edges,
    lotService,
    traceService,
    tenantId,
    authorize,
    auditEntries: (limit) => audits.slice(-limit).reverse(),
  });

  const byChannel = new Map([...moduleHandlers, ...mdHandlers].map((h) => [h.channel as string, h]));
  const call = async <T,>(channel: IpcChannelName, payload: unknown): Promise<T> => {
    const handler = byChannel.get(channel);
    if (!handler) throw new Error(`No handler registered for ${channel}`);
    // The secure bridge validates before dispatch. Doing the same here is the
    // point of the test: a payload the UI would send that the schema rejects
    // must fail, not be quietly accepted by a hand-rolled call.
    const parsed = handler.schema.parse(payload);
    return (await handler.handler(parsed)) as T;
  };

  const flush = async (): Promise<void> => {
    await Promise.all([
      deviceProducts.store.flush(),
      deviceLots.store.flush(),
      inventoryProducts.store.flush(),
      movements.store.flush(),
      edges.flush(),
    ]);
  };

  return { dir, call, audits, movements, inventoryProducts, lotStore: deviceLots, flush };
}

let app: App;
beforeEach(async () => {
  app = await boot();
});
afterEach(async () => {
  /**
   * AWAIT THE WRITE QUEUE, DO NOT SLEEP AND HOPE. P13C ROUND 17l.
   *
   * Every store here writes atomically (tmp file, then rename). A `setTimeout`
   * in teardown was a GUESS that the queue had drained. It held on an idle Mac
   * and lost on the Windows runner, where the same suite takes 775s instead of
   * 16s — the directory was removed out from under an in-flight rename and the
   * ENOENT surfaced as an unhandled rejection that failed the build while all
   * 8018 tests still reported green. The worst shape a flake can take: no
   * failing test to point at.
   *
   * `medicalDeviceService.test.ts` replaced its own sleep with exactly this,
   * for exactly this reason, and the change never reached its two neighbours.
   */
  await app.flush().catch(() => undefined);
  await fs.rm(app.dir, { recursive: true, force: true }).catch(() => undefined);
});

describe('E2E — the journey the UI walks', () => {
  it('product list → create → detail → lot centre → lot detail → traceability', async () => {
    // 1. Products tab loads the pack and an empty catalogue.
    const pack = await app.call<MedicalDevicePackView>(IpcChannel.MedicalDevicePack, {});
    expect(pack.manifest.id).toBe('medical-device-manufacturing');
    expect(pack.counts).toEqual({ products: 0, lots: 0, traceEdges: 0 });
    expect(pack.taxonomies.find((t) => t.key === 'md.productFamily')?.values.length).toBeGreaterThan(0);
    expect(await app.call<DeviceProductListItem[]>(IpcChannel.MedicalDeviceProductSearch, {})).toEqual([]);

    // 2. "New product" → the GENERIC module create channel, as the form uses.
    const created = await app.call<{ ok: boolean; record?: { id: string } }>(
      IpcChannel.EnterpriseModuleCreate,
      {
        moduleId: DEVICE_PRODUCTS_MODULE_ID,
        fields: {
          productCode: 'TR-1001',
          productName: '4.5mm Cortical Screw',
          productFamily: 'trauma',
          category: 'implant',
          material: 'titanium_alloy',
          sterileStatus: 'sterile',
          batchLotTracked: true,
          status: 'active',
        },
      },
    );
    expect(created.ok).toBe(true);
    const productId = created.record!.id;

    // 3. The list now shows it, and the field-scoped search finds it.
    const listed = await app.call<DeviceProductListItem[]>(IpcChannel.MedicalDeviceProductSearch, {
      query: 'cortical',
    });
    expect(listed.map((p) => p.productCode)).toEqual(['TR-1001']);
    expect(listed[0]!.lotCount).toBe(0);
    expect(
      await app.call<DeviceProductListItem[]>(IpcChannel.MedicalDeviceProductSearch, { family: 'spine' }),
    ).toEqual([]);

    // 4. Product detail, with its audited history.
    const detail = await app.call<DeviceProductDetail>(IpcChannel.MedicalDeviceProductGet, { productId });
    expect(detail.product.productName).toBe('4.5mm Cortical Screw');
    expect(detail.history.map((h) => h.action)).toContain(`module.${DEVICE_PRODUCTS_MODULE_ID}.created`);

    // 5. Lot Centre — empty, with every view counted.
    const emptyPage = await app.call<DeviceLotPage>(IpcChannel.MedicalDeviceLotList, {});
    expect(emptyPage.lots).toEqual([]);
    expect(emptyPage.counts.all).toBe(0);

    // 6. "New lot".
    const lotResult = await app.call<DeviceLotMutationResult>(IpcChannel.MedicalDeviceLotCreate, {
      lotNumber: 'LOT-FG-001',
      productId,
      quantity: 1_000,
      unit: 'pcs',
      warehouseId: 'WH-01',
      manufacturingOrderId: 'MO-102',
    });
    expect(lotResult.ok).toBe(true);
    const lotId = lotResult.lot!.id;

    // 7. Lot detail: identity, derived quantity, legal transitions, honest gaps.
    let lotDetail = await app.call<DeviceLotDetail>(IpcChannel.MedicalDeviceLotGet, { lotId });
    expect(lotDetail.lot.remaining).toBe(1_000);
    expect(lotDetail.product?.productCode).toBe('TR-1001');
    expect(lotDetail.allowedTransitions.map((t) => t.status)).toContain('released');
    expect(lotDetail.allowedTransitions.map((t) => t.status)).not.toContain('consumed');
    expect(lotDetail.notConfigured.map((n) => n.section)).toContain('Quality status');
    expect(lotDetail.context.manufacturingOrders.map((m) => m.id)).toEqual(['MO-102']);

    // 8. Release, then ship — the two operations a lot detail actually offers.
    expect(
      (
        await app.call<DeviceLotMutationResult>(IpcChannel.MedicalDeviceLotTransition, {
          lotId,
          status: 'released',
        })
      ).ok,
    ).toBe(true);
    const shipped = await app.call<DeviceLotMutationResult>(IpcChannel.MedicalDeviceLotShip, {
      lotId,
      shipmentId: 'SH-3001',
      customerId: 'CUST-004',
      orderId: 'ORD-77',
      quantity: 400,
    });
    expect(shipped.ok).toBe(true);
    expect(shipped.lot?.remaining).toBe(600);
    expect(shipped.lot?.status).toBe('partially_consumed');

    // 9. The Released view includes a partially consumed lot; Quarantined does not.
    const released = await app.call<DeviceLotPage>(IpcChannel.MedicalDeviceLotList, { view: 'released' });
    expect(released.lots.map((l) => l.lotNumber)).toEqual(['LOT-FG-001']);
    expect((await app.call<DeviceLotPage>(IpcChannel.MedicalDeviceLotList, { view: 'quarantined' })).lots).toEqual(
      [],
    );

    // 10. Traceability, both directions, from the button on the lot detail.
    const forward = await app.call<DeviceTraceView>(IpcChannel.MedicalDeviceTraceForward, {
      nodeType: 'lot',
      nodeId: lotId,
    });
    expect(forward.result.byType.customer.map((c) => c.id)).toEqual(['CUST-004']);
    expect(forward.result.byType.warehouse.map((w) => w.id)).toEqual(['WH-01']);
    expect(forward.lines.some((l) => l.verb === 'delivered to')).toBe(true);

    const backward = await app.call<DeviceTraceView>(IpcChannel.MedicalDeviceTraceBackward, {
      nodeType: 'customer',
      nodeId: 'CUST-004',
    });
    expect(backward.result.nodes.map((n) => n.label)).toContain('LOT-FG-001');
    expect(backward.result.byType.manufacturing_order.map((m) => m.id)).toEqual(['MO-102']);

    // 11. The lot's audit trail is what the detail's Audit section renders.
    lotDetail = await app.call<DeviceLotDetail>(IpcChannel.MedicalDeviceLotGet, { lotId });
    const actions = lotDetail.history.map((h) => h.action);
    expect(actions).toContain('medicalDevice.lot.created');
    expect(actions).toContain('medicalDevice.lot.status_changed');
    expect(actions).toContain('medicalDevice.lot.shipped');

    // 12. The pack counts the UI shows in its tabs are live.
    const after = await app.call<MedicalDevicePackView>(IpcChannel.MedicalDevicePack, {});
    expect(after.counts.products).toBe(1);
    expect(after.counts.lots).toBe(1);
    expect(after.counts.traceEdges).toBeGreaterThan(0);
  });

  it('a generic record write against a lot is refused with the sentence the UI shows', async () => {
    const result = await app.call<{ ok: boolean; errors?: Record<string, string> }>(
      IpcChannel.EnterpriseModuleCreate,
      { moduleId: DEVICE_LOTS_MODULE_ID, fields: { lotNumber: 'SNEAK-1', quantity: 9_999 } },
    );
    expect(result.ok).toBe(false);
    expect(result.errors?._).toContain('Batch/Lot Center');
    expect(app.lotStore.store.list()).toHaveLength(0);
  });

  it('rejects a malformed payload at the contract, before any service sees it', async () => {
    // The schemas are the boundary. A negative quantity must never reach the
    // service, and an unknown field must not be silently carried through.
    await expect(
      app.call(IpcChannel.MedicalDeviceLotCreate, { lotNumber: 'L', productId: 'p', quantity: -1 }),
    ).rejects.toThrow();
    await expect(
      app.call(IpcChannel.MedicalDeviceLotCreate, {
        lotNumber: 'L',
        productId: 'p',
        quantity: 1,
        somethingElse: true,
      }),
    ).rejects.toThrow();
    await expect(
      app.call(IpcChannel.MedicalDeviceLotTransition, { lotId: 'x', status: 'sort_of_released' }),
    ).rejects.toThrow();
  });

  it('the split the charter describes, driven exactly as the split drawer drives it', async () => {
    const created = await app.call<{ ok: boolean; record?: { id: string } }>(IpcChannel.EnterpriseModuleCreate, {
      moduleId: DEVICE_PRODUCTS_MODULE_ID,
      fields: { productCode: 'RM-TI64', productName: 'Bar Stock', batchLotTracked: true, status: 'active' },
    });
    const productId = created.record!.id;
    const lot = await app.call<DeviceLotMutationResult>(IpcChannel.MedicalDeviceLotCreate, {
      lotNumber: 'LOT-001',
      productId,
      quantity: 100,
      unit: 'kg',
      warehouseId: 'WH-RAW',
    });
    const lotId = lot.lot!.id;
    await app.call(IpcChannel.MedicalDeviceLotTransition, { lotId, status: 'released' });

    const split = await app.call<DeviceLotMutationResult>(IpcChannel.MedicalDeviceLotSplit, {
      lotId,
      parts: [
        { lotNumber: 'LOT-001-A', quantity: 60 },
        { lotNumber: 'LOT-001-B', quantity: 40 },
      ],
    });
    expect(split.ok).toBe(true);
    expect(split.created?.map((c) => c.lotNumber)).toEqual(['LOT-001-A', 'LOT-001-B']);
    expect(split.lot?.remaining).toBe(0);

    // 100 = 60 + 40, and the parent traces forward to both children.
    const children = split.created!;
    expect(children.reduce((n, c) => n + c.quantity, 0)).toBe(100);
    const forward = await app.call<DeviceTraceView>(IpcChannel.MedicalDeviceTraceForward, {
      nodeType: 'lot',
      nodeId: lotId,
    });
    expect(forward.result.byType.lot.map((l) => l.label)).toEqual(
      expect.arrayContaining(['LOT-001-A', 'LOT-001-B']),
    );

    // And each child traces back to the parent.
    const back = await app.call<DeviceTraceView>(IpcChannel.MedicalDeviceTraceBackward, {
      nodeType: 'lot',
      nodeId: children[0]!.id,
    });
    expect(back.result.nodes.map((n) => n.label)).toContain('LOT-001');
  });

  it('merge answers with its reason, so the UI never has to infer the absence', async () => {
    const result = await app.call<DeviceLotMutationResult>(IpcChannel.MedicalDeviceLotMerge, {
      lotIds: ['a', 'b'],
    });
    expect(result.ok).toBe(false);
    expect(result.error).toContain('Merging lots is not supported');
  });

  it('an inventory movement is posted through the EXISTING ledger, not a second one', async () => {
    const inv = app.inventoryProducts;
    const v = inv.hooks.validate({ fields: { sku: 'TR-2001', name: 'Plate', unit: 'pcs', status: 'active' } });
    inv.store.create({ title: 'Plate', fields: v.values, actor: 'operator', now: T0 });

    const product = await app.call<{ ok: boolean; record?: { id: string } }>(IpcChannel.EnterpriseModuleCreate, {
      moduleId: DEVICE_PRODUCTS_MODULE_ID,
      fields: { productCode: 'TR-2001', productName: 'Plate', batchLotTracked: true, status: 'active' },
    });
    await app.call(IpcChannel.MedicalDeviceLotCreate, {
      lotNumber: 'LOT-PLATE-1',
      productId: product.record!.id,
      quantity: 50,
      warehouseId: 'WH-01',
    });

    const posted = app.movements.store.list();
    expect(posted).toHaveLength(1);
    expect(posted[0]!.fields.referenceModule).toBe(DEVICE_LOTS_MODULE_ID);
    expect(posted[0]!.moduleId).toBe(STOCK_MOVEMENTS_MODULE_ID);
    // The device product master and the inventory product master stay separate —
    // no phantom record was created in either to satisfy the other.
    expect(app.inventoryProducts.store.list()).toHaveLength(1);
    expect(PRODUCTS_MODULE_ID).toBe('inventory-products');
  });
});
