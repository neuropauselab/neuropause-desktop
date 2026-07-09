/**
 * Movement AI runner — the bridge from a stock movement to the EXISTING AI
 * pipeline. It hands the deterministic facts to the model and asks only for
 * narrative; the model never sets the stock effect. Returns null when no model is
 * configured or the call is empty → deterministic fallback.
 */
import type { AiEngineRequest, AiEngineResponse, StockMovement } from '@neuropause/shared';
import { movementOnHandDelta, movementTypeLabel } from '@neuropause/shared';
import type { MovementAiNarrative } from './stockMovementModule';

export interface MovementAiEngine {
  run(req: AiEngineRequest): Promise<AiEngineResponse>;
}

export async function runMovementAi(
  engine: MovementAiEngine,
  movement: StockMovement,
): Promise<MovementAiNarrative | null> {
  const facts = [
    `Movement number: ${movement.movementNumber}`,
    `Type: ${movementTypeLabel(movement.type)}`,
    `Product: ${movement.product || '(none)'}`,
    `Warehouse: ${movement.warehouse || '(none)'}`,
    `From warehouse: ${movement.fromWarehouse || '(n/a)'}`,
    `Quantity: ${movement.quantity}`,
    `Unit cost: ${movement.unitCost}`,
    `Status: ${movement.status}`,
    `Reference: ${movement.referenceModule || '(none)'} ${movement.referenceRecord || ''}`.trim(),
    `Reason: ${movement.reason || '(none)'}`,
    `Deterministic on-hand effect: ${movementOnHandDelta(movement)}`,
  ].join('\n');

  const res = await engine.run({
    worker: 'support',
    promptId: 'inventory.movement-summary',
    tier: 'fast',
    variables: { movement: facts, type: movementTypeLabel(movement.type) },
    maxOutputTokens: 350,
  });

  if (!res.grounded) return null;
  const data = res.data ?? {};
  const summary = typeof data.summary === 'string' && data.summary.trim() ? data.summary : res.text;
  const executiveExplanation =
    typeof data.executiveExplanation === 'string' ? data.executiveExplanation : '';
  if (!summary.trim()) return null;
  return { summary, executiveExplanation, grounded: true, model: res.model };
}
