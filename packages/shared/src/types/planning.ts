/**
 * Enterprise Planning — the deterministic INTELLIGENCE layer over the operational OS.
 * It is read-mostly: it owns no records and no stock, and mutates nothing. It reads
 * the existing operational data (Products + Inventory Ledger, Sales Orders, Quotes,
 * Shipments, Production Orders, BOMs, Machines, Purchase Orders, Suppliers, Finance
 * Invoices) and computes deterministic plans and recommendations. The Inventory Ledger
 * remains the single source of truth; Manufacturing/Warehouse/Finance remain the
 * operational authorities. AI never predicts here — every number is calculated.
 *
 * Covers Demand Planning, real Material Requirements Planning (MRP), Capacity Planning,
 * Supply-Chain Health (6 risks), and Sales/Inventory/Cash forecasts, plus the Executive
 * planning KPIs and the planning recommendations that flow into the existing Executive
 * recommendation system. Pure (no I/O); reuses existing deterministic functions
 * (`calculateReorderRequirement`, `calculateStockHealth`, `calculateMachineUtilization`,
 * `calculateVendorRisk`) — no duplicate engine.
 */
import type { ExecutiveKpi, ExecutiveRecommendation, ExecRecoPriority } from './executiveCenter';
import type { FinanceInvoice } from './finance';
import { OPEN_INVOICE_STATUSES } from './finance';
import type { Product } from './inventory';
import { calculateReorderRequirement, calculateStockHealth } from './inventory';
import type { BillOfMaterials, Machine, ProductionOrder } from './manufacturing';
import { calculateMachineUtilization } from './manufacturing';
import type { SalesOrder } from './orders';
import type { PurchaseOrder, Supplier } from './procurement';
import { OPEN_PO_STATUSES, calculateVendorRisk } from './procurement';
import type { SalesQuote } from './quotes';
import type { Shipping } from './warehouse';

/* ── tunables (deterministic constants — explainable, never guessed) ─────────── */

/** Share of historical shipment run-rate added to firm demand as the forecast baseline. */
export const DEMAND_BASELINE_WEIGHT = 0.5;
/** Machine utilization at/above which capacity is considered constrained. */
export const CAPACITY_CONSTRAINT_THRESHOLD = 85;
/** Weight of open sales quotes (pipeline) in the sales-value forecast. */
export const QUOTE_PIPELINE_WEIGHT = 0.5;

const clamp = (n: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, n));
function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return Math.round(values.reduce((a, b) => a + b, 0) / values.length);
}
function money(value: number): string {
  return value.toLocaleString(undefined, { maximumFractionDigits: 0 });
}

/** The read-only operational data the planning engine consumes. Owns none of it. */
export interface PlanningInput {
  products: Product[];
  salesOrders: SalesOrder[];
  quotes: SalesQuote[];
  shipments: Shipping[];
  productionOrders: ProductionOrder[];
  purchaseOrders: PurchaseOrder[];
  suppliers: Supplier[];
  boms: BillOfMaterials[];
  machines: Machine[];
  invoices: FinanceInvoice[];
}

/* ── Demand Planning ────────────────────────────────────────────────────────── */

/** Firm demand for a product — committed by open (pending) sales orders. Deterministic. */
export function calculateFirmDemand(sku: string, orders: SalesOrder[]): number {
  return orders
    .filter((o) => o.status === 'pending' && o.product === sku)
    .reduce((s, o) => s + Math.max(0, o.orderedQty), 0);
}

/** Historical shipped units for a product (the run-rate baseline source). Deterministic. */
export function calculateHistoricalShipped(sku: string, shipments: Shipping[]): number {
  return shipments
    .filter((s) => (s.status === 'shipped' || s.status === 'delivered') && s.product === sku)
    .reduce((s, x) => s + Math.abs(x.quantity), 0);
}

/**
 * Forecast demand = firm open-order demand + a share of the historical shipment
 * run-rate as the baseline. Deterministic (fixed weight).
 */
export function calculateForecastDemand(sku: string, orders: SalesOrder[], shipments: Shipping[]): number {
  const firm = calculateFirmDemand(sku, orders);
  const baseline = Math.round(calculateHistoricalShipped(sku, shipments) * DEMAND_BASELINE_WEIGHT);
  return firm + baseline;
}

