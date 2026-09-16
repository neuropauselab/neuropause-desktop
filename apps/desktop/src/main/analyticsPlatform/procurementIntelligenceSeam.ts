/**
 * S82 — Procurement KPI seam (the S80 safety-stock pattern, applied to procurement).
 *
 * Reuses EXISTING derivations only:
 *   • open-PO exposure — Σ `calculatePurchaseTotal` over `OPEN_PO_STATUSES` (the shipped sets).
 *   • high-risk suppliers — the COUNT of suppliers at `calculateVendorRisk >= 60`, the repo's
 *     existing cutoff, over each supplier's own goods-receipt evidence (the S82 register rule).
 *
 * Conditions: any high-risk supplier is an exception (breach count 0, mirroring S80's
 * safetyStockCondition — no invented threshold); the exposure LIMIT has no repo-defined value,
 * so its condition defaults to UNCONFIGURED (null) and is fail-closed — it never fires until
 * an operator configures a limit.
 */
import type { GoodsReceipt, PurchaseOrder, Supplier } from '@neuropause/shared';
import { OPEN_PO_STATUSES, calculatePurchaseTotal } from '@neuropause/shared';
import type { KpiObservation } from './kpiSnapshotStore';
import type { KpiCondition } from './kpiSnapshotModel';
import {
  HIGH_RISK_SCORE_CUTOFF,
  countHighRiskSuppliers,
} from '../enterprise/modules/procurement/procurementIntelligenceModel';

export const PROCUREMENT_OPEN_PO_EXPOSURE_KPI = 'procurement.openPoExposure';
export const PROCUREMENT_OPEN_PO_EXPOSURE_CONDITION = 'procurement.openPoExposure.limit';
export const PROCUREMENT_HIGH_RISK_KPI = 'procurement.highRiskSuppliers';
export const PROCUREMENT_HIGH_RISK_CONDITION = 'procurement.highRiskSuppliers.any';

/** Σ open purchase-order totals — existing money rule over the existing open-status set. */
export function openPoExposureObservation(
  orders: Pick<PurchaseOrder, 'status' | 'subtotal' | 'discount' | 'tax'>[],
): KpiObservation {
  const value = orders
    .filter((o) => (OPEN_PO_STATUSES as readonly string[]).includes(o.status))
    .reduce((sum, o) => sum + calculatePurchaseTotal(o), 0);
  return {
    kpiKey: PROCUREMENT_OPEN_PO_EXPOSURE_KPI,
    label: 'Open purchase-order exposure',
    value,
    source: 'procurement-intelligence-seam',
    sourceVersion: 's82',
  };
}

/** Count of suppliers at the existing >=60 vendor-risk cutoff (register parity). */
export function highRiskSuppliersObservation(
  suppliers: Supplier[],
  receipts: GoodsReceipt[],
): KpiObservation {
  return {
    kpiKey: PROCUREMENT_HIGH_RISK_KPI,
    label: `Suppliers at vendor-risk >= ${HIGH_RISK_SCORE_CUTOFF}`,
    value: countHighRiskSuppliers(suppliers, receipts),
    source: 'procurement-intelligence-seam',
    sourceVersion: 's82',
  };
}

/**
 * Any high-risk supplier is an exception (default breach count 0 — the S80 "any breach"
 * disposition; the cutoff itself is the repo's, not a new threshold). Null ⇒ unconfigured.
 */
export function highRiskSuppliersCondition(breachCount: number | null = 0): KpiCondition {
  return {
    conditionId: PROCUREMENT_HIGH_RISK_CONDITION,
    kpiKey: PROCUREMENT_HIGH_RISK_KPI,
    direction: 'above',
    exceptionThreshold: breachCount,
    label: 'High-risk suppliers present',
  };
}

/**
 * Open-PO exposure limit. The repo defines NO exposure limit, so the default is null —
 * UNCONFIGURED and fail-closed: no exception ever fires until an operator sets a limit.
 */
export function openPoExposureCondition(limit: number | null = null): KpiCondition {
  return {
    conditionId: PROCUREMENT_OPEN_PO_EXPOSURE_CONDITION,
    kpiKey: PROCUREMENT_OPEN_PO_EXPOSURE_KPI,
    direction: 'above',
    exceptionThreshold: limit,
    label: 'Open purchase-order exposure over limit',
  };
}
