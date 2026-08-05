/**
 * EPIC 15 — Release Governance. Every release operation records — on the ONE runtime audit chain and
 * event bus — the version, operator, environment, customer scope, evidence level, executive approval,
 * replay id, and timestamp. It REUSES the governance chain; release never bypasses it and never opens a
 * second ledger.
 */
import { sha256Hex, randomId, type Clock } from '@neuropause/cloud-core';
import type { EnterpriseRuntime } from '@neuropause/runtime';
import type { ReleaseEvidenceLevel } from './types';

export interface ReleaseGovInput {
  operator: string;
  version: string;
  environment: string;
  customerScope: string;
  epic: string;
  operation: string;
  targetId: string;
  evidence: ReleaseEvidenceLevel;
  decision?: string;
  executiveApproval?: 'not-required' | 'pending' | 'approved' | 'denied';
}

export interface ReleaseGovRef {
  auditId: string;
  replayId: string;
  at: number;
}

export class ReleaseGovernance {
  private readonly counts = new Map<string, number>();

  constructor(
    private readonly runtime: EnterpriseRuntime,
    private readonly clock: Clock,
  ) {}

  async record(i: ReleaseGovInput): Promise<ReleaseGovRef> {
    const at = this.clock.now();
    const replayId = randomId('replay');
    const dataHash = sha256Hex(JSON.stringify({ version: i.version, environment: i.environment, customerScope: i.customerScope, epic: i.epic, operation: i.operation, targetId: i.targetId, evidence: i.evidence }));
    const entry = this.runtime.audit().append({
      actor: i.operator,
      action: `release.${i.operation}`,
      target: `${i.version}:${i.targetId}`,
      deviceId: 'release',
      at,
      dataHash,
    });
    this.counts.set(i.operation, (this.counts.get(i.operation) ?? 0) + 1);
    this.counts.set('total', (this.counts.get('total') ?? 0) + 1);
    await this.runtime.events().publish({
      type: 'release.action',
      topic: 'release',
      partitionKey: i.version,
      version: 1,
      payload: {
        operator: i.operator,
        releaseVersion: i.version,
        environment: i.environment,
        customerScope: i.customerScope,
        epic: i.epic,
        operation: i.operation,
        targetId: i.targetId,
        evidence: i.evidence,
        replayId,
        at,
        executiveApproval: i.executiveApproval ?? 'not-required',
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
