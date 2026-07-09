/**
 * Warehouse → Pick Lists — the warehouse execution of a Sales Order's fulfilment.
 * `reserve` posts a REAL reservation movement into the Inventory Ledger (stock is
 * never edited directly); `pick` marks the goods gathered; `createPacking` hands
 * off to Packing. Cancelling releases any held reservation. The Sales Order is
 * referenced, not mutated.
 */
import type {
  EnterpriseEntity,
  EnterpriseModuleDescriptor,
} from '@neuropause/shared';
import { PICK_LISTS_MODULE_ID, PICK_LIST_KIND, pickListFromRecord } from '@neuropause/shared';
import {
  EnterpriseRecordStore,
  defineEnterpriseModule,
  type EnterpriseModule,
  type EnterpriseModuleActionContext,
} from '../../framework';
import { CREATE_PACKING_ACTION, convertPickToPacking } from './conversion';
import { netReserved, postReservation, postReservationRelease } from './warehouseMovements';

export const RESERVE_PICK_ACTION = 'reserve';
export const PICK_ACTION = 'pick';
export const CANCEL_PICK_ACTION = 'cancel';

export const PICK_LIST_DESCRIPTOR: EnterpriseModuleDescriptor = {
  id: PICK_LISTS_MODULE_ID,
  title: 'Pick Lists',
  singular: 'Pick List',
  plural: 'Pick Lists',
  icon: 'check-square',
  description: 'Pick stock for a sales order via real ledger reservations.',
  group: 'Warehouse',
  titleField: 'pickNumber',
  permissions: { read: 'warehouse:read', write: 'warehouse:manage' },
  actions: [
    { key: RESERVE_PICK_ACTION, label: 'Reserve Stock', icon: 'lock' },
    { key: PICK_ACTION, label: 'Mark Picked', icon: 'check' },
    { key: CREATE_PACKING_ACTION, label: 'Create Packing', icon: 'box' },
    { key: CANCEL_PICK_ACTION, label: 'Cancel', icon: 'close' },
  ],
  fields: [
    { key: 'pickNumber', label: 'Pick #', type: 'text', required: true, placeholder: 'PICK-0001' },
    { key: 'salesOrder', label: 'Sales Order', type: 'text', placeholder: 'SO-0001' },
    { key: 'product', label: 'Product (SKU)', type: 'text', required: true, placeholder: 'SKU-0001' },
    { key: 'warehouse', label: 'Warehouse', type: 'text', required: true, placeholder: 'WH-01' },
    { key: 'quantity', label: 'Quantity', type: 'number', required: true, min: 1 },
    { key: 'assignee', label: 'Assignee', type: 'text', column: false },
    {
      key: 'status',
      label: 'Status',
      type: 'select',
      required: true,
      default: 'pending',
      badge: true,
      filterable: true,
      options: [
        { value: 'pending', label: 'Pending', tone: 'neutral' },
        { value: 'reserved', label: 'Reserved', tone: 'teal' },
        { value: 'picked', label: 'Picked', tone: 'blue' },
        { value: 'packed', label: 'Packed', tone: 'purple' },
        { value: 'shipped', label: 'Shipped', tone: 'green' },
        { value: 'cancelled', label: 'Cancelled', tone: 'orange' },
      ],
    },
    { key: 'reservationMovement', label: 'Reservation', type: 'text', column: false, readOnly: true },
    { key: 'convertedPacking', label: 'Packing', type: 'text', column: false, readOnly: true },
  ],
};

export function createPickListModule(storePath: string): EnterpriseModule {
  const store = new EnterpriseRecordStore(storePath, PICK_LISTS_MODULE_ID, PICK_LIST_KIND);

  function emitSelf(record: EnterpriseEntity | null, ctx: EnterpriseModuleActionContext): void {
    if (!record) return;
    const self = ctx.moduleFor(PICK_LISTS_MODULE_ID);
    if (self) ctx.emit(self, 'updated', record);
  }

  return defineEnterpriseModule({
    descriptor: PICK_LIST_DESCRIPTOR,
    store,
    hooks: {
      runAction: async (action, record, ctx) => {
        const pick = pickListFromRecord(record);

        if (action === RESERVE_PICK_ACTION) {
          if (pick.status !== 'pending') return { ok: false, message: `Cannot reserve a pick that is ${pick.status}.` };
          if (!pick.product || !pick.warehouse || pick.quantity <= 0) {
            return { ok: false, message: 'Set a product, warehouse, and quantity before reserving.' };
          }
          const reservation = await postReservation(ctx, {
            movementNumber: `MV-${pick.pickNumber}-RES`,
            product: pick.product,
            warehouse: pick.warehouse,
            quantity: pick.quantity,
            referenceModule: PICK_LISTS_MODULE_ID,
            referenceRecord: pick.id,
            reason: `Pick ${pick.pickNumber} reservation`,
          });
          if (!reservation) return { ok: false, error: 'Could not reserve stock.' };
          emitSelf(
            store.update(record.id, { fields: { status: 'reserved', reservationMovement: reservation.id }, actor: ctx.actor(), now: ctx.now() }),
            ctx,
          );
          return { ok: true, message: `Reserved ${pick.quantity} of ${pick.product}.` };
        }

        if (action === PICK_ACTION) {
          if (pick.status !== 'reserved') return { ok: false, message: `Reserve the pick before marking it picked (it is ${pick.status}).` };
          emitSelf(store.update(record.id, { fields: { status: 'picked' }, actor: ctx.actor(), now: ctx.now() }), ctx);
          return { ok: true, message: `Pick ${pick.pickNumber} marked picked.` };
        }

        if (action === CREATE_PACKING_ACTION) return convertPickToPacking(record, ctx);

        if (action === CANCEL_PICK_ACTION) {
          if (pick.status === 'shipped' || pick.status === 'cancelled') {
            return { ok: false, message: `Cannot cancel a pick that is ${pick.status}.` };
          }
          if (netReserved(ctx, PICK_LISTS_MODULE_ID, pick.id) > 0) {
            await postReservationRelease(ctx, {
              movementNumber: `MV-${pick.pickNumber}-REL`,
              product: pick.product,
              warehouse: pick.warehouse,
              quantity: pick.quantity,
              referenceModule: PICK_LISTS_MODULE_ID,
              referenceRecord: pick.id,
              reason: `Pick ${pick.pickNumber} cancelled`,
            });
          }
          emitSelf(store.update(record.id, { fields: { status: 'cancelled' }, actor: ctx.actor(), now: ctx.now() }), ctx);
          return { ok: true, message: `Pick ${pick.pickNumber} cancelled.` };
        }

        return { ok: false, error: `Unknown action "${action}".` };
      },
    },
  });
}
