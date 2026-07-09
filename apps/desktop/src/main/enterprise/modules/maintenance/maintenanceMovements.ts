/**
 * Maintenance → integration helpers. Two seams, both reusing existing authoritative
 * systems and never duplicating them:
 *
 *  • Spare-parts consumption posts a REAL `production_consumption` movement through
 *    the shared `postStockMovement` seam (Inventory Ledger stays the source of truth).
 *  • Machine write-back updates the AUTHORITATIVE Machine record (Manufacturing) —
 *    real downtime + status — so Manufacturing's availability / utilization / OEE
 *    KPIs derive from maintenance automatically. Writing the machine asserts
 *    `manufacturing:manage` (the machine is authoritative in Manufacturing), exactly
 *    as `postStockMovement` asserts `inventory:manage`.
 */
import type { EnterpriseEntity } from '@neuropause/shared';
import { MACHINES_MODULE_ID, machineFromRecord, type MachineStatus } from '@neuropause/shared';
import type { EnterpriseModuleActionContext } from '../../framework';
import { postStockMovement } from '../inventory/postMovement';

const str = (v: unknown): string => (v === null || v === undefined ? '' : String(v));

/** Resolve the authoritative Machine record by name, code, or id. */
export async function resolveMachineRecord(
  ctx: EnterpriseModuleActionContext,
  ref: string,
): Promise<EnterpriseEntity | null> {
  if (!ref) return null;
  const mod = ctx.moduleFor(MACHINES_MODULE_ID);
  if (!mod) return null;
  await mod.store.load();
  const rec =
    mod.store.list().find((r) => str(r.fields.name) === ref || str(r.fields.code) === ref) ?? mod.store.get(ref);
  return rec && rec.status !== 'deleted' ? rec : null;
}

/** Add real downtime hours to the authoritative machine (optionally set its status). */
export async function applyMachineDowntime(
  ctx: EnterpriseModuleActionContext,
  ref: string,
  hours: number,
  status?: MachineStatus,
): Promise<EnterpriseEntity | null> {
  const mod = ctx.moduleFor(MACHINES_MODULE_ID);
  const rec = await resolveMachineRecord(ctx, ref);
  if (!mod || !rec) return null;
  ctx.authorize(mod.descriptor.permissions.write); // requires manufacturing:manage
  const machine = machineFromRecord(rec);
  const fields: Record<string, string | number> = { downtime: Math.max(0, Math.round((machine.downtime + hours) * 10) / 10) };
  if (status) fields.status = status;
  const updated = mod.store.update(rec.id, { fields, actor: ctx.actor(), now: ctx.now() });
  if (updated) ctx.emit(mod, 'updated', updated);
  return updated;
}

/** Set the authoritative machine's operational status (e.g. maintenance → running). */
export async function setMachineStatus(
  ctx: EnterpriseModuleActionContext,
  ref: string,
  status: MachineStatus,
): Promise<EnterpriseEntity | null> {
  const mod = ctx.moduleFor(MACHINES_MODULE_ID);
  const rec = await resolveMachineRecord(ctx, ref);
  if (!mod || !rec) return null;
  ctx.authorize(mod.descriptor.permissions.write);
  const updated = mod.store.update(rec.id, { fields: { status }, actor: ctx.actor(), now: ctx.now() });
  if (updated) ctx.emit(mod, 'updated', updated);
  return updated;
}

export interface SparePartConsumptionArgs {
  movementNumber: string;
  product: string;
  warehouse: string;
  quantity: number;
  unitCost?: number;
  referenceModule: string;
  referenceRecord: string;
  reason: string;
}

/** Consume a spare part into a repair (`production_consumption` — lowers on-hand). */
export async function postSparePartConsumption(
  ctx: EnterpriseModuleActionContext,
  args: SparePartConsumptionArgs,
): Promise<EnterpriseEntity | null> {
  return postStockMovement(ctx, { ...args, type: 'production_consumption' });
}
