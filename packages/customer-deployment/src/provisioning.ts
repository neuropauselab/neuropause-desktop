/**
 * EPIC 7 — User Provisioning. Provisions employees, administrators, managers, executives, and AI
 * workers with invitations, role assignment, permission verification, and license assignment. When the
 * platforms are wired in this is REAL: the user is registered through the reused security identity
 * platform, the role is applied through the reused authorization engine, permission is verified by a
 * real authorization decision, and a seat license is issued + allocated through the reused commercial
 * licensing platform. No user, permission, or license is fabricated.
 */
import { randomId } from '@neuropause/cloud-core';
import type { UserRole } from './constants';
import type { CustomerDeploymentContext } from './types';
import type { DeploymentGovernance } from './governance';
import type { CustomerDeploymentRuntime } from './runtime';

export interface ProvisionedUser {
  id: string;
  role: UserRole;
  displayName: string;
  identityId: string | null;
  invited: boolean;
  permissionVerified: boolean;
  licenseId: string | null;
  reused: { security: boolean; commercial: boolean };
}

const ROLE_PERMISSION: Record<UserRole, { action: string; resource: string; roleId: string; permissions: string[] }> = {
  employee: { action: 'read', resource: 'workspace', roleId: 'employee', permissions: ['workspace:read'] },
  administrator: { action: 'write', resource: 'config', roleId: 'administrator', permissions: ['config:write', 'config:read'] },
  manager: { action: 'read', resource: 'report', roleId: 'manager', permissions: ['report:read'] },
  executive: { action: 'read', resource: 'dashboard', roleId: 'executive', permissions: ['dashboard:read'] },
  'ai-worker': { action: 'invoke', resource: 'agent', roleId: 'ai-worker', permissions: ['agent:invoke'] },
};

export class UserProvisioning {
  private readonly users = new Map<string, ProvisionedUser>();

  constructor(
    private readonly ctx: CustomerDeploymentContext,
    private readonly runtime: CustomerDeploymentRuntime,
    private readonly gov: DeploymentGovernance,
    private readonly operator: string,
  ) {}

  async provision(input: { deploymentId: string; role: UserRole; displayName: string; assignLicense?: boolean }): Promise<ProvisionedUser> {
    const deployment = this.require(input.deploymentId);
    const tenant = this.runtime.tenant(deployment.tenantId);
    const tenantKey = tenant?.name ?? deployment.tenantId;
    const spec = ROLE_PERMISSION[input.role];

    let identityId: string | null = null;
    let permissionVerified = false;
    if (this.ctx.security) {
      const id = await this.ctx.security.identity().register({ type: input.role === 'ai-worker' ? 'ai-identity' : 'user', displayName: input.displayName, tenant: tenantKey, roles: [spec.roleId] });
      identityId = id.id;
      this.ctx.security.authorization().defineRole({ id: spec.roleId, name: input.role, permissions: spec.permissions });
      const decision = this.ctx.security.authorization().authorize({ subject: { id: identityId, roles: [spec.roleId] }, action: spec.action, resource: { type: spec.resource } });
      permissionVerified = decision.allowed;
    }

    let licenseId: string | null = null;
    if (input.assignLicense && this.ctx.commercial) {
      const license = await this.ctx.commercial.licenses().issue({ tenantId: tenantKey, type: input.role === 'ai-worker' ? 'ai-worker' : 'seat', seats: 1 });
      await this.ctx.commercial.licenses().allocateSeat(license.id);
      licenseId = license.id;
    }

    const user: ProvisionedUser = {
      id: randomId('puser'),
      role: input.role,
      displayName: input.displayName,
      identityId,
      invited: true, // invitation represented — no email is actually sent from here
      permissionVerified,
      licenseId,
      reused: { security: Boolean(this.ctx.security), commercial: Boolean(this.ctx.commercial) },
    };
    this.users.set(user.id, user);
    await this.gov.record({
      operator: this.operator,
      customer: deployment.customerId,
      tenant: deployment.tenantId,
      environment: deployment.environmentId,
      epic: 'E7',
      operation: 'provision-user',
      targetId: input.role,
      evidence: this.ctx.security ? 'live-verified' : 'business-data-pending',
      decision: `perm=${permissionVerified} license=${licenseId ? 'assigned' : 'none'}`,
    });
    return user;
  }

  list(role?: UserRole): ProvisionedUser[] {
    const all = [...this.users.values()];
    return role ? all.filter((u) => u.role === role) : all;
  }
  count(): number {
    return this.users.size;
  }

  private require(deploymentId: string): { customerId: string; tenantId: string; environmentId: string } {
    const d = this.runtime.deployment(deploymentId);
    if (!d) throw new Error(`unknown deployment: ${deploymentId}`);
    return d;
  }
}
