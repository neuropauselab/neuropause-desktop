/**
 * Lead AI runner — the bridge from a lead to the EXISTING AI pipeline. It hands
 * the deterministic facts + score + conversion probability + health to the model
 * and asks only for narrative (summary, score explanation, next best action,
 * opportunity, follow-up); the model never changes the numbers. Returns null
 * when no model is configured or the call is empty → deterministic fallback.
 */
import type { AiEngineRequest, AiEngineResponse, CrmLead } from '@neuropause/shared';
import { leadStageLabel, nextBestAction } from '@neuropause/shared';
import type { LeadAiNarrative, LeadSignals } from './leadModule';

export interface LeadAiEngine {
  run(req: AiEngineRequest): Promise<AiEngineResponse>;
}

export async function runLeadAi(
  engine: LeadAiEngine,
  lead: CrmLead,
  signals: LeadSignals,
): Promise<LeadAiNarrative | null> {
  const facts = [
    `Name: ${lead.name}`,
    `Company: ${lead.company || '(none)'}`,
    `Stage: ${leadStageLabel(lead.stage)}`,
    `Estimated deal value: ${lead.dealValue}`,
    `Priority: ${lead.priority}`,
    `Source: ${lead.source || '(none)'}`,
    `Expected close: ${lead.expectedCloseDate ?? '(none)'}`,
    `Assigned to: ${lead.assignedTo || '(unassigned)'}`,
    `Last updated: ${lead.updatedAt}`,
    `Deterministic lead score: ${signals.score}/100`,
    `Deterministic conversion probability: ${Math.round(signals.probability * 100)}%`,
    `Deterministic health: ${signals.health.level} — ${signals.health.reason}`,
    `Deterministic next best action: ${nextBestAction(lead, signals.health)}`,
  ].join('\n');

  const res = await engine.run({
    worker: 'marketing',
    promptId: 'crm.lead-summary',
    tier: 'fast',
    variables: {
      lead: facts,
      score: String(signals.score),
      probability: String(Math.round(signals.probability * 100)),
      health: signals.health.level,
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
