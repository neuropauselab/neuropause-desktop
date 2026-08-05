/**
 * The governed, evidence-grounded answer path shared by copilots, workspace, and
 * briefings. Every answer: (1) builds a prompt that carries its EVIDENCE inline, (2)
 * runs through the reused ai-runtime `InferencePipeline.generate` (which audits + events
 * the base AI execution), (3) computes confidence from the evidence, and (4) records the
 * enriched governance envelope (evidence/confidence/sources). The result is an `AiAnswer`
 * that always references evidence, carries confidence, and is auditable — by construction.
 */
import { sha256Hex } from '@neuropause/cloud-core';
import type { InferencePipeline, AiMessage } from '@neuropause/ai-runtime';
import { computeConfidence, type AiAnswer, type EvidenceRef } from './types';
import type { IntelligenceGovernance } from './governance';
import { SYSTEM_GROUNDED } from './ai';

const uniq = (xs: string[]): string[] => [...new Set(xs)];

/** Fold the evidence into the user prompt so the provider (and any LLM) is grounded. */
export function withEvidence(user: string, evidence: EvidenceRef[]): string {
  if (evidence.length === 0) return `${user}\n\nEVIDENCE:\n(none)`;
  const lines = evidence.map((e) => `- ${e.kind} ${e.id}${e.detail ? ` (${e.detail})` : ''} [${e.source}]`);
  return `${user}\n\nEVIDENCE:\n${lines.join('\n')}`;
}

export interface AnswerRequest {
  tenantId: string;
  actor: string;
  kind: string;
  question: string;
  evidence: EvidenceRef[];
  model?: string;
  system?: string;
}

export class AnswerEngine {
  constructor(
    private readonly inference: InferencePipeline,
    private readonly governance: IntelligenceGovernance,
    private readonly defaultModel = 'deterministic-1',
  ) {}

  async answer(req: AnswerRequest): Promise<AiAnswer> {
    const model = req.model ?? this.defaultModel;
    const messages: AiMessage[] = [
      { role: 'system', content: req.system ?? SYSTEM_GROUNDED },
      { role: 'user', content: withEvidence(req.question, req.evidence) },
    ];
    const { result, record } = await this.inference.generate({ model, messages }, { actor: req.actor });
    const confidence = computeConfidence(req.evidence);
    const sources = uniq(req.evidence.map((e) => e.source));
    const costUsd = record.cost?.usd ?? 0;
    const ref = await this.governance.record({
      tenantId: req.tenantId,
      actor: req.actor,
      kind: req.kind,
      promptHash: sha256Hex(messages.map((m) => m.content).join('\n')),
      model: result.model,
      provider: result.provider,
      evidence: req.evidence,
      sources,
      confidence,
      latencyMs: record.durationMs,
      costUsd,
      baseTraceId: record.traceId,
    });
    return {
      text: result.text,
      confidence,
      evidence: req.evidence,
      sources,
      model: result.model,
      provider: result.provider,
      auditId: ref.auditId,
      replayId: ref.replayId,
      latencyMs: record.durationMs,
      costUsd,
    };
  }
}
