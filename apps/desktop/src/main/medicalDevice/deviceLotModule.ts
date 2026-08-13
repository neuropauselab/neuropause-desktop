/**
 * Medical Device Pack → Lots.
 *
 * A lot is registered as an Enterprise Module so it inherits persistence, the
 * generic READ channels, search, the module rail and the record store's atomic
 * writes. Its WRITES are different from every other module in the build, and
 * deliberately so.
 *
 * The generic `enterprise:module.create` / `.update` path takes a bag of fields
 * and stores it. For a lot that is not acceptable: `quantity`,
 * `consumedQuantity`, `splitQuantity` and `status` are bound by a state machine
 * and by the arithmetic in `medicalDeviceLot.ts`, and a generic write would set
 * any of them to anything. A batch whose quantity can be typed over is a batch
 * whose recall is a guess.
 *
 * So this module's `validate` hook REFUSES every renderer-originated write,
 * with a message naming where to go instead. The service (`lotService.ts`)
 * writes through `store.create` / `store.update`, which the framework — by its
 * own long-standing design, used by the stock-movement poster and every other
 * reconciler — does not route through `validate`. The result: exactly one code
 * path can change a lot, and it is the one that enforces the invariants.
 *
 * What remains reachable generically is reads, and record-status archival /
 * soft-delete. Soft-delete RETAINS the record (status becomes `deleted`), so a
 * traceability answer is never destroyed by it, and it is audited like any
 * other module change.
 */
import type {
  EnterpriseEntity,
  EnterpriseModuleDescriptor,
  EnterpriseRecordSummary,
  EnterpriseRecordValidation,
} from '@neuropause/shared';
import {
  DEVICE_LOTS_MODULE_ID,
  DEVICE_LOT_KIND,
  LOT_STATUSES,
  LOT_STATUS_LABELS,
  LOT_STATUS_TONES,
  deviceLotFromRecord,
  isLotExpired,
  lotRemaining,
} from '@neuropause/shared';
import {
  EnterpriseRecordStore,
  defineEnterpriseModule,
  type EnterpriseModule,
} from '../enterprise/framework';

/**
 * The refusal a generic write receives. Exported so the UI, the service and the
 * test that asserts the refusal all quote the same sentence.
 */
export const LOT_DIRECT_WRITE_REFUSAL =
  'Lots are created and changed in the Batch/Lot Center. A batch carries a lifecycle state and a quantity that must stay reconciled with what has been consumed, split and shipped, so it cannot be edited as a plain record.';

export const DEVICE_LOT_DESCRIPTOR: EnterpriseModuleDescriptor = {
  id: DEVICE_LOTS_MODULE_ID,
  title: 'Batch / Lot',
  singular: 'Lot',
  plural: 'Lots',
  icon: 'tag',
  description:
    'Batches with an explicit lifecycle, conserved quantities and forward/backward traceability. Created and changed only in the Batch/Lot Center.',
  group: 'Medical Devices',
  titleField: 'lotNumber',
  permissions: { read: 'medicalDevice:lot.read', write: 'medicalDevice:lot.write' },
  fields: [
    { key: 'lotNumber', label: 'Lot #', type: 'text', required: true, placeholder: 'LOT-2026-08-001' },
    { key: 'productCode', label: 'Product', type: 'text', required: true },
    { key: 'productId', label: 'Product Record', type: 'text', readOnly: true, column: false },
    {
      key: 'status',
      label: 'Status',
      type: 'select',
      required: true,
      default: 'created',
      badge: true,
      filterable: true,
      readOnly: true,
      options: LOT_STATUSES.map((s) => ({ value: s, label: LOT_STATUS_LABELS[s], tone: LOT_STATUS_TONES[s] })),
    },
    { key: 'quantity', label: 'Quantity', type: 'number', required: true, min: 0, readOnly: true },
    { key: 'consumedQuantity', label: 'Consumed', type: 'number', default: 0, min: 0, readOnly: true },
    { key: 'splitQuantity', label: 'Split Out', type: 'number', default: 0, min: 0, readOnly: true, column: false },
    { key: 'unit', label: 'Unit', type: 'text', default: 'unit', column: false },
    { key: 'manufactureDate', label: 'Manufactured', type: 'date', format: 'date' },
    {
      key: 'expiryDate',
      label: 'Expires',
      type: 'date',
      format: 'date',
      help: 'Many devices have no expiry. Empty means "no expiry recorded" — never "unknown risk".',
    },
    { key: 'warehouseId', label: 'Warehouse', type: 'text', column: false },
    { key: 'manufacturingOrderId', label: 'Manufacturing Order', type: 'text', column: false },
    { key: 'supplierId', label: 'Supplier', type: 'text', column: false },
    { key: 'parentLotId', label: 'Parent Lot', type: 'text', readOnly: true, column: false },
    { key: 'sourceLotId', label: 'Source Lot', type: 'text', readOnly: true, column: false },
    { key: 'notes', label: 'Notes', type: 'textarea', column: false },
  ],
};

