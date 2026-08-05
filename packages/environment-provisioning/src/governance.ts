/**
 * Governance. Every provisioning activity records — on the ONE runtime audit chain and event bus — the
 * operator, environment, target, timestamp, result, an audit reference, and a replay id. It REUSES the
 * governance chain; the provisioning layer never bypasses it and never opens a second ledger.
 */
import { sha256Hex, randomId, type Clock } from '@neuropause/cloud-core';
import type { EnterpriseRuntime } from '@neuropause/runtime';
import type { EpEvidenceLevel } from './types';

export interface EpGovInput {
  operator: string;
  environment: string;
  target: string;
  epic: string;
  operation: string;
  result: string;
  evidence: EpEvidenceLevel;
}

export interface EpGovRef {
  auditId: string;
  replayId: string;
  at: number;
}

export class EnvironmentProvisioningGovernance {
  private readonly counts = new Map<string, number>();

  constructor(
    private readonly runtime: EnterpriseRuntime,
    private readonly clock: Clock,
  ) {}

  async record(i: EpGovInput): Promise<EpGovRef> {
    const at = this.clock.now();
    const replayId = randomId('replay');
    const dataHash = sha256Hex(JSON.stringify({ environment: i.environment, target: i.target, epic: i.epic, operation: i.operation, result: i.result, evidence: i.evidence }));
    const entry = this.runtime.audit().append({
      actor: i.operator,
      action: `provisioning.${i.operation}`,
      target: `${i.environment}:${i.target}`,
      deviceId: 'environment-provisioning',
      at,
      dataHash,
    });
    this.counts.set(i.operation, (this.counts.get(i.operation) ?? 0) + 1);
    this.counts.set('total', (this.counts.get('total') ?? 0) + 1);
    await this.runtime.events().publish({
      type: 'provisioning.action',
      topic: 'environment-provisioning',
      partitionKey: i.environment,
      version: 1,
      payload: { operator: i.operator, environment: i.environment, target: i.target, epic: i.epic, operation: i.operation, result: i.result, evidence: i.evidence, replayId, at },
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
