/**
 * The one place that knows which purchase-order FIELDS the analysis means.
 *
 * The discovery engine takes `PurchaseOrderObservation`, not `EnterpriseEntity`,
 * precisely so this translation is explicit and testable: `fields.unitCost` is
 * the per-unit price and `fields.total` is not, and an engine that read records
 * directly could silently analyse the wrong column forever while every unit
 * test passed. Naming the mapping once, here, is what makes that mistake
 * visible.
 *
 * Electron-free — stores are passed in.
 */
import type {
  EnterpriseEntity,
  ExecutionObservation,
  PurchaseOrderObservation,
} from '@neuropause/shared';
import type { EnterpriseRecordStore } from '../enterprise/framework/enterpriseRecordStore';

/**
 * Bounded: the engine is arithmetic, but an unbounded read is still a scan.
 *
 * Exported because the ceiling has to travel WITH the data. `list` returns the
 * most-recently-updated rows and silently drops the rest, so an analysis that
 * hits this limit has seen a slice and must say so rather than presenting it
 * as the whole picture.
 */
export const MAX_ORDERS = 5_000;

function text(value: unknown): string {
  return value === null || value === undefined ? '' : String(value).trim();
}

function num(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(text(value));
  return Number.isFinite(n) ? n : 0;
}

/**
 * Read live purchase orders as observations.
 *
 * `createdAt` is used as the order date because the module has no order-date
 * field — `expectedDelivery` is a delivery date, and dating an order by when it
 * is due to arrive would place it in the wrong window. The substitution is
 * declared to the reader in the finding's "what we don't know", not hidden.
 */
export function purchaseOrdersAsObservations(
  store: EnterpriseRecordStore,
): PurchaseOrderObservation[] {
  return store
    .list({ status: 'active', limit: MAX_ORDERS })
    .map((record: EnterpriseEntity): PurchaseOrderObservation => {
      const f = record.fields;
      return {
        recordId: record.id,
        reference: text(f.poNumber) || record.title || record.id,
        supplier: text(f.supplier),
        product: text(f.product),
        quantity: num(f.quantity),
        unitCost: num(f.unitCost),
        currency: text(f.currency).toUpperCase() || 'INR',
        status: text(f.status),
        orderedAt: record.createdAt,
        warehouse: text(f.warehouse) || null,
      };
    });
}

/**
 * An RFQ already covering this product, if one is open.
 *
 * Matched on the product code the same way the engine groups on it (trimmed,
 * case-insensitive) — comparing differently here would let a second RFQ be
 * created for a product the analysis considers the same one.
 */
export function findOpenRfq(
  store: EnterpriseRecordStore,
  product: string,
): { recordId: string; label: string } | null {
  const wanted = product.trim().toUpperCase();
  const match = store
    .list({ status: 'active', limit: MAX_ORDERS })
    .find(
      (r) =>
        // Case-insensitive: a hand-entered "Open" that this missed would let a
        // duplicate RFQ be created for a product already being sourced.
        text(r.fields.status).toLowerCase() === 'open' &&
        text(r.fields.product).toUpperCase() === wanted,
    );
  return match ? { recordId: match.id, label: text(match.fields.rfqNumber) || match.title } : null;
}

/**
 * One RFQ read as the measurement engine needs to see it.
 *
 * The RFQ is the execution; its `awardedOrder` is the transaction the
 * execution produced. Those two facts are the whole action → outcome join, and
 * naming the field mapping here (rather than in the engine) keeps the engine
 * free of any knowledge of how procurement stores its records.
 */
export function rfqAsExecution(
  store: EnterpriseRecordStore,
  recordId: string,
): ExecutionObservation | null {
  const record = store.get(recordId);
  if (!record) return null;
  const awarded = text(record.fields.awardedOrder);
  return {
    moduleId: 'procurement-rfqs',
    recordId: record.id,
    label: text(record.fields.rfqNumber) || record.title || record.id,
    createdAt: record.createdAt,
    status: text(record.fields.status),
    awardedOrderId: awarded || null,
    awardedSupplier: text(record.fields.awardedSupplier) || null,
    awardedAt: text(record.fields.awardedAt) || null,
    product: text(record.fields.product),
    currency: text(record.fields.currency).toUpperCase() || null,
    sourceOpportunity: text(record.fields.sourceOpportunity) || null,
  };
}

/**
 * The fields for a new RFQ.
 *
 * The number is derived from the highest existing `RFQ-nnnn` rather than the
 * record count: counting breaks the moment one is archived, and a reused
 * reference on a sourcing document is the kind of thing that is discovered
 * during an audit rather than during development.
 *
 * The scan spans EVERY status for the same reason. `list` defaults to active
 * records, so scanning the default would archive `RFQ-0007` and then hand the
 * number straight back out — exactly the defect this function was written to
 * avoid, reintroduced by the default argument.
 */
export function rfqFieldsFor(
  store: EnterpriseRecordStore,
  input: {
    product: string;
    quantity: number;
    warehouse: string | null;
    notes: string;
    /** The finding's currency — carried so the awarded order is comparable. */
    currency: string;
    /** The finding's id — the machine-readable action → outcome join. */
    opportunityId: string;
  },
): { title: string; fields: Record<string, string | number> } {
  let highest = 0;
  const everyStatus = ['active', 'archived', 'deleted'] as const;
  for (const record of everyStatus.flatMap((status) =>
    store.list({ limit: MAX_ORDERS, status }),
  )) {
    const match = /^RFQ-(\d+)$/i.exec(text(record.fields.rfqNumber));
    if (match) highest = Math.max(highest, Number(match[1]));
  }
  const rfqNumber = `RFQ-${String(highest + 1).padStart(4, '0')}`;
  return {
    title: rfqNumber,
    fields: {
      rfqNumber,
      product: input.product,
      quantity: input.quantity,
      ...(input.warehouse ? { warehouse: input.warehouse } : {}),
      // Both carried from the finding: the currency so the awarded purchase
      // order can be compared against the orders that produced the finding,
      // and the opportunity id so the outcome can PROVE the execution belongs
      // to it rather than inferring it from free text.
      currency: input.currency,
      sourceOpportunity: input.opportunityId,
      status: 'open',
      notes: input.notes,
    },
  };
}
