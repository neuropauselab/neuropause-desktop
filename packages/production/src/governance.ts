/**
 * Module 21 — Production Governance. Every production operation records — on the ONE runtime audit
 * chain and event bus — the organization, environment, operator, version, deployment, evidence,
 * approval, and a replay id. Reuses the runtime; production operations never bypass governance. No
 * second ledger.
 */
import { sha256Hex, randomId, type Clock } from '@neuropause/cloud-core';
import type { EnterpriseRuntime } from '@neuropause/runtime';
import type { ProductionEvidenceLevel } from './types';

export interface ProductionGovInput {
  operator: string;
  org: string;
  environment: string;
  operation: string;
  targetId: string;
  evidence: ProductionEvidenceLevel;
  version?: string;
  deployment?: string;
  decision?: string;
  approval?: 'not-required' | 'pending' | 'approved' | 'denied';
}

export interface ProductionGovRef {
  auditId: string;
  replayId: string;
  at: number;
}

export class ProductionGovernance {
  private readonly counts = new Map<string, number>();

  constructor(
    private readonly runtime: EnterpriseRuntime,
    private readonly clock: Clock,
  ) {}

  async record(i: ProductionGovInput): Promise<ProductionGovRef> {
    const at = this.clock.now();
    const replayId = randomId('replay');
    const dataHash = sha256Hex(JSON.stringify({ environment: i.environment, operation: i.operation, targetId: i.targetId, evidence: i.evidence, version: i.version ?? null }));
    const entry = this.runtime.audit().append({
      actor: i.operator,
      action: `production.${i.operation}`,
      target: `${i.environment}:${i.targetId}`,
      deviceId: 'production',
      at,
      dataHash,
    });
    this.counts.set(i.operation, (this.counts.get(i.operation) ?? 0) + 1);
    this.counts.set('total', (this.counts.get('total') ?? 0) + 1);
    await this.runtime.events().publish({
      type: 'production.action',
      topic: 'production',
      partitionKey: i.org,
      version: 1,
      payload: {
        operator: i.operator,
        org: i.org,
        environment: i.environment,
        operation: i.operation,
        targetId: i.targetId,
        evidence: i.evidence,
        replayId,
        approval: i.approval ?? 'not-required',
        ...(i.version ? { version: i.version } : {}),
        ...(i.deployment ? { deployment: i.deployment } : {}),
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
