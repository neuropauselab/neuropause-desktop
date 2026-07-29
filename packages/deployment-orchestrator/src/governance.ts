/**
 * EPIC 14 — Deployment Governance. Every deployment records — on the ONE runtime audit chain and event
 * bus — the organization, environment, version, operator, approval, evidence level, a replay id, and the
 * timestamp. It REUSES the governance chain; the launch layer never bypasses it and never opens a second
 * ledger. Audited events include deployment registration, rollout planning, GA go/no-go, pilot
 * milestones, commercial pipeline changes, partner onboarding, and launch-readiness scoring.
 */
import { sha256Hex, randomId, type Clock } from '@neuropause/cloud-core';
import type { EnterpriseRuntime } from '@neuropause/runtime';
import type { DoEvidenceLevel } from './types';

export interface DoGovInput {
  operator: string;
  organization: string;
  environment: string;
  version: string;
  epic: string;
  operation: string;
  targetId: string;
  evidence: DoEvidenceLevel;
  approval?: string;
  decision?: string;
}

export interface DoGovRef {
  auditId: string;
  replayId: string;
  at: number;
}

export class DeploymentOrchestratorGovernance {
  private readonly counts = new Map<string, number>();

  constructor(
    private readonly runtime: EnterpriseRuntime,
    private readonly clock: Clock,
  ) {}

  async record(i: DoGovInput): Promise<DoGovRef> {
    const at = this.clock.now();
    const replayId = randomId('replay');
    const dataHash = sha256Hex(
      JSON.stringify({ organization: i.organization, environment: i.environment, version: i.version, epic: i.epic, operation: i.operation, targetId: i.targetId, evidence: i.evidence, approval: i.approval ?? null }),
    );
    const entry = this.runtime.audit().append({
      actor: i.operator,
      action: `deployment.${i.operation}`,
      target: `${i.organization}:${i.targetId}`,
      deviceId: 'deployment-orchestrator',
      at,
      dataHash,
    });
    this.counts.set(i.operation, (this.counts.get(i.operation) ?? 0) + 1);
    this.counts.set('total', (this.counts.get('total') ?? 0) + 1);
    await this.runtime.events().publish({
      type: 'deployment.action',
      topic: 'deployment-orchestrator',
      partitionKey: i.organization,
      version: 1,
      payload: {
        operator: i.operator,
        organization: i.organization,
        environment: i.environment,
        deploymentVersion: i.version,
        epic: i.epic,
        operation: i.operation,
        targetId: i.targetId,
        evidence: i.evidence,
        replayId,
        at,
        ...(i.approval ? { approval: i.approval } : {}),
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
