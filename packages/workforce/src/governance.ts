/**
 * Module 17 — Workforce Governance. Every AI action records — on the ONE runtime audit chain and
 * event bus — the user, organization, worker, evidence, reasoning, approval, and a replay id.
 * Reuses the runtime; AI never replaces governance.
 */
import { sha256Hex, randomId, type Clock } from '@neuropause/cloud-core';
import type { EnterpriseRuntime } from '@neuropause/runtime';
import type { EvidenceLevel } from './types';

export interface WorkforceGovInput {
  user: string;
  org: string;
  worker: string;
  operation: string;
  targetId: string;
  evidence: EvidenceLevel;
  evidenceCount?: number;
  reasoning?: string;
  approval?: 'not-required' | 'pending' | 'approved' | 'denied';
}

export interface WorkforceGovRef {
  auditId: string;
  replayId: string;
  at: number;
}

export class WorkforceGovernance {
  private readonly counts = new Map<string, number>();

  constructor(
    private readonly runtime: EnterpriseRuntime,
    private readonly clock: Clock,
  ) {}

  async record(i: WorkforceGovInput): Promise<WorkforceGovRef> {
    const at = this.clock.now();
    const replayId = randomId('replay');
    const dataHash = sha256Hex(JSON.stringify({ worker: i.worker, operation: i.operation, targetId: i.targetId, evidence: i.evidence, evidenceCount: i.evidenceCount ?? 0 }));
    const entry = this.runtime.audit().append({
      actor: i.user,
      action: `workforce.${i.operation}`,
      target: `${i.worker}:${i.targetId}`,
      deviceId: 'workforce',
      at,
      dataHash,
    });
    this.counts.set(i.operation, (this.counts.get(i.operation) ?? 0) + 1);
    this.counts.set('total', (this.counts.get('total') ?? 0) + 1);
    await this.runtime.events().publish({
      type: 'workforce.action',
      topic: 'workforce',
      partitionKey: i.org,
      version: 1,
      payload: {
        user: i.user,
        org: i.org,
        worker: i.worker,
        operation: i.operation,
        targetId: i.targetId,
        evidence: i.evidence,
        evidenceCount: i.evidenceCount ?? 0,
        replayId,
        approval: i.approval ?? 'not-required',
        ...(i.reasoning ? { reasoning: i.reasoning } : {}),
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
