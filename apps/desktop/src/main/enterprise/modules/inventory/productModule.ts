/**
 * Inventory → Products — the product master, built on the Enterprise Module
 * Framework like every other module. Master fields are user-owned; the stock
 * figures (current / reserved / available / value) are READ-ONLY and DERIVED —
 * they are materialized onto the product by the Stock Movements reconciler from
 * the immutable movement journal, never edited directly. The `summarize` hook
 * explains the deterministic stock health; the AI never computes it.
 *
 * Electron-free (store path + AI runner injected), so it unit-tests without the
 * app runtime.
 */
import type {
  EnterpriseModuleDescriptor,
  EnterpriseRecordSummary,
  Product,
  StockHealth,
} from '@neuropause/shared';
import {
  PRODUCTS_MODULE_ID,
  PRODUCT_KIND,
  calculateStockHealth,
  productFromRecord,
  productSummaryFallback,
} from '@neuropause/shared';
import {
  EnterpriseRecordStore,
  defineEnterpriseModule,
  type EnterpriseModule,
} from '../../framework';
import { REORDER_CHECK_ACTION, runReorderCheck } from './autoReorderSeam';

/** The declarative description of a product — drives store, CRUD, and the UI. */
export const PRODUCT_DESCRIPTOR: EnterpriseModuleDescriptor = {
  id: PRODUCTS_MODULE_ID,
  title: 'Products',
  singular: 'Product',
  plural: 'Products',
  icon: 'package',
  description: 'Product master with stock levels derived from the movement ledger.',
  group: 'Inventory',
  titleField: 'name',
  permissions: { read: 'inventory:read', write: 'inventory:manage' },
  actions: [{ key: REORDER_CHECK_ACTION, label: 'Check Reorder', icon: 'refresh' }],
  fields: [
    { key: 'sku', label: 'SKU', type: 'text', required: true, placeholder: 'SKU-0001' },
    { key: 'name', label: 'Name', type: 'text', required: true, placeholder: 'Widget' },
    { key: 'category', label: 'Category', type: 'text' },
    { key: 'barcode', label: 'Barcode', type: 'text', column: false },
    { key: 'unit', label: 'Unit', type: 'text', column: false, default: 'unit' },
    { key: 'currentStock', label: 'On Hand', type: 'number', default: 0, readOnly: true },
    { key: 'reservedStock', label: 'Reserved', type: 'number', default: 0, readOnly: true },
    { key: 'availableStock', label: 'Available', type: 'number', default: 0, readOnly: true },
    { key: 'stockValue', label: 'Stock Value', type: 'number', default: 0, format: 'currency', readOnly: true },
    { key: 'purchaseCost', label: 'Purchase Cost', type: 'number', min: 0, format: 'currency', column: false },
    { key: 'standardCost', label: 'Standard Cost', type: 'number', min: 0, format: 'currency', column: false },
    { key: 'sellingPrice', label: 'Selling Price', type: 'number', min: 0, format: 'currency', column: false },
    { key: 'reorderLevel', label: 'Reorder Level', type: 'number', min: 0, column: false },
    { key: 'safetyStock', label: 'Safety Stock', type: 'number', min: 0, column: false },
    { key: 'maximumStock', label: 'Maximum Stock', type: 'number', min: 0, column: false },
    {
      // FW-6 (ADDITIVE): opt this product into automatic replenishment — each
      // ledger reconciliation at/below the reorder level drafts a purchase
      // request. Off (the default) keeps pre-FW-6 behavior exactly.
      key: 'autoReorder',
      label: 'Auto Reorder',
      type: 'select',
      default: 'off',
      column: false,
      options: [
        { value: 'off', label: 'Off', tone: 'neutral' },
        { value: 'on', label: 'On', tone: 'green' },
      ],
    },
    {
      key: 'status',
      label: 'Status',
      type: 'select',
      required: true,
      default: 'active',
      badge: true,
      filterable: true,
      options: [
        { value: 'active', label: 'Active', tone: 'green' },
        { value: 'inactive', label: 'Inactive', tone: 'orange' },
        { value: 'discontinued', label: 'Discontinued', tone: 'neutral' },
      ],
    },
  ],
};

/** The AI narrative half of a summary; the stock-health band stays deterministic. */
export interface ProductAiNarrative {
  summary: string;
  executiveExplanation: string;
  grounded: boolean;
  model: string;
}

export type ProductAiRunner = (product: Product, health: StockHealth) => Promise<ProductAiNarrative | null>;

/** Build the Products module. The AI runner is optional (offline → fallback). */
export function createProductModule(storePath: string, aiRunner?: ProductAiRunner): EnterpriseModule {
  const store = new EnterpriseRecordStore(storePath, PRODUCTS_MODULE_ID, PRODUCT_KIND);
  return defineEnterpriseModule({
    descriptor: PRODUCT_DESCRIPTOR,
    store,
    hooks: {
      // FW-6: on-demand replenishment check — assesses the inventory position
      // and drafts a purchase request when at/below the reorder level.
      runAction: async (action, record, actionCtx) => {
        if (action === REORDER_CHECK_ACTION) return runReorderCheck(record, actionCtx, 'manual');
        return { ok: false, error: `Unknown action "${action}".` };
      },
      summarize: async (record): Promise<EnterpriseRecordSummary> => {
        const product = productFromRecord(record);
        const health = calculateStockHealth(product);
        const ai = aiRunner ? await aiRunner(product, health).catch(() => null) : null;
        const fallback = productSummaryFallback(product, health);
        return {
          moduleId: PRODUCTS_MODULE_ID,
          recordId: record.id,
          headline: `${product.name} · ${product.sku} · ${product.availableStock} available`,
          summary: ai?.summary?.trim() || fallback.summary,
          risk: health.level,
          riskReason: health.reason,
          executiveExplanation: ai?.executiveExplanation?.trim() || fallback.executiveExplanation,
          grounded: Boolean(ai?.grounded),
          model: ai?.model ?? 'none',
        };
      },
    },
  });
}
