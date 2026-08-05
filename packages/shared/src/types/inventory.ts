/**
 * Inventory — the event-sourced stock ledger + pure deterministic business logic.
 *
 * The single source of truth for stock is the immutable **Stock Movement** journal:
 * every quantity change is a movement (receive / issue / transfer / adjustment /
 * reservation / … ), never a direct edit. A Product's current / reserved /
 * available stock and value are DERIVED from its movements and materialized onto
 * the product record by the movement reconciler — read-only, always recomputable
 * from history. This file holds the movement typing, the deterministic stock rules
 * (`calculateCurrentStock`, `calculateReservedStock`, `calculateAvailableStock`,
 * `calculateInventoryValue`, `calculateReorderRequirement`, `calculateStockHealth`,
 * `identifyNegativeInventory`, `calculateWarehouseUtilization`, `calculateStockTurnover`),
 * the per-location ledger projection, and the Executive insights. Pure (no I/O),
 * so future domains (Procurement, Warehouse, Manufacturing) consume the SAME engine.
 */
import type { EnterpriseEntity, EnterpriseRiskLevel } from './enterpriseModule';
import type { ExecutiveKpi } from './executiveCenter';

/* ── module identity ───────────────────────────────────────────────────────── */

export const PRODUCTS_MODULE_ID = 'inventory-products';
export const PRODUCT_KIND = 'product';
export const WAREHOUSES_MODULE_ID = 'inventory-warehouses';
export const WAREHOUSE_KIND = 'warehouse';
export const STOCK_MOVEMENTS_MODULE_ID = 'inventory-movements';
export const STOCK_MOVEMENT_KIND = 'stock-movement';

/* ── movements ─────────────────────────────────────────────────────────────── */

/**
 * The kinds of stock movement. Inbound raise on-hand, outbound lower it,
 * reservations move stock between available and reserved, transfers relocate it
 * between warehouses (net-zero on the product total). Corrections are made by
 * posting a compensating movement — history is never edited.
 */
export type MovementType =
  | 'receive'
  | 'issue'
  | 'transfer'
  | 'adjustment'
  | 'production_consumption'
  | 'production_output'
  | 'reservation'
  | 'reservation_release'
  | 'return';
export const MOVEMENT_TYPES: readonly MovementType[] = [
  'receive',
  'issue',
  'transfer',
  'adjustment',
  'production_consumption',
  'production_output',
  'reservation',
  'reservation_release',
  'return',
];

const MOVEMENT_LABELS: Record<MovementType, string> = {
  receive: 'Receive',
  issue: 'Issue',
  transfer: 'Transfer',
  adjustment: 'Adjustment',
  production_consumption: 'Production Consumption',
  production_output: 'Production Output',
  reservation: 'Reservation',
  reservation_release: 'Reservation Release',
  return: 'Return',
};
export function movementTypeLabel(type: MovementType): string {
  return MOVEMENT_LABELS[type] ?? type;
}

/** A movement's posting status — void movements are excluded from all balances. */
export type MovementStatus = 'posted' | 'void';

export type ProductStatus = 'active' | 'inactive' | 'discontinued';
export type WarehouseStatus = 'active' | 'inactive';

/* ── typed projections ─────────────────────────────────────────────────────── */

export interface Product {
  id: string;
  sku: string;
  barcode: string;
  name: string;
  category: string;
  unit: string;
  purchaseCost: number;
  standardCost: number;
  sellingPrice: number;
  reorderLevel: number;
  safetyStock: number;
  maximumStock: number;
  currentStock: number;
  reservedStock: number;
  availableStock: number;
  status: ProductStatus;
}

export interface Warehouse {
  id: string;
  name: string;
  code: string;
  location: string;
  zone: string;
  bin: string;
  capacity: number;
  manager: string;
  status: WarehouseStatus;
}

