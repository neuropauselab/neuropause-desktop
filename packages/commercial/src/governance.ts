/**
 * Module 12/19 — Commercial Governance. Every commercial action records — on the ONE runtime audit
 * chain and event bus — the actor, customer organization, tenant, evidence level, decision, and a
 * replay id. Reuses the runtime; commerce never bypasses governance. No second ledger.
 */
import { sha256Hex, randomId, type Clock } from '@neuropause/cloud-core';
import type { EnterpriseRuntime } from '@neuropause/runtime';
import type { EvidenceLevel } from './types';

export interface CommercialGovInput {
  actor: string;
  org: string;
  tenant: string;
  operation: string;
  targetId: string;
  evidence: EvidenceLevel;
  decision?: string;
  approval?: 'not-required' | 'pending' | 'approved' | 'denied';
}

export interface CommercialGovRef {
  auditId: string;
  replayId: string;
  at: number;
}

export class CommercialGovernance {
  private readonly counts = new Map<string, number>();

  constructor(
    private readonly runtime: EnterpriseRuntime,
    private readonly clock: Clock,
  ) {}

  async record(i: CommercialGovInput): Promise<CommercialGovRef> {
    const at = this.clock.now();
    const replayId = randomId('replay');
    const dataHash = sha256Hex(JSON.stringify({ tenant: i.tenant, operation: i.operation, targetId: i.targetId, evidence: i.evidence }));
    const entry = this.runtime.audit().append({
      actor: i.actor,
      action: `commercial.${i.operation}`,
      target: `${i.tenant}:${i.targetId}`,
      deviceId: 'commercial',
      at,
      dataHash,
    });
    this.counts.set(i.operation, (this.counts.get(i.operation) ?? 0) + 1);
    this.counts.set('total', (this.counts.get('total') ?? 0) + 1);
    await this.runtime.events().publish({
      type: 'commercial.action',
      topic: 'commercial',
      partitionKey: i.org,
      version: 1,
      payload: {
        actor: i.actor,
        org: i.org,
        tenant: i.tenant,
        operation: i.operation,
        targetId: i.targetId,
        evidence: i.evidence,
        replayId,
        approval: i.approval ?? 'not-required',
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
