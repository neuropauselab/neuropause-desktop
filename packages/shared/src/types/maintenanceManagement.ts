/**
 * Maintenance Management — the OPERATIONAL layer for Machines and Assets. Maintenance
 * does not own a second machine state: it writes REAL downtime into the authoritative
 * Machine record (Manufacturing), so Manufacturing's availability / utilization / OEE
 * KPIs derive from maintenance automatically. Spare parts consumed in a repair leave
 * inventory as REAL `production_consumption` movements through the shared Inventory
 * Ledger — never a direct edit.
 *
 * (Distinct from `./maintenance`, which is the Release-Engineering / backup domain.)
 *
 * This file holds the maintenance domain typing (Asset Categories, Assets, Maintenance
 * Plans, Preventive / Corrective Maintenance, Work Orders, Technicians, Maintenance
 * History, Spare Parts, Downtime Events) and the pure deterministic business logic the
 * AI explains but never computes (`calculateMachineAvailability` [reused from
 * Manufacturing], `calculateDowntime`, `calculateMTBF`, `calculateMTTR`,
 * `calculateMaintenanceCompliance`, `calculateMaintenanceCost`, `calculateAssetHealth`,
 * `calculateMaintenanceRisk`, `calculateServiceEfficiency`, `calculateMaintenanceBacklog`).
 * Pure (no I/O).
 */
import type { EnterpriseEntity, EnterpriseRiskLevel } from './enterpriseModule';
import type { ExecutiveKpi } from './executiveCenter';
import type { Machine } from './manufacturing';
import { calculateMachineAvailability } from './manufacturing';

// Reuse the authoritative machine-availability rule (no duplication).
export { calculateMachineAvailability } from './manufacturing';

/* ── module identity ───────────────────────────────────────────────────────── */

export const ASSET_CATEGORIES_MODULE_ID = 'maintenance-asset-categories';
export const ASSET_CATEGORY_KIND = 'asset-category';
export const ASSETS_MODULE_ID = 'maintenance-assets';
export const ASSET_KIND = 'asset';
export const MAINTENANCE_PLANS_MODULE_ID = 'maintenance-plans';
export const MAINTENANCE_PLAN_KIND = 'maintenance-plan';
export const PREVENTIVE_MAINTENANCE_MODULE_ID = 'maintenance-preventive';
export const PREVENTIVE_MAINTENANCE_KIND = 'preventive-maintenance';
export const CORRECTIVE_MAINTENANCE_MODULE_ID = 'maintenance-corrective';
export const CORRECTIVE_MAINTENANCE_KIND = 'corrective-maintenance';
export const WORK_ORDERS_MODULE_ID = 'maintenance-work-orders';
export const WORK_ORDER_KIND = 'work-order';
export const TECHNICIANS_MODULE_ID = 'maintenance-technicians';
export const TECHNICIAN_KIND = 'technician';
export const MAINTENANCE_HISTORY_MODULE_ID = 'maintenance-history';
export const MAINTENANCE_HISTORY_KIND = 'maintenance-history';
export const SPARE_PARTS_MODULE_ID = 'maintenance-spare-parts';
export const SPARE_PART_KIND = 'spare-part';
export const DOWNTIME_EVENTS_MODULE_ID = 'maintenance-downtime';
export const DOWNTIME_EVENT_KIND = 'downtime-event';

/* ── statuses ──────────────────────────────────────────────────────────────── */

export type AssetStatus = 'operational' | 'maintenance' | 'retired';
export type AssetCriticality = 'low' | 'medium' | 'high' | 'critical';
export type MaintenancePlanStatus = 'active' | 'inactive';
export type MaintenanceFrequency = 'daily' | 'weekly' | 'monthly' | 'quarterly' | 'yearly';
export type PreventiveStatus = 'scheduled' | 'due' | 'completed' | 'skipped';
export type CorrectiveStatus = 'open' | 'in_progress' | 'resolved';
export type WorkOrderType = 'preventive' | 'corrective' | 'inspection';
export type WorkOrderStatus = 'scheduled' | 'assigned' | 'in_progress' | 'completed' | 'verified' | 'cancelled';
export type WorkOrderPriority = 'low' | 'medium' | 'high' | 'urgent';
export type TechnicianStatus = 'available' | 'busy' | 'off_duty';
export type SparePartStatus = 'draft' | 'consumed' | 'cancelled';
export type DowntimeType = 'planned' | 'unplanned';
export type DowntimeStatus = 'open' | 'logged';
export type MaintenanceResult = 'pass' | 'fail' | 'rework';

