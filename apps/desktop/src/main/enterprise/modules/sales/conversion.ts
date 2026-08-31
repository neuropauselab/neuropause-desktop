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
  FINANCE_MODULE_ID,
  ORDERS_MODULE_ID,
  QUOTES_MODULE_ID,
  calculateQuoteTotal,
  deriveRecordTitle,
  orderFromRecord,
  quoteFromRecord,
} from '@neuropause/shared';
import type { EnterpriseModuleActionContext } from '../../framework';
import { childCorrelationMeta, rootMetaIfUnset } from '../../framework';

/** The descriptor action key the Quotes module surfaces for conversion. */
export const CONVERT_TO_ORDER_ACTION = 'convertToOrder';
/** The descriptor action key the Orders module surfaces for invoicing. */
export const CONVERT_TO_INVOICE_ACTION = 'convertToInvoice';

/** Order statuses eligible to be invoiced (goods have at least shipped). */
const INVOICEABLE_ORDER_STATUSES = new Set(['shipped', 'fulfilled', 'closed']);

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
    // Transaction-graph spine: the order is caused by the quote, so it joins (or
    // starts, if the quote had none) the quote's business transaction.
    metadata: childCorrelationMeta(quote, QUOTES_MODULE_ID),
    actor: ctx.actor(),
    now: ctx.now(),
  });
  ctx.emit(ordersModule, 'created', order);

  // Retain + cross-link the quote (never delete): stamp the order ref and move it
  // to `converted`, then emit `converted` so the conversion is audited + on the
  // Timeline. The pricing stamps are unaffected by the status/ref change.
  const updatedQuote = quotesModule.store.update(quote.id, {
    fields: { convertedOrder: order.id, status: 'converted' },
    // Stamp the quote as the transaction root when it is not already part of one,
    // so a genuine origin self-identifies in a trace (a quote raised from a lead
    // keeps its inherited chain — `rootMetaIfUnset` returns {} in that case).
    metadata: rootMetaIfUnset(quote, QUOTES_MODULE_ID),
    actor: ctx.actor(),
    now: ctx.now(),
  });
  ctx.emit(quotesModule, 'converted', updatedQuote ?? quote);

  return { ok: true, message: `Converted to sales order "${order.title}".` };
}

/**
 * Convert an eligible Sales Order into a Finance Invoice — the loop-closing step
 * (Customer → Quote → Sales Order → **Invoice** → Payment). Resolves the Finance
 * module from the action context and authorizes its own write scope
 * (`operations:manage`), so a sales-only actor cannot mint invoices. Creates a
 * draft invoice whose subtotal is the order total (the order total already
 * reflects final pricing, so tax is not re-applied), cross-links both records
 * (invoice `sourceOrder`; order `convertedInvoice`, moved to `converted`), and
 * emits each lifecycle for audit + Timeline. Guarded (shipped/fulfilled/closed
 * only), idempotent, and non-destructive (the order is retained).
 */
export async function convertOrderToInvoice(
  order: EnterpriseEntity,
  ctx: EnterpriseModuleActionContext,
): Promise<EnterpriseModuleActionResult> {
  // Already invoiced → no-op. Never raise a second invoice.
  if (str(order.fields.convertedInvoice)) {
    return { ok: false, message: 'This order has already been invoiced.' };
  }
  // Only an order whose goods have shipped/delivered may be invoiced.
  if (!INVOICEABLE_ORDER_STATUSES.has(str(order.fields.status))) {
    return { ok: false, message: 'Only a shipped, fulfilled, or closed order can be invoiced.' };
  }

  const ordersModule = ctx.moduleFor(ORDERS_MODULE_ID);
  const invoiceModule = ctx.moduleFor(FINANCE_MODULE_ID);
  if (!ordersModule || !invoiceModule) {
    return { ok: false, error: 'Sales or Finance module is not available for conversion.' };
  }

  // Raising an invoice requires the Finance write scope, which is distinct from
  // the Sales scope the action handler already asserted.
  ctx.authorize(invoiceModule.descriptor.permissions.write);
  await invoiceModule.store.load();

  const o = orderFromRecord(order);

  // Draft invoice, subtotal = order total (already final; tax not re-applied).
  const validation = invoiceModule.hooks.validate({
    fields: {
      number: `INV-${o.orderNumber}`,
      customer: o.customer,
      amount: o.total,
      taxRate: 0,
      currency: o.currency,
      status: 'draft',
      paymentTerms: str(order.fields.paymentTerms) || 'net30',
      sourceOrder: order.id,
      notes: `Generated from sales order ${o.orderNumber}.`,
    },
  });
  if (!validation.ok) {
    const first = Object.values(validation.errors)[0] ?? 'invalid input';
    return { ok: false, error: `Invoice: ${first}` };
  }
  const invoice = invoiceModule.store.create({
    title: deriveRecordTitle(invoiceModule.descriptor, validation.values),
    fields: validation.values,
    // Transaction-graph spine: the invoice is caused by the order, inheriting the
    // order's correlation — so the invoice (and everything the invoice posts to
    // the GL) sits in the same transaction as the quote and the order.
    metadata: childCorrelationMeta(order, ORDERS_MODULE_ID),
    actor: ctx.actor(),
    now: ctx.now(),
  });
  ctx.emit(invoiceModule, 'created', invoice);

  // Retain + cross-link the order (never delete): stamp the invoice ref. The
  // order's fulfillment status is unchanged (an order can be fulfilled AND
  // invoiced); the `converted` lifecycle event records the invoicing for
  // audit + Timeline.
  const updatedOrder = ordersModule.store.update(order.id, {
    fields: { convertedInvoice: invoice.id },
    // Root the transaction at the order when it was created directly (no quote);
    // an order raised from a quote keeps its inherited chain (returns {}).
    metadata: rootMetaIfUnset(order, ORDERS_MODULE_ID),
    actor: ctx.actor(),
    now: ctx.now(),
  });
  ctx.emit(ordersModule, 'converted', updatedOrder ?? order);

  return { ok: true, message: `Invoice "${invoice.title}" raised from ${o.orderNumber}.` };
}
