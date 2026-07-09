/**
 * Manufacturing → Production Execution (MES) — the SHOP-FLOOR EXECUTION of a dispatched,
 * committed Production Schedule. Each execution runs ONE scheduled operation through a
 * deterministic lifecycle (dispatched → running → paused / blocked → inspection → completed).
 * Material and finished goods touch stock ONLY through the Inventory Ledger:
 *   • starting the FIRST operation backflushes the BOM components (`production_consumption`),
 *   • completing the FINAL operation posts finished goods (`production_output`) and, when scrap
 *     was recorded, a real scrap write-off (`adjustment`), then rolls the Production Order to
 *     completed.
 * No stock is ever edited directly; downtime remains the Maintenance authority; the AI explains
 * execution but never dispatches, moves stock, completes operations, or assigns operators.
 */
import type {
  EnterpriseModuleDescriptor,
  EnterpriseRecordSummary,
  MesExecution,
  BillOfMaterials,
} from '@neuropause/shared';
import {
  BOM_MODULE_ID,
  MES_EXECUTION_STATES,
  PRODUCTION_EXECUTIONS_MODULE_ID,
  PRODUCTION_EXECUTION_KIND,
  PRODUCTION_ORDERS_MODULE_ID,
  bomFromRecord,
  calculateExecutionOee,
  calculateFirstPassYield,
  componentConsumption,
  mesExecutionFromRecord,
} from '@neuropause/shared';
import {
  EnterpriseRecordStore,
  defineEnterpriseModule,
  type EnterpriseModule,
  type EnterpriseModuleActionContext,
} from '../../framework';
import { postConsumption, postOutput } from './manufacturingMovements';
import { postStockMovement } from '../inventory/postMovement';
import { postManufacturingEvent } from './manufacturingEventLog';
import type { ManufacturingEventType } from '@neuropause/shared';

export const START_EXECUTION_ACTION = 'start';
export const PAUSE_ACTION = 'pause';
export const RESUME_ACTION = 'resume';
export const BLOCK_ACTION = 'block';
export const INSPECT_ACTION = 'inspect';
export const INSPECT_PASS_ACTION = 'inspectPass';
export const INSPECT_FAIL_ACTION = 'inspectFail';
export const COMPLETE_EXECUTION_ACTION = 'complete';
export const CANCEL_EXECUTION_ACTION = 'cancel';

const str = (v: unknown): string => (v === null || v === undefined ? '' : String(v));

