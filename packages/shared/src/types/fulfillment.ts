/**
 * Finished-Goods Fulfillment — the deterministic CROSS-DOMAIN analytics that measure
 * the make → move → sell loop. It owns no records and no stock: finished goods
 * produced by Manufacturing (`production_output`) already land in the Inventory Ledger
 * as warehouse stock, and Warehouse pick/pack/ship already moves them — this file only
 * READS those existing records (Products, Production Orders, Sales Orders, Pick Lists,
 * Shipments) to compute the fulfillment picture. The Inventory Ledger stays the single
 * source of truth; nothing here duplicates it.
 *
 * Pure deterministic business logic the AI explains but never computes
 * (`calculateWarehouseAvailability`, `calculateFinishedGoodsAvailability`,
 * `calculateFulfillableOrders`, `calculateShipmentReadiness`,
 * `calculateProductionToShipmentLeadTime`, `calculateWarehouseThroughput`,
 * `calculateReservationEfficiency`, `calculateFulfillmentRate`,
 * `calculateWarehousePerformance`, `calculateDeliveryPerformance`). No I/O.
 */
import type { ExecutiveKpi } from './executiveCenter';
import type { Product } from './inventory';
import { calculateStockTurnover } from './inventory';
import type { ProductionOrder } from './manufacturing';
import type { SalesOrder } from './orders';
import type { PickList, Shipping } from './warehouse';

const DAY_MS = 24 * 60 * 60 * 1000;
const clamp = (n: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, n));
function parseDay(d: string): number | null {
  if (!d) return null;
  const t = Date.parse(d);
  return Number.isFinite(t) ? t : null;
}
function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

/* ── deterministic business logic (AI explains; it never sets these) ──────────*/

/** Total available (on-hand − reserved) stock across all products. Deterministic. */
export function calculateWarehouseAvailability(products: Product[]): number {
  return Math.round(products.reduce((s, p) => s + Math.max(0, p.availableStock), 0));
}

/** The SKUs that Manufacturing has produced (outputs of completed production orders). */
export function finishedGoodSkus(productionOrders: ProductionOrder[]): Set<string> {
  const set = new Set<string>();
  for (const o of productionOrders) if (o.status === 'completed' && o.product) set.add(o.product);
  return set;
}

/** Available stock of finished goods (products Manufacturing has produced). Deterministic. */
export function calculateFinishedGoodsAvailability(products: Product[], productionOrders: ProductionOrder[]): number {
  const fg = finishedGoodSkus(productionOrders);
  return Math.round(products.filter((p) => fg.has(p.sku)).reduce((s, p) => s + Math.max(0, p.availableStock), 0));
}

/** Count of pending sales orders whose product has enough available stock to ship. Deterministic. */
export function calculateFulfillableOrders(orders: SalesOrder[], products: Product[]): number {
  const bySku = new Map(products.map((p) => [p.sku, p]));
  return orders.filter((o) => {
    if (o.status !== 'pending' || !o.product || o.orderedQty <= 0) return false;
    const p = bySku.get(o.product);
    return p ? p.availableStock >= o.orderedQty : false;
  }).length;
}

/** Shipment readiness 0..100 — pending orders that are fulfillable now. Deterministic. */
export function calculateShipmentReadiness(orders: SalesOrder[], products: Product[]): number {
  const pending = orders.filter((o) => o.status === 'pending' && o.product && o.orderedQty > 0);
  if (pending.length === 0) return 100;
  return clamp(Math.round((calculateFulfillableOrders(pending, products) / pending.length) * 100), 0, 100);
}

/**
 * Average days from a finished good's production completion to its shipment, matched
 * by product SKU (earliest completion vs each shipment). Deterministic.
 */
