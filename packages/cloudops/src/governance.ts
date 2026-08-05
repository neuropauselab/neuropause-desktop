/**
 * Cloud Operations Governance. Every cloud operation records an audit entry on the ONE
 * runtime audit chain and an event on the ONE bus, carrying a replay id and evidence level.
 * Reuses the runtime — no new audit/event system (composes Wave 1, unchanged).
 */
import { sha256Hex, randomId, type Clock } from '@neuropause/cloud-core';
import type { EnterpriseRuntime } from '@neuropause/runtime';
import type { EvidenceLevel } from './types';

export interface CloudOpsGovInput {
  actor: string;
  operation: string;
  targetId: string;
  evidence: EvidenceLevel;
  scope?: string;
  detail?: string;
}

export interface CloudOpsGovRef {
  auditId: string;
  replayId: string;
  at: number;
}

export class CloudOpsGovernance {
  private readonly counts = new Map<string, number>();

  constructor(
    private readonly runtime: EnterpriseRuntime,
    private readonly clock: Clock,
  ) {}

  async record(i: CloudOpsGovInput): Promise<CloudOpsGovRef> {
    const at = this.clock.now();
    const replayId = randomId('replay');
    const scope = i.scope ?? '_platform';
    const dataHash = sha256Hex(JSON.stringify({ operation: i.operation, targetId: i.targetId, evidence: i.evidence, scope }));
    const entry = this.runtime.audit().append({
      actor: i.actor,
      action: `cloudops.${i.operation}`,
      target: `${scope}:${i.targetId}`,
      deviceId: 'cloudops',
      at,
      dataHash,
    });
    this.counts.set(i.operation, (this.counts.get(i.operation) ?? 0) + 1);
    this.counts.set('total', (this.counts.get('total') ?? 0) + 1);
    await this.runtime.events().publish({
      type: 'cloudops.operation',
      topic: 'cloudops',
      partitionKey: scope,
      version: 1,
      payload: { operation: i.operation, targetId: i.targetId, evidence: i.evidence, replayId, ...(i.detail ? { detail: i.detail } : {}) },
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
