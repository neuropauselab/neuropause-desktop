/**
 * Manufacturing → Commit Schedule — the ONE explicit, human-approved hand-off that turns a
 * read-only routing plan into REAL Production Schedule records. Scheduling itself
 * (`computeRoutingSchedule` / `scheduleProductionOrderRouting`) is pure and read-only; nothing
 * is persisted until an operator invokes this action on a production order. It deterministically
 * schedules the order through its product's active routing onto qualified machines (reusing the
 * shared engine — no scheduling logic here), then creates one Production Schedule record per
 * scheduled operation in the EXISTING schedule module (reusing that store — no new store). It is
 * idempotent (a committed order is stamped + refuses a second commit) and RBAC-gated through the
 * schedule module's own write permission. Execution never happens automatically.
 */
import type { EnterpriseEntity, EnterpriseModuleActionResult, Machine, Routing } from '@neuropause/shared';
import {
  MACHINES_MODULE_ID,
  PRODUCTION_ORDERS_MODULE_ID,
  PRODUCTION_SCHEDULES_MODULE_ID,
  ROUTINGS_MODULE_ID,
  buildScheduleRecordFields,
  deriveRecordTitle,
  machineFromRecord,
  productionOrderFromRecord,
  routingFromRecord,
  scheduleProductionOrderRouting,
  validateEnterpriseRecordInput,
} from '@neuropause/shared';
import type { EnterpriseModuleActionContext } from '../../framework';
import { childCorrelationMeta, rootMetaIfUnset } from '../../framework';

export const COMMIT_SCHEDULE_ACTION = 'commitSchedule';

const str = (v: unknown): string => (v === null || v === undefined ? '' : String(v));

/** Production Order → Production Schedule records (one per scheduled routing operation). */
export async function commitScheduleForOrder(
  orderRecord: EnterpriseEntity,
  ctx: EnterpriseModuleActionContext,
): Promise<EnterpriseModuleActionResult> {
  if (str(orderRecord.fields.scheduleCommitted)) {
    return { ok: false, message: 'A schedule has already been committed for this order.' };
  }
  const order = productionOrderFromRecord(orderRecord);
  const product = order.product;
  if (!product || order.productionQuantity <= 0) {
    return { ok: false, message: 'Set a finished product and planned quantity before committing a schedule.' };
  }

  const routingModule = ctx.moduleFor(ROUTINGS_MODULE_ID);
  const machineModule = ctx.moduleFor(MACHINES_MODULE_ID);
  const scheduleModule = ctx.moduleFor(PRODUCTION_SCHEDULES_MODULE_ID);
  const ordersModule = ctx.moduleFor(PRODUCTION_ORDERS_MODULE_ID);
  if (!routingModule || !machineModule || !scheduleModule || !ordersModule) {
    return { ok: false, error: 'Scheduling modules are not available.' };
  }
  // Human-approved write: assert the schedule module's own write permission (manufacturing:manage).
  ctx.authorize(scheduleModule.descriptor.permissions.write);
  await Promise.all([routingModule.store.load(), machineModule.store.load(), scheduleModule.store.load()]);

  const routing: Routing | undefined = routingModule.store
    .list()
    .map(routingFromRecord)
    .find((r) => r.product === product && r.status === 'active' && r.operations.length > 0);
  if (!routing) return { ok: false, message: `No active routing found for product ${product}.` };

  const machines: Machine[] = machineModule.store.list().map(machineFromRecord);
  const nowMs = Date.parse(ctx.now());
  const plan = scheduleProductionOrderRouting(
    { ref: order.orderNumber, product, quantity: order.productionQuantity, releaseDate: '', requiredDate: '', onCriticalPath: false },
    routing,
    machines,
    nowMs,
  );

  const fieldSets = buildScheduleRecordFields(plan, order.orderNumber);
  if (fieldSets.length === 0) {
    const blocked = plan.operations.find((o) => !o.scheduled);
    return { ok: false, message: blocked ? `Cannot schedule ${routing.routingNumber}: ${blocked.blockedReason}` : `Routing ${routing.routingNumber} has no schedulable operations.` };
  }

  const createdIds: string[] = [];
  for (const fields of fieldSets) {
    const validation = validateEnterpriseRecordInput(scheduleModule.descriptor, { fields });
    if (!validation.ok) return { ok: false, error: `Schedule: ${Object.values(validation.errors)[0] ?? 'invalid input'}` };
    const rec = scheduleModule.store.create({
      title: deriveRecordTitle(scheduleModule.descriptor, validation.values),
      fields: validation.values,
      // Transaction-graph spine: every schedule is caused by the production order
      // (fan-out — each child shares the order's correlationId).
      metadata: childCorrelationMeta(orderRecord, PRODUCTION_ORDERS_MODULE_ID),
      actor: ctx.actor(),
      now: ctx.now(),
    });
    ctx.emit(scheduleModule, 'created', rec);
    createdIds.push(rec.id);
  }

  const updated = ordersModule.store.update(orderRecord.id, {
    fields: { scheduleCommitted: createdIds.join(',') },
    // Root the transaction at the production order when it is a genuine origin.
    metadata: rootMetaIfUnset(orderRecord, PRODUCTION_ORDERS_MODULE_ID),
    actor: ctx.actor(),
    now: ctx.now(),
  });
  ctx.emit(ordersModule, 'updated', updated ?? orderRecord);

  const blockedCount = plan.operations.filter((o) => !o.scheduled).length;
  const suffix = blockedCount > 0 ? ` (${blockedCount} operation(s) still blocked)` : '';
  return { ok: true, message: `Committed ${createdIds.length} scheduled operation(s) for ${order.orderNumber} via routing ${routing.routingNumber}${suffix}.` };
}
