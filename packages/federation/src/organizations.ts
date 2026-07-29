/**
 * Module 2 — Organization Manager. Create / update / archive organizations and hold their
 * metadata (optionally linked to a real NEMS tenant id). Federation membership itself lives
 * in the Federation Runtime; this manages the organization records. Every mutation is governed.
 */
import { randomId, type Clock } from '@neuropause/cloud-core';
import type { FederationGovernance } from './governance';
import type { Organization } from './types';

export class OrganizationManager {
  private readonly orgs = new Map<string, Organization>();

  constructor(
    private readonly clock: Clock,
    private readonly governance: FederationGovernance,
  ) {}

  async create(input: { name: string; metadata?: Record<string, unknown>; nemsTenantId?: string }): Promise<Organization> {
    const now = this.clock.now();
    const org: Organization = { id: randomId('org'), name: input.name, metadata: input.metadata ?? {}, ...(input.nemsTenantId ? { nemsTenantId: input.nemsTenantId } : {}), status: 'active', createdAt: now, updatedAt: now };
    this.orgs.set(org.id, org);
    await this.governance.record({ federationId: '_registry', actor: 'system', operation: 'organization.create', targetId: org.id, evidence: 'live-verified' });
    return org;
  }

  async update(id: string, patch: { name?: string; metadata?: Record<string, unknown> }): Promise<Organization> {
    const org = this.orgs.get(id);
    if (!org) throw new Error(`unknown organization '${id}'`);
    if (patch.name !== undefined) org.name = patch.name;
    if (patch.metadata !== undefined) org.metadata = { ...org.metadata, ...patch.metadata };
    org.updatedAt = this.clock.now();
    await this.governance.record({ federationId: '_registry', actor: 'system', operation: 'organization.update', targetId: id, evidence: 'live-verified' });
    return org;
  }

  async archive(id: string): Promise<Organization> {
    const org = this.orgs.get(id);
    if (!org) throw new Error(`unknown organization '${id}'`);
    org.status = 'archived';
    org.updatedAt = this.clock.now();
    await this.governance.record({ federationId: '_registry', actor: 'system', operation: 'organization.archive', targetId: id, evidence: 'live-verified' });
    return org;
  }

  get(id: string): Organization | undefined {
    return this.orgs.get(id);
  }
  list(): Organization[] {
    return [...this.orgs.values()];
  }
  active(): Organization[] {
    return this.list().filter((o) => o.status === 'active');
  }
  count(): number {
    return this.orgs.size;
  }
}
