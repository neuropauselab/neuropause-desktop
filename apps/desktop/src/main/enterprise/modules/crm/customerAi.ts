/**
 * Customer AI runner — the bridge from a customer account to the EXISTING AI
 * pipeline. It hands the deterministic facts + relationship health + payment risk
 * + lifetime value to the model and asks only for narrative (summary, retention/
 * cross-sell framing, executive explanation); the model never changes the
 * numbers or the health band. Returns null when no model is configured or the
 * call is empty → deterministic fallback.
 */
import type { AiEngineRequest, AiEngineResponse, CrmCustomer } from '@neuropause/shared';
import {
  customerStatusLabel,
  customerTierLabel,
  recommendNextEngagement,
} from '@neuropause/shared';
import type { CustomerAiNarrative, CustomerSignals } from './customerModule';

export interface CustomerAiEngine {
  run(req: AiEngineRequest): Promise<AiEngineResponse>;
}

export async function runCustomerAi(
  engine: CustomerAiEngine,
  customer: CrmCustomer,
  signals: CustomerSignals,
): Promise<CustomerAiNarrative | null> {
  const facts = [
    `Name: ${customer.name}`,
    `Company: ${customer.company || '(none)'}`,
    `Primary contact: ${customer.primaryContact || '(none)'}`,
    `Status: ${customerStatusLabel(customer.status)}`,
    `Tier: ${customerTierLabel(customer.tier)}`,
    `Account manager: ${customer.accountManager || '(unassigned)'}`,
    `Credit limit: ${customer.creditLimit}`,
    `Outstanding balance: ${customer.outstandingBalance}`,
    `Lifetime revenue: ${customer.lifetimeRevenue}`,
    `Payment terms: ${customer.paymentTerms || '(default)'}`,
    `Last updated: ${customer.updatedAt}`,
    `Deterministic lifetime value: ${signals.lifetimeValue}`,
    `Deterministic payment risk: ${signals.paymentRisk}/100`,
    `Deterministic relationship health: ${signals.health.level} — ${signals.health.reason}`,
    `Deterministic next best engagement: ${recommendNextEngagement(customer, signals.health)}`,
  ].join('\n');

  const res = await engine.run({
    worker: 'finance',
    promptId: 'crm.customer-summary',
    tier: 'fast',
    variables: {
      customer: facts,
      health: signals.health.level,
      paymentRisk: String(signals.paymentRisk),
      ltv: String(signals.lifetimeValue),
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