/**
 * What the module needs to make an IMPORTED lot a real lot.
 *
 * The Data Plane importer writes straight to a record store — deliberately, so
 * a bulk load cannot be blocked by a per-record hook. For every other module
 * that is fine. For a lot it is not: an imported row arrives with a lot number
 * and a quantity and none of the invariants this pack depends on. The framework
 * then replays every imported record through `onChange`, and that is where the
 * row becomes a lot: tenant stamped, counters initialised, status coerced to a
 * real lifecycle state, the product resolved from its code, and the context
 * edges recorded so the row is traceable the moment it lands.
 */
export interface DeviceLotImportDeps {
  tenantId: () => string;
  /** Resolve a product record id from its product code, or '' when unknown. */
  productIdForCode: (code: string) => string;
  /** Record a traceability edge. Idempotent, so a re-import does not double it. */
  recordEdge: (edge: {
    kind: 'lot_of_product' | 'lot_stored_in' | 'lot_supplied_by' | 'mo_produced_lot';
    lotId: string;
    lotNumber: string;
    targetId: string;
    quantity: number | null;
    unit: string;
    at: string;
  }) => void;
}

/**
 * Normalize a lot record that did not come from the lot service.
 *
 * Returns the field patch to apply, or null when nothing needs fixing — so a
 * service-written lot (which is already complete) is a no-op and this never
 * fights the code that owns the invariants.
 */
export function importedLotPatch(
  record: EnterpriseEntity,
  tenantId: string,
  productIdForCode: (code: string) => string,
): Record<string, string | number> | null {
  const f = record.fields;
  const patch: Record<string, string | number> = {};
  const num = (v: unknown): number => {
    const n = typeof v === 'number' ? v : Number(String(v ?? ''));
    return Number.isFinite(n) ? n : 0;
  };
  const str = (v: unknown): string => (v === null || v === undefined ? '' : String(v));

  // A status the state machine cannot interpret is worse than no status: it
  // makes every later transition check meaningless. Anything unrecognised
  // becomes `created`, which is the state that permits the most recovery.
  if (!LOT_STATUSES.includes(str(f.status) as (typeof LOT_STATUSES)[number])) patch.status = 'created';
  // Counters must exist and must never start negative, or `remaining` is wrong
  // from the first read.
  if (f.consumedQuantity === undefined || f.consumedQuantity === null || num(f.consumedQuantity) < 0) {
    patch.consumedQuantity = 0;
  }
  if (f.splitQuantity === undefined || f.splitQuantity === null || num(f.splitQuantity) < 0) {
    patch.splitQuantity = 0;
  }
  if (!str(f.unit)) patch.unit = 'unit';
  // An imported row names a product by CODE. Resolving it to a record id is what
  // makes the lot traceable; leaving it unresolved parks the lot with its code
  // intact, which the relationship review queue can then act on.
  if (!str(f.productId)) {
    const resolved = productIdForCode(str(f.productCode));
    if (resolved) patch.productId = resolved;
  }
  const needsTenant = str(record.metadata?.tenantId) !== tenantId;
  if (Object.keys(patch).length === 0 && !needsTenant) return null;
  return patch;
}

