/**
 * Inventory → Stock Movements — the IMMUTABLE stock ledger and the single source
 * of truth for inventory. Every quantity change is a movement; a product's stock
 * is never edited directly. On each movement the `onChange` reconciler re-derives
 * the affected product's current / reserved / available stock + value from the
 * FULL movement history and materializes it onto the product record (reusing the
 * same awaited cross-module `onChange` seam as Payments → Invoice). Corrections are
 * made by posting a compensating movement — history is never rewritten. The
 * `summarize` hook explains the deterministic stock effect; the AI never computes it.
 *
 * Electron-free (store paths + AI runner injected), so it unit-tests without the
 * app runtime.
 */
import type {
  EnterpriseModuleDescriptor,
  EnterpriseRecordSummary,
  StockMovement,
} from '@neuropause/shared';
import {
  PRODUCTS_MODULE_ID,
  STOCK_MOVEMENTS_MODULE_ID,
  STOCK_MOVEMENT_KIND,
  movementFromRecord,
  movementSummaryFallback,
  movementTypeLabel,
  productComputedStock,
  productFromRecord,
  validateEnterpriseRecordInput,
} from '@neuropause/shared';
import { postMovementToGl } from './inventoryGlBridge';
import {
  EnterpriseRecordStore,
  defineEnterpriseModule,
  type EnterpriseModule,
  type EnterpriseModuleActionContext,
} from '../../framework';
import { runReorderCheck } from './autoReorderSeam';

/** The declarative description of a stock movement — drives store, CRUD, and the UI. */
export const STOCK_MOVEMENT_DESCRIPTOR: EnterpriseModuleDescriptor = {
  id: STOCK_MOVEMENTS_MODULE_ID,
  title: 'Stock Movements',
  singular: 'Stock Movement',
  plural: 'Stock Movements',
  icon: 'list',
  description: 'The immutable stock ledger — every inventory change is a movement.',
  group: 'Inventory',
  titleField: 'movementNumber',
  permissions: { read: 'inventory:read', write: 'inventory:manage' },
  fields: [
    { key: 'movementNumber', label: 'Movement #', type: 'text', required: true, placeholder: 'MV-0001' },
    {
      key: 'type',
      label: 'Type',
      type: 'select',
      required: true,
      default: 'receive',
      badge: true,
      filterable: true,
      options: [
        { value: 'receive', label: 'Receive', tone: 'green' },
        { value: 'issue', label: 'Issue', tone: 'orange' },
        { value: 'transfer', label: 'Transfer', tone: 'blue' },
        { value: 'adjustment', label: 'Adjustment', tone: 'purple' },
        { value: 'production_consumption', label: 'Production Consumption', tone: 'orange' },
        { value: 'production_output', label: 'Production Output', tone: 'green' },
        { value: 'reservation', label: 'Reservation', tone: 'teal' },
        { value: 'reservation_release', label: 'Reservation Release', tone: 'teal' },
        { value: 'return', label: 'Return', tone: 'green' },
      ],
    },
    { key: 'product', label: 'Product (SKU)', type: 'text', required: true, placeholder: 'SKU-0001' },
    { key: 'warehouse', label: 'Warehouse', type: 'text', required: true, placeholder: 'WH-01' },
    { key: 'fromWarehouse', label: 'From Warehouse', type: 'text', column: false },
    { key: 'quantity', label: 'Quantity', type: 'number', required: true },
    { key: 'unitCost', label: 'Unit Cost', type: 'number', min: 0, format: 'currency', column: false },
    {
      key: 'status',
      label: 'Status',
      type: 'select',
      required: true,
      default: 'posted',
      badge: true,
      filterable: true,
      options: [
        { value: 'posted', label: 'Posted', tone: 'green' },
        { value: 'void', label: 'Void', tone: 'neutral' },
      ],
    },
    { key: 'reason', label: 'Reason', type: 'text', column: false },
    { key: 'referenceModule', label: 'Ref Module', type: 'text', column: false, readOnly: true },
    { key: 'referenceRecord', label: 'Ref Record', type: 'text', column: false, readOnly: true },
  ],
};

/** The AI narrative half of a summary; the stock effect stays deterministic. */
export interface MovementAiNarrative {
  summary: string;
  executiveExplanation: string;
  grounded: boolean;
  model: string;
}

export type MovementAiRunner = (movement: StockMovement) => Promise<MovementAiNarrative | null>;

function str(v: unknown): string {
  return v === null || v === undefined ? '' : String(v);
}

/**
 * Build the Stock Movements module. The reconciler resolves the Products module
 * from the action context at runtime (no construction-order coupling). The AI
 * runner is optional (offline → deterministic fallback).
 */