export function calculateProductionToShipmentLeadTime(productionOrders: ProductionOrder[], shipments: Shipping[]): number {
  const completedByProduct = new Map<string, number>();
  for (const o of productionOrders) {
    if (o.status !== 'completed' || !o.product) continue;
    const t = parseDay(o.updatedAt) ?? parseDay(o.createdAt);
    if (t === null) continue;
    const cur = completedByProduct.get(o.product);
    if (cur === undefined || t < cur) completedByProduct.set(o.product, t);
  }
  const spans: number[] = [];
  for (const s of shipments) {
    if ((s.status !== 'shipped' && s.status !== 'delivered') || !s.product) continue;
    const shipT = parseDay(s.shippedDate);
    const prodT = completedByProduct.get(s.product);
    if (shipT !== null && prodT !== undefined && shipT >= prodT) spans.push((shipT - prodT) / DAY_MS);
  }
  return spans.length === 0 ? 0 : Math.round(mean(spans) * 10) / 10;
}

/** Total units shipped (throughput). Deterministic. */
export function calculateWarehouseThroughput(shipments: Shipping[]): number {
  return Math.round(
    shipments.filter((s) => s.status === 'shipped' || s.status === 'delivered').reduce((sum, s) => sum + Math.abs(s.quantity), 0),
  );
}

/** Reservation efficiency 0..100 — reserved picks that progressed to picked/packed/shipped. Deterministic. */
export function calculateReservationEfficiency(pickLists: PickList[]): number {
  const reserved = pickLists.filter((p) => p.status !== 'pending' && p.status !== 'cancelled');
  if (reserved.length === 0) return 100;
  const progressed = reserved.filter((p) => p.status === 'picked' || p.status === 'packed' || p.status === 'shipped');
  return clamp(Math.round((progressed.length / reserved.length) * 100), 0, 100);
}

/** Fulfillment rate 0..100 — orders shipped or beyond vs all non-cancelled. Deterministic. */
export function calculateFulfillmentRate(orders: SalesOrder[]): number {
  const active = orders.filter((o) => o.status !== 'cancelled');
  if (active.length === 0) return 100;
  const fulfilled = active.filter((o) => o.status === 'shipped' || o.status === 'fulfilled' || o.status === 'closed');
  return clamp(Math.round((fulfilled.length / active.length) * 100), 0, 100);
}

/** Order completion rate 0..100 — orders fulfilled/closed vs all non-cancelled. Deterministic. */
export function calculateOrderCompletionRate(orders: SalesOrder[]): number {
  const active = orders.filter((o) => o.status !== 'cancelled');
  if (active.length === 0) return 100;
  const done = active.filter((o) => o.status === 'fulfilled' || o.status === 'closed');
  return clamp(Math.round((done.length / active.length) * 100), 0, 100);
}

/** Order delivery performance 0..100 — delivered orders that met the expected date. Deterministic. */
export function calculateOrderDeliveryPerformance(orders: SalesOrder[]): number {
  const delivered = orders.filter(
    (o) => (o.status === 'fulfilled' || o.status === 'closed') && o.deliveredDate && o.expectedDeliveryDate,
  );
  if (delivered.length === 0) return 100;
  let onTime = 0;
  for (const o of delivered) {
    const exp = parseDay(o.expectedDeliveryDate);
    const del = parseDay(o.deliveredDate);
    if (exp !== null && del !== null && del <= exp) onTime += 1;
  }
  return Math.round((onTime / delivered.length) * 100);
}

/** Composite warehouse performance 0..100 — readiness + reservation + fulfillment. Deterministic. */
export function calculateWarehousePerformance(metrics: {
  shipmentReadiness: number;
  reservationEfficiency: number;
  fulfillmentRate: number;
}): number {
  return clamp(
    Math.round((metrics.shipmentReadiness + metrics.reservationEfficiency + metrics.fulfillmentRate) / 3),
    0,
    100,
  );
}

/* ── aggregate insights (Executive Center) ─────────────────────────────────── */

function money(value: number): string {
  return value.toLocaleString(undefined, { maximumFractionDigits: 0 });
}

export interface FulfillmentModuleInsights {
  finishedGoodsAvailable: number;
  ordersReadyToShip: number;
  warehouseThroughput: number;
  reservationSuccess: number;
  shipmentPerformance: number;
  fulfillmentRate: number;
  productionLeadTime: number;
  warehouseUtilization: number;
  inventoryVelocity: number;
  orderCompletionRate: number;
}

export interface FulfillmentInsightsInput {
  products: Product[];
  productionOrders: ProductionOrder[];
  orders: SalesOrder[];
  pickLists: PickList[];
  shipments: Shipping[];
}