export const PRODUCTION_EXECUTION_DESCRIPTOR: EnterpriseModuleDescriptor = {
  id: PRODUCTION_EXECUTIONS_MODULE_ID,
  title: 'Production Execution',
  singular: 'Execution',
  plural: 'Executions',
  icon: 'activity',
  description: 'Shop-floor execution of dispatched, committed schedule operations.',
  group: 'Manufacturing',
  titleField: 'executionNumber',
  permissions: { read: 'manufacturing:read', write: 'manufacturing:manage' },
  actions: [
    { key: START_EXECUTION_ACTION, label: 'Start', icon: 'play' },
    { key: PAUSE_ACTION, label: 'Pause', icon: 'pause' },
    { key: RESUME_ACTION, label: 'Resume', icon: 'play' },
    { key: BLOCK_ACTION, label: 'Block', icon: 'alert' },
    { key: INSPECT_ACTION, label: 'Send to Inspection', icon: 'search' },
    { key: INSPECT_PASS_ACTION, label: 'Inspection Passed', icon: 'check' },
    { key: INSPECT_FAIL_ACTION, label: 'Inspection Failed', icon: 'close' },
    { key: COMPLETE_EXECUTION_ACTION, label: 'Complete', icon: 'check' },
    { key: CANCEL_EXECUTION_ACTION, label: 'Cancel', icon: 'close' },
  ],
  fields: [
    { key: 'executionNumber', label: 'Execution #', type: 'text', required: true, placeholder: 'EX-0001' },
    { key: 'productionOrder', label: 'Production Order', type: 'text', required: true, placeholder: 'MO-0001' },
    { key: 'schedule', label: 'Schedule', type: 'text', column: false, readOnly: true },
    { key: 'operation', label: 'Operation', type: 'text' },
    { key: 'sequence', label: 'Seq', type: 'number', min: 0 },
    { key: 'workCenter', label: 'Work Center', type: 'text', column: false },
    { key: 'machine', label: 'Machine', type: 'text', column: false },
    { key: 'operator', label: 'Operator', type: 'text', column: false },
    { key: 'product', label: 'Product (SKU)', type: 'text', column: false },
    { key: 'warehouse', label: 'Warehouse', type: 'text', column: false },
    { key: 'bom', label: 'BOM', type: 'text', column: false },
    { key: 'plannedQuantity', label: 'Planned Qty', type: 'number', min: 0 },
    { key: 'firstOperation', label: 'First Op', type: 'boolean', column: false },
    { key: 'finalOperation', label: 'Final Op', type: 'boolean', column: false },
    { key: 'blockedReason', label: 'Blocked Reason', type: 'text', column: false },
    { key: 'startTime', label: 'Start', type: 'date', column: false, format: 'date' },
    { key: 'endTime', label: 'End', type: 'date', column: false, format: 'date' },
    { key: 'setupMinutes', label: 'Setup (min)', type: 'number', min: 0, column: false },
    { key: 'runMinutes', label: 'Run (min)', type: 'number', min: 0, column: false },
    { key: 'downtimeMinutes', label: 'Downtime (min)', type: 'number', min: 0, column: false },
    { key: 'inspectionMinutes', label: 'Inspection (min)', type: 'number', min: 0, column: false },
    { key: 'goodQuantity', label: 'Good Qty', type: 'number', min: 0 },
    { key: 'scrapQuantity', label: 'Scrap Qty', type: 'number', min: 0 },
    { key: 'scrapReason', label: 'Scrap Reason', type: 'text', column: false },
    { key: 'inspectionRequired', label: 'Inspection Required', type: 'boolean', column: false },
    { key: 'inspectionResult', label: 'Inspection Result', type: 'text', column: false, readOnly: true },
    { key: 'acceptedQuantity', label: 'Accepted Qty', type: 'number', min: 0, column: false },
    { key: 'rejectedQuantity', label: 'Rejected Qty', type: 'number', min: 0, column: false },
    { key: 'reworkQuantity', label: 'Rework Qty', type: 'number', min: 0, column: false },
    { key: 'qualityNotes', label: 'Quality Notes', type: 'textarea', column: false },
    { key: 'materialMovements', label: 'Material Movements', type: 'textarea', column: false, readOnly: true },
    { key: 'outputMovement', label: 'Output Movement', type: 'text', column: false, readOnly: true },
    { key: 'scrapMovement', label: 'Scrap Movement', type: 'text', column: false, readOnly: true },
    {
      key: 'status',
      label: 'Status',
      type: 'select',
      required: true,
      default: 'scheduled',
      badge: true,
      filterable: true,
      options: [
        { value: 'scheduled', label: 'Scheduled', tone: 'neutral' },
        { value: 'released', label: 'Released', tone: 'blue' },
        { value: 'dispatched', label: 'Dispatched', tone: 'teal' },
        { value: 'waiting', label: 'Waiting', tone: 'neutral' },
        { value: 'running', label: 'Running', tone: 'purple' },
        { value: 'paused', label: 'Paused', tone: 'orange' },
        { value: 'blocked', label: 'Blocked', tone: 'orange' },
        { value: 'inspection', label: 'Inspection', tone: 'blue' },
        { value: 'completed', label: 'Completed', tone: 'green' },
        { value: 'cancelled', label: 'Cancelled', tone: 'orange' },
      ],
    },
  ],
};

const STARTABLE = new Set(['scheduled', 'released', 'dispatched', 'waiting']);

/** Resolve the referenced BOM (by BOM number, then id). */
async function resolveBom(ctx: EnterpriseModuleActionContext, bomRef: string): Promise<BillOfMaterials | null> {
  if (!bomRef) return null;
  const bomModule = ctx.moduleFor(BOM_MODULE_ID);
  if (!bomModule) return null;
  await bomModule.store.load();
  const rec = bomModule.store.list().find((r) => str(r.fields.bomNumber) === bomRef) ?? bomModule.store.get(bomRef);
  if (!rec || rec.status === 'deleted') return null;
  return bomFromRecord(rec);
}

