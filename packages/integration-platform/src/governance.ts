/**
 * EPIC 19 — Integration Governance. Every integration operation records — on the ONE runtime audit
 * chain and event bus — the organization, integration, connector, operator, evidence, approval,
 * replay id, and timestamp. Reuses the governance chain; integrations never bypass it. No second ledger.
 */
import { sha256Hex, randomId, type Clock } from '@neuropause/cloud-core';
import type { EnterpriseRuntime } from '@neuropause/runtime';
import type { IntegrationEvidenceLevel } from './types';

export interface IntegrationGovInput {
  operator: string;
  org: string;
  integration: string;
  connector: string;
  epic: string;
  operation: string;
  targetId: string;
  evidence: IntegrationEvidenceLevel;
  decision?: string;
  approval?: 'not-required' | 'pending' | 'approved' | 'denied';
}

export interface IntegrationGovRef {
  auditId: string;
  replayId: string;
  at: number;
}

export class IntegrationGovernance {
  private readonly counts = new Map<string, number>();

  constructor(
    private readonly runtime: EnterpriseRuntime,
    private readonly clock: Clock,
  ) {}

  async record(i: IntegrationGovInput): Promise<IntegrationGovRef> {
    const at = this.clock.now();
    const replayId = randomId('replay');
    const dataHash = sha256Hex(JSON.stringify({ integration: i.integration, connector: i.connector, epic: i.epic, operation: i.operation, targetId: i.targetId, evidence: i.evidence }));
    const entry = this.runtime.audit().append({
      actor: i.operator,
      action: `integration.${i.operation}`,
      target: `${i.integration}:${i.targetId}`,
      deviceId: 'integration',
      at,
      dataHash,
    });
    this.counts.set(i.operation, (this.counts.get(i.operation) ?? 0) + 1);
    this.counts.set('total', (this.counts.get('total') ?? 0) + 1);
    await this.runtime.events().publish({
      type: 'integration.action',
      topic: 'integration',
      partitionKey: i.org,
      version: 1,
      payload: {
        operator: i.operator,
        org: i.org,
        integration: i.integration,
        connector: i.connector,
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
