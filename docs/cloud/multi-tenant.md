# Multi-Tenant Runtime

> `apps/desktop/src/main/cloud/tenancy/`

Organizations → tenants → regions, with projects, teams, AI worker assignments,
and per-tenant storage isolation.

## Model

- **CloudTenant** — `{ id, name, slug, organizationId, regionId, tier, status,
  isHome, storageNamespace, createdAt }`. The local organization is the **home
  tenant** (`isHome: true`), linked to the real org via `organizationId`.
- **CloudRegion** — six regions across three residencies: `us-east`, `us-west`
  (US); `eu-west`, `eu-central` (EU); `ap-south`, `ap-southeast` (APAC).
- **CloudProject**, **CloudTeam**, **TenantWorker** — scoped to a tenant.
- **StorageIsolation** — `{ tenantId, namespace, encryptionKeyId, regionId,
  residency, objects, bytes }`. One isolation boundary per tenant.

## Behavior

`TenancyStore` seeds the home tenant from the local org plus three demo tenants
(Helios / eu-west / enterprise, Aperture / us-west / enterprise, Northwind /
ap-south / business), each with projects, teams, workers, and an isolation
descriptor. The home tenant's AI workers are folded in live from the workforce
registry at boot (idempotent).

Operations: `createTenant` (status `provisioning`, region + namespace +
encryption key assigned), `setTenantStatus` (suspend/resume — **the home tenant
is protected**), `createProject` / `deleteProject`, `createTeam`. `summary()`
rolls up tenant/region/project/team/worker counts.

## Seam

Demo tenants are seeded fixtures, not real remote tenants. Storage isolation is
a descriptor (namespace + key + region), not a physically separate datastore —
the shape a real provisioning backend fills in.
