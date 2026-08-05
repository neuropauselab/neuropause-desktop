/**
 * EPIC 18 — Infrastructure Governance. Every infrastructure operation records — on the ONE runtime
 * audit chain and event bus — the organization, cluster, environment, operator, evidence, approval,
 * replay id, and timestamp. Reuses the governance chain; infrastructure activation never bypasses
 * it. No second ledger.
 */
import { sha256Hex, randomId, type Clock } from '@neuropause/cloud-core';
import type { EnterpriseRuntime } from '@neuropause/runtime';
import type { InfraEvidenceLevel } from './types';

export interface InfraGovInput {
  operator: string;
  org: string;
  environment: string;
  epic: string;
  operation: string;
  targetId: string;
  evidence: InfraEvidenceLevel;
  cluster?: string;
  decision?: string;
  approval?: 'not-required' | 'pending' | 'approved' | 'denied';
}

export interface InfraGovRef {
  auditId: string;
  replayId: string;
  at: number;
}

export class InfraGovernance {
  private readonly counts = new Map<string, number>();

  constructor(
    private readonly runtime: EnterpriseRuntime,
    private readonly clock: Clock,
  ) {}

  async record(i: InfraGovInput): Promise<InfraGovRef> {
    const at = this.clock.now();
    const replayId = randomId('replay');
    const dataHash = sha256Hex(JSON.stringify({ environment: i.environment, cluster: i.cluster ?? null, epic: i.epic, operation: i.operation, targetId: i.targetId, evidence: i.evidence }));
    const entry = this.runtime.audit().append({
      actor: i.operator,
      action: `infrastructure.${i.operation}`,
      target: `${i.environment}:${i.targetId}`,
      deviceId: 'infrastructure',
      at,
      dataHash,
    });
    this.counts.set(i.operation, (this.counts.get(i.operation) ?? 0) + 1);
    this.counts.set('total', (this.counts.get('total') ?? 0) + 1);
    await this.runtime.events().publish({
      type: 'infrastructure.action',
      topic: 'infrastructure',
      partitionKey: i.org,
      version: 1,
      payload: {
        operator: i.operator,
        org: i.org,
        environment: i.environment,
        epic: i.epic,
        operation: i.operation,
        targetId: i.targetId,
        evidence: i.evidence,
        replayId,
        at,
        approval: i.approval ?? 'not-required',
        ...(i.cluster ? { cluster: i.cluster } : {}),
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
