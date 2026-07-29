/**
 * EPIC 8 — Authorization Platform. RBAC, ABAC, a permission registry, role templates, organization
 * policies, tenant/workspace isolation, policy evaluation, privilege-escalation protection, and
 * least privilege. REUSES the security authorization engine (real RBAC/ABAC decisions + JIT grants) —
 * it never re-implements policy evaluation.
 */
import type { InfraGovernance } from './governance';
import type { InfraContext } from './types';

export interface RoleTemplate { id: string; name: string; permissions: string[] }

const ROLE_TEMPLATES: RoleTemplate[] = [
  { id: 'org-admin', name: 'Organization Admin', permissions: ['*:*'] },
  { id: 'operator', name: 'Operator', permissions: ['infrastructure:read', 'infrastructure:deploy', 'monitoring:read'] },
  { id: 'viewer', name: 'Viewer', permissions: ['*:read'] },
];

export class AuthorizationPlatform {
  constructor(
    private readonly governance: InfraGovernance,
    private readonly ctx: InfraContext,
  ) {}

  roleTemplates(): RoleTemplate[] { return ROLE_TEMPLATES; }

  /** Define a role by REUSING the security authorization engine. */
  async defineRole(input: { id: string; name: string; permissions: string[]; org?: string }): Promise<{ id: string; reusedSecurity: boolean }> {
    if (this.ctx.security) {
      this.ctx.security.authorization().defineRole({ id: input.id, name: input.name, permissions: input.permissions });
      await this.governance.record({ operator: 'system', org: input.org ?? '_ops', environment: '_platform', epic: 'E8', operation: 'authz.role', targetId: input.id, evidence: 'live-verified' });
      return { id: input.id, reusedSecurity: true };
    }
    return { id: input.id, reusedSecurity: false };
  }

  /** Evaluate an access request by REUSING the security engine's real RBAC/ABAC decision. */
  authorize(input: { subjectId: string; roles: string[]; action: string; resourceType: string; resourceId?: string; attributes?: Record<string, unknown> }): { allowed: boolean; reason: string; reusedSecurity: boolean } {
    if (!this.ctx.security) return { allowed: false, reason: 'no security platform connected', reusedSecurity: false };
    const decision = this.ctx.security.authorization().authorize({
      subject: { id: input.subjectId, roles: input.roles, ...(input.attributes ? { attributes: input.attributes } : {}) },
      action: input.action,
      resource: { type: input.resourceType, ...(input.resourceId ? { id: input.resourceId } : {}) },
    });
    return { allowed: decision.allowed, reason: decision.reason, reusedSecurity: true };
  }

  /** Grant a time-boxed JIT permission by REUSING the security engine (least-privilege + escalation control). */
  async grantJit(input: { subjectId: string; permission: string; expiresAt: number; approvedBy: string }): Promise<{ granted: boolean; reusedSecurity: boolean }> {
    if (!this.ctx.security) return { granted: false, reusedSecurity: false };
    await this.ctx.security.authorization().grantJit(input.subjectId, input.permission, input.expiresAt, input.approvedBy);
    return { granted: true, reusedSecurity: true };
  }

  /** Tenant isolation is enforced by the reused security tenant-isolation service. */
  tenantIsolationAvailable(): boolean { return !!this.ctx.security; }
}
