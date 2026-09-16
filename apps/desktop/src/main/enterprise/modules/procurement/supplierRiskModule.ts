/**
 * Procurement → Supplier Risk — governed, immutable, point-in-time risk registers on the
 * Enterprise Module Framework (the Supplier Performance pattern): CREATE = generate. The
 * validate hook walks the injected supplier, purchase-order, goods-receipt, vendor-bill and
 * vendor-contract stores through the pure `deriveSupplierRiskRegister` — one indicator row
 * per registered supplier whose score is the EXISTING `calculateVendorRisk` fed that
 * supplier's own delivery evidence, high-risk at the repo's existing >=60 cutoff, open-bill
 * exposure per the deriveApAging open-payable rule, and contract standing via
 * contractWindowState. Every row prints its reasons; no new weight or threshold exists.
 *
 * MODULE ID: a LOCAL const (the `multiLineReceiptModule` precedent) — frozen shared types
 * are untouched. Source stores are injected as GETTERS (see spendAnalyticsModule for the
 * finance-instance cycle rationale). Registers are IMMUTABLE (`generatedAt` refuses edits);
 * sources are only READ. Electron-free; unit-tests without the app runtime.
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
  supplierFromRecord,
  validateEnterpriseRecordInput,
  vendorBillFromRecord,
  vendorPaymentFromRecord,
} from '@neuropause/shared';
import {
  EnterpriseRecordStore,
  defineEnterpriseModule,
  type EnterpriseModule,
} from '../../framework';
import {
  HIGH_RISK_SCORE_CUTOFF,
  deriveSupplierRiskRegister,
  type ContractInput,
} from './procurementIntelligenceModel';

/** Local module identity — see the header (multiLineReceipt precedent; frozen shared untouched). */
export const SUPPLIER_RISK_MODULE_ID = 'procurement-supplier-risk';
export const SUPPLIER_RISK_KIND = 'supplierRiskRegister';

export const SUPPLIER_RISK_DESCRIPTOR: EnterpriseModuleDescriptor = {
  id: SUPPLIER_RISK_MODULE_ID,
  title: 'Supplier Risk',
  singular: 'Risk Register',
  plural: 'Risk Registers',
  icon: 'gauge',
  description:
    'Immutable supplier-risk registers — the existing vendor-risk formula over real delivery evidence, open-bill exposure, and contract standing, reasons printed.',
  group: 'Procurement',
  titleField: 'reportNumber',
  permissions: { read: 'procurement:read', write: 'procurement:manage' },
  fields: [
    { key: 'reportNumber', label: 'Register #', type: 'text', readOnly: true },
    { key: 'asOfDate', label: 'As Of', type: 'date', format: 'date', placeholder: 'Defaults to today' },
    { key: 'supplierCount', label: 'Suppliers', type: 'number', readOnly: true, default: 0 },
    { key: 'highRiskCount', label: 'High Risk', type: 'number', readOnly: true, default: 0 },
    { key: 'expiringSoonCount', label: 'Contracts Expiring', type: 'number', readOnly: true, default: 0 },
    { key: 'openBillExposure', label: 'Open Payables', type: 'number', readOnly: true, format: 'currency', default: 0 },
    { key: 'unregisteredCount', label: 'Unregistered', type: 'number', readOnly: true, default: 0, column: false },
    { key: 'rows', label: 'Risk Indicators (JSON)', type: 'textarea', readOnly: true, column: false },
    { key: 'note', label: 'Note', type: 'textarea', readOnly: true, column: false },
    { key: 'generatedAt', label: 'Generated At', type: 'text', readOnly: true, column: false },
  ],
};

function str(v: unknown): string {
  return v === null || v === undefined ? '' : String(v);
}
function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/** The injected source stores — lazy getters (see spendAnalyticsModule for the rationale). */
export interface SupplierRiskSources {
  suppliers: () => EnterpriseRecordStore;
  purchaseOrders: () => EnterpriseRecordStore;
  goodsReceipts: () => EnterpriseRecordStore;
  vendorBills: () => EnterpriseRecordStore;
  vendorContracts: () => EnterpriseRecordStore;
  /** Optional: payments let the underlying spend join compute paid values for shares. */
  vendorPayments?: () => EnterpriseRecordStore;
}

