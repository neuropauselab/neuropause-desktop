/**
 * Module 19 — Operations Governance. Every operational action records — on the ONE runtime audit
 * chain and event bus — the user, organization, mission, AI workers, evidence, decisions,
 * approvals, and a replay id. Reuses the runtime; operations never bypass governance.
 */
import { sha256Hex, randomId, type Clock } from '@neuropause/cloud-core';
import type { EnterpriseRuntime } from '@neuropause/runtime';
import type { EvidenceLevel } from './types';

export interface OpsGovInput {
  user: string;
  org: string;
  mission: string;
  operation: string;
  targetId: string;
  evidence: EvidenceLevel;
  aiWorkers?: string[];
  decision?: string;
  approval?: 'not-required' | 'pending' | 'approved' | 'denied';
}

export interface OpsGovRef {
  auditId: string;
  replayId: string;
  at: number;
}

export class OperationsGovernance {
  private readonly counts = new Map<string, number>();

  constructor(
    private readonly runtime: EnterpriseRuntime,
    private readonly clock: Clock,
  ) {}

  async record(i: OpsGovInput): Promise<OpsGovRef> {
    const at = this.clock.now();
    const replayId = randomId('replay');
    const dataHash = sha256Hex(JSON.stringify({ mission: i.mission, operation: i.operation, targetId: i.targetId, evidence: i.evidence }));
    const entry = this.runtime.audit().append({
      actor: i.user,
      action: `operations.${i.operation}`,
      target: `${i.mission}:${i.targetId}`,
      deviceId: 'operations',
      at,
      dataHash,
    });
    this.counts.set(i.operation, (this.counts.get(i.operation) ?? 0) + 1);
    this.counts.set('total', (this.counts.get('total') ?? 0) + 1);
    await this.runtime.events().publish({
      type: 'operations.action',
      topic: 'operations',
      partitionKey: i.org,
      version: 1,
      payload: {
        user: i.user,
        org: i.org,
        mission: i.mission,
        operation: i.operation,
        targetId: i.targetId,
        evidence: i.evidence,
        replayId,
        approval: i.approval ?? 'not-required',
        ...(i.aiWorkers ? { aiWorkers: i.aiWorkers } : {}),
        ...(i.decision ? { decision: i.decision } : {}),
      },
    });
    return { auditId: String(entry.auditId), replayId, at };
  }

  count(operation?: string): number {
    if (operation) return this.counts.get(operation) ?? 0;
    return this.counts.get('total') ?? 0;
  }
  verify(): boolean {
    return this.runtime.audit().verify().valid;
  }
}
