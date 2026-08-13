/**
 * Inventory → Serial Units — per-unit serialized tracking on the Enterprise
 * Module Framework (W6-C2). CRUD, RBAC (`inventory:read` / `inventory:manage`),
 * audit, timeline, search, offline persistence, and the UI are all inherited.
 *
 * A serial is ONE physical unit. `product` must resolve by exact SKU against
 * the injected Products store (the lot pattern). Its scannable identity is the
 * deterministic `codePayload`. Lifecycle is marker-driven: `Issue` stamps
 * `issuedAt`, `Return` clears it back to stock, `Scrap` stamps the terminal
 * `scrappedAt` and freezes the record. Serial-number duplicates are surfaced
 * as a high risk in the summary (the framework can't hard-enforce uniqueness
 * at validate — see the domain header) — visible, never silently allowed.
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
  SERIALS_MODULE_ID,
  SERIAL_KIND,
  serialCodePayload,
  serialFromRecord,
  serialRuntimeState,
  validateEnterpriseRecordInput,
} from '@neuropause/shared';
import {
  EnterpriseRecordStore,
  defineEnterpriseModule,
  type EnterpriseModule,
} from '../../framework';

/** The descriptor action keys the Serial Units module surfaces. */
export const ISSUE_SERIAL_ACTION = 'issue';
export const RETURN_SERIAL_ACTION = 'return';
export const SCRAP_SERIAL_ACTION = 'scrap';

/** The declarative description of a serial unit — drives store, CRUD, and the UI. */
export const SERIAL_DESCRIPTOR: EnterpriseModuleDescriptor = {
  id: SERIALS_MODULE_ID,
  title: 'Serial Units',
  singular: 'Serial Unit',
  plural: 'Serial Units',
  icon: 'hash',
  description:
    'Per-unit serialized tracking — unique serial identity followed received → issued → returned → scrapped, with a deterministic scannable payload.',
  group: 'Inventory',
  titleField: 'serialNumber',
  permissions: { read: 'inventory:read', write: 'inventory:manage' },
  actions: [
    { key: ISSUE_SERIAL_ACTION, label: 'Issue', icon: 'upload' },
    { key: RETURN_SERIAL_ACTION, label: 'Return', icon: 'download' },
    { key: SCRAP_SERIAL_ACTION, label: 'Scrap', icon: 'close' },
  ],
  fields: [
    { key: 'serialNumber', label: 'Serial #', type: 'text', required: true, placeholder: 'SN-2026-000123' },
    { key: 'product', label: 'Product (SKU)', type: 'text', required: true, placeholder: 'SKU-0001' },
    { key: 'warehouse', label: 'Warehouse', type: 'text', required: true, placeholder: 'WH-01' },
    { key: 'lotRef', label: 'Lot', type: 'text', column: false, placeholder: 'Lot number (optional)' },
    { key: 'receiptRef', label: 'Goods Receipt', type: 'text', column: false, placeholder: 'GR reference (optional)' },
    { key: 'issuedTo', label: 'Issued To', type: 'text', column: false, placeholder: 'Customer / work order (set before issue)' },
    { key: 'codePayload', label: 'Code Payload', type: 'textarea', readOnly: true, column: false },
    {
      key: 'status',
      label: 'Status',
      type: 'select',
      readOnly: true,
      default: 'in_stock',
      badge: true,
      filterable: true,
      options: [
        { value: 'in_stock', label: 'In Stock', tone: 'green' },
        { value: 'issued', label: 'Issued', tone: 'blue' },
        { value: 'scrapped', label: 'Scrapped', tone: 'neutral' },
      ],
    },
    { key: 'issuedAt', label: 'Issued At', type: 'text', readOnly: true, column: false },
    { key: 'scrappedAt', label: 'Scrapped At', type: 'text', readOnly: true, column: false },
    { key: 'notes', label: 'Notes', type: 'textarea', column: false, placeholder: 'Optional notes…' },
  ],
};

function str(v: unknown): string {
  return v === null || v === undefined ? '' : String(v);
}

/**
 * Build the Serial Units module. The Products store is injected so `product`
 * must resolve by exact SKU (the lot injection pattern).
 */