/** Build the Supplier Risk module (source stores injected, tenant-scoped). */
export function createSupplierRiskModule(
  storePath: string,
  sources: SupplierRiskSources,
): EnterpriseModule {
  const store = new EnterpriseRecordStore(storePath, SUPPLIER_RISK_MODULE_ID, SUPPLIER_RISK_KIND);
  return defineEnterpriseModule({
    descriptor: SUPPLIER_RISK_DESCRIPTOR,
    store,
    hooks: {
      // Creating a register IS generating it; a generated register is immutable.
      validate: (input: EnterpriseRecordInput): EnterpriseRecordValidation => {
        const result = validateEnterpriseRecordInput(SUPPLIER_RISK_DESCRIPTOR, input);
        if (!result.ok) return result;
        if (str(result.values.generatedAt)) {
          return {
            ok: false,
            errors: { _: 'Risk registers are immutable snapshots — generate a new register instead.' },
            values: result.values,
          };
        }
        const asOfDate = str(result.values.asOfDate).trim() || new Date().toISOString().slice(0, 10);
        if (!Number.isFinite(Date.parse(asOfDate))) {
          return { ok: false, errors: { asOfDate: 'As-of must be a valid date (YYYY-MM-DD).' }, values: result.values };
        }
        const contracts: ContractInput[] = sources.vendorContracts().list().map((r) => ({
          contractNumber: str(r.fields.contractNumber) || r.id,
          supplierName: str(r.fields.supplierName),
          recordStatus: str(r.fields.status),
          startDate: str(r.fields.startDate),
          endDate: str(r.fields.endDate),
          renewalNoticeDays: num(r.fields.renewalNoticeDays),
        }));
        const register = deriveSupplierRiskRegister(
          {
            suppliers: sources.suppliers().list().map(supplierFromRecord),
            orders: sources.purchaseOrders().list().map(purchaseOrderFromRecord),
            receipts: sources.goodsReceipts().list().map(goodsReceiptFromRecord),
            bills: sources.vendorBills().list().map(vendorBillFromRecord),
            payments: sources.vendorPayments ? sources.vendorPayments().list().map(vendorPaymentFromRecord) : [],
            contracts,
          },
          asOfDate,
        );
        const priorCount = store.list().filter((r) => str(r.fields.asOfDate) === asOfDate).length;
        result.values.asOfDate = asOfDate;
        result.values.reportNumber = `SR-${asOfDate}-${priorCount + 1}`;
        result.values.supplierCount = register.supplierCount;
        result.values.highRiskCount = register.highRiskCount;
        result.values.expiringSoonCount = register.expiringSoonCount;
        result.values.openBillExposure = register.openBillExposureTotal;
        result.values.unregisteredCount = register.unregisteredSuppliers.length;
        result.values.rows = JSON.stringify(register.rows);
        result.values.note =
          register.supplierCount === 0
            ? 'no registered suppliers — the register is empty, not fabricated' +
              (register.unregisteredSuppliers.length > 0
                ? `; ${register.unregisteredSuppliers.length} name(s) appear only in transactions (no master record) and cannot be scored: ${register.unregisteredSuppliers.join(', ')}`
                : '')
            : `score = calculateVendorRisk (existing formula); high risk at the repo cutoff >= ${HIGH_RISK_SCORE_CUTOFF} (procurement.ts:405)` +
              (register.unregisteredSuppliers.length > 0
                ? `; ${register.unregisteredSuppliers.length} transacted name(s) have no supplier master and are named, not scored: ${register.unregisteredSuppliers.join(', ')}`
                : '');
        result.values.generatedAt = new Date().toISOString();
        return result;
      },
      summarize: async (record): Promise<EnterpriseRecordSummary> => {
        const f = record.fields;
        const highRisk = Number(f.highRiskCount ?? 0);
        return {
          moduleId: SUPPLIER_RISK_MODULE_ID,
          recordId: record.id,
          headline: `${str(f.reportNumber)} · ${highRisk} high-risk of ${Number(f.supplierCount ?? 0)} supplier(s)`,
          summary: `As of ${str(f.asOfDate)}: ${highRisk} high-risk supplier(s), ${Number(f.expiringSoonCount ?? 0)} contract(s) inside their renewal notice, ${Number(f.openBillExposure ?? 0).toLocaleString('en-US')} open payables. ${str(f.note)}.`,
          risk: highRisk > 0 ? 'medium' : 'low',
          riskReason:
            highRisk > 0
              ? 'High-risk suppliers per the existing vendor-risk formula — review sourcing before the next award.'
              : 'No supplier crosses the existing high-risk cutoff.',
          executiveExplanation:
            'Risk rows reuse the shipped vendor-risk formula over each supplier’s own recorded deliveries, payables and contracts — reasons printed per row, no invented weights. Registers are immutable history; sources are only read.',
          grounded: false,
          model: 'none',
        };
      },
    },
  });
}
