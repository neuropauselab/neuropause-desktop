/**
 * AI governance (NCEA 10.3, Phase 8). The single path through which EVERY AI
 * execution is recorded — inference, agent, tool, workflow step, connector.
 * Each record emits an audit entry (hash-only — no prompt content or secrets),
 * one event on the SINGLE event bus (which the timeline projects), so every AI
 * action is observable and every AI decision is traceable. Nothing bypasses it.
 */
import type { EnterpriseRuntime } from '@neuropause/runtime';
import { sha256Hex, type Clock } from '@neuropause/cloud-core';
import type { AiUsage } from './providers';

export type AiExecutionKind = 'inference' | 'agent' | 'tool' | 'workflow' | 'connector';
export type ApprovalState = 'not-required' | 'pending' | 'approved' | 'rejected';

export interface CostMetadata {
  usd: number;
}

export interface AiExecutionRecord {
  traceId: string;
  kind: AiExecutionKind;
  target: string;
  actor: string;
  provider?: string;
  model?: string;
  usage?: AiUsage;
  cost?: CostMetadata;
  durationMs: number;
  approval: ApprovalState;
  ok: boolean;
  at: number;
  detail?: string;
}

/** Illustrative USD per 1k tokens; real rates are provider-published. */
const COST_PER_1K: Record<string, { in: number; out: number }> = {
  'fake-1': { in: 0, out: 0 },
  default: { in: 0.003, out: 0.015 },
};

export function estimateCost(model: string, usage: AiUsage | undefined): CostMetadata {
  if (!usage) return { usd: 0 };
  const rate = COST_PER_1K[model] ?? COST_PER_1K.default;
  const usd = (usage.promptTokens / 1000) * rate.in + (usage.completionTokens / 1000) * rate.out;
  return { usd: Number(usd.toFixed(6)) };
}

export type GovernanceInput = Omit<AiExecutionRecord, 'at'>;

export class GovernanceRecorder {
  private readonly records: AiExecutionRecord[] = [];

  constructor(
    private readonly runtime: EnterpriseRuntime,
    private readonly clock: Clock,
  ) {}

  /** Record one AI execution: audit chain + single event bus (+ timeline). */
  async record(input: GovernanceInput): Promise<AiExecutionRecord> {
    const record: AiExecutionRecord = { ...input, at: this.clock.now() };
    this.records.push(record);

    // Provenance — hash only; no prompt content or secrets enter the chain.
    this.runtime.audit().append({
      actor: record.actor,
      action: `ai.${record.kind}.${record.ok ? 'ok' : 'error'}`,
      target: record.target,
      deviceId: 'ai-runtime',
      at: record.at,
      dataHash: sha256Hex(
        JSON.stringify({
          traceId: record.traceId,
          target: record.target,
          usage: record.usage,
          cost: record.cost,
          approval: record.approval,
        }),
      ),
    });

    // One event bus (the timeline projects it).
    await this.runtime.events().publish({
      type: `ai.${record.kind}`,
      topic: 'ai',
      partitionKey: record.actor,
      version: 1,
      payload: {
        traceId: record.traceId,
        target: record.target,
        provider: record.provider,
        model: record.model,
        usage: record.usage,
        cost: record.cost,
        durationMs: record.durationMs,
        approval: record.approval,
        ok: record.ok,
      },
    });

    return record;
  }

  history(): AiExecutionRecord[] {
    return [...this.records];
  }
}
