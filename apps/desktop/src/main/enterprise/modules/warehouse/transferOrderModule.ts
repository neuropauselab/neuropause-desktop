/**
 * Warehouse → Transfer Orders — relocate stock between warehouses through the
 * Inventory Ledger, never by editing stock. The lifecycle is fully ledgered:
 *   approve   → reserve stock at the source (reservation movement)
 *   dispatch  → post the Transfer-OUT leg (source → IN-TRANSIT) + release reservation
 *   receive   → post the Transfer-IN leg (IN-TRANSIT → destination)
 *   cancel    → release any held reservation
 * The paired transfer movements are net-zero on the product total and relocate it
 * per location via the existing ledger projection. The `summarize` hook explains
 * the transfer; the AI never moves stock.
 */
import type {
  EnterpriseEntity,
  EnterpriseModuleDescriptor,
  EnterpriseRecordInput,
  EnterpriseRecordSummary,
  TransferOrder,
} from '@neuropause/shared';
import {
  TRANSFER_ORDERS_MODULE_ID,
  TRANSFER_ORDER_KIND,
  transferOrderFromRecord,
  transferOrderSummaryFallback,
  validateEnterpriseRecordInput,
} from '@neuropause/shared';
import {
  EnterpriseRecordStore,
  defineEnterpriseModule,
  type EnterpriseModule,
  type EnterpriseModuleActionContext,
} from '../../framework';
import {
  netReserved,
  postReservation,
  postReservationRelease,
  postTransferIn,
  postTransferOut,
  type TransferPairArgs,
} from './warehouseMovements';

export const APPROVE_TRANSFER_ACTION = 'approve';
export const DISPATCH_TRANSFER_ACTION = 'dispatch';
export const RECEIVE_TRANSFER_ACTION = 'receive';
export const CANCEL_TRANSFER_ACTION = 'cancel';

const str = (v: unknown): string => (v === null || v === undefined ? '' : String(v));

export const TRANSFER_ORDER_DESCRIPTOR: EnterpriseModuleDescriptor = {
  id: TRANSFER_ORDERS_MODULE_ID,
  title: 'Transfer Orders',
  singular: 'Transfer Order',
  plural: 'Transfer Orders',
  icon: 'shuffle',
  description: 'Relocate stock between warehouses via paired ledger movements.',
  group: 'Warehouse',
  titleField: 'transferNumber',
  permissions: { read: 'warehouse:read', write: 'warehouse:manage' },
  actions: [
    { key: APPROVE_TRANSFER_ACTION, label: 'Approve & Reserve', icon: 'check' },
    { key: DISPATCH_TRANSFER_ACTION, label: 'Dispatch', icon: 'upload' },
    { key: RECEIVE_TRANSFER_ACTION, label: 'Receive', icon: 'download' },
    { key: CANCEL_TRANSFER_ACTION, label: 'Cancel', icon: 'close' },
  ],
  fields: [
    { key: 'transferNumber', label: 'Transfer #', type: 'text', required: true, placeholder: 'TRN-0001' },
    { key: 'product', label: 'Product (SKU)', type: 'text', required: true, placeholder: 'SKU-0001' },
    { key: 'quantity', label: 'Quantity', type: 'number', required: true, min: 1 },
    { key: 'fromWarehouse', label: 'From Warehouse', type: 'text', required: true, placeholder: 'WH-01' },
    { key: 'toWarehouse', label: 'To Warehouse', type: 'text', required: true, placeholder: 'WH-02' },
    { key: 'reason', label: 'Reason', type: 'text', column: false },
    { key: 'requestedDate', label: 'Requested', type: 'date', column: false, format: 'date' },
    { key: 'completedDate', label: 'Completed', type: 'date', format: 'date', readOnly: true },
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
        { value: 'approved', label: 'Approved', tone: 'blue' },
        { value: 'in_transit', label: 'In Transit', tone: 'teal' },
        { value: 'completed', label: 'Completed', tone: 'green' },
        { value: 'cancelled', label: 'Cancelled', tone: 'orange' },
      ],
    },
    { key: 'reservationMovement', label: 'Reservation', type: 'text', column: false, readOnly: true },
    { key: 'outMovement', label: 'Transfer-Out', type: 'text', column: false, readOnly: true },
    { key: 'inMovement', label: 'Transfer-In', type: 'text', column: false, readOnly: true },
  ],
};

export interface TransferAiNarrative {
  summary: string;
  executiveExplanation: string;
  grounded: boolean;
  model: string;
}
export type TransferAiRunner = (transfer: TransferOrder) => Promise<TransferAiNarrative | null>;

function pairArgs(t: TransferOrder): TransferPairArgs {
  return {
    transferNumber: t.transferNumber,
    transferId: t.id,
    product: t.product,
    quantity: t.quantity,
    fromWarehouse: t.fromWarehouse,
    toWarehouse: t.toWarehouse,
    referenceModule: TRANSFER_ORDERS_MODULE_ID,
  };
}

