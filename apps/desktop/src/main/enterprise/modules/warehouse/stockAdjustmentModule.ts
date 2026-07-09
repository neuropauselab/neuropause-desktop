/**
 * Warehouse → Stock Adjustments — deliberate stock corrections (damage / expired /
 * lost / found / audit correction). A `validate` hook makes the reason authoritative
 * for the sign (damage/expired/lost remove stock, found adds, audit correction is
 * signed as entered). `post` writes a REAL signed `adjustment` movement into the
 * Inventory Ledger — it NEVER edits stock directly. Idempotent. The `summarize` hook
 * explains the value impact; the AI never computes it.
 */
import type {
  EnterpriseModuleDescriptor,
  EnterpriseRecordInput,
  EnterpriseRecordSummary,
  StockAdjustment,
} from '@neuropause/shared';
import {
  ADJUSTMENT_REASONS,
  STOCK_ADJUSTMENTS_MODULE_ID,
  STOCK_ADJUSTMENT_KIND,
  stockAdjustmentFromRecord,
  stockAdjustmentSummaryFallback,
  validateEnterpriseRecordInput,
} from '@neuropause/shared';
import {
  EnterpriseRecordStore,
  defineEnterpriseModule,
  type EnterpriseModule,
} from '../../framework';
import { postAdjustmentMovement } from './warehouseMovements';

export const POST_ADJUSTMENT_ACTION = 'post';
export const CANCEL_ADJUSTMENT_ACTION = 'cancel';

const str = (v: unknown): string => (v === null || v === undefined ? '' : String(v));
const num = (v: unknown): number => (typeof v === 'number' ? v : Number(str(v)) || 0);

export const STOCK_ADJUSTMENT_DESCRIPTOR: EnterpriseModuleDescriptor = {
  id: STOCK_ADJUSTMENTS_MODULE_ID,
  title: 'Stock Adjustments',
  singular: 'Stock Adjustment',
  plural: 'Stock Adjustments',
  icon: 'edit',
  description: 'Correct stock via real signed adjustment movements.',
  group: 'Warehouse',
  titleField: 'adjustmentNumber',
  permissions: { read: 'warehouse:read', write: 'warehouse:manage' },
  actions: [
    { key: POST_ADJUSTMENT_ACTION, label: 'Post Adjustment', icon: 'check' },
    { key: CANCEL_ADJUSTMENT_ACTION, label: 'Cancel', icon: 'close' },
  ],
  fields: [
    { key: 'adjustmentNumber', label: 'Adjustment #', type: 'text', required: true, placeholder: 'ADJ-0001' },
    { key: 'product', label: 'Product (SKU)', type: 'text', required: true, placeholder: 'SKU-0001' },
    { key: 'warehouse', label: 'Warehouse', type: 'text', required: true, placeholder: 'WH-01' },
    { key: 'quantity', label: 'Quantity (±)', type: 'number', required: true },
    {
      key: 'reason',
      label: 'Reason',
      type: 'select',
      required: true,
      default: 'audit_correction',
      badge: true,
      filterable: true,
      options: [
        { value: 'damage', label: 'Damage', tone: 'orange' },
        { value: 'expired', label: 'Expired', tone: 'orange' },
        { value: 'lost', label: 'Lost', tone: 'orange' },
        { value: 'found', label: 'Found', tone: 'green' },
        { value: 'audit_correction', label: 'Audit Correction', tone: 'blue' },
      ],
    },
    { key: 'unitCost', label: 'Unit Cost', type: 'number', min: 0, format: 'currency', column: false },
    { key: 'notes', label: 'Notes', type: 'text', column: false },
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
        { value: 'posted', label: 'Posted', tone: 'green' },
        { value: 'cancelled', label: 'Cancelled', tone: 'orange' },
      ],
    },
    { key: 'adjustmentMovement', label: 'Movement', type: 'text', column: false, readOnly: true },
  ],
};

export interface StockAdjustmentAiNarrative {
  summary: string;
  executiveExplanation: string;
  grounded: boolean;
  model: string;
}
export type StockAdjustmentAiRunner = (adjustment: StockAdjustment) => Promise<StockAdjustmentAiNarrative | null>;

/** Make the reason authoritative for the sign of the quantity. Deterministic. */
function normalizeSign(values: EnterpriseRecordInput['fields']): void {
  if (!values) return;
  const reason = str(values.reason);
  const magnitude = Math.abs(num(values.quantity));
  if (reason === 'found') values.quantity = magnitude;
  else if (reason === 'damage' || reason === 'expired' || reason === 'lost') values.quantity = -magnitude;
  // audit_correction: keep the signed quantity as entered.
}

