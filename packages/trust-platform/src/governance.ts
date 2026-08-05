/**
 * EPIC 14 — Security Governance. Every security event records — on the ONE runtime audit chain and event
 * bus — the timestamp, actor, resource, environment, policy, evidence level, and a replay id. It REUSES
 * the governance chain; the trust layer never bypasses it and never opens a second ledger. Audited events
 * include Zero Trust decisions, privilege grants, secret rotation, policy changes, vulnerability triage,
 * supply-chain verification, disaster-recovery drills, compliance assessments, and SOC incidents.
 */
import { sha256Hex, randomId, type Clock } from '@neuropause/cloud-core';
import type { EnterpriseRuntime } from '@neuropause/runtime';
import type { TpEvidenceLevel } from './types';

export interface TrustGovInput {
  actor: string;
  environment: string;
  resource: string;
  policy: string;
  epic: string;
  operation: string;
  targetId: string;
  evidence: TpEvidenceLevel;
  decision?: string;
}

export interface TrustGovRef {
  auditId: string;
  replayId: string;
  at: number;
}

export class TrustGovernance {
  private readonly counts = new Map<string, number>();

  constructor(
    private readonly runtime: EnterpriseRuntime,
    private readonly clock: Clock,
  ) {}

  async record(i: TrustGovInput): Promise<TrustGovRef> {
    const at = this.clock.now();
    const replayId = randomId('replay');
    const dataHash = sha256Hex(
      JSON.stringify({ environment: i.environment, resource: i.resource, policy: i.policy, epic: i.epic, operation: i.operation, targetId: i.targetId, evidence: i.evidence }),
    );
    const entry = this.runtime.audit().append({
      actor: i.actor,
      action: `trust.${i.operation}`,
      target: `${i.resource}:${i.targetId}`,
      deviceId: 'trust-platform',
      at,
      dataHash,
    });
    this.counts.set(i.operation, (this.counts.get(i.operation) ?? 0) + 1);
    this.counts.set('total', (this.counts.get('total') ?? 0) + 1);
    await this.runtime.events().publish({
      type: 'trust.action',
      topic: 'trust-platform',
      partitionKey: i.environment,
      version: 1,
      payload: {
        actor: i.actor,
        environment: i.environment,
        resource: i.resource,
        policy: i.policy,
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