export function createTransferOrderModule(storePath: string, aiRunner?: TransferAiRunner): EnterpriseModule {
  const store = new EnterpriseRecordStore(storePath, TRANSFER_ORDERS_MODULE_ID, TRANSFER_ORDER_KIND);

  function emitSelf(record: EnterpriseEntity | null, ctx: EnterpriseModuleActionContext): void {
    if (!record) return;
    const self = ctx.moduleFor(TRANSFER_ORDERS_MODULE_ID);
    if (self) ctx.emit(self, 'updated', record);
  }

  return defineEnterpriseModule({
    descriptor: TRANSFER_ORDER_DESCRIPTOR,
    store,
    hooks: {
      validate: (input: EnterpriseRecordInput) => {
        const result = validateEnterpriseRecordInput(TRANSFER_ORDER_DESCRIPTOR, input);
        if (result.ok && str(result.values.fromWarehouse) && str(result.values.fromWarehouse) === str(result.values.toWarehouse)) {
          return { ok: false, values: result.values, errors: { toWarehouse: 'Destination must differ from source.' } };
        }
        return result;
      },
      summarize: async (record): Promise<EnterpriseRecordSummary> => {
        const transfer = transferOrderFromRecord(record);
        const ai = aiRunner ? await aiRunner(transfer).catch(() => null) : null;
        const fallback = transferOrderSummaryFallback(transfer);
        return {
          moduleId: TRANSFER_ORDERS_MODULE_ID,
          recordId: record.id,
          headline: `${transfer.transferNumber} · ${transfer.product} · ${transfer.fromWarehouse}→${transfer.toWarehouse} · ${transfer.status.replace('_', ' ')}`,
          summary: ai?.summary?.trim() || fallback.summary,
          risk: transfer.status === 'cancelled' ? 'low' : 'low',
          riskReason: `Transfer ${transfer.status.replace('_', ' ')}.`,
          executiveExplanation: ai?.executiveExplanation?.trim() || fallback.executiveExplanation,
          grounded: Boolean(ai?.grounded),
          model: ai?.model ?? 'none',
        };
      },
      runAction: async (action, record, ctx) => {
        const t = transferOrderFromRecord(record);

        if (action === APPROVE_TRANSFER_ACTION) {
          if (t.status !== 'draft') return { ok: false, message: `Cannot approve a transfer that is ${t.status.replace('_', ' ')}.` };
          if (!t.product || t.quantity <= 0 || !t.fromWarehouse || !t.toWarehouse) {
            return { ok: false, message: 'Set a product, quantity, source, and destination before approving.' };
          }
          const reservation = await postReservation(ctx, {
            movementNumber: `MV-${t.transferNumber}-RES`,
            product: t.product,
            warehouse: t.fromWarehouse,
            quantity: t.quantity,
            referenceModule: TRANSFER_ORDERS_MODULE_ID,
            referenceRecord: t.id,
            reason: `Transfer ${t.transferNumber} reservation`,
          });
          if (!reservation) return { ok: false, error: 'Could not reserve stock for the transfer.' };
          emitSelf(
            store.update(record.id, {
              fields: { status: 'approved', reservationMovement: reservation.id },
              actor: ctx.actor(),
              now: ctx.now(),
            }),
            ctx,
          );
          return { ok: true, message: `Reserved ${t.quantity} of ${t.product} at ${t.fromWarehouse}.` };
        }

        if (action === DISPATCH_TRANSFER_ACTION) {
          if (t.status !== 'approved') return { ok: false, message: `Approve the transfer before dispatching (it is ${t.status.replace('_', ' ')}).` };
          const out = await postTransferOut(ctx, pairArgs(t));
          if (!out) return { ok: false, error: 'Could not post the transfer-out movement.' };
          if (netReserved(ctx, TRANSFER_ORDERS_MODULE_ID, t.id) > 0) {
            await postReservationRelease(ctx, {
              movementNumber: `MV-${t.transferNumber}-REL`,
              product: t.product,
              warehouse: t.fromWarehouse,
              quantity: t.quantity,
              referenceModule: TRANSFER_ORDERS_MODULE_ID,
              referenceRecord: t.id,
              reason: `Transfer ${t.transferNumber} reservation release`,
            });
          }
          emitSelf(
            store.update(record.id, { fields: { status: 'in_transit', outMovement: out.id }, actor: ctx.actor(), now: ctx.now() }),
            ctx,
          );
          return { ok: true, message: `Dispatched ${t.quantity} of ${t.product} from ${t.fromWarehouse}.` };
        }

        if (action === RECEIVE_TRANSFER_ACTION) {
          if (t.status !== 'in_transit') return { ok: false, message: `Dispatch the transfer before receiving (it is ${t.status.replace('_', ' ')}).` };
          const inLeg = await postTransferIn(ctx, pairArgs(t));
          if (!inLeg) return { ok: false, error: 'Could not post the transfer-in movement.' };
          emitSelf(
            store.update(record.id, {
              fields: { status: 'completed', inMovement: inLeg.id, completedDate: ctx.now().slice(0, 10) },
              actor: ctx.actor(),
              now: ctx.now(),
            }),
            ctx,
          );
          return { ok: true, message: `Received ${t.quantity} of ${t.product} into ${t.toWarehouse}.` };
        }

        if (action === CANCEL_TRANSFER_ACTION) {
          if (t.status === 'completed' || t.status === 'cancelled') {
            return { ok: false, message: `Cannot cancel a transfer that is ${t.status.replace('_', ' ')}.` };
          }
          if (netReserved(ctx, TRANSFER_ORDERS_MODULE_ID, t.id) > 0) {
            await postReservationRelease(ctx, {
              movementNumber: `MV-${t.transferNumber}-CXL`,
              product: t.product,
              warehouse: t.fromWarehouse,
              quantity: t.quantity,
              referenceModule: TRANSFER_ORDERS_MODULE_ID,
              referenceRecord: t.id,
              reason: `Transfer ${t.transferNumber} cancelled`,
            });
          }
          emitSelf(store.update(record.id, { fields: { status: 'cancelled' }, actor: ctx.actor(), now: ctx.now() }), ctx);
          return { ok: true, message: `Transfer ${t.transferNumber} cancelled.` };
        }

        return { ok: false, error: `Unknown action "${action}".` };
      },
    },
  });
}
