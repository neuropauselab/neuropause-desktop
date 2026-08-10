/**
 * A fixed tenant scope for tests.
 *
 * WHY THIS IS A SHIPPED FILE AND NOT A TEST FIXTURE
 *
 * `EnterpriseRecordStore` denies every read until a scope is bound. That is the
 * whole enforcement mechanism, and it means ~40 existing test call sites across
 * 24 files now have to say which tenant they are operating as — which is the
 * correct outcome: a test that reads records without naming a tenant is a test
 * that would have passed before P11 for the wrong reason.
 *
 * Giving them one shared constant rather than 24 local ones means a test that
 * needs to prove ISOLATION has to deliberately introduce a second scope. That
 * asymmetry is deliberate: the default is "one tenant, everything works", and
 * crossing a boundary is something a test has to opt into and name.
 *
 * It lives in `src` rather than a test directory because the UI suite resolves
 * `@main/*` and the node suite resolves relative paths, and one importable path
 * beats two copies that can drift.
 */
import type { MemoryViewer, Organization, TenantScope, Workspace } from '@neuropause/shared';
import type { TenantFanOutDeps } from './backgroundFanOut';

/**
 * The tenant every existing test operates as.
 *
 * DELIBERATELY NOT the production default (`org-default` / `workspace-default`).
 * If the ambient seam ever did leak into a build, a scope identical to
 * production's would produce a working, correct-looking bypass; a distinct one
 * produces an empty screen, which someone reports.
 */
export const TEST_TENANT_SCOPE: TenantScope = {
  tenantId: 'org-test',
  workspaceId: 'workspace-test',
};

/**
 * A SECOND tenant, for isolation tests only.
 *
 * Nothing in the regression suite uses this. It exists so a cross-tenant test
 * reads as an intrusion rather than as ordinary setup.
 */
export const OTHER_TENANT_SCOPE: TenantScope = {
  tenantId: 'org-other',
  workspaceId: 'workspace-other',
};

/**
 * The memory viewer every existing test operates as (P13A).
 *
 * The same tenant and workspace as `TEST_TENANT_SCOPE`, plus an identity —
 * because memory enforces PERSONAL ownership and a `TenantScope` has no person
 * in it. Existing tests therefore keep reading their own memories unchanged.
 *
 * The identity is named rather than null on purpose. A null-identity viewer
 * cannot own or read personal memory at all, so making it the default would
 * mean every pre-existing test silently exercised the service-principal path
 * instead of the human one.
 */
export const TEST_MEMORY_VIEWER: MemoryViewer = {
  tenantId: TEST_TENANT_SCOPE.tenantId,
  workspaceId: TEST_TENANT_SCOPE.workspaceId,
  userId: 'tester@example.com',
};

/** A SECOND memory viewer, for isolation tests only. See `OTHER_TENANT_SCOPE`. */
export const OTHER_MEMORY_VIEWER: MemoryViewer = {
  tenantId: OTHER_TENANT_SCOPE.tenantId,
  workspaceId: OTHER_TENANT_SCOPE.workspaceId,
  userId: 'other@example.com',
};

/* ── Background fan-out (P13C Part 3) ──────────────────────────────────── */

/** A minimal operable organization, for fan-out tests. */
export function testOrganization(id: string, name = id): Organization {
  const at = '2026-01-01T00:00:00.000Z';
  return {
    id,
    name,
    slug: id,
    description: '',
    type: 'business',
    status: 'active',
    createdAt: at,
    updatedAt: at,
    metadata: {},
  };
}

/** A minimal workspace belonging to `organizationId`, for fan-out tests. */
export function testWorkspace(id: string, organizationId: string): Workspace {
  const at = '2026-01-01T00:00:00.000Z';
  return {
    id,
    name: id,
    organizationId,
    isolation: 'isolated',
    createdAt: at,
    updatedAt: at,
  };
}

/**
 * Fan-out deps for the ONE tenant every ordinary test operates as.
 *
 * The same asymmetry `TEST_TENANT_SCOPE` establishes: the default is a single
 * tenant, so a test that wants to prove a job fans out to a SECOND one has to
 * build that list deliberately and name it. A default that already contained
 * two tenants would make every unrelated test quietly exercise the fan-out and
 * hide which ones actually assert on it.
 */
export const SINGLE_TENANT_FAN_OUT: TenantFanOutDeps = {
  organizations: () => [testOrganization(TEST_TENANT_SCOPE.tenantId)],
  workspaces: () => [testWorkspace(TEST_TENANT_SCOPE.workspaceId, TEST_TENANT_SCOPE.tenantId)],
};

/** Fan-out deps covering BOTH test tenants. For isolation tests only. */
export const TWO_TENANT_FAN_OUT: TenantFanOutDeps = {
  organizations: () => [
    testOrganization(TEST_TENANT_SCOPE.tenantId),
    testOrganization(OTHER_TENANT_SCOPE.tenantId),
  ],
  workspaces: () => [
    testWorkspace(TEST_TENANT_SCOPE.workspaceId, TEST_TENANT_SCOPE.tenantId),
    testWorkspace(OTHER_TENANT_SCOPE.workspaceId, OTHER_TENANT_SCOPE.tenantId),
  ],
};