export interface StockMovement {
  id: string;
  movementNumber: string;
  type: MovementType;
  product: string;
  warehouse: string;
  fromWarehouse: string;
  quantity: number;
  unitCost: number;
  referenceModule: string;
  referenceRecord: string;
  reason: string;
  status: MovementStatus;
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

export function productFromRecord(record: EnterpriseEntity): Product {
  const f = record.fields;
  return {
    id: record.id,
    sku: str(f.sku) || record.title,
    barcode: str(f.barcode),
    name: str(f.name) || record.title,
    category: str(f.category),
    unit: str(f.unit) || 'unit',
    purchaseCost: num(f.purchaseCost),
    standardCost: num(f.standardCost),
    sellingPrice: num(f.sellingPrice),
    reorderLevel: num(f.reorderLevel),
    safetyStock: num(f.safetyStock),
    maximumStock: num(f.maximumStock),
    currentStock: num(f.currentStock),
    reservedStock: num(f.reservedStock),
    availableStock: num(f.availableStock),
    status: oneOf<ProductStatus>(f.status, ['active', 'inactive', 'discontinued'], 'active'),
  };
}

export function warehouseFromRecord(record: EnterpriseEntity): Warehouse {
  const f = record.fields;
  return {
    id: record.id,
    name: str(f.name) || record.title,
    code: str(f.code),
    location: str(f.location),
    zone: str(f.zone),
    bin: str(f.bin),
    capacity: num(f.capacity),
    manager: str(f.manager),
    status: oneOf<WarehouseStatus>(f.status, ['active', 'inactive'], 'active'),
  };
}

export function movementFromRecord(record: EnterpriseEntity): StockMovement {
  const f = record.fields;
  return {
    id: record.id,
    movementNumber: str(f.movementNumber) || record.title,
    type: oneOf<MovementType>(f.type, MOVEMENT_TYPES, 'adjustment'),
    product: str(f.product),
    warehouse: str(f.warehouse),
    fromWarehouse: str(f.fromWarehouse),
    quantity: num(f.quantity),
    unitCost: num(f.unitCost),
    referenceModule: str(f.referenceModule),
    referenceRecord: str(f.referenceRecord),
    reason: str(f.reason),
    status: oneOf<MovementStatus>(f.status, ['posted', 'void'], 'posted'),
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

/* ── deterministic stock logic (AI explains; it never sets these) ──────────── */

const ONHAND_IN = new Set<MovementType>(['receive', 'production_output', 'return']);
const ONHAND_OUT = new Set<MovementType>(['issue', 'production_consumption']);

/** Signed effect of a movement on a product's total on-hand quantity. */
export function movementOnHandDelta(m: StockMovement): number {
  if (m.status === 'void') return 0;
  const q = Math.abs(m.quantity);
  if (ONHAND_IN.has(m.type)) return q;
  if (ONHAND_OUT.has(m.type)) return -q;
  if (m.type === 'adjustment') return m.quantity; // signed adjustment
  return 0; // transfer (net-zero on the product total), reservations
}

/** Signed effect of a movement on a product's reserved quantity. */
export function movementReservedDelta(m: StockMovement): number {
  if (m.status === 'void') return 0;
  const q = Math.abs(m.quantity);
  if (m.type === 'reservation') return q;
  if (m.type === 'reservation_release') return -q;
  return 0;
}

/** Current on-hand stock derived from the full movement history. Deterministic. */
export function calculateCurrentStock(movements: StockMovement[]): number {
  return Math.round(movements.reduce((s, m) => s + movementOnHandDelta(m), 0));
}

/** Reserved stock derived from the full movement history. Deterministic. */
export function calculateReservedStock(movements: StockMovement[]): number {
  return Math.max(0, Math.round(movements.reduce((s, m) => s + movementReservedDelta(m), 0)));
}

/** Available = current − reserved (may go negative when oversold). Deterministic. */
export function calculateAvailableStock(movements: StockMovement[]): number {
  return calculateCurrentStock(movements) - calculateReservedStock(movements);
}

export interface ProductStock {
  currentStock: number;
  reservedStock: number;
  availableStock: number;
  stockValue: number;
}

/** The materialized stock a product carries, derived from its movements. */
export function productComputedStock(product: Product, movements: StockMovement[]): ProductStock {
  const currentStock = calculateCurrentStock(movements);
  const reservedStock = calculateReservedStock(movements);
  const cost = product.standardCost || product.purchaseCost;
  return {
    currentStock,
    reservedStock,
    availableStock: currentStock - reservedStock,
    stockValue: Math.round(currentStock * cost),
  };
}

/** Total value of on-hand inventory at each product's cost. Deterministic. */
export function calculateInventoryValue(products: Product[]): number {
  return Math.round(
    products.reduce((s, p) => s + p.currentStock * (p.standardCost || p.purchaseCost), 0),
  );
}

/** Units to order to return above the reorder point (0 when not needed). Deterministic. */
export function calculateReorderRequirement(product: Product): number {
  if (product.availableStock > product.reorderLevel) return 0;
  const target = Math.max(product.maximumStock, product.reorderLevel + product.safetyStock);
  return Math.max(0, Math.round(target - product.availableStock));
}

export type StockHealthStatus = 'out_of_stock' | 'low' | 'healthy' | 'overstock';
export interface StockHealth {
  status: StockHealthStatus;
  level: EnterpriseRiskLevel;
  reason: string;
}

/** Deterministic stock health for a product. */
export function calculateStockHealth(product: Product): StockHealth {
  if (product.currentStock <= 0) {
    return { status: 'out_of_stock', level: 'high', reason: 'Out of stock.' };
  }
  if (product.availableStock <= product.safetyStock) {
    return { status: 'low', level: 'high', reason: 'Below safety stock.' };
  }
  if (product.availableStock <= product.reorderLevel) {
    return { status: 'low', level: 'medium', reason: 'At or below reorder level.' };
  }
  if (product.maximumStock > 0 && product.currentStock > product.maximumStock) {
    return { status: 'overstock', level: 'medium', reason: 'Above maximum stock.' };
  }
  return { status: 'healthy', level: 'low', reason: 'Healthy stock level.' };
}

/** Products carrying a negative on-hand balance (a data/oversell problem). */
export function identifyNegativeInventory(products: Product[]): Product[] {
  return products.filter((p) => p.currentStock < 0);
}

/** Warehouse utilization 0..100 from used units vs capacity. Deterministic. */
export function calculateWarehouseUtilization(capacity: number, usedUnits: number): number {
  if (capacity <= 0) return 0;
  return Math.max(0, Math.round((usedUnits / capacity) * 100));
}

/**
 * Stock turnover — issued (outbound) quantity over the period divided by the
 * average on-hand. A higher number means faster-moving stock. Deterministic.
 */
export function calculateStockTurnover(issuedQty: number, averageStock: number): number {
  if (averageStock <= 0) return 0;
  return Math.round((issuedQty / averageStock) * 100) / 100;
}

/* ── per-location ledger projection (derived from the movement journal) ─────── */

export interface LedgerBalance {
  product: string;
  warehouse: string;
  onHand: number;
  reserved: number;
  available: number;
}

/**
 * The Stock Ledger — per (product, warehouse) balances derived from the immutable
 * movement journal. Transfers move on-hand from `fromWarehouse` to `warehouse`.
 * Pure; this is the queryable balance future domains consume.
 */
export function deriveStockLedger(movements: StockMovement[]): LedgerBalance[] {
  const map = new Map<string, LedgerBalance>();
  const cell = (product: string, warehouse: string): LedgerBalance => {
    const key = `${product}\u0000${warehouse}`;
    let b = map.get(key);
    if (!b) {
      b = { product, warehouse, onHand: 0, reserved: 0, available: 0 };
      map.set(key, b);
    }
    return b;
  };
  for (const m of movements) {
    if (m.status === 'void' || !m.product) continue;
    if (m.type === 'transfer') {
      const q = Math.abs(m.quantity);
      if (m.fromWarehouse) cell(m.product, m.fromWarehouse).onHand -= q;
      if (m.warehouse) cell(m.product, m.warehouse).onHand += q;
      continue;
    }
    const wh = m.warehouse || '(unassigned)';
    const c = cell(m.product, wh);
    c.onHand += movementOnHandDelta(m);
    c.reserved += movementReservedDelta(m);
  }
  const out: LedgerBalance[] = [];
  for (const b of map.values()) {
    b.onHand = Math.round(b.onHand);
    b.reserved = Math.max(0, Math.round(b.reserved));
    b.available = b.onHand - b.reserved;
    out.push(b);
  }
  return out;
}

/* ── fallbacks (deterministic AI summaries) ────────────────────────────────── */

function money(value: number): string {
  return value.toLocaleString(undefined, { maximumFractionDigits: 0 });
}

/** Deterministic product summary — the no-model fallback. */
export function productSummaryFallback(
  product: Product,
  health: StockHealth,
): { summary: string; executiveExplanation: string } {
  const reorder = calculateReorderRequirement(product);
  const summary =
    `${product.name} (${product.sku}) has ${product.currentStock} ${product.unit} on hand, ` +
    `${product.reservedStock} reserved, ${product.availableStock} available. ${health.reason}` +
    (reorder > 0 ? ` Reorder ${reorder} ${product.unit}.` : '');
  const executiveExplanation =
    health.level === 'high'
      ? `${product.name} needs attention — ${health.reason.toLowerCase()}`
      : `${product.name} holds ${money(Math.round(product.currentStock * (product.standardCost || product.purchaseCost)))} of stock at ${product.availableStock} available.`;
  return { summary, executiveExplanation };
}

/** Deterministic movement summary — the no-model fallback. */
export function movementSummaryFallback(movement: StockMovement): {
  summary: string;
  executiveExplanation: string;
} {
  const onHand = movementOnHandDelta(movement);
  const effect = onHand === 0 ? 'no on-hand change' : `${onHand > 0 ? '+' : ''}${onHand} on hand`;
  const summary =
    `${movement.movementNumber}: ${movementTypeLabel(movement.type)} of ${Math.abs(movement.quantity)} ` +
    `for ${movement.product || 'a product'} at ${movement.warehouse || 'a warehouse'} (${effect}).` +
    (movement.reason ? ` ${movement.reason}` : '');
  const executiveExplanation =
    movement.status === 'void'
      ? `${movement.movementNumber} is void and does not affect stock.`
      : `${movementTypeLabel(movement.type)} ${effect} for ${movement.product || 'a product'}.`;
  return { summary, executiveExplanation };
}

/* ── aggregate insights (Executive Center) ─────────────────────────────────── */

export interface InventoryModuleInsights {
  totalProducts: number;
  inventoryValue: number;
  availableUnits: number;
  reservedUnits: number;
  lowStockCount: number;
  outOfStockCount: number;
  negativeStockCount: number;
  warehouseUtilization: number;
}

/** Roll products (+ warehouses for utilization) into the Inventory KPIs. Pure. */
export function deriveInventoryInsights(
  products: Product[],
  warehouses: Warehouse[],
): InventoryModuleInsights {
  let available = 0;
  let reserved = 0;
  let low = 0;
  let out = 0;
  for (const p of products) {
    available += p.availableStock;
    reserved += p.reservedStock;
    const health = calculateStockHealth(p);
    if (health.status === 'out_of_stock') out += 1;
    else if (health.status === 'low') low += 1;
  }
  const totalOnHand = products.reduce((s, p) => s + Math.max(0, p.currentStock), 0);
  const totalCapacity = warehouses.reduce((s, w) => s + Math.max(0, w.capacity), 0);
  return {
    totalProducts: products.length,
    inventoryValue: calculateInventoryValue(products),
    availableUnits: Math.round(available),
    reservedUnits: Math.round(reserved),
    lowStockCount: low,
    outOfStockCount: out,
    negativeStockCount: identifyNegativeInventory(products).length,
    warehouseUtilization: calculateWarehouseUtilization(totalCapacity, totalOnHand),
  };
}

/** Map inventory insights to Executive Center KPI tiles (reuses the existing KPI type). */
export function inventoryInsightsToKpis(insights: InventoryModuleInsights): ExecutiveKpi[] {
  const stockBand: ExecutiveKpi['band'] =
    insights.outOfStockCount > 0 || insights.negativeStockCount > 0
      ? 'at-risk'
      : insights.lowStockCount > 0
        ? 'watch'
        : 'healthy';
  const utilBand: ExecutiveKpi['band'] =
    insights.warehouseUtilization >= 90 ? 'at-risk' : insights.warehouseUtilization >= 75 ? 'watch' : 'healthy';
  return [
    { key: 'stk-value', label: 'Inventory Value', value: null, display: money(insights.inventoryValue), deepLink: 'enterprise/modules' },
    {
      key: 'stk-health',
      label: 'Stock Health',
      value: null,
      display: insights.outOfStockCount + insights.lowStockCount === 0 ? 'healthy' : `${insights.lowStockCount + insights.outOfStockCount} need attention`,
      band: stockBand,
      deepLink: 'enterprise/modules',
    },
    { key: 'stk-available', label: 'Available Stock', value: null, display: money(insights.availableUnits), deepLink: 'enterprise/modules' },
    { key: 'stk-reserved', label: 'Reserved Stock', value: null, display: money(insights.reservedUnits), deepLink: 'enterprise/modules' },
    {
      key: 'stk-low',
      label: 'Low Stock',
      value: null,
      display: `${insights.lowStockCount} low`,
      band: insights.lowStockCount === 0 ? 'healthy' : insights.lowStockCount <= 3 ? 'watch' : 'at-risk',
      deepLink: 'enterprise/modules',
    },
    {
      key: 'stk-out',
      label: 'Out of Stock',
      value: null,
      display: `${insights.outOfStockCount} out`,
      band: insights.outOfStockCount === 0 ? 'healthy' : 'at-risk',
      deepLink: 'enterprise/modules',
    },
    {
      key: 'stk-util',
      label: 'Warehouse Utilization',
      value: insights.warehouseUtilization,
      display: `${insights.warehouseUtilization}%`,
      band: utilBand,
      deepLink: 'enterprise/modules',
    },
  ];
}
