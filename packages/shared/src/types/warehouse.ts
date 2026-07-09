/**
 * Warehouse Operations — the EXECUTION layer over Inventory. Inventory remains the
 * accounting layer and the single source of truth: every stock effect a warehouse
 * operation produces is a REAL Stock Movement in the shared Inventory Ledger, never
 * a direct edit. This file holds the warehouse domain typing (Zones, Bins, Transfer
 * Orders, Pick Lists, Packing, Shipping, Cycle Counts, Stock Adjustments) and the
 * pure deterministic business logic the AI explains but never computes
 * (`calculateWarehouseAccuracy`, `calculateBinUtilization`, `calculatePickingEfficiency`,
 * `calculatePackingEfficiency`, `calculateShippingPerformance`, `calculateTransferPerformance`,
 * `calculateCycleCountVariance`, `calculateAdjustmentImpact`, `calculateWarehouseHealth`,
 * `calculateWarehouseCapacity`). Warehouse reuses the inventory engine
 * (`calculateWarehouseUtilization`, `calculateStockTurnover`) — it never re-derives stock.
 * Pure (no I/O).
 */
import type { EnterpriseEntity, EnterpriseRiskLevel } from './enterpriseModule';
import type { ExecutiveKpi } from './executiveCenter';
import type { Product } from './inventory';
import { calculateStockTurnover, calculateWarehouseUtilization } from './inventory';

/* ── module identity ───────────────────────────────────────────────────────── */

export const WAREHOUSE_ZONES_MODULE_ID = 'warehouse-zones';
export const WAREHOUSE_ZONE_KIND = 'warehouse-zone';
export const WAREHOUSE_BINS_MODULE_ID = 'warehouse-bins';
export const WAREHOUSE_BIN_KIND = 'warehouse-bin';
export const TRANSFER_ORDERS_MODULE_ID = 'warehouse-transfers';
export const TRANSFER_ORDER_KIND = 'transfer-order';
export const PICK_LISTS_MODULE_ID = 'warehouse-picks';
export const PICK_LIST_KIND = 'pick-list';
export const PACKING_MODULE_ID = 'warehouse-packing';
export const PACKING_KIND = 'packing';
export const SHIPPING_MODULE_ID = 'warehouse-shipping';
export const SHIPPING_KIND = 'shipping';
export const CYCLE_COUNTS_MODULE_ID = 'warehouse-cycle-counts';
export const CYCLE_COUNT_KIND = 'cycle-count';
export const STOCK_ADJUSTMENTS_MODULE_ID = 'warehouse-adjustments';
export const STOCK_ADJUSTMENT_KIND = 'stock-adjustment';

/**
 * The staging location a paired transfer routes through: the Transfer-Out leg moves
 * stock from the source into IN-TRANSIT, the Transfer-In leg moves it from IN-TRANSIT
 * into the destination. On a completed transfer the two legs net IN-TRANSIT back to
 * zero; while only the out leg is posted, IN-TRANSIT correctly shows goods in transit.
 */
export const IN_TRANSIT_LOCATION = 'IN-TRANSIT';

/* ── statuses ──────────────────────────────────────────────────────────────── */

export type ZoneStatus = 'active' | 'inactive';
export type BinStatus = 'available' | 'occupied' | 'full' | 'blocked';
export type TransferOrderStatus = 'draft' | 'approved' | 'in_transit' | 'completed' | 'cancelled';
export type PickListStatus = 'pending' | 'reserved' | 'picked' | 'packed' | 'shipped' | 'cancelled';
export type PackingStatus = 'pending' | 'packed' | 'cancelled';
export type ShippingStatus = 'pending' | 'shipped' | 'delivered' | 'cancelled';
export type CycleCountStatus = 'draft' | 'counted' | 'reconciled';
export type StockAdjustmentStatus = 'draft' | 'posted' | 'cancelled';

