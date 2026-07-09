/**
 * Sales → Orders — Sales Order domain types + pure deterministic business logic.
 *
 * A Sales Order is a typed *projection* of the framework's flat `EnterpriseEntity`
 * — the Enterprise Module Framework owns persistence, CRUD, RBAC, audit, timeline,
 * search, and UI. This file adds the order-specific typing, the DETERMINISTIC
 * fulfillment/shipment/revenue/delivery rules (`calculateOrderStatus`,
 * `calculateFulfillment`, `calculateShipmentProgress`, `calculateRevenueRecognition`,
 * `calculateDeliveryRisk`, `identifyDelayedOrders`) the AI explains but never
 * replaces, the lifecycle-action transitions (ship/fulfill/close/cancel), and the
 * aggregate insights the Executive Center surfaces. Pure (no I/O).
 */
import type { EnterpriseEntity, EnterpriseFieldValue, EnterpriseRiskLevel } from './enterpriseModule';
import type { ExecutiveKpi } from './executiveCenter';

export type OrderStatus = 'pending' | 'shipped' | 'fulfilled' | 'closed' | 'cancelled';
export const ORDER_STATUSES: readonly OrderStatus[] = [
  'pending',
  'shipped',
  'fulfilled',
  'closed',
  'cancelled',
];

/** In-flight statuses — the order is still being worked. */
export const OPEN_ORDER_STATUSES: readonly OrderStatus[] = ['pending', 'shipped'];
/** Terminal-delivered statuses — the goods reached the customer. */
export const DELIVERED_ORDER_STATUSES: readonly OrderStatus[] = ['fulfilled', 'closed'];

/** The lifecycle actions the module surfaces as record-action buttons. */
export type OrderAction = 'ship' | 'fulfill' | 'close' | 'cancel';

/** The Orders module id + record kind (the framework store key). */
export const ORDERS_MODULE_ID = 'sales-orders';
export const ORDER_KIND = 'order';

const DAY_MS = 86_400_000;

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
  orderedQty: number;
  fulfilledQty: number;
  orderDate: string;
  expectedDeliveryDate: string;
  shippedDate: string;
  deliveredDate: string;
  carrier: string;
  trackingNumber: string;
  salesRep: string;
  createdAt: string;
  updatedAt: string;
}

const STATUS_LABELS: Record<OrderStatus, string> = {
  pending: 'Pending',
  shipped: 'Shipped',
  fulfilled: 'Fulfilled',
  closed: 'Closed',
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
    orderedQty: num(f.orderedQty),
    fulfilledQty: num(f.fulfilledQty),
    orderDate: str(f.orderDate),
    expectedDeliveryDate: str(f.expectedDeliveryDate),
    shippedDate: str(f.shippedDate),
    deliveredDate: str(f.deliveredDate),
    carrier: str(f.carrier),
    trackingNumber: str(f.trackingNumber),
    salesRep: str(f.salesRep),
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

/* ── deterministic business logic (AI explains; it never sets these) ───────── */

const clamp = (n: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, n));

function parseDay(date: string): number | null {
  if (!date) return null;
  const t = Date.parse(date);
  return Number.isFinite(t) ? t : null;
}

/**
 * Fulfillment 0..100. Uses the ordered/fulfilled quantities when present; else
 * falls back to the lifecycle status. Deterministic.
 */
export function calculateFulfillment(order: SalesOrder): number {
  if (order.status === 'fulfilled' || order.status === 'closed') return 100;
  if (order.status === 'cancelled') return 0;
  if (order.orderedQty > 0) {
    return clamp(Math.round((order.fulfilledQty / order.orderedQty) * 100), 0, 100);
  }
  return order.status === 'shipped' ? 50 : 0;
}

/** Progress through the shipment lifecycle 0..100. Deterministic. */
export function calculateShipmentProgress(order: SalesOrder): number {
  switch (order.status) {
    case 'shipped':
      return 60;
    case 'fulfilled':
    case 'closed':
      return 100;
    default:
      return 0; // pending / cancelled
  }
}

export interface RevenueRecognition {
  recognized: number;
  pending: number;
}

/**
 * Revenue recognition — recognized proportionally to fulfillment (full on close;
 * zero on cancel). The remainder is pending. Deterministic.
 */
export function calculateRevenueRecognition(order: SalesOrder): RevenueRecognition {
  if (order.status === 'cancelled') return { recognized: 0, pending: 0 };
  if (order.status === 'closed') return { recognized: Math.round(order.total), pending: 0 };
  const recognized = Math.round((order.total * calculateFulfillment(order)) / 100);
  return { recognized, pending: Math.max(0, Math.round(order.total) - recognized) };
}

/**
 * Delivery risk 0..100 — rises when an open order is overdue or the deadline is
 * near, plus a small bump when it has not even shipped. Delivered/closed/cancelled
 * orders carry no delivery risk. Deterministic.
 */
