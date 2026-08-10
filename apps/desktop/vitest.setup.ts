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
import { TEST_TENANT_SCOPE } from './src/main/tenancy/testScope';

setAmbientTenantScopeForTests(() => TEST_TENANT_SCOPE);
// P12 — the same fallback for the append-only substrate: documents, holds,
// decision records, opportunity decisions, outcome revisions.
setAmbientAppendOnlyScopeForTests(() => TEST_TENANT_SCOPE);
