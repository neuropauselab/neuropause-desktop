/**
 * Auto-reorder seam — the ONE orchestration both replenishment entry points
 * share (FW-6):
 *
 *   • the movement reconciler, after materializing a product's stock from the
 *     immutable ledger (automatic, opt-in per product via `autoReorder: on`);
 *   • the product's manual "Check Reorder" action (on demand, flag or no flag —
 *     a human pressing the button IS the opt-in).
 *
 * It computes the inventory position with the pure engine and, when the
 * product sits at or below its reorder level, drafts a purchase request
 * through the Purchase Requests module's OWN validate hook — a system-drafted
 * DRAFT, so the existing human approval → PO conversion flow (and FW-5's
 * budget control behind it) governs everything downstream. Nothing is ordered
 * automatically; paper is drafted automatically.
 *
 * The drafted request immediately counts as open supply, which is the
 * idempotency: the next movement sees the position restored and stays quiet.
 *
 * Pure orchestration over the framework (no persistence of its own); modules
 * resolve from the action context at runtime, so environments without
 * Procurement (unit tests, trimmed builds) degrade to an honest no-op.
 */
import type { EnterpriseEntity, EnterpriseModuleActionResult } from '@neuropause/shared';
import {
  PURCHASE_ORDERS_MODULE_ID,
  PURCHASE_REQUESTS_MODULE_ID,
  assessReorder,
  autoReorderRequestNumber,
  deriveRecordTitle,
  openSupplyForProduct,
  productFromRecord,
} from '@neuropause/shared';
import type { EnterpriseModuleActionContext } from '../../framework';

/** The Products-module action key for the on-demand check. */
export const REORDER_CHECK_ACTION = 'reorderCheck';

const str = (v: unknown): string => (v === null || v === undefined ? '' : String(v));

/**
 * Assess one product's replenishment need and draft the purchase request when
 * triggered. `trigger` distinguishes the automatic path (movement — requires
 * the product's `autoReorder: on`) from the manual action (always assesses).
 */
export async function runReorderCheck(
  productRecord: EnterpriseEntity,
  ctx: EnterpriseModuleActionContext,
  trigger: 'manual' | 'movement',
): Promise<EnterpriseModuleActionResult> {
  if (trigger === 'movement' && str(productRecord.fields.autoReorder) !== 'on') {
    return { ok: true, message: 'Auto-reorder is off for this product — nothing checked.' };
  }
  const requestsModule = ctx.moduleFor(PURCHASE_REQUESTS_MODULE_ID);
  if (!requestsModule) {
    return { ok: false, error: 'The Purchase Requests module is not available — replenishment needs Procurement.' };
  }
  const ordersModule = ctx.moduleFor(PURCHASE_ORDERS_MODULE_ID);
  await requestsModule.store.load();
  if (ordersModule) await ordersModule.store.load();

  const product = productFromRecord(productRecord);
  const openSupply = openSupplyForProduct({
    sku: product.sku,
    productId: productRecord.id,
    purchaseRequests: requestsModule.store.list(),
    purchaseOrders: ordersModule ? ordersModule.store.list() : [],
  });
  const assessment = assessReorder({ product, openSupply });
  if (!assessment.triggered) {
    return { ok: true, message: assessment.note };
  }

  const requestNumber = autoReorderRequestNumber(
    product.sku,
    requestsModule.store
      .list()
      .filter((r) => r.status !== 'deleted')
      .map((r) => str(r.fields.requestNumber)),
  );
  const validation = requestsModule.hooks.validate({
    fields: {
      requestNumber,
      department: 'Inventory',
      requester: trigger === 'manual' ? ctx.actor() : 'auto-reorder',
      product: product.sku,
      quantity: assessment.suggestedQuantity,
      // Stock already exhausted (or negative) is urgent; low-but-covered is high.
      priority: assessment.availableStock <= 0 ? 'urgent' : 'high',
      status: 'draft',
      reason: assessment.note,
    },
  });
  if (!validation.ok) {
    return {
      ok: false,
      error: `Replenishment request: ${Object.values(validation.errors)[0] ?? 'invalid input'}`,
    };
  }
  const request = requestsModule.store.create({
    title: deriveRecordTitle(requestsModule.descriptor, validation.values),
    fields: validation.values,
    actor: ctx.actor(),
    now: ctx.now(),
  });
  ctx.emit(requestsModule, 'created', request);
  return {
    ok: true,
    message: `Drafted ${requestNumber} for ${assessment.suggestedQuantity} ${product.unit || 'unit'}(s). ${assessment.note}`,
  };
}
