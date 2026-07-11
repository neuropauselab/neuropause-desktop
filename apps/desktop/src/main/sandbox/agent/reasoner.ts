/**
 * AI Sandbox — AI QA Agent (S4): the reasoner.
 *
 * Deterministic-first reasoning (per the mandate "use deterministic policies before LLM
 * reasoning where possible"). The {@link DeterministicReasoner} plans hints and explains
 * failures with heuristics and needs no model — it is what the gates exercise. The
 * {@link LlmReasoner} REUSES the existing AI engine through an injected `generate` closure
 * to ENRICH the deterministic narrative, and degrades to it whenever the model is offline
 * (the engine's own fallback returns empty/ungrounded text). The LLM never breaks a run.
 */
import type { QaAgentDefinition, QaGoal, QaObservation, QaReflection } from '@neuropause/shared';
import type { Reasoner, QaReasonerResult } from './ports';

export class DeterministicReasoner implements Reasoner {
  readonly kind = 'deterministic';

  interpretGoal(goal: QaGoal, agent: QaAgentDefinition): Promise<string[]> {
    const hints = new Set<string>();
    const t = goal.text.toLowerCase();
    for (const cap of agent.capabilities) if (t.includes(cap.id.replace(/-/g, ' ')) || t.includes(cap.description.toLowerCase().split(' ')[0])) hints.add(cap.id);
    for (const target of goal.targets) hints.add(`target:${target}`);
    if (/regression|smoke|full/.test(t)) hints.add('breadth:wide');
    if (/quick|fast|single/.test(t)) hints.add('breadth:narrow');
    return Promise.resolve([...hints]);
  }

  explainFailure(observation: QaObservation, reflection: QaReflection): Promise<QaReasonerResult> {
    return Promise.resolve({ text: deterministicNarrative(observation, reflection), confidence: reflection.confidence, tokens: 0, grounded: false });
  }
}

/** Wraps the deterministic reasoner and enriches `explainFailure` with a real model call. */
export class LlmReasoner implements Reasoner {
  readonly kind = 'llm';
  constructor(
    private readonly deterministic: Reasoner,
    private readonly generate: (prompt: string) => Promise<QaReasonerResult>,
  ) {}

  interpretGoal(goal: QaGoal, agent: QaAgentDefinition): Promise<string[]> {
    // Goal interpretation stays deterministic (reproducible planning); the model is used
    // only for narrative enrichment below.
    return this.deterministic.interpretGoal(goal, agent);
  }

  async explainFailure(observation: QaObservation, reflection: QaReflection): Promise<QaReasonerResult> {
    const base = await this.deterministic.explainFailure(observation, reflection);
    try {
      const prompt = buildFailurePrompt(observation, reflection);
      const llm = await this.generate(prompt);
      if (llm.grounded && llm.text.trim().length > 0) {
        return { text: `${llm.text.trim()}\n\n(heuristic: ${base.text})`, confidence: Math.max(base.confidence, llm.confidence), tokens: llm.tokens, grounded: true };
      }
    } catch {
      /* the model is best-effort; fall back to the deterministic narrative */
    }
    return base;
  }
}

function deterministicNarrative(observation: QaObservation, reflection: QaReflection): string {
  const parts: string[] = [];
  parts.push(`Task "${observation.taskId}" ${observation.outcome ?? observation.status} — ${observation.assertions.passed}/${observation.assertions.total} assertion(s) passed.`);
  parts.push(`Classified as ${reflection.failureClass} (confidence ${reflection.confidence.toFixed(2)}).`);
  if (reflection.hypotheses[0]) parts.push(`Most likely cause: ${reflection.hypotheses[0].cause}.`);
  if (observation.error) parts.push(`Error: ${observation.error}.`);
  return parts.join(' ');
}

export function buildFailurePrompt(observation: QaObservation, reflection: QaReflection): string {
  return [
    'A QA scenario failed. Give a concise root-cause hypothesis and a suggested fix.',
    `Outcome: ${observation.outcome ?? observation.status}`,
    `Assertions: ${observation.assertions.passed}/${observation.assertions.total} passed, ${observation.assertions.failed} failed`,
    `Failure class: ${reflection.failureClass}`,
    observation.error ? `Error: ${observation.error}` : '',
    `Metrics: ${JSON.stringify(observation.metrics)}`,
  ].filter(Boolean).join('\n');
}
