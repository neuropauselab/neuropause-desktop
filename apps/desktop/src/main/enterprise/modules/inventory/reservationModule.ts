/**
 * Inventory → Reservations — reservation documents on the Enterprise Module
 * Framework (W3.4). The ledger already understands reservations (the
 * `reservation` / `reservation_release` movement types feed the reserved
 * column of `deriveStockLedger`); this module adds the DOCUMENT — who
 * reserved what, for which order, with a lifecycle — and posts every quantity
 * change through the existing `postStockMovement` seam. Nothing re-implements
 * ledger math. CRUD, RBAC (`inventory:read` / `inventory:manage`), audit,
 * timeline, search, offline persistence, and the UI are all inherited.
 *
 * DETERMINISTIC guards:
 *   • A reservation must FIT the ledger's available quantity for its
 *     product + warehouse (on-hand − already reserved), refused with the
 *     available amount stated. The product must resolve by exact SKU.
 *   • Creation posts one `reservation` movement (`MV-RES-*`); `Release` and
 *     `Fulfil` post one `reservation_release` (`MV-RESREL-*`) — each step at
 *     most once, guarded by its marker. Fulfilment releases the hold ONLY:
 *     the physical `issue` movement belongs to the shipping document, stated
 *     on the action result. Closed reservations are immutable history.
 *
 * Electron-free (store paths injected), so it unit-tests without the app runtime.
 */
import type {
  EnterpriseModuleDescriptor,
  EnterpriseRecordInput,
  EnterpriseRecordSummary,
  EnterpriseRecordValidation,
} from '@neuropause/shared';
import {
  RESERVATIONS_MODULE_ID,
  RESERVATION_KIND,
  deriveStockLedger,
  reservationFromRecord,
  reservationMovementNumber,
  reservationReleaseMovementNumber,
  movementFromRecord,
  validateEnterpriseRecordInput,
} from '@neuropause/shared';
import {
  EnterpriseRecordStore,
  defineEnterpriseModule,
  type EnterpriseModule,
  type EnterpriseModuleActionContext,
} from '../../framework';
import { postStockMovement } from './postMovement';

/** The descriptor action keys the Reservations module surfaces. */
export const RELEASE_RESERVATION_ACTION = 'release';
export const FULFIL_RESERVATION_ACTION = 'fulfil';

/** The declarative description of a reservation — drives store, CRUD, and the UI. */
export const RESERVATION_DESCRIPTOR: EnterpriseModuleDescriptor = {
  id: RESERVATIONS_MODULE_ID,
  title: 'Reservations',
  singular: 'Reservation',
  plural: 'Reservations',
  icon: 'lock',
  description:
    'Hold available stock for an order — reservations post real ledger movements and release or fulfil with a full trail.',
  group: 'Inventory',
  titleField: 'reservationNumber',
  permissions: { read: 'inventory:read', write: 'inventory:manage' },
  actions: [
    { key: RELEASE_RESERVATION_ACTION, label: 'Release', icon: 'close' },
    { key: FULFIL_RESERVATION_ACTION, label: 'Fulfil', icon: 'check' },
  ],
  fields: [
    { key: 'reservationNumber', label: 'Reservation #', type: 'text', required: true, placeholder: 'RSV-0001' },
    { key: 'product', label: 'Product (SKU)', type: 'text', required: true, placeholder: 'SKU-0001' },
    { key: 'warehouse', label: 'Warehouse', type: 'text', required: true, placeholder: 'WH-01' },
    { key: 'quantity', label: 'Quantity', type: 'number', required: true, min: 0 },
    { key: 'referenceModule', label: 'For Module', type: 'text', column: false, placeholder: 'e.g. sales-orders' },
    { key: 'referenceRecord', label: 'For Record', type: 'text', column: false, placeholder: 'Order id (optional)' },
    { key: 'reason', label: 'Reason', type: 'text', column: false },
    {
      key: 'status',
      label: 'Status',
      type: 'select',
      readOnly: true,
      default: 'active',
      badge: true,
      filterable: true,
      options: [
        { value: 'active', label: 'Active', tone: 'blue' },
        { value: 'released', label: 'Released', tone: 'neutral' },
        { value: 'fulfilled', label: 'Fulfilled', tone: 'green' },
      ],
    },
    { key: 'reservedMovement', label: 'Reserve Movement', type: 'text', readOnly: true, column: false },
    { key: 'releaseMovement', label: 'Release Movement', type: 'text', readOnly: true, column: false },
    { key: 'releasedAt', label: 'Released At', type: 'text', readOnly: true, column: false },
    { key: 'fulfilledAt', label: 'Fulfilled At', type: 'text', readOnly: true, column: false },
    { key: 'notes', label: 'Notes', type: 'textarea', column: false, placeholder: 'Optional notes…' },
  ],
};

function str(v: unknown): string {
  return v === null || v === undefined ? '' : String(v);
}

/**
 * Build the Reservations module. Movements + Products stores are injected so
 * the availability guard reads the real ledger and SKUs must resolve.
 */
