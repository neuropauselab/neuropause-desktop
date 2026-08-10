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
import type { TenantScope } from '@neuropause/shared';

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
