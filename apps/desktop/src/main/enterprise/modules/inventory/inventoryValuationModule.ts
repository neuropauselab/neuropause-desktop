/**
 * Inventory → Valuation — immutable standard-cost valuation registers on the
 * Enterprise Module Framework (W3.5), the Aging pattern applied to stock:
 * CREATING a register generates it. The validate hook walks the injected
 * Movements + Products stores through the pure `deriveInventoryValuation`
 * engine — every product@warehouse cell with stock on hand (quantities from
 * the event-sourced ledger, reused) valued at the product's standard cost.
 * CRUD, RBAC (`inventory:read` / `inventory:manage`), audit, timeline,
 * search, offline persistence, and the UI are all inherited.
 *
 * METHOD is chosen per register (W6-C1 completes the family):
 * - standard-cost — on-hand × the product's standard cost, per product@warehouse.
 * - fifo / weighted-average / moving-average — actual cost from the receipt
 *   history, per product (see the engine header for the stated granularity).
 * Cells/products without a captured cost are counted as unvalued/uncosted, not
 * hidden. Registers are IMMUTABLE and never superseded — the sequence is how
 * inventory value TRENDS between counts.
 *
 * Electron-free (store paths injected), so it unit-tests without the app runtime.
 */
import type {
  EnterpriseModuleDescriptor,
  EnterpriseRecordInput,
  EnterpriseRecordSummary,
  EnterpriseRecordValidation,
  CostValuationMethod,
} from '@neuropause/shared';
import {
  INVENTORY_VALUATION_MODULE_ID,
  INVENTORY_VALUATION_KIND,
  deriveCostValuation,
  deriveInventoryValuation,
  productFromRecord,
  movementFromRecord,
  validateEnterpriseRecordInput,
} from '@neuropause/shared';
import {
  EnterpriseRecordStore,
  defineEnterpriseModule,
  type EnterpriseModule,
} from '../../framework';

/** The declarative description of a valuation register — drives store, CRUD, and the UI. */
export const INVENTORY_VALUATION_DESCRIPTOR: EnterpriseModuleDescriptor = {
  id: INVENTORY_VALUATION_MODULE_ID,
  title: 'Inventory Valuation',
  singular: 'Valuation Register',
  plural: 'Valuation Registers',
  icon: 'coins',
  description:
    'Immutable stock valuations — ledger on-hand × standard cost per product and warehouse, unvalued cells counted honestly.',
  group: 'Inventory',
  titleField: 'reportNumber',
  permissions: { read: 'inventory:read', write: 'inventory:manage' },
  fields: [
    { key: 'reportNumber', label: 'Register #', type: 'text', readOnly: true },
    { key: 'asOfDate', label: 'As Of', type: 'date', format: 'date', placeholder: 'Defaults to today' },
    {
      key: 'method',
      label: 'Method',
      type: 'select',
      default: 'standard-cost',
      badge: true,
      filterable: true,
      options: [
        { value: 'standard-cost', label: 'Standard Cost', tone: 'blue' },
        { value: 'fifo', label: 'FIFO', tone: 'teal' },
        { value: 'weighted-average', label: 'Weighted Average', tone: 'purple' },
        { value: 'moving-average', label: 'Moving Average', tone: 'orange' },
      ],
    },
    { key: 'cellCount', label: 'Stock Cells', type: 'number', readOnly: true, default: 0 },
    { key: 'unvaluedCount', label: 'Unvalued', type: 'number', readOnly: true, default: 0 },
    { key: 'totalValue', label: 'Total Value', type: 'number', readOnly: true, format: 'currency', default: 0 },
    { key: 'rows', label: 'Rows', type: 'textarea', readOnly: true, column: false },
    { key: 'note', label: 'Note', type: 'text', readOnly: true, column: false },
    { key: 'generatedAt', label: 'Generated At', type: 'text', readOnly: true, column: false },
  ],
};

function str(v: unknown): string {
  return v === null || v === undefined ? '' : String(v);
}

/**
 * Build the Inventory Valuation module. Movements + Products stores are
 * injected so generation reads the real ledger and the real cost book.
 */
