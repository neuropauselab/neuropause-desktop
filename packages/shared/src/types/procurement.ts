/**
 * Procurement — Supplier / Purchase Request / Purchase Order / Goods Receipt
 * types + pure deterministic business logic (the buy-side of the ERP flow:
 * Purchase Request → Purchase Order → Goods Receipt → Inventory receive movement).
 *
 * Goods Receipt posts a REAL `receive` movement into the Inventory Ledger — the
 * single source of truth for stock — so nothing here duplicates inventory math;
 * it reuses `calculateReorderRequirement` for replenishment. The deterministic
 * rules (`calculatePurchaseTotal`, `calculateSupplierPerformance`,
 * `calculateVendorRisk`, `calculateDeliveryPerformance`, `calculatePurchaseCycleTime`,
 * `calculateGoodsReceiptAccuracy`, `calculateInventoryReplenishment`,
 * `calculateProcurementSavings`, `calculateSupplierHealth`) are what the AI
 * explains but never computes. Pure (no I/O).
 */
import type { EnterpriseEntity, EnterpriseRiskLevel } from './enterpriseModule';
import type { ExecutiveKpi } from './executiveCenter';
import type { Product } from './inventory';
import { calculateReorderRequirement } from './inventory';

/* ── module identity ───────────────────────────────────────────────────────── */

export const SUPPLIERS_MODULE_ID = 'procurement-suppliers';
export const SUPPLIER_KIND = 'supplier';
export const PURCHASE_REQUESTS_MODULE_ID = 'procurement-requests';
export const PURCHASE_REQUEST_KIND = 'purchase-request';
export const PURCHASE_ORDERS_MODULE_ID = 'procurement-orders';
export const PURCHASE_ORDER_KIND = 'purchase-order';
export const GOODS_RECEIPTS_MODULE_ID = 'procurement-receipts';
export const GOODS_RECEIPT_KIND = 'goods-receipt';

/* ── statuses ──────────────────────────────────────────────────────────────── */

export type SupplierStatus = 'active' | 'onboarding' | 'suspended' | 'inactive';
export type PurchaseRequestStatus = 'draft' | 'pending' | 'approved' | 'rejected' | 'ordered';
export type PurchaseOrderStatus = 'draft' | 'approved' | 'sent' | 'received' | 'cancelled';
export type GoodsReceiptStatus = 'pending' | 'received' | 'rejected';
export type Priority = 'low' | 'medium' | 'high' | 'urgent';

export const PURCHASE_ORDER_STATUSES: readonly PurchaseOrderStatus[] = [
  'draft',
  'approved',
  'sent',
  'received',
  'cancelled',
];
/** In-flight POs awaiting delivery. */
export const OPEN_PO_STATUSES: readonly PurchaseOrderStatus[] = ['draft', 'approved', 'sent'];

export type PurchasePaymentTerms = 'prepaid' | 'net15' | 'net30' | 'net45' | 'net60';

const DAY_MS = 24 * 60 * 60 * 1000;

/* ── typed projections ─────────────────────────────────────────────────────── */

export interface Supplier {
  id: string;
  name: string;
  gst: string;
  pan: string;
  contactPerson: string;
  email: string;
  phone: string;
  bankDetails: string;
  paymentTerms: string;
  leadTime: number;
  vendorRating: number;
  status: SupplierStatus;
}

export interface PurchaseRequest {
  id: string;
  requestNumber: string;
  department: string;
  requester: string;
  product: string;
  quantity: number;
  requiredDate: string;
  priority: Priority;
  status: PurchaseRequestStatus;
  reason: string;
  budget: number;
  approver: string;
}

export interface PurchaseOrder {
  id: string;
  poNumber: string;
  supplier: string;
  product: string;
  warehouse: string;
  quantity: number;
  unitCost: number;
  subtotal: number;
  discount: number;
  tax: number;
  total: number;
  budget: number;
  currency: string;
  expectedDelivery: string;
  status: PurchaseOrderStatus;
  approvedBy: string;
  sourceRequest: string;
  createdAt: string;
  updatedAt: string;
}