export interface DemandLine {
  sku: string;
  name: string;
  firmDemand: number;
  forecastDemand: number;
}

/** Per-product demand forecast across the catalog. Deterministic. */
export function deriveDemandForecast(products: Product[], orders: SalesOrder[], shipments: Shipping[]): DemandLine[] {
  return products.map((p) => ({
    sku: p.sku,
    name: p.name,
    firmDemand: calculateFirmDemand(p.sku, orders),
    forecastDemand: calculateForecastDemand(p.sku, orders, shipments),
  }));
}

/* ── Material Requirements Planning (MRP) ───────────────────────────────────── */

/** Incoming supply for a product — open purchase orders + in-progress production. Deterministic. */
export function calculateIncomingSupply(sku: string, purchaseOrders: PurchaseOrder[], productionOrders: ProductionOrder[]): number {
  const fromPurchasing = purchaseOrders
    .filter((o) => (OPEN_PO_STATUSES as readonly string[]).includes(o.status) && o.product === sku)
    .reduce((s, o) => s + Math.max(0, o.quantity), 0);
  const fromProduction = productionOrders
    .filter((o) => (o.status === 'released' || o.status === 'running') && o.product === sku)
    .reduce((s, o) => s + Math.max(0, o.productionQuantity), 0);
  return fromPurchasing + fromProduction;
}

/** Net requirement = demand − available − incoming (never negative). Deterministic. */
export function calculateNetRequirement(demand: number, available: number, incoming: number): number {
  return Math.max(0, Math.round(demand - available - incoming));
}

export type MrpRecommendation = 'purchase' | 'produce' | 'ok';

export interface MrpLine {
  sku: string;
  name: string;
  demand: number;
  onHand: number;
  reserved: number;
  available: number;
  incoming: number;
  netRequirement: number;
  isManufactured: boolean;
  recommendation: MrpRecommendation;
}

function manufacturedSkus(boms: BillOfMaterials[]): Set<string> {
  const set = new Set<string>();
  for (const b of boms) if (b.status !== 'archived' && b.product && b.components.length > 0) set.add(b.product);
  return set;
}

/** Run MRP across the catalog. Manufactured products (with a BOM) are produced; others purchased. Deterministic. */
export function runMrp(input: PlanningInput): MrpLine[] {
  const madeSkus = manufacturedSkus(input.boms);
  return input.products.map((p) => {
    const demand = calculateForecastDemand(p.sku, input.salesOrders, input.shipments);
    const incoming = calculateIncomingSupply(p.sku, input.purchaseOrders, input.productionOrders);
    const netRequirement = calculateNetRequirement(demand, p.availableStock, incoming);
    const isManufactured = madeSkus.has(p.sku);
    return {
      sku: p.sku,
      name: p.name,
      demand,
      onHand: p.currentStock,
      reserved: p.reservedStock,
      available: p.availableStock,
      incoming,
      netRequirement,
      isManufactured,
      recommendation: netRequirement > 0 ? (isManufactured ? 'produce' : 'purchase') : 'ok',
    };
  });
}

/** Products with a positive net requirement (a real shortage). Deterministic. */
export function calculateMaterialShortages(mrp: MrpLine[]): MrpLine[] {
  return mrp.filter((l) => l.netRequirement > 0);
}

/** Products at or below safety stock (available). Deterministic. */
export function calculateSafetyStockAlerts(products: Product[]): Product[] {
  return products.filter((p) => p.safetyStock > 0 && p.availableStock <= p.safetyStock);
}

export interface ReplenishmentLine {
  sku: string;
  name: string;
  requirement: number;
}

/** Replenishment needs, reusing the inventory reorder rule (no new math). Deterministic. */
export function calculateReplenishment(products: Product[]): ReplenishmentLine[] {
  const out: ReplenishmentLine[] = [];
  for (const p of products) {
    const requirement = calculateReorderRequirement(p);
    if (requirement > 0) out.push({ sku: p.sku, name: p.name, requirement });
  }
  return out;
}

/* ── Capacity Planning ──────────────────────────────────────────────────────── */

export interface CapacityLine {
  machine: string;
  utilization: number;
  constrained: boolean;
}

