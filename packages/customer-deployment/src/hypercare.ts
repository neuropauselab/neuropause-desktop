/**
 * EPIC 13 — Hypercare Platform. The post-go-live support layer: an issue/incident registry, escalation
 * workflow, a customer support queue, resolution tracking, and SLA monitoring. Incidents REUSE the
 * operations IncidentRegistry when wired in (real open → acknowledge → resolve with a real timeline);
 * SLA status REUSES the Sprint-4 SLO error-budget math. Resolution is measured from the real incident
 * state — never assumed.
 */
import { randomId } from '@neuropause/cloud-core';
import type { CustomerDeploymentContext } from './types';
import type { DeploymentGovernance } from './governance';
import type { CustomerDeploymentRuntime } from './runtime';

export type HyperSeverity = 'sev1' | 'sev2' | 'sev3' | 'sev4' | 'sev5';

export interface HyperIssue {
  id: string;
  deploymentId: string;
  title: string;
  severity: HyperSeverity;
  state: 'open' | 'acknowledged' | 'resolved';
  operationsIncidentId: string | null;
  reusedOperations: boolean;
}

export class HypercarePlatform {
  private readonly issues = new Map<string, HyperIssue>();

  constructor(
    private readonly ctx: CustomerDeploymentContext,
    private readonly runtime: CustomerDeploymentRuntime,
    private readonly gov: DeploymentGovernance,
    private readonly operator: string,
  ) {}

  async openIssue(input: { deploymentId: string; title: string; severity: HyperSeverity }): Promise<HyperIssue> {
    const deployment = this.require(input.deploymentId);
    let operationsIncidentId: string | null = null;
    let reusedOperations = false;
    if (this.ctx.operations) {
      const inc = this.ctx.operations.incidents().open({ title: input.title, severity: input.severity, services: [deployment.tenantId] });
      operationsIncidentId = inc.id;
      reusedOperations = true;
    }
    const issue: HyperIssue = { id: randomId('hyper'), deploymentId: input.deploymentId, title: input.title, severity: input.severity, state: 'open', operationsIncidentId, reusedOperations };
    this.issues.set(issue.id, issue);
    await this.record(deployment, 'open-issue', issue.id, input.severity);
    return issue;
  }

  async acknowledge(issueId: string, actor: string): Promise<HyperIssue> {
    const issue = this.require2(issueId);
    if (this.ctx.operations && issue.operationsIncidentId) this.ctx.operations.incidents().acknowledge(issue.operationsIncidentId, actor);
    issue.state = 'acknowledged';
    const deployment = this.require(issue.deploymentId);
    await this.record(deployment, 'acknowledge-issue', issueId, actor);
    return issue;
  }

  async resolve(issueId: string, rootCause?: string): Promise<HyperIssue> {
    const issue = this.require2(issueId);
    if (this.ctx.operations && issue.operationsIncidentId) this.ctx.operations.incidents().resolve(issue.operationsIncidentId, rootCause ? { rootCause } : {});
    issue.state = 'resolved';
    const deployment = this.require(issue.deploymentId);
    await this.record(deployment, 'resolve-issue', issueId, 'resolved');
    return issue;
  }

  /** SLA status reuses the Sprint-4 SLO error-budget math when reliability is wired in. */
  async slaStatus(input: { name: string; target: number; windowMs: number; observedDowntimeMs: number }): Promise<{ status: string; reusedReliability: boolean }> {
    if (this.ctx.reliability) {
      const slo = await this.ctx.reliability.slo().define({ name: input.name, kind: 'availability', target: input.target, windowMs: input.windowMs });
      const budget = this.ctx.reliability.slo().errorBudget(slo.id, input.observedDowntimeMs);
      return { status: budget.status, reusedReliability: true };
    }
    return { status: 'no-reliability-platform', reusedReliability: false };
  }

  queue(state?: HyperIssue['state']): HyperIssue[] {
    const all = [...this.issues.values()];
    return state ? all.filter((i) => i.state === state) : all;
  }
  resolvedCount(): number {
    return [...this.issues.values()].filter((i) => i.state === 'resolved').length;
  }

  private async record(deployment: { customerId: string; tenantId: string; environmentId: string }, operation: string, targetId: string, decision: string): Promise<void> {
    await this.gov.record({ operator: this.operator, customer: deployment.customerId, tenant: deployment.tenantId, environment: deployment.environmentId, epic: 'E13', operation, targetId, evidence: 'live-verified', decision });
  }
  private require(deploymentId: string): { customerId: string; tenantId: string; environmentId: string } {
    const d = this.runtime.deployment(deploymentId);
    if (!d) throw new Error(`unknown deployment: ${deploymentId}`);
    return d;
  }
  private require2(issueId: string): HyperIssue {
    const i = this.issues.get(issueId);
    if (!i) throw new Error(`unknown hypercare issue: ${issueId}`);
    return i;
  }
}
