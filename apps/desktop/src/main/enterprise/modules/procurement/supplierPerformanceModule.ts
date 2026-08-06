/**
 * Procurement → Supplier Performance — immutable scorecard registers on the
 * Enterprise Module Framework (W3.2), the Aging pattern applied to vendors:
 * CREATING a register generates it. The validate hook walks the injected
 * Goods Receipts store through the pure `deriveSupplierPerformance` engine —
 * on-time rate and quantity accuracy from the warehouse's own delivery
 * evidence, an explainable score with the formula printed in every row's
 * reasons. Suppliers registered but never measured are counted in the note,
 * never given fabricated rows. CRUD, RBAC (`procurement:read` /
 * `procurement:manage`), audit, timeline, search, offline persistence, and
 * the entire list/detail/form UI are all inherited.
 *
 * Registers are IMMUTABLE (the `generatedAt` marker refuses edits) and never
 * superseded — the sequence of registers is how vendor performance TRENDS,
 * and it is the evidence base the RFQ buyer reads before awarding.
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
  SUPPLIER_PERFORMANCE_MODULE_ID,
  SUPPLIER_PERFORMANCE_KIND,
  deriveSupplierPerformance,
  goodsReceiptFromRecord,
  validateEnterpriseRecordInput,
} from '@neuropause/shared';
import {
  EnterpriseRecordStore,
  defineEnterpriseModule,
  type EnterpriseModule,
} from '../../framework';

/** The declarative description of a scorecard register — drives store, CRUD, and the UI. */
export const SUPPLIER_PERFORMANCE_DESCRIPTOR: EnterpriseModuleDescriptor = {
  id: SUPPLIER_PERFORMANCE_MODULE_ID,
  title: 'Supplier Performance',
  singular: 'Scorecard Register',
  plural: 'Scorecard Registers',
  icon: 'gauge',
  description:
    'Immutable supplier scorecards from goods-receipt evidence — on-time rate, quantity accuracy, and an explainable score.',
  group: 'Procurement',
  titleField: 'reportNumber',
  permissions: { read: 'procurement:read', write: 'procurement:manage' },
  fields: [
    { key: 'reportNumber', label: 'Register #', type: 'text', readOnly: true },
    { key: 'asOfDate', label: 'As Of', type: 'date', format: 'date', placeholder: 'Defaults to today' },
    { key: 'supplierCount', label: 'Suppliers', type: 'number', readOnly: true, default: 0 },
    { key: 'reliable', label: 'Reliable', type: 'number', readOnly: true, default: 0 },
    { key: 'watch', label: 'Watch', type: 'number', readOnly: true, default: 0 },
    { key: 'atRisk', label: 'At Risk', type: 'number', readOnly: true, default: 0 },
    { key: 'overallOnTimePct', label: 'On-Time %', type: 'number', readOnly: true },
    { key: 'receiptCount', label: 'Receipts', type: 'number', readOnly: true, default: 0, column: false },
    { key: 'rows', label: 'Rows', type: 'textarea', readOnly: true, column: false },
    { key: 'note', label: 'Note', type: 'text', readOnly: true, column: false },
    { key: 'generatedAt', label: 'Generated At', type: 'text', readOnly: true, column: false },
  ],
};

function str(v: unknown): string {
  return v === null || v === undefined ? '' : String(v);
}

/**
 * Build the Supplier Performance module. Goods Receipts + Suppliers stores are
 * injected so generation reads real delivery evidence and can report the
 * registered-but-unmeasured count honestly.
 */
export function createSupplierPerformanceModule(
  storePath: string,
  goodsReceiptStore: EnterpriseRecordStore,
  supplierStore?: EnterpriseRecordStore,
): EnterpriseModule {
  const store = new EnterpriseRecordStore(
    storePath,
    SUPPLIER_PERFORMANCE_MODULE_ID,
    SUPPLIER_PERFORMANCE_KIND,
  );
  return defineEnterpriseModule({
    descriptor: SUPPLIER_PERFORMANCE_DESCRIPTOR,
    store,
    hooks: {
      // Creating a register IS generating it; a generated register is immutable.
      validate: (input: EnterpriseRecordInput): EnterpriseRecordValidation => {
        const result = validateEnterpriseRecordInput(SUPPLIER_PERFORMANCE_DESCRIPTOR, input);
        if (!result.ok) return result;
        if (str(result.values.generatedAt)) {
          return {
            ok: false,
            errors: { _: 'Scorecard registers are immutable snapshots — generate a new register instead.' },
            values: result.values,
          };
        }
        const asOfDate = str(result.values.asOfDate).trim() || new Date().toISOString().slice(0, 10);
        if (!Number.isFinite(Date.parse(asOfDate))) {
          return {
            ok: false,
            errors: { asOfDate: 'As-of must be a valid date (YYYY-MM-DD).' },
            values: result.values,
          };
        }
        const register = deriveSupplierPerformance(
          goodsReceiptStore.list().map(goodsReceiptFromRecord),
        );
        const measured = new Set(register.rows.map((r) => r.supplier));
        const unmeasured = supplierStore
          ? supplierStore.list().filter((r) => !measured.has(str(r.fields.name))).length
          : 0;
        const priorCount = store.list().filter((r) => str(r.fields.asOfDate) === asOfDate).length;
        result.values.asOfDate = asOfDate;
        result.values.reportNumber = `SP-${asOfDate}-${priorCount + 1}`;
        result.values.supplierCount = register.supplierCount;
        result.values.reliable = register.reliable;
        result.values.watch = register.watch;
        result.values.atRisk = register.atRisk;
        result.values.overallOnTimePct = register.overallOnTimePct ?? 0;
        result.values.receiptCount = register.receiptCount;
        result.values.rows = JSON.stringify(register.rows);
        result.values.note =
          register.receiptCount === 0
            ? 'no goods receipts recorded — the register is empty, not fabricated'
            : `evidence: ${register.receiptCount} goods receipt(s); score = 0.6 × on-time + 0.4 × quantity-accuracy fit` +
              (register.overallOnTimePct === null ? '; no receipt carries both dates, on-time unmeasured' : '') +
              (unmeasured > 0 ? `; ${unmeasured} registered supplier(s) have no receipts yet — unmeasured, not scored` : '');
        result.values.generatedAt = new Date().toISOString();
        return result;
      },
      summarize: async (record): Promise<EnterpriseRecordSummary> => {
        const f = record.fields;
        const atRisk = Number(f.atRisk ?? 0);
        return {
          moduleId: SUPPLIER_PERFORMANCE_MODULE_ID,
          recordId: record.id,
          headline: `${str(f.reportNumber)} · ${Number(f.supplierCount ?? 0)} supplier(s) · on-time ${Number(f.overallOnTimePct ?? 0)}%`,
          summary: `As of ${str(f.asOfDate)}: ${Number(f.reliable ?? 0)} reliable, ${Number(f.watch ?? 0)} watch, ${atRisk} at-risk across ${Number(f.receiptCount ?? 0)} receipt(s). ${str(f.note)}.`,
          risk: atRisk > 0 ? 'medium' : 'low',
          riskReason:
            atRisk > 0
              ? 'At-risk suppliers are delivery risk — source their next RFQ competitively.'
              : 'No at-risk suppliers on this register.',
          executiveExplanation:
            'Scorecards are immutable snapshots of warehouse-recorded delivery evidence — the register sequence is the vendor trend, and the buyer reads it before awarding an RFQ.',
          grounded: false,
          model: 'none',
        };
      },
    },
  });
}
