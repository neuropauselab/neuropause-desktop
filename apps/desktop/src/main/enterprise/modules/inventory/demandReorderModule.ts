/**
 * Inventory → Reorder Recommendations — a governed, immutable, point-in-time RECOMMENDATION
 * register on the Enterprise Module Framework, modelled on the S81–S84 snapshots.
 *
 * RECOMMENDATION-ONLY. create = generate a snapshot of every active product's reorder attention
 * (from the canonical `assessReorder` engine), incoming supply (`openSupplyForProduct`), and S84
 * demand direction (context). It READS the product / purchase-request / purchase-order / shipping
 * stores (injected) and mutates NOTHING. It NEVER drafts a purchase request, creates a PO, moves
 * inventory, reserves stock, selects a supplier, or posts GL — the execution seam
 * (`runReorderCheck` → Purchase Requests) is deliberately NOT imported or called. Execution stays
 * an operator-gated future path (see DECISION-MEMO-S85).
 *
 * Electron-free (store paths + source stores injected), so it unit-tests without the runtime.
 */
import type {
  EnterpriseModuleDescriptor,
  EnterpriseRecordInput,
  EnterpriseRecordSummary,
  EnterpriseRecordValidation,
} from '@neuropause/shared';
import { productFromRecord, shippingFromRecord, validateEnterpriseRecordInput } from '@neuropause/shared';
import {
  EnterpriseRecordStore,
  defineEnterpriseModule,
  type EnterpriseModule,
} from '../../framework';
import { deriveReorderRecommendations } from './demandReorderModel';

export const REORDER_RECOMMENDATION_MODULE_ID = 'inventory-reorder-recommendation';
export const REORDER_RECOMMENDATION_KIND = 'reorderRecommendationReport';

export const REORDER_RECOMMENDATION_DESCRIPTOR: EnterpriseModuleDescriptor = {
  id: REORDER_RECOMMENDATION_MODULE_ID,
  title: 'Reorder Recommendations',
  singular: 'Reorder Recommendation Report',
  plural: 'Reorder Recommendation Reports',
  icon: 'database',
  description:
    'Point-in-time reorder-attention recommendations per SKU (reorder engine + incoming supply + demand trend). Advisory only — drafts no purchase request and moves no stock.',
  group: 'Inventory',
  titleField: 'reportNumber',
  permissions: { read: 'inventory:read', write: 'inventory:manage' },
  fields: [
    { key: 'reportNumber', label: 'Report #', type: 'text', readOnly: true },
    { key: 'asOfDate', label: 'As Of', type: 'date', format: 'date', placeholder: 'Defaults to today' },
    { key: 'skuCount', label: 'SKUs', type: 'number', readOnly: true, default: 0 },
    { key: 'reorderCount', label: 'Need Reorder', type: 'number', readOnly: true, default: 0 },
    { key: 'okCount', label: 'OK', type: 'number', readOnly: true, default: 0, column: false },
    { key: 'totalRecommendedQuantity', label: 'Suggested Qty', type: 'number', readOnly: true, default: 0 },
    { key: 'rows', label: 'Recommendation Breakdown (JSON)', type: 'textarea', readOnly: true, column: false },
    { key: 'generatedAt', label: 'Generated At', type: 'text', readOnly: true, column: false },
    { key: 'note', label: 'Note', type: 'textarea', readOnly: true, column: false },
  ],
};

function str(v: unknown): string {
  return v === null || v === undefined ? '' : String(v);
}

/** Build the Reorder Recommendations module (product + PR + PO + shipping stores injected). */
export function createReorderRecommendationModule(
  storePath: string,
  productStore: EnterpriseRecordStore,
  purchaseRequestStore: EnterpriseRecordStore,
  purchaseOrderStore: EnterpriseRecordStore,
  shippingStore: EnterpriseRecordStore,
): EnterpriseModule {
  const store = new EnterpriseRecordStore(storePath, REORDER_RECOMMENDATION_MODULE_ID, REORDER_RECOMMENDATION_KIND);
  return defineEnterpriseModule({
    descriptor: REORDER_RECOMMENDATION_DESCRIPTOR,
    store,
    hooks: {
      validate: (input: EnterpriseRecordInput): EnterpriseRecordValidation => {
        const result = validateEnterpriseRecordInput(REORDER_RECOMMENDATION_DESCRIPTOR, input);
        if (!result.ok) return result;
        if (str(result.values.generatedAt)) {
          return {
            ok: false,
            errors: { _: 'Recommendation reports are immutable snapshots — generate a new report instead.' },
            values: result.values,
          };
        }
        const asOfDate = str(result.values.asOfDate).trim() || new Date().toISOString().slice(0, 10);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(asOfDate)) {
          return { ok: false, errors: { asOfDate: 'As-of must be a date (YYYY-MM-DD).' }, values: result.values };
        }
        const snap = deriveReorderRecommendations(
          {
            products: productStore.list().map(productFromRecord),
            purchaseRequests: purchaseRequestStore.list(),
            purchaseOrders: purchaseOrderStore.list(),
            shipments: shippingStore.list().map(shippingFromRecord),
          },
          asOfDate,
        );
        const priorCount = store.list().filter((r) => str(r.fields.asOfDate) === asOfDate).length;
        result.values.asOfDate = asOfDate;
        result.values.reportNumber = `REORDER-${asOfDate}-${priorCount + 1}`;
        result.values.skuCount = snap.skuCount;
        result.values.reorderCount = snap.reorderCount;
        result.values.okCount = snap.okCount;
        result.values.totalRecommendedQuantity = snap.totalRecommendedQuantity;
        result.values.rows = JSON.stringify(snap.rows);
        result.values.note =
          snap.skuCount === 0
            ? 'no active products at the as-of date — the report is empty, not fabricated'
            : `advisory reorder recommendations for ${snap.skuCount} active SKU(s) at ${asOfDate}; reuses the canonical reorder engine + demand trend; drafts no purchase request and moves no stock`;
        result.values.generatedAt = new Date().toISOString();
        return result;
      },
      summarize: async (record): Promise<EnterpriseRecordSummary> => {
        const f = record.fields;
        const reorder = Number(f.reorderCount ?? 0);
        return {
          moduleId: REORDER_RECOMMENDATION_MODULE_ID,
          recordId: record.id,
          headline: `${str(f.reportNumber)} · ${reorder} of ${Number(f.skuCount ?? 0)} SKU(s) need reorder`,
          summary: `As of ${str(f.asOfDate)}: ${reorder} SKU(s) at/below reorder level (suggested total ${Number(f.totalRecommendedQuantity ?? 0).toLocaleString('en-US')} units); ${Number(f.okCount ?? 0)} OK.`,
          risk: reorder > 0 ? 'medium' : 'low',
          riskReason: reorder > 0 ? 'One or more SKUs are at/below reorder level (advisory).' : 'No SKUs below reorder level.',
          executiveExplanation:
            'Attention and suggested quantity reuse the canonical reorder engine (available + open supply vs reorder level); demand trend is attached as context and never alters the trigger. Advisory only: no purchase request is drafted, no stock is moved, no GL is posted, and nothing is executed automatically.',
          grounded: false,
          model: 'none',
        };
      },
    },
  });
}
