/**
 * Order AI runner — the bridge from a sales order to the EXISTING AI pipeline. It
 * hands the deterministic facts + fulfillment + shipment progress + revenue
 * recognition + delivery risk to the model and asks only for narrative (summary,
 * fulfillment/delivery framing, executive explanation); the model never changes
 * the numbers or the health band. Returns null when no model is configured or the
 * call is empty → deterministic fallback.
 */
import type { AiEngineRequest, AiEngineResponse, OrderSignals, SalesOrder } from '@neuropause/shared';
import { orderStatusLabel } from '@neuropause/shared';
import type { OrderAiNarrative } from './orderModule';

export interface OrderAiEngine {
  run(req: AiEngineRequest): Promise<AiEngineResponse>;
}

export async function runOrderAi(
  engine: OrderAiEngine,
  order: SalesOrder,
  signals: OrderSignals,
): Promise<OrderAiNarrative | null> {
  const facts = [
    `Order number: ${order.orderNumber}`,
    `Customer: ${order.customer || '(none)'}`,
    `Status: ${orderStatusLabel(order.status)}`,
    `Currency: ${order.currency}`,
    `Total: ${order.total}`,
    `Ordered qty: ${order.orderedQty}`,
    `Fulfilled qty: ${order.fulfilledQty}`,
    `Order date: ${order.orderDate || '(none)'}`,
    `Expected delivery: ${order.expectedDeliveryDate || '(none)'}`,
    `Shipped date: ${order.shippedDate || '(not shipped)'}`,
    `Delivered date: ${order.deliveredDate || '(not delivered)'}`,
    `Carrier: ${order.carrier || '(none)'}`,
    `Last updated: ${order.updatedAt}`,
    `Deterministic stage: ${signals.assessment.stage}${signals.assessment.delayed ? ' (delayed)' : ''}`,
    `Deterministic fulfillment: ${signals.fulfillment}%`,
    `Deterministic shipment progress: ${signals.shipmentProgress}%`,
    `Deterministic recognized revenue: ${signals.revenue.recognized} (pending ${signals.revenue.pending})`,
    `Deterministic delivery risk: ${signals.deliveryRisk}/100`,
    `Deterministic health: ${signals.assessment.health} — ${signals.assessment.reason}`,
  ].join('\n');

  const res = await engine.run({
    worker: 'support',
    promptId: 'sales.order-summary',
    tier: 'fast',
    variables: {
      order: facts,
      fulfillment: String(signals.fulfillment),
      deliveryRisk: String(signals.deliveryRisk),
      health: signals.assessment.health,
    },
    maxOutputTokens: 450,
  });

  if (!res.grounded) return null;
  const data = res.data ?? {};
  const summary = typeof data.summary === 'string' && data.summary.trim() ? data.summary : res.text;
  const executiveExplanation =
    typeof data.executiveExplanation === 'string' ? data.executiveExplanation : '';
  if (!summary.trim()) return null;
  return { summary, executiveExplanation, grounded: true, model: res.model };
}
