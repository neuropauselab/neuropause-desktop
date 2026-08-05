/**
 * Module 14 — External Execution Governance. Every execution (success, failure, denial,
 * rate-limit, circuit-open, dead-letter) is recorded on the ONE runtime audit chain and
 * event bus, carrying its evidence level, hashed request, outcome, latency, audit id, and
 * replay id. No external execution bypasses this; every execution is replayable.
 */
import { sha256Hex, randomId, type Clock } from '@neuropause/cloud-core';
import type { EnterpriseRuntime } from '@neuropause/runtime';
import type { EvidenceLevel } from './types';
import type { ExecutionOutcome } from './constants';

export interface ExecGovInput {
  tenantId: string;
  actor: string;
  connectorId: string;
  operation: string;
  outcome: ExecutionOutcome;
  status?: number;
  latencyMs: number;
  attempts: number;
  evidence: EvidenceLevel;
  requestHash: string;
  error?: string;
}

export interface GovRef {
  auditId: string;
  replayId: string;
  at: number;
}

export class ExternalExecutionGovernance {
  private readonly counts = new Map<string, number>();

  constructor(
    private readonly runtime: EnterpriseRuntime,
    private readonly clock: Clock,
  ) {}

  async record(i: ExecGovInput): Promise<GovRef> {
    const at = this.clock.now();
    const replayId = randomId('replay');
    const dataHash = sha256Hex(JSON.stringify({ connectorId: i.connectorId, operation: i.operation, outcome: i.outcome, requestHash: i.requestHash, evidence: i.evidence, status: i.status ?? null }));
    const entry = this.runtime.audit().append({
      actor: i.actor,
      action: `execution.${i.connectorId}.${i.operation}.${i.outcome}`,
      target: `${i.tenantId}:${i.connectorId}`,
      deviceId: 'execution',
      at,
      dataHash,
    });
    this.counts.set(i.outcome, (this.counts.get(i.outcome) ?? 0) + 1);
    this.counts.set('total', (this.counts.get('total') ?? 0) + 1);
    await this.runtime.events().publish({
      type: 'execution.result',
      topic: 'execution',
      partitionKey: i.tenantId,
      version: 1,
      payload: { connectorId: i.connectorId, operation: i.operation, outcome: i.outcome, status: i.status, latencyMs: i.latencyMs, attempts: i.attempts, evidence: i.evidence, replayId, ...(i.error ? { error: i.error } : {}) },
    });
    return { auditId: String(entry.auditId), replayId, at };
  }

  count(outcome?: string): number {
    if (outcome) return this.counts.get(outcome) ?? 0;
    return this.counts.get('total') ?? 0;
  }
  verify(): boolean {
    return this.runtime.audit().verify().valid;
  }
}
