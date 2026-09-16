/**
 * Manufacturing → Dispatch to Execution — the explicit hand-off that begins shop-floor
 * execution. It reads the production order's ALREADY-COMMITTED Production Schedule records
 * (created by Commit Schedule — execution begins only after a schedule is committed) and
 * creates one Production Execution per scheduled operation, in routing sequence, flagging the
 * first operation (backflushes material on start) and the final operation (posts finished
 * goods on complete). It reuses the existing Execution module + Schedule records — no new
 * store, no duplicate scheduling. Idempotent (the order is stamped) and RBAC-gated through the
 * Execution module's own write permission. Nothing executes automatically.
 */
import type { EnterpriseEntity, EnterpriseModuleActionResult, ProductionSchedule } from '@neuropause/shared';
import {
  PRODUCTION_EXECUTIONS_MODULE_ID,
  PRODUCTION_ORDERS_MODULE_ID,
  PRODUCTION_SCHEDULES_MODULE_ID,
  deriveRecordTitle,
  productionOrderFromRecord,
  productionScheduleFromRecord,
  validateEnterpriseRecordInput,
} from '@neuropause/shared';
import type { EnterpriseModuleActionContext } from '../../framework';
import { childCorrelationMeta, rootMetaIfUnset } from '../../framework';
import { postManufacturingEvent } from './manufacturingEventLog';

export const DISPATCH_ACTION = 'dispatchExecution';

const str = (v: unknown): string => (v === null || v === undefined ? '' : String(v));

/** Sequence embedded in a committed schedule number `SCH-<order>-<sequence>`. */
function scheduleSequence(scheduleNumber: string): number {
  const tail = scheduleNumber.split('-').pop() ?? '';
  const n = Number(tail);
  return Number.isFinite(n) ? n : 0;
}

/** Production Order → Production Execution records (one per committed scheduled operation). */
export async function dispatchOrderToExecution(
  orderRecord: EnterpriseEntity,
  ctx: EnterpriseModuleActionContext,
): Promise<EnterpriseModuleActionResult> {
  if (str(orderRecord.fields.executionDispatched)) {
    return { ok: false, message: 'This order has already been dispatched to execution.' };
  }
  const order = productionOrderFromRecord(orderRecord);
  if (!order.product || order.productionQuantity <= 0 || !order.warehouse) {
    return { ok: false, message: 'Set a product, warehouse, and planned quantity before dispatching.' };
  }

  const scheduleModule = ctx.moduleFor(PRODUCTION_SCHEDULES_MODULE_ID);
  const executionModule = ctx.moduleFor(PRODUCTION_EXECUTIONS_MODULE_ID);
  const ordersModule = ctx.moduleFor(PRODUCTION_ORDERS_MODULE_ID);
  if (!scheduleModule || !executionModule || !ordersModule) {
    return { ok: false, error: 'Execution modules are not available.' };
  }
  ctx.authorize(executionModule.descriptor.permissions.write);
  await Promise.all([scheduleModule.store.load(), executionModule.store.load()]);

  const committed: ProductionSchedule[] = scheduleModule.store
    .list()
    .map(productionScheduleFromRecord)
    .filter((s) => s.productionOrder === order.orderNumber && s.status !== 'cancelled')
    .sort((a, b) => scheduleSequence(a.scheduleNumber) - scheduleSequence(b.scheduleNumber));
  if (committed.length === 0) {
    return { ok: false, message: `No committed schedule found for ${order.orderNumber}. Commit a schedule before dispatching.` };
  }

  const createdIds: string[] = [];
  for (let i = 0; i < committed.length; i++) {
    const s = committed[i];
    const sequence = scheduleSequence(s.scheduleNumber);
    const fields: Record<string, string | number | boolean> = {
      executionNumber: `EX-${order.orderNumber}-${sequence}`,
      productionOrder: order.orderNumber,
      schedule: s.scheduleNumber,
      operation: s.workCenter ? `${s.workCenter} (op ${sequence})` : `Operation ${sequence}`,
      sequence,
      workCenter: s.workCenter,
      machine: s.machine,
      product: order.product,
      warehouse: order.warehouse,
      bom: order.bom,
      plannedQuantity: order.productionQuantity,
      firstOperation: i === 0,
      finalOperation: i === committed.length - 1,
      status: 'dispatched',
    };
    const validation = validateEnterpriseRecordInput(executionModule.descriptor, { fields });
    if (!validation.ok) return { ok: false, error: `Execution: ${Object.values(validation.errors)[0] ?? 'invalid input'}` };
    const rec = executionModule.store.create({
      title: deriveRecordTitle(executionModule.descriptor, validation.values),
      fields: validation.values,
      // Transaction-graph spine: every execution is caused by the production order.
      metadata: childCorrelationMeta(orderRecord, PRODUCTION_ORDERS_MODULE_ID),
      actor: ctx.actor(),
      now: ctx.now(),
    });
    ctx.emit(executionModule, 'created', rec);
    createdIds.push(rec.id);
    // Append an immutable "operation released" event to the shop-floor ledger (best-effort).
    await postManufacturingEvent(ctx, {
      eventType: 'operation_released',
      productionOrder: order.orderNumber,
      execution: String(fields.executionNumber),
      operation: String(fields.operation),
      machine: s.machine,
      workCenter: s.workCenter,
    });
  }

  const updated = ordersModule.store.update(orderRecord.id, {
    fields: { executionDispatched: createdIds.join(',') },
    // Root the transaction at the production order when it is a genuine origin.
    metadata: rootMetaIfUnset(orderRecord, PRODUCTION_ORDERS_MODULE_ID),
    actor: ctx.actor(),
    now: ctx.now(),
  });
  ctx.emit(ordersModule, 'updated', updated ?? orderRecord);

  return { ok: true, message: `Dispatched ${createdIds.length} operation(s) of ${order.orderNumber} to execution.` };
}