/**
 * Build the Lots module.
 *
 * `now` is injected so the summary's expiry judgement is deterministic in
 * tests — expiry is computed at read here exactly as it is everywhere else, and
 * is never a stored flag that can go stale between the date passing and someone
 * opening the record.
 *
 * `importDeps` is optional: without it the module is a complete, testable lot
 * store with no import normalization, which is exactly what the pure unit tests
 * want.
 */
export function createDeviceLotModule(
  storePath: string,
  now: () => string,
  importDeps?: DeviceLotImportDeps,
): EnterpriseModule {
  const store = new EnterpriseRecordStore(storePath, DEVICE_LOTS_MODULE_ID, DEVICE_LOT_KIND);
  return defineEnterpriseModule({
    descriptor: DEVICE_LOT_DESCRIPTOR,
    store,
    hooks: {
      validate: (): EnterpriseRecordValidation => ({
        ok: false,
        errors: { _: LOT_DIRECT_WRITE_REFUSAL },
        values: {},
      }),
      onChange: ({ record }) => {
        if (!importDeps) return;
        const tenantId = importDeps.tenantId();
        const patch = importedLotPatch(record, tenantId, importDeps.productIdForCode);
        const current = patch
          ? (store.update(record.id, {
              fields: patch,
              metadata: { tenantId },
              now: now(),
            }) ?? record)
          : record;
        // Context edges are recorded for every lot, imported or not. The edge
        // store is idempotent, so a service-created lot that already has them
        // is unaffected and a re-import does not double a lot's destinations.
        const lot = deviceLotFromRecord(current);
        const emit = (
          kind: 'lot_of_product' | 'lot_stored_in' | 'lot_supplied_by' | 'mo_produced_lot',
          targetId: string,
          quantity: number | null,
        ): void => {
          if (!targetId) return;
          importDeps.recordEdge({
            kind,
            lotId: current.id,
            lotNumber: lot.lotNumber,
            targetId,
            quantity,
            unit: lot.unit,
            at: current.updatedAt,
          });
        };
        emit('lot_of_product', lot.productId, null);
        emit('lot_stored_in', lot.warehouseId, lotRemaining(lot));
        emit('lot_supplied_by', lot.supplierId, null);
        emit('mo_produced_lot', lot.manufacturingOrderId, lot.quantity);
      },
      summarize: async (record: EnterpriseEntity): Promise<EnterpriseRecordSummary> => {
        const lot = deviceLotFromRecord(record);
        const remaining = lotRemaining(lot);
        const expired = isLotExpired(lot, now());
        const risk = lot.status === 'recalled' ? 'high' : expired || lot.status === 'blocked' ? 'medium' : 'low';
        return {
          moduleId: DEVICE_LOTS_MODULE_ID,
          recordId: record.id,
          headline: `${lot.lotNumber} · ${LOT_STATUS_LABELS[lot.status]} · ${remaining} of ${lot.quantity} ${lot.unit}`,
          summary:
            `Lot ${lot.lotNumber} of ${lot.productCode}: ${lot.quantity} ${lot.unit} originally, ` +
            `${lot.consumedQuantity} consumed, ${lot.splitQuantity} split into child lots, ${remaining} remaining.` +
            (lot.expiryDate ? ` Expiry ${lot.expiryDate}.` : ' No expiry recorded.'),
          risk,
          riskReason:
            lot.status === 'recalled'
              ? 'This lot is recalled. Its forward trace lists everywhere the material went.'
              : expired
                ? 'The expiry date has passed.'
                : 'Quantities reconcile: original = remaining + consumed + split.',
          executiveExplanation:
            'A lot is the unit a recall is executed in. Its quantity is derived from immutable counters, so it cannot be edited into disagreeing with what was consumed or shipped.',
          grounded: false,
          model: 'none',
        };
      },
    },
  });
}
