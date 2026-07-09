/**
 * Manufacturing Execution — the PRODUCTION layer over Inventory. Manufacturing
 * consumes components and yields finished goods, and every stock effect is a REAL
 * Stock Movement in the shared Inventory Ledger: components leave as
 * `production_consumption` movements, finished goods arrive as `production_output`
 * movements — never a direct edit. Inventory remains the accounting layer and single
 * source of truth; Warehouse remains the execution layer that supplies material.
 *
 * This file holds the manufacturing domain typing (Bill of Materials, Production
 * Orders, Work Centers, Machines, Production Scheduling, Production Execution,
 * Quality Inspection, Production Costing), the BOM component parser, and the pure
 * deterministic business logic the AI explains but never computes
 * (`calculateProductionEfficiency`, `calculateProductionYield`,
 * `calculateMachineUtilization`, `calculateManufacturingCost`, `calculateScrapRate`,
 * `calculateProductionVariance`, `calculateQualityScore`, `calculateProductionHealth`,
 * `calculateCapacityUtilization`, `calculateOverallEquipmentEffectiveness`). Pure (no I/O).
 */
import type { EnterpriseEntity, EnterpriseRiskLevel } from './enterpriseModule';
import type { ExecutiveKpi } from './executiveCenter';

/* ── module identity ───────────────────────────────────────────────────────── */

export const BOM_MODULE_ID = 'manufacturing-bom';
export const BOM_KIND = 'bom';
export const PRODUCTION_ORDERS_MODULE_ID = 'manufacturing-orders';
export const PRODUCTION_ORDER_KIND = 'production-order';
export const WORK_CENTERS_MODULE_ID = 'manufacturing-work-centers';
export const WORK_CENTER_KIND = 'work-center';
export const MACHINES_MODULE_ID = 'manufacturing-machines';
export const MACHINE_KIND = 'machine';
export const PRODUCTION_SCHEDULES_MODULE_ID = 'manufacturing-schedules';
export const PRODUCTION_SCHEDULE_KIND = 'production-schedule';
export const PRODUCTION_EXECUTIONS_MODULE_ID = 'manufacturing-executions';
export const PRODUCTION_EXECUTION_KIND = 'production-execution';
export const QUALITY_INSPECTIONS_MODULE_ID = 'manufacturing-quality';
export const QUALITY_INSPECTION_KIND = 'quality-inspection';
export const PRODUCTION_COSTINGS_MODULE_ID = 'manufacturing-costing';
export const PRODUCTION_COSTING_KIND = 'production-costing';

/* ── statuses ──────────────────────────────────────────────────────────────── */

export type BomStatus = 'draft' | 'active' | 'archived';
export type ProductionOrderStatus = 'draft' | 'planned' | 'released' | 'running' | 'completed' | 'cancelled';
export type WorkCenterStatus = 'active' | 'inactive';
export type MachineStatus = 'running' | 'idle' | 'maintenance' | 'down';
export type ProductionScheduleStatus = 'scheduled' | 'in_progress' | 'done' | 'cancelled';
export type ProductionExecutionStatus = 'running' | 'paused' | 'completed';
export type QualityStage = 'incoming' | 'in_process' | 'final';
export type QualityResult = 'pass' | 'fail' | 'rework' | 'reject';
export type QualityStatus = 'draft' | 'inspected';
export type CostingStatus = 'draft' | 'finalized';

/** Production orders that are committed but not yet completed. */
export const OPEN_PRODUCTION_STATUSES: readonly ProductionOrderStatus[] = ['planned', 'released', 'running'];

/* ── BOM components (stored as JSON in a textarea field) ───────────────────── */

