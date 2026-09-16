/**
 * Warehouse → Shipping — the final fulfilment stage. `ship` posts a REAL `issue`
 * movement into the Inventory Ledger (stock physically leaves) and releases the
 * pick's held reservation, so on-hand and reserved both settle correctly — never by
 * editing stock. `deliver` closes the shipment. Idempotent; guarded.
 *
 * Closing the make → move → sell loop: when a shipment references a Sales Order,
 * `ship` marks that order fulfilled — a status write only (the stock already issued
 * here), so there is no double issue. The order write asserts `sales:manage`.
 */
import type {
  EnterpriseEntity,
  EnterpriseModuleDescriptor,
} from '@neuropause/shared';
import {
  ORDERS_MODULE_ID,
  PICK_LISTS_MODULE_ID,
  SHIPPING_MODULE_ID,
  SHIPPING_KIND,
  orderActionPatch,
  orderComputedFields,
  orderFromRecord,
  shippingFromRecord,
  validateEnterpriseRecordInput,
} from '@neuropause/shared';
import {
  EnterpriseRecordStore,
  defineEnterpriseModule,
  type EnterpriseModule,
  type EnterpriseModuleActionContext,
} from '../../framework';
import { netReserved, postIssue, postReservationRelease } from './warehouseMovements';

/**
 * Close the loop: advance the shipment's Sales Order toward `fulfilled` — through the CANONICAL,
 * guarded status machine, NEVER a hand-set status.
 *
 * ERP Session 46 — the S45 adversarial sweep found this path hand-set `status: 'fulfilled'` via a
 * direct cross-module `store.update`, jumping `pending → fulfilled` — a transition the order status
 * machine FORBIDS (the legal chain is pending → shipped → fulfilled). That silently produced an order
 * in a state the lifecycle actions could never reach, and it bypassed the S45 edit guard entirely.
 *
 * The fix reuses `orderActionPatch` — the ONE canonical transition table the order module's own
 * lifecycle actions use — walking the legal chain (ship, then fulfill) and applying only guarded
 * patches. A `deleted`/`closed`/`cancelled`/already-`fulfilled` order yields NO legal advance and is
 * left untouched: the machine refuses the jump the old code forced. Stock was already issued by the
 * shipment itself, so this drives STATUS ONLY (no `ship` side-effect, no double issue). The write
 * still asserts `sales:manage`.
 */
async function advanceLinkedOrderToFulfilled(ctx: EnterpriseModuleActionContext, salesOrderId: string, quantity: number): Promise<void> {
  if (!salesOrderId) return;
  const ordersModule = ctx.moduleFor(ORDERS_MODULE_ID);
  if (!ordersModule) return;
  await ordersModule.store.load();
  let rec = ordersModule.store.get(salesOrderId);
  if (!rec || rec.status === 'deleted') return;
  ctx.authorize(ordersModule.descriptor.permissions.write); // requires sales:manage
  for (const step of ['ship', 'fulfill'] as const) {
    const order = orderFromRecord(rec);
    if (order.status === 'fulfilled') break;
    const patch = orderActionPatch(step, order, ctx.now()); // null ⇒ illegal from here → never forced
    if (!patch) continue;
    if (step === 'fulfill' && quantity) patch.fulfilledQty = quantity;
    const merged = orderFromRecord({ ...rec, fields: { ...rec.fields, ...patch } });
    const updated = ordersModule.store.update(rec.id, {
      fields: { ...patch, ...orderComputedFields(merged) },
      actor: ctx.actor(),
      now: ctx.now(),
    });
    if (!updated) break;
    ctx.emit(ordersModule, 'updated', updated);
    rec = updated;
  }
}

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
      // S55 — the census found this document family wholly unfenced: hand-setting
      // `shipped`/`delivered` faked a shipment (no stock issue, no order advance — those
      // happen only inside the Ship action), and UN-setting `shipped` re-armed Ship into
      // DUPLICATE stock issues and order advances. Crossings involving shipped/delivered
      // are action-owned (Ship / Mark Delivered); pending ↔ cancelled edits stay free
      // (no economic effect; the S49 free-lane rule). Status-less importer rows exempt;
      // the actions write via the raw store and never re-enter this hook.
      validate: (input) => {
        const result = validateEnterpriseRecordInput(SHIPPING_DESCRIPTOR, input);
        if (result.ok && input.recordId) {
          const prior = store.get(input.recordId);
          const priorStatus = String(prior?.fields.status ?? '');
          const next = result.values.status;
          const stamped = (s: string): boolean => s === 'shipped' || s === 'delivered';
          if (
            prior && priorStatus !== '' && typeof next === 'string' && next !== priorStatus &&
            (stamped(priorStatus) || stamped(next))
          ) {
            return {
              ok: false,
              values: result.values,
              errors: { status: 'Shipment states change only through the Ship and Mark Delivered actions (shipping issues real stock).' },
            };
          }
        }
        return result;
      },
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
          // Close the loop — advance the linked Sales Order through the CANONICAL status machine
          // (pending → shipped → fulfilled), status only, no re-issue. Never a hand-set jump (S46).
          await advanceLinkedOrderToFulfilled(ctx, shipment.salesOrder, shipment.quantity);
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
