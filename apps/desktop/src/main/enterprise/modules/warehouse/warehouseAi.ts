/**
 * Warehouse AI runners — bridges from transfer orders / cycle counts / stock
 * adjustments to the EXISTING AI pipeline. Each hands deterministic facts to the
 * model and asks only for narrative; the model never computes a variance, quantity,
 * or value. Returns null when no model is configured → deterministic fallback.
 */
import type {
  AiEngineRequest,
  AiEngineResponse,
  CycleCount,
  StockAdjustment,
  TransferOrder,
} from '@neuropause/shared';
import {
  adjustmentReasonLabel,
  calculateAdjustmentImpact,
  calculateCycleCountVariance,
} from '@neuropause/shared';
import type { TransferAiNarrative } from './transferOrderModule';
import type { CycleCountAiNarrative } from './cycleCountModule';
import type { StockAdjustmentAiNarrative } from './stockAdjustmentModule';

export interface WarehouseAiEngine {
  run(req: AiEngineRequest): Promise<AiEngineResponse>;
}

interface Narrative {
  summary: string;
  executiveExplanation: string;
  grounded: boolean;
  model: string;
}

async function run(
  engine: WarehouseAiEngine,
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

export async function runTransferAi(engine: WarehouseAiEngine, transfer: TransferOrder): Promise<TransferAiNarrative | null> {
  const facts = [
    `Transfer number: ${transfer.transferNumber}`,
    `Product: ${transfer.product || '(none)'}`,
    `Quantity: ${transfer.quantity}`,
    `From warehouse: ${transfer.fromWarehouse || '(none)'}`,
    `To warehouse: ${transfer.toWarehouse || '(none)'}`,
    `Status: ${transfer.status}`,
    `Transfer-out movement: ${transfer.outMovement || '(not posted)'}`,
    `Transfer-in movement: ${transfer.inMovement || '(not posted)'}`,
  ].join('\n');
  return run(engine, 'warehouse.transfer-summary', { transfer: facts, status: transfer.status });
}

export async function runCycleCountAi(engine: WarehouseAiEngine, count: CycleCount): Promise<CycleCountAiNarrative | null> {
  const variance = calculateCycleCountVariance(count.systemQuantity, count.countedQuantity);
  const facts = [
    `Count number: ${count.countNumber}`,
    `Product: ${count.product || '(none)'}`,
    `Warehouse: ${count.warehouse || '(none)'}`,
    `System quantity: ${count.systemQuantity}`,
    `Counted quantity: ${count.countedQuantity}`,
    `Deterministic variance: ${variance >= 0 ? '+' : ''}${variance}`,
    `Status: ${count.status}`,
    `Adjustment movement: ${count.adjustmentMovement || '(none)'}`,
  ].join('\n');
  return run(engine, 'warehouse.cycle-count-summary', { count: facts, variance: String(variance) });
}

export async function runStockAdjustmentAi(engine: WarehouseAiEngine, adjustment: StockAdjustment): Promise<StockAdjustmentAiNarrative | null> {
  const facts = [
    `Adjustment number: ${adjustment.adjustmentNumber}`,
    `Product: ${adjustment.product || '(none)'}`,
    `Warehouse: ${adjustment.warehouse || '(none)'}`,
    `Quantity: ${adjustment.quantity >= 0 ? '+' : ''}${adjustment.quantity}`,
    `Reason: ${adjustmentReasonLabel(adjustment.reason)}`,
    `Deterministic value impact: ${calculateAdjustmentImpact([adjustment])}`,
    `Status: ${adjustment.status}`,
    `Movement: ${adjustment.adjustmentMovement || '(not posted)'}`,
  ].join('\n');
  return run(engine, 'warehouse.adjustment-summary', { adjustment: facts, reason: adjustment.reason });
}
