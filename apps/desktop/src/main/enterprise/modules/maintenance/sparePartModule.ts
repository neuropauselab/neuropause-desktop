/**
 * Maintenance → Spare Parts — parts consumed in a repair. The `consume` action posts
 * a REAL `production_consumption` movement into the Inventory Ledger (stock is never
 * edited directly), so a spare part issued to a work order reduces on-hand through the
 * same seam Manufacturing uses. Idempotent.
 */
import type { EnterpriseModuleDescriptor } from '@neuropause/shared';
import { SPARE_PARTS_MODULE_ID, SPARE_PART_KIND, sparePartFromRecord } from '@neuropause/shared';
import { EnterpriseRecordStore, defineEnterpriseModule, type EnterpriseModule } from '../../framework';
import { postSparePartConsumption } from './maintenanceMovements';

export const CONSUME_PART_ACTION = 'consume';
export const CANCEL_PART_ACTION = 'cancel';

export const SPARE_PART_DESCRIPTOR: EnterpriseModuleDescriptor = {
  id: SPARE_PARTS_MODULE_ID,
  title: 'Spare Parts',
  singular: 'Spare Part',
  plural: 'Spare Parts',
  icon: 'package',
  description: 'Parts consumed in maintenance via real inventory movements.',
  group: 'Maintenance',
  titleField: 'partNumber',
  permissions: { read: 'maintenance:read', write: 'maintenance:manage' },
  actions: [
    { key: CONSUME_PART_ACTION, label: 'Consume', icon: 'check' },
    { key: CANCEL_PART_ACTION, label: 'Cancel', icon: 'close' },
  ],
  fields: [
    { key: 'partNumber', label: 'Part #', type: 'text', required: true, placeholder: 'SP-0001' },
    { key: 'workOrder', label: 'Work Order', type: 'text', column: false, placeholder: 'WO-0001' },
    { key: 'product', label: 'Product (SKU)', type: 'text', required: true, placeholder: 'SKU-0001' },
    { key: 'warehouse', label: 'Warehouse', type: 'text', required: true, placeholder: 'WH-01' },
    { key: 'quantity', label: 'Quantity', type: 'number', required: true, min: 1 },
    { key: 'unitCost', label: 'Unit Cost', type: 'number', min: 0, format: 'currency', column: false },
    {
      key: 'status',
      label: 'Status',
      type: 'select',
      required: true,
      default: 'draft',
      badge: true,
      filterable: true,
      options: [
        { value: 'draft', label: 'Draft', tone: 'neutral' },
        { value: 'consumed', label: 'Consumed', tone: 'green' },
        { value: 'cancelled', label: 'Cancelled', tone: 'orange' },
      ],
    },
    { key: 'consumptionMovement', label: 'Movement', type: 'text', column: false, readOnly: true },
  ],
};

export function createSparePartModule(storePath: string): EnterpriseModule {
  const store = new EnterpriseRecordStore(storePath, SPARE_PARTS_MODULE_ID, SPARE_PART_KIND);
  return defineEnterpriseModule({
    descriptor: SPARE_PART_DESCRIPTOR,
    store,
    hooks: {
      runAction: async (action, record, ctx) => {
        const part = sparePartFromRecord(record);
        if (action === CONSUME_PART_ACTION) {
          if (part.status === 'consumed') return { ok: false, message: 'This part has already been consumed.' };
          if (part.status === 'cancelled') return { ok: false, message: 'Cannot consume a cancelled part.' };
          if (!part.product || !part.warehouse || part.quantity <= 0) {
            return { ok: false, message: 'Set a product, warehouse, and quantity before consuming.' };
          }
          const movement = await postSparePartConsumption(ctx, {
            movementNumber: `MV-${part.partNumber}-SP`,
            product: part.product,
            warehouse: part.warehouse,
            quantity: part.quantity,
            unitCost: part.unitCost,
            referenceModule: SPARE_PARTS_MODULE_ID,
            referenceRecord: part.id,
            reason: `Spare part ${part.partNumber}${part.workOrder ? ` for ${part.workOrder}` : ''}`,
          });
          if (!movement) return { ok: false, error: 'Could not post the spare-part consumption movement.' };
          const updated = store.update(record.id, { fields: { status: 'consumed', consumptionMovement: movement.id }, actor: ctx.actor(), now: ctx.now() });
          if (!updated) return { ok: false, error: 'Spare part not found.' };
          const self = ctx.moduleFor(SPARE_PARTS_MODULE_ID);
          if (self) ctx.emit(self, 'updated', updated);
          return { ok: true, message: `Consumed ${part.quantity} of ${part.product}.` };
        }

        if (action === CANCEL_PART_ACTION) {
          if (part.status !== 'draft') return { ok: false, message: `Cannot cancel a part that is ${part.status}.` };
          const updated = store.update(record.id, { fields: { status: 'cancelled' }, actor: ctx.actor(), now: ctx.now() });
          if (!updated) return { ok: false, error: 'Spare part not found.' };
          const self = ctx.moduleFor(SPARE_PARTS_MODULE_ID);
          if (self) ctx.emit(self, 'updated', updated);
          return { ok: true, message: `Spare part ${part.partNumber} cancelled.` };
        }

        return { ok: false, error: `Unknown action "${action}".` };
      },
    },
  });
}
