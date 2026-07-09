/**
 * Warehouse → Packing — the pack stage between picking and shipping. `pack` marks a
 * picked list packed; `createShipment` hands off to Shipping. Packing has no direct
 * stock effect (the goods are already reserved in the ledger by the pick, and issued
 * at shipment) — it is a physical-operation record, fully audited + timelined.
 */
import type {
  EnterpriseEntity,
  EnterpriseModuleDescriptor,
} from '@neuropause/shared';
import { PACKING_MODULE_ID, PACKING_KIND, packingFromRecord } from '@neuropause/shared';
import {
  EnterpriseRecordStore,
  defineEnterpriseModule,
  type EnterpriseModule,
  type EnterpriseModuleActionContext,
} from '../../framework';
import { CREATE_SHIPMENT_ACTION, convertPackingToShipment } from './conversion';

export const PACK_ACTION = 'pack';
export const CANCEL_PACKING_ACTION = 'cancel';

export const PACKING_DESCRIPTOR: EnterpriseModuleDescriptor = {
  id: PACKING_MODULE_ID,
  title: 'Packing',
  singular: 'Packing',
  plural: 'Packing',
  icon: 'box',
  description: 'Pack picked goods for shipment.',
  group: 'Warehouse',
  titleField: 'packNumber',
  permissions: { read: 'warehouse:read', write: 'warehouse:manage' },
  actions: [
    { key: PACK_ACTION, label: 'Mark Packed', icon: 'check' },
    { key: CREATE_SHIPMENT_ACTION, label: 'Create Shipment', icon: 'truck' },
    { key: CANCEL_PACKING_ACTION, label: 'Cancel', icon: 'close' },
  ],
  fields: [
    { key: 'packNumber', label: 'Pack #', type: 'text', required: true, placeholder: 'PACK-0001' },
    { key: 'pickList', label: 'Pick List', type: 'text', column: false, readOnly: true },
    { key: 'product', label: 'Product (SKU)', type: 'text', required: true, placeholder: 'SKU-0001' },
    { key: 'quantity', label: 'Quantity', type: 'number', required: true, min: 1 },
    {
      key: 'packageType',
      label: 'Package',
      type: 'select',
      column: false,
      default: 'box',
      options: [
        { value: 'box', label: 'Box' },
        { value: 'pallet', label: 'Pallet' },
        { value: 'envelope', label: 'Envelope' },
        { value: 'crate', label: 'Crate' },
      ],
    },
    { key: 'weight', label: 'Weight (kg)', type: 'number', min: 0, column: false },
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
        { value: 'packed', label: 'Packed', tone: 'green' },
        { value: 'cancelled', label: 'Cancelled', tone: 'orange' },
      ],
    },
    { key: 'convertedShipment', label: 'Shipment', type: 'text', column: false, readOnly: true },
  ],
};

export function createPackingModule(storePath: string): EnterpriseModule {
  const store = new EnterpriseRecordStore(storePath, PACKING_MODULE_ID, PACKING_KIND);

  function emitSelf(record: EnterpriseEntity | null, ctx: EnterpriseModuleActionContext): void {
    if (!record) return;
    const self = ctx.moduleFor(PACKING_MODULE_ID);
    if (self) ctx.emit(self, 'updated', record);
  }

  return defineEnterpriseModule({
    descriptor: PACKING_DESCRIPTOR,
    store,
    hooks: {
      runAction: async (action, record, ctx) => {
        const pack = packingFromRecord(record);

        if (action === PACK_ACTION) {
          if (pack.status !== 'pending') return { ok: false, message: `Cannot pack a record that is ${pack.status}.` };
          emitSelf(store.update(record.id, { fields: { status: 'packed' }, actor: ctx.actor(), now: ctx.now() }), ctx);
          return { ok: true, message: `Packing ${pack.packNumber} marked packed.` };
        }

        if (action === CREATE_SHIPMENT_ACTION) return convertPackingToShipment(record, ctx);

        if (action === CANCEL_PACKING_ACTION) {
          if (pack.status === 'cancelled') return { ok: false, message: 'Packing is already cancelled.' };
          if (pack.convertedShipment) return { ok: false, message: 'Cannot cancel packing that has a shipment.' };
          emitSelf(store.update(record.id, { fields: { status: 'cancelled' }, actor: ctx.actor(), now: ctx.now() }), ctx);
          return { ok: true, message: `Packing ${pack.packNumber} cancelled.` };
        }

        return { ok: false, error: `Unknown action "${action}".` };
      },
    },
  });
}