export function calculateDeliveryRisk(order: SalesOrder, nowMs: number): number {
  if (
    order.status === 'fulfilled' ||
    order.status === 'closed' ||
    order.status === 'cancelled'
  ) {
    return 0;
  }
  let risk = 0;
  const expected = parseDay(order.expectedDeliveryDate);
  if (expected !== null) {
    const days = (expected - nowMs) / DAY_MS;
    if (days < 0) risk = 60 + -days * 5;
    else if (days <= 3) risk = 40;
    else if (days <= 7) risk = 20;
  }
  if (order.status === 'pending') risk += 15;
  return clamp(Math.round(risk), 0, 100);
}

export type OrderStage = 'open' | 'in_transit' | 'delivered' | 'closed' | 'cancelled';

export interface OrderStatusAssessment {
  stage: OrderStage;
  delayed: boolean;
  health: EnterpriseRiskLevel;
  reason: string;
}

/** Whether an open order has slipped past its expected delivery date. */
function isDelayed(order: SalesOrder, nowMs: number): boolean {
  if (!(OPEN_ORDER_STATUSES as readonly string[]).includes(order.status)) return false;
  const expected = parseDay(order.expectedDeliveryDate);
  return expected !== null && expected < nowMs;
}

/**
 * Deterministic derived status — maps the stored status to an operational stage,
 * flags delay, and assigns a health band with a reason. Used by the summary and
 * the KPIs; never overrides the stored status.
 */
export function calculateOrderStatus(order: SalesOrder, nowMs: number): OrderStatusAssessment {
  const stage: OrderStage =
    order.status === 'pending'
      ? 'open'
      : order.status === 'shipped'
        ? 'in_transit'
        : order.status === 'fulfilled'
          ? 'delivered'
          : order.status === 'closed'
            ? 'closed'
            : 'cancelled';
  const delayed = isDelayed(order, nowMs);
  if (order.status === 'cancelled') return { stage, delayed, health: 'low', reason: 'Cancelled.' };
  if (order.status === 'closed') return { stage, delayed, health: 'low', reason: 'Closed.' };
  if (order.status === 'fulfilled') return { stage, delayed, health: 'low', reason: 'Delivered.' };
  const risk = calculateDeliveryRisk(order, nowMs);
  if (delayed) return { stage, delayed, health: 'high', reason: 'Past expected delivery.' };
  if (risk >= 60) return { stage, delayed, health: 'high', reason: `High delivery risk (${risk}/100).` };
  if (risk >= 30) return { stage, delayed, health: 'medium', reason: `Delivery risk (${risk}/100).` };
  if (order.status === 'pending') return { stage, delayed, health: 'medium', reason: 'Awaiting shipment.' };
  return { stage, delayed, health: 'low', reason: 'On track.' };
}

/** Open orders that have slipped past their expected delivery date. */
export function identifyDelayedOrders(orders: SalesOrder[], nowMs: number): SalesOrder[] {
  return orders.filter((o) => isDelayed(o, nowMs));
}

/* ── lifecycle transitions (deterministic; the actions apply these) ────────── */

/** Legal target status for each action, given the current status (null = illegal). */
const ACTION_TARGET: Record<OrderAction, (from: OrderStatus) => OrderStatus | null> = {
  ship: (from) => (from === 'pending' ? 'shipped' : null),
  fulfill: (from) => (from === 'shipped' ? 'fulfilled' : null),
  close: (from) => (from === 'fulfilled' ? 'closed' : null),
  cancel: (from) => (from === 'pending' || from === 'shipped' ? 'cancelled' : null),
};

/**
 * The deterministic field patch a lifecycle action applies, or null when the
 * transition is illegal from the order's current status. `nowIso` is the injected
 * clock (ISO); date fields are stamped as YYYY-MM-DD.
 */
export function orderActionPatch(
  action: OrderAction,
  order: SalesOrder,
  nowIso: string,
): Record<string, EnterpriseFieldValue> | null {
  const target = ACTION_TARGET[action](order.status);
  if (!target) return null;
  const day = nowIso.slice(0, 10);
  const patch: Record<string, EnterpriseFieldValue> = { status: target };
  if (action === 'ship') patch.shippedDate = day;
  if (action === 'fulfill') {
    patch.deliveredDate = day;
    // Full fulfillment on delivery (quantity tracking is optional).
    patch.fulfilledQty = order.orderedQty > 0 ? order.orderedQty : order.fulfilledQty;
  }
  return patch;
}

/** The now-independent computed fields stamped onto every order write. */
export function orderComputedFields(order: SalesOrder): Record<string, EnterpriseFieldValue> {
  return {
    fulfillmentPct: calculateFulfillment(order),
    shipmentProgress: calculateShipmentProgress(order),
    recognizedRevenue: calculateRevenueRecognition(order).recognized,
  };
}

export interface OrderSignals {
  assessment: OrderStatusAssessment;
  fulfillment: number;
  shipmentProgress: number;
  revenue: RevenueRecognition;
  deliveryRisk: number;
}

/** Compute every deterministic signal for an order at once. */
export function computeOrderSignals(order: SalesOrder, nowMs: number): OrderSignals {
  return {
    assessment: calculateOrderStatus(order, nowMs),
    fulfillment: calculateFulfillment(order),
    shipmentProgress: calculateShipmentProgress(order),
    revenue: calculateRevenueRecognition(order),
    deliveryRisk: calculateDeliveryRisk(order, nowMs),
  };
}

