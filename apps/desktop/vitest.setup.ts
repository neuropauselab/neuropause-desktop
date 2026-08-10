/**
 * Node test setup.
 *
 * ONE responsibility: give every store constructed in a test a tenant to belong
 * to. `EnterpriseRecordStore` denies every read until a scope is bound, which is
 * the enforcement mechanism P11 rests on — and it means the 85 test files that
 * build modules through their `create*Module(path)` factories, bypassing the
 * module registry that binds production, would otherwise all read nothing.
 *
 * This is a FALLBACK, not an override: any store with its own binding ignores
 * it, so a test that needs to prove isolation sets its own scopes and this line
 * has no effect on it. And the setter throws outside a test runner, so it cannot
 * become a production bypass.
 */
import { setAmbientTenantScopeForTests } from './src/main/enterprise/framework/enterpriseRecordStore';
import { setAmbientAppendOnlyScopeForTests } from './src/main/decisions/appendOnlyStore';
import { setAmbientMemoryViewerForTests } from './src/main/memory/memoryStore';
import { setAmbientProvenanceScopeForTests } from './src/main/dataPlane/importer';
import { TEST_TENANT_SCOPE, TEST_MEMORY_VIEWER } from './src/main/tenancy/testScope';

setAmbientTenantScopeForTests(() => TEST_TENANT_SCOPE);
// P12 — the same fallback for the append-only substrate: documents, holds,
// decision records, opportunity decisions, outcome revisions.
setAmbientAppendOnlyScopeForTests(() => TEST_TENANT_SCOPE);
/**
 * P13A — the same fallback for memory and provenance.
 *
 * Memory needs a VIEWER rather than a scope, because it enforces personal
 * ownership and a scope cannot express a person. The ambient viewer names a
 * user, so an existing test that remembers something gets a tenant memory owned
 * by a real identity — and a test that wants to prove PERSONAL isolation has to
 * introduce a second identity deliberately, which is the same asymmetry
 * `TEST_TENANT_SCOPE` / `OTHER_TENANT_SCOPE` already establishes for tenants.
 */
setAmbientMemoryViewerForTests(() => TEST_MEMORY_VIEWER);
setAmbientProvenanceScopeForTests(() => TEST_TENANT_SCOPE);
