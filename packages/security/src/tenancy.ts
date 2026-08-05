/**
 * Tenant Isolation (NCEA 14.0, Phase 5). Cross-tenant access is IMPOSSIBLE unless
 * explicitly delegated and audited. `check()` allows access only when the actor's
 * tenant equals the resource's tenant, or an active, non-revoked cross-tenant
 * delegation exists for that isolation domain. `assertAccess()` throws on denial
 * and audits it. The same guard covers every domain — organization, workspace,
 * connector, secret, memory, knowledge, audit, storage, queue, event.
 */
import { randomId, type Clock } from '@neuropause/cloud-core';
import type { SecurityAudit } from './audit';

export const ISOLATION_DOMAINS = ['organization', 'workspace', 'connector', 'secret', 'memory', 'knowledge', 'audit', 'storage', 'queue', 'event'] as const;
export type IsolationDomain = (typeof ISOLATION_DOMAINS)[number];

interface CrossTenantDelegation {
  id: string;
  fromTenant: string; // resource owner
  toTenant: string; // grantee
  domain: IsolationDomain;
  expiresAt: number;
  revoked: boolean;
}

export interface IsolationCheck {
  allowed: boolean;
  reason: 'same-tenant' | 'delegated' | 'cross-tenant-denied';
}

export class TenantIsolation {
  private readonly delegations = new Map<string, CrossTenantDelegation>();

  constructor(
    private readonly clock: Clock,
    private readonly audit: SecurityAudit,
  ) {}

  check(actorTenant: string, resourceTenant: string, domain: IsolationDomain): IsolationCheck {
    if (actorTenant === resourceTenant) return { allowed: true, reason: 'same-tenant' };
    const now = this.clock.now();
    const delegated = [...this.delegations.values()].some(
      (d) => d.fromTenant === resourceTenant && d.toTenant === actorTenant && d.domain === domain && !d.revoked && d.expiresAt > now,
    );
    return delegated ? { allowed: true, reason: 'delegated' } : { allowed: false, reason: 'cross-tenant-denied' };
  }

  /** Enforce isolation: throw + audit on a denied cross-tenant access. */
  async assertAccess(actorTenant: string, resourceTenant: string, domain: IsolationDomain, actor = 'system'): Promise<void> {
    const result = this.check(actorTenant, resourceTenant, domain);
    if (!result.allowed) {
      await this.audit.record({ category: 'security', action: 'tenant.isolation.deny', actor, tenant: actorTenant, target: `${domain}:${resourceTenant}`, meta: { resourceTenant, domain } });
      throw new Error(`cross-tenant access denied: ${actorTenant} → ${resourceTenant} (${domain})`);
    }
  }

  /** The ONLY way to cross tenants — explicit + audited. */
  async delegate(fromTenant: string, toTenant: string, domain: IsolationDomain, expiresAt: number, actor: string): Promise<CrossTenantDelegation> {
    const delegation: CrossTenantDelegation = { id: randomId('xtd'), fromTenant, toTenant, domain, expiresAt, revoked: false };
    this.delegations.set(delegation.id, delegation);
    await this.audit.record({ category: 'security', action: 'tenant.delegate', actor, tenant: fromTenant, target: toTenant, meta: { domain, expiresAt } });
    return delegation;
  }

  async revokeDelegation(id: string, actor = 'system'): Promise<void> {
    const d = this.delegations.get(id);
    if (d) d.revoked = true;
    await this.audit.record({ category: 'security', action: 'tenant.delegate.revoke', actor, target: id });
  }

  /** Tenant-prefix a resource key so storage/queue/event keys are physically scoped. */
  scopedKey(tenant: string, key: string): string {
    return `${tenant}::${key}`;
  }
}