/** Work orders still open (not yet completed / verified / cancelled). */
export const OPEN_WORK_ORDER_STATUSES: readonly WorkOrderStatus[] = ['scheduled', 'assigned', 'in_progress'];

const DAY_MS = 24 * 60 * 60 * 1000;

/* ── typed projections ─────────────────────────────────────────────────────── */

export interface AssetCategory {
  id: string;
  name: string;
  code: string;
  description: string;
}

export interface Asset {
  id: string;
  assetTag: string;
  name: string;
  category: string;
  location: string;
  machine: string;
  criticality: AssetCriticality;
  purchaseCost: number;
  purchaseDate: string;
  breakdownCount: number;
  status: AssetStatus;
}

export interface MaintenancePlan {
  id: string;
  planNumber: string;
  asset: string;
  machine: string;
  frequency: MaintenanceFrequency;
  intervalDays: number;
  task: string;
  lastServiced: string;
  status: MaintenancePlanStatus;
}

export interface PreventiveMaintenance {
  id: string;
  pmNumber: string;
  plan: string;
  asset: string;
  machine: string;
  scheduledDate: string;
  completedDate: string;
  status: PreventiveStatus;
  workOrder: string;
}

export interface CorrectiveMaintenance {
  id: string;
  cmNumber: string;
  asset: string;
  machine: string;
  faultDescription: string;
  reportedDate: string;
  status: CorrectiveStatus;
  workOrder: string;
}

export interface WorkOrder {
  id: string;
  workOrderNumber: string;
  type: WorkOrderType;
  machine: string;
  asset: string;
  technician: string;
  priority: WorkOrderPriority;
  description: string;
  scheduledDate: string;
  completedDate: string;
  downtimeHours: number;
  laborCost: number;
  partsCost: number;
  result: MaintenanceResult;
  status: WorkOrderStatus;
  historyRecord: string;
  createdAt: string;
  updatedAt: string;
}

export interface Technician {
  id: string;
  name: string;
  code: string;
  skill: string;
  shift: string;
  assignedOrders: number;
  status: TechnicianStatus;
}

export interface MaintenanceHistory {
  id: string;
  historyNumber: string;
  workOrder: string;
  machine: string;
  asset: string;
  type: WorkOrderType;
  technician: string;
  downtimeHours: number;
  totalCost: number;
  result: MaintenanceResult;
  completedDate: string;
}

export interface SparePart {
  id: string;
  partNumber: string;
  workOrder: string;
  product: string;
  quantity: number;
  warehouse: string;
  unitCost: number;
  status: SparePartStatus;
  consumptionMovement: string;
}

