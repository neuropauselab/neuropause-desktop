/**
 * Product Integrity v1.0 — cloud authenticity guardrails. With demo seeds OFF (the production default), the
 * cloud stores must contain ONLY real data: the single home tenant, zero fabricated remote tenants / SSO /
 * deployments / usage. These tests lock that so fabricated fixtures can never silently return to production.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { TenancyStore } from './tenancy/tenancyStore';
import { FederationStore } from './identity/federationStore';
import { ApiPlatformStore } from './apiplatform/apiPlatformStore';

/**
 * P13C ROUND 6 — SSO connections and webhooks resolve the CALLER'S cloud
 * tenant, not the one frozen at boot. These suites act as the tenant whose
 * cloud-tenant id they seed with, so every existing assertion keeps its
 * single-tenant meaning; cross-tenant behaviour is asserted with three
 * organizations in `tenancy/e2e/cloudIdentityTenancy.test.ts`.
 */
const CLOUD_TENANT = 'tnt_home';
const asCloudTenant = (): string => CLOUD_TENANT;
const asOrgScope = (): { tenantId: string; workspaceId: string } => ({ tenantId: 'org-default', workspaceId: 'ws-default' });

beforeAll(() => { delete process.env.NP_DEMO_SEEDS; }); // production default: no demo seeds

const tmp = (name: string): string => join(tmpdir(), `np-prod-${randomUUID()}-${name}`);

describe('cloud stores — production seed (no demo data)', () => {
  it('TenancyStore seeds ONLY the home tenant, with a real (zero-until-measured) storage footprint', async () => {
    // P13C Round 5 — F10. Cloud tenants resolve through organizationId.
    const asOrgX = (): { tenantId: string; workspaceId: string } => ({ tenantId: 'org-x', workspaceId: 'ws-x' });
    const s = new TenancyStore(tmp('tenancy.json'), 'org-x', 'Acme').bindScope(asOrgX);
    await s.load();
    const tenants = s.listTenants();
    expect(tenants).toHaveLength(1);
    expect(tenants[0].isHome).toBe(true);
    const iso = s.listIsolation();
    expect(iso).toHaveLength(1);
    expect(iso[0].objects).toBe(0); // no fabricated 12,840-object storage figure
    expect(iso[0].bytes).toBe(0);
    expect(s.summary().tenants).toBe(1); // no Helios/Aperture/Northwind demo tenants
  });

  it('FederationStore (identity) seeds NO SSO connections (no fake active Okta)', async () => {
    const s = new FederationStore(tmp('identity.json')).bindScope(asOrgScope).bindCloudTenantResolver(asCloudTenant);
    await s.load(CLOUD_TENANT);
    expect(s.listConnections()).toHaveLength(0);
    expect(s.summary().active).toBe(0);
  });

  it('ApiPlatformStore keeps rate-limit policies but seeds NO fabricated deployments/webhooks/APIs', async () => {
    const s = new ApiPlatformStore(tmp('api.json')).bindScope(asOrgScope).bindCloudTenantResolver(asCloudTenant);
    await s.load(CLOUD_TENANT);
    expect(s.listDeployments()).toHaveLength(0); // no fake 99.98% uptime fixtures
    expect(s.listWebhooks()).toHaveLength(0); // no fake 1,284 deliveries
    expect(s.listPublicApis()).toHaveLength(0); // no fake rps
    expect(s.listPolicies().length).toBeGreaterThan(0); // policies are real config, kept
  });
});