/** Adjustment reason categories — each posts a real signed `adjustment` movement. */
export type AdjustmentReason = 'damage' | 'expired' | 'lost' | 'found' | 'audit_correction';
export const ADJUSTMENT_REASONS: readonly AdjustmentReason[] = [
  'damage',
  'expired',
  'lost',
  'found',
  'audit_correction',
];

/** Transfers that are open (committed but not yet completed). */
export const OPEN_TRANSFER_STATUSES: readonly TransferOrderStatus[] = ['approved', 'in_transit'];
/** Transfers that count toward the success denominator (draft/cancelled excluded). */
const TRANSFER_INFLIGHT_STATUSES: readonly TransferOrderStatus[] = ['approved', 'in_transit', 'completed'];

const DAY_MS = 24 * 60 * 60 * 1000;

/* ── typed projections ─────────────────────────────────────────────────────── */

export interface Zone {
  id: string;
  name: string;
  code: string;
  warehouse: string;
  zoneType: string;
  capacity: number;
  status: ZoneStatus;
}

export interface Bin {
  id: string;
  code: string;
  zone: string;
  warehouse: string;
  capacity: number;
  occupied: number;
  status: BinStatus;
}

export interface TransferOrder {
  id: string;
  transferNumber: string;
  product: string;
  quantity: number;
  fromWarehouse: string;
  toWarehouse: string;
  reason: string;
  status: TransferOrderStatus;
  requestedDate: string;
  completedDate: string;
  reservationMovement: string;
  outMovement: string;
  inMovement: string;
  createdAt: string;
  updatedAt: string;
}

export interface PickList {
  id: string;
  pickNumber: string;
  salesOrder: string;
  product: string;
  warehouse: string;
  quantity: number;
  assignee: string;
  status: PickListStatus;
  reservationMovement: string;
  convertedPacking: string;
  createdAt: string;
  updatedAt: string;
}

export interface Packing {
  id: string;
  packNumber: string;
  pickList: string;
  product: string;
  quantity: number;
  packageType: string;
  weight: number;
  status: PackingStatus;
  convertedShipment: string;
  createdAt: string;
  updatedAt: string;
}

export interface Shipping {
  id: string;
  shipmentNumber: string;
  pickList: string;
  salesOrder: string;
  product: string;
  warehouse: string;
  quantity: number;
  carrier: string;
  trackingNumber: string;
  shippedDate: string;
  status: ShippingStatus;
  issueMovement: string;
  createdAt: string;
  updatedAt: string;
}

export interface CycleCount {
  id: string;
  countNumber: string;
  product: string;
  warehouse: string;
  systemQuantity: number;
  countedQuantity: number;
  countDate: string;
  counter: string;
  status: CycleCountStatus;
  adjustmentMovement: string;
  createdAt: string;
  updatedAt: string;
}

export interface StockAdjustment {
  id: string;
  adjustmentNumber: string;
  product: string;
  warehouse: string;
  quantity: number;
  reason: AdjustmentReason;
  unitCost: number;
  notes: string;
  status: StockAdjustmentStatus;
  adjustmentMovement: string;
  createdAt: string;
  updatedAt: string;
}

function str(v: unknown): string {
  return v === null || v === undefined ? '' : String(v);
}
function num(v: unknown): number {
  return typeof v === 'number' ? v : Number(str(v)) || 0;
}
function oneOf<T extends string>(v: unknown, all: readonly T[], fallback: T): T {
  const s = str(v);
  return (all as readonly string[]).includes(s) ? (s as T) : fallback;
}

export function zoneFromRecord(record: EnterpriseEntity): Zone {
  const f = record.fields;
  return {
    id: record.id,
    name: str(f.name) || record.title,
    code: str(f.code),
    warehouse: str(f.warehouse),
    zoneType: str(f.zoneType),
    capacity: num(f.capacity),
    status: oneOf<ZoneStatus>(f.status, ['active', 'inactive'], 'active'),
  };
}

