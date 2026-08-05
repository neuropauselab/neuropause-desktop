/**
 * EPIC 1 — Enterprise Deployment Orchestrator. A deployment registry, deployment lifecycle, rollout &
 * rollback plans, an environment registry, deployment templates, and deployment validation. A deployment
 * advances registered → validated → approved → rollout-ready — where 'rollout-ready' means the plan is
 * validated and approved, NOT that a real production deployment occurred. The 'production-target'
 * environment is represented; no real customer production environment exists here. Validation is a REAL
 * prerequisite check, deny-by-default: a deployment cannot be approved until it validates.
 */
import { randomId } from '@neuropause/cloud-core';
import { type DeploymentStatus, type EnvironmentType, type RolloutMode } from './constants';
import type { DeploymentOrchestratorGovernance } from './governance';

export interface DeploymentEnvironment {
  id: string;
  name: string;
  type: EnvironmentType;
}
export interface DeploymentTemplate {
  id: string;
  name: string;
  mode: RolloutMode;
  description: string;
}
export interface Deployment {
  id: string;
  organization: string;
  environment: string;
  version: string;
  templateId: string | null;
  status: DeploymentStatus;
  approvedBy: string | null;
}
export interface RolloutPlan {
  id: string;
  deploymentId: string;
  waves: string[];
}
export interface RollbackPlan {
  id: string;
  deploymentId: string;
  steps: string[];
}
export interface ValidationResult {
  valid: boolean;
  checks: Array<{ check: string; ok: boolean }>;
}

export class DeploymentOrchestrator {
  private readonly environments = new Map<string, DeploymentEnvironment>();
  private readonly templates = new Map<string, DeploymentTemplate>();
  private readonly deployments = new Map<string, Deployment>();
  private readonly rolloutPlans = new Map<string, RolloutPlan>();
  private readonly rollbackPlans = new Map<string, RollbackPlan>();

  constructor(
    private readonly gov: DeploymentOrchestratorGovernance,
    private readonly operator: string,
  ) {}

  async registerEnvironment(input: { name: string; type: EnvironmentType }): Promise<DeploymentEnvironment> {
    const env: DeploymentEnvironment = { id: randomId('env'), name: input.name, type: input.type };
    this.environments.set(env.id, env);
    await this.gov.record({ operator: this.operator, organization: '_platform', environment: input.name, version: '-', epic: 'E1', operation: 'register-environment', targetId: env.id, evidence: 'live-verified', decision: input.type });
    return env;
  }

  async registerTemplate(input: { name: string; mode: RolloutMode; description: string }): Promise<DeploymentTemplate> {
    const tpl: DeploymentTemplate = { id: randomId('tpl'), name: input.name, mode: input.mode, description: input.description };
    this.templates.set(tpl.id, tpl);
    await this.gov.record({ operator: this.operator, organization: '_platform', environment: '-', version: '-', epic: 'E1', operation: 'register-template', targetId: tpl.id, evidence: 'live-verified', decision: input.mode });
    return tpl;
  }

  /** Register a deployment intent. Status 'registered' — nothing is deployed. */
  async register(input: { organization: string; environment: string; version: string; templateId?: string }): Promise<Deployment> {
    const deployment: Deployment = {
      id: randomId('dep'),
      organization: input.organization,
      environment: input.environment,
      version: input.version,
      templateId: input.templateId ?? null,
      status: 'registered',
      approvedBy: null,
    };
    this.deployments.set(deployment.id, deployment);
    await this.gov.record({ operator: this.operator, organization: input.organization, environment: input.environment, version: input.version, epic: 'E1', operation: 'register-deployment', targetId: deployment.id, evidence: 'business-data-pending', decision: 'registered' });
    return deployment;
  }

