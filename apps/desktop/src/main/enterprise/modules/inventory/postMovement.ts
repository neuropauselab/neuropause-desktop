/**
 * postStockMovement — the ONE seam any domain uses to post a real stock movement
 * into the Inventory Ledger. It validates through the Stock Movements module,
 * persists it, awaits the product reconciliation (the ledger stays the single
 * source of truth), and fans the movement out to audit + Timeline. Sales
 * (reserve/ship) and Procurement (goods receipt) both go through here — no domain
 * ever writes stock directly.
 */
import type { EnterpriseEntity, MovementType } from '@neuropause/shared';
import { STOCK_MOVEMENTS_MODULE_ID, deriveRecordTitle } from '@neuropause/shared';
import type { EnterpriseModuleActionContext } from '../../framework';

export interface StockMovementInput {
  movementNumber: string;
  type: MovementType;
  product: string;
  warehouse: string;
  quantity: number;
  unitCost?: number;
  referenceModule: string;
  referenceRecord: string;
  reason?: string;
}

/**
 * Post a movement into the ledger. Returns the created movement record, or null
 * when the Inventory module is unavailable or the movement fails validation.
 * Requires (and asserts) the inventory write scope.
 */
export async function postStockMovement(
  ctx: EnterpriseModuleActionContext,
  input: StockMovementInput,
): Promise<EnterpriseEntity | null> {
  const mv = ctx.moduleFor(STOCK_MOVEMENTS_MODULE_ID);
  if (!mv) return null;
  ctx.authorize(mv.descriptor.permissions.write); // requires inventory:manage
  await mv.store.load();
  const validation = mv.hooks.validate({
    fields: {
      movementNumber: input.movementNumber,
      type: input.type,
      product: input.product,
      warehouse: input.warehouse,
      quantity: input.quantity,
      unitCost: input.unitCost ?? 0,
      status: 'posted',
      referenceModule: input.referenceModule,
      referenceRecord: input.referenceRecord,
      reason: input.reason ?? '',
    },
  });
  if (!validation.ok) return null;
  const record = mv.store.create({
    title: deriveRecordTitle(mv.descriptor, validation.values),
    fields: validation.values,
    actor: ctx.actor(),
    now: ctx.now(),
  });
  // Reconcile the product's derived stock (awaited), then fan out for the Timeline.
  await mv.hooks.onChange?.({ action: 'created', record }, ctx);
  ctx.emit(mv, 'created', record);
  return record;
}