/** Per-machine utilization + whether it is capacity-constrained. Reuses the manufacturing rule. */
export function calculateCapacityPlan(machines: Machine[]): CapacityLine[] {
  return machines.map((m) => {
    const utilization = calculateMachineUtilization(m.runtime, m.runtime + m.downtime);
    return { machine: m.name, utilization, constrained: utilization >= CAPACITY_CONSTRAINT_THRESHOLD };
  });
}

/** The names of capacity-constrained machines (production bottlenecks). Deterministic. */
export function calculateCapacityBottlenecks(machines: Machine[]): string[] {
  return calculateCapacityPlan(machines).filter((c) => c.constrained).map((c) => c.machine);
}

/* ── Supply-Chain Health (6 deterministic risks 0..100) ─────────────────────── */

/** Supplier risk — mean vendor risk across the supply base (reuses `calculateVendorRisk`). */
export function calculateSupplierRisk(suppliers: Supplier[]): number {
  if (suppliers.length === 0) return 0;
  return clamp(mean(suppliers.map((s) => calculateVendorRisk(s, []))), 0, 100);
}

/** Production risk — share of machines not in a working (running/idle) state. Deterministic. */
export function calculateProductionRisk(machines: Machine[]): number {
  if (machines.length === 0) return 0;
  const impaired = machines.filter((m) => m.status !== 'running' && m.status !== 'idle').length;
  return clamp(Math.round((impaired / machines.length) * 100), 0, 100);
}

/** Inventory risk — weighted out-of-stock + low-stock + negative across the catalog. Deterministic. */
export function calculateInventoryRisk(products: Product[]): number {
  if (products.length === 0) return 0;
  let score = 0;
  for (const p of products) {
    const health = calculateStockHealth(p);
    if (p.currentStock < 0) score += 100;
    else if (health.status === 'out_of_stock') score += 100;
    else if (health.status === 'low') score += 50;
  }
  return clamp(Math.round(score / products.length), 0, 100);
}

/** Warehouse risk — reservation pressure (reserved vs on-hand). Deterministic. */
export function calculateWarehouseRisk(products: Product[]): number {
  const onHand = products.reduce((s, p) => s + Math.max(0, p.currentStock), 0);
  const reserved = products.reduce((s, p) => s + Math.max(0, p.reservedStock), 0);
  if (onHand <= 0) return reserved > 0 ? 100 : 0;
  return clamp(Math.round((reserved / onHand) * 100), 0, 100);
}

/** Fulfillment risk — share of open orders that cannot be fulfilled from available stock. Deterministic. */
export function calculateFulfillmentRisk(orders: SalesOrder[], products: Product[]): number {
  const bySku = new Map(products.map((p) => [p.sku, p]));
  const open = orders.filter((o) => o.status === 'pending' && o.product && o.orderedQty > 0);
  if (open.length === 0) return 0;
  const unfulfillable = open.filter((o) => {
    const p = bySku.get(o.product);
    return !p || p.availableStock < o.orderedQty;
  }).length;
  return clamp(Math.round((unfulfillable / open.length) * 100), 0, 100);
}

/** Cash risk — overdue share of open receivables. Deterministic. */
export function calculateCashRisk(invoices: FinanceInvoice[]): number {
  const open = invoices.filter((i) => (OPEN_INVOICE_STATUSES as readonly string[]).includes(i.status));
  const totalReceivable = open.reduce((s, i) => s + Math.max(0, i.amount - i.amountPaid), 0);
  if (totalReceivable <= 0) return 0;
  const overdue = open
    .filter((i) => i.status === 'overdue')
    .reduce((s, i) => s + Math.max(0, i.amount - i.amountPaid), 0);
  return clamp(Math.round((overdue / totalReceivable) * 100), 0, 100);
}

export interface SupplyChainHealth {
  supplierRisk: number;
  productionRisk: number;
  inventoryRisk: number;
  warehouseRisk: number;
  fulfillmentRisk: number;
  cashRisk: number;
}

/** All six supply-chain risks. Deterministic. */
export function deriveSupplyChainHealth(input: PlanningInput): SupplyChainHealth {
  return {
    supplierRisk: calculateSupplierRisk(input.suppliers),
    productionRisk: calculateProductionRisk(input.machines),
    inventoryRisk: calculateInventoryRisk(input.products),
    warehouseRisk: calculateWarehouseRisk(input.products),
    fulfillmentRisk: calculateFulfillmentRisk(input.salesOrders, input.products),
    cashRisk: calculateCashRisk(input.invoices),
  };
}

