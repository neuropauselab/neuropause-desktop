/**
 * Procurement conversions — the deterministic buy-side flow transitions:
 *   Purchase Request → Purchase Order → Goods Receipt.
 * Each resolves its target module from the action context, cross-links both
 * records, emits lifecycle for audit + Timeline, is idempotent, and never
 * deletes. Pure orchestration over the framework (no persistence of its own).
 */
import type { EnterpriseEntity, EnterpriseModuleActionResult } from '@neuropause/shared';
import {
  GOODS_RECEIPTS_MODULE_ID,
  PURCHASE_ORDERS_MODULE_ID,
  PURCHASE_REQUESTS_MODULE_ID,
  deriveRecordTitle,
  purchaseOrderFromRecord,
  purchaseRequestFromRecord,
} from '@neuropause/shared';
import type { EnterpriseModuleActionContext } from '../../framework';
import { childCorrelationMeta, rootMetaIfUnset } from '../../framework';

export const CREATE_PO_ACTION = 'createPurchaseOrder';
export const RECEIVE_GOODS_ACTION = 'receiveGoods';

const str = (v: unknown): string => (v === null || v === undefined ? '' : String(v));

/** Purchase Request → Purchase Order. Only an approved request converts; idempotent. */
export async function convertRequestToPurchaseOrder(
  request: EnterpriseEntity,
  ctx: EnterpriseModuleActionContext,
): Promise<EnterpriseModuleActionResult> {
  if (str(request.fields.convertedOrder)) {
    return { ok: false, message: 'This request has already been converted to a purchase order.' };
  }
  if (str(request.fields.status) !== 'approved') {
    return { ok: false, message: 'Only an approved purchase request can become a purchase order.' };
  }
  const ordersModule = ctx.moduleFor(PURCHASE_ORDERS_MODULE_ID);
  const requestsModule = ctx.moduleFor(PURCHASE_REQUESTS_MODULE_ID);
  if (!ordersModule || !requestsModule) return { ok: false, error: 'Procurement modules are not available.' };
  ctx.authorize(ordersModule.descriptor.permissions.write);
  await ordersModule.store.load();

  const pr = purchaseRequestFromRecord(request);
  const validation = ordersModule.hooks.validate({
    fields: {
      poNumber: `PO-${pr.requestNumber}`,
      product: pr.product,
      quantity: pr.quantity,
      budget: pr.budget,
      status: 'draft',
      sourceRequest: request.id,
      // ERP Session 17 — carry the PR's multi-line content VERBATIM to the PO, so
      // PR line i ↔ PO line i is deterministic and no quantity is inflated during
      // conversion. Absent (single-product PR) → unchanged.
      ...(str(request.fields.lines).trim() ? { lines: str(request.fields.lines) } : {}),
    },
  });
  if (!validation.ok) {
    return { ok: false, error: `Purchase Order: ${Object.values(validation.errors)[0] ?? 'invalid input'}` };
  }
  const order = ordersModule.store.create({
    title: deriveRecordTitle(ordersModule.descriptor, validation.values),
    fields: validation.values,
    // Transaction-graph spine: the PO is caused by the purchase request.
    metadata: childCorrelationMeta(request, PURCHASE_REQUESTS_MODULE_ID),
    actor: ctx.actor(),
    now: ctx.now(),
  });
  ctx.emit(ordersModule, 'created', order);

  const updated = requestsModule.store.update(request.id, {
    fields: { convertedOrder: order.id, status: 'ordered' },
    // Root the transaction at the request when it is a genuine origin.
    metadata: rootMetaIfUnset(request, PURCHASE_REQUESTS_MODULE_ID),
    actor: ctx.actor(),
    now: ctx.now(),
  });
  ctx.emit(requestsModule, 'converted', updated ?? request);
  return { ok: true, message: `Created purchase order "${order.title}".` };
}

/** Purchase Order → Goods Receipt (pending). Idempotent; the order is retained + linked. */
export async function convertPurchaseOrderToReceipt(
  order: EnterpriseEntity,
  ctx: EnterpriseModuleActionContext,
): Promise<EnterpriseModuleActionResult> {
  if (str(order.fields.convertedReceipt)) {
    return { ok: false, message: 'A goods receipt already exists for this purchase order.' };
  }
  if (str(order.fields.status) === 'cancelled' || str(order.fields.status) === 'draft') {
    return { ok: false, message: 'Approve or send the purchase order before receiving goods.' };
  }
  const receiptsModule = ctx.moduleFor(GOODS_RECEIPTS_MODULE_ID);
  const ordersModule = ctx.moduleFor(PURCHASE_ORDERS_MODULE_ID);
  if (!receiptsModule || !ordersModule) return { ok: false, error: 'Procurement modules are not available.' };
  ctx.authorize(receiptsModule.descriptor.permissions.write);
  await receiptsModule.store.load();

  const po = purchaseOrderFromRecord(order);
  const validation = receiptsModule.hooks.validate({
    fields: {
      grNumber: `GR-${po.poNumber}`,
      purchaseOrder: order.id,
      supplier: po.supplier,
      product: po.product,
      warehouse: po.warehouse,
      quantityOrdered: po.quantity,
      quantityReceived: po.quantity,
      expectedDate: po.expectedDelivery,
      status: 'pending',
    },
  });
  if (!validation.ok) {
    return { ok: false, error: `Goods Receipt: ${Object.values(validation.errors)[0] ?? 'invalid input'}` };
  }
  const receipt = receiptsModule.store.create({
    title: deriveRecordTitle(receiptsModule.descriptor, validation.values),
    fields: validation.values,
    // Transaction-graph spine: the goods receipt is caused by the purchase order,
    // inheriting the request→PO chain.
    metadata: childCorrelationMeta(order, PURCHASE_ORDERS_MODULE_ID),
    actor: ctx.actor(),
    now: ctx.now(),
  });
  ctx.emit(receiptsModule, 'created', receipt);

  const updated = ordersModule.store.update(order.id, {
    fields: { convertedReceipt: receipt.id, status: 'received' },
    // Root at the PO when it was created directly (no request).
    metadata: rootMetaIfUnset(order, PURCHASE_ORDERS_MODULE_ID),
    actor: ctx.actor(),
    now: ctx.now(),
  });
  ctx.emit(ordersModule, 'converted', updated ?? order);
  return { ok: true, message: `Created goods receipt "${receipt.title}".` };
}
