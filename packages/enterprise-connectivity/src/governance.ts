/**
 * EPIC 14 — Security & Governance. Every connectivity operation records — on the ONE runtime audit
 * chain and event bus — the actor, customer, connector, action, evidence level, replay id, and
 * timestamp. It REUSES the governance chain; connectivity never bypasses it and never opens a second
 * ledger. Audited actions include connector creation, OAuth approval, sync execution, AI requests, data
 * access, and permission changes.
 */
import { sha256Hex, randomId, type Clock } from '@neuropause/cloud-core';
import type { EnterpriseRuntime } from '@neuropause/runtime';
import type { EcEvidenceLevel } from './types';

export interface EcGovInput {
  actor: string;
  customer: string;
  connector: string;
  epic: string;
  operation: string;
  targetId: string;
  evidence: EcEvidenceLevel;
  decision?: string;
}

export interface EcGovRef {
  auditId: string;
  replayId: string;
  at: number;
}

export class EnterpriseConnectivityGovernance {
  private readonly counts = new Map<string, number>();

  constructor(
    private readonly runtime: EnterpriseRuntime,
    private readonly clock: Clock,
  ) {}

  async record(i: EcGovInput): Promise<EcGovRef> {
    const at = this.clock.now();
    const replayId = randomId('replay');
    const dataHash = sha256Hex(JSON.stringify({ customer: i.customer, connector: i.connector, epic: i.epic, operation: i.operation, targetId: i.targetId, evidence: i.evidence }));
    const entry = this.runtime.audit().append({
      actor: i.actor,
      action: `connectivity.${i.operation}`,
      target: `${i.connector}:${i.targetId}`,
      deviceId: 'enterprise-connectivity',
      at,
      dataHash,
    });
    this.counts.set(i.operation, (this.counts.get(i.operation) ?? 0) + 1);
    this.counts.set('total', (this.counts.get('total') ?? 0) + 1);
    await this.runtime.events().publish({
      type: 'connectivity.action',
      topic: 'enterprise-connectivity',
      partitionKey: i.customer,
      version: 1,
      payload: {
        actor: i.actor,
        customer: i.customer,
        connector: i.connector,
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
