/**
 * Manufacturing AI runners — bridges from production orders / quality inspections /
 * costings to the EXISTING AI pipeline. Each hands deterministic facts to the model
 * and asks only for narrative; the model never computes a quantity, score, or cost.
 * Returns null when no model is configured → deterministic fallback.
 */
import type {
  AiEngineRequest,
  AiEngineResponse,
  ProductionCosting,
  ProductionOrder,
  QualityInspection,
} from '@neuropause/shared';
import {
  calculateManufacturingCost,
  calculateProductionEfficiency,
  calculateProductionVariance,
  calculateQualityScore,
} from '@neuropause/shared';
import type { ProductionOrderAiNarrative } from './productionOrderModule';
import type { QualityAiNarrative } from './qualityModule';
import type { CostingAiNarrative } from './costingModule';

export interface ManufacturingAiEngine {
  run(req: AiEngineRequest): Promise<AiEngineResponse>;
}

interface Narrative {
  summary: string;
  executiveExplanation: string;
  grounded: boolean;
  model: string;
}

async function run(
  engine: ManufacturingAiEngine,
  promptId: string,
  variables: Record<string, string>,
): Promise<Narrative | null> {
  const res = await engine.run({ worker: 'support', promptId, tier: 'fast', variables, maxOutputTokens: 380 });
  if (!res.grounded) return null;
  const data = res.data ?? {};
  const summary = typeof data.summary === 'string' && data.summary.trim() ? data.summary : res.text;
  const executiveExplanation = typeof data.executiveExplanation === 'string' ? data.executiveExplanation : '';
  if (!summary.trim()) return null;
  return { summary, executiveExplanation, grounded: true, model: res.model };
}

export async function runProductionOrderAi(engine: ManufacturingAiEngine, order: ProductionOrder): Promise<ProductionOrderAiNarrative | null> {
  const facts = [
    `Order number: ${order.orderNumber}`,
    `BOM: ${order.bom || '(none)'}`,
    `Finished product: ${order.product || '(from BOM)'}`,
    `Warehouse: ${order.warehouse || '(none)'}`,
    `Planned quantity: ${order.productionQuantity}`,
    `Actual quantity: ${order.actualQuantity}`,
    `Scrap quantity: ${order.scrapQuantity}`,
    `Deterministic efficiency: ${calculateProductionEfficiency(order.productionQuantity, order.actualQuantity)}%`,
    `Status: ${order.status}`,
    `Output movement: ${order.outputMovement || '(not posted)'}`,
  ].join('\n');
  return run(engine, 'manufacturing.production-order-summary', { order: facts, status: order.status });
}

export async function runQualityAi(engine: ManufacturingAiEngine, inspection: QualityInspection): Promise<QualityAiNarrative | null> {
  const facts = [
    `Inspection number: ${inspection.inspectionNumber}`,
    `Production order: ${inspection.productionOrder || '(none)'}`,
    `Stage: ${inspection.stage}`,
    `Inspected: ${inspection.inspectedQuantity}`,
    `Passed: ${inspection.passedQuantity} · Failed: ${inspection.failedQuantity} · Rework: ${inspection.reworkQuantity}`,
    `Deterministic quality score: ${calculateQualityScore(inspection)}%`,
    `Result: ${inspection.result}`,
  ].join('\n');
  return run(engine, 'manufacturing.quality-summary', { inspection: facts, result: inspection.result });
}

export async function runCostingAi(engine: ManufacturingAiEngine, costing: ProductionCosting): Promise<CostingAiNarrative | null> {
  const total = calculateManufacturingCost(costing);
  const facts = [
    `Cost number: ${costing.costNumber}`,
    `Production order: ${costing.productionOrder || '(none)'}`,
    `Material: ${costing.materialCost} · Labor: ${costing.laborCost} · Machine: ${costing.machineCost} · Overhead: ${costing.overheadCost}`,
    `Deterministic total: ${total}`,
    `Standard cost: ${costing.standardCost}`,
    `Deterministic variance: ${calculateProductionVariance(costing.standardCost, total)}`,
    `Status: ${costing.status}`,
  ].join('\n');
  return run(engine, 'manufacturing.costing-summary', { costing: facts, status: costing.status });
}
