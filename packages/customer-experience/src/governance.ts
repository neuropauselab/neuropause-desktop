/**
 * EPIC 15 — Customer Governance. Every customer operation records — on the ONE runtime audit chain and
 * event bus — the actor, customer, organization, action, evidence level, replay id, and timestamp. It
 * REUSES the governance chain; the customer-experience layer never bypasses it and never opens a second
 * ledger.
 */
import { sha256Hex, randomId, type Clock } from '@neuropause/cloud-core';
import type { EnterpriseRuntime } from '@neuropause/runtime';
import type { CxEvidenceLevel } from './types';

export interface CxGovInput {
  actor: string;
  customer: string;
  organization: string;
  epic: string;
  operation: string;
  targetId: string;
  evidence: CxEvidenceLevel;
  decision?: string;
}

export interface CxGovRef {
  auditId: string;
  replayId: string;
  at: number;
}

export class CustomerExperienceGovernance {
  private readonly counts = new Map<string, number>();

  constructor(
    private readonly runtime: EnterpriseRuntime,
    private readonly clock: Clock,
  ) {}

  async record(i: CxGovInput): Promise<CxGovRef> {
    const at = this.clock.now();
    const replayId = randomId('replay');
    const dataHash = sha256Hex(JSON.stringify({ customer: i.customer, organization: i.organization, epic: i.epic, operation: i.operation, targetId: i.targetId, evidence: i.evidence }));
    const entry = this.runtime.audit().append({
      actor: i.actor,
      action: `cx.${i.operation}`,
      target: `${i.organization}:${i.targetId}`,
      deviceId: 'customer-experience',
      at,
      dataHash,
    });
    this.counts.set(i.operation, (this.counts.get(i.operation) ?? 0) + 1);
    this.counts.set('total', (this.counts.get('total') ?? 0) + 1);
    await this.runtime.events().publish({
      type: 'cx.action',
      topic: 'customer-experience',
      partitionKey: i.customer,
      version: 1,
      payload: {
        actor: i.actor,
        customer: i.customer,
        organization: i.organization,
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