export function binFromRecord(record: EnterpriseEntity): Bin {
  const f = record.fields;
  return {
    id: record.id,
    code: str(f.code) || record.title,
    zone: str(f.zone),
    warehouse: str(f.warehouse),
    capacity: num(f.capacity),
    occupied: num(f.occupied),
    status: oneOf<BinStatus>(f.status, ['available', 'occupied', 'full', 'blocked'], 'available'),
  };
}

export function transferOrderFromRecord(record: EnterpriseEntity): TransferOrder {
  const f = record.fields;
  return {
    id: record.id,
    transferNumber: str(f.transferNumber) || record.title,
    product: str(f.product),
    quantity: num(f.quantity),
    fromWarehouse: str(f.fromWarehouse),
    toWarehouse: str(f.toWarehouse),
    reason: str(f.reason),
    status: oneOf<TransferOrderStatus>(
      f.status,
      ['draft', 'approved', 'in_transit', 'completed', 'cancelled'],
      'draft',
    ),
    requestedDate: str(f.requestedDate),
    completedDate: str(f.completedDate),
    reservationMovement: str(f.reservationMovement),
    outMovement: str(f.outMovement),
    inMovement: str(f.inMovement),
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

export function pickListFromRecord(record: EnterpriseEntity): PickList {
  const f = record.fields;
  return {
    id: record.id,
    pickNumber: str(f.pickNumber) || record.title,
    salesOrder: str(f.salesOrder),
    product: str(f.product),
    warehouse: str(f.warehouse),
    quantity: num(f.quantity),
    assignee: str(f.assignee),
    status: oneOf<PickListStatus>(
      f.status,
      ['pending', 'reserved', 'picked', 'packed', 'shipped', 'cancelled'],
      'pending',
    ),
    reservationMovement: str(f.reservationMovement),
    convertedPacking: str(f.convertedPacking),
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

export function packingFromRecord(record: EnterpriseEntity): Packing {
  const f = record.fields;
  return {
    id: record.id,
    packNumber: str(f.packNumber) || record.title,
    pickList: str(f.pickList),
    product: str(f.product),
    quantity: num(f.quantity),
    packageType: str(f.packageType),
    weight: num(f.weight),
    status: oneOf<PackingStatus>(f.status, ['pending', 'packed', 'cancelled'], 'pending'),
    convertedShipment: str(f.convertedShipment),
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

export function shippingFromRecord(record: EnterpriseEntity): Shipping {
  const f = record.fields;
  return {
    id: record.id,
    shipmentNumber: str(f.shipmentNumber) || record.title,
    pickList: str(f.pickList),
    salesOrder: str(f.salesOrder),
    product: str(f.product),
    warehouse: str(f.warehouse),
    quantity: num(f.quantity),
    carrier: str(f.carrier),
    trackingNumber: str(f.trackingNumber),
    shippedDate: str(f.shippedDate),
    status: oneOf<ShippingStatus>(f.status, ['pending', 'shipped', 'delivered', 'cancelled'], 'pending'),
    issueMovement: str(f.issueMovement),
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

export function cycleCountFromRecord(record: EnterpriseEntity): CycleCount {
  const f = record.fields;
  return {
    id: record.id,
    countNumber: str(f.countNumber) || record.title,
    product: str(f.product),
    warehouse: str(f.warehouse),
    systemQuantity: num(f.systemQuantity),
    countedQuantity: num(f.countedQuantity),
    countDate: str(f.countDate),
    counter: str(f.counter),
    status: oneOf<CycleCountStatus>(f.status, ['draft', 'counted', 'reconciled'], 'draft'),
    adjustmentMovement: str(f.adjustmentMovement),
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

export function stockAdjustmentFromRecord(record: EnterpriseEntity): StockAdjustment {
  const f = record.fields;
  return {
    id: record.id,
    adjustmentNumber: str(f.adjustmentNumber) || record.title,
    product: str(f.product),
    warehouse: str(f.warehouse),
    quantity: num(f.quantity),
    reason: oneOf<AdjustmentReason>(f.reason, ADJUSTMENT_REASONS, 'audit_correction'),
    unitCost: num(f.unitCost),
    notes: str(f.notes),
    status: oneOf<StockAdjustmentStatus>(f.status, ['draft', 'posted', 'cancelled'], 'draft'),
    adjustmentMovement: str(f.adjustmentMovement),
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

/* ── deterministic business logic (AI explains; it never sets these) ──────────*/

const clamp = (n: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, n));
function parseDay(d: string): number | null {
  if (!d) return null;
  const t = Date.parse(d);
  return Number.isFinite(t) ? t : null;
}
function rate(part: number, whole: number): number {
  if (whole <= 0) return 100;
  return clamp(Math.round((part / whole) * 100), 0, 100);
}

/** Per-count quantity accuracy 0..100 — how close the count was to the system figure. */
export function cycleCountQuantityAccuracy(systemQuantity: number, countedQuantity: number): number {
  if (systemQuantity <= 0) return countedQuantity === 0 ? 100 : 0;
  const variance = Math.abs(countedQuantity - systemQuantity);
  return clamp(Math.round((1 - variance / systemQuantity) * 100), 0, 100);
}

/** Inventory accuracy 0..100 — mean quantity accuracy across cycle counts. Deterministic. */
export function calculateWarehouseAccuracy(
  rows: Array<Pick<CycleCount, 'systemQuantity' | 'countedQuantity'>>,
): number {
  if (rows.length === 0) return 100;
  const total = rows.reduce((s, r) => s + cycleCountQuantityAccuracy(r.systemQuantity, r.countedQuantity), 0);
  return Math.round(total / rows.length);
}

/** Bin utilization 0..100 — reuses the inventory utilization rule (no new math). Deterministic. */
export function calculateBinUtilization(capacity: number, occupied: number): number {
  return calculateWarehouseUtilization(capacity, occupied);
}

/** Picking efficiency 0..100 — picks advanced to picked/packed/shipped vs non-cancelled total. */
export function calculatePickingEfficiency(rows: Array<Pick<PickList, 'status'>>): number {
  const active = rows.filter((r) => r.status !== 'cancelled');
  const done = active.filter((r) => r.status === 'picked' || r.status === 'packed' || r.status === 'shipped');
  return rate(done.length, active.length);
}

/** Packing efficiency 0..100 — packed vs non-cancelled total. Deterministic. */
export function calculatePackingEfficiency(rows: Array<Pick<Packing, 'status'>>): number {
  const active = rows.filter((r) => r.status !== 'cancelled');
  const done = active.filter((r) => r.status === 'packed');
  return rate(done.length, active.length);
}

/** Shipping performance 0..100 — shipped/delivered vs non-cancelled total. Deterministic. */
export function calculateShippingPerformance(rows: Array<Pick<Shipping, 'status'>>): number {
  const active = rows.filter((r) => r.status !== 'cancelled');
  const done = active.filter((r) => r.status === 'shipped' || r.status === 'delivered');
  return rate(done.length, active.length);
}

/** Transfer success 0..100 — completed vs in-flight (draft/cancelled excluded). Deterministic. */
export function calculateTransferPerformance(rows: Array<Pick<TransferOrder, 'status'>>): number {
  const inflight = rows.filter((r) => (TRANSFER_INFLIGHT_STATUSES as readonly string[]).includes(r.status));
  const done = inflight.filter((r) => r.status === 'completed');
  return rate(done.length, inflight.length);
}

/** Signed cycle-count variance (counted − system). Positive = surplus found. Deterministic. */
export function calculateCycleCountVariance(systemQuantity: number, countedQuantity: number): number {
  return Math.round(countedQuantity - systemQuantity);
}

/** Net value impact of adjustments — Σ quantity × unit cost (signed). Deterministic. */
export function calculateAdjustmentImpact(rows: Array<Pick<StockAdjustment, 'quantity' | 'unitCost'>>): number {
  return Math.round(rows.reduce((s, r) => s + r.quantity * r.unitCost, 0));
}

export interface WarehouseHealth {
  level: EnterpriseRiskLevel;
  reason: string;
}

/** Deterministic warehouse health from the operational KPIs. */
export function calculateWarehouseHealth(metrics: {
  inventoryAccuracy: number;
  shippingPerformance: number;
  transferSuccess: number;
  adjustmentFrequency: number;
}): WarehouseHealth {
  if (metrics.inventoryAccuracy < 80) return { level: 'high', reason: 'Inventory accuracy below 80%.' };
  if (metrics.shippingPerformance < 80) return { level: 'medium', reason: 'Shipping performance is lagging.' };
  if (metrics.transferSuccess < 80) return { level: 'medium', reason: 'Transfers are not completing reliably.' };
  if (metrics.adjustmentFrequency > 10) return { level: 'medium', reason: 'High stock-adjustment volume.' };
  return { level: 'low', reason: 'Warehouse operating within targets.' };
}

export interface WarehouseCapacity {
  capacity: number;
  used: number;
  available: number;
  utilization: number;
}

/** Aggregate bin capacity + utilization for a set of bins. Deterministic. */
export function calculateWarehouseCapacity(bins: Bin[]): WarehouseCapacity {
  const capacity = bins.reduce((s, b) => s + Math.max(0, b.capacity), 0);
  const used = bins.reduce((s, b) => s + Math.max(0, b.occupied), 0);
  return {
    capacity,
    used,
    available: Math.max(0, capacity - used),
    utilization: calculateWarehouseUtilization(capacity, used),
  };
}

/** Human label for an adjustment reason. */
const ADJUSTMENT_LABELS: Record<AdjustmentReason, string> = {
  damage: 'Damage',
  expired: 'Expired',
  lost: 'Lost',
  found: 'Found',
  audit_correction: 'Audit Correction',
};
export function adjustmentReasonLabel(reason: AdjustmentReason): string {
  return ADJUSTMENT_LABELS[reason] ?? reason;
}

/* ── fallbacks (deterministic AI summaries) ────────────────────────────────── */

export function transferOrderSummaryFallback(t: TransferOrder): { summary: string; executiveExplanation: string } {
  const summary =
    `${t.transferNumber}: ${t.quantity} × ${t.product || 'items'} from ${t.fromWarehouse || '—'} to ${t.toWarehouse || '—'} ` +
    `is ${t.status.replace('_', ' ')}.` +
    (t.outMovement && t.inMovement ? ' Paired transfer movements posted.' : '');
  const executiveExplanation =
    t.status === 'completed'
      ? `${t.transferNumber} relocated ${t.quantity} of ${t.product} to ${t.toWarehouse}.`
      : `${t.transferNumber} is ${t.status.replace('_', ' ')}.`;
  return { summary, executiveExplanation };
}

export function cycleCountSummaryFallback(c: CycleCount): { summary: string; executiveExplanation: string } {
  const variance = calculateCycleCountVariance(c.systemQuantity, c.countedQuantity);
  const accuracy = cycleCountQuantityAccuracy(c.systemQuantity, c.countedQuantity);
  const summary =
    `${c.countNumber}: counted ${c.countedQuantity} vs system ${c.systemQuantity} for ${c.product || 'a product'} ` +
    `(variance ${variance >= 0 ? '+' : ''}${variance}, ${accuracy}% accurate), status ${c.status}.` +
    (c.adjustmentMovement ? ' Adjustment movement posted.' : '');
  const executiveExplanation =
    variance === 0
      ? `${c.countNumber} matched the system exactly.`
      : `${c.countNumber} found a ${variance >= 0 ? 'surplus' : 'shortfall'} of ${Math.abs(variance)} for ${c.product}.`;
  return { summary, executiveExplanation };
}

export function stockAdjustmentSummaryFallback(a: StockAdjustment): { summary: string; executiveExplanation: string } {
  const impact = calculateAdjustmentImpact([a]);
  const summary =
    `${a.adjustmentNumber}: ${a.quantity >= 0 ? '+' : ''}${a.quantity} of ${a.product || 'a product'} ` +
    `(${adjustmentReasonLabel(a.reason)}) at ${a.warehouse || '—'}, status ${a.status}.` +
    (a.adjustmentMovement ? ' Adjustment movement posted.' : '');
  const executiveExplanation =
    a.status === 'posted'
      ? `${a.adjustmentNumber} changed stock by ${a.quantity} (${adjustmentReasonLabel(a.reason)}), value impact ${money(impact)}.`
      : `${a.adjustmentNumber} is ${a.status}.`;
  return { summary, executiveExplanation };
}

/* ── aggregate insights (Executive Center) ─────────────────────────────────── */

function money(value: number): string {
  return value.toLocaleString(undefined, { maximumFractionDigits: 0 });
}

export interface WarehouseModuleInsights {
  inventoryAccuracy: number;
  pickingAccuracy: number;
  packingAccuracy: number;
  shippingPerformance: number;
  transferSuccess: number;
  averagePickTime: number;
  cycleCountAccuracy: number;
  warehouseUtilization: number;
  inventoryTurnover: number;
  adjustmentFrequency: number;
  openTransfers: number;
}

export interface WarehouseInsightsInput {
  bins: Bin[];
  transfers: TransferOrder[];
  picks: PickList[];
  packings: Packing[];
  shippings: Shipping[];
  cycleCounts: CycleCount[];
  adjustments: StockAdjustment[];
  products: Product[];
}

/** Average days from pick creation to its packed/shipped completion. Deterministic. */
function averagePickTime(picks: PickList[]): number {
  const completed = picks.filter((p) => p.status === 'packed' || p.status === 'shipped');
  const spans: number[] = [];
  for (const p of completed) {
    const start = parseDay(p.createdAt);
    const end = parseDay(p.updatedAt);
    if (start !== null && end !== null && end >= start) spans.push((end - start) / DAY_MS);
  }
  if (spans.length === 0) return 0;
  return Math.round((spans.reduce((a, b) => a + b, 0) / spans.length) * 10) / 10;
}

/** Roll the warehouse records into the Warehouse KPIs. Pure; reuses the inventory engine. */
export function deriveWarehouseInsights(input: WarehouseInsightsInput): WarehouseModuleInsights {
  const reconciledCounts = input.cycleCounts.filter((c) => c.status === 'reconciled' || c.status === 'counted');
  const exactCounts = reconciledCounts.filter(
    (c) => calculateCycleCountVariance(c.systemQuantity, c.countedQuantity) === 0,
  );
  const postedAdjustments = input.adjustments.filter((a) => a.status === 'posted');
  const shippedUnits = input.shippings
    .filter((s) => s.status === 'shipped' || s.status === 'delivered')
    .reduce((s, r) => s + Math.abs(r.quantity), 0);
  const onHandValues = input.products.map((p) => Math.max(0, p.currentStock));
  const averageStock =
    onHandValues.length === 0 ? 0 : onHandValues.reduce((a, b) => a + b, 0) / onHandValues.length;

  return {
    inventoryAccuracy: calculateWarehouseAccuracy(input.cycleCounts),
    pickingAccuracy: calculatePickingEfficiency(input.picks),
    packingAccuracy: calculatePackingEfficiency(input.packings),
    shippingPerformance: calculateShippingPerformance(input.shippings),
    transferSuccess: calculateTransferPerformance(input.transfers),
    averagePickTime: averagePickTime(input.picks),
    cycleCountAccuracy: reconciledCounts.length === 0 ? 100 : rate(exactCounts.length, reconciledCounts.length),
    warehouseUtilization: calculateWarehouseCapacity(input.bins).utilization,
    inventoryTurnover: calculateStockTurnover(shippedUnits, averageStock),
    adjustmentFrequency: postedAdjustments.length,
    openTransfers: input.transfers.filter((t) => (OPEN_TRANSFER_STATUSES as readonly string[]).includes(t.status))
      .length,
  };
}

/** Map warehouse insights to Executive Center KPI tiles (reuses the existing KPI type). */
export function warehouseInsightsToKpis(insights: WarehouseModuleInsights): ExecutiveKpi[] {
  const pctBand = (v: number): ExecutiveKpi['band'] => (v >= 90 ? 'healthy' : v >= 75 ? 'watch' : 'at-risk');
  const utilBand: ExecutiveKpi['band'] =
    insights.warehouseUtilization >= 90 ? 'at-risk' : insights.warehouseUtilization >= 75 ? 'watch' : 'healthy';
  const adjBand: ExecutiveKpi['band'] =
    insights.adjustmentFrequency === 0 ? 'healthy' : insights.adjustmentFrequency <= 10 ? 'watch' : 'at-risk';
  return [
    {
      key: 'wh-accuracy',
      label: 'Inventory Accuracy',
      value: insights.inventoryAccuracy,
      display: `${insights.inventoryAccuracy}%`,
      band: pctBand(insights.inventoryAccuracy),
      deepLink: 'enterprise/modules',
    },
    {
      key: 'wh-picking',
      label: 'Picking Accuracy',
      value: insights.pickingAccuracy,
      display: `${insights.pickingAccuracy}%`,
      band: pctBand(insights.pickingAccuracy),
      deepLink: 'enterprise/modules',
    },
    {
      key: 'wh-packing',
      label: 'Packing Accuracy',
      value: insights.packingAccuracy,
      display: `${insights.packingAccuracy}%`,
      band: pctBand(insights.packingAccuracy),
      deepLink: 'enterprise/modules',
    },
    {
      key: 'wh-shipping',
      label: 'Shipping Performance',
      value: insights.shippingPerformance,
      display: `${insights.shippingPerformance}%`,
      band: pctBand(insights.shippingPerformance),
      deepLink: 'enterprise/modules',
    },
    {
      key: 'wh-transfer',
      label: 'Transfer Success',
      value: insights.transferSuccess,
      display: `${insights.transferSuccess}%`,
      band: pctBand(insights.transferSuccess),
      deepLink: 'enterprise/modules',
    },
    {
      key: 'wh-pick-time',
      label: 'Average Pick Time',
      value: insights.averagePickTime,
      display: `${insights.averagePickTime}d`,
      deepLink: 'enterprise/modules',
    },
    {
      key: 'wh-cycle-accuracy',
      label: 'Cycle Count Accuracy',
      value: insights.cycleCountAccuracy,
      display: `${insights.cycleCountAccuracy}%`,
      band: pctBand(insights.cycleCountAccuracy),
      deepLink: 'enterprise/modules',
    },
    {
      key: 'wh-utilization',
      label: 'Warehouse Utilization',
      value: insights.warehouseUtilization,
      display: `${insights.warehouseUtilization}%`,
      band: utilBand,
      deepLink: 'enterprise/modules',
    },
    {
      key: 'wh-turnover',
      label: 'Inventory Turnover',
      value: insights.inventoryTurnover,
      display: `${insights.inventoryTurnover}×`,
      deepLink: 'enterprise/modules',
    },
    {
      key: 'wh-adjustments',
      label: 'Adjustment Frequency',
      value: insights.adjustmentFrequency,
      display: `${insights.adjustmentFrequency}`,
      band: adjBand,
      deepLink: 'enterprise/modules',
    },
  ];
}
