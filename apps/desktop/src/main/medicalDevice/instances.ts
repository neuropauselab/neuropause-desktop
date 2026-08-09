/**
 * The process-wide Medical Device Pack singletons.
 *
 * Binds the Electron-free modules and stores to `userData`, following the
 * `*Instance.ts` pattern every other module uses. Nothing here contains logic —
 * if a decision is being made in this file, it belongs in the module or the
 * service, where it can be tested without the app runtime.
 *
 * `TENANT_ID` is a single fixed workspace tenant for this stage. It is threaded
 * through every read and write as a function, so the day a tenant selector
 * exists it becomes `() => activeTenantId()` and nothing else changes. Making it
 * a constant *inside* the service instead would have meant finding every query
 * again later; making it renderer-supplied would have meant a caller could ask
 * for another tenant's batches.
 */
import { app } from 'electron';
import type { TraceNodeRef } from '@neuropause/shared';
import {
  DEVICE_LOTS_MODULE_ID,
  DEVICE_PRODUCTS_MODULE_ID,
  normalizeProductCode,
} from '@neuropause/shared';
import { join } from 'node:path';
import { enterpriseModuleStorePath } from '../enterprise/framework';
import { createDeviceLotModule } from './deviceLotModule';
import { createDeviceProductModule } from './deviceProductModule';
import { TraceEdgeStore } from './traceStore';

/**
 * The tenant every record in this pack is stamped with.
 *
 * One workspace = one manufacturer in this stage. The isolation machinery is
 * real and tested (every query filters on it, every write stamps it); what is
 * not yet built is a way to have a second one.
 */
export const TENANT_ID = 'default';

export const deviceTenantId = (): string => TENANT_ID;

const now = (): string => new Date().toISOString();

export const deviceProductModule = createDeviceProductModule(
  enterpriseModuleStorePath(app.getPath('userData'), DEVICE_PRODUCTS_MODULE_ID),
  { tenantId: deviceTenantId },
);

export const traceEdgeStore = new TraceEdgeStore(
  join(app.getPath('userData'), 'medical-device-traceability.json'),
);

/**
 * The Lots module, wired for import normalization.
 *
 * The Data Plane writes imported rows straight to the store; the framework then
 * replays each one through `onChange`, where these dependencies turn a row into
 * a lot — tenant stamped, counters initialised, product resolved from its code,
 * and its context edges recorded so it is traceable immediately rather than
 * after someone opens it.
 */
export const deviceLotModule = createDeviceLotModule(
  enterpriseModuleStorePath(app.getPath('userData'), DEVICE_LOTS_MODULE_ID),
  now,
  {
    tenantId: deviceTenantId,
    productIdForCode: (code) => {
      const wanted = normalizeProductCode(code);
      if (!wanted) return '';
      const match = deviceProductModule.store
        .list()
        .find(
          (r) =>
            String(r.metadata?.tenantId ?? '') === deviceTenantId() &&
            normalizeProductCode(String(r.fields.productCode ?? '')) === wanted,
        );
      return match?.id ?? '';
    },
    recordEdge: ({ kind, lotId, lotNumber, targetId, quantity, unit, at }) => {
      const lotRef = { type: 'lot' as const, id: lotId, label: lotNumber };
      const target: TraceNodeRef =
        kind === 'lot_of_product'
          ? { type: 'product', id: targetId, label: targetId }
          : kind === 'lot_stored_in'
            ? { type: 'warehouse', id: targetId, label: targetId }
            : kind === 'lot_supplied_by'
              ? { type: 'supplier', id: targetId, label: targetId }
              : { type: 'manufacturing_order', id: targetId, label: targetId };
      // `mo_produced_lot` points order → lot; every other context edge points
      // lot → target. Getting this backwards would make a lot's producer look
      // like its destination.
      const from = kind === 'mo_produced_lot' ? target : lotRef;
      const to = kind === 'mo_produced_lot' ? lotRef : target;
      traceEdgeStore.record({ tenantId: deviceTenantId(), kind, from, to, quantity, unit, at });
    },
  },
);
