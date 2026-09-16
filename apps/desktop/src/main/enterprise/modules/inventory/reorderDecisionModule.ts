/**
 * Inventory → Reorder Decision Readiness — a governed, immutable, point-in-time DECISION-READINESS
 * register on the Enterprise Module Framework, modelled on the S81–S85 snapshots.
 *
 * DECISION-INTELLIGENCE-ONLY, NON-EXECUTING. create = generate a snapshot that, for every active
 * product, layers over the S85 reorder RECOMMENDATION (`deriveReorderRecommendations`) the
 * information an operator needs to DECIDE a reorder: the estimated order value (suggested qty ×
 * canonical `purchaseCost`), the approval steps the EXISTING spend policy would require for that
 * value (`applicableSteps`/`DEFAULT_SPEND_POLICY`), the outstanding blockers (missing supplier /
 * missing cost / insufficient demand), a source-driven readiness status, and a fail-closed
 * execution-readiness flag.
 *
 * It READS the product / purchase-request / purchase-order / shipping stores (injected) and mutates
 * NOTHING. It NEVER drafts a purchase request, creates a PO, moves inventory, reserves stock,
 * selects/awards a supplier, or posts GL — the execution seam (`runReorderCheck`) is deliberately
 * NOT imported or called. Automatic execution is policy-undefined and stays an operator-gated future
 * gate (see DECISION-MEMO-S86); `executionReadiness` is fail-closed on every row.
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
import { deriveReorderDecisionReadiness } from './reorderDecisionModel';

export const REORDER_DECISION_MODULE_ID = 'inventory-reorder-decision';
export const REORDER_DECISION_KIND = 'reorderDecisionReport';

export const REORDER_DECISION_DESCRIPTOR: EnterpriseModuleDescriptor = {
  id: REORDER_DECISION_MODULE_ID,
  title: 'Reorder Decision Readiness',
  singular: 'Reorder Decision Report',
  plural: 'Reorder Decision Reports',
  icon: 'database',
  description:
    'Point-in-time reorder DECISION readiness per SKU (reorder recommendation + estimated order value + required approval steps + outstanding blockers). Decision intelligence only — drafts no purchase request, moves no stock, and executes nothing automatically.',
  group: 'Inventory',
  titleField: 'reportNumber',
  permissions: { read: 'inventory:read', write: 'inventory:manage' },
  fields: [
    { key: 'reportNumber', label: 'Report #', type: 'text', readOnly: true },
    { key: 'asOfDate', label: 'As Of', type: 'date', format: 'date', placeholder: 'Defaults to today' },
    { key: 'skuCount', label: 'SKUs', type: 'number', readOnly: true, default: 0 },
    { key: 'reorderRequiredCount', label: 'Reorder Required', type: 'number', readOnly: true, default: 0 },
    { key: 'readyForReviewCount', label: 'Ready for Review', type: 'number', readOnly: true, default: 0 },
    { key: 'supplierDataMissingCount', label: 'Blocked (Data Missing)', type: 'number', readOnly: true, default: 0, column: false },
    { key: 'notRequiredCount', label: 'No Reorder', type: 'number', readOnly: true, default: 0, column: false },
    { key: 'executionBlocked', label: 'Execution Blocked', type: 'text', readOnly: true, column: false },
    { key: 'rows', label: 'Decision Breakdown (JSON)', type: 'textarea', readOnly: true, column: false },
    { key: 'generatedAt', label: 'Generated At', type: 'text', readOnly: true, column: false },
    { key: 'note', label: 'Note', type: 'textarea', readOnly: true, column: false },
  ],
};

function str(v: unknown): string {
  return v === null || v === undefined ? '' : String(v);
}

/** Build the Reorder Decision Readiness module (product + PR + PO + shipping stores injected). */
export function createReorderDecisionModule(
  storePath: string,
  productStore: EnterpriseRecordStore,
  purchaseRequestStore: EnterpriseRecordStore,
  purchaseOrderStore: EnterpriseRecordStore,
  shippingStore: EnterpriseRecordStore,
): EnterpriseModule {
  const store = new EnterpriseRecordStore(storePath, REORDER_DECISION_MODULE_ID, REORDER_DECISION_KIND);
  return defineEnterpriseModule({
    descriptor: REORDER_DECISION_DESCRIPTOR,
    store,
    hooks: {
      validate: (input: EnterpriseRecordInput): EnterpriseRecordValidation => {
        const result = validateEnterpriseRecordInput(REORDER_DECISION_DESCRIPTOR, input);
        if (!result.ok) return result;
        if (str(result.values.generatedAt)) {
          return {
            ok: false,
            errors: { _: 'Decision reports are immutable snapshots — generate a new report instead.' },
            values: result.values,
          };
        }
        const asOfDate = str(result.values.asOfDate).trim() || new Date().toISOString().slice(0, 10);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(asOfDate)) {
          return { ok: false, errors: { asOfDate: 'As-of must be a date (YYYY-MM-DD).' }, values: result.values };
        }
        const snap = deriveReorderDecisionReadiness(
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
        result.values.reportNumber = `REORDER-DECISION-${asOfDate}-${priorCount + 1}`;
        result.values.skuCount = snap.skuCount;
        result.values.reorderRequiredCount = snap.reorderRequiredCount;
        result.values.readyForReviewCount = snap.readyForReviewCount;
        result.values.supplierDataMissingCount = snap.supplierDataMissingCount;
        result.values.notRequiredCount = snap.notRequiredCount;
        result.values.executionBlocked = snap.executionBlocked ? 'yes — automatic execution is policy-undefined' : 'no';
        result.values.rows = JSON.stringify(snap.rows);
        result.values.note =
          snap.skuCount === 0
            ? 'no active products at the as-of date — the report is empty, not fabricated'
            : `reorder decision readiness for ${snap.skuCount} active SKU(s) at ${asOfDate}; ${snap.reorderRequiredCount} require reorder (${snap.readyForReviewCount} ready for operator review, ${snap.supplierDataMissingCount} blocked on missing data); reuses the canonical reorder engine + spend policy; drafts no purchase request, moves no stock, and executes nothing automatically`;
        result.values.generatedAt = new Date().toISOString();
        return result;
      },
      summarize: async (record): Promise<EnterpriseRecordSummary> => {
        const f = record.fields;
        const required = Number(f.reorderRequiredCount ?? 0);
        const ready = Number(f.readyForReviewCount ?? 0);
        return {
          moduleId: REORDER_DECISION_MODULE_ID,
          recordId: record.id,
          headline: `${str(f.reportNumber)} · ${required} of ${Number(f.skuCount ?? 0)} SKU(s) need a reorder decision`,
          summary: `As of ${str(f.asOfDate)}: ${required} SKU(s) require reorder — ${ready} ready for operator review, ${Number(f.supplierDataMissingCount ?? 0)} blocked on missing supplier/cost data. Automatic execution is policy-undefined (blocked).`,
          risk: required > 0 ? 'medium' : 'low',
          riskReason: required > 0 ? 'One or more SKUs require an operator reorder decision (advisory).' : 'No SKUs require a reorder decision.',
          executiveExplanation:
            'Each row layers the estimated order value (suggested qty × canonical purchase cost) and the approval steps the existing spend policy would require onto the canonical reorder recommendation, then lists the outstanding blockers. Decision intelligence only: no purchase request is drafted, no supplier is awarded, no stock is moved, no GL is posted, and — because automatic execution is policy-undefined — nothing is executed automatically.',
          grounded: false,
          model: 'none',
        };
      },
    },
  });
}
