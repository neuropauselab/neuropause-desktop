/**
 * S80 — Inventory safety-stock exception: the one real production use case.
 *
 * Reuses EXISTING master data: each product's OWN `safetyStock`/`currentStock` fields (the same
 * fields the auto-reorder seam reads). "Below safety stock" is the definitional condition the
 * S80 directive names — no financial threshold is invented. The aggregate KPI is the COUNT of
 * products below their own safety stock; the exception fires when that count exceeds the
 * configured breach count (default 0 = any breach). The breach count is configurable and
 * fail-closed (null ⇒ no exception).
 */
import type { KpiObservation } from './kpiSnapshotStore';
import type { KpiCondition } from './kpiSnapshotModel';

export interface ProductStockLike {
  sku: string;
  currentStock: number;
  safetyStock: number;
}

export const INVENTORY_BELOW_SAFETY_KPI = 'inventory.belowSafetyStock';
export const INVENTORY_SAFETY_CONDITION = 'inventory.belowSafetyStock.any';

/** Compute the below-safety-stock KPI observation from existing product master data. */
export function belowSafetyStockObservation(products: ProductStockLike[]): KpiObservation {
  const breaching = products.filter((p) => Number(p.safetyStock) > 0 && Number(p.currentStock) < Number(p.safetyStock));
  return {
    kpiKey: INVENTORY_BELOW_SAFETY_KPI,
    label: 'Products below safety stock',
    value: breaching.length,
    source: 'inventory-safety-stock-seam',
    sourceVersion: 's80',
  };
}

/**
 * The safety-stock condition. `breachCount` = the count above which it is an EXCEPTION.
 * Default 0 ⇒ any product below its own safety stock is an exception. Pass null to leave it
 * UNCONFIGURED (fail-closed — no exception ever fires until an operator configures it).
 */
export function safetyStockCondition(breachCount: number | null = 0): KpiCondition {
  return {
    conditionId: INVENTORY_SAFETY_CONDITION,
    kpiKey: INVENTORY_BELOW_SAFETY_KPI,
    direction: 'above',
    exceptionThreshold: breachCount,
    label: 'Inventory below safety stock',
  };
}
