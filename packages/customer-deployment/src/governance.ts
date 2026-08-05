/**
 * EPIC 15 — Deployment Governance. Every deployment operation records — on the ONE runtime audit
 * chain and event bus — the customer, tenant, environment, operator, approval, evidence level, replay
 * id, and timestamp. It REUSES the governance chain; customer deployment never bypasses it and never
 * opens a second ledger.
 */
import { sha256Hex, randomId, type Clock } from '@neuropause/cloud-core';
import type { EnterpriseRuntime } from '@neuropause/runtime';
import type { DeploymentEvidenceLevel } from './types';

export interface DeploymentGovInput {
  operator: string;
  customer: string;
  tenant: string;
  environment: string;
  epic: string;
  operation: string;
  targetId: string;
  evidence: DeploymentEvidenceLevel;
  decision?: string;
  approval?: 'not-required' | 'pending' | 'approved' | 'denied';
}

export interface DeploymentGovRef {
  auditId: string;
  replayId: string;
  at: number;
}

export class DeploymentGovernance {
  private readonly counts = new Map<string, number>();

  constructor(
    private readonly runtime: EnterpriseRuntime,
    private readonly clock: Clock,
  ) {}

  async record(i: DeploymentGovInput): Promise<DeploymentGovRef> {
    const at = this.clock.now();
    const replayId = randomId('replay');
    const dataHash = sha256Hex(JSON.stringify({ customer: i.customer, tenant: i.tenant, environment: i.environment, epic: i.epic, operation: i.operation, targetId: i.targetId, evidence: i.evidence }));
    const entry = this.runtime.audit().append({
      actor: i.operator,
      action: `deployment.${i.operation}`,
      target: `${i.customer}/${i.tenant}:${i.targetId}`,
      deviceId: 'customer-deployment',
      at,
      dataHash,
    });
    this.counts.set(i.operation, (this.counts.get(i.operation) ?? 0) + 1);
    this.counts.set('total', (this.counts.get('total') ?? 0) + 1);
    await this.runtime.events().publish({
      type: 'deployment.action',
      topic: 'customer-deployment',
      partitionKey: i.customer,
      version: 1,
      payload: {
        operator: i.operator,
        customer: i.customer,
        tenant: i.tenant,
        environment: i.environment,
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