export function createSerialModule(
  storePath: string,
  productStore?: EnterpriseRecordStore,
): EnterpriseModule {
  const store = new EnterpriseRecordStore(storePath, SERIALS_MODULE_ID, SERIAL_KIND);
  return defineEnterpriseModule({
    descriptor: SERIAL_DESCRIPTOR,
    store,
    hooks: {
      validate: (input: EnterpriseRecordInput): EnterpriseRecordValidation => {
        const result = validateEnterpriseRecordInput(SERIAL_DESCRIPTOR, input);
        if (!result.ok) return result;
        if (str(input.fields?.scrappedAt)) {
          return {
            ok: false,
            errors: { status: 'This unit is scrapped — scrapped serials are immutable history.' },
            values: result.values,
          };
        }
        const errors: Record<string, string> = {};
        const sku = str(result.values.product);
        if (sku && productStore && !productStore.list().some((r) => str(r.fields.sku) === sku)) {
          errors.product = `No product with SKU "${sku}" was found.`;
        }
        // Marker-derived status (scrappedAt already excluded above).
        result.values.status = str(result.values.issuedAt) ? 'issued' : 'in_stock';
        result.values.codePayload = serialCodePayload({
          serialNumber: str(result.values.serialNumber),
          product: sku,
          warehouse: str(result.values.warehouse),
        });
        if (Object.keys(errors).length > 0) return { ok: false, errors, values: result.values };
        return result;
      },
      summarize: async (record): Promise<EnterpriseRecordSummary> => {
        const serial = serialFromRecord(record);
        const state = serialRuntimeState(serial);
        const duplicates = store
          .list()
          .filter((r) => r.id !== record.id && str(r.fields.serialNumber) === serial.serialNumber && str(r.fields.product) === serial.product).length;
        return {
          moduleId: SERIALS_MODULE_ID,
          recordId: record.id,
          headline: `${serial.serialNumber} · ${state} · ${serial.product}`,
          summary:
            `Serial ${serial.serialNumber} of ${serial.product} in ${serial.warehouse} — ${state}` +
            (state === 'issued' && serial.issuedTo ? ` to ${serial.issuedTo}` : '') +
            (serial.lotRef ? ` (lot ${serial.lotRef})` : '') +
            (duplicates > 0 ? `. WARNING: ${duplicates} other record(s) share this serial number for this product.` : '.'),
          risk: duplicates > 0 ? 'high' : 'low',
          riskReason:
            duplicates > 0
              ? 'A serial number must identify exactly one unit — resolve the duplicate before it corrupts traceability.'
              : 'Unique serialized unit — quantity accounting stays in the movement ledger.',
          executiveExplanation:
            'Serials track one physical unit each through its life; the scannable payload is deterministic and expiry/quantity live in lots and the ledger respectively.',
          grounded: false,
          model: 'none',
        };
      },
      runAction: async (action, record, actionCtx) => {
        const serial = serialFromRecord(record);
        if (serial.scrappedAt) return { ok: false, error: 'This unit is scrapped — no further action is possible.' };
        if (action === ISSUE_SERIAL_ACTION) {
          if (serial.issuedAt) return { ok: false, error: 'This unit is already issued — return it before re-issuing.' };
          store.update(record.id, {
            fields: { issuedAt: actionCtx.now(), status: 'issued' },
            actor: actionCtx.actor(),
            now: actionCtx.now(),
          });
          return { ok: true, message: `Serial ${serial.serialNumber} issued${serial.issuedTo ? ` to ${serial.issuedTo}` : ''} — record the matching stock issue from its document.` };
        }
        if (action === RETURN_SERIAL_ACTION) {
          if (!serial.issuedAt) return { ok: false, error: 'This unit is not issued — nothing to return.' };
          store.update(record.id, {
            fields: { issuedAt: '', issuedTo: '', status: 'in_stock' },
            actor: actionCtx.actor(),
            now: actionCtx.now(),
          });
          return { ok: true, message: `Serial ${serial.serialNumber} returned to stock.` };
        }
        if (action === SCRAP_SERIAL_ACTION) {
          store.update(record.id, {
            fields: { scrappedAt: actionCtx.now(), status: 'scrapped' },
            actor: actionCtx.actor(),
            now: actionCtx.now(),
          });
          return { ok: true, message: `Serial ${serial.serialNumber} scrapped — immutable history; record the matching write-off movement.` };
        }
        return { ok: false, error: `Unknown action "${action}".` };
      },
    },
  });
}
