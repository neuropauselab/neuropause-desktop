/**
 * AI Governance (NCEA 14.0, Phase 7). Every AI execution is recorded with full
 * attribution — user, organization, workspace, AI identity, model, provider,
 * prompt metadata, tool calls, connector access, evidence + decision references,
 * approval, risk, cost, execution time — through the ONE audit chain, stamped with
 * an audit id and a replay id. There is no other way to record an AI execution:
 * every AI action is attributable, auditable, and replayable. Nothing bypasses this.
 */
import { randomId } from '@neuropause/cloud-core';
import type { SecurityAudit } from './audit';

export type RiskLevel = 'low' | 'medium' | 'high' | 'critical';
export type ApprovalStatus = 'not-required' | 'pending' | 'approved' | 'rejected';

export interface AiExecutionInput {
  user: string;
  organization: string;
  workspace: string;
  aiIdentity: string;
  model: string;
  provider: string;
  promptMetadata: { tokens?: number; hash?: string };
  toolCalls?: string[];
  connectorAccess?: string[];
  evidenceRefs?: string[];
  decisionRefs?: string[];
  approval?: ApprovalStatus;
  riskLevel?: RiskLevel;
  costUsd?: number;
  executionMs: number;
  ok: boolean;
}

export interface AiExecutionRecord extends Required<Omit<AiExecutionInput, 'promptMetadata'>> {
  promptMetadata: { tokens?: number; hash?: string };
  auditId: string;
  replayId: string;
  at: number;
}

export class AiGovernance {
  private readonly records: AiExecutionRecord[] = [];

  constructor(private readonly audit: SecurityAudit) {}

  /** Record a governed AI execution. The only entry point — no execution bypasses it. */
  async record(input: AiExecutionInput): Promise<AiExecutionRecord> {
    const replayId = randomId('replay');
    const event = await this.audit.record({
      category: 'ai',
      action: input.ok ? 'execute' : 'execute.error',
      actor: input.aiIdentity,
      tenant: input.organization,
      target: `${input.provider}:${input.model}`,
      meta: {
        user: input.user,
        workspace: input.workspace,
        toolCalls: input.toolCalls ?? [],
        connectorAccess: input.connectorAccess ?? [],
        evidenceRefs: input.evidenceRefs ?? [],
        decisionRefs: input.decisionRefs ?? [],
        approval: input.approval ?? 'not-required',
        riskLevel: input.riskLevel ?? 'low',
        costUsd: input.costUsd ?? 0,
        executionMs: input.executionMs,
        replayId,
      },
    });
    const record: AiExecutionRecord = {
      user: input.user,
      organization: input.organization,
      workspace: input.workspace,
      aiIdentity: input.aiIdentity,
      model: input.model,
      provider: input.provider,
      promptMetadata: input.promptMetadata,
      toolCalls: input.toolCalls ?? [],
      connectorAccess: input.connectorAccess ?? [],
      evidenceRefs: input.evidenceRefs ?? [],
      decisionRefs: input.decisionRefs ?? [],
      approval: input.approval ?? 'not-required',
      riskLevel: input.riskLevel ?? 'low',
      costUsd: input.costUsd ?? 0,
      executionMs: input.executionMs,
      ok: input.ok,
      auditId: event.id,
      replayId,
      at: event.at,
    };
    this.records.push(record);
    return record;
  }

  history(filter: { organization?: string; aiIdentity?: string; user?: string } = {}): AiExecutionRecord[] {
    return this.records.filter(
      (r) => (filter.organization === undefined || r.organization === filter.organization) && (filter.aiIdentity === undefined || r.aiIdentity === filter.aiIdentity) && (filter.user === undefined || r.user === filter.user),
    );
  }

  /** Look up a governed execution by its replay id (every execution is replayable). */
  byReplayId(replayId: string): AiExecutionRecord | undefined {
    return this.records.find((r) => r.replayId === replayId);
  }
}
