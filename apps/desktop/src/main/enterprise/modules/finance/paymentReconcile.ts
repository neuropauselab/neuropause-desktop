/**
 * ERP Session 61 — the ONE authoritative subsidiary-ledger reconciliation for
 * payments, shared by the customer-payment module, the vendor-payment module,
 * and the new payment-reversal module so all three derive an invoice/bill's
 * `amountPaid` the SAME way.
 *
 * The only behavioral change over the pre-S61 inline reconcilers is ADDITIVE and
 * inert until a reversal exists: a payment whose id appears in an effective
 * `finance-payment-reversals` record is EXCLUDED from the applied ledger, so a
 * governed reversal re-opens the referenced invoice/bill WITHOUT mutating the
 * original payment (D4: the original stays immutable historical truth). With no
 * reversal records registered — every path that predates S61 — `reversedOriginal
 * PaymentIds` returns an empty set and the derivation is byte-identical to the
 * behavior the finance suites already pin.
 *
 * Electron-free; the stores + context are injected, so it unit-tests directly.
 */
import type { EnterpriseEntity } from '@neuropause/shared';
import {
  FINANCE_MODULE_ID,
  VENDOR_BILLS_MODULE_ID,
  deriveInvoiceAmountPaid,
  invoiceFromRecord,
  paymentFromRecord,
  sumClearedVendorPayments,
  vendorBillFromRecord,
  vendorPaymentFromRecord,
} from '@neuropause/shared';
import type { EnterpriseModuleActionContext, EnterpriseRecordStore } from '../../framework';

/** The canonical id of the governed payment-reversals module (S61). Local, non-frozen. */
export const PAYMENT_REVERSALS_MODULE_ID = 'finance-payment-reversals';

/** Which payment ledger a reversal offsets. */
export type ReversalKind = 'customer' | 'vendor';

function str(v: unknown): string {
  return v === null || v === undefined ? '' : String(v);
}

/**
 * The set of ORIGINAL payment record ids that carry an effective (non-deleted)
 * reversal of the given kind. Read live from the reversal store via the context;
 * absent module ⇒ empty set ⇒ no exclusion (pre-S61 behavior preserved exactly).
 */
export function reversedOriginalPaymentIds(
  ctx: EnterpriseModuleActionContext,
  kind: ReversalKind,
): Set<string> {
  const rev = ctx.moduleFor(PAYMENT_REVERSALS_MODULE_ID);
  const ids = new Set<string>();
  if (!rev) return ids;
  for (const r of rev.store.list()) {
    if (r.status === 'deleted') continue;
    if (str(r.fields.originalKind) !== kind) continue;
    const id = str(r.fields.originalPaymentId);
    if (id) ids.add(id);
  }
  return ids;
}

/** Resolve an invoice by record id or by its invoice number (the payment-module rule). */
function findInvoice(invoiceStore: EnterpriseRecordStore, ref: string): EnterpriseEntity | null {
  if (!ref) return null;
  const byId = invoiceStore.get(ref);
  if (byId && byId.status !== 'deleted') return byId;
  return invoiceStore.list().find((r) => str(r.fields.number) === ref) ?? null;
}

/** Resolve a vendor bill by record id or by its bill number. */
function findBill(billStore: EnterpriseRecordStore, ref: string): EnterpriseEntity | null {
  if (!ref) return null;
  const byId = billStore.get(ref);
  if (byId && byId.status !== 'deleted') return byId;
  return billStore.list().find((r) => str(r.fields.billNumber) === ref) ?? null;
}

/**
 * Re-derive the referenced invoice's paid amount from the customer-payment
 * ledger (excluding reversed originals) and persist it through the invoice's OWN
 * validate hook — the exact pre-S61 reconcileInvoice, factored out and given the
 * additive reversal exclusion. `paymentsStore` is the customer-payment store.
 */
export async function reconcileInvoiceFromLedger(
  paymentsStore: EnterpriseRecordStore,
  ref: string,
  ctx: EnterpriseModuleActionContext,
): Promise<void> {
  if (!ref) return;
  const invModule = ctx.moduleFor(FINANCE_MODULE_ID);
  if (!invModule) return;
  await invModule.store.load();
  const invRecord = findInvoice(invModule.store, ref);
  if (!invRecord) return;
  const invoice = invoiceFromRecord(invRecord);
  const reversedIds = reversedOriginalPaymentIds(ctx, 'customer');
  const ledger = paymentsStore
    .list()
    .filter((rec) => !reversedIds.has(rec.id))
    .map(paymentFromRecord)
    .filter((p) => p.invoiceRef === invRecord.id || p.invoiceRef === invoice.number);
  const amountPaid = deriveInvoiceAmountPaid(ledger);
  const merged = { ...invRecord.fields, amountPaid };
  const validation = invModule.hooks.validate({ fields: merged });
  const values = validation.ok ? validation.values : merged;
  const updated = invModule.store.update(invRecord.id, {
    fields: values,
    actor: ctx.actor(),
    now: ctx.now(),
  });
  if (updated) ctx.emit(invModule, 'updated', updated);
}

/**
 * Re-derive the referenced vendor bill's paid amount from the cleared vendor-
 * payment ledger (excluding reversed originals) and persist it — the exact
 * pre-S61 reconcileBill, factored out with the additive reversal exclusion.
 * `vendorPaymentsStore` is the vendor-payment store.
 */
export async function reconcileBillFromLedger(
  vendorPaymentsStore: EnterpriseRecordStore,
  ref: string,
  ctx: EnterpriseModuleActionContext,
): Promise<void> {
  if (!ref) return;
  const billModule = ctx.moduleFor(VENDOR_BILLS_MODULE_ID);
  if (!billModule) return;
  await billModule.store.load();
  const billRecord = findBill(billModule.store, ref);
  if (!billRecord) return;
  const bill = vendorBillFromRecord(billRecord);
  const reversedIds = reversedOriginalPaymentIds(ctx, 'vendor');
  const ledger = vendorPaymentsStore
    .list()
    .filter((rec) => !reversedIds.has(rec.id))
    .map(vendorPaymentFromRecord);
  const amountPaid = sumClearedVendorPayments([billRecord.id, bill.billNumber], ledger);
  const fullyPaid = Math.round((amountPaid - bill.total) * 100) >= 0 && bill.total > 0;
  const paidDate = fullyPaid ? (str(billRecord.fields.paidDate) || ctx.now().slice(0, 10)) : '';
  const unchanged =
    Math.round((bill.amountPaid - amountPaid) * 100) === 0 &&
    str(billRecord.fields.paidDate) === paidDate;
  if (unchanged) return;
  const status = str(billRecord.fields.cancelledAt)
    ? 'cancelled'
    : paidDate
      ? 'paid'
      : str(billRecord.fields.approvedAt)
        ? 'approved'
        : 'draft';
  const updated = billModule.store.update(billRecord.id, {
    fields: { amountPaid, paidDate, status },
    actor: ctx.actor(),
    now: ctx.now(),
  });
  if (updated) ctx.emit(billModule, 'updated', updated);
}
