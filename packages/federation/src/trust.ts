/**
 * Module 7 — Federation Trust Engine. Directional trust relationships between organizations
 * within a federation (none < read < share < full), trust validation, federation policies,
 * and per-organization permissions. Every trust/policy/permission change is governed. The
 * Cross-Organization Exchange (Module 8) consults `validate()` before sharing.
 */
import { randomId, type Clock } from '@neuropause/cloud-core';
import type { FederationGovernance } from './governance';
import type { TrustRelationship } from './types';
import { TRUST_LEVELS, type TrustLevel } from './constants';

const RANK: Record<TrustLevel, number> = { none: 0, read: 1, share: 2, full: 3 };

export interface FederationPolicy {
  id: string;
  federationId: string;
  name: string;
  rule: Record<string, unknown>;
}

export class TrustEngine {
  private readonly trusts: TrustRelationship[] = [];
  private readonly policies = new Map<string, FederationPolicy[]>();
  private readonly permissions = new Map<string, Set<string>>();

  constructor(
    private readonly clock: Clock,
    private readonly governance: FederationGovernance,
  ) {}

  async establish(input: { federationId: string; fromOrg: string; toOrg: string; level: TrustLevel }): Promise<TrustRelationship> {
    // upsert directional trust
    const existing = this.trusts.findIndex((t) => t.federationId === input.federationId && t.fromOrg === input.fromOrg && t.toOrg === input.toOrg);
    const rel: TrustRelationship = { id: randomId('trust'), federationId: input.federationId, fromOrg: input.fromOrg, toOrg: input.toOrg, level: input.level, establishedAt: this.clock.now() };
    if (existing >= 0) this.trusts[existing] = rel;
    else this.trusts.push(rel);
    await this.governance.record({ federationId: input.federationId, actor: input.fromOrg, operation: 'trust.establish', targetId: input.toOrg, evidence: 'live-verified', detail: input.level });
    return rel;
  }

  level(federationId: string, fromOrg: string, toOrg: string): TrustLevel {
    return this.trusts.find((t) => t.federationId === federationId && t.fromOrg === fromOrg && t.toOrg === toOrg)?.level ?? 'none';
  }

  /** True when fromOrg trusts toOrg at or above `required`. */
  validate(federationId: string, fromOrg: string, toOrg: string, required: TrustLevel): boolean {
    return RANK[this.level(federationId, fromOrg, toOrg)] >= RANK[required];
  }

  trustsOf(federationId: string): TrustRelationship[] {
    return this.trusts.filter((t) => t.federationId === federationId);
  }
  allTrusts(): TrustRelationship[] {
    return [...this.trusts];
  }

  async definePolicy(federationId: string, input: { name: string; rule?: Record<string, unknown> }): Promise<FederationPolicy> {
    const policy: FederationPolicy = { id: randomId('fpol'), federationId, name: input.name, rule: input.rule ?? {} };
    this.policies.set(federationId, [...(this.policies.get(federationId) ?? []), policy]);
    await this.governance.record({ federationId, actor: 'system', operation: 'policy.define', targetId: policy.id, evidence: 'live-verified' });
    return policy;
  }
  policiesFor(federationId: string): FederationPolicy[] {
    return this.policies.get(federationId) ?? [];
  }

  async grantPermission(federationId: string, orgId: string, permission: string): Promise<void> {
    const key = `${federationId}:${orgId}`;
    const set = this.permissions.get(key) ?? new Set<string>();
    set.add(permission);
    this.permissions.set(key, set);
    await this.governance.record({ federationId, actor: 'system', operation: 'permission.grant', targetId: orgId, evidence: 'live-verified', detail: permission });
  }
  can(federationId: string, orgId: string, permission: string): boolean {
    const set = this.permissions.get(`${federationId}:${orgId}`);
    return set !== undefined && (set.has('*') || set.has(permission));
  }

  levels(): readonly TrustLevel[] {
    return TRUST_LEVELS;
  }
}