export function createStockAdjustmentModule(storePath: string, aiRunner?: StockAdjustmentAiRunner): EnterpriseModule {
  const store = new EnterpriseRecordStore(storePath, STOCK_ADJUSTMENTS_MODULE_ID, STOCK_ADJUSTMENT_KIND);
  return defineEnterpriseModule({
    descriptor: STOCK_ADJUSTMENT_DESCRIPTOR,
    store,
    hooks: {
      validate: (input: EnterpriseRecordInput) => {
        const result = validateEnterpriseRecordInput(STOCK_ADJUSTMENT_DESCRIPTOR, input);
        if (result.ok && (ADJUSTMENT_REASONS as readonly string[]).includes(str(result.values.reason))) {
          normalizeSign(result.values);
        }
        return result;
      },
      summarize: async (record): Promise<EnterpriseRecordSummary> => {
        const adjustment = stockAdjustmentFromRecord(record);
        const ai = aiRunner ? await aiRunner(adjustment).catch(() => null) : null;
        const fallback = stockAdjustmentSummaryFallback(adjustment);
        return {
          moduleId: STOCK_ADJUSTMENTS_MODULE_ID,
          recordId: record.id,
          headline: `${adjustment.adjustmentNumber} · ${adjustment.product} · ${adjustment.quantity >= 0 ? '+' : ''}${adjustment.quantity} · ${adjustment.reason}`,
          summary: ai?.summary?.trim() || fallback.summary,
          risk: adjustment.reason === 'audit_correction' || adjustment.reason === 'found' ? 'low' : 'medium',
          riskReason: `Adjustment (${adjustment.reason}).`,
          executiveExplanation: ai?.executiveExplanation?.trim() || fallback.executiveExplanation,
          grounded: Boolean(ai?.grounded),
          model: ai?.model ?? 'none',
        };
      },
      // THE inventory integration: posting writes a real signed adjustment movement.
      runAction: async (action, record, ctx) => {
        const adjustment = stockAdjustmentFromRecord(record);
        if (action === POST_ADJUSTMENT_ACTION) {
          if (adjustment.status === 'posted') return { ok: false, message: 'This adjustment has already been posted.' };
          if (adjustment.status === 'cancelled') return { ok: false, message: 'Cannot post a cancelled adjustment.' };
          if (!adjustment.product || !adjustment.warehouse || adjustment.quantity === 0) {
            return { ok: false, message: 'Set a product, warehouse, and non-zero quantity before posting.' };
          }
          const movement = await postAdjustmentMovement(ctx, {
            movementNumber: `MV-${adjustment.adjustmentNumber}-ADJ`,
            product: adjustment.product,
            warehouse: adjustment.warehouse,
            quantity: adjustment.quantity,
            unitCost: adjustment.unitCost,
            referenceModule: STOCK_ADJUSTMENTS_MODULE_ID,
            referenceRecord: adjustment.id,
            reason: `Stock adjustment ${adjustment.adjustmentNumber} (${adjustment.reason})`,
          });
          if (!movement) return { ok: false, error: 'Could not post the adjustment movement.' };
          const updated = store.update(record.id, {
            fields: { status: 'posted', adjustmentMovement: movement.id },
            actor: ctx.actor(),
            now: ctx.now(),
          });
          if (!updated) return { ok: false, error: 'Stock adjustment not found.' };
          const self = ctx.moduleFor(STOCK_ADJUSTMENTS_MODULE_ID);
          if (self) ctx.emit(self, 'updated', updated);
          return { ok: true, message: `Posted ${adjustment.quantity >= 0 ? '+' : ''}${adjustment.quantity} of ${adjustment.product}.` };
        }

        if (action === CANCEL_ADJUSTMENT_ACTION) {
          if (adjustment.status !== 'draft') return { ok: false, message: `Cannot cancel an adjustment that is ${adjustment.status}.` };
          const updated = store.update(record.id, { fields: { status: 'cancelled' }, actor: ctx.actor(), now: ctx.now() });
          if (!updated) return { ok: false, error: 'Stock adjustment not found.' };
          const self = ctx.moduleFor(STOCK_ADJUSTMENTS_MODULE_ID);
          if (self) ctx.emit(self, 'updated', updated);
          return { ok: true, message: `Adjustment ${adjustment.adjustmentNumber} cancelled.` };
        }

        return { ok: false, error: `Unknown action "${action}".` };
      },
    },
  });
}