export function createExecutionModule(storePath: string): EnterpriseModule {
  const store = new EnterpriseRecordStore(storePath, PRODUCTION_EXECUTIONS_MODULE_ID, PRODUCTION_EXECUTION_KIND);

  function emitSelf(record: Parameters<typeof mesExecutionFromRecord>[0] | null, ctx: EnterpriseModuleActionContext): void {
    if (!record) return;
    const self = ctx.moduleFor(PRODUCTION_EXECUTIONS_MODULE_ID);
    if (self) ctx.emit(self, 'updated', record);
  }

  /** Backflush the BOM components for the planned quantity (first operation only). */
  async function consumeMaterial(e: MesExecution, ctx: EnterpriseModuleActionContext): Promise<{ ok: boolean; ids: string[]; error?: string }> {
    if (!e.bom || !e.warehouse || e.plannedQuantity <= 0) return { ok: true, ids: [] };
    const bom = await resolveBom(ctx, e.bom);
    if (!bom || bom.components.length === 0) return { ok: true, ids: [] };
    const ids: string[] = [];
    for (const component of bom.components) {
      const qty = componentConsumption(component, e.plannedQuantity, bom.waste);
      if (qty <= 0) continue;
      const consumed = await postConsumption(ctx, {
        movementNumber: `MV-${e.executionNumber}-${component.sku}-CON`,
        product: component.sku,
        warehouse: e.warehouse,
        quantity: qty,
        referenceModule: PRODUCTION_EXECUTIONS_MODULE_ID,
        referenceRecord: e.id,
        reason: `MES ${e.executionNumber} material issue`,
      });
      if (!consumed) return { ok: false, ids, error: `Could not consume component ${component.sku}.` };
      ids.push(consumed.id);
    }
    return { ok: true, ids };
  }

  /** Append a shop-floor event to the immutable ledger (best-effort; no-op if the ledger is absent). */
  async function emitEvent(
    ctx: EnterpriseModuleActionContext,
    e: MesExecution,
    eventType: ManufacturingEventType,
    extra: { quantity?: number; reason?: string } = {},
  ): Promise<void> {
    await postManufacturingEvent(ctx, {
      eventType,
      productionOrder: e.productionOrder,
      execution: e.executionNumber,
      operation: e.operation,
      machine: e.machine,
      workCenter: e.workCenter,
      operator: e.operator,
      ...extra,
    });
  }

  return defineEnterpriseModule({
    descriptor: PRODUCTION_EXECUTION_DESCRIPTOR,
    store,
    hooks: {
      summarize: async (record): Promise<EnterpriseRecordSummary> => {
        const e = mesExecutionFromRecord(record);
        const oee = e.status === 'completed' ? calculateExecutionOee(e) : 0;
        const fpy = calculateFirstPassYield(e.goodQuantity, e.scrapQuantity);
        const summary =
          `${e.executionNumber} — ${e.operation || 'operation'} of ${e.productionOrder} on ${e.machine || 'a machine'} is ${e.status}.` +
          (e.status === 'completed' ? ` Produced ${e.goodQuantity} good / ${e.scrapQuantity} scrap (${fpy}% first-pass yield, ${oee}% OEE).` : '') +
          (e.blockedReason ? ` Blocked: ${e.blockedReason}.` : '');
        return {
          moduleId: PRODUCTION_EXECUTIONS_MODULE_ID,
          recordId: record.id,
          headline: `${e.executionNumber} · ${e.operation || e.workCenter} · ${e.status}`,
          summary,
          risk: e.status === 'blocked' ? 'high' : e.status === 'inspection' ? 'medium' : 'low',
          riskReason: e.status === 'blocked' ? e.blockedReason || 'Operation blocked.' : `Execution ${e.status}.`,
          executiveExplanation:
            e.status === 'completed'
              ? `${e.executionNumber} completed ${e.goodQuantity} good at ${fpy}% yield.`
              : `${e.executionNumber} is ${e.status}.`,
          grounded: false,
          model: 'none',
        };
      },
      runAction: async (action, record, ctx) => {
        const e = mesExecutionFromRecord(record);
        if (e.status === 'completed' || e.status === 'cancelled') {
          if (action !== CANCEL_EXECUTION_ACTION) return { ok: false, message: `Execution ${e.executionNumber} is ${e.status}.` };
        }

        if (action === START_EXECUTION_ACTION) {
          if (!STARTABLE.has(e.status)) return { ok: false, message: `Cannot start an execution that is ${e.status}.` };
          const fields: Record<string, string | number> = { status: 'running', startTime: ctx.now().slice(0, 10) };
          // First operation backflushes the material kit through the Inventory Ledger.
          if (e.firstOperation && !e.materialMovements) {
            const consumed = await consumeMaterial(e, ctx);
            if (!consumed.ok) return { ok: false, error: consumed.error };
            if (consumed.ids.length > 0) fields.materialMovements = consumed.ids.join(',');
          }
          emitSelf(store.update(record.id, { fields, actor: ctx.actor(), now: ctx.now() }), ctx);
          if (e.machine) await emitEvent(ctx, e, 'machine_started');
          if (e.operator) await emitEvent(ctx, e, 'operator_assigned');
          if (e.firstOperation && fields.materialMovements) await emitEvent(ctx, e, 'material_issued');
          await emitEvent(ctx, e, 'operation_started');
          return { ok: true, message: `Started ${e.executionNumber}${e.firstOperation ? ' (material issued)' : ''}.` };
        }

        if (action === PAUSE_ACTION) {
          if (e.status !== 'running') return { ok: false, message: `Cannot pause an execution that is ${e.status}.` };
          emitSelf(store.update(record.id, { fields: { status: 'paused' }, actor: ctx.actor(), now: ctx.now() }), ctx);
          await emitEvent(ctx, e, 'operation_paused');
          return { ok: true, message: `Paused ${e.executionNumber}.` };
        }

        if (action === RESUME_ACTION) {
          if (e.status !== 'paused' && e.status !== 'blocked') return { ok: false, message: `Cannot resume an execution that is ${e.status}.` };
          emitSelf(store.update(record.id, { fields: { status: 'running', blockedReason: '' }, actor: ctx.actor(), now: ctx.now() }), ctx);
          if (e.status === 'blocked') await emitEvent(ctx, e, 'downtime_ended');
          await emitEvent(ctx, e, 'operation_resumed');
          return { ok: true, message: `Resumed ${e.executionNumber}.` };
        }

        if (action === BLOCK_ACTION) {
          if (e.status !== 'running' && e.status !== 'dispatched' && e.status !== 'waiting') return { ok: false, message: `Cannot block an execution that is ${e.status}.` };
          emitSelf(store.update(record.id, { fields: { status: 'blocked' }, actor: ctx.actor(), now: ctx.now() }), ctx);
          await emitEvent(ctx, e, 'downtime_started', { reason: e.blockedReason });
          return { ok: true, message: `Blocked ${e.executionNumber}${e.blockedReason ? `: ${e.blockedReason}` : ''}.` };
        }

        if (action === INSPECT_ACTION) {
          if (e.status !== 'running' && e.status !== 'paused') return { ok: false, message: `Cannot send an execution that is ${e.status} to inspection.` };
          emitSelf(store.update(record.id, { fields: { status: 'inspection', inspectionResult: 'pending' }, actor: ctx.actor(), now: ctx.now() }), ctx);
          await emitEvent(ctx, e, 'inspection_started');
          return { ok: true, message: `${e.executionNumber} sent to inspection.` };
        }

        if (action === INSPECT_PASS_ACTION) {
          if (e.status !== 'inspection') return { ok: false, message: `Only an execution in inspection can pass (it is ${e.status}).` };
          emitSelf(store.update(record.id, { fields: { status: 'running', inspectionResult: 'pass' }, actor: ctx.actor(), now: ctx.now() }), ctx);
          await emitEvent(ctx, e, 'inspection_passed');
          return { ok: true, message: `${e.executionNumber} passed inspection.` };
        }

        if (action === INSPECT_FAIL_ACTION) {
          if (e.status !== 'inspection') return { ok: false, message: `Only an execution in inspection can fail (it is ${e.status}).` };
          emitSelf(
            store.update(record.id, { fields: { status: 'blocked', inspectionResult: 'fail', blockedReason: 'Inspection failed' }, actor: ctx.actor(), now: ctx.now() }),
            ctx,
          );
          await emitEvent(ctx, e, 'inspection_failed', { reason: 'Inspection failed' });
          return { ok: true, message: `${e.executionNumber} failed inspection; blocked for rework.` };
        }

        if (action === COMPLETE_EXECUTION_ACTION) {
          if (e.status !== 'running' && e.status !== 'paused' && e.status !== 'inspection') {
            return { ok: false, message: `Cannot complete an execution that is ${e.status}.` };
          }
          // Deterministic backflush: the operation produces the full planned quantity; scrap is
          // then written off, so net good = planned − scrap (the ledger nets to the good units).
          const scrapQty = Math.max(0, e.scrapQuantity);
          const producedQty = Math.max(0, e.plannedQuantity);
          const good = Math.max(0, producedQty - scrapQty);
          const fields: Record<string, string | number> = { status: 'completed', endTime: ctx.now().slice(0, 10), goodQuantity: good };

          // The final operation yields finished goods (and writes off scrap) through the ledger.
          if (e.finalOperation) {
            if (!e.product || !e.warehouse) return { ok: false, message: 'Set a product and warehouse before completing the final operation.' };
            if (producedQty > 0) {
              const output = await postOutput(ctx, {
                movementNumber: `MV-${e.executionNumber}-OUT`,
                product: e.product,
                warehouse: e.warehouse,
                quantity: producedQty,
                referenceModule: PRODUCTION_EXECUTIONS_MODULE_ID,
                referenceRecord: e.id,
                reason: `MES ${e.executionNumber} finished goods`,
              });
              if (!output) return { ok: false, error: 'Could not post the finished-goods movement.' };
              fields.outputMovement = output.id;
            }
            if (scrapQty > 0) {
              const scrap = await postStockMovement(ctx, {
                movementNumber: `MV-${e.executionNumber}-SCRAP`,
                type: 'adjustment',
                product: e.product,
                warehouse: e.warehouse,
                quantity: -scrapQty,
                referenceModule: PRODUCTION_EXECUTIONS_MODULE_ID,
                referenceRecord: e.id,
                reason: `MES ${e.executionNumber} scrap${e.scrapReason ? ` — ${e.scrapReason}` : ''}`,
              });
              if (!scrap) return { ok: false, error: 'Could not post the scrap movement.' };
              fields.scrapMovement = scrap.id;
            }
            // Roll the Production Order to completed (Manufacturing remains the execution authority).
            const ordersModule = ctx.moduleFor(PRODUCTION_ORDERS_MODULE_ID);
            if (ordersModule) {
              ctx.authorize(ordersModule.descriptor.permissions.write);
              await ordersModule.store.load();
              const orderRec = ordersModule.store.list().find((r) => str(r.fields.orderNumber) === e.productionOrder);
              if (orderRec && str(orderRec.fields.status) !== 'completed') {
                const updatedOrder = ordersModule.store.update(orderRec.id, {
                  fields: { status: 'completed', actualQuantity: good, product: e.product, outputMovement: str(fields.outputMovement) },
                  actor: ctx.actor(),
                  now: ctx.now(),
                });
                if (updatedOrder) ctx.emit(ordersModule, 'updated', updatedOrder);
              }
            }
          }

          emitSelf(store.update(record.id, { fields, actor: ctx.actor(), now: ctx.now() }), ctx);
          await emitEvent(ctx, e, 'operation_completed');
          if (e.finalOperation) {
            if (producedQty > 0) await emitEvent(ctx, e, 'finished_goods_posted', { quantity: good });
            if (scrapQty > 0) await emitEvent(ctx, e, 'scrap_recorded', { quantity: scrapQty, reason: e.scrapReason });
            await emitEvent(ctx, e, 'order_closed');
          }
          return {
            ok: true,
            message: `Completed ${e.executionNumber}${e.finalOperation ? ` — produced ${good} of ${e.product}${e.scrapQuantity > 0 ? `, scrapped ${e.scrapQuantity}` : ''}` : ''}.`,
          };
        }

        if (action === CANCEL_EXECUTION_ACTION) {
          if (e.status === 'completed' || e.status === 'cancelled') return { ok: false, message: `Cannot cancel an execution that is ${e.status}.` };
          emitSelf(store.update(record.id, { fields: { status: 'cancelled' }, actor: ctx.actor(), now: ctx.now() }), ctx);
          if (e.machine) await emitEvent(ctx, e, 'machine_stopped');
          return { ok: true, message: `Cancelled ${e.executionNumber}.` };
        }

        return { ok: false, error: `Unknown action "${action}".` };
      },
    },
  });
}

// Re-export the MES state list so callers can reason about the lifecycle without a shared import.
export { MES_EXECUTION_STATES };