/** Roll the make → move → sell records into the Fulfillment KPIs. Pure. */
export function deriveFulfillmentInsights(input: FulfillmentInsightsInput): FulfillmentModuleInsights {
  const onHand = input.products.reduce((s, p) => s + Math.max(0, p.currentStock), 0);
  const reserved = input.products.reduce((s, p) => s + Math.max(0, p.reservedStock), 0);
  const throughput = calculateWarehouseThroughput(input.shipments);
  const avgOnHand = input.products.length === 0 ? 0 : onHand / input.products.length;
  return {
    finishedGoodsAvailable: calculateFinishedGoodsAvailability(input.products, input.productionOrders),
    ordersReadyToShip: calculateFulfillableOrders(input.orders, input.products),
    warehouseThroughput: throughput,
    reservationSuccess: calculateReservationEfficiency(input.pickLists),
    shipmentPerformance: calculateShipmentReadiness(input.orders, input.products),
    fulfillmentRate: calculateFulfillmentRate(input.orders),
    productionLeadTime: calculateProductionToShipmentLeadTime(input.productionOrders, input.shipments),
    // Warehouse utilization here = how much on-hand stock is committed (reserved) to fulfillment.
    warehouseUtilization: onHand <= 0 ? 0 : clamp(Math.round((reserved / onHand) * 100), 0, 100),
    inventoryVelocity: calculateStockTurnover(throughput, avgOnHand),
    orderCompletionRate: calculateOrderCompletionRate(input.orders),
  };
}

/** Map fulfillment insights to Executive Center KPI tiles (reuses the existing KPI type). */
export function fulfillmentInsightsToKpis(insights: FulfillmentModuleInsights): ExecutiveKpi[] {
  const pctBand = (v: number): ExecutiveKpi['band'] => (v >= 90 ? 'healthy' : v >= 75 ? 'watch' : 'at-risk');
  return [
    { key: 'ful-fg-available', label: 'Finished Goods Available', value: insights.finishedGoodsAvailable, display: money(insights.finishedGoodsAvailable), deepLink: 'enterprise/modules' },
    { key: 'ful-ready', label: 'Orders Ready to Ship', value: insights.ordersReadyToShip, display: String(insights.ordersReadyToShip), deepLink: 'enterprise/modules' },
    { key: 'ful-throughput', label: 'Warehouse Throughput', value: insights.warehouseThroughput, display: money(insights.warehouseThroughput), deepLink: 'enterprise/modules' },
    { key: 'ful-reservation', label: 'Reservation Success', value: insights.reservationSuccess, display: `${insights.reservationSuccess}%`, band: pctBand(insights.reservationSuccess), deepLink: 'enterprise/modules' },
    { key: 'ful-shipment', label: 'Shipment Performance', value: insights.shipmentPerformance, display: `${insights.shipmentPerformance}%`, band: pctBand(insights.shipmentPerformance), deepLink: 'enterprise/modules' },
    { key: 'ful-rate', label: 'Fulfillment Rate', value: insights.fulfillmentRate, display: `${insights.fulfillmentRate}%`, band: pctBand(insights.fulfillmentRate), deepLink: 'enterprise/modules' },
    { key: 'ful-leadtime', label: 'Production Lead Time', value: insights.productionLeadTime, display: `${insights.productionLeadTime}d`, deepLink: 'enterprise/modules' },
    { key: 'ful-utilization', label: 'Warehouse Utilization', value: insights.warehouseUtilization, display: `${insights.warehouseUtilization}%`, band: insights.warehouseUtilization >= 90 ? 'at-risk' : insights.warehouseUtilization >= 75 ? 'watch' : 'healthy', deepLink: 'enterprise/modules' },
    { key: 'ful-velocity', label: 'Inventory Velocity', value: insights.inventoryVelocity, display: `${insights.inventoryVelocity}×`, deepLink: 'enterprise/modules' },
    { key: 'ful-completion', label: 'Order Completion Rate', value: insights.orderCompletionRate, display: `${insights.orderCompletionRate}%`, band: pctBand(insights.orderCompletionRate), deepLink: 'enterprise/modules' },
  ];
}
