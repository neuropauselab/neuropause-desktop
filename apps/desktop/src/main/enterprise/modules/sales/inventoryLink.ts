/**
 * Sales ↔ Inventory link — the seam that lets a Sales Order reserve, ship, and
 * release real stock by posting Stock Movements into the shared inventory ledger.
 * It EXTENDS Sales without changing its behaviour: everything here is guarded by
 * the order carrying a `product` + `warehouse` + `orderedQty`, so orders without
 * inventory linkage behave exactly as before (no movements posted).
 *
 * Movements are created through the Stock Movements module (validate → store →
 * reconcile the product's derived stock), reusing the awaited cross-module
 * `onChange` reconciler — the same machinery Payments uses to reconcile invoices.
 */
import type { EnterpriseEntity } from '@neuropause/shared';
import { ORDERS_MODULE_ID, STOCK_MOVEMENTS_MODULE_ID, movementFromRecord, type MovementType } from '@neuropause/shared';
import type { EnterpriseModuleActionContext } from '../../framework';
import { postStockMovement } from '../inventory/postMovement';

/** The descriptor action key the Orders module surfaces for reserving stock. */
export const RESERVE_STOCK_ACTION = 'reserveStock';

const str = (v: unknown): string => (v === null || v === undefined ? '' : String(v));
const num = (v: unknown): number => (typeof v === 'number' ? v : Number(str(v)) || 0);

interface OrderStockRef {
  id: string;
  orderNumber: string;
  product: string;
  warehouse: string;
  qty: number;
}

function orderStockRef(order: EnterpriseEntity): OrderStockRef | null {
  const product = str(order.fields.product);
  const warehouse = str(order.fields.warehouse);
  const qty = num(order.fields.orderedQty);
  if (!product || !warehouse || qty <= 0) return null;
  return { id: order.id, orderNumber: str(order.fields.orderNumber) || order.title, product, warehouse, qty };
}

/** Net reserved quantity currently held by an order in the ledger. */
function orderNetReserved(ctx: EnterpriseModuleActionContext, orderId: string): number {
  const mv = ctx.moduleFor(STOCK_MOVEMENTS_MODULE_ID);
  if (!mv) return 0;
  return mv.store
    .list()
    .map(movementFromRecord)
    .filter((m) => m.referenceModule === ORDERS_MODULE_ID && m.referenceRecord === orderId)
    .reduce((s, m) => {
      if (m.status === 'void') return s;
      if (m.type === 'reservation') return s + Math.abs(m.quantity);
      if (m.type === 'reservation_release') return s - Math.abs(m.quantity);
      return s;
    }, 0);
}

/** Post one movement into the ledger for this order (via the shared seam). */
async function postMovement(
  ctx: EnterpriseModuleActionContext,
  ref: OrderStockRef,
  type: MovementType,
  suffix: string,
): Promise<boolean> {
  const record = await postStockMovement(ctx, {
    movementNumber: `MV-${ref.orderNumber}-${suffix}`,
    type,
    product: ref.product,
    warehouse: ref.warehouse,
    quantity: ref.qty,
    referenceModule: ORDERS_MODULE_ID,
    referenceRecord: ref.id,
    reason: `Sales order ${ref.orderNumber}`,
  });
  return record !== null;
}

/** Reserve stock for an order (guarded; idempotent — no double reservation). */
export async function reserveOrderStock(
  order: EnterpriseEntity,
  ctx: EnterpriseModuleActionContext,
): Promise<{ ok: boolean; message?: string }> {
  const ref = orderStockRef(order);
  if (!ref) return { ok: false, message: 'Set a product, warehouse, and quantity to reserve stock.' };
  if (orderNetReserved(ctx, ref.id) > 0) return { ok: false, message: 'Stock is already reserved for this order.' };
  const ok = await postMovement(ctx, ref, 'reservation', 'RES');
  return ok
    ? { ok: true, message: `Reserved ${ref.qty} of ${ref.product}.` }
    : { ok: false, message: 'Could not reserve stock.' };
}

/** Ship an order's stock: issue on-hand + release any reservation. Guarded/no-op without linkage. */
export async function shipOrderStock(
  order: EnterpriseEntity,
  ctx: EnterpriseModuleActionContext,
): Promise<void> {
  const ref = orderStockRef(order);
  if (!ref) return;
  await postMovement(ctx, ref, 'issue', 'ISS');
  if (orderNetReserved(ctx, ref.id) > 0) await postMovement(ctx, ref, 'reservation_release', 'REL');
}

/** Release an order's reservation on cancel. Guarded/no-op without an active reservation. */
export async function releaseOrderStock(
  order: EnterpriseEntity,
  ctx: EnterpriseModuleActionContext,
): Promise<void> {
  const ref = orderStockRef(order);
  if (!ref) return;
  if (orderNetReserved(ctx, ref.id) > 0) await postMovement(ctx, ref, 'reservation_release', 'REL');
}
