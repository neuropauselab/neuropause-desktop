/**
 * Manufacturing → Production Costing — the cost roll-up for a production order
 * (material + labor + machine + overhead). A `validate` hook stamps the deterministic
 * `totalCost` and `variance` (actual − standard); the AI explains the variance but
 * never computes it. No stock effect.
 */
import type {
  EnterpriseModuleDescriptor,
  EnterpriseRecordInput,
  EnterpriseRecordSummary,
  ProductionCosting,
} from '@neuropause/shared';
import {
  PRODUCTION_COSTINGS_MODULE_ID,
  PRODUCTION_COSTING_KIND,
  calculateManufacturingCost,
  calculateProductionVariance,
  productionCostingFromRecord,
  productionCostingSummaryFallback,
  validateEnterpriseRecordInput,
} from '@neuropause/shared';
import { EnterpriseRecordStore, defineEnterpriseModule, type EnterpriseModule } from '../../framework';

const num = (v: unknown): number => (typeof v === 'number' ? v : Number(String(v ?? '')) || 0);

export const PRODUCTION_COSTING_DESCRIPTOR: EnterpriseModuleDescriptor = {
  id: PRODUCTION_COSTINGS_MODULE_ID,
  title: 'Production Costing',
  singular: 'Costing',
  plural: 'Costings',
  icon: 'dollar',
  description: 'Roll up material, labor, machine, and overhead into a total + variance.',
  group: 'Manufacturing',
  titleField: 'costNumber',
  permissions: { read: 'manufacturing:read', write: 'manufacturing:manage' },
  fields: [
    { key: 'costNumber', label: 'Cost #', type: 'text', required: true, placeholder: 'PC-0001' },
    { key: 'productionOrder', label: 'Production Order', type: 'text', placeholder: 'MO-0001' },
    { key: 'materialCost', label: 'Material Cost', type: 'number', min: 0, format: 'currency' },
    { key: 'laborCost', label: 'Labor Cost', type: 'number', min: 0, format: 'currency' },
    { key: 'machineCost', label: 'Machine Cost', type: 'number', min: 0, format: 'currency' },
    { key: 'overheadCost', label: 'Overhead', type: 'number', min: 0, format: 'currency', column: false },
    { key: 'totalCost', label: 'Total Cost', type: 'number', format: 'currency', readOnly: true },
    { key: 'standardCost', label: 'Standard Cost', type: 'number', min: 0, format: 'currency', column: false },
    { key: 'variance', label: 'Variance', type: 'number', format: 'currency', readOnly: true },
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
        { value: 'finalized', label: 'Finalized', tone: 'green' },
      ],
    },
  ],
};

export interface CostingAiNarrative {
  summary: string;
  executiveExplanation: string;
  grounded: boolean;
  model: string;
}
export type CostingAiRunner = (costing: ProductionCosting) => Promise<CostingAiNarrative | null>;

export function createCostingModule(storePath: string, aiRunner?: CostingAiRunner): EnterpriseModule {
  const store = new EnterpriseRecordStore(storePath, PRODUCTION_COSTINGS_MODULE_ID, PRODUCTION_COSTING_KIND);
  return defineEnterpriseModule({
    descriptor: PRODUCTION_COSTING_DESCRIPTOR,
    store,
    hooks: {
      validate: (input: EnterpriseRecordInput) => {
        const result = validateEnterpriseRecordInput(PRODUCTION_COSTING_DESCRIPTOR, input);
        if (result.ok) {
          const total = calculateManufacturingCost({
            materialCost: num(result.values.materialCost),
            laborCost: num(result.values.laborCost),
            machineCost: num(result.values.machineCost),
            overheadCost: num(result.values.overheadCost),
          });
          result.values.totalCost = total;
          result.values.variance = calculateProductionVariance(num(result.values.standardCost), total);
        }
        return result;
      },
      summarize: async (record): Promise<EnterpriseRecordSummary> => {
        const costing = productionCostingFromRecord(record);
        const ai = aiRunner ? await aiRunner(costing).catch(() => null) : null;
        const fallback = productionCostingSummaryFallback(costing);
        const total = calculateManufacturingCost(costing);
        const variance = calculateProductionVariance(costing.standardCost, total);
        return {
          moduleId: PRODUCTION_COSTINGS_MODULE_ID,
          recordId: record.id,
          headline: `${costing.costNumber} · ${Math.round(total).toLocaleString()} · variance ${variance >= 0 ? '+' : ''}${Math.round(variance).toLocaleString()}`,
          summary: ai?.summary?.trim() || fallback.summary,
          risk: variance > 0 && costing.standardCost > 0 ? 'medium' : 'low',
          riskReason: variance > 0 ? 'Over standard cost.' : 'At or under standard cost.',
          executiveExplanation: ai?.executiveExplanation?.trim() || fallback.executiveExplanation,
          grounded: Boolean(ai?.grounded),
          model: ai?.model ?? 'none',
        };
      },
    },
  });
}
