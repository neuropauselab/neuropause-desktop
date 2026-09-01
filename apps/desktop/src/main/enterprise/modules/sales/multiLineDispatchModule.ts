/**
 * Sales → Multi-Line Dispatch (ERP Session 7-Fix).
 *
 * A first-class dispatch DOCUMENT (header + N lines) that posts one `issue`
 * movement per line through the shared multi-line seam — each line valued at
 * STANDARD cost (Session 5-Fix; never the sales price), posting Dr COGS / Cr
 * Inventory (seam #1), traceable to the dispatch, all-or-nothing (a failed line
 * compensates every posted line via the Session 6 reversal). Document-level
 * idempotency: a dispatched document cannot re-post.
 *
 * Lines are a JSON array in `lines`: `[{ sku, quantity, warehouse? }]`.
 */
import type {
  EnterpriseModuleDescriptor,
  EnterpriseRecordSummary,
} from '@neuropause/shared';
import { EnterpriseRecordStore, defineEnterpriseModule, type EnterpriseModule } from '../../framework';
import { postMovementLinesAtomic } from '../inventory/multiLineMovements';
import { parseReceiptLines } from '../procurement/multiLineReceiptModule';

export const MULTILINE_DISPATCHES_MODULE_ID = 'sales-multiline-dispatches';
const MULTILINE_DISPATCH_KIND = 'multiline-dispatch';
export const DISPATCH_LINES_ACTION = 'dispatchLines';

const str = (v: unknown): string => (v === null || v === undefined ? '' : String(v));

export const MULTILINE_DISPATCH_DESCRIPTOR: EnterpriseModuleDescriptor = {
  id: MULTILINE_DISPATCHES_MODULE_ID,
  title: 'Sales Dispatches (Multi-Line)',
  singular: 'Multi-Line Dispatch',
  plural: 'Multi-Line Dispatches',
  icon: 'truck',
  description: 'A multi-line sales dispatch — one document, many SKUs, each a valued stock issue.',
  group: 'Sales',
  titleField: 'dispatchNumber',
  permissions: { read: 'sales:read', write: 'sales:manage' },
  actions: [{ key: DISPATCH_LINES_ACTION, label: 'Dispatch Lines', icon: 'upload' }],
  fields: [
    { key: 'dispatchNumber', label: 'Dispatch #', type: 'text', required: true, placeholder: 'DSP-0001' },
    { key: 'customer', label: 'Customer', type: 'text', column: false },
    { key: 'warehouse', label: 'Warehouse', type: 'text', required: true, placeholder: 'WH-01' },
    { key: 'lines', label: 'Lines (JSON)', type: 'textarea', required: true, column: false, placeholder: '[{"sku":"FG-1","quantity":3}]' },
    {
      key: 'status', label: 'Status', type: 'select', required: true, default: 'draft', badge: true, filterable: true,
      options: [
        { value: 'draft', label: 'Draft', tone: 'neutral' },
        { value: 'dispatched', label: 'Dispatched', tone: 'green' },
        { value: 'failed', label: 'Failed', tone: 'orange' },
      ],
    },
    { key: 'movementRefs', label: 'Movements', type: 'textarea', column: false, readOnly: true },
    { key: 'lineCount', label: 'Lines', type: 'number', readOnly: true, default: 0 },
  ],
};

export function createMultiLineDispatchModule(storePath: string): EnterpriseModule {
  const store = new EnterpriseRecordStore(storePath, MULTILINE_DISPATCHES_MODULE_ID, MULTILINE_DISPATCH_KIND);
  return defineEnterpriseModule({
    descriptor: MULTILINE_DISPATCH_DESCRIPTOR,
    store,
    hooks: {
      runAction: async (action, record, ctx) => {
        if (action !== DISPATCH_LINES_ACTION) return { ok: false, error: `Unknown action "${action}".` };
        if (str(record.fields.status) === 'dispatched') {
          return { ok: false, message: 'This dispatch has already been dispatched.' }; // idempotency
        }
        const number = str(record.fields.dispatchNumber);
        const lines = parseReceiptLines(str(record.fields.lines), str(record.fields.warehouse));
        if (lines.length === 0) return { ok: false, message: 'No dispatch lines to dispatch.' };
        const result = await postMovementLinesAtomic(
          ctx,
          { module: MULTILINE_DISPATCHES_MODULE_ID, recordId: record.id, number, type: 'issue', reason: `Dispatch ${number}` },
          lines,
        );
        const updated = store.update(record.id, {
          fields: { status: result.ok ? 'dispatched' : 'failed', movementRefs: result.movementIds.join(','), lineCount: lines.length },
          actor: ctx.actor(),
          now: ctx.now(),
        });
        const self = ctx.moduleFor(MULTILINE_DISPATCHES_MODULE_ID);
        if (updated && self) ctx.emit(self, 'updated', updated);
        return result.ok ? { ok: true, message: `Dispatched ${result.postedCount} line(s) for ${number}.` } : { ok: false, error: result.message };
      },
      summarize: async (record): Promise<EnterpriseRecordSummary> => {
        const n = Number(record.fields.lineCount ?? 0);
        const status = str(record.fields.status);
        return {
          moduleId: MULTILINE_DISPATCHES_MODULE_ID,
          recordId: record.id,
          headline: `${str(record.fields.dispatchNumber)} · ${n} line(s) · ${status}`,
          summary: `Multi-line sales dispatch with ${n} line(s), status ${status}.`,
          risk: status === 'failed' ? 'medium' : 'low',
          riskReason: status === 'failed' ? 'Dispatch failed and was compensated (no net effect).' : 'Dispatch processed.',
          executiveExplanation: 'A multi-line dispatch issues one standard-cost stock movement per line, all-or-nothing.',
          grounded: false,
          model: 'none',
        };
      },
    },
  });
}
