/**
 * Warehouse conversions — the deterministic fulfilment chain inside the execution
 * layer: Pick List → Packing → Shipping. Each resolves its target module from the
 * action context, cross-links both records, emits lifecycle for audit + Timeline,
 * is idempotent, and never deletes. Pure orchestration over the framework — the
 * Sales Order is referenced (not mutated), so Sales is never touched.
 */
import type { EnterpriseEntity, EnterpriseModuleActionResult } from '@neuropause/shared';
import {
  PACKING_MODULE_ID,
  PICK_LISTS_MODULE_ID,
  SHIPPING_MODULE_ID,
  deriveRecordTitle,
  packingFromRecord,
  pickListFromRecord,
} from '@neuropause/shared';
import type { EnterpriseModuleActionContext } from '../../framework';
import { childCorrelationMeta, rootMetaIfUnset } from '../../framework';

export const CREATE_PACKING_ACTION = 'createPacking';
export const CREATE_SHIPMENT_ACTION = 'createShipment';

const str = (v: unknown): string => (v === null || v === undefined ? '' : String(v));

/** Pick List → Packing. Only a picked list converts; idempotent; the pick is retained + linked. */
export async function convertPickToPacking(
  pick: EnterpriseEntity,
  ctx: EnterpriseModuleActionContext,
): Promise<EnterpriseModuleActionResult> {
  if (str(pick.fields.convertedPacking)) {
    return { ok: false, message: 'A packing record already exists for this pick list.' };
  }
  if (str(pick.fields.status) !== 'picked') {
    return { ok: false, message: 'Pick the items before creating a packing record.' };
  }
  const packingModule = ctx.moduleFor(PACKING_MODULE_ID);
  const picksModule = ctx.moduleFor(PICK_LISTS_MODULE_ID);
  if (!packingModule || !picksModule) return { ok: false, error: 'Warehouse modules are not available.' };
  ctx.authorize(packingModule.descriptor.permissions.write);
  await packingModule.store.load();

  const p = pickListFromRecord(pick);
  const validation = packingModule.hooks.validate({
    fields: {
      packNumber: `PACK-${p.pickNumber}`,
      pickList: pick.id,
      product: p.product,
      quantity: p.quantity,
      status: 'pending',
    },
  });
  if (!validation.ok) {
    return { ok: false, error: `Packing: ${Object.values(validation.errors)[0] ?? 'invalid input'}` };
  }
  const packing = packingModule.store.create({
    title: deriveRecordTitle(packingModule.descriptor, validation.values),
    fields: validation.values,
    // Transaction-graph spine: packing is caused by the pick list.
    metadata: childCorrelationMeta(pick, PICK_LISTS_MODULE_ID),
    actor: ctx.actor(),
    now: ctx.now(),
  });
  ctx.emit(packingModule, 'created', packing);

  const updated = picksModule.store.update(pick.id, {
    fields: { convertedPacking: packing.id, status: 'packed' },
    metadata: rootMetaIfUnset(pick, PICK_LISTS_MODULE_ID),
    actor: ctx.actor(),
    now: ctx.now(),
  });
  ctx.emit(picksModule, 'converted', updated ?? pick);
  return { ok: true, message: `Created packing "${packing.title}".` };
}

/** Packing → Shipping (pending). Idempotent; pulls warehouse + sales order from the linked pick. */
export async function convertPackingToShipment(
  packing: EnterpriseEntity,
  ctx: EnterpriseModuleActionContext,
): Promise<EnterpriseModuleActionResult> {
  if (str(packing.fields.convertedShipment)) {
    return { ok: false, message: 'A shipment already exists for this packing record.' };
  }
  if (str(packing.fields.status) !== 'packed') {
    return { ok: false, message: 'Mark the packing as packed before creating a shipment.' };
  }
  const shippingModule = ctx.moduleFor(SHIPPING_MODULE_ID);
  const packingModule = ctx.moduleFor(PACKING_MODULE_ID);
  const picksModule = ctx.moduleFor(PICK_LISTS_MODULE_ID);
  if (!shippingModule || !packingModule || !picksModule) {
    return { ok: false, error: 'Warehouse modules are not available.' };
  }
  ctx.authorize(shippingModule.descriptor.permissions.write);
  await shippingModule.store.load();

  const pack = packingFromRecord(packing);
  const pickRecord = pack.pickList ? picksModule.store.get(pack.pickList) : null;
  const pick = pickRecord ? pickListFromRecord(pickRecord) : null;

  const validation = shippingModule.hooks.validate({
    fields: {
      shipmentNumber: `SHIP-${pack.packNumber}`,
      pickList: pack.pickList,
      salesOrder: pick?.salesOrder ?? '',
      product: pack.product,
      warehouse: pick?.warehouse ?? '',
      quantity: pack.quantity,
      status: 'pending',
    },
  });
  if (!validation.ok) {
    return { ok: false, error: `Shipment: ${Object.values(validation.errors)[0] ?? 'invalid input'}` };
  }
  const shipment = shippingModule.store.create({
    title: deriveRecordTitle(shippingModule.descriptor, validation.values),
    fields: validation.values,
    // Transaction-graph spine: the shipment is caused by the packing (which
    // inherited the pick's chain).
    metadata: childCorrelationMeta(packing, PACKING_MODULE_ID),
    actor: ctx.actor(),
    now: ctx.now(),
  });
  ctx.emit(shippingModule, 'created', shipment);

  const updated = packingModule.store.update(packing.id, {
    fields: { convertedShipment: shipment.id },
    metadata: rootMetaIfUnset(packing, PACKING_MODULE_ID),
    actor: ctx.actor(),
    now: ctx.now(),
  });
  ctx.emit(packingModule, 'converted', updated ?? packing);
  return { ok: true, message: `Created shipment "${shipment.title}".` };
}
