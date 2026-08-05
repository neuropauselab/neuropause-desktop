/**
 * EPIC 11 — User Acceptance Testing (UAT). Builds UAT plans, test cases, business scenarios, an issue
 * registry, acceptance criteria, and a sign-off workflow. Sign-off is NEVER fabricated: a plan can be
 * signed off only when a real approver is supplied AND every case has actually passed AND no blocking
 * issue is open. Absent those, sign-off is refused and the plan stays unsigned — no customer approval
 * is invented.
 */
import { randomId, type Clock } from '@neuropause/cloud-core';
import type { UatStatus } from './constants';
import type { DeploymentGovernance } from './governance';
import type { CustomerDeploymentRuntime } from './runtime';

export interface UatCase {
  id: string;
  scenario: string;
  acceptanceCriteria: string;
  passed: boolean | null; // null until executed
}

export interface UatIssue {
  id: string;
  caseId: string;
  severity: 'blocker' | 'major' | 'minor';
  description: string;
  open: boolean;
}

export interface UatPlan {
  id: string;
  deploymentId: string;
  status: UatStatus;
  cases: UatCase[];
  issues: UatIssue[];
  signedOffBy: string | null;
  signedOffAt: number | null;
}

export class UserAcceptanceTesting {
  private readonly plans = new Map<string, UatPlan>();

  constructor(
    private readonly clock: Clock,
    private readonly runtime: CustomerDeploymentRuntime,
    private readonly gov: DeploymentGovernance,
    private readonly operator: string,
  ) {}

  async createPlan(input: { deploymentId: string; scenarios: Array<{ scenario: string; acceptanceCriteria: string }> }): Promise<UatPlan> {
    const deployment = this.require(input.deploymentId);
    const plan: UatPlan = {
      id: randomId('uat'),
      deploymentId: input.deploymentId,
      status: 'draft',
      cases: input.scenarios.map((s) => ({ id: randomId('uatcase'), scenario: s.scenario, acceptanceCriteria: s.acceptanceCriteria, passed: null })),
      issues: [],
      signedOffBy: null,
      signedOffAt: null,
    };
    this.plans.set(plan.id, plan);
    await this.record(deployment, 'create-uat-plan', plan.id, `${plan.cases.length} cases`);
    return plan;
  }

  async recordResult(planId: string, caseId: string, passed: boolean): Promise<UatPlan> {
    const plan = this.get(planId);
    if (!plan) throw new Error(`unknown UAT plan: ${planId}`);
    const uatCase = plan.cases.find((c) => c.id === caseId);
    if (!uatCase) throw new Error(`unknown UAT case: ${caseId}`);
    uatCase.passed = passed;
    plan.status = 'in-progress';
    const deployment = this.require(plan.deploymentId);
    await this.record(deployment, 'record-uat-result', caseId, passed ? 'passed' : 'failed');
    return plan;
  }

  async raiseIssue(planId: string, input: { caseId: string; severity: UatIssue['severity']; description: string }): Promise<UatIssue> {
    const plan = this.get(planId);
    if (!plan) throw new Error(`unknown UAT plan: ${planId}`);
    const issue: UatIssue = { id: randomId('uatissue'), caseId: input.caseId, severity: input.severity, description: input.description, open: true };
    plan.issues.push(issue);
    const deployment = this.require(plan.deploymentId);
    await this.record(deployment, 'raise-uat-issue', issue.id, input.severity);
    return issue;
  }

  /** Sign-off requires a REAL approver, every case passed, and no open blocker. Otherwise refused. */
  async signOff(planId: string, approver: string): Promise<{ signed: boolean; status: UatStatus; reason: string }> {
    const plan = this.get(planId);
    if (!plan) throw new Error(`unknown UAT plan: ${planId}`);
    const allPassed = plan.cases.length > 0 && plan.cases.every((c) => c.passed === true);
    const openBlocker = plan.issues.some((i) => i.open && i.severity === 'blocker');
    const approverValid = typeof approver === 'string' && approver.trim().length > 0;
    if (!approverValid) return { signed: false, status: plan.status, reason: 'no approver supplied — sign-off refused (approval is never fabricated)' };
    if (!allPassed) {
      plan.status = 'failed';
      return { signed: false, status: plan.status, reason: 'not all cases passed — sign-off refused' };
    }
    if (openBlocker) return { signed: false, status: plan.status, reason: 'open blocker issue — sign-off refused' };
    plan.status = 'signed-off';
    plan.signedOffBy = approver;
    plan.signedOffAt = this.clock.now();
    const deployment = this.require(plan.deploymentId);
    await this.record(deployment, 'uat-sign-off', planId, `signed by ${approver}`);
    return { signed: true, status: plan.status, reason: `signed off by ${approver}` };
  }

  get(id: string): UatPlan | undefined {
    return this.plans.get(id);
  }
  list(): UatPlan[] {
    return [...this.plans.values()];
  }

  private async record(deployment: { customerId: string; tenantId: string; environmentId: string }, operation: string, targetId: string, decision: string): Promise<void> {
    await this.gov.record({ operator: this.operator, customer: deployment.customerId, tenant: deployment.tenantId, environment: deployment.environmentId, epic: 'E11', operation, targetId, evidence: 'live-verified', decision });
  }
  private require(deploymentId: string): { customerId: string; tenantId: string; environmentId: string } {
    const d = this.runtime.deployment(deploymentId);
    if (!d) throw new Error(`unknown deployment: ${deploymentId}`);
    return d;
  }
}