/* ── Forecasts (Sales / Inventory / Cash) ───────────────────────────────────── */

/** Sales-value forecast — open order value + weighted quote pipeline. Deterministic. */
export function calculateSalesForecast(orders: SalesOrder[], quotes: SalesQuote[]): number {
  const orderValue = orders.filter((o) => o.status !== 'cancelled').reduce((s, o) => s + Math.max(0, o.total), 0);
  const pipeline = quotes
    .filter((q) => q.status === 'sent' || q.status === 'accepted' || q.status === 'approved')
    .reduce((s, q) => s + Math.max(0, q.total), 0);
  return Math.round(orderValue + pipeline * QUOTE_PIPELINE_WEIGHT);
}

/** Inventory forecast — projected available units after demand + incoming across the catalog. Deterministic. */
export function calculateInventoryForecast(input: PlanningInput): number {
  return Math.round(
    input.products.reduce((s, p) => {
      const demand = calculateForecastDemand(p.sku, input.salesOrders, input.shipments);
      const incoming = calculateIncomingSupply(p.sku, input.purchaseOrders, input.productionOrders);
      return s + (p.availableStock + incoming - demand);
    }, 0),
  );
}

/** Cash forecast — open receivables (invoices) minus payables (open purchase orders). Deterministic. */
export function calculateCashForecast(invoices: FinanceInvoice[], purchaseOrders: PurchaseOrder[]): number {
  const receivables = invoices
    .filter((i) => (OPEN_INVOICE_STATUSES as readonly string[]).includes(i.status))
    .reduce((s, i) => s + Math.max(0, i.amount - i.amountPaid), 0);
  const payables = purchaseOrders
    .filter((o) => (OPEN_PO_STATUSES as readonly string[]).includes(o.status))
    .reduce((s, o) => s + Math.max(0, o.total), 0);
  return Math.round(receivables - payables);
}

/* ── aggregate insights (Executive Center) ─────────────────────────────────── */

export interface PlanningModuleInsights {
  planningAccuracy: number;
  demandForecast: number;
  supplyCoverage: number;
  mrpHealth: number;
  capacityUtilization: number;
  inventoryCoverage: number;
  procurementReadiness: number;
  productionReadiness: number;
  enterpriseReadinessScore: number;
  overallPlanningScore: number;
}

/** Roll the operational data into the Planning KPIs. Pure. */
export function derivePlanningInsights(input: PlanningInput): PlanningModuleInsights {
  const mrp = runMrp(input);
  const shortages = calculateMaterialShortages(mrp);
  const totalFirm = input.products.reduce((s, p) => s + calculateFirmDemand(p.sku, input.salesOrders), 0);
  const totalDemand = mrp.reduce((s, l) => s + l.demand, 0);
  const totalAvailable = input.products.reduce((s, p) => s + Math.max(0, p.availableStock), 0);
  const totalIncoming = mrp.reduce((s, l) => s + l.incoming, 0);

  const planningAccuracy = totalDemand <= 0 ? 100 : clamp(Math.round((totalFirm / totalDemand) * 100), 0, 100);
  const supplyCoverage = totalDemand <= 0 ? 100 : clamp(Math.round(((totalAvailable + totalIncoming) / totalDemand) * 100), 0, 100);
  const mrpHealth = mrp.length === 0 ? 100 : clamp(Math.round(((mrp.length - shortages.length) / mrp.length) * 100), 0, 100);
  const capacityUtilization = mean(input.machines.map((m) => calculateMachineUtilization(m.runtime, m.runtime + m.downtime)));
  const inventoryCoverage = totalDemand <= 0 ? 100 : clamp(Math.round((totalAvailable / totalDemand) * 100), 0, 100);

  const activeSuppliers = input.suppliers.filter((s) => s.status === 'active').length;
  const procurementReadiness = input.suppliers.length === 0 ? 100 : clamp(Math.round((activeSuppliers / input.suppliers.length) * 100), 0, 100);
  const producibleBoms = input.boms.filter((b) => b.status === 'active' && b.components.length > 0).length;
  const productionReadiness = input.boms.length === 0 ? 100 : clamp(Math.round((producibleBoms / input.boms.length) * 100), 0, 100);

  const enterpriseReadinessScore = Math.round(
    (supplyCoverage + mrpHealth + inventoryCoverage + procurementReadiness + productionReadiness) / 5,
  );
  const health = deriveSupplyChainHealth(input);
  const avgRisk = Math.round(
    (health.supplierRisk + health.productionRisk + health.inventoryRisk + health.warehouseRisk + health.fulfillmentRisk + health.cashRisk) / 6,
  );
  const overallPlanningScore = clamp(Math.round((enterpriseReadinessScore + (100 - avgRisk)) / 2), 0, 100);

  return {
    planningAccuracy,
    demandForecast: totalDemand,
    supplyCoverage,
    mrpHealth,
    capacityUtilization,
    inventoryCoverage,
    procurementReadiness,
    productionReadiness,
    enterpriseReadinessScore,
    overallPlanningScore,
  };
}

