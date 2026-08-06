/**
 * Inventory → Lots — batch/lot tracking on the Enterprise Module Framework
 * (W3.3). A descriptor + the framework's record store + hooks; CRUD, RBAC
 * (`inventory:read` / `inventory:manage`), audit, timeline, search, offline
 * persistence, and the entire list/detail/form UI are all inherited.
 *
 * A lot is the traceable batch between a goods receipt and consumption. Its
 * scannable identity is DETERMINISTIC data: the barcode string IS the lot
 * number, and the read-only `codePayload` is a canonical JSON string any
 * barcode/QR renderer can draw — stamped at validate, identical everywhere,
 * no native dependencies. Expiry is TIME-DERIVED at read (the W2.3 pattern);
 * `Consume` stamps the marker and the lot becomes immutable history. Lots
 * REFERENCE stock — quantities remain the movement ledger's truth; `product`
 * must resolve by exact SKU against the injected Products store.
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
  LOTS_MODULE_ID,
  LOT_KIND,
  lotCodePayload,
  lotFromRecord,
  lotRuntimeState,
  validateEnterpriseRecordInput,
} from '@neuropause/shared';
import {
  EnterpriseRecordStore,
  defineEnterpriseModule,
  type EnterpriseModule,
} from '../../framework';

/** The descriptor action key the Lots module surfaces. */
export const CONSUME_LOT_ACTION = 'consume';

/** The declarative description of a lot — drives store, CRUD, and the UI. */
export const LOT_DESCRIPTOR: EnterpriseModuleDescriptor = {
  id: LOTS_MODULE_ID,
  title: 'Lots',
  singular: 'Lot',
  plural: 'Lots',
  icon: 'tag',
  description:
    'Batch/lot traceability — received batches with deterministic barcode/QR payloads and a time-derived expiry clock.',
  group: 'Inventory',
  titleField: 'lotNumber',
  permissions: { read: 'inventory:read', write: 'inventory:manage' },
  actions: [{ key: CONSUME_LOT_ACTION, label: 'Consume', icon: 'check' }],
  fields: [
    { key: 'lotNumber', label: 'Lot #', type: 'text', required: true, placeholder: 'LOT-2026-08-001' },
    { key: 'product', label: 'Product (SKU)', type: 'text', required: true, placeholder: 'SKU-0001' },
    { key: 'warehouse', label: 'Warehouse', type: 'text', required: true, placeholder: 'WH-01' },
    { key: 'quantity', label: 'Quantity', type: 'number', required: true, min: 0 },
    { key: 'expiryDate', label: 'Expires', type: 'date', format: 'date' },
    { key: 'receiptRef', label: 'Goods Receipt', type: 'text', column: false, placeholder: 'GR reference (optional)' },
    { key: 'codePayload', label: 'Code Payload', type: 'textarea', readOnly: true, column: false },
    {
      key: 'status',
      label: 'Status',
      type: 'select',
      readOnly: true,
      default: 'active',
      badge: true,
      filterable: true,
      options: [
        { value: 'active', label: 'Active', tone: 'green' },
        { value: 'consumed', label: 'Consumed', tone: 'neutral' },
      ],
    },
    { key: 'consumedAt', label: 'Consumed At', type: 'text', readOnly: true, column: false },
    { key: 'notes', label: 'Notes', type: 'textarea', column: false, placeholder: 'Optional notes…' },
  ],
};

function str(v: unknown): string {
  return v === null || v === undefined ? '' : String(v);
}

/**
 * Build the Lots module. The Products store is injected so `product` must
 * resolve by exact SKU (the W2 injection pattern).
 */
export function createLotModule(
  storePath: string,
  productStore?: EnterpriseRecordStore,
): EnterpriseModule {
  const store = new EnterpriseRecordStore(storePath, LOTS_MODULE_ID, LOT_KIND);
  return defineEnterpriseModule({
    descriptor: LOT_DESCRIPTOR,
    store,
    hooks: {
      validate: (input: EnterpriseRecordInput): EnterpriseRecordValidation => {
        const result = validateEnterpriseRecordInput(LOT_DESCRIPTOR, input);
        if (!result.ok) return result;
        if (str(input.fields?.consumedAt)) {
          return {
            ok: false,
            errors: { status: 'This lot is consumed — consumed lots are immutable traceability history.' },
            values: result.values,
          };
        }
        const errors: Record<string, string> = {};
        if (Number(result.values.quantity ?? 0) <= 0) {
          errors.quantity = 'Quantity must be greater than zero.';
        }
        const sku = str(result.values.product);
        if (sku && productStore && !productStore.list().some((r) => str(r.fields.sku) === sku)) {
          errors.product = `No product with SKU "${sku}" was found.`;
        }
        result.values.status = 'active';
        result.values.codePayload = lotCodePayload({
          lotNumber: str(result.values.lotNumber),
          product: sku,
          warehouse: str(result.values.warehouse),
          quantity: Number(result.values.quantity ?? 0),
          expiryDate: str(result.values.expiryDate) || null,
        });
        if (Object.keys(errors).length > 0) return { ok: false, errors, values: result.values };
        return result;
      },
      summarize: async (record): Promise<EnterpriseRecordSummary> => {
        const lot = lotFromRecord(record);
        const state = lotRuntimeState(lot, Date.now());
        return {
          moduleId: LOTS_MODULE_ID,
          recordId: record.id,
          headline: `${lot.lotNumber} · ${state} · ${lot.product} ×${lot.quantity}`,
          summary:
            `Lot of ${lot.quantity} × ${lot.product} in ${lot.warehouse}` +
            (lot.expiryDate ? `, expires ${lot.expiryDate}` : '') +
            ` — ${state}. The barcode string is the lot number; the code payload is canonical JSON for any QR renderer.`,
          risk: state === 'expired' ? 'high' : 'low',
          riskReason:
            state === 'expired'
              ? 'Expired stock on the shelf — consume, quarantine, or write it off.'
              : 'Traceable batch — quantities live in the movement ledger.',
          executiveExplanation:
            'Lots are the receipt-to-consumption trace unit; expiry is computed at read so it can never go stale.',
          grounded: false,
          model: 'none',
        };
      },
      runAction: async (action, record, actionCtx) => {
        const lot = lotFromRecord(record);
        if (action !== CONSUME_LOT_ACTION) return { ok: false, error: `Unknown action "${action}".` };
        if (lot.consumedAt) return { ok: false, error: 'This lot is already consumed.' };
        store.update(record.id, {
          fields: { consumedAt: actionCtx.now(), status: 'consumed' },
          actor: actionCtx.actor(),
          now: actionCtx.now(),
        });
        return {
          ok: true,
          message: `Lot ${lot.lotNumber} consumed — record the matching stock movement from its consuming document.`,
        };
      },
    },
  });
}
