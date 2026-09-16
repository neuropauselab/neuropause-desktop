/**
 * postStockMovement — the ONE seam any domain uses to post a real stock movement
 * into the Inventory Ledger. It validates through the Stock Movements module,
 * persists it, awaits the product reconciliation (the ledger stays the single
 * source of truth), and fans the movement out to audit + Timeline. Sales
 * (reserve/ship) and Procurement (goods receipt) both go through here — no domain
 * ever writes stock directly.
 */
import type { EnterpriseEntity, EnterpriseRecordMeta, MovementType } from '@neuropause/shared';
import { PRODUCTS_MODULE_ID, STOCK_MOVEMENTS_MODULE_ID, deriveRecordTitle } from '@neuropause/shared';
import type { EnterpriseModuleActionContext } from '../../framework';
import { childCorrelationMeta } from '../../framework';

const str = (v: unknown): string => (v === null || v === undefined ? '' : String(v));

/**
 * Standard-cost policy (ERP Session 5) — the ONE place a movement's unit cost is
 * resolved, so receipt, issue, production consumption/output and adjustments are
 * all valued on the same basis and the GL bridge is never starved of cost.
 *
 * A positive unitCost the caller supplied is authoritative (it already knows the
 * cost). Otherwise the cost is the product's standard cost, read from the
 * Products module by SKU or record id. A product with no standard cost resolves
 * to 0 — an honest "uncosted" movement that posts no GL entry (the derivations
 * refuse at zero value), never a guessed number.
 */
async function resolveStandardUnitCost(
  ctx: EnterpriseModuleActionContext,
  input: StockMovementInput,
): Promise<number> {
  if (typeof input.unitCost === 'number' && input.unitCost > 0) return input.unitCost;
  const products = ctx.moduleFor(PRODUCTS_MODULE_ID);
  if (!products) return input.unitCost ?? 0;
  await products.store.load();
  const rec =
    products.store.list().find((r) => str(r.fields.sku) === input.product) ??
    products.store.get(input.product);
  const std = rec ? Number(rec.fields.standardCost ?? 0) : 0;
  return Number.isFinite(std) && std > 0 ? std : input.unitCost ?? 0;
}

export interface StockMovementInput {
  movementNumber: string;
  type: MovementType;
  product: string;
  warehouse: string;
  /** Source location for a `transfer` leg (relocates on-hand `fromWarehouse` → `warehouse`). */
  fromWarehouse?: string;
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
  // Standard-cost policy: resolve the unit cost centrally (ERP Session 5) so the
  // GL bridge values every movement on one basis instead of the old unitCost=0.
  const unitCost = await resolveStandardUnitCost(ctx, input);
  const validation = mv.hooks.validate({
    fields: {
      movementNumber: input.movementNumber,
      type: input.type,
      product: input.product,
      warehouse: input.warehouse,
      fromWarehouse: input.fromWarehouse ?? '',
      quantity: input.quantity,
      unitCost,
      status: 'posted',
      referenceModule: input.referenceModule,
      referenceRecord: input.referenceRecord,
      reason: input.reason ?? '',
    },
  });
  if (!validation.ok) return null;
  // Transaction-graph spine: the movement inherits the correlation of the
  // document that caused it — the reference the caller already supplied. So a
  // movement shipped for a sales order, or received against a PO, joins the same
  // business transaction as its source. Best-effort: an unresolvable reference
  // simply leaves the movement unstamped (still a valid ledger entry).
  let correlation: EnterpriseRecordMeta | undefined;
  const sourceModule = input.referenceModule ? ctx.moduleFor(input.referenceModule) : null;
  if (sourceModule && input.referenceRecord) {
    await sourceModule.store.load();
    const source = sourceModule.store.get(input.referenceRecord);
    if (source) correlation = childCorrelationMeta(source, input.referenceModule);
  }
  const record = mv.store.create({
    title: deriveRecordTitle(mv.descriptor, validation.values),
    fields: validation.values,
    ...(correlation ? { metadata: correlation } : {}),
    actor: ctx.actor(),
    now: ctx.now(),
  });
  // Reconcile the product's derived stock (awaited), then fan out for the Timeline.
  await mv.hooks.onChange?.({ action: 'created', record }, ctx);
  ctx.emit(mv, 'created', record);
  return record;
}