export function createInventoryValuationModule(
  storePath: string,
  movementStore: EnterpriseRecordStore,
  productStore: EnterpriseRecordStore,
): EnterpriseModule {
  const store = new EnterpriseRecordStore(
    storePath,
    INVENTORY_VALUATION_MODULE_ID,
    INVENTORY_VALUATION_KIND,
  );
  return defineEnterpriseModule({
    descriptor: INVENTORY_VALUATION_DESCRIPTOR,
    store,
    hooks: {
      // Creating a register IS generating it; a generated register is immutable.
      validate: (input: EnterpriseRecordInput): EnterpriseRecordValidation => {
        const result = validateEnterpriseRecordInput(INVENTORY_VALUATION_DESCRIPTOR, input);
        if (!result.ok) return result;
        if (str(result.values.generatedAt)) {
          return {
            ok: false,
            errors: { _: 'Valuation registers are immutable snapshots — generate a new register instead.' },
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
        const movements = movementStore.list().map(movementFromRecord);
        const priorCount = store.list().filter((r) => str(r.fields.asOfDate) === asOfDate).length;
        result.values.asOfDate = asOfDate;
        result.values.reportNumber = `IV-${asOfDate}-${priorCount + 1}`;
        const method = str(result.values.method) || 'standard-cost';
        if (method === 'fifo' || method === 'weighted-average' || method === 'moving-average') {
          const cv = deriveCostValuation(movements, method as CostValuationMethod);
          result.values.method = method;
          result.values.cellCount = cv.cellCount;
          result.values.unvaluedCount = cv.uncostedCount;
          result.values.totalValue = cv.totalValue;
          result.values.rows = JSON.stringify(cv.rows);
          result.values.note =
            cv.cellCount === 0
              ? 'no stock on hand in the ledger — the register is empty, not fabricated'
              : `method: ${method} actual cost from receipt history, per product (transfers are net-zero to product cost; per-warehouse layering is a stated future refinement)` +
                (cv.uncostedCount > 0 ? `; ${cv.uncostedCount} product(s) have uncosted remaining stock — counted here` : '');
        } else {
          const valuation = deriveInventoryValuation(movements, productStore.list().map(productFromRecord));
          result.values.method = 'standard-cost';
          result.values.cellCount = valuation.cellCount;
          result.values.unvaluedCount = valuation.unvaluedCount;
          result.values.totalValue = valuation.totalValue;
          result.values.rows = JSON.stringify(valuation.rows);
          result.values.note =
            valuation.cellCount === 0
              ? 'no stock on hand in the ledger — the register is empty, not fabricated'
              : `method: on-hand × standard cost per product@warehouse; FIFO / weighted-average / moving-average are available as method options` +
                (valuation.unvaluedCount > 0
                  ? `; ${valuation.unvaluedCount} cell(s) have no standard cost — valued 0, counted here`
                  : '');
        }
        result.values.generatedAt = new Date().toISOString();
        return result;
      },
      summarize: async (record): Promise<EnterpriseRecordSummary> => {
        const f = record.fields;
        const unvalued = Number(f.unvaluedCount ?? 0);
        return {
          moduleId: INVENTORY_VALUATION_MODULE_ID,
          recordId: record.id,
          headline: `${str(f.reportNumber)} · ${str(f.method)} · ${Number(f.totalValue ?? 0).toLocaleString('en-US')} across ${Number(f.cellCount ?? 0)} cell(s)`,
          summary: `As of ${str(f.asOfDate)}: ${Number(f.totalValue ?? 0).toLocaleString('en-US')} of stock (${str(f.method)}). ${str(f.note)}.`,
          risk: unvalued > 0 ? 'medium' : 'low',
          riskReason:
            unvalued > 0
              ? 'Uncosted stock understates the register — set standard costs, or capture receipt costs for the actual-cost methods.'
              : 'Every valued line carries a cost under the chosen method.',
          executiveExplanation:
            'Valuation registers are immutable snapshots of ledger quantities costed by the chosen method (standard cost, or FIFO/weighted-average/moving-average from receipt history) — the register sequence is the value trend between counts.',
          grounded: false,
          model: 'none',
        };
      },
    },
  });
}
