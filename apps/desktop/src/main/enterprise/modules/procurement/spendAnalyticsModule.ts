/**
 * Procurement → Spend Analytics — governed, immutable, point-in-time spend registers on the
 * Enterprise Module Framework, modelled exactly on Supplier Performance / AP Aging beside it:
 * CREATE = generate. The validate hook walks the injected purchase-order, goods-receipt,
 * vendor-bill and vendor-payment stores through the pure `deriveSpendAnalytics` — per-supplier
 * ORDERED / COMMITTED / OPEN / RECEIVED / INVOICED / PAID kept apart (the existing status
 * sets, never blended into one number), spend share, and a calendar-month rollup. Registers
 * are IMMUTABLE (the `generatedAt` marker refuses edits); the source stores are only READ.
 *
 * MODULE ID: a LOCAL const (the `multiLineReceiptModule` precedent), deliberately NOT added
 * to the frozen shared types — supplierPerformance predates the freeze; new ids stay local.
 *
 * Source stores are injected as GETTERS: the vendor-bill/payment instances live in finance
 * and already import `procurementInstances` (vendorBillModuleInstance → purchaseOrderModule),
 * so a direct instance import here would evaluate mid-cycle; a lazy getter defers the
 * dereference to generation time, when every singleton exists. Electron-free; unit-tests
 * without the app runtime.
 */
import type {
  EnterpriseModuleDescriptor,
  EnterpriseRecordInput,
  EnterpriseRecordSummary,
  EnterpriseRecordValidation,
} from '@neuropause/shared';
import {
  goodsReceiptFromRecord,
  purchaseOrderFromRecord,
  validateEnterpriseRecordInput,
  vendorBillFromRecord,
  vendorPaymentFromRecord,
} from '@neuropause/shared';
import {
  EnterpriseRecordStore,
  defineEnterpriseModule,
  type EnterpriseModule,
} from '../../framework';
import { deriveSpendAnalytics } from './procurementIntelligenceModel';

/** Local module identity — see the header (multiLineReceipt precedent; frozen shared untouched). */
export const SPEND_ANALYTICS_MODULE_ID = 'procurement-spend-analytics';
export const SPEND_ANALYTICS_KIND = 'spendRegister';

export const SPEND_ANALYTICS_DESCRIPTOR: EnterpriseModuleDescriptor = {
  id: SPEND_ANALYTICS_MODULE_ID,
  title: 'Spend Analytics',
  singular: 'Spend Register',
  plural: 'Spend Registers',
  icon: 'gauge',
  description:
    'Immutable per-supplier spend registers — ordered / committed / open / received / invoiced / paid kept apart, with spend share and a monthly rollup.',
  group: 'Procurement',
  titleField: 'reportNumber',
  permissions: { read: 'procurement:read', write: 'procurement:manage' },
  fields: [
    { key: 'reportNumber', label: 'Register #', type: 'text', readOnly: true },
    { key: 'asOfDate', label: 'As Of', type: 'date', format: 'date', placeholder: 'Defaults to today' },
    { key: 'supplierCount', label: 'Suppliers', type: 'number', readOnly: true, default: 0 },
    { key: 'orderedTotal', label: 'Ordered', type: 'number', readOnly: true, format: 'currency', default: 0 },
    { key: 'committedTotal', label: 'Committed', type: 'number', readOnly: true, format: 'currency', default: 0, column: false },
    { key: 'openTotal', label: 'Open', type: 'number', readOnly: true, format: 'currency', default: 0 },
    { key: 'invoicedTotal', label: 'Invoiced', type: 'number', readOnly: true, format: 'currency', default: 0 },
    { key: 'paidTotal', label: 'Paid', type: 'number', readOnly: true, format: 'currency', default: 0 },
    { key: 'poCount', label: 'POs', type: 'number', readOnly: true, default: 0, column: false },
    { key: 'billCount', label: 'Bills', type: 'number', readOnly: true, default: 0, column: false },
    { key: 'receiptCount', label: 'Receipts', type: 'number', readOnly: true, default: 0, column: false },
    { key: 'rows', label: 'Supplier Breakdown (JSON)', type: 'textarea', readOnly: true, column: false },
    { key: 'byPeriod', label: 'Monthly Rollup (JSON)', type: 'textarea', readOnly: true, column: false },
    { key: 'note', label: 'Note', type: 'textarea', readOnly: true, column: false },
    { key: 'generatedAt', label: 'Generated At', type: 'text', readOnly: true, column: false },
  ],
};

function str(v: unknown): string {
  return v === null || v === undefined ? '' : String(v);
}

/** The injected source stores — lazy getters (see the header for the cycle rationale). */
export interface SpendAnalyticsSources {
  purchaseOrders: () => EnterpriseRecordStore;
  goodsReceipts: () => EnterpriseRecordStore;
  vendorBills: () => EnterpriseRecordStore;
  vendorPayments: () => EnterpriseRecordStore;
  /** Optional: lets the note count registered-but-untransacted suppliers honestly. */
  suppliers?: () => EnterpriseRecordStore;
}