function money(value: number): string {
  return value.toLocaleString(undefined, { maximumFractionDigits: 0 });
}

/** Deterministic summary + fulfillment/revenue framing — the no-model fallback. */
export function orderSummaryFallback(
  order: SalesOrder,
  signals: OrderSignals,
): { summary: string; executiveExplanation: string } {
  const summary =
    `${order.orderNumber} for ${order.customer || 'a customer'} is ${orderStatusLabel(order.status).toLowerCase()} ` +
    `— ${signals.fulfillment}% fulfilled, ${money(signals.revenue.recognized)} recognized of ${money(Math.round(order.total))}. ` +
    `${signals.assessment.reason}` +
    (signals.assessment.delayed ? ' This order is delayed.' : '');
  const executiveExplanation =
    signals.assessment.health === 'high'
      ? `${order.orderNumber} needs attention (${signals.deliveryRisk}/100 delivery risk) with ${money(signals.revenue.pending)} revenue pending.`
      : `${order.orderNumber} is ${signals.assessment.stage.replace('_', ' ')} at ${signals.fulfillment}% fulfillment.`;
  return { summary, executiveExplanation };
}

/* ── aggregate insights (Executive Center) ─────────────────────────────────── */

export interface OrderModuleInsights {
  totalOrders: number;
  ordersOpen: number;
  ordersDelivered: number;
  ordersDelayed: number;
  revenuePending: number;
  fulfillmentRate: number;
  averageDeliveryDays: number;
}

/** Roll a set of active orders into the Sales fulfillment KPIs. Pure. */
export function deriveOrderInsights(orders: SalesOrder[], nowMs: number): OrderModuleInsights {
  let open = 0;
  let delivered = 0;
  let pendingRev = 0;
  let fulfillSum = 0;
  let deliveryDaysSum = 0;
  let deliveredWithDates = 0;
  for (const o of orders) {
    if ((OPEN_ORDER_STATUSES as readonly string[]).includes(o.status)) open += 1;
    if ((DELIVERED_ORDER_STATUSES as readonly string[]).includes(o.status)) delivered += 1;
    pendingRev += calculateRevenueRecognition(o).pending;
    fulfillSum += calculateFulfillment(o);
    const ordered = parseDay(o.orderDate);
    const deliveredAt = parseDay(o.deliveredDate);
    if (
      (DELIVERED_ORDER_STATUSES as readonly string[]).includes(o.status) &&
      ordered !== null &&
      deliveredAt !== null &&
      deliveredAt >= ordered
    ) {
      deliveryDaysSum += (deliveredAt - ordered) / DAY_MS;
      deliveredWithDates += 1;
    }
  }
  return {
    totalOrders: orders.length,
    ordersOpen: open,
    ordersDelivered: delivered,
    ordersDelayed: identifyDelayedOrders(orders, nowMs).length,
    revenuePending: Math.round(pendingRev),
    fulfillmentRate: orders.length === 0 ? 0 : Math.round(fulfillSum / orders.length),
    averageDeliveryDays: deliveredWithDates === 0 ? 0 : Math.round(deliveryDaysSum / deliveredWithDates),
  };
}

/** Map order insights to Executive Center KPI tiles (reuses the existing KPI type). */
export function orderInsightsToKpis(insights: OrderModuleInsights): ExecutiveKpi[] {
  const delayedBand: ExecutiveKpi['band'] =
    insights.ordersDelayed === 0 ? 'healthy' : insights.ordersDelayed <= 3 ? 'watch' : 'at-risk';
  const fulfillmentBand: ExecutiveKpi['band'] =
    insights.fulfillmentRate >= 75 ? 'healthy' : insights.fulfillmentRate >= 40 ? 'watch' : 'at-risk';
  return [
    { key: 'order-open', label: 'Orders Open', value: null, display: String(insights.ordersOpen), deepLink: 'enterprise/modules' },
    { key: 'order-delivered', label: 'Orders Delivered', value: null, display: String(insights.ordersDelivered), deepLink: 'enterprise/modules' },
    {
      key: 'order-delayed',
      label: 'Orders Delayed',
      value: null,
      display: `${insights.ordersDelayed} delayed`,
      band: delayedBand,
      deepLink: 'enterprise/modules',
    },
    { key: 'order-revenue-pending', label: 'Revenue Pending', value: null, display: money(insights.revenuePending), deepLink: 'enterprise/modules' },
    {
      key: 'order-fulfillment',
      label: 'Fulfillment Rate',
      value: insights.fulfillmentRate,
      display: `${insights.fulfillmentRate}%`,
      band: fulfillmentBand,
      deepLink: 'enterprise/modules',
    },
    { key: 'order-delivery-time', label: 'Avg Delivery Time', value: insights.averageDeliveryDays, display: `${insights.averageDeliveryDays}d`, deepLink: 'enterprise/modules' },
  ];
}
