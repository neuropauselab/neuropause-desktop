/**
 * Module 11 — Governance. Every AI interaction records prompt (hashed), context,
 * evidence, model, latency, cost, confidence, sources, audit id, and replay id — on the
 * ONE runtime audit chain and event bus. This ENRICHES the base ai-runtime governance
 * record (which the InferencePipeline already writes) with the evidence/confidence/
 * sources envelope the base record lacks. No AI response is returned without passing
 * through here (see AnswerEngine). Prompt content is hashed, never stored in the clear.
 */
import { sha256Hex, randomId, type Clock } from '@neuropause/cloud-core';
import type { EnterpriseRuntime } from '@neuropause/runtime';
import type { Confidence, EvidenceRef } from './types';

export interface AiInteraction {
  tenantId: string;
  actor: string;
  kind: string;
  promptHash: string;
  model: string;
  provider: string;
  evidence: EvidenceRef[];
  sources: string[];
  confidence: Confidence;
  latencyMs: number;
  costUsd: number;
  baseTraceId?: string;
}

export interface InteractionRef {
  auditId: string;
  replayId: string;
  at: number;
}

export class IntelligenceGovernance {
  private readonly counts = new Map<string, number>();

  constructor(
    private readonly runtime: EnterpriseRuntime,
    private readonly clock: Clock,
  ) {}

  private tally(type: string): void {
    this.counts.set(type, (this.counts.get(type) ?? 0) + 1);
  }

  async record(i: AiInteraction): Promise<InteractionRef> {
    const at = this.clock.now();
    const replayId = randomId('replay');
    const dataHash = sha256Hex(
      JSON.stringify({
        promptHash: i.promptHash,
        model: i.model,
        provider: i.provider,
        evidence: i.evidence.map((e) => `${e.kind}:${e.id}`),
        sources: i.sources,
        confidence: i.confidence.score,
        baseTraceId: i.baseTraceId ?? null,
      }),
    );
    const entry = this.runtime.audit().append({
      actor: i.actor,
      action: `intelligence.answer.${i.kind}`,
      target: `${i.tenantId}:${i.kind}`,
      deviceId: 'intelligence',
      at,
      dataHash,
    });
    this.tally('intelligence.answer');
    await this.runtime.events().publish({
      type: 'intelligence.answer',
      topic: 'intelligence',
      partitionKey: i.tenantId,
      version: 1,
      payload: {
        kind: i.kind,
        model: i.model,
        provider: i.provider,
        evidenceCount: i.evidence.length,
        sources: i.sources,
        confidence: i.confidence.score,
        latencyMs: i.latencyMs,
        costUsd: i.costUsd,
        replayId,
      },
    });
    return { auditId: String(entry.auditId), replayId, at };
  }

  count(type?: string): number {
    if (type) return this.counts.get(type) ?? 0;
    return [...this.counts.values()].reduce((a, b) => a + b, 0);
  }

  verify(): boolean {
    return this.runtime.audit().verify().valid;
  }
}
