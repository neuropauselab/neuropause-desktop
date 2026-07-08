/**
 * Contact AI runner — the bridge from a contact to the EXISTING AI pipeline
 * (`aiEngine.run` with a versioned prompt). It hands the deterministic facts +
 * computed relationship health to the model and asks only for narrative
 * (summary + follow-up + opportunity); the model never sets the health band.
 * Returns null when no model is configured or the call is empty, so the module
 * falls back to the deterministic summary.
 */
import type {
  AiEngineRequest,
  AiEngineResponse,
  ContactHealth,
  CrmContact,
} from '@neuropause/shared';
import { contactStatusLabel } from '@neuropause/shared';
import type { ContactAiNarrative } from './contactModule';

/** The slice of the AI engine this module needs (keeps it decoupled + testable). */
export interface ContactAiEngine {
  run(req: AiEngineRequest): Promise<AiEngineResponse>;
}

export async function runContactAi(
  engine: ContactAiEngine,
  contact: CrmContact,
  health: ContactHealth,
): Promise<ContactAiNarrative | null> {
  const facts = [
    `Name: ${contact.name}`,
    `Company: ${contact.company || '(none)'}`,
    `Email: ${contact.email || '(none)'}`,
    `Status: ${contactStatusLabel(contact.status)}`,
    `Priority: ${contact.priority}`,
    `Source: ${contact.source || '(none)'}`,
    `Assigned to: ${contact.assignedTo || '(unassigned)'}`,
    `Last updated: ${contact.updatedAt}`,
    `Deterministic relationship health: ${health.level} — ${health.reason}`,
  ].join('\n');

  const res = await engine.run({
    worker: 'marketing',
    promptId: 'crm.contact-summary',
    tier: 'fast',
    variables: { contact: facts, health: health.level, healthReason: health.reason },
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
