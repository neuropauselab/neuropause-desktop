/**
 * Manufacturing → Production Orders — the production engine. The lifecycle is fully
 * ledgered against Inventory (the single source of truth):
 *   plan      → draft → planned
 *   allocate  → reserve every BOM component at the warehouse (reservation movements)
 *   start     → consume every component (production_consumption) + release its reservation
 *   complete  → yield the finished product (production_output)
 *   cancel    → release any held reservations
 * Component quantities come from the referenced BOM (waste-scaled); the finished
 * quantity is the actual (or planned × yield%). Nothing edits stock directly. The
 * `summarize` hook explains the order; the AI never computes a quantity.
 */
import type {
  BillOfMaterials,
  EnterpriseEntity,
  EnterpriseModuleDescriptor,
  EnterpriseRecordSummary,
  ProductionOrder,
} from '@neuropause/shared';
import {
  BOM_MODULE_ID,
  PRODUCTION_ORDERS_MODULE_ID,
  PRODUCTION_ORDER_KIND,
  bomFromRecord,
  componentConsumption,
  productionOrderFromRecord,
  productionOrderSummaryFallback,
} from '@neuropause/shared';
import {
  EnterpriseRecordStore,
  defineEnterpriseModule,
  type EnterpriseModule,
  type EnterpriseModuleActionContext,
} from '../../framework';
import {
  postConsumption,
  postOutput,
  postReservation,
  postReservationRelease,
} from './manufacturingMovements';
import { COMMIT_SCHEDULE_ACTION, commitScheduleForOrder } from './scheduleCommit';

export const PLAN_ACTION = 'plan';
export const ALLOCATE_ACTION = 'allocate';
export const START_ACTION = 'start';
export const COMPLETE_ACTION = 'complete';
export const CANCEL_ACTION = 'cancel';

const str = (v: unknown): string => (v === null || v === undefined ? '' : String(v));

export const PRODUCTION_ORDER_DESCRIPTOR: EnterpriseModuleDescriptor = {
  id: PRODUCTION_ORDERS_MODULE_ID,
  title: 'Production Orders',
  singular: 'Production Order',
  plural: 'Production Orders',
  icon: 'cpu',
  description: 'Build finished goods from a BOM through real inventory movements.',
  group: 'Manufacturing',
  titleField: 'orderNumber',
  permissions: { read: 'manufacturing:read', write: 'manufacturing:manage' },
  actions: [
    { key: PLAN_ACTION, label: 'Plan', icon: 'calendar' },
    { key: COMMIT_SCHEDULE_ACTION, label: 'Commit Schedule', icon: 'calendar-check' },
    { key: ALLOCATE_ACTION, label: 'Allocate Material', icon: 'lock' },
    { key: START_ACTION, label: 'Start Production', icon: 'play' },
    { key: COMPLETE_ACTION, label: 'Complete', icon: 'check' },
    { key: CANCEL_ACTION, label: 'Cancel', icon: 'close' },
  ],
  fields: [
    { key: 'orderNumber', label: 'Order #', type: 'text', required: true, placeholder: 'MO-0001' },
    { key: 'bom', label: 'BOM Number', type: 'text', required: true, placeholder: 'BOM-0001' },
    { key: 'product', label: 'Finished Product (SKU)', type: 'text', placeholder: 'FG-0001' },
    { key: 'warehouse', label: 'Warehouse', type: 'text', required: true, placeholder: 'WH-01' },
    { key: 'productionQuantity', label: 'Planned Qty', type: 'number', required: true, min: 1 },
    { key: 'actualQuantity', label: 'Actual Qty', type: 'number', min: 0, column: false },
    { key: 'scrapQuantity', label: 'Scrap Qty', type: 'number', min: 0, column: false },
    { key: 'workCenter', label: 'Work Center', type: 'text', column: false },
    { key: 'machine', label: 'Machine', type: 'text', column: false },
    { key: 'operator', label: 'Operator', type: 'text', column: false },
    { key: 'productionTime', label: 'Production Time (min)', type: 'number', min: 0, column: false },
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
        { value: 'planned', label: 'Planned', tone: 'blue' },
        { value: 'released', label: 'Released', tone: 'teal' },
        { value: 'running', label: 'Running', tone: 'purple' },
        { value: 'completed', label: 'Completed', tone: 'green' },
        { value: 'cancelled', label: 'Cancelled', tone: 'orange' },
      ],
    },
    { key: 'consumptionMovements', label: 'Consumption', type: 'textarea', column: false, readOnly: true },
    { key: 'outputMovement', label: 'Output Movement', type: 'text', column: false, readOnly: true },
    { key: 'scheduleCommitted', label: 'Committed Schedule', type: 'textarea', column: false, readOnly: true },
  ],
};

