/**
 * EPIC 18 — Reliability Governance. Every reliability operation records — on the ONE runtime audit
 * chain and event bus — the organization, capability, epic, operation, target, evidence level,
 * approval, replay id, and timestamp. It REUSES the governance chain; reliability never bypasses it
 * and never opens a second ledger.
 */
import { sha256Hex, randomId, type Clock } from '@neuropause/cloud-core';
import type { EnterpriseRuntime } from '@neuropause/runtime';
import type { ReliabilityEvidenceLevel } from './types';

export interface ReliabilityGovInput {
  operator: string;
  org: string;
  capability: string;
  epic: string;
  operation: string;
  targetId: string;
  evidence: ReliabilityEvidenceLevel;
  decision?: string;
  approval?: 'not-required' | 'pending' | 'approved' | 'denied';
}

export interface ReliabilityGovRef {
  auditId: string;
  replayId: string;
  at: number;
}

export class ReliabilityGovernance {
  private readonly counts = new Map<string, number>();

  constructor(
    private readonly runtime: EnterpriseRuntime,
    private readonly clock: Clock,
  ) {}

  async record(i: ReliabilityGovInput): Promise<ReliabilityGovRef> {
    const at = this.clock.now();
    const replayId = randomId('replay');
    const dataHash = sha256Hex(JSON.stringify({ capability: i.capability, epic: i.epic, operation: i.operation, targetId: i.targetId, evidence: i.evidence }));
    const entry = this.runtime.audit().append({
      actor: i.operator,
      action: `reliability.${i.operation}`,
      target: `${i.capability}:${i.targetId}`,
      deviceId: 'reliability',
      at,
      dataHash,
    });
    this.counts.set(i.operation, (this.counts.get(i.operation) ?? 0) + 1);
    this.counts.set('total', (this.counts.get('total') ?? 0) + 1);
    await this.runtime.events().publish({
      type: 'reliability.action',
      topic: 'reliability',
      partitionKey: i.org,
      version: 1,
      payload: {
        operator: i.operator,
        org: i.org,
        capability: i.capability,
        epic: i.epic,
        operation: i.operation,
        targetId: i.targetId,
        evidence: i.evidence,
        replayId,
        at,
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
