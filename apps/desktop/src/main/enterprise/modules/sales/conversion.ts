/**
 * Quote Conversion — the deterministic "Convert Quote → Sales Order" transaction,
 * the next step in the ERP flow (Customer → Quote → **Sales Order** → Invoice →
 * Payment).
 *
 * From one accepted Quote it raises a Sales Order, cross-links the two (the order
 * carries `sourceQuote`; the quote is stamped with `convertedOrder` and moved to
 * `converted`), and emits each record's lifecycle so the whole chain is audited
 * and shows on the Timeline. It is:
 *   • guarded — only an `accepted` quote may be converted;
 *   • idempotent — a quote already converted is a no-op (never duplicates);
 *   • non-destructive — the quote is RETAINED (marked converted), never deleted,
 *     so audit history is preserved.
 *
 * Pure orchestration over the framework via the injected action context (it owns
 * no persistence of its own), so it unit-tests with in-memory modules.
 */
import type { EnterpriseEntity, EnterpriseModuleActionResult } from '@neuropause/shared';
import {
  ORDERS_MODULE_ID,
  QUOTES_MODULE_ID,
  calculateQuoteTotal,
  deriveRecordTitle,
  quoteFromRecord,
} from '@neuropause/shared';
import type { EnterpriseModuleActionContext } from '../../framework';

/** The descriptor action key the Quotes module surfaces for conversion. */
export const CONVERT_TO_ORDER_ACTION = 'convertToOrder';

const str = (v: unknown): string => (v === null || v === undefined ? '' : String(v));

/**
 * Convert an accepted Quote into a Sales Order. Resolves the target module from
 * the action context, so no module is imported here (no cross-module cycles).
 */
export async function convertQuoteToOrder(
  quote: EnterpriseEntity,
  ctx: EnterpriseModuleActionContext,
): Promise<EnterpriseModuleActionResult> {
  // Already converted → no-op. Never raise a second order.
  if (str(quote.fields.convertedOrder)) {
    return { ok: false, message: 'This quote has already been converted.' };
  }
  // Only an accepted quote becomes an order.
  if (str(quote.fields.status) !== 'accepted') {
    return { ok: false, message: 'Only an accepted quote can be converted to a sales order.' };
  }

  const ordersModule = ctx.moduleFor(ORDERS_MODULE_ID);
  const quotesModule = ctx.moduleFor(QUOTES_MODULE_ID);
  if (!ordersModule || !quotesModule) {
    return { ok: false, error: 'Sales modules are not all available for conversion.' };
  }

  // Assert the actor may write the target (shares sales:manage with Quotes,
  // already authorized by the action handler — future-proofs a scope change).
  ctx.authorize(ordersModule.descriptor.permissions.write);
  await ordersModule.store.load();

  const q = quoteFromRecord(quote);
  const total = calculateQuoteTotal(q);

  // Raise the Sales Order, cross-linked back to the originating quote.
  const validation = ordersModule.hooks.validate({
    fields: {
      orderNumber: `SO-${q.quoteNumber}`,
      customer: q.customer,
      contact: q.contact,
      status: 'pending',
      orderDate: q.issueDate,
      currency: q.currency,
      total,
      salesRep: q.salesRep,
      paymentTerms: q.paymentTerms,
      deliveryTerms: str(quote.fields.deliveryTerms),
      notes: str(quote.fields.notes),
      sourceQuote: quote.id,
    },
  });
  if (!validation.ok) {
    const first = Object.values(validation.errors)[0] ?? 'invalid input';
    return { ok: false, error: `Sales Order: ${first}` };
  }
  const order = ordersModule.store.create({
    title: deriveRecordTitle(ordersModule.descriptor, validation.values),
    fields: validation.values,
    actor: ctx.actor(),
    now: ctx.now(),
  });
  ctx.emit(ordersModule, 'created', order);

  // Retain + cross-link the quote (never delete): stamp the order ref and move it
  // to `converted`, then emit `converted` so the conversion is audited + on the
  // Timeline. The pricing stamps are unaffected by the status/ref change.
  const updatedQuote = quotesModule.store.update(quote.id, {
    fields: { convertedOrder: order.id, status: 'converted' },
    actor: ctx.actor(),
    now: ctx.now(),
  });
  ctx.emit(quotesModule, 'converted', updatedQuote ?? quote);

  return { ok: true, message: `Converted to sales order "${order.title}".` };
}
