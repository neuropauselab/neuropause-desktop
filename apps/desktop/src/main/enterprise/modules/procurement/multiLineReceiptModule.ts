/**
 * Procurement → Multi-Line Goods Receipt (ERP Session 7-Fix).
 *
 * A first-class receipt DOCUMENT (header + N lines) that posts one `receive`
 * movement per line through the shared multi-line seam — so each line is
 * standard-cost valued (Session 5-Fix), posts Dr Inventory / Cr GRNI (seam #1),
 * is traceable to the receipt, and the whole receipt is all-or-nothing: if any
 * line fails, every posted line is compensated (Session 6 reversal). Document-
 * level idempotency: a received receipt cannot re-post.
 *
 * Lines are a JSON array in the `lines` field: `[{ sku, quantity, warehouse? }]`
 * (warehouse falls back to the document warehouse). Deliberately NOT a second
 * copy of the single-line goods-receipt model — a proper document → lines →
 * movements relationship with deterministic movement references.
 */
import type {
  EnterpriseModuleDescriptor,
  EnterpriseRecordSummary,
} from '@neuropause/shared';
import { EnterpriseRecordStore, defineEnterpriseModule, type EnterpriseModule } from '../../framework';
import { postMovementLinesAtomic, type MovementLineInput } from '../inventory/multiLineMovements';

export const MULTILINE_RECEIPTS_MODULE_ID = 'procurement-multiline-receipts';
const MULTILINE_RECEIPT_KIND = 'multiline-receipt';
export const RECEIVE_LINES_ACTION = 'receiveLines';

const str = (v: unknown): string => (v === null || v === undefined ? '' : String(v));

export const MULTILINE_RECEIPT_DESCRIPTOR: EnterpriseModuleDescriptor = {
  id: MULTILINE_RECEIPTS_MODULE_ID,
  title: 'Goods Receipts (Multi-Line)',
  singular: 'Multi-Line Receipt',
  plural: 'Multi-Line Receipts',
  icon: 'package',
  description: 'A multi-line goods receipt — one document, many SKUs, each a valued stock movement.',
  group: 'Procurement',
  titleField: 'receiptNumber',
  permissions: { read: 'procurement:read', write: 'procurement:manage' },
  actions: [{ key: RECEIVE_LINES_ACTION, label: 'Receive Lines', icon: 'download' }],
  fields: [
    { key: 'receiptNumber', label: 'Receipt #', type: 'text', required: true, placeholder: 'GRN-0001' },
    { key: 'supplier', label: 'Supplier', type: 'text', column: false },
    { key: 'warehouse', label: 'Warehouse', type: 'text', required: true, placeholder: 'WH-01' },
    { key: 'lines', label: 'Lines (JSON)', type: 'textarea', required: true, column: false, placeholder: '[{"sku":"RM-1","quantity":10}]' },
    {
      key: 'status', label: 'Status', type: 'select', required: true, default: 'draft', badge: true, filterable: true,
      options: [
        { value: 'draft', label: 'Draft', tone: 'neutral' },
        { value: 'received', label: 'Received', tone: 'green' },
        { value: 'failed', label: 'Failed', tone: 'orange' },
      ],
    },
    { key: 'movementRefs', label: 'Movements', type: 'textarea', column: false, readOnly: true },
    { key: 'lineCount', label: 'Lines', type: 'number', readOnly: true, default: 0 },
  ],
};

/** Parse the JSON `lines` field into normalized movement lines (document warehouse fallback). */
export function parseReceiptLines(linesJson: string, docWarehouse: string): MovementLineInput[] {
  let raw: unknown;
  try {
    raw = JSON.parse(linesJson || '[]');
  } catch {
    return [];
  }
  if (!Array.isArray(raw)) return [];
  return raw.map((l) => {
    const line = (l ?? {}) as Record<string, unknown>;
    return {
      sku: str(line.sku),
      quantity: Number(line.quantity ?? 0) || 0,
      warehouse: str(line.warehouse) || docWarehouse,
    };
  });
}

export function createMultiLineReceiptModule(storePath: string): EnterpriseModule {
  const store = new EnterpriseRecordStore(storePath, MULTILINE_RECEIPTS_MODULE_ID, MULTILINE_RECEIPT_KIND);
  return defineEnterpriseModule({
    descriptor: MULTILINE_RECEIPT_DESCRIPTOR,
    store,
    hooks: {
      runAction: async (action, record, ctx) => {
        if (action !== RECEIVE_LINES_ACTION) return { ok: false, error: `Unknown action "${action}".` };
        if (str(record.fields.status) === 'received') {
          return { ok: false, message: 'This receipt has already been received.' }; // document-level idempotency
        }
        const number = str(record.fields.receiptNumber);
        const lines = parseReceiptLines(str(record.fields.lines), str(record.fields.warehouse));
        if (lines.length === 0) return { ok: false, message: 'No receipt lines to receive.' };
        const result = await postMovementLinesAtomic(
          ctx,
          { module: MULTILINE_RECEIPTS_MODULE_ID, recordId: record.id, number, type: 'receive', reason: `Receipt ${number}` },
          lines,
        );
        const updated = store.update(record.id, {
          fields: { status: result.ok ? 'received' : 'failed', movementRefs: result.movementIds.join(','), lineCount: lines.length },
          actor: ctx.actor(),
          now: ctx.now(),
        });
        const self = ctx.moduleFor(MULTILINE_RECEIPTS_MODULE_ID);
        if (updated && self) ctx.emit(self, 'updated', updated);
        return result.ok ? { ok: true, message: `Received ${result.postedCount} line(s) for ${number}.` } : { ok: false, error: result.message };
      },
      summarize: async (record): Promise<EnterpriseRecordSummary> => {
        const n = Number(record.fields.lineCount ?? 0);
        const status = str(record.fields.status);
        return {
          moduleId: MULTILINE_RECEIPTS_MODULE_ID,
          recordId: record.id,
          headline: `${str(record.fields.receiptNumber)} · ${n} line(s) · ${status}`,
          summary: `Multi-line goods receipt with ${n} line(s), status ${status}.`,
          risk: status === 'failed' ? 'medium' : 'low',
          riskReason: status === 'failed' ? 'Receipt failed and was compensated (no net effect).' : 'Receipt processed.',
          executiveExplanation: 'A multi-line receipt posts one valued stock movement per line, all-or-nothing.',
          grounded: false,
          model: 'none',
        };
      },
    },
  });
}
