/**
 * Runtime permission system. Every app declares the capabilities it needs; the
 * user grants or denies them (at install time via the permission dialog, and
 * later from settings). Grants are persisted per-app in the Local Application
 * Registry and enforced by the runtime before a sensitive capability is used.
 */
import type { PermissionGrant, RuntimePermissionKey } from '@neuropause/shared';
import { registry } from '../registry/registry';
import { createLogger } from '../logger';

const log = createLogger('permissions');

function now(): string {
  return new Date().toISOString();
}

export const permissionManager = {
  /**
   * Resolves an install-time decision into concrete grants. Pure: returns the
   * grant records and the effective granted set for the new registry entry.
   */
  computeGrants(
    requested: RuntimePermissionKey[],
    granted: RuntimePermissionKey[],
  ): { grants: PermissionGrant[]; effective: RuntimePermissionKey[] } {
    const grantedSet = new Set(granted);
    const seen = new Set<RuntimePermissionKey>();
    const grants: PermissionGrant[] = [];
    for (const perm of requested) {
      if (seen.has(perm)) continue;
      seen.add(perm);
      grants.push({
        permission: perm,
        state: grantedSet.has(perm) ? 'granted' : 'denied',
        decidedAt: now(),
      });
    }
    // Permissions granted that weren't formally requested are still honored.
    for (const perm of granted) {
      if (!seen.has(perm)) {
        seen.add(perm);
        grants.push({ permission: perm, state: 'granted', decidedAt: now() });
      }
    }
    const effective = grants.filter((g) => g.state === 'granted').map((g) => g.permission);
    return { grants, effective };
  },

  /** Required permissions the user has not granted. */
  missingRequired(
    requiredPermissions: RuntimePermissionKey[],
    granted: RuntimePermissionKey[],
  ): RuntimePermissionKey[] {
    const grantedSet = new Set(granted);
    return requiredPermissions.filter((p) => !grantedSet.has(p));
  },

  list(slug: string): PermissionGrant[] {
    return registry.getRaw(slug)?.permissionGrants ?? [];
  },

  has(slug: string, permission: RuntimePermissionKey): boolean {
    const e = registry.getRaw(slug);
    return !!e && e.grantedPermissions.includes(permission);
  },

  /** Enforcement point the runtime calls before using a capability. */
  enforce(slug: string, permission: RuntimePermissionKey): void {
    if (!this.has(slug, permission)) {
      throw new Error(`Permission "${permission}" not granted for ${slug}`);
    }
  },

  async grant(slug: string, permission: RuntimePermissionKey): Promise<PermissionGrant[]> {
    await registry.patch(slug, (e) => {
      const existing = e.permissionGrants.find((g) => g.permission === permission);
      if (existing) {
        existing.state = 'granted';
        existing.decidedAt = now();
      } else {
        e.permissionGrants.push({ permission, state: 'granted', decidedAt: now() });
      }
      if (!e.grantedPermissions.includes(permission)) e.grantedPermissions.push(permission);
    });
    log.info('Permission granted', { slug, permission });
    return this.list(slug);
  },

  async revoke(slug: string, permission: RuntimePermissionKey): Promise<PermissionGrant[]> {
    await registry.patch(slug, (e) => {
      const existing = e.permissionGrants.find((g) => g.permission === permission);
      if (existing) {
        existing.state = 'revoked';
        existing.decidedAt = now();
      }
      e.grantedPermissions = e.grantedPermissions.filter((p) => p !== permission);
    });
    log.info('Permission revoked', { slug, permission });
    return this.list(slug);
  },
};
