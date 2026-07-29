/**
 * Business Governance. Every business operation records an audit entry on the ONE runtime audit
 * chain and an event on the ONE bus, carrying a replay id and evidence level. Reuses the runtime
 * — no new audit/event system (composes Wave 1, unchanged).
 */
import { sha256Hex, randomId, type Clock } from '@neuropause/cloud-core';
import type { EnterpriseRuntime } from '@neuropause/runtime';
import type { EvidenceLevel } from './types';

export interface BusinessGovInput {
  actor: string;
  domain: string;
  operation: string;
  targetId: string;
  evidence: EvidenceLevel;
  detail?: string;
}

export interface BusinessGovRef {
  auditId: string;
  replayId: string;
  at: number;
}

export class BusinessGovernance {
  private readonly counts = new Map<string, number>();

  constructor(
    private readonly runtime: EnterpriseRuntime,
    private readonly clock: Clock,
  ) {}

  async record(i: BusinessGovInput): Promise<BusinessGovRef> {
    const at = this.clock.now();
    const replayId = randomId('replay');
    const dataHash = sha256Hex(JSON.stringify({ domain: i.domain, operation: i.operation, targetId: i.targetId, evidence: i.evidence }));
    const entry = this.runtime.audit().append({
      actor: i.actor,
      action: `business.${i.domain}.${i.operation}`,
      target: `${i.domain}:${i.targetId}`,
      deviceId: 'business',
      at,
      dataHash,
    });
    this.counts.set(i.domain, (this.counts.get(i.domain) ?? 0) + 1);
    this.counts.set('total', (this.counts.get('total') ?? 0) + 1);
    await this.runtime.events().publish({
      type: 'business.operation',
      topic: 'business',
      partitionKey: i.domain,
      version: 1,
      payload: { domain: i.domain, operation: i.operation, targetId: i.targetId, evidence: i.evidence, replayId, ...(i.detail ? { detail: i.detail } : {}) },
    });
    return { auditId: String(entry.auditId), replayId, at };
  }

  count(domain?: string): number {
    if (domain) return this.counts.get(domain) ?? 0;
    return this.counts.get('total') ?? 0;
  }
  verify(): boolean {
    return this.runtime.audit().verify().valid;
  }
}
