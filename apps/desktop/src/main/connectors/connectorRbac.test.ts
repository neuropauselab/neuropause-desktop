/** P4.1 Increment 5 — connector RBAC seed. connectors:read/manage exist and land on the right roles. */
import { describe, expect, it } from 'vitest';
import { ALL_ENTERPRISE_PERMISSIONS } from '@neuropause/shared';
import { buildSeed, ROLE } from '../enterprise/org/seed';

describe('connector RBAC', () => {
  it('registers connectors:read + connectors:manage in the permission set', () => {
    expect(ALL_ENTERPRISE_PERMISSIONS).toContain('connectors:read');
    expect(ALL_ENTERPRISE_PERMISSIONS).toContain('connectors:manage');
  });

  it('grants connector scopes to the right built-in roles', () => {
    const seed = buildSeed();
    const perms = (id: string): string[] => seed.roles.find((r) => r.id === id)?.permissions ?? [];
    // Owner holds everything (root of trust).
    expect(perms(ROLE.owner)).toEqual(expect.arrayContaining(['connectors:read', 'connectors:manage']));
    // Manager+ can manage connectors.
    expect(perms(ROLE.manager)).toEqual(expect.arrayContaining(['connectors:read', 'connectors:manage']));
    // Viewer can read but not manage.
    expect(perms(ROLE.viewer)).toContain('connectors:read');
    expect(perms(ROLE.viewer)).not.toContain('connectors:manage');
  });
});
