/**
 * Product AI runner — the bridge from a product to the EXISTING AI pipeline. It
 * hands the deterministic facts + stock health to the model and asks only for
 * narrative; the model never sets the health band or any quantity. Returns null
 * when no model is configured or the call is empty → deterministic fallback.
 */
import type { AiEngineRequest, AiEngineResponse, Product, StockHealth } from '@neuropause/shared';
import { calculateReorderRequirement } from '@neuropause/shared';
import type { ProductAiNarrative } from './productModule';

export interface ProductAiEngine {
  run(req: AiEngineRequest): Promise<AiEngineResponse>;
}

export async function runProductAi(
  engine: ProductAiEngine,
  product: Product,
  health: StockHealth,
): Promise<ProductAiNarrative | null> {
  const facts = [
    `SKU: ${product.sku}`,
    `Name: ${product.name}`,
    `Category: ${product.category || '(none)'}`,
    `Unit: ${product.unit}`,
    `On hand: ${product.currentStock}`,
    `Reserved: ${product.reservedStock}`,
    `Available: ${product.availableStock}`,
    `Reorder level: ${product.reorderLevel}`,
    `Safety stock: ${product.safetyStock}`,
    `Maximum stock: ${product.maximumStock}`,
    `Standard cost: ${product.standardCost}`,
    `Deterministic stock health: ${health.status} — ${health.reason}`,
    `Deterministic reorder requirement: ${calculateReorderRequirement(product)}`,
  ].join('\n');

  const res = await engine.run({
    worker: 'support',
    promptId: 'inventory.product-summary',
    tier: 'fast',
    variables: { product: facts, health: health.status, healthReason: health.reason },
    maxOutputTokens: 400,
  });

  if (!res.grounded) return null;
  const data = res.data ?? {};
  const summary = typeof data.summary === 'string' && data.summary.trim() ? data.summary : res.text;
  const executiveExplanation =
    typeof data.executiveExplanation === 'string' ? data.executiveExplanation : '';
  if (!summary.trim()) return null;
  return { summary, executiveExplanation, grounded: true, model: res.model };
}