export interface ProductionOrderAiNarrative {
  summary: string;
  executiveExplanation: string;
  grounded: boolean;
  model: string;
}
export type ProductionOrderAiRunner = (order: ProductionOrder) => Promise<ProductionOrderAiNarrative | null>;

async function resolveBom(ctx: EnterpriseModuleActionContext, bomRef: string): Promise<BillOfMaterials | null> {
  if (!bomRef) return null;
  const bomModule = ctx.moduleFor(BOM_MODULE_ID);
  if (!bomModule) return null;
  await bomModule.store.load();
  const rec =
    bomModule.store.list().find((r) => str(r.fields.bomNumber) === bomRef) ?? bomModule.store.get(bomRef);
  if (!rec || rec.status === 'deleted') return null;
  return bomFromRecord(rec);
}

export function createProductionOrderModule(storePath: string, aiRunner?: ProductionOrderAiRunner): EnterpriseModule {
  const store = new EnterpriseRecordStore(storePath, PRODUCTION_ORDERS_MODULE_ID, PRODUCTION_ORDER_KIND);

  function emitSelf(record: EnterpriseEntity | null, ctx: EnterpriseModuleActionContext): void {
    if (!record) return;
    const self = ctx.moduleFor(PRODUCTION_ORDERS_MODULE_ID);
    if (self) ctx.emit(self, 'updated', record);
  }

  return defineEnterpriseModule({
    descriptor: PRODUCTION_ORDER_DESCRIPTOR,
    store,
    hooks: {
      summarize: async (record): Promise<EnterpriseRecordSummary> => {
        const order = productionOrderFromRecord(record);
        const ai = aiRunner ? await aiRunner(order).catch(() => null) : null;
        const fallback = productionOrderSummaryFallback(order);
        return {
          moduleId: PRODUCTION_ORDERS_MODULE_ID,
          recordId: record.id,
          headline: `${order.orderNumber} · ${order.product || order.bom} · ${order.productionQuantity} · ${order.status}`,
          summary: ai?.summary?.trim() || fallback.summary,
          risk: order.status === 'cancelled' ? 'low' : 'low',
          riskReason: `Production order ${order.status}.`,
          executiveExplanation: ai?.executiveExplanation?.trim() || fallback.executiveExplanation,
          grounded: Boolean(ai?.grounded),
          model: ai?.model ?? 'none',
        };
      },
      runAction: async (action, record, ctx) => {
        const order = productionOrderFromRecord(record);

        // Commit Schedule — the explicit, human-approved hand-off that persists real Production
        // Schedule records from the deterministic routing plan (reuses the shared engine).
        if (action === COMMIT_SCHEDULE_ACTION) return commitScheduleForOrder(record, ctx);

        if (action === PLAN_ACTION) {
          if (order.status !== 'draft') return { ok: false, message: `Cannot plan an order that is ${order.status}.` };
          emitSelf(store.update(record.id, { fields: { status: 'planned' }, actor: ctx.actor(), now: ctx.now() }), ctx);
          return { ok: true, message: `Production order ${order.orderNumber} planned.` };
        }

        if (action === ALLOCATE_ACTION) {
          if (order.status !== 'planned') return { ok: false, message: `Plan the order before allocating material (it is ${order.status}).` };
          if (!order.warehouse || order.productionQuantity <= 0) return { ok: false, message: 'Set a warehouse and planned quantity before allocating.' };
          const bom = await resolveBom(ctx, order.bom);
          if (!bom) return { ok: false, message: `BOM "${order.bom}" was not found.` };
          if (bom.components.length === 0) return { ok: false, message: `BOM "${order.bom}" has no components to allocate.` };
          for (const component of bom.components) {
            const qty = componentConsumption(component, order.productionQuantity, bom.waste);
            if (qty <= 0) continue;
            const reserved = await postReservation(ctx, {
              movementNumber: `MV-${order.orderNumber}-${component.sku}-RES`,
              product: component.sku,
              warehouse: order.warehouse,
              quantity: qty,
              referenceModule: PRODUCTION_ORDERS_MODULE_ID,
              referenceRecord: order.id,
              reason: `Production ${order.orderNumber} material allocation`,
            });
            if (!reserved) return { ok: false, error: `Could not reserve component ${component.sku}.` };
          }
          emitSelf(store.update(record.id, { fields: { status: 'released' }, actor: ctx.actor(), now: ctx.now() }), ctx);
          return { ok: true, message: `Allocated ${bom.components.length} component(s) for ${order.orderNumber}.` };
        }

        if (action === START_ACTION) {
          if (order.status !== 'released') return { ok: false, message: `Allocate material before starting (it is ${order.status}).` };
          const bom = await resolveBom(ctx, order.bom);
          if (!bom || bom.components.length === 0) return { ok: false, message: `BOM "${order.bom}" has no components.` };
          const consumptionIds: string[] = [];
          for (const component of bom.components) {
            const qty = componentConsumption(component, order.productionQuantity, bom.waste);
            if (qty <= 0) continue;
            const consumed = await postConsumption(ctx, {
              movementNumber: `MV-${order.orderNumber}-${component.sku}-CON`,
              product: component.sku,
              warehouse: order.warehouse,
              quantity: qty,
              referenceModule: PRODUCTION_ORDERS_MODULE_ID,
              referenceRecord: order.id,
              reason: `Production ${order.orderNumber} consumption`,
            });
            if (!consumed) return { ok: false, error: `Could not consume component ${component.sku}.` };
            consumptionIds.push(consumed.id);
            // Release the reservation held for this component (material is now consumed).
            await postReservationRelease(ctx, {
              movementNumber: `MV-${order.orderNumber}-${component.sku}-REL`,
              product: component.sku,
              warehouse: order.warehouse,
              quantity: qty,
              referenceModule: PRODUCTION_ORDERS_MODULE_ID,
              referenceRecord: order.id,
              reason: `Production ${order.orderNumber} reservation release`,
            });
          }
          emitSelf(
            store.update(record.id, { fields: { status: 'running', consumptionMovements: consumptionIds.join(',') }, actor: ctx.actor(), now: ctx.now() }),
            ctx,
          );
          return { ok: true, message: `Started ${order.orderNumber}; consumed ${consumptionIds.length} component(s).` };
        }

        if (action === COMPLETE_ACTION) {
          if (order.status !== 'running') return { ok: false, message: `Start production before completing (it is ${order.status}).` };
          const bom = await resolveBom(ctx, order.bom);
          const finishedProduct = order.product || bom?.product || '';
          if (!finishedProduct) return { ok: false, message: 'Set the finished product SKU before completing.' };
          const yieldPct = bom ? bom.yield : 100;
          const finishedQty = order.actualQuantity > 0 ? order.actualQuantity : Math.max(0, Math.round(order.productionQuantity * (yieldPct / 100)));
          if (finishedQty <= 0) return { ok: false, message: 'Nothing to produce — set an actual quantity or a positive yield.' };
          const output = await postOutput(ctx, {
            movementNumber: `MV-${order.orderNumber}-OUT`,
            product: finishedProduct,
            warehouse: order.warehouse,
            quantity: finishedQty,
            referenceModule: PRODUCTION_ORDERS_MODULE_ID,
            referenceRecord: order.id,
            reason: `Production ${order.orderNumber} finished goods`,
          });
          if (!output) return { ok: false, error: 'Could not post the finished-goods movement.' };
          emitSelf(
            store.update(record.id, {
              fields: { status: 'completed', outputMovement: output.id, actualQuantity: finishedQty, product: finishedProduct },
              actor: ctx.actor(),
              now: ctx.now(),
            }),
            ctx,
          );
          return { ok: true, message: `Completed ${order.orderNumber}; produced ${finishedQty} of ${finishedProduct}.` };
        }

        if (action === CANCEL_ACTION) {
          if (order.status === 'completed' || order.status === 'cancelled') return { ok: false, message: `Cannot cancel an order that is ${order.status}.` };
          // Only a released order still holds reservations to release.
          if (order.status === 'released') {
            const bom = await resolveBom(ctx, order.bom);
            for (const component of bom?.components ?? []) {
              const qty = componentConsumption(component, order.productionQuantity, bom?.waste ?? 0);
              if (qty <= 0) continue;
              await postReservationRelease(ctx, {
                movementNumber: `MV-${order.orderNumber}-${component.sku}-CXL`,
                product: component.sku,
                warehouse: order.warehouse,
                quantity: qty,
                referenceModule: PRODUCTION_ORDERS_MODULE_ID,
                referenceRecord: order.id,
                reason: `Production ${order.orderNumber} cancelled`,
              });
            }
          }
          emitSelf(store.update(record.id, { fields: { status: 'cancelled' }, actor: ctx.actor(), now: ctx.now() }), ctx);
          return { ok: true, message: `Production order ${order.orderNumber} cancelled.` };
        }

        return { ok: false, error: `Unknown action "${action}".` };
      },
    },
  });
}
