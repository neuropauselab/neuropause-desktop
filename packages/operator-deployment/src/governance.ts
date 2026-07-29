/**
 * Governance. Every operator-deployment activity records — on the ONE runtime audit chain and event bus —
 * the operator, environment, target, result, an audit reference, and a replay id. REUSES the governance
 * chain; never opens a second ledger.
 */
import { sha256Hex, randomId, type Clock } from '@neuropause/cloud-core';
import type { EnterpriseRuntime } from '@neuropause/runtime';
import type { OdEvidenceLevel } from './types';

export interface OdGovInput {
  operator: string;
  environment: string;
  target: string;
  operation: string;
  result: string;
  evidence: OdEvidenceLevel;
}

export interface OdGovRef {
  auditId: string;
  replayId: string;
  at: number;
}

export class OperatorDeploymentGovernance {
  private readonly counts = new Map<string, number>();

  constructor(
    private readonly runtime: EnterpriseRuntime,
    private readonly clock: Clock,
  ) {}

  async record(i: OdGovInput): Promise<OdGovRef> {
    const at = this.clock.now();
    const replayId = randomId('replay');
    const dataHash = sha256Hex(JSON.stringify({ environment: i.environment, target: i.target, operation: i.operation, result: i.result, evidence: i.evidence }));
    const entry = this.runtime.audit().append({ actor: i.operator, action: `operator-deployment.${i.operation}`, target: `${i.environment}:${i.target}`, deviceId: 'operator-deployment', at, dataHash });
    this.counts.set('total', (this.counts.get('total') ?? 0) + 1);
    await this.runtime.events().publish({
      type: 'operator-deployment.action',
      topic: 'operator-deployment',
      partitionKey: i.environment,
      version: 1,
      payload: { operator: i.operator, environment: i.environment, target: i.target, operation: i.operation, result: i.result, evidence: i.evidence, replayId, at },
    });
    return { auditId: String(entry.auditId), replayId, at };
  }

  count(): number {
    return this.counts.get('total') ?? 0;
  }
  verify(): boolean {
    return this.runtime.audit().verify().valid;
  }
}