export interface GoodsReceipt {
  id: string;
  grNumber: string;
  purchaseOrder: string;
  supplier: string;
  product: string;
  warehouse: string;
  quantityOrdered: number;
  quantityReceived: number;
  expectedDate: string;
  receiptDate: string;
  status: GoodsReceiptStatus;
  condition: string;
  receiptMovement: string;
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

export function supplierFromRecord(record: EnterpriseEntity): Supplier {
  const f = record.fields;
  return {
    id: record.id,
    name: str(f.name) || record.title,
    gst: str(f.gst),
    pan: str(f.pan),
    contactPerson: str(f.contactPerson),
    email: str(f.email),
    phone: str(f.phone),
    bankDetails: str(f.bankDetails),
    paymentTerms: str(f.paymentTerms),
    leadTime: num(f.leadTime),
    vendorRating: num(f.vendorRating),
    status: oneOf<SupplierStatus>(f.status, ['active', 'onboarding', 'suspended', 'inactive'], 'active'),
  };
}

export function purchaseRequestFromRecord(record: EnterpriseEntity): PurchaseRequest {
  const f = record.fields;
  return {
    id: record.id,
    requestNumber: str(f.requestNumber) || record.title,
    department: str(f.department),
    requester: str(f.requester),
    product: str(f.product),
    quantity: num(f.quantity),
    requiredDate: str(f.requiredDate),
    priority: oneOf<Priority>(f.priority, ['low', 'medium', 'high', 'urgent'], 'medium'),
    status: oneOf<PurchaseRequestStatus>(f.status, ['draft', 'pending', 'approved', 'rejected', 'ordered'], 'draft'),
    reason: str(f.reason),
    budget: num(f.budget),
    approver: str(f.approver),
  };
}

export function purchaseOrderFromRecord(record: EnterpriseEntity): PurchaseOrder {
  const f = record.fields;
  return {
    id: record.id,
    poNumber: str(f.poNumber) || record.title,
    supplier: str(f.supplier),
    product: str(f.product),
    warehouse: str(f.warehouse),
    quantity: num(f.quantity),
    unitCost: num(f.unitCost),
    subtotal: num(f.subtotal),
    discount: num(f.discount),
    tax: num(f.tax),
    total: num(f.total),
    budget: num(f.budget),
    currency: str(f.currency) || 'USD',
    expectedDelivery: str(f.expectedDelivery),
    status: oneOf<PurchaseOrderStatus>(f.status, PURCHASE_ORDER_STATUSES, 'draft'),
    approvedBy: str(f.approvedBy),
    sourceRequest: str(f.sourceRequest),
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

export function goodsReceiptFromRecord(record: EnterpriseEntity): GoodsReceipt {
  const f = record.fields;
  return {
    id: record.id,
    grNumber: str(f.grNumber) || record.title,
    purchaseOrder: str(f.purchaseOrder),
    supplier: str(f.supplier),
    product: str(f.product),
    warehouse: str(f.warehouse),
    quantityOrdered: num(f.quantityOrdered),
    quantityReceived: num(f.quantityReceived),
    expectedDate: str(f.expectedDate),
    receiptDate: str(f.receiptDate),
    status: oneOf<GoodsReceiptStatus>(f.status, ['pending', 'received', 'rejected'], 'pending'),
    condition: str(f.condition),
    receiptMovement: str(f.receiptMovement),
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

/** Authoritative PO total: subtotal − discount + tax (never negative). Deterministic. */
export function calculatePurchaseTotal(order: Pick<PurchaseOrder, 'subtotal' | 'discount' | 'tax'>): number {
  return Math.max(0, Math.round(order.subtotal - order.discount + order.tax));
}

/** Goods-receipt accuracy 0..100 — received vs ordered. Deterministic. */
export function calculateGoodsReceiptAccuracy(quantityOrdered: number, quantityReceived: number): number {
  if (quantityOrdered <= 0) return quantityReceived > 0 ? 100 : 0;
  return clamp(Math.round((quantityReceived / quantityOrdered) * 100), 0, 100);
}

/** Days from PO/order date to goods-receipt date. Deterministic. */
export function calculatePurchaseCycleTime(orderDate: string, receiptDate: string): number {
  const a = parseDay(orderDate);
  const b = parseDay(receiptDate);
  if (a === null || b === null || b < a) return 0;
  return Math.round((b - a) / DAY_MS);
}

export interface DeliveryRow {
  expectedDate: string;
  receiptDate: string;
  quantityOrdered: number;
  quantityReceived: number;
}

/** On-time delivery rate 0..100 across received rows. Deterministic. */
export function calculateDeliveryPerformance(rows: DeliveryRow[]): number {
  const dated = rows.filter((r) => r.receiptDate && r.expectedDate);
  if (dated.length === 0) return 100;
  let onTime = 0;
  for (const r of dated) {
    const exp = parseDay(r.expectedDate);
    const rec = parseDay(r.receiptDate);
    if (exp !== null && rec !== null && rec <= exp) onTime += 1;
  }
  return Math.round((onTime / dated.length) * 100);
}

/** Composite supplier performance 0..100 — on-time delivery + receipt accuracy. Deterministic. */
export function calculateSupplierPerformance(rows: DeliveryRow[]): number {
  if (rows.length === 0) return 0;
  const onTime = calculateDeliveryPerformance(rows);
  const accuracy = Math.round(
    rows.reduce((s, r) => s + calculateGoodsReceiptAccuracy(r.quantityOrdered, r.quantityReceived), 0) /
      rows.length,
  );
  return clamp(Math.round(onTime * 0.6 + accuracy * 0.4), 0, 100);
}

/** Vendor risk 0..100 — rises with a low rating, long lead time, and poor delivery. Deterministic. */
export function calculateVendorRisk(supplier: Supplier, rows: DeliveryRow[]): number {
  let risk = 0;
  if (supplier.vendorRating > 0) risk += (5 - clamp(supplier.vendorRating, 0, 5)) * 12; // up to 60
  if (supplier.leadTime > 30) risk += 20;
  else if (supplier.leadTime > 14) risk += 10;
  if (supplier.status === 'suspended') risk += 30;
  if (rows.length > 0) risk += Math.round((100 - calculateDeliveryPerformance(rows)) * 0.2); // up to 20
  return clamp(Math.round(risk), 0, 100);
}

export interface SupplierHealth {
  level: EnterpriseRiskLevel;
  reason: string;
}

/** Deterministic supplier health from the supplier's own master fields. */
export function calculateSupplierHealth(supplier: Supplier): SupplierHealth {
  if (supplier.status === 'suspended') return { level: 'high', reason: 'Supplier is suspended.' };
  if (supplier.vendorRating > 0 && supplier.vendorRating <= 2) return { level: 'high', reason: 'Low vendor rating.' };
  if (supplier.leadTime > 30) return { level: 'medium', reason: 'Long lead time.' };
  if (supplier.status === 'onboarding') return { level: 'low', reason: 'Onboarding in progress.' };
  if (supplier.vendorRating >= 4) return { level: 'low', reason: 'Preferred supplier.' };
  return { level: 'low', reason: 'Supplier in good standing.' };
}

export interface ReplenishmentNeed {
  sku: string;
  name: string;
  requirement: number;
}

/** Products needing replenishment, reusing the inventory reorder rule. Deterministic. */
export function calculateInventoryReplenishment(products: Product[]): ReplenishmentNeed[] {
  const out: ReplenishmentNeed[] = [];
  for (const p of products) {
    const requirement = calculateReorderRequirement(p);
    if (requirement > 0) out.push({ sku: p.sku, name: p.name, requirement });
  }
  return out;
}

/** Procurement savings — budgeted vs actual PO totals (only positive savings). Deterministic. */
export function calculateProcurementSavings(orders: Pick<PurchaseOrder, 'budget' | 'total' | 'status'>[]): number {
  return Math.round(
    orders
      .filter((o) => o.status !== 'cancelled' && o.budget > 0)
      .reduce((s, o) => s + Math.max(0, o.budget - o.total), 0),
  );
}

/* ── fallbacks (deterministic AI summaries) ────────────────────────────────── */

function money(value: number): string {
  return value.toLocaleString(undefined, { maximumFractionDigits: 0 });
}

export function supplierSummaryFallback(supplier: Supplier, health: SupplierHealth): { summary: string; executiveExplanation: string } {
  const summary =
    `${supplier.name} is a ${supplier.status} supplier${supplier.vendorRating ? ` rated ${supplier.vendorRating}/5` : ''} ` +
    `with a ${supplier.leadTime}-day lead time. ${health.reason}`;
  const executiveExplanation =
    health.level === 'high'
      ? `${supplier.name} is a risk — ${health.reason.toLowerCase()}`
      : `${supplier.name} is in good standing (${supplier.paymentTerms || 'standard terms'}).`;
  return { summary, executiveExplanation };
}

export function purchaseOrderSummaryFallback(order: PurchaseOrder): { summary: string; executiveExplanation: string } {
  const total = calculatePurchaseTotal(order);
  const summary =
    `${order.poNumber} to ${order.supplier || 'a supplier'} for ${order.quantity} × ${order.product || 'items'} ` +
    `is ${order.status} at ${money(total)}. Expected ${order.expectedDelivery || 'TBD'}.`;
  const executiveExplanation = `${order.poNumber} commits ${money(total)} of spend to ${order.supplier || 'a supplier'}.`;
  return { summary, executiveExplanation };
}

export function goodsReceiptSummaryFallback(receipt: GoodsReceipt): { summary: string; executiveExplanation: string } {
  const accuracy = calculateGoodsReceiptAccuracy(receipt.quantityOrdered, receipt.quantityReceived);
  const summary =
    `${receipt.grNumber}: received ${receipt.quantityReceived}/${receipt.quantityOrdered} of ${receipt.product || 'a product'} ` +
    `(${accuracy}% accuracy), status ${receipt.status}.` +
    (receipt.receiptMovement ? ' Stock updated.' : '');
  const executiveExplanation =
    receipt.status === 'received'
      ? `${receipt.grNumber} added ${receipt.quantityReceived} of ${receipt.product} to stock.`
      : `${receipt.grNumber} is ${receipt.status}.`;
  return { summary, executiveExplanation };
}

/* ── aggregate insights (Executive Center) ─────────────────────────────────── */

export interface ProcurementModuleInsights {
  openPurchaseOrders: number;
  pendingReceipts: number;
  procurementSpend: number;
  averageLeadTime: number;
  lateDeliveries: number;
  highRiskVendors: number;
  supplierPerformance: number;
}

/** Roll suppliers + POs + receipts into the Procurement KPIs. Pure. */
export function deriveProcurementInsights(
  suppliers: Supplier[],
  orders: PurchaseOrder[],
  receipts: GoodsReceipt[],
): ProcurementModuleInsights {
  const openPurchaseOrders = orders.filter((o) => (OPEN_PO_STATUSES as readonly string[]).includes(o.status)).length;
  const pendingReceipts = receipts.filter((r) => r.status === 'pending').length;
  const procurementSpend = Math.round(
    orders.filter((o) => o.status !== 'draft' && o.status !== 'cancelled').reduce((s, o) => s + calculatePurchaseTotal(o), 0),
  );
  const leadTimes = suppliers.map((s) => s.leadTime).filter((n) => n > 0);
  const averageLeadTime = leadTimes.length === 0 ? 0 : Math.round(leadTimes.reduce((a, b) => a + b, 0) / leadTimes.length);
  const rows: DeliveryRow[] = receipts
    .filter((r) => r.status === 'received')
    .map((r) => ({
      expectedDate: r.expectedDate,
      receiptDate: r.receiptDate,
      quantityOrdered: r.quantityOrdered,
      quantityReceived: r.quantityReceived,
    }));
  const lateDeliveries = rows.filter((r) => {
    const exp = parseDay(r.expectedDate);
    const rec = parseDay(r.receiptDate);
    return exp !== null && rec !== null && rec > exp;
  }).length;
  const highRiskVendors = suppliers.filter((s) => calculateVendorRisk(s, rows) >= 60).length;
  const supplierPerformance = calculateSupplierPerformance(rows);
  return {
    openPurchaseOrders,
    pendingReceipts,
    procurementSpend,
    averageLeadTime,
    lateDeliveries,
    highRiskVendors,
    supplierPerformance,
  };
}

/** Map procurement insights to Executive Center KPI tiles (reuses the existing KPI type). */
export function procurementInsightsToKpis(insights: ProcurementModuleInsights): ExecutiveKpi[] {
  const perfBand: ExecutiveKpi['band'] =
    insights.supplierPerformance >= 80 ? 'healthy' : insights.supplierPerformance >= 50 ? 'watch' : 'at-risk';
  const lateBand: ExecutiveKpi['band'] =
    insights.lateDeliveries === 0 ? 'healthy' : insights.lateDeliveries <= 3 ? 'watch' : 'at-risk';
  const riskBand: ExecutiveKpi['band'] =
    insights.highRiskVendors === 0 ? 'healthy' : insights.highRiskVendors <= 2 ? 'watch' : 'at-risk';
  return [
    { key: 'proc-open-po', label: 'Open Purchase Orders', value: null, display: String(insights.openPurchaseOrders), deepLink: 'enterprise/modules' },
    { key: 'proc-pending-receipts', label: 'Pending Receipts', value: null, display: String(insights.pendingReceipts), deepLink: 'enterprise/modules' },
    { key: 'proc-spend', label: 'Procurement Spend', value: null, display: money(insights.procurementSpend), deepLink: 'enterprise/modules' },
    {
      key: 'proc-supplier-perf',
      label: 'Supplier Performance',
      value: insights.supplierPerformance,
      display: `${insights.supplierPerformance}%`,
      band: perfBand,
      deepLink: 'enterprise/modules',
    },
    { key: 'proc-lead-time', label: 'Avg Lead Time', value: insights.averageLeadTime, display: `${insights.averageLeadTime}d`, deepLink: 'enterprise/modules' },
    {
      key: 'proc-late',
      label: 'Late Deliveries',
      value: null,
      display: `${insights.lateDeliveries} late`,
      band: lateBand,
      deepLink: 'enterprise/modules',
    },
    {
      key: 'proc-vendor-risk',
      label: 'High-Risk Vendors',
      value: null,
      display: `${insights.highRiskVendors} at risk`,
      band: riskBand,
      deepLink: 'enterprise/modules',
    },
  ];
}
