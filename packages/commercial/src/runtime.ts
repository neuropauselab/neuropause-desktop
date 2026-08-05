/**
 * Module 1 — Commercial Runtime. Customer registry, organization provisioning, tenant runtime, and
 * commercial context. Reuses the runtime (via governance); every customer/tenant action is audited
 * on the one chain. In-process — live-verified; starts empty (no customers are fabricated).
 */
import { randomId, type Clock } from '@neuropause/cloud-core';
import type { CommercialGovernance } from './governance';
import { TENANT_STATES, type TenantState } from './constants';

export interface Customer {
  id: string;
  name: string;
  orgId: string;
  createdAt: number;
}
export interface Tenant {
  id: string;
  customerId: string;
  name: string;
  region: string;
  state: TenantState;
  isolatedStorageKey: string;
  metadata: Record<string, unknown>;
  config: Record<string, unknown>;
  createdAt: number;
}

export class CommercialRuntime {
  private readonly customers = new Map<string, Customer>();
  private readonly tenants = new Map<string, Tenant>();

  constructor(
    private readonly clock: Clock,
    private readonly governance: CommercialGovernance,
  ) {}

  async registerCustomer(input: { name: string; orgId?: string }): Promise<Customer> {
    const c: Customer = { id: randomId('cust'), name: input.name, orgId: input.orgId ?? randomId('org'), createdAt: this.clock.now() };
    this.customers.set(c.id, c);
    await this.governance.record({ actor: 'system', org: c.orgId, tenant: '_customer', operation: 'customer.register', targetId: c.id, evidence: 'live-verified' });
    return c;
  }

  async provisionTenant(input: { customerId: string; name: string; region?: string; metadata?: Record<string, unknown>; config?: Record<string, unknown> }): Promise<Tenant> {
    const customer = this.customers.get(input.customerId);
    if (!customer) throw new Error(`no customer ${input.customerId}`);
    const t: Tenant = {
      id: randomId('tenant'),
      customerId: input.customerId,
      name: input.name,
      region: input.region ?? 'unassigned',
      state: 'provisioning',
      isolatedStorageKey: '',
      metadata: input.metadata ?? {},
      config: input.config ?? {},
      createdAt: this.clock.now(),
    };
    t.isolatedStorageKey = `tenant:${t.id}:store`; // per-tenant isolated storage namespace
    this.tenants.set(t.id, t);
    await this.governance.record({ actor: 'system', org: customer.orgId, tenant: t.id, operation: 'tenant.provision', targetId: t.id, evidence: 'live-verified' });
    return t;
  }

  async setTenantState(id: string, state: TenantState): Promise<Tenant> {
    if (!TENANT_STATES.includes(state)) throw new Error(`unknown tenant state: ${state}`);
    const t = this.requireTenant(id);
    t.state = state;
    const org = this.customers.get(t.customerId)?.orgId ?? '_unknown';
    await this.governance.record({ actor: 'system', org, tenant: id, operation: `tenant.${state}`, targetId: id, evidence: 'live-verified' });
    return t;
  }

  /** Commercial context for a customer — real tenant state, never fabricated. */
  context(customerId: string): { customerId: string; tenants: number; active: number } {
    const ts = this.tenantsOf(customerId);
    return { customerId, tenants: ts.length, active: ts.filter((t) => t.state === 'active').length };
  }

  private requireTenant(id: string): Tenant {
    const t = this.tenants.get(id);
    if (!t) throw new Error(`no tenant ${id}`);
    return t;
  }

  getCustomer(id: string): Customer | undefined { return this.customers.get(id); }
  getTenant(id: string): Tenant | undefined { return this.tenants.get(id); }
  customerList(): Customer[] { return [...this.customers.values()]; }
  tenantsOf(customerId?: string): Tenant[] {
    const all = [...this.tenants.values()];
    return customerId ? all.filter((t) => t.customerId === customerId) : all;
  }
  customerCount(): number { return this.customers.size; }
  tenantCount(): number { return this.tenants.size; }
}