export function createStockMovementModule(
  storePath: string,
  aiRunner?: MovementAiRunner,
): EnterpriseModule {
  const store = new EnterpriseRecordStore(storePath, STOCK_MOVEMENTS_MODULE_ID, STOCK_MOVEMENT_KIND);

  /** Re-derive the referenced product's stock from the full ledger + persist it. */
  async function reconcileProduct(productRef: string, ctx: EnterpriseModuleActionContext): Promise<void> {
    if (!productRef) return;
    const productModule = ctx.moduleFor(PRODUCTS_MODULE_ID);
    if (!productModule) return;
    await productModule.store.load();
    // Resolve the product by SKU or record id.
    const productRecord =
      productModule.store.list().find((r) => str(r.fields.sku) === productRef) ??
      productModule.store.get(productRef);
    if (!productRecord || productRecord.status === 'deleted') return;
    const product = productFromRecord(productRecord);
    const movements = store
      .list()
      .map(movementFromRecord)
      .filter((m) => m.product === product.sku || m.product === productRecord.id);
    const computed = productComputedStock(product, movements);
    const updated = productModule.store.update(productRecord.id, {
      fields: { ...computed },
      actor: ctx.actor(),
      now: ctx.now(),
    });
    if (updated) ctx.emit(productModule, 'updated', updated);
  }

  return defineEnterpriseModule({
    descriptor: STOCK_MOVEMENT_DESCRIPTOR,
    store,
    hooks: {
      // S55 — the module's own contract ('the IMMUTABLE stock ledger — corrections by
      // compensating movement, history never rewritten') had no enforcement: editing a
      // POSTED movement's quantity re-derived on-hand stock while the GL side stayed at
      // the original amount (the bridge is idempotent per movement id with no adjustment
      // machinery) — silent stock-vs-books divergence. Enforcing a declared contract is
      // not invented policy. The ONE coherent correction path stays open: posted → void
      // with every economic field unchanged (void reverses the GL); void is terminal.
      // Creates (no recordId) and status-less importer rows are untouched.
      validate: (input) => {
        const result = validateEnterpriseRecordInput(STOCK_MOVEMENT_DESCRIPTOR, input);
        if (result.ok && input.recordId) {
          const prior = store.get(input.recordId);
          const priorStatus = String(prior?.fields.status ?? '');
          if (prior && priorStatus === 'posted') {
            for (const key of ['movementNumber', 'type', 'product', 'warehouse', 'fromWarehouse', 'quantity', 'unitCost'] as const) {
              if (String(result.values[key] ?? '') !== String(prior.fields[key] ?? '')) {
                return {
                  ok: false,
                  values: result.values,
                  errors: { [key]: 'The stock ledger is immutable — correct a posted movement with a compensating movement, never by rewriting it.' },
                };
              }
            }
            const next = String(result.values.status ?? '');
            if (next !== 'posted' && next !== 'void') {
              return {
                ok: false,
                values: result.values,
                errors: { status: 'A posted movement can only be voided (which reverses its ledger effect).' },
              };
            }
          }
          if (prior && priorStatus === 'void' && String(result.values.status ?? '') !== 'void') {
            return {
              ok: false,
              values: result.values,
              errors: { status: 'A voided movement is terminal — its reversal is already booked. Post a new movement instead.' },
            };
          }
        }
        return result;
      },
      // Source-of-truth reconciliation: every movement re-derives the product's
      // materialized stock from the full ledger (create, edit, or void).
      onChange: async (event, ctx) => {
        await reconcileProduct(str(event.record.fields.product), ctx);
        // FW-6: after the ledger reconciles, a product opted into auto-reorder
        // (`autoReorder: on`) that sits at/below its reorder level drafts its
        // own purchase request (idempotent — the draft counts as open supply).
        // Replenishment is ADVISORY: a failure here must never unwind the
        // ledger write above, so it is contained rather than propagated.
        try {
          const ref = str(event.record.fields.product);
          const productModule = ctx.moduleFor(PRODUCTS_MODULE_ID);
          const productRecord =
            productModule?.store.list().find((r) => str(r.fields.sku) === ref) ??
            productModule?.store.get(ref) ??
            null;
          if (productRecord && productRecord.status !== 'deleted' && str(productRecord.fields.autoReorder) === 'on') {
            await runReorderCheck(productRecord, ctx, 'movement');
          }
        } catch {
          // Advisory only — the movement and reconciliation above already stand.
        }
        // ERP seam #1: a valued movement posts its balanced entry into the GL
        // (Dr/Cr from the movement's own qty × unit cost), idempotent per
        // movement. ADVISORY like the reorder above — a GL failure (or the GL
        // module simply not being wired) must never unwind the ledger write, so
        // it is contained here rather than propagated.
        try {
          await postMovementToGl(movementFromRecord(event.record), event.record.id, ctx);
        } catch {
          // Advisory only — the physical movement + reconcile already stand; the
          // GL entry is idempotent, so a later re-run can still post it.
        }
      },
      summarize: async (record): Promise<EnterpriseRecordSummary> => {
        const movement = movementFromRecord(record);
        const ai = aiRunner ? await aiRunner(movement).catch(() => null) : null;
        const fallback = movementSummaryFallback(movement);
        return {
          moduleId: STOCK_MOVEMENTS_MODULE_ID,
          recordId: record.id,
          headline: `${movement.movementNumber} · ${movementTypeLabel(movement.type)} · ${movement.product} · ${movement.quantity}`,
          summary: ai?.summary?.trim() || fallback.summary,
          risk: movement.status === 'void' ? 'low' : 'low',
          riskReason: movement.status === 'void' ? 'Void movement.' : 'Posted movement.',
          executiveExplanation: ai?.executiveExplanation?.trim() || fallback.executiveExplanation,
          grounded: Boolean(ai?.grounded),
          model: ai?.model ?? 'none',
        };
      },
    },
  });
}
