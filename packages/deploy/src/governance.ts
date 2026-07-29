/**
 * Deployment Governance. Every deployment-foundation action records — on the ONE runtime audit chain
 * and event bus — the operator, organization, environment, epic, evidence level, and a replay id.
 * Reuses the runtime; the foundation never bypasses governance. No second ledger.
 */
import { sha256Hex, randomId, type Clock } from '@neuropause/cloud-core';
import type { EnterpriseRuntime } from '@neuropause/runtime';
import type { DeployEvidenceLevel } from './types';

export interface DeployGovInput {
  operator: string;
  org: string;
  environment: string;
  epic: string;
  operation: string;
  targetId: string;
  evidence: DeployEvidenceLevel;
  decision?: string;
}

export interface DeployGovRef {
  auditId: string;
  replayId: string;
  at: number;
}

export class DeployGovernance {
  private readonly counts = new Map<string, number>();

  constructor(
    private readonly runtime: EnterpriseRuntime,
    private readonly clock: Clock,
  ) {}

  async record(i: DeployGovInput): Promise<DeployGovRef> {
    const at = this.clock.now();
    const replayId = randomId('replay');
    const dataHash = sha256Hex(JSON.stringify({ environment: i.environment, epic: i.epic, operation: i.operation, targetId: i.targetId, evidence: i.evidence }));
    const entry = this.runtime.audit().append({
      actor: i.operator,
      action: `deploy.${i.operation}`,
      target: `${i.environment}:${i.targetId}`,
      deviceId: 'deploy',
      at,
      dataHash,
    });
    this.counts.set(i.operation, (this.counts.get(i.operation) ?? 0) + 1);
    this.counts.set('total', (this.counts.get('total') ?? 0) + 1);
    await this.runtime.events().publish({
      type: 'deploy.action',
      topic: 'deploy',
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