/** Build the Spend Analytics module (source stores injected, tenant-scoped). */
export function createSpendAnalyticsModule(
  storePath: string,
  sources: SpendAnalyticsSources,
): EnterpriseModule {
  const store = new EnterpriseRecordStore(storePath, SPEND_ANALYTICS_MODULE_ID, SPEND_ANALYTICS_KIND);
  return defineEnterpriseModule({
    descriptor: SPEND_ANALYTICS_DESCRIPTOR,
    store,
    hooks: {
      // Creating a register IS generating it; a generated register is immutable.
      validate: (input: EnterpriseRecordInput): EnterpriseRecordValidation => {
        const result = validateEnterpriseRecordInput(SPEND_ANALYTICS_DESCRIPTOR, input);
        if (!result.ok) return result;
        if (str(result.values.generatedAt)) {
          return {
            ok: false,
            errors: { _: 'Spend registers are immutable snapshots — generate a new register instead.' },
            values: result.values,
          };
        }
        const asOfDate = str(result.values.asOfDate).trim() || new Date().toISOString().slice(0, 10);
        if (!Number.isFinite(Date.parse(asOfDate))) {
          return { ok: false, errors: { asOfDate: 'As-of must be a valid date (YYYY-MM-DD).' }, values: result.values };
        }
        const register = deriveSpendAnalytics(
          {
            orders: sources.purchaseOrders().list().map(purchaseOrderFromRecord),
            receipts: sources.goodsReceipts().list().map(goodsReceiptFromRecord),
            bills: sources.vendorBills().list().map(vendorBillFromRecord),
            payments: sources.vendorPayments().list().map(vendorPaymentFromRecord),
          },
          asOfDate,
        );
        const transacted = new Set(register.rows.map((r) => r.supplier));
        const untransacted = sources.suppliers
          ? sources.suppliers().list().filter((r) => !transacted.has(str(r.fields.name).trim())).length
          : 0;
        const ex = register.exclusions;
        const unattributed = ex.unattributedOrders + ex.unattributedReceipts + ex.unattributedBills + ex.unattributedPayments;
        const priorCount = store.list().filter((r) => str(r.fields.asOfDate) === asOfDate).length;
        result.values.asOfDate = asOfDate;
        result.values.reportNumber = `SA-${asOfDate}-${priorCount + 1}`;
        result.values.supplierCount = register.supplierCount;
        result.values.orderedTotal = register.totals.orderedValue;
        result.values.committedTotal = register.totals.committedValue;
        result.values.openTotal = register.totals.openValue;
        result.values.invoicedTotal = register.totals.invoicedValue;
        result.values.paidTotal = register.totals.paidValue;
        result.values.poCount = register.totals.poCount;
        result.values.billCount = register.totals.billCount;
        result.values.receiptCount = register.totals.receiptCount;
        result.values.rows = JSON.stringify(register.rows);
        result.values.byPeriod = JSON.stringify(register.byPeriod);
        result.values.note =
          register.supplierCount === 0
            ? 'no purchase orders, receipts, bills or payments recorded — the register is empty, not fabricated'
            : `lifecycle kept apart per the existing status sets: ordered = POs not draft/cancelled (procurement spend), ` +
              `committed = COMMITTED_PO_STATUSES, open = OPEN_PO_STATUSES; invoiced = approved+paid bills; paid = cleared payments` +
              (unattributed > 0 ? `; ${unattributed} record(s) carry no supplier name — grouped under (unattributed)` : '') +
              (ex.undatedOrders > 0 ? `; ${ex.undatedOrders} ordered PO(s) undated — in totals, absent from the monthly rollup` : '') +
              (untransacted > 0 ? `; ${untransacted} registered supplier(s) have no transactions — no row fabricated` : '');
        result.values.generatedAt = new Date().toISOString();
        return result;
      },
      summarize: async (record): Promise<EnterpriseRecordSummary> => {
        const f = record.fields;
        const open = Number(f.openTotal ?? 0);
        return {
          moduleId: SPEND_ANALYTICS_MODULE_ID,
          recordId: record.id,
          headline: `${str(f.reportNumber)} · ordered ${Number(f.orderedTotal ?? 0).toLocaleString('en-US')} across ${Number(f.supplierCount ?? 0)} supplier(s)`,
          summary: `As of ${str(f.asOfDate)}: ordered ${Number(f.orderedTotal ?? 0).toLocaleString('en-US')}, open ${open.toLocaleString('en-US')}, invoiced ${Number(f.invoicedTotal ?? 0).toLocaleString('en-US')}, paid ${Number(f.paidTotal ?? 0).toLocaleString('en-US')} over ${Number(f.poCount ?? 0)} PO(s) / ${Number(f.billCount ?? 0)} bill(s).`,
          risk: open > 0 ? 'medium' : 'low',
          riskReason: open > 0 ? 'Open purchase orders are undelivered commitments — exposure until received.' : 'No open purchase-order exposure.',
          executiveExplanation:
            'Each lifecycle state keeps its own number — ordered, committed, open, received, invoiced, paid are the existing status sets, never blended. Registers are immutable history; every source store is only read.',
          grounded: false,
          model: 'none',
        };
      },
    },
  });
}
