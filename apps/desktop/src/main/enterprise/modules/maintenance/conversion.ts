/**
 * Maintenance conversions — the deterministic maintenance flow transitions:
 *   Preventive / Corrective Maintenance → Work Order → Maintenance History.
 * Each resolves its target module from the action context, cross-links both records,
 * emits lifecycle for audit + Timeline, is idempotent, and never deletes. Pure
 * orchestration over the framework. Maintenance History is created from a REAL
 * completed work order — never fabricated.
 */
import type { EnterpriseEntity, EnterpriseModuleActionResult, WorkOrder } from '@neuropause/shared';
import {
  CORRECTIVE_MAINTENANCE_MODULE_ID,
  MAINTENANCE_HISTORY_MODULE_ID,
  PREVENTIVE_MAINTENANCE_MODULE_ID,
  WORK_ORDERS_MODULE_ID,
  calculateMaintenanceCost,
  correctiveMaintenanceFromRecord,
  deriveRecordTitle,
  preventiveMaintenanceFromRecord,
} from '@neuropause/shared';
import type { EnterpriseModuleActionContext } from '../../framework';

export const RAISE_WORK_ORDER_ACTION = 'raiseWorkOrder';

const str = (v: unknown): string => (v === null || v === undefined ? '' : String(v));

/** Preventive Maintenance → Work Order (preventive). Idempotent; cross-linked. */
export async function raiseWorkOrderFromPreventive(
  pm: EnterpriseEntity,
  ctx: EnterpriseModuleActionContext,
): Promise<EnterpriseModuleActionResult> {
  if (str(pm.fields.workOrder)) return { ok: false, message: 'A work order already exists for this PM.' };
  const woModule = ctx.moduleFor(WORK_ORDERS_MODULE_ID);
  const pmModule = ctx.moduleFor(PREVENTIVE_MAINTENANCE_MODULE_ID);
  if (!woModule || !pmModule) return { ok: false, error: 'Maintenance modules are not available.' };
  ctx.authorize(woModule.descriptor.permissions.write);
  await woModule.store.load();

  const p = preventiveMaintenanceFromRecord(pm);
  const validation = woModule.hooks.validate({
    fields: {
      workOrderNumber: `WO-${p.pmNumber}`,
      type: 'preventive',
      machine: p.machine,
      asset: p.asset,
      description: `Preventive maintenance ${p.pmNumber}`,
      scheduledDate: p.scheduledDate,
      status: 'scheduled',
    },
  });
  if (!validation.ok) return { ok: false, error: `Work Order: ${Object.values(validation.errors)[0] ?? 'invalid input'}` };
  const wo = woModule.store.create({ title: deriveRecordTitle(woModule.descriptor, validation.values), fields: validation.values, actor: ctx.actor(), now: ctx.now() });
  ctx.emit(woModule, 'created', wo);

  const updated = pmModule.store.update(pm.id, { fields: { workOrder: wo.id }, actor: ctx.actor(), now: ctx.now() });
  ctx.emit(pmModule, 'converted', updated ?? pm);
  return { ok: true, message: `Raised work order "${wo.title}".` };
}

/** Corrective Maintenance → Work Order (corrective). Idempotent; cross-linked. */
export async function raiseWorkOrderFromCorrective(
  cm: EnterpriseEntity,
  ctx: EnterpriseModuleActionContext,
): Promise<EnterpriseModuleActionResult> {
  if (str(cm.fields.workOrder)) return { ok: false, message: 'A work order already exists for this fault.' };
  const woModule = ctx.moduleFor(WORK_ORDERS_MODULE_ID);
  const cmModule = ctx.moduleFor(CORRECTIVE_MAINTENANCE_MODULE_ID);
  if (!woModule || !cmModule) return { ok: false, error: 'Maintenance modules are not available.' };
  ctx.authorize(woModule.descriptor.permissions.write);
  await woModule.store.load();

  const c = correctiveMaintenanceFromRecord(cm);
  const validation = woModule.hooks.validate({
    fields: {
      workOrderNumber: `WO-${c.cmNumber}`,
      type: 'corrective',
      machine: c.machine,
      asset: c.asset,
      priority: 'high',
      description: c.faultDescription || `Corrective maintenance ${c.cmNumber}`,
      status: 'scheduled',
    },
  });
  if (!validation.ok) return { ok: false, error: `Work Order: ${Object.values(validation.errors)[0] ?? 'invalid input'}` };
  const wo = woModule.store.create({ title: deriveRecordTitle(woModule.descriptor, validation.values), fields: validation.values, actor: ctx.actor(), now: ctx.now() });
  ctx.emit(woModule, 'created', wo);

  const updated = cmModule.store.update(cm.id, { fields: { workOrder: wo.id, status: 'in_progress' }, actor: ctx.actor(), now: ctx.now() });
  ctx.emit(cmModule, 'converted', updated ?? cm);
  return { ok: true, message: `Raised work order "${wo.title}".` };
}

/** Work Order → Maintenance History. Creates the permanent record of a real repair. */
export async function createMaintenanceHistory(
  workOrder: WorkOrder,
  ctx: EnterpriseModuleActionContext,
): Promise<string> {
  const historyModule = ctx.moduleFor(MAINTENANCE_HISTORY_MODULE_ID);
  if (!historyModule) return '';
  ctx.authorize(historyModule.descriptor.permissions.write);
  await historyModule.store.load();
  const validation = historyModule.hooks.validate({
    fields: {
      historyNumber: `MH-${workOrder.workOrderNumber}`,
      workOrder: workOrder.id,
      machine: workOrder.machine,
      asset: workOrder.asset,
      type: workOrder.type,
      technician: workOrder.technician,
      downtimeHours: workOrder.downtimeHours,
      totalCost: calculateMaintenanceCost([workOrder]),
      result: workOrder.result,
      completedDate: ctx.now().slice(0, 10),
    },
  });
  if (!validation.ok) return '';
  const history = historyModule.store.create({ title: deriveRecordTitle(historyModule.descriptor, validation.values), fields: validation.values, actor: ctx.actor(), now: ctx.now() });
  ctx.emit(historyModule, 'created', history);
  return history.id;
}
