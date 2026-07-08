/**
 * Sales → Orders — MINIMAL domain types.
 *
 * The Sales Order is the downstream target of the Quote → Order conversion, so it
 * must exist as a first-class framework module for that action to have somewhere
 * to write. This slice ships it deliberately minimal — the id/kind, the status
 * vocabulary, and a typed projection — reusing the framework for CRUD, RBAC,
 * audit, timeline, search, and UI. The rich Order logic (fulfillment health, AI
 * summary, Order KPIs, and the Order → Invoice conversion) lands in the dedicated
 * Sales → Orders increment. Pure (no I/O).
 */
import type { EnterpriseEntity } from './enterpriseModule';

export type OrderStatus = 'pending' | 'confirmed' | 'fulfilled' | 'invoiced' | 'cancelled';
export const ORDER_STATUSES: readonly OrderStatus[] = [
  'pending',
  'confirmed',
  'fulfilled',
  'invoiced',
  'cancelled',
];

/** The Orders module id + record kind (the framework store key). */
export const ORDERS_MODULE_ID = 'sales-orders';
export const ORDER_KIND = 'order';

/** A typed view over a sales-order record's flat fields (+ envelope timestamps). */
export interface SalesOrder {
  id: string;
  orderNumber: string;
  sourceQuote: string;
  customer: string;
  contact: string;
  status: OrderStatus;
  currency: string;
  total: number;
  salesRep: string;
  createdAt: string;
  updatedAt: string;
}

const STATUS_LABELS: Record<OrderStatus, string> = {
  pending: 'Pending',
  confirmed: 'Confirmed',
  fulfilled: 'Fulfilled',
  invoiced: 'Invoiced',
  cancelled: 'Cancelled',
};
export function orderStatusLabel(status: OrderStatus): string {
  return STATUS_LABELS[status] ?? status;
}

function str(v: unknown): string {
  return v === null || v === undefined ? '' : String(v);
}
function num(v: unknown): number {
  return typeof v === 'number' ? v : Number(str(v)) || 0;
}
function asStatus(v: unknown): OrderStatus {
  const s = str(v);
  return (ORDER_STATUSES as readonly string[]).includes(s) ? (s as OrderStatus) : 'pending';
}

/** Project a framework record into a typed sales order. */
export function orderFromRecord(record: EnterpriseEntity): SalesOrder {
  const f = record.fields;
  return {
    id: record.id,
    orderNumber: str(f.orderNumber) || record.title,
    sourceQuote: str(f.sourceQuote),
    customer: str(f.customer),
    contact: str(f.contact),
    status: asStatus(f.status),
    currency: str(f.currency) || 'USD',
    total: num(f.total),
    salesRep: str(f.salesRep),
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}
