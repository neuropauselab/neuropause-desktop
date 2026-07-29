/**
 * Module 1 — Federation Runtime. The federation engine + registry + lifecycle: create a
 * federation, join/leave organizations, archive, and carry federation metadata. Members are
 * organization ids. Every lifecycle operation is governed (audit + event + replay id).
 */
import { randomId, type Clock } from '@neuropause/cloud-core';
import type { FederationGovernance } from './governance';
import type { Federation } from './types';

export class FederationRuntime {
  private readonly federations = new Map<string, Federation>();

  constructor(
    private readonly clock: Clock,
    private readonly governance: FederationGovernance,
  ) {}

  async create(input: { name: string; ownerOrgId: string; metadata?: Record<string, unknown> }): Promise<Federation> {
    const fed: Federation = { id: randomId('fed'), name: input.name, ownerOrgId: input.ownerOrgId, members: [input.ownerOrgId], metadata: input.metadata ?? {}, status: 'active', createdAt: this.clock.now() };
    this.federations.set(fed.id, fed);
    await this.governance.record({ federationId: fed.id, actor: input.ownerOrgId, operation: 'create', targetId: fed.id, evidence: 'live-verified' });
    return fed;
  }

  private mut(id: string): Federation {
    const fed = this.federations.get(id);
    if (!fed) throw new Error(`unknown federation '${id}'`);
    return fed;
  }

  async join(federationId: string, orgId: string): Promise<Federation> {
    const fed = this.mut(federationId);
    if (fed.status !== 'active') throw new Error(`federation '${federationId}' is archived`);
    if (!fed.members.includes(orgId)) fed.members.push(orgId);
    await this.governance.record({ federationId, actor: orgId, operation: 'join', targetId: orgId, evidence: 'live-verified' });
    return fed;
  }

  async leave(federationId: string, orgId: string): Promise<Federation> {
    const fed = this.mut(federationId);
    fed.members = fed.members.filter((m) => m !== orgId);
    await this.governance.record({ federationId, actor: orgId, operation: 'leave', targetId: orgId, evidence: 'live-verified' });
    return fed;
  }

  async archive(federationId: string): Promise<Federation> {
    const fed = this.mut(federationId);
    fed.status = 'archived';
    await this.governance.record({ federationId, actor: fed.ownerOrgId, operation: 'archive', targetId: federationId, evidence: 'live-verified' });
    return fed;
  }

  async setMetadata(federationId: string, metadata: Record<string, unknown>): Promise<Federation> {
    const fed = this.mut(federationId);
    fed.metadata = { ...fed.metadata, ...metadata };
    await this.governance.record({ federationId, actor: fed.ownerOrgId, operation: 'metadata.update', targetId: federationId, evidence: 'live-verified' });
    return fed;
  }

  get(id: string): Federation | undefined {
    return this.federations.get(id);
  }
  list(): Federation[] {
    return [...this.federations.values()];
  }
  active(): Federation[] {
    return this.list().filter((f) => f.status === 'active');
  }
  members(federationId: string): string[] {
    return [...(this.federations.get(federationId)?.members ?? [])];
  }
  /** Federations an organization is a member of. */
  federationsOf(orgId: string): Federation[] {
    return this.list().filter((f) => f.members.includes(orgId));
  }
  count(): number {
    return this.federations.size;
  }
}
