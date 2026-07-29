/**
 * Module 12 — Global Governance. Every federation operation records an audit entry on the
 * ONE runtime audit chain and an event on the ONE bus, carrying a federation id, replay id,
 * and evidence level. Reuses the runtime — no new audit/event system.
 */
import { sha256Hex, randomId, type Clock } from '@neuropause/cloud-core';
import type { EnterpriseRuntime } from '@neuropause/runtime';
import type { EvidenceLevel } from './types';

export interface FederationGovInput {
  federationId: string;
  actor: string;
  operation: string;
  targetId: string;
  evidence: EvidenceLevel;
  detail?: string;
}

export interface FederationGovRef {
  auditId: string;
  replayId: string;
  federationId: string;
  at: number;
}

export class FederationGovernance {
  private readonly counts = new Map<string, number>();

  constructor(
    private readonly runtime: EnterpriseRuntime,
    private readonly clock: Clock,
  ) {}

  async record(i: FederationGovInput): Promise<FederationGovRef> {
    const at = this.clock.now();
    const replayId = randomId('replay');
    const dataHash = sha256Hex(JSON.stringify({ federationId: i.federationId, operation: i.operation, targetId: i.targetId, evidence: i.evidence }));
    const entry = this.runtime.audit().append({
      actor: i.actor,
      action: `federation.${i.operation}`,
      target: `${i.federationId}:${i.targetId}`,
      deviceId: 'federation',
      at,
      dataHash,
    });
    this.counts.set(i.operation, (this.counts.get(i.operation) ?? 0) + 1);
    this.counts.set('total', (this.counts.get('total') ?? 0) + 1);
    await this.runtime.events().publish({
      type: 'federation.operation',
      topic: 'federation',
      partitionKey: i.federationId,
      version: 1,
      payload: { operation: i.operation, targetId: i.targetId, evidence: i.evidence, replayId, ...(i.detail ? { detail: i.detail } : {}) },
    });
    return { auditId: String(entry.auditId), replayId, federationId: i.federationId, at };
  }

  count(operation?: string): number {
    if (operation) return this.counts.get(operation) ?? 0;
    return this.counts.get('total') ?? 0;
  }
  verify(): boolean {
    return this.runtime.audit().verify().valid;
  }
}