  /** REAL prerequisite validation — deny-by-default. */
  async validate(id: string): Promise<{ deployment: Deployment; result: ValidationResult }> {
    const deployment = this.require(id);
    const checks = [
      { check: 'organization set', ok: deployment.organization.length > 0 },
      { check: 'version set', ok: deployment.version.length > 0 },
      { check: 'environment set', ok: deployment.environment.length > 0 },
      { check: 'template referenced', ok: deployment.templateId !== null },
    ];
    const valid = checks.every((c) => c.ok);
    deployment.status = valid ? 'validated' : 'registered';
    await this.gov.record({ operator: this.operator, organization: deployment.organization, environment: deployment.environment, version: deployment.version, epic: 'E1', operation: 'validate-deployment', targetId: id, evidence: 'live-verified', decision: valid ? 'validated' : 'invalid' });
    return { deployment, result: { valid, checks } };
  }

  /** Approve — requires a validated deployment. */
  async approve(id: string, approver: string): Promise<Deployment> {
    const deployment = this.require(id);
    if (deployment.status !== 'validated') {
      await this.gov.record({ operator: this.operator, organization: deployment.organization, environment: deployment.environment, version: deployment.version, epic: 'E1', operation: 'approve-denied', targetId: id, evidence: 'live-verified', decision: 'not validated' });
      return deployment;
    }
    deployment.status = 'approved';
    deployment.approvedBy = approver;
    await this.gov.record({ operator: approver, organization: deployment.organization, environment: deployment.environment, version: deployment.version, epic: 'E1', operation: 'approve-deployment', targetId: id, evidence: 'live-verified', approval: approver, decision: 'approved' });
    return deployment;
  }

  /** Mark rollout-ready — READINESS only; this never claims a real production deployment. */
  async markRolloutReady(id: string): Promise<Deployment> {
    const deployment = this.require(id);
    if (deployment.status !== 'approved') return deployment;
    deployment.status = 'rollout-ready';
    await this.gov.record({ operator: this.operator, organization: deployment.organization, environment: deployment.environment, version: deployment.version, epic: 'E1', operation: 'rollout-ready', targetId: id, evidence: 'live-verified', decision: 'ready (not deployed)' });
    return deployment;
  }

  async createRolloutPlan(input: { deploymentId: string; waves: string[] }): Promise<RolloutPlan> {
    const plan: RolloutPlan = { id: randomId('roll'), deploymentId: input.deploymentId, waves: input.waves };
    this.rolloutPlans.set(plan.id, plan);
    await this.gov.record({ operator: this.operator, organization: '_platform', environment: '-', version: '-', epic: 'E1', operation: 'create-rollout-plan', targetId: plan.id, evidence: 'live-verified', decision: `${input.waves.length} waves` });
    return plan;
  }

  async createRollbackPlan(input: { deploymentId: string; steps: string[] }): Promise<RollbackPlan> {
    const plan: RollbackPlan = { id: randomId('rbk'), deploymentId: input.deploymentId, steps: input.steps };
    this.rollbackPlans.set(plan.id, plan);
    await this.gov.record({ operator: this.operator, organization: '_platform', environment: '-', version: '-', epic: 'E1', operation: 'create-rollback-plan', targetId: plan.id, evidence: 'live-verified', decision: `${input.steps.length} steps` });
    return plan;
  }

  async rollback(id: string): Promise<Deployment> {
    const deployment = this.require(id);
    deployment.status = 'rolled-back';
    await this.gov.record({ operator: this.operator, organization: deployment.organization, environment: deployment.environment, version: deployment.version, epic: 'E1', operation: 'rollback', targetId: id, evidence: 'live-verified', decision: 'rolled-back' });
    return deployment;
  }

  deployment(id: string): Deployment | undefined {
    return this.deployments.get(id);
  }
  deploymentCount(): number {
    return this.deployments.size;
  }
  templateCount(): number {
    return this.templates.size;
  }
  environmentCount(): number {
    return this.environments.size;
  }

  private require(id: string): Deployment {
    const d = this.deployments.get(id);
    if (!d) throw new Error(`unknown deployment: ${id}`);
    return d;
  }
}
