/**
 * Module 12 — Governance. Every automation execution, approval decision, and
 * notification is recorded on the ONE runtime audit chain and event bus. Execution
 * records carry trigger, workflow version, hashed inputs/outputs, evidence, approvals,
 * duration, errors, audit id, replay id, and rollback id — so every execution is
 * replayable and traceable. Inputs/outputs are hashed, never stored in the clear.
 */
import { sha256Hex, randomId, type Clock } from '@neuropause/cloud-core';
import type { EnterpriseRuntime } from '@neuropause/runtime';
import type { EvidenceRef, ExecutionStatus } from './types';

export interface ExecutionGovernanceInput {
  tenantId: string;
  actor: string;
  workflowId: string;
  version: number;
  trigger: string;
  inputs: Record<string, unknown>;
  outputs: Record<string, unknown>;
  evidence: EvidenceRef[];
  approvals: string[];
  durationMs: number;
  status: ExecutionStatus;
  error?: string;
  rollbackId?: string;
  aiInitiated: boolean;
}

export interface GovernanceRef {
  auditId: string;
  replayId: string;
  at: number;
}

export class AutomationGovernance {
  private readonly counts = new Map<string, number>();

  constructor(
    private readonly runtime: EnterpriseRuntime,
    private readonly clock: Clock,
  ) {}

  private tally(type: string): void {
    this.counts.set(type, (this.counts.get(type) ?? 0) + 1);
  }

  async recordExecution(i: ExecutionGovernanceInput): Promise<GovernanceRef> {
    const at = this.clock.now();
    const replayId = randomId('replay');
    const dataHash = sha256Hex(
      JSON.stringify({
        workflowId: i.workflowId,
        version: i.version,
        trigger: i.trigger,
        inputsHash: sha256Hex(JSON.stringify(i.inputs)),
        outputsHash: sha256Hex(JSON.stringify(i.outputs)),
        evidence: i.evidence.map((e) => `${e.kind}:${e.id}`),
        approvals: i.approvals,
        status: i.status,
        rollbackId: i.rollbackId ?? null,
      }),
    );
    const entry = this.runtime.audit().append({
      actor: i.actor,
      action: `automation.workflow.${i.workflowId}.${i.status}`,
      target: `${i.tenantId}:${i.workflowId}`,
      deviceId: 'automation',
      at,
      dataHash,
    });
    this.tally('automation.execution');
    await this.runtime.events().publish({
      type: 'automation.execution',
      topic: 'automation',
      partitionKey: i.tenantId,
      version: 1,
      payload: {
        workflowId: i.workflowId,
        version: i.version,
        trigger: i.trigger,
        status: i.status,
        durationMs: i.durationMs,
        approvals: i.approvals.length,
        evidenceCount: i.evidence.length,
        aiInitiated: i.aiInitiated,
        replayId,
        ...(i.rollbackId ? { rollbackId: i.rollbackId } : {}),
        ...(i.error ? { error: i.error } : {}),
      },
    });
    return { auditId: String(entry.auditId), replayId, at };
  }

  async recordApproval(tenantId: string, requestId: string, approver: string, decision: string): Promise<void> {
    const at = this.clock.now();
    this.runtime.audit().append({ actor: approver, action: `automation.approval.${decision}`, target: `${tenantId}:${requestId}`, deviceId: 'automation', at, dataHash: sha256Hex(`${requestId}:${approver}:${decision}`) });
    this.tally('automation.approval');
    await this.runtime.events().publish({ type: 'automation.approval', topic: 'automation', partitionKey: tenantId, version: 1, payload: { requestId, approver, decision } });
  }

  async recordNotification(tenantId: string, channel: string, status: string): Promise<void> {
    const at = this.clock.now();
    this.runtime.audit().append({ actor: tenantId, action: `automation.notification.${channel}.${status}`, target: `${tenantId}:${channel}`, deviceId: 'automation', at, dataHash: sha256Hex(`${channel}:${status}:${at}`) });
    this.tally('automation.notification');
    await this.runtime.events().publish({ type: 'automation.notification', topic: 'automation', partitionKey: tenantId, version: 1, payload: { channel, status } });
  }

  count(type?: string): number {
    if (type) return this.counts.get(type) ?? 0;
    return [...this.counts.values()].reduce((a, b) => a + b, 0);
  }

  verify(): boolean {
    return this.runtime.audit().verify().valid;
  }
}