export interface BomComponent {
  sku: string;
  quantity: number;
  waste: number;
  alternative: string;
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

/**
 * Parse a BOM's components from its JSON textarea field. Tolerant: bad JSON or a
 * non-array yields an empty list; each entry is coerced and blank/zero rows dropped.
 * Deterministic (no I/O).
 */
export function parseBomComponents(raw: unknown): BomComponent[] {
  const text = str(raw).trim();
  if (!text) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  return parsed
    .map((c) => {
      const row = (c ?? {}) as Record<string, unknown>;
      return {
        sku: str(row.sku),
        quantity: num(row.quantity),
        waste: num(row.waste),
        alternative: str(row.alternative),
      };
    })
    .filter((c) => c.sku !== '' && c.quantity > 0);
}

/** Serialize components back to the canonical JSON textarea form. Deterministic. */
export function serializeBomComponents(components: BomComponent[]): string {
  return JSON.stringify(components);
}

/**
 * Quantity of a component consumed to build `productionQuantity` units, scaled by
 * waste (component waste overrides the BOM waste). Deterministic.
 */
export function componentConsumption(
  component: BomComponent,
  productionQuantity: number,
  bomWaste: number,
): number {
  const waste = component.waste || bomWaste || 0;
  return Math.max(0, Math.round(component.quantity * productionQuantity * (1 + waste / 100)));
}

/* ── typed projections ─────────────────────────────────────────────────────── */

export interface BillOfMaterials {
  id: string;
  bomNumber: string;
  product: string;
  outputQuantity: number;
  yield: number;
  waste: number;
  revision: string;
  components: BomComponent[];
  status: BomStatus;
  notes: string;
}

export interface ProductionOrder {
  id: string;
  orderNumber: string;
  bom: string;
  product: string;
  warehouse: string;
  productionQuantity: number;
  actualQuantity: number;
  scrapQuantity: number;
  workCenter: string;
  machine: string;
  operator: string;
  productionTime: number;
  status: ProductionOrderStatus;
  consumptionMovements: string;
  outputMovement: string;
  createdAt: string;
  updatedAt: string;
}

export interface WorkCenter {
  id: string;
  name: string;
  code: string;
  capacity: number;
  efficiency: number;
  shift: string;
  queueLoad: number;
  status: WorkCenterStatus;
}

export interface Machine {
  id: string;
  name: string;
  code: string;
  workCenter: string;
  runtime: number;
  downtime: number;
  maintenanceDue: string;
  status: MachineStatus;
}

export interface ProductionSchedule {
  id: string;
  scheduleNumber: string;
  productionOrder: string;
  workCenter: string;
  machine: string;
  startDate: string;
  endDate: string;
  status: ProductionScheduleStatus;
}

export interface ProductionExecution {
  id: string;
  executionNumber: string;
  productionOrder: string;
  operator: string;
  machine: string;
  startTime: string;
  endTime: string;
  goodQuantity: number;
  scrapQuantity: number;
  downtime: number;
  status: ProductionExecutionStatus;
}

export interface QualityInspection {
  id: string;
  inspectionNumber: string;
  productionOrder: string;
  stage: QualityStage;
  inspectedQuantity: number;
  passedQuantity: number;
  failedQuantity: number;
  reworkQuantity: number;
  result: QualityResult;
  qualityScore: number;
  inspector: string;
  status: QualityStatus;
}

export interface ProductionCosting {
  id: string;
  costNumber: string;
  productionOrder: string;
  materialCost: number;
  laborCost: number;
  machineCost: number;
  overheadCost: number;
  totalCost: number;
  standardCost: number;
  variance: number;
  status: CostingStatus;
}

export function bomFromRecord(record: EnterpriseEntity): BillOfMaterials {
  const f = record.fields;
  return {
    id: record.id,
    bomNumber: str(f.bomNumber) || record.title,
    product: str(f.product),
    outputQuantity: num(f.outputQuantity) || 1,
    yield: f.yield === undefined || f.yield === null || f.yield === '' ? 100 : num(f.yield),
    waste: num(f.waste),
    revision: str(f.revision),
    components: parseBomComponents(f.components),
    status: oneOf<BomStatus>(f.status, ['draft', 'active', 'archived'], 'draft'),
    notes: str(f.notes),
  };
}

export function productionOrderFromRecord(record: EnterpriseEntity): ProductionOrder {
  const f = record.fields;
  return {
    id: record.id,
    orderNumber: str(f.orderNumber) || record.title,
    bom: str(f.bom),
    product: str(f.product),
    warehouse: str(f.warehouse),
    productionQuantity: num(f.productionQuantity),
    actualQuantity: num(f.actualQuantity),
    scrapQuantity: num(f.scrapQuantity),
    workCenter: str(f.workCenter),
    machine: str(f.machine),
    operator: str(f.operator),
    productionTime: num(f.productionTime),
    status: oneOf<ProductionOrderStatus>(
      f.status,
      ['draft', 'planned', 'released', 'running', 'completed', 'cancelled'],
      'draft',
    ),
    consumptionMovements: str(f.consumptionMovements),
    outputMovement: str(f.outputMovement),
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

export function workCenterFromRecord(record: EnterpriseEntity): WorkCenter {
  const f = record.fields;
  return {
    id: record.id,
    name: str(f.name) || record.title,
    code: str(f.code),
    capacity: num(f.capacity),
    efficiency: f.efficiency === undefined || f.efficiency === null || f.efficiency === '' ? 100 : num(f.efficiency),
    shift: str(f.shift),
    queueLoad: num(f.queueLoad),
    status: oneOf<WorkCenterStatus>(f.status, ['active', 'inactive'], 'active'),
  };
}

export function machineFromRecord(record: EnterpriseEntity): Machine {
  const f = record.fields;
  return {
    id: record.id,
    name: str(f.name) || record.title,
    code: str(f.code),
    workCenter: str(f.workCenter),
    runtime: num(f.runtime),
    downtime: num(f.downtime),
    maintenanceDue: str(f.maintenanceDue),
    status: oneOf<MachineStatus>(f.status, ['running', 'idle', 'maintenance', 'down'], 'idle'),
  };
}

export function productionScheduleFromRecord(record: EnterpriseEntity): ProductionSchedule {
  const f = record.fields;
  return {
    id: record.id,
    scheduleNumber: str(f.scheduleNumber) || record.title,
    productionOrder: str(f.productionOrder),
    workCenter: str(f.workCenter),
    machine: str(f.machine),
    startDate: str(f.startDate),
    endDate: str(f.endDate),
    status: oneOf<ProductionScheduleStatus>(f.status, ['scheduled', 'in_progress', 'done', 'cancelled'], 'scheduled'),
  };
}

export function productionExecutionFromRecord(record: EnterpriseEntity): ProductionExecution {
  const f = record.fields;
  return {
    id: record.id,
    executionNumber: str(f.executionNumber) || record.title,
    productionOrder: str(f.productionOrder),
    operator: str(f.operator),
    machine: str(f.machine),
    startTime: str(f.startTime),
    endTime: str(f.endTime),
    goodQuantity: num(f.goodQuantity),
    scrapQuantity: num(f.scrapQuantity),
    downtime: num(f.downtime),
    status: oneOf<ProductionExecutionStatus>(f.status, ['running', 'paused', 'completed'], 'running'),
  };
}

export function qualityInspectionFromRecord(record: EnterpriseEntity): QualityInspection {
  const f = record.fields;
  return {
    id: record.id,
    inspectionNumber: str(f.inspectionNumber) || record.title,
    productionOrder: str(f.productionOrder),
    stage: oneOf<QualityStage>(f.stage, ['incoming', 'in_process', 'final'], 'final'),
    inspectedQuantity: num(f.inspectedQuantity),
    passedQuantity: num(f.passedQuantity),
    failedQuantity: num(f.failedQuantity),
    reworkQuantity: num(f.reworkQuantity),
    result: oneOf<QualityResult>(f.result, ['pass', 'fail', 'rework', 'reject'], 'pass'),
    qualityScore: num(f.qualityScore),
    inspector: str(f.inspector),
    status: oneOf<QualityStatus>(f.status, ['draft', 'inspected'], 'draft'),
  };
}

export function productionCostingFromRecord(record: EnterpriseEntity): ProductionCosting {
  const f = record.fields;
  return {
    id: record.id,
    costNumber: str(f.costNumber) || record.title,
    productionOrder: str(f.productionOrder),
    materialCost: num(f.materialCost),
    laborCost: num(f.laborCost),
    machineCost: num(f.machineCost),
    overheadCost: num(f.overheadCost),
    totalCost: num(f.totalCost),
    standardCost: num(f.standardCost),
    variance: num(f.variance),
    status: oneOf<CostingStatus>(f.status, ['draft', 'finalized'], 'draft'),
  };
}

/* ── deterministic business logic (AI explains; it never sets these) ──────────*/

const clamp = (n: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, n));

/** Production efficiency 0..∞ — actual output vs planned (100 = on plan). Deterministic. */
export function calculateProductionEfficiency(plannedQuantity: number, actualQuantity: number): number {
  if (plannedQuantity <= 0) return 0;
  return Math.max(0, Math.round((actualQuantity / plannedQuantity) * 100));
}

/** Production yield 0..100 — good output vs total produced (good + scrap). Deterministic. */
export function calculateProductionYield(goodQuantity: number, scrapQuantity: number): number {
  const total = goodQuantity + scrapQuantity;
  if (total <= 0) return 0;
  return clamp(Math.round((goodQuantity / total) * 100), 0, 100);
}

/** Machine utilization 0..100 — runtime vs available time. Deterministic. */
export function calculateMachineUtilization(runtime: number, availableTime: number): number {
  if (availableTime <= 0) return 0;
  return clamp(Math.round((runtime / availableTime) * 100), 0, 100);
}

/** Machine availability 0..100 — runtime vs runtime + downtime (for OEE). Deterministic. */
export function calculateMachineAvailability(runtime: number, downtime: number): number {
  const total = runtime + downtime;
  if (total <= 0) return 100;
  return clamp(Math.round((runtime / total) * 100), 0, 100);
}

export interface CostInputs {
  materialCost: number;
  laborCost: number;
  machineCost: number;
  overheadCost: number;
}

/** Total manufacturing cost — material + labor + machine + overhead. Deterministic. */
export function calculateManufacturingCost(c: CostInputs): number {
  return Math.round(c.materialCost + c.laborCost + c.machineCost + c.overheadCost);
}

/** Scrap rate 0..100 — scrap vs total produced (good + scrap). Deterministic. */
export function calculateScrapRate(goodQuantity: number, scrapQuantity: number): number {
  const total = goodQuantity + scrapQuantity;
  if (total <= 0) return 0;
  return clamp(Math.round((scrapQuantity / total) * 100), 0, 100);
}

/** Production cost variance — actual − standard (signed; positive = over budget). Deterministic. */
export function calculateProductionVariance(standardCost: number, actualCost: number): number {
  return Math.round(actualCost - standardCost);
}

export interface QualityTally {
  passedQuantity: number;
  failedQuantity: number;
  reworkQuantity: number;
}

/** Quality score 0..100 — passed (+ half credit for rework) vs total inspected. Deterministic. */
export function calculateQualityScore(t: QualityTally): number {
  const total = t.passedQuantity + t.failedQuantity + t.reworkQuantity;
  if (total <= 0) return 100;
  return clamp(Math.round(((t.passedQuantity + t.reworkQuantity * 0.5) / total) * 100), 0, 100);
}

/** Capacity utilization 0..100 — load vs capacity (work center). Deterministic. */
export function calculateCapacityUtilization(load: number, capacity: number): number {
  if (capacity <= 0) return 0;
  return clamp(Math.round((load / capacity) * 100), 0, 100);
}

/** OEE 0..100 — Availability × Performance × Quality (each a 0..100 input). Deterministic. */
export function calculateOverallEquipmentEffectiveness(
  availability: number,
  performance: number,
  quality: number,
): number {
  const a = clamp(availability, 0, 100) / 100;
  const p = clamp(performance, 0, 100) / 100;
  const q = clamp(quality, 0, 100) / 100;
  return clamp(Math.round(a * p * q * 100), 0, 100);
}

export interface ManufacturingHealth {
  level: EnterpriseRiskLevel;
  reason: string;
}

/** Deterministic manufacturing health from the operational KPIs. */
export function calculateProductionHealth(metrics: {
  efficiency: number;
  scrapRate: number;
  qualityScore: number;
  oee: number;
}): ManufacturingHealth {
  if (metrics.qualityScore < 80) return { level: 'high', reason: 'Quality score below 80%.' };
  if (metrics.scrapRate > 10) return { level: 'high', reason: 'Scrap rate above 10%.' };
  if (metrics.oee < 60) return { level: 'medium', reason: 'OEE below 60%.' };
  if (metrics.efficiency < 80) return { level: 'medium', reason: 'Production efficiency below plan.' };
  return { level: 'low', reason: 'Manufacturing operating within targets.' };
}

/* ── fallbacks (deterministic AI summaries) ────────────────────────────────── */

function money(value: number): string {
  return value.toLocaleString(undefined, { maximumFractionDigits: 0 });
}

export function productionOrderSummaryFallback(order: ProductionOrder): { summary: string; executiveExplanation: string } {
  const efficiency = calculateProductionEfficiency(order.productionQuantity, order.actualQuantity);
  const summary =
    `${order.orderNumber}: ${order.productionQuantity} × ${order.product || 'a product'} (BOM ${order.bom || '—'}) is ${order.status}.` +
    (order.actualQuantity > 0 ? ` Produced ${order.actualQuantity} (${efficiency}% of plan), scrap ${order.scrapQuantity}.` : '') +
    (order.outputMovement ? ' Finished goods posted to inventory.' : '');
  const executiveExplanation =
    order.status === 'completed'
      ? `${order.orderNumber} produced ${order.actualQuantity || order.productionQuantity} of ${order.product}.`
      : `${order.orderNumber} is ${order.status}.`;
  return { summary, executiveExplanation };
}

export function qualityInspectionSummaryFallback(q: QualityInspection): { summary: string; executiveExplanation: string } {
  const score = calculateQualityScore(q);
  const summary =
    `${q.inspectionNumber} (${q.stage.replace('_', '-')}): inspected ${q.inspectedQuantity}, ` +
    `${q.passedQuantity} passed / ${q.failedQuantity} failed / ${q.reworkQuantity} rework — ${score}% quality, result ${q.result}.`;
  const executiveExplanation =
    q.result === 'pass'
      ? `${q.inspectionNumber} passed at ${score}% quality.`
      : `${q.inspectionNumber} is ${q.result} (${score}% quality).`;
  return { summary, executiveExplanation };
}

export function productionCostingSummaryFallback(c: ProductionCosting): { summary: string; executiveExplanation: string } {
  const total = calculateManufacturingCost(c);
  const variance = calculateProductionVariance(c.standardCost, total);
  const summary =
    `${c.costNumber}: material ${money(c.materialCost)} + labor ${money(c.laborCost)} + machine ${money(c.machineCost)} + overhead ${money(c.overheadCost)} = ${money(total)}.` +
    (c.standardCost > 0 ? ` Variance ${variance >= 0 ? '+' : ''}${money(variance)} vs standard.` : '');
  const executiveExplanation =
    variance > 0
      ? `${c.costNumber} is ${money(variance)} over standard cost.`
      : `${c.costNumber} totals ${money(total)}${c.standardCost > 0 ? ' (at or under standard)' : ''}.`;
  return { summary, executiveExplanation };
}

/* ── aggregate insights (Executive Center) ─────────────────────────────────── */

export interface ManufacturingModuleInsights {
  productionEfficiency: number;
  productionThroughput: number;
  manufacturingCost: number;
  machineUtilization: number;
  oee: number;
  scrapRate: number;
  yield: number;
  productionAccuracy: number;
  qualityScore: number;
  openProductionOrders: number;
}

export interface ManufacturingInsightsInput {
  orders: ProductionOrder[];
  machines: Machine[];
  qualityInspections: QualityInspection[];
  costings: ProductionCosting[];
  workCenters: WorkCenter[];
}

function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return Math.round(values.reduce((a, b) => a + b, 0) / values.length);
}

/** Roll the manufacturing records into the Manufacturing KPIs. Pure. */
export function deriveManufacturingInsights(input: ManufacturingInsightsInput): ManufacturingModuleInsights {
  const completed = input.orders.filter((o) => o.status === 'completed');
  const goodTotal = completed.reduce((s, o) => s + Math.max(0, o.actualQuantity), 0);
  const scrapTotal = completed.reduce((s, o) => s + Math.max(0, o.scrapQuantity), 0);
  const plannedTotal = completed.reduce((s, o) => s + Math.max(0, o.productionQuantity), 0);

  const machineUtil = mean(input.machines.map((m) => calculateMachineUtilization(m.runtime, m.runtime + m.downtime)));
  const availability = mean(input.machines.map((m) => calculateMachineAvailability(m.runtime, m.downtime)));
  const efficiency = plannedTotal <= 0 ? 0 : calculateProductionEfficiency(plannedTotal, goodTotal);
  const quality =
    input.qualityInspections.length === 0
      ? 100
      : mean(input.qualityInspections.map((q) => calculateQualityScore(q)));
  const oee = calculateOverallEquipmentEffectiveness(availability, Math.min(100, efficiency), quality);

  const accurate = completed.filter(
    (o) => o.productionQuantity > 0 && Math.abs(o.actualQuantity - o.productionQuantity) <= 0,
  ).length;

  return {
    productionEfficiency: efficiency,
    productionThroughput: goodTotal,
    manufacturingCost: Math.round(input.costings.reduce((s, c) => s + calculateManufacturingCost(c), 0)),
    machineUtilization: machineUtil,
    oee,
    scrapRate: calculateScrapRate(goodTotal, scrapTotal),
    yield: calculateProductionYield(goodTotal, scrapTotal),
    productionAccuracy: completed.length === 0 ? 100 : clamp(Math.round((accurate / completed.length) * 100), 0, 100),
    qualityScore: quality,
    openProductionOrders: input.orders.filter((o) => (OPEN_PRODUCTION_STATUSES as readonly string[]).includes(o.status))
      .length,
  };
}

/** Map manufacturing insights to Executive Center KPI tiles (reuses the existing KPI type). */
export function manufacturingInsightsToKpis(insights: ManufacturingModuleInsights): ExecutiveKpi[] {
  const pctBand = (v: number): ExecutiveKpi['band'] => (v >= 90 ? 'healthy' : v >= 75 ? 'watch' : 'at-risk');
  const scrapBand: ExecutiveKpi['band'] =
    insights.scrapRate <= 3 ? 'healthy' : insights.scrapRate <= 10 ? 'watch' : 'at-risk';
  const health = calculateProductionHealth({
    efficiency: insights.productionEfficiency,
    scrapRate: insights.scrapRate,
    qualityScore: insights.qualityScore,
    oee: insights.oee,
  });
  const healthBand: ExecutiveKpi['band'] =
    health.level === 'high' ? 'at-risk' : health.level === 'medium' ? 'watch' : 'healthy';
  return [
    { key: 'mfg-efficiency', label: 'Production Efficiency', value: insights.productionEfficiency, display: `${insights.productionEfficiency}%`, band: pctBand(insights.productionEfficiency), deepLink: 'enterprise/modules' },
    { key: 'mfg-throughput', label: 'Production Throughput', value: insights.productionThroughput, display: money(insights.productionThroughput), deepLink: 'enterprise/modules' },
    { key: 'mfg-cost', label: 'Manufacturing Cost', value: null, display: money(insights.manufacturingCost), deepLink: 'enterprise/modules' },
    { key: 'mfg-machine-util', label: 'Machine Utilization', value: insights.machineUtilization, display: `${insights.machineUtilization}%`, band: pctBand(insights.machineUtilization), deepLink: 'enterprise/modules' },
    { key: 'mfg-oee', label: 'OEE', value: insights.oee, display: `${insights.oee}%`, band: pctBand(insights.oee), deepLink: 'enterprise/modules' },
    { key: 'mfg-scrap', label: 'Scrap Rate', value: insights.scrapRate, display: `${insights.scrapRate}%`, band: scrapBand, deepLink: 'enterprise/modules' },
    { key: 'mfg-yield', label: 'Yield', value: insights.yield, display: `${insights.yield}%`, band: pctBand(insights.yield), deepLink: 'enterprise/modules' },
    { key: 'mfg-accuracy', label: 'Production Accuracy', value: insights.productionAccuracy, display: `${insights.productionAccuracy}%`, band: pctBand(insights.productionAccuracy), deepLink: 'enterprise/modules' },
    { key: 'mfg-quality', label: 'Quality Score', value: insights.qualityScore, display: `${insights.qualityScore}%`, band: pctBand(insights.qualityScore), deepLink: 'enterprise/modules' },
    { key: 'mfg-health', label: 'Manufacturing Health', value: null, display: health.level === 'low' ? 'healthy' : health.reason, band: healthBand, deepLink: 'enterprise/modules' },
  ];
}
