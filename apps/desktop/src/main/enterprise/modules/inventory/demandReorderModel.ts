/**
 * S85 — Governed Demand→Reorder / Safety-Stock RECOMMENDATION Intelligence: the PURE model.
 *
 * This is RECOMMENDATION-ONLY. It computes NOTHING new about reorder policy and it EXECUTES
 * nothing. Every semantic is REUSED from the repository's own canonical engines:
 *   • `assessReorder` (packages/shared/types/autoReorder.ts) — the reorder trigger, target level,
 *     and suggested quantity (position = availableStock + openSupply ≤ reorderLevel ⇒ triggered).
 *   • `openSupplyForProduct` (same file) — incoming supply on open purchase requests + orders.
 *   • `deriveDemandTrendSnapshot` (S84) — the demand direction per SKU, attached as CONTEXT only.
 *
 * The reorder TRIGGER and QUANTITY are `assessReorder`'s (repo-defined). The S84 demand direction
 * is informational — it does NOT shift the trigger or quantity (how demand would move a reorder
 * point is an undefined policy and is deliberately NOT invented; see DECISION-MEMO-S85). No
 * threshold is invented. It NEVER drafts a purchase request (that is `runReorderCheck`, the
 * execution seam, which this model does not import or call).
 *
 * Electron-free and store-free: every input is a plain array, so it unit-tests directly.
 */
import type { Product, Shipping, EnterpriseEntity } from '@neuropause/shared';
import { assessReorder, openSupplyForProduct } from '@neuropause/shared';
import { deriveDemandTrendSnapshot, type DemandDirection } from '../sales/demandTrendModel';

export type ReorderAttention = 'reorder' | 'ok';

export interface ReorderRecommendationRow {
  sku: string;
  onHand: number;
  availableStock: number;
  reservedStock: number;
  safetyStock: number;
  reorderLevel: number;
  openSupply: number; // incoming, from open PRs + POs (openSupplyForProduct)
  position: number; // availableStock + openSupply (the figure compared to reorderLevel)
  targetLevel: number;
  attention: ReorderAttention;
  /** ONLY from assessReorder.suggestedQuantity when triggered; 0 otherwise. Never fabricated. */
  recommendedQuantity: number;
  demandDirection: DemandDirection; // context only — never alters trigger/quantity
  demandLatestPeriod: string;
  demandLatestDemand: number;
  reason: string;
}

export interface ReorderRecommendationSnapshot {
  asOfDate: string;
  skuCount: number;
  reorderCount: number;
  okCount: number;
  totalRecommendedQuantity: number;
  rows: ReorderRecommendationRow[];
}

interface ReorderInputs {
  products: Product[];
  purchaseRequests: EnterpriseEntity[];
  purchaseOrders: EnterpriseEntity[];
  shipments: Shipping[];
}

/**
 * Derive reorder recommendations for every ACTIVE product. Deterministic; read-only; empty in →
 * honestly empty out. Rows sorted by SKU so regeneration from identical inputs is byte-identical.
 */
export function deriveReorderRecommendations(
  input: ReorderInputs,
  asOfDate: string,
): ReorderRecommendationSnapshot {
  // S84 demand direction per SKU (context only).
  const demand = deriveDemandTrendSnapshot(input.shipments, asOfDate);
  const demandBySku = new Map(demand.rows.map((r) => [r.sku, r]));

  const rows: ReorderRecommendationRow[] = [];
  for (const product of input.products) {
    if (product.status !== 'active') continue; // assessReorder applies to active products only
    const openSupply = openSupplyForProduct({
      sku: product.sku,
      productId: '', // resolve by SKU across PR/PO records (matching the auto-reorder seam)
      purchaseRequests: input.purchaseRequests,
      purchaseOrders: input.purchaseOrders,
    });
    const a = assessReorder({ product, openSupply });
    const d = demandBySku.get(product.sku);
    const demandDirection: DemandDirection = d ? d.direction : 'insufficient-data';
    const reason =
      `${a.note} Demand trend: ${demandDirection}` +
      (d && d.latestPeriod ? ` (latest ${d.latestPeriod}: ${d.latestDemand}).` : ' (no shipped demand history).');
    rows.push({
      sku: product.sku,
      onHand: product.currentStock,
      availableStock: a.availableStock,
      reservedStock: product.reservedStock,
      safetyStock: product.safetyStock,
      reorderLevel: a.reorderLevel,
      openSupply: a.openSupply,
      position: a.position,
      targetLevel: a.targetLevel,
      attention: a.triggered ? 'reorder' : 'ok',
      recommendedQuantity: a.triggered ? a.suggestedQuantity : 0,
      demandDirection,
      demandLatestPeriod: d?.latestPeriod ?? '',
      demandLatestDemand: d?.latestDemand ?? 0,
      reason,
    });
  }
  rows.sort((x, y) => x.sku.localeCompare(y.sku));

  const snap: ReorderRecommendationSnapshot = {
    asOfDate,
    skuCount: rows.length,
    reorderCount: 0,
    okCount: 0,
    totalRecommendedQuantity: 0,
    rows,
  };
  for (const r of rows) {
    if (r.attention === 'reorder') {
      snap.reorderCount += 1;
      snap.totalRecommendedQuantity += r.recommendedQuantity;
    } else {
      snap.okCount += 1;
    }
  }
  return snap;
}