/** Map planning insights to Executive Center KPI tiles (reuses the existing KPI type). */
export function planningInsightsToKpis(insights: PlanningModuleInsights): ExecutiveKpi[] {
  const pctBand = (v: number): ExecutiveKpi['band'] => (v >= 90 ? 'healthy' : v >= 75 ? 'watch' : 'at-risk');
  const utilBand: ExecutiveKpi['band'] =
    insights.capacityUtilization >= 90 ? 'at-risk' : insights.capacityUtilization >= 75 ? 'watch' : 'healthy';
  return [
    { key: 'plan-accuracy', label: 'Planning Accuracy', value: insights.planningAccuracy, display: `${insights.planningAccuracy}%`, band: pctBand(insights.planningAccuracy), deepLink: 'enterprise/executive' },
    { key: 'plan-demand', label: 'Demand Forecast', value: insights.demandForecast, display: money(insights.demandForecast), deepLink: 'enterprise/executive' },
    { key: 'plan-supply', label: 'Supply Coverage', value: insights.supplyCoverage, display: `${insights.supplyCoverage}%`, band: pctBand(insights.supplyCoverage), deepLink: 'enterprise/executive' },
    { key: 'plan-mrp', label: 'MRP Health', value: insights.mrpHealth, display: `${insights.mrpHealth}%`, band: pctBand(insights.mrpHealth), deepLink: 'enterprise/executive' },
    { key: 'plan-capacity', label: 'Capacity Utilization', value: insights.capacityUtilization, display: `${insights.capacityUtilization}%`, band: utilBand, deepLink: 'enterprise/executive' },
    { key: 'plan-inv-coverage', label: 'Inventory Coverage', value: insights.inventoryCoverage, display: `${insights.inventoryCoverage}%`, band: pctBand(insights.inventoryCoverage), deepLink: 'enterprise/executive' },
    { key: 'plan-proc-ready', label: 'Procurement Readiness', value: insights.procurementReadiness, display: `${insights.procurementReadiness}%`, band: pctBand(insights.procurementReadiness), deepLink: 'enterprise/executive' },
    { key: 'plan-prod-ready', label: 'Production Readiness', value: insights.productionReadiness, display: `${insights.productionReadiness}%`, band: pctBand(insights.productionReadiness), deepLink: 'enterprise/executive' },
    { key: 'plan-enterprise', label: 'Enterprise Readiness Score', value: insights.enterpriseReadinessScore, display: `${insights.enterpriseReadinessScore}`, band: pctBand(insights.enterpriseReadinessScore), deepLink: 'enterprise/executive' },
    { key: 'plan-overall', label: 'Overall Planning Score', value: insights.overallPlanningScore, display: `${insights.overallPlanningScore}`, band: pctBand(insights.overallPlanningScore), deepLink: 'enterprise/executive' },
  ];
}

/* ── planning recommendations (flow into the existing Executive recommendation system) ── */

function priorityForShortage(line: MrpLine): ExecRecoPriority {
  if (line.available < 0) return 'critical';
  if (line.netRequirement >= line.demand) return 'high';
  return 'medium';
}
function rank(priority: ExecRecoPriority, confidence: number): number {
  const base: Record<ExecRecoPriority, number> = { critical: 1000, high: 700, medium: 400, low: 100 };
  return Math.round(base[priority] + confidence * 100);
}