export function createReservationModule(
  storePath: string,
  movementStore?: EnterpriseRecordStore,
  productStore?: EnterpriseRecordStore,
): EnterpriseModule {
  const store = new EnterpriseRecordStore(storePath, RESERVATIONS_MODULE_ID, RESERVATION_KIND);

  /** Post the closing `reservation_release` movement + stamp the markers. */
  async function close(
    recordId: string,
    fields: Record<string, string>,
    reservationNumber: string,
    productSku: string,
    warehouse: string,
    quantity: number,
    ctx: EnterpriseModuleActionContext,
  ): Promise<string | null> {
    const movement = await postStockMovement(ctx, {
      movementNumber: reservationReleaseMovementNumber(reservationNumber),
      type: 'reservation_release',
      product: productSku,
      warehouse,
      quantity,
      referenceModule: RESERVATIONS_MODULE_ID,
      referenceRecord: recordId,
      reason: `Reservation ${reservationNumber} closed`,
    });
    if (!movement) return null;
    store.update(recordId, {
      fields: { ...fields, releaseMovement: movement.id },
      actor: ctx.actor(),
      now: ctx.now(),
    });
    return movement.id;
  }

  return defineEnterpriseModule({
    descriptor: RESERVATION_DESCRIPTOR,
    store,
    hooks: {
      validate: (input: EnterpriseRecordInput): EnterpriseRecordValidation => {
        const result = validateEnterpriseRecordInput(RESERVATION_DESCRIPTOR, input);
        if (!result.ok) return result;
        if (str(input.fields?.releasedAt) || str(input.fields?.fulfilledAt)) {
          return {
            ok: false,
            errors: { status: 'This reservation is closed — released/fulfilled reservations are immutable history.' },
            values: result.values,
          };
        }
        // A reservation that already posted its hold is locked to its terms —
        // changing product/quantity would desynchronize the ledger.
        if (str(input.fields?.reservedMovement)) {
          return {
            ok: false,
            errors: { status: 'This reservation has posted its ledger hold — release it and create a new one to change terms.' },
            values: result.values,
          };
        }
        const errors: Record<string, string> = {};
        const quantity = Number(result.values.quantity ?? 0);
        if (quantity <= 0) errors.quantity = 'Quantity must be greater than zero.';
        const sku = str(result.values.product);
        const warehouse = str(result.values.warehouse);
        if (sku && productStore && !productStore.list().some((r) => str(r.fields.sku) === sku)) {
          errors.product = `No product with SKU "${sku}" was found.`;
        }
        if (!errors.product && !errors.quantity && sku && warehouse && movementStore) {
          const ledger = deriveStockLedger(movementStore.list().map(movementFromRecord));
          const cell = ledger.find((c) => c.product === sku && c.warehouse === warehouse);
          const available = cell ? cell.available : 0;
          if (quantity > available) {
            errors.quantity = `Only ${available} of ${sku} is available in ${warehouse} (on-hand minus existing reservations).`;
          }
        }
        result.values.status = 'active';
        if (Object.keys(errors).length > 0) return { ok: false, errors, values: result.values };
        return result;
      },
      // Creation posts the ledger hold — once, guarded by the marker.
      onChange: async (event, ctx) => {
        if (event.action !== 'created') return;
        const reservation = reservationFromRecord(event.record);
        if (reservation.reservedMovement) return;
        const movement = await postStockMovement(ctx, {
          movementNumber: reservationMovementNumber(reservation.reservationNumber),
          type: 'reservation',
          product: reservation.product,
          warehouse: reservation.warehouse,
          quantity: reservation.quantity,
          referenceModule: RESERVATIONS_MODULE_ID,
          referenceRecord: reservation.id,
          reason: reservation.reason || `Reservation ${reservation.reservationNumber}`,
        });
        if (movement) {
          store.update(reservation.id, {
            fields: { reservedMovement: movement.id },
            actor: ctx.actor(),
            now: ctx.now(),
          });
        }
      },
      summarize: async (record): Promise<EnterpriseRecordSummary> => {
        const r = reservationFromRecord(record);
        return {
          moduleId: RESERVATIONS_MODULE_ID,
          recordId: record.id,
          headline: `${r.reservationNumber} · ${r.status} · ${r.product} ×${r.quantity} @ ${r.warehouse}`,
          summary:
            `${r.quantity} × ${r.product} held in ${r.warehouse}` +
            (r.referenceRecord ? ` for ${r.referenceModule || 'a document'} ${r.referenceRecord}` : '') +
            ` — ${r.status}. The hold and its release are real ledger movements.`,
          risk: r.status === 'active' ? 'medium' : 'low',
          riskReason:
            r.status === 'active'
              ? 'Held stock is unavailable to everyone else — release it if the order dies.'
              : 'Closed — the ledger hold has been released.',
          executiveExplanation:
            'Reservations are documents over the movement ledger: the reserved column of every stock view is the sum of these holds, with a full audit trail.',
          grounded: false,
          model: 'none',
        };
      },
      runAction: async (action, record, actionCtx) => {
        const r = reservationFromRecord(record);
        if (r.status !== 'active') {
          return { ok: false, error: 'This reservation is already closed — closed reservations are immutable.' };
        }
        if (!r.reservedMovement) {
          return { ok: false, error: 'The ledger hold has not been posted yet — retry in a moment.' };
        }
        if (action === RELEASE_RESERVATION_ACTION) {
          const movementId = await close(
            record.id,
            { releasedAt: actionCtx.now(), status: 'released' },
            r.reservationNumber, r.product, r.warehouse, r.quantity, actionCtx,
          );
          if (!movementId) return { ok: false, error: 'Could not post the release movement.' };
          return { ok: true, message: `Released — ${r.quantity} × ${r.product} is available again.` };
        }
        if (action === FULFIL_RESERVATION_ACTION) {
          const movementId = await close(
            record.id,
            { fulfilledAt: actionCtx.now(), status: 'fulfilled' },
            r.reservationNumber, r.product, r.warehouse, r.quantity, actionCtx,
          );
          if (!movementId) return { ok: false, error: 'Could not post the release movement.' };
          return {
            ok: true,
            message: `Fulfilled — the hold is released; the physical issue movement belongs to the shipping document.`,
          };
        }
        return { ok: false, error: `Unknown action "${action}".` };
      },
    },
  });
}