export interface DowntimeEvent {
  id: string;
  eventNumber: string;
  machine: string;
  type: DowntimeType;
  cause: string;
  startTime: string;
  endTime: string;
  durationHours: number;
  workOrder: string;
  status: DowntimeStatus;
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

export function assetCategoryFromRecord(record: EnterpriseEntity): AssetCategory {
  const f = record.fields;
  return { id: record.id, name: str(f.name) || record.title, code: str(f.code), description: str(f.description) };
}

export function assetFromRecord(record: EnterpriseEntity): Asset {
  const f = record.fields;
  return {
    id: record.id,
    assetTag: str(f.assetTag) || record.title,
    name: str(f.name) || record.title,
    category: str(f.category),
    location: str(f.location),
    machine: str(f.machine),
    criticality: oneOf<AssetCriticality>(f.criticality, ['low', 'medium', 'high', 'critical'], 'medium'),
    purchaseCost: num(f.purchaseCost),
    purchaseDate: str(f.purchaseDate),
    breakdownCount: num(f.breakdownCount),
    status: oneOf<AssetStatus>(f.status, ['operational', 'maintenance', 'retired'], 'operational'),
  };
}

export function maintenancePlanFromRecord(record: EnterpriseEntity): MaintenancePlan {
  const f = record.fields;
  return {
    id: record.id,
    planNumber: str(f.planNumber) || record.title,
    asset: str(f.asset),
    machine: str(f.machine),
    frequency: oneOf<MaintenanceFrequency>(f.frequency, ['daily', 'weekly', 'monthly', 'quarterly', 'yearly'], 'monthly'),
    intervalDays: num(f.intervalDays),
    task: str(f.task),
    lastServiced: str(f.lastServiced),
    status: oneOf<MaintenancePlanStatus>(f.status, ['active', 'inactive'], 'active'),
  };
}

export function preventiveMaintenanceFromRecord(record: EnterpriseEntity): PreventiveMaintenance {
  const f = record.fields;
  return {
    id: record.id,
    pmNumber: str(f.pmNumber) || record.title,
    plan: str(f.plan),
    asset: str(f.asset),
    machine: str(f.machine),
    scheduledDate: str(f.scheduledDate),
    completedDate: str(f.completedDate),
    status: oneOf<PreventiveStatus>(f.status, ['scheduled', 'due', 'completed', 'skipped'], 'scheduled'),
    workOrder: str(f.workOrder),
  };
}

export function correctiveMaintenanceFromRecord(record: EnterpriseEntity): CorrectiveMaintenance {
  const f = record.fields;
  return {
    id: record.id,
    cmNumber: str(f.cmNumber) || record.title,
    asset: str(f.asset),
    machine: str(f.machine),
    faultDescription: str(f.faultDescription),
    reportedDate: str(f.reportedDate),
    status: oneOf<CorrectiveStatus>(f.status, ['open', 'in_progress', 'resolved'], 'open'),
    workOrder: str(f.workOrder),
  };
}

export function workOrderFromRecord(record: EnterpriseEntity): WorkOrder {
  const f = record.fields;
  return {
    id: record.id,
    workOrderNumber: str(f.workOrderNumber) || record.title,
    type: oneOf<WorkOrderType>(f.type, ['preventive', 'corrective', 'inspection'], 'corrective'),
    machine: str(f.machine),
    asset: str(f.asset),
    technician: str(f.technician),
    priority: oneOf<WorkOrderPriority>(f.priority, ['low', 'medium', 'high', 'urgent'], 'medium'),
    description: str(f.description),
    scheduledDate: str(f.scheduledDate),
    completedDate: str(f.completedDate),
    downtimeHours: num(f.downtimeHours),
    laborCost: num(f.laborCost),
    partsCost: num(f.partsCost),
    result: oneOf<MaintenanceResult>(f.result, ['pass', 'fail', 'rework'], 'pass'),
    status: oneOf<WorkOrderStatus>(f.status, ['scheduled', 'assigned', 'in_progress', 'completed', 'verified', 'cancelled'], 'scheduled'),
    historyRecord: str(f.historyRecord),
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

export function technicianFromRecord(record: EnterpriseEntity): Technician {
  const f = record.fields;
  return {
    id: record.id,
    name: str(f.name) || record.title,
    code: str(f.code),
    skill: str(f.skill),
    shift: str(f.shift),
    assignedOrders: num(f.assignedOrders),
    status: oneOf<TechnicianStatus>(f.status, ['available', 'busy', 'off_duty'], 'available'),
  };
}

export function maintenanceHistoryFromRecord(record: EnterpriseEntity): MaintenanceHistory {
  const f = record.fields;
  return {
    id: record.id,
    historyNumber: str(f.historyNumber) || record.title,
    workOrder: str(f.workOrder),
    machine: str(f.machine),
    asset: str(f.asset),
    type: oneOf<WorkOrderType>(f.type, ['preventive', 'corrective', 'inspection'], 'corrective'),
    technician: str(f.technician),
    downtimeHours: num(f.downtimeHours),
    totalCost: num(f.totalCost),
    result: oneOf<MaintenanceResult>(f.result, ['pass', 'fail', 'rework'], 'pass'),
    completedDate: str(f.completedDate),
  };
}

export function sparePartFromRecord(record: EnterpriseEntity): SparePart {
  const f = record.fields;
  return {
    id: record.id,
    partNumber: str(f.partNumber) || record.title,
    workOrder: str(f.workOrder),
    product: str(f.product),
    quantity: num(f.quantity),
    warehouse: str(f.warehouse),
    unitCost: num(f.unitCost),
    status: oneOf<SparePartStatus>(f.status, ['draft', 'consumed', 'cancelled'], 'draft'),
    consumptionMovement: str(f.consumptionMovement),
  };
}

export function downtimeEventFromRecord(record: EnterpriseEntity): DowntimeEvent {
  const f = record.fields;
  return {
    id: record.id,
    eventNumber: str(f.eventNumber) || record.title,
    machine: str(f.machine),
    type: oneOf<DowntimeType>(f.type, ['planned', 'unplanned'], 'unplanned'),
    cause: str(f.cause),
    startTime: str(f.startTime),
    endTime: str(f.endTime),
    durationHours: num(f.durationHours),
    workOrder: str(f.workOrder),
    status: oneOf<DowntimeStatus>(f.status, ['open', 'logged'], 'open'),
  };
}

/* ── deterministic business logic (AI explains; it never sets these) ──────────*/

const clamp = (n: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, n));
function parseDay(d: string): number | null {
  if (!d) return null;
  const t = Date.parse(d);
  return Number.isFinite(t) ? t : null;
}

/** Total downtime hours across events. Deterministic. */
export function calculateDowntime(events: Array<Pick<DowntimeEvent, 'durationHours'>>): number {
  return Math.round(events.reduce((s, e) => s + Math.max(0, e.durationHours), 0) * 10) / 10;
}

/** Mean Time Between Failures — operating hours per breakdown. Deterministic. */
export function calculateMTBF(operatingHours: number, breakdowns: number): number {
  if (breakdowns <= 0) return Math.round(operatingHours);
  return Math.round(operatingHours / breakdowns);
}

/** Mean Time To Repair — repair hours per repair. Deterministic. */
export function calculateMTTR(totalRepairHours: number, repairs: number): number {
  if (repairs <= 0) return 0;
  return Math.round((totalRepairHours / repairs) * 10) / 10;
}

/** Preventive-maintenance compliance 0..100 — completed vs scheduled. Deterministic. */
export function calculateMaintenanceCompliance(completed: number, scheduled: number): number {
  if (scheduled <= 0) return 100;
  return clamp(Math.round((completed / scheduled) * 100), 0, 100);
}

/** Total maintenance cost — labor + parts across work orders. Deterministic. */
export function calculateMaintenanceCost(rows: Array<Pick<WorkOrder, 'laborCost' | 'partsCost'>>): number {
  return Math.round(rows.reduce((s, r) => s + r.laborCost + r.partsCost, 0));
}

export interface AssetHealth {
  level: EnterpriseRiskLevel;
  reason: string;
}

/** Deterministic asset health from status, breakdowns, and criticality. */
export function calculateAssetHealth(asset: Pick<Asset, 'status' | 'breakdownCount' | 'criticality'>): AssetHealth {
  if (asset.status === 'retired') return { level: 'low', reason: 'Asset retired.' };
  if (asset.status === 'maintenance') return { level: 'high', reason: 'Asset under maintenance.' };
  if (asset.breakdownCount >= 5) return { level: 'high', reason: 'Frequent breakdowns.' };
  if (asset.breakdownCount >= 2) return { level: 'medium', reason: 'Repeated breakdowns.' };
  if (asset.criticality === 'critical') return { level: 'medium', reason: 'Critical asset — monitor closely.' };
  return { level: 'low', reason: 'Asset operational.' };
}

/** Maintenance risk 0..100 — rises with criticality, breakdowns, and overdue service. Deterministic. */
export function calculateMaintenanceRisk(
  asset: Pick<Asset, 'criticality' | 'breakdownCount' | 'status'>,
  daysSinceService: number,
): number {
  let risk = 0;
  const critScore: Record<AssetCriticality, number> = { low: 5, medium: 15, high: 30, critical: 45 };
  risk += critScore[asset.criticality];
  risk += clamp(asset.breakdownCount * 8, 0, 32);
  if (daysSinceService > 90) risk += 20;
  else if (daysSinceService > 30) risk += 10;
  if (asset.status === 'maintenance') risk += 10;
  return clamp(Math.round(risk), 0, 100);
}

/** Service efficiency 0..100 — work orders completed on time vs total completed. Deterministic. */
export function calculateServiceEfficiency(completedOnTime: number, totalCompleted: number): number {
  if (totalCompleted <= 0) return 100;
  return clamp(Math.round((completedOnTime / totalCompleted) * 100), 0, 100);
}

/** Maintenance backlog — count of open (not completed/verified/cancelled) work orders. Deterministic. */
export function calculateMaintenanceBacklog(workOrders: Array<Pick<WorkOrder, 'status'>>): number {
  return workOrders.filter((w) => (OPEN_WORK_ORDER_STATUSES as readonly string[]).includes(w.status)).length;
}

/** Whether a work order was completed on or before its scheduled date. Deterministic. */
export function workOrderOnTime(workOrder: Pick<WorkOrder, 'scheduledDate' | 'completedDate'>): boolean {
  const scheduled = parseDay(workOrder.scheduledDate);
  const completed = parseDay(workOrder.completedDate);
  if (scheduled === null || completed === null) return true;
  return completed <= scheduled + DAY_MS;
}

/* ── fallbacks (deterministic AI summaries) ────────────────────────────────── */

function money(value: number): string {
  return value.toLocaleString(undefined, { maximumFractionDigits: 0 });
}

export function workOrderSummaryFallback(w: WorkOrder): { summary: string; executiveExplanation: string } {
  const cost = calculateMaintenanceCost([w]);
  const summary =
    `${w.workOrderNumber} (${w.type}): ${w.machine || w.asset || 'an asset'} — ${w.status.replace('_', ' ')}.` +
    (w.downtimeHours > 0 ? ` ${w.downtimeHours}h downtime.` : '') +
    (cost > 0 ? ` Cost ${money(cost)}.` : '') +
    (w.technician ? ` Technician ${w.technician}.` : '');
  const executiveExplanation =
    w.status === 'verified'
      ? `${w.workOrderNumber} restored ${w.machine || w.asset} (${w.result}).`
      : `${w.workOrderNumber} is ${w.status.replace('_', ' ')}.`;
  return { summary, executiveExplanation };
}

export function assetSummaryFallback(asset: Asset, health: AssetHealth): { summary: string; executiveExplanation: string } {
  const summary =
    `${asset.name} (${asset.assetTag}) is a ${asset.criticality} asset in ${asset.location || 'the facility'}, ` +
    `status ${asset.status}, ${asset.breakdownCount} breakdown(s). ${health.reason}`;
  const executiveExplanation =
    health.level === 'high'
      ? `${asset.name} needs attention — ${health.reason.toLowerCase()}`
      : `${asset.name} is ${asset.status}.`;
  return { summary, executiveExplanation };
}

export function downtimeEventSummaryFallback(e: DowntimeEvent): { summary: string; executiveExplanation: string } {
  const summary =
    `${e.eventNumber}: ${e.type} downtime on ${e.machine || 'a machine'} for ${e.durationHours}h` +
    (e.cause ? ` (${e.cause})` : '') +
    `, status ${e.status}.`;
  const executiveExplanation =
    e.type === 'unplanned'
      ? `${e.machine || 'A machine'} lost ${e.durationHours}h to an unplanned event.`
      : `${e.machine || 'A machine'} had ${e.durationHours}h planned downtime.`;
  return { summary, executiveExplanation };
}

/* ── aggregate insights (Executive Center) ─────────────────────────────────── */

export interface MaintenanceModuleInsights {
  machineAvailability: number;
  maintenanceCompliance: number;
  preventiveCompletion: number;
  breakdownRate: number;
  maintenanceCost: number;
  downtimeHours: number;
  assetHealth: number;
  technicianUtilization: number;
  serviceEfficiency: number;
  maintenanceBacklog: number;
}

export interface MaintenanceInsightsInput {
  machines: Machine[];
  assets: Asset[];
  workOrders: WorkOrder[];
  preventives: PreventiveMaintenance[];
  downtimeEvents: DowntimeEvent[];
  technicians: Technician[];
}

function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return Math.round(values.reduce((a, b) => a + b, 0) / values.length);
}

/** Roll the maintenance records into the Maintenance KPIs. Pure. */
export function deriveMaintenanceInsights(input: MaintenanceInsightsInput): MaintenanceModuleInsights {
  const machineAvailability = mean(input.machines.map((m) => calculateMachineAvailability(m.runtime, m.downtime)));
  const scheduledPm = input.preventives.filter((p) => p.status !== 'skipped').length;
  const completedPm = input.preventives.filter((p) => p.status === 'completed').length;
  const unplanned = input.downtimeEvents.filter((e) => e.type === 'unplanned').length;
  const completedWorkOrders = input.workOrders.filter((w) => w.status === 'completed' || w.status === 'verified');
  const onTime = completedWorkOrders.filter((w) => workOrderOnTime(w)).length;
  const activeAssets = input.assets.filter((a) => a.status !== 'retired');
  const healthyAssets = activeAssets.filter((a) => calculateAssetHealth(a).level === 'low').length;

  return {
    machineAvailability,
    maintenanceCompliance: calculateMaintenanceCompliance(completedPm, scheduledPm),
    preventiveCompletion: input.preventives.length === 0 ? 100 : clamp(Math.round((completedPm / input.preventives.length) * 100), 0, 100),
    breakdownRate: input.downtimeEvents.length === 0 ? 0 : clamp(Math.round((unplanned / input.downtimeEvents.length) * 100), 0, 100),
    maintenanceCost: calculateMaintenanceCost(input.workOrders),
    downtimeHours: calculateDowntime(input.downtimeEvents),
    assetHealth: activeAssets.length === 0 ? 100 : clamp(Math.round((healthyAssets / activeAssets.length) * 100), 0, 100),
    technicianUtilization:
      input.technicians.length === 0
        ? 0
        : clamp(Math.round((input.technicians.filter((t) => t.status === 'busy').length / input.technicians.length) * 100), 0, 100),
    serviceEfficiency: calculateServiceEfficiency(onTime, completedWorkOrders.length),
    maintenanceBacklog: calculateMaintenanceBacklog(input.workOrders),
  };
}

export interface MaintenanceHealthSummary {
  level: EnterpriseRiskLevel;
  reason: string;
}

/** Deterministic maintenance health from the operational KPIs. */
export function calculateMaintenanceHealth(insights: MaintenanceModuleInsights): MaintenanceHealthSummary {
  if (insights.machineAvailability < 70) return { level: 'high', reason: 'Machine availability below 70%.' };
  if (insights.maintenanceCompliance < 70) return { level: 'high', reason: 'PM compliance below 70%.' };
  if (insights.breakdownRate > 50) return { level: 'medium', reason: 'Majority of downtime is unplanned.' };
  if (insights.maintenanceBacklog > 10) return { level: 'medium', reason: 'Large maintenance backlog.' };
  return { level: 'low', reason: 'Maintenance operating within targets.' };
}

/** Map maintenance insights to Executive Center KPI tiles (reuses the existing KPI type). */
export function maintenanceInsightsToKpis(insights: MaintenanceModuleInsights): ExecutiveKpi[] {
  const pctBand = (v: number): ExecutiveKpi['band'] => (v >= 90 ? 'healthy' : v >= 75 ? 'watch' : 'at-risk');
  const breakdownBand: ExecutiveKpi['band'] =
    insights.breakdownRate <= 20 ? 'healthy' : insights.breakdownRate <= 50 ? 'watch' : 'at-risk';
  const health = calculateMaintenanceHealth(insights);
  const healthBand: ExecutiveKpi['band'] =
    health.level === 'high' ? 'at-risk' : health.level === 'medium' ? 'watch' : 'healthy';
  return [
    { key: 'mnt-availability', label: 'Machine Availability', value: insights.machineAvailability, display: `${insights.machineAvailability}%`, band: pctBand(insights.machineAvailability), deepLink: 'enterprise/modules' },
    { key: 'mnt-compliance', label: 'Maintenance Compliance', value: insights.maintenanceCompliance, display: `${insights.maintenanceCompliance}%`, band: pctBand(insights.maintenanceCompliance), deepLink: 'enterprise/modules' },
    { key: 'mnt-preventive', label: 'Preventive Completion', value: insights.preventiveCompletion, display: `${insights.preventiveCompletion}%`, band: pctBand(insights.preventiveCompletion), deepLink: 'enterprise/modules' },
    { key: 'mnt-breakdown', label: 'Breakdown Rate', value: insights.breakdownRate, display: `${insights.breakdownRate}%`, band: breakdownBand, deepLink: 'enterprise/modules' },
    { key: 'mnt-cost', label: 'Maintenance Cost', value: null, display: money(insights.maintenanceCost), deepLink: 'enterprise/modules' },
    { key: 'mnt-downtime', label: 'Downtime', value: insights.downtimeHours, display: `${insights.downtimeHours}h`, deepLink: 'enterprise/modules' },
    { key: 'mnt-asset-health', label: 'Asset Health', value: insights.assetHealth, display: `${insights.assetHealth}%`, band: pctBand(insights.assetHealth), deepLink: 'enterprise/modules' },
    { key: 'mnt-tech-util', label: 'Technician Utilization', value: insights.technicianUtilization, display: `${insights.technicianUtilization}%`, deepLink: 'enterprise/modules' },
    { key: 'mnt-service', label: 'Service Efficiency', value: insights.serviceEfficiency, display: `${insights.serviceEfficiency}%`, band: pctBand(insights.serviceEfficiency), deepLink: 'enterprise/modules' },
    { key: 'mnt-health', label: 'Maintenance Health', value: null, display: health.level === 'low' ? 'healthy' : health.reason, band: healthBand, deepLink: 'enterprise/modules' },
  ];
}