/**
 * Deterministic planning recommendations — material shortages (purchase / produce),
 * safety-stock alerts, and capacity bottlenecks — shaped as ExecutiveRecommendations
 * so they surface through the EXISTING Executive recommendation + timeline system.
 * Backed entirely by the calculated MRP/capacity results (AI explains, never invents).
 */
export function planningRecommendations(input: PlanningInput, limit = 12): ExecutiveRecommendation[] {
  const recs: ExecutiveRecommendation[] = [];
  const mrp = runMrp(input);
  const shortages = calculateMaterialShortages(mrp).sort((a, b) => b.netRequirement - a.netRequirement);

  for (const line of shortages) {
    const priority = priorityForShortage(line);
    const confidence = 0.9;
    const produce = line.recommendation === 'produce';
    recs.push({
      id: `plan:mrp:${line.sku}`,
      metric: produce ? 'production' : 'procurement',
      icon: produce ? 'cpu' : 'shopping-cart',
      problem: `${line.name} (${line.sku}) is short ${line.netRequirement} unit(s) against forecast demand ${line.demand}.`,
      businessImpact: 'Unmet demand risks stockouts and missed shipments.',
      rootCause: `Available ${line.available} + incoming ${line.incoming} < demand ${line.demand}.`,
      priority,
      confidence,
      expectedOutcome: produce
        ? `A production order for ${line.netRequirement} closes the gap.`
        : `A purchase request for ${line.netRequirement} closes the gap.`,
      evidence: [`demand=${line.demand}`, `available=${line.available}`, `incoming=${line.incoming}`, `net=${line.netRequirement}`],
      sourceSystems: ['planning', 'inventory', produce ? 'manufacturing' : 'procurement'],
      recommendedAction: produce
        ? `Raise a production order for ${line.netRequirement} of ${line.sku}.`
        : `Raise a purchase request for ${line.netRequirement} of ${line.sku}.`,
      owner: produce ? 'Production Planner' : 'Procurement',
      eta: priority === 'critical' ? 'today' : priority === 'high' ? 'this week' : 'this month',
      status: 'open',
      score: rank(priority, confidence),
    });
  }

  for (const p of calculateSafetyStockAlerts(input.products)) {
    recs.push({
      id: `plan:safety:${p.sku}`,
      metric: 'inventory',
      icon: 'shield',
      problem: `${p.name} (${p.sku}) is at/below safety stock (${p.availableStock} ≤ ${p.safetyStock}).`,
      businessImpact: 'Buffer stock is exhausted; a demand spike would stock out.',
      rootCause: 'Available stock has fallen to the safety threshold.',
      priority: 'high',
      confidence: 0.9,
      expectedOutcome: 'Replenishing restores the safety buffer.',
      evidence: [`available=${p.availableStock}`, `safetyStock=${p.safetyStock}`],
      sourceSystems: ['planning', 'inventory'],
      recommendedAction: `Replenish ${p.sku} to above ${p.safetyStock}.`,
      owner: 'Procurement',
      eta: 'this week',
      status: 'open',
      score: rank('high', 0.9),
    });
  }

  for (const machine of calculateCapacityBottlenecks(input.machines)) {
    recs.push({
      id: `plan:capacity:${machine}`,
      metric: 'capacity',
      icon: 'activity',
      problem: `${machine} is capacity-constrained (≥ ${CAPACITY_CONSTRAINT_THRESHOLD}% utilization).`,
      businessImpact: 'A bottleneck machine caps production throughput.',
      rootCause: 'Machine utilization is at or above the capacity threshold.',
      priority: 'medium',
      confidence: 0.85,
      expectedOutcome: 'Re-scheduling or off-loading work relieves the bottleneck.',
      evidence: [`threshold=${CAPACITY_CONSTRAINT_THRESHOLD}%`],
      sourceSystems: ['planning', 'manufacturing', 'maintenance'],
      recommendedAction: `Re-schedule work off ${machine} or add capacity.`,
      owner: 'Production Planner',
      eta: 'this month',
      status: 'open',
      score: rank('medium', 0.85),
    });
  }

  return recs.sort((a, b) => b.score - a.score).slice(0, limit);
}
