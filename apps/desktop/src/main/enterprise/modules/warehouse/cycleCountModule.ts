/**
 * Warehouse → Cycle Counts — physically counting stock and reconciling the ledger.
 * `reconcile` computes the deterministic variance (counted − system) and, when it is
 * non-zero, posts a REAL signed `adjustment` movement into the Inventory Ledger — it
 * NEVER overwrites the stock quantity. A zero-variance count reconciles with no
 * movement. Idempotent. The `summarize` hook explains the variance; the AI never
 * computes it.
 */
import type {
  EnterpriseModuleDescriptor,
  EnterpriseRecordSummary,
  CycleCount,
} from '@neuropause/shared';
import {
  CYCLE_COUNTS_MODULE_ID,
  CYCLE_COUNT_KIND,
  calculateCycleCountVariance,
  cycleCountFromRecord,
  cycleCountSummaryFallback,
} from '@neuropause/shared';
import {
  EnterpriseRecordStore,
  defineEnterpriseModule,
  type EnterpriseModule,
} from '../../framework';
import { postAdjustmentMovement } from './warehouseMovements';

export const RECONCILE_ACTION = 'reconcile';

export const CYCLE_COUNT_DESCRIPTOR: EnterpriseModuleDescriptor = {
  id: CYCLE_COUNTS_MODULE_ID,
  title: 'Cycle Counts',
  singular: 'Cycle Count',
  plural: 'Cycle Counts',
  icon: 'clipboard',
  description: 'Count stock and reconcile variance via adjustment movements.',
  group: 'Warehouse',
  titleField: 'countNumber',
  permissions: { read: 'warehouse:read', write: 'warehouse:manage' },
  actions: [{ key: RECONCILE_ACTION, label: 'Reconcile', icon: 'check' }],
  fields: [
    { key: 'countNumber', label: 'Count #', type: 'text', required: true, placeholder: 'CC-0001' },
    { key: 'product', label: 'Product (SKU)', type: 'text', required: true, placeholder: 'SKU-0001' },
    { key: 'warehouse', label: 'Warehouse', type: 'text', required: true, placeholder: 'WH-01' },
    { key: 'systemQuantity', label: 'System Qty', type: 'number', required: true },
    { key: 'countedQuantity', label: 'Counted Qty', type: 'number', required: true, min: 0 },
    { key: 'countDate', label: 'Count Date', type: 'date', column: false, format: 'date' },
    { key: 'counter', label: 'Counted By', type: 'text', column: false },
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
        { value: 'counted', label: 'Counted', tone: 'blue' },
        { value: 'reconciled', label: 'Reconciled', tone: 'green' },
      ],
    },
    { key: 'adjustmentMovement', label: 'Adjustment', type: 'text', column: false, readOnly: true },
  ],
};

export interface CycleCountAiNarrative {
  summary: string;
  executiveExplanation: string;
  grounded: boolean;
  model: string;
}
export type CycleCountAiRunner = (count: CycleCount) => Promise<CycleCountAiNarrative | null>;

export function createCycleCountModule(storePath: string, aiRunner?: CycleCountAiRunner): EnterpriseModule {
  const store = new EnterpriseRecordStore(storePath, CYCLE_COUNTS_MODULE_ID, CYCLE_COUNT_KIND);
  return defineEnterpriseModule({
    descriptor: CYCLE_COUNT_DESCRIPTOR,
    store,
    hooks: {
      summarize: async (record): Promise<EnterpriseRecordSummary> => {
        const count = cycleCountFromRecord(record);
        const ai = aiRunner ? await aiRunner(count).catch(() => null) : null;
        const fallback = cycleCountSummaryFallback(count);
        const variance = calculateCycleCountVariance(count.systemQuantity, count.countedQuantity);
        return {
          moduleId: CYCLE_COUNTS_MODULE_ID,
          recordId: record.id,
          headline: `${count.countNumber} · ${count.product} · variance ${variance >= 0 ? '+' : ''}${variance}`,
          summary: ai?.summary?.trim() || fallback.summary,
          risk: Math.abs(variance) > 0 ? 'medium' : 'low',
          riskReason: variance === 0 ? 'Count matched the system.' : 'Count variance detected.',
          executiveExplanation: ai?.executiveExplanation?.trim() || fallback.executiveExplanation,
          grounded: Boolean(ai?.grounded),
          model: ai?.model ?? 'none',
        };
      },
      // THE inventory integration: a non-zero variance posts a real signed adjustment
      // movement — the count never overwrites the stock quantity. Idempotent.
      runAction: async (action, record, ctx) => {
        if (action !== RECONCILE_ACTION) return { ok: false, error: `Unknown action "${action}".` };
        const count = cycleCountFromRecord(record);
        if (count.status === 'reconciled') return { ok: false, message: 'This cycle count has already been reconciled.' };
        if (!count.product || !count.warehouse) return { ok: false, message: 'Set a product and warehouse before reconciling.' };
        const variance = calculateCycleCountVariance(count.systemQuantity, count.countedQuantity);
        let adjustmentId = '';
        if (variance !== 0) {
          const movement = await postAdjustmentMovement(ctx, {
            movementNumber: `MV-${count.countNumber}-ADJ`,
            product: count.product,
            warehouse: count.warehouse,
            quantity: variance,
            referenceModule: CYCLE_COUNTS_MODULE_ID,
            referenceRecord: count.id,
            reason: `Cycle count ${count.countNumber} variance`,
          });
          if (!movement) return { ok: false, error: 'Could not post the adjustment movement.' };
          adjustmentId = movement.id;
        }
        const updated = store.update(record.id, {
          fields: { status: 'reconciled', adjustmentMovement: adjustmentId },
          actor: ctx.actor(),
          now: ctx.now(),
        });
        if (!updated) return { ok: false, error: 'Cycle count not found.' };
        const self = ctx.moduleFor(CYCLE_COUNTS_MODULE_ID);
        if (self) ctx.emit(self, 'updated', updated);
        return {
          ok: true,
          message: variance === 0 ? `Cycle count ${count.countNumber} matched the system.` : `Reconciled variance of ${variance >= 0 ? '+' : ''}${variance} for ${count.product}.`,
        };
      },
    },
  });
}
