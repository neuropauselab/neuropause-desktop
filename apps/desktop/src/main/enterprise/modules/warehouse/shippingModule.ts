/**
 * Warehouse → Shipping — the final fulfilment stage. `ship` posts a REAL `issue`
 * movement into the Inventory Ledger (stock physically leaves) and releases the
 * pick's held reservation, so on-hand and reserved both settle correctly — never by
 * editing stock. `deliver` closes the shipment. Idempotent; guarded.
 */
import type {
  EnterpriseEntity,
  EnterpriseModuleDescriptor,
} from '@neuropause/shared';
import {
  PICK_LISTS_MODULE_ID,
  SHIPPING_MODULE_ID,
  SHIPPING_KIND,
  shippingFromRecord,
} from '@neuropause/shared';
import {
  EnterpriseRecordStore,
  defineEnterpriseModule,
  type EnterpriseModule,
  type EnterpriseModuleActionContext,
} from '../../framework';
import { netReserved, postIssue, postReservationRelease } from './warehouseMovements';

export const SHIP_ACTION = 'ship';
export const DELIVER_ACTION = 'deliver';
export const CANCEL_SHIPMENT_ACTION = 'cancel';

export const SHIPPING_DESCRIPTOR: EnterpriseModuleDescriptor = {
  id: SHIPPING_MODULE_ID,
  title: 'Shipping',
  singular: 'Shipment',
  plural: 'Shipments',
  icon: 'truck',
  description: 'Ship packed goods, issuing stock out of the ledger.',
  group: 'Warehouse',
  titleField: 'shipmentNumber',
  permissions: { read: 'warehouse:read', write: 'warehouse:manage' },
  actions: [
    { key: SHIP_ACTION, label: 'Ship', icon: 'truck' },
    { key: DELIVER_ACTION, label: 'Mark Delivered', icon: 'check' },
    { key: CANCEL_SHIPMENT_ACTION, label: 'Cancel', icon: 'close' },
  ],
  fields: [
    { key: 'shipmentNumber', label: 'Shipment #', type: 'text', required: true, placeholder: 'SHIP-0001' },
    { key: 'pickList', label: 'Pick List', type: 'text', column: false, readOnly: true },
    { key: 'salesOrder', label: 'Sales Order', type: 'text', column: false },
    { key: 'product', label: 'Product (SKU)', type: 'text', required: true, placeholder: 'SKU-0001' },
    { key: 'warehouse', label: 'Warehouse', type: 'text', required: true, placeholder: 'WH-01' },
    { key: 'quantity', label: 'Quantity', type: 'number', required: true, min: 1 },
    { key: 'carrier', label: 'Carrier', type: 'text', column: false },
    { key: 'trackingNumber', label: 'Tracking #', type: 'text', column: false },
    { key: 'shippedDate', label: 'Shipped', type: 'date', format: 'date', readOnly: true },
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
        { value: 'shipped', label: 'Shipped', tone: 'blue' },
        { value: 'delivered', label: 'Delivered', tone: 'green' },
        { value: 'cancelled', label: 'Cancelled', tone: 'orange' },
      ],
    },
    { key: 'issueMovement', label: 'Issue Movement', type: 'text', column: false, readOnly: true },
  ],
};

export function createShippingModule(storePath: string): EnterpriseModule {
  const store = new EnterpriseRecordStore(storePath, SHIPPING_MODULE_ID, SHIPPING_KIND);

  function emitSelf(record: EnterpriseEntity | null, ctx: EnterpriseModuleActionContext): void {
    if (!record) return;
    const self = ctx.moduleFor(SHIPPING_MODULE_ID);
    if (self) ctx.emit(self, 'updated', record);
  }

  return defineEnterpriseModule({
    descriptor: SHIPPING_DESCRIPTOR,
    store,
    hooks: {
      runAction: async (action, record, ctx) => {
        const shipment = shippingFromRecord(record);

        if (action === SHIP_ACTION) {
          if (shipment.status !== 'pending') return { ok: false, message: `Cannot ship a shipment that is ${shipment.status}.` };
          if (!shipment.product || !shipment.warehouse || shipment.quantity <= 0) {
            return { ok: false, message: 'Set a product, warehouse, and quantity before shipping.' };
          }
          const issue = await postIssue(ctx, {
            movementNumber: `MV-${shipment.shipmentNumber}-ISS`,
            product: shipment.product,
            warehouse: shipment.warehouse,
            quantity: shipment.quantity,
            referenceModule: SHIPPING_MODULE_ID,
            referenceRecord: shipment.id,
            reason: `Shipment ${shipment.shipmentNumber}`,
          });
          if (!issue) return { ok: false, error: 'Could not issue stock for the shipment.' };
          // Release the pick's reservation now the goods have left.
          if (shipment.pickList && netReserved(ctx, PICK_LISTS_MODULE_ID, shipment.pickList) > 0) {
            await postReservationRelease(ctx, {
              movementNumber: `MV-${shipment.shipmentNumber}-REL`,
              product: shipment.product,
              warehouse: shipment.warehouse,
              quantity: shipment.quantity,
              referenceModule: PICK_LISTS_MODULE_ID,
              referenceRecord: shipment.pickList,
              reason: `Pick released by shipment ${shipment.shipmentNumber}`,
            });
          }
          emitSelf(
            store.update(record.id, {
              fields: { status: 'shipped', issueMovement: issue.id, shippedDate: ctx.now().slice(0, 10) },
              actor: ctx.actor(),
              now: ctx.now(),
            }),
            ctx,
          );
          return { ok: true, message: `Shipped ${shipment.quantity} of ${shipment.product} from ${shipment.warehouse}.` };
        }

        if (action === DELIVER_ACTION) {
          if (shipment.status !== 'shipped') return { ok: false, message: `Ship the shipment before marking it delivered (it is ${shipment.status}).` };
          emitSelf(store.update(record.id, { fields: { status: 'delivered' }, actor: ctx.actor(), now: ctx.now() }), ctx);
          return { ok: true, message: `Shipment ${shipment.shipmentNumber} delivered.` };
        }

        if (action === CANCEL_SHIPMENT_ACTION) {
          if (shipment.status === 'shipped' || shipment.status === 'delivered' || shipment.status === 'cancelled') {
            return { ok: false, message: `Cannot cancel a shipment that is ${shipment.status}.` };
          }
          emitSelf(store.update(record.id, { fields: { status: 'cancelled' }, actor: ctx.actor(), now: ctx.now() }), ctx);
          return { ok: true, message: `Shipment ${shipment.shipmentNumber} cancelled.` };
        }

        return { ok: false, error: `Unknown action "${action}".` };
      },
    },
  });
}
