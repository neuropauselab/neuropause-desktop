/**
 * Workspace Governance. Every workspace operation records an audit entry on the ONE runtime audit
 * chain and an event on the ONE bus, carrying a replay id and evidence level. Reuses the runtime
 * — no new audit/event system (composes Wave 1, unchanged).
 */
import { sha256Hex, randomId, type Clock } from '@neuropause/cloud-core';
import type { EnterpriseRuntime } from '@neuropause/runtime';
import type { EvidenceLevel } from './types';

export interface WorkspaceGovInput {
  actor: string;
  module: string;
  operation: string;
  targetId: string;
  evidence: EvidenceLevel;
  detail?: string;
}

export interface WorkspaceGovRef {
  auditId: string;
  replayId: string;
  at: number;
}

export class WorkspaceGovernance {
  private readonly counts = new Map<string, number>();

  constructor(
    private readonly runtime: EnterpriseRuntime,
    private readonly clock: Clock,
  ) {}

  async record(i: WorkspaceGovInput): Promise<WorkspaceGovRef> {
    const at = this.clock.now();
    const replayId = randomId('replay');
    const dataHash = sha256Hex(JSON.stringify({ module: i.module, operation: i.operation, targetId: i.targetId, evidence: i.evidence }));
    const entry = this.runtime.audit().append({
      actor: i.actor,
      action: `workspace.${i.module}.${i.operation}`,
      target: `${i.module}:${i.targetId}`,
      deviceId: 'workspace',
      at,
      dataHash,
    });
    this.counts.set(i.module, (this.counts.get(i.module) ?? 0) + 1);
    this.counts.set('total', (this.counts.get('total') ?? 0) + 1);
    await this.runtime.events().publish({
      type: 'workspace.operation',
      topic: 'workspace',
      partitionKey: i.module,
      version: 1,
      payload: { module: i.module, operation: i.operation, targetId: i.targetId, evidence: i.evidence, replayId, ...(i.detail ? { detail: i.detail } : {}) },
    });
    return { auditId: String(entry.auditId), replayId, at };
  }

  count(module?: string): number {
    if (module) return this.counts.get(module) ?? 0;
    return this.counts.get('total') ?? 0;
  }
  verify(): boolean {
    return this.runtime.audit().verify().valid;
  }
}
