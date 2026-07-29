/**
 * EPIC 18 — Platform Operations Governance. Every production operation records — on the ONE runtime
 * audit chain and event bus — the environment, operator, deployment, cluster, version, evidence level,
 * replay id, and timestamp. It REUSES the governance chain; platform operations never bypasses it and
 * never opens a second ledger.
 */
import { sha256Hex, randomId, type Clock } from '@neuropause/cloud-core';
import type { EnterpriseRuntime } from '@neuropause/runtime';
import type { PlatformOpsEvidenceLevel } from './types';

export interface PlatformOpsGovInput {
  operator: string;
  environment: string;
  deployment: string;
  cluster: string;
  version: string;
  epic: string;
  operation: string;
  targetId: string;
  evidence: PlatformOpsEvidenceLevel;
  decision?: string;
}

export interface PlatformOpsGovRef {
  auditId: string;
  replayId: string;
  at: number;
}

export class PlatformOpsGovernance {
  private readonly counts = new Map<string, number>();

  constructor(
    private readonly runtime: EnterpriseRuntime,
    private readonly clock: Clock,
  ) {}

  async record(i: PlatformOpsGovInput): Promise<PlatformOpsGovRef> {
    const at = this.clock.now();
    const replayId = randomId('replay');
    const dataHash = sha256Hex(JSON.stringify({ environment: i.environment, cluster: i.cluster, version: i.version, epic: i.epic, operation: i.operation, targetId: i.targetId, evidence: i.evidence }));
    const entry = this.runtime.audit().append({
      actor: i.operator,
      action: `platform-ops.${i.operation}`,
      target: `${i.environment}/${i.cluster}:${i.targetId}`,
      deviceId: 'platform-operations',
      at,
      dataHash,
    });
    this.counts.set(i.operation, (this.counts.get(i.operation) ?? 0) + 1);
    this.counts.set('total', (this.counts.get('total') ?? 0) + 1);
    await this.runtime.events().publish({
      type: 'platform-ops.action',
      topic: 'platform-operations',
      partitionKey: i.environment,
      version: 1,
      payload: {
        operator: i.operator,
        environment: i.environment,
        deployment: i.deployment,
        cluster: i.cluster,
        releaseVersion: i.version,
        epic: i.epic,
        operation: i.operation,
        targetId: i.targetId,
        evidence: i.evidence,
        replayId,
        at,
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
