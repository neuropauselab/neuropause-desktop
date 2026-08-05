/**
 * EPIC 1 — Customer Deployment Runtime. The registries + governed lifecycle for customers, tenants,
 * environments, and deployments. A deployment advances through a real lifecycle (registered →
 * onboarding → configuring → validating → ready → deployed → hypercare, or rolled-back/failed); each
 * transition appends to the deployment history and is audited on the one chain. 'deployed' is only
 * ever reached by an explicit gated transition — never assumed.
 */
import { randomId, type Clock } from '@neuropause/cloud-core';
import type { DeploymentStatus, EnvironmentTier } from './constants';
import type { DeploymentGovernance } from './governance';

export interface Customer {
  id: string;
  name: string;
  profileKey: string | null;
  createdAt: number;
}

export interface Tenant {
  id: string;
  customerId: string;
  name: string;
  domain: string | null;
  createdAt: number;
}

export interface DeploymentEnvironment {
  id: string;
  tenantId: string;
  tier: EnvironmentTier;
  createdAt: number;
}

export interface DeploymentEvent {
  at: number;
  status: DeploymentStatus;
  note: string;
}

export interface Deployment {
  id: string;
  customerId: string;
  tenantId: string;
  environmentId: string;
  status: DeploymentStatus;
  createdAt: number;
  history: DeploymentEvent[];
}

const NEXT: Record<DeploymentStatus, DeploymentStatus[]> = {
  registered: ['onboarding', 'failed'],
  onboarding: ['configuring', 'failed'],
  configuring: ['validating', 'failed'],
  validating: ['ready', 'failed'],
  ready: ['deployed', 'rolled-back', 'failed'],
  deployed: ['hypercare', 'rolled-back'],
  hypercare: ['rolled-back'],
  'rolled-back': [],
  failed: ['onboarding'],
};

export class CustomerDeploymentRuntime {
  private readonly customers = new Map<string, Customer>();
  private readonly tenants = new Map<string, Tenant>();
  private readonly environments = new Map<string, DeploymentEnvironment>();
  private readonly deployments = new Map<string, Deployment>();

  constructor(
    private readonly clock: Clock,
    private readonly gov: DeploymentGovernance,
    private readonly operator: string,
  ) {}

  async registerCustomer(input: { name: string; profileKey?: string }): Promise<Customer> {
    const customer: Customer = { id: randomId('cust'), name: input.name, profileKey: input.profileKey ?? null, createdAt: this.clock.now() };
    this.customers.set(customer.id, customer);
    await this.gov.record({ operator: this.operator, customer: customer.id, tenant: '_none', environment: '_none', epic: 'E1', operation: 'register-customer', targetId: input.name, evidence: 'live-verified' });
    return customer;
  }

  async createTenant(input: { customerId: string; name: string; domain?: string }): Promise<Tenant> {
    if (!this.customers.has(input.customerId)) throw new Error(`unknown customer: ${input.customerId}`);
    const tenant: Tenant = { id: randomId('tenant'), customerId: input.customerId, name: input.name, domain: input.domain ?? null, createdAt: this.clock.now() };
    this.tenants.set(tenant.id, tenant);
    await this.gov.record({ operator: this.operator, customer: input.customerId, tenant: tenant.id, environment: '_none', epic: 'E1', operation: 'create-tenant', targetId: input.name, evidence: 'live-verified' });
    return tenant;
  }

  async createEnvironment(input: { tenantId: string; tier: EnvironmentTier }): Promise<DeploymentEnvironment> {
    const tenant = this.tenants.get(input.tenantId);
    if (!tenant) throw new Error(`unknown tenant: ${input.tenantId}`);
    const env: DeploymentEnvironment = { id: randomId('env'), tenantId: input.tenantId, tier: input.tier, createdAt: this.clock.now() };
    this.environments.set(env.id, env);
    await this.gov.record({ operator: this.operator, customer: tenant.customerId, tenant: input.tenantId, environment: input.tier, epic: 'E1', operation: 'create-environment', targetId: input.tier, evidence: 'live-verified' });
    return env;
  }

  async createDeployment(input: { customerId: string; tenantId: string; environmentId: string }): Promise<Deployment> {
    if (!this.customers.has(input.customerId)) throw new Error(`unknown customer: ${input.customerId}`);
    if (!this.tenants.has(input.tenantId)) throw new Error(`unknown tenant: ${input.tenantId}`);
    if (!this.environments.has(input.environmentId)) throw new Error(`unknown environment: ${input.environmentId}`);
    const at = this.clock.now();
    const deployment: Deployment = {
      id: randomId('deploy'),
      customerId: input.customerId,
      tenantId: input.tenantId,
      environmentId: input.environmentId,
      status: 'registered',
      createdAt: at,
      history: [{ at, status: 'registered', note: 'deployment registered' }],
    };
    this.deployments.set(deployment.id, deployment);
    await this.gov.record({ operator: this.operator, customer: input.customerId, tenant: input.tenantId, environment: input.environmentId, epic: 'E1', operation: 'create-deployment', targetId: deployment.id, evidence: 'live-verified' });
    return deployment;
  }

  /** Advance a deployment through its lifecycle. Illegal transitions throw — status is never silently forced. */
  async transition(deploymentId: string, status: DeploymentStatus, note?: string): Promise<Deployment> {
    const deployment = this.deployments.get(deploymentId);
    if (!deployment) throw new Error(`unknown deployment: ${deploymentId}`);
    const allowed = NEXT[deployment.status];
    if (!allowed.includes(status)) throw new Error(`illegal deployment transition: ${deployment.status} → ${status}`);
    deployment.status = status;
    deployment.history.push({ at: this.clock.now(), status, note: note ?? status });
    await this.gov.record({ operator: this.operator, customer: deployment.customerId, tenant: deployment.tenantId, environment: deployment.environmentId, epic: 'E1', operation: 'transition', targetId: deploymentId, evidence: 'live-verified', decision: status });
    return deployment;
  }

  customer(id: string): Customer | undefined { return this.customers.get(id); }
  tenant(id: string): Tenant | undefined { return this.tenants.get(id); }
  deployment(id: string): Deployment | undefined { return this.deployments.get(id); }
  environment(id: string): DeploymentEnvironment | undefined { return this.environments.get(id); }
  history(deploymentId: string): DeploymentEvent[] { return this.deployments.get(deploymentId)?.history ?? []; }
  listCustomers(): Customer[] { return [...this.customers.values()]; }
  listTenants(customerId?: string): Tenant[] {
    const all = [...this.tenants.values()];
    return customerId ? all.filter((t) => t.customerId === customerId) : all;
  }
  listDeployments(customerId?: string): Deployment[] {
    const all = [...this.deployments.values()];
    return customerId ? all.filter((d) => d.customerId === customerId) : all;
  }
}
