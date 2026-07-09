/**
 * Payment AI runner — the bridge from a payment to the EXISTING AI pipeline. It
 * hands the deterministic facts + payment health to the model and asks only for
 * narrative; the model never sets the health band or any amount. Returns null
 * when no model is configured or the call is empty → deterministic fallback.
 */
import type { AiEngineRequest, AiEngineResponse, SalesPayment } from '@neuropause/shared';
import {
  calculatePaymentHealth,
  paymentMethodLabel,
  paymentStatusLabel,
} from '@neuropause/shared';
import type { PaymentAiNarrative } from './paymentModule';

export interface PaymentAiEngine {
  run(req: AiEngineRequest): Promise<AiEngineResponse>;
}

export async function runPaymentAi(
  engine: PaymentAiEngine,
  payment: SalesPayment,
): Promise<PaymentAiNarrative | null> {
  const health = calculatePaymentHealth(payment);
  const facts = [
    `Payment number: ${payment.paymentNumber}`,
    `Invoice: ${payment.invoiceRef || '(none)'}`,
    `Customer: ${payment.customer || '(none)'}`,
    `Amount: ${payment.currency} ${payment.amount}`,
    `Method: ${paymentMethodLabel(payment.method) || '(none)'}`,
    `Status: ${paymentStatusLabel(payment.status)}`,
    `Received: ${payment.receivedDate || '(none)'}`,
    `Transaction ref: ${payment.transactionRef || '(none)'}`,
    `Bank account: ${payment.bankAccount || '(none)'}`,
    `Deterministic health: ${health.level} — ${health.reason}`,
  ].join('\n');

  const res = await engine.run({
    worker: 'finance',
    promptId: 'finance.payment-summary',
    tier: 'fast',
    variables: { payment: facts, health: health.level, healthReason: health.reason },
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
