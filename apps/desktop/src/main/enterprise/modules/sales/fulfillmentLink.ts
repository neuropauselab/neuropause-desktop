/**
 * Sales ↔ Warehouse fulfillment link — the explicit hand-off that dispatches a Sales
 * Order to the warehouse for picking. It creates a REAL Warehouse Pick List (reusing
 * that module — no new store) for the order's product / warehouse / quantity and
 * cross-links it back. The pick list then reserves, picks, packs, and ships through
 * the existing warehouse flow against the same Inventory Ledger — so finished goods
 * produced by Manufacturing are fulfilled without any duplicate stock.
 *
 * The pick list is the single reservation vehicle on this path (the order's own
 * `reserveStock` is the alternative direct path); the conversion itself reserves
 * nothing, so there is no double reservation.
 */
import type { EnterpriseEntity, EnterpriseModuleActionResult } from '@neuropause/shared';
import { ORDERS_MODULE_ID, PICK_LISTS_MODULE_ID, deriveRecordTitle, orderFromRecord } from '@neuropause/shared';
import type { EnterpriseModuleActionContext } from '../../framework';

export const CREATE_PICK_LIST_ACTION = 'createPickList';

const str = (v: unknown): string => (v === null || v === undefined ? '' : String(v));

/** Sales Order → Warehouse Pick List. Idempotent; the order is retained + linked. */
export async function createPickListFromOrder(
  order: EnterpriseEntity,
  ctx: EnterpriseModuleActionContext,
): Promise<EnterpriseModuleActionResult> {
  if (str(order.fields.pickList)) return { ok: false, message: 'A pick list already exists for this order.' };
  const o = orderFromRecord(order);
  if (!o.product || !o.warehouse || o.orderedQty <= 0) {
    return { ok: false, message: 'Set a product, warehouse, and ordered quantity before creating a pick list.' };
  }
  const picksModule = ctx.moduleFor(PICK_LISTS_MODULE_ID);
  const ordersModule = ctx.moduleFor(ORDERS_MODULE_ID);
  if (!picksModule || !ordersModule) return { ok: false, error: 'Fulfillment modules are not available.' };
  ctx.authorize(picksModule.descriptor.permissions.write); // requires warehouse:manage
  await picksModule.store.load();

  const validation = picksModule.hooks.validate({
    fields: {
      pickNumber: `PICK-${o.orderNumber}`,
      salesOrder: order.id,
      product: o.product,
      warehouse: o.warehouse,
      quantity: o.orderedQty,
      status: 'pending',
    },
  });
  if (!validation.ok) return { ok: false, error: `Pick List: ${Object.values(validation.errors)[0] ?? 'invalid input'}` };
  const pick = picksModule.store.create({
    title: deriveRecordTitle(picksModule.descriptor, validation.values),
    fields: validation.values,
    actor: ctx.actor(),
    now: ctx.now(),
  });
  ctx.emit(picksModule, 'created', pick);

  const updated = ordersModule.store.update(order.id, { fields: { pickList: pick.id }, actor: ctx.actor(), now: ctx.now() });
  ctx.emit(ordersModule, 'converted', updated ?? order);
  return { ok: true, message: `Created pick list "${pick.title}" for warehouse fulfillment.` };
}
